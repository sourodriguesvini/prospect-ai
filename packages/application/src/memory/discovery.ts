import {
  EMPTY_DISCOVERY_PROGRESS,
  type AiJob,
  type DiscoveryMonitor,
  type DiscoveryRun,
  type DiscoveryRunQuery,
  type ProspectSignal,
  type ProspectSource,
} from '@prospector/contracts';
import { systemClock, type Clock } from '../clock';
import { AppError } from '../errors';
import type { AuditRepository, PendingAudit } from '../ports/audit-repository';
import type {
  DiscoveryRepository,
  JobQueue,
  ProspectRecord,
  RunProspectLink,
  StoredRunQuery,
} from '../ports/discovery';

const clone = <T>(value: T): T => structuredClone(value);

/**
 * Descoberta e fila em memória (ADR-0009): mesmo comportamento observável do banco (migração
 * 20261111120000) — pesquisa confirmada entra na fila na mesma operação, cancelamento marca a
 * tarefa, chave única da empresa, impressão digital única do sinal, auditoria das decisões.
 */
export function createMemoryDiscoveryStore(options: {
  audit: AuditRepository;
  clock?: Clock;
  newId?: () => string;
  maxAttempts?: number;
}): { repository: DiscoveryRepository; queue: JobQueue } {
  const clock = options.clock ?? systemClock;
  const newId = options.newId ?? (() => crypto.randomUUID());
  const maxAttempts = options.maxAttempts ?? 3;
  const nowMs = () => clock.now().getTime();
  const now = () => clock.now().toISOString();

  const runs = new Map<string, DiscoveryRun & { confirmedAt: string | null }>();
  const queries = new Map<string, StoredRunQuery>();
  const prospects = new Map<string, ProspectRecord>();
  const links = new Map<string, RunProspectLink>();
  const sources = new Map<string, ProspectSource>();
  const signals = new Map<string, ProspectSignal & { retentionUntil: string }>();
  const monitors = new Map<string, DiscoveryMonitor>();
  const jobs = new Map<string, AiJob>();

  async function audited(audit: PendingAudit, id: string): Promise<void> {
    await options.audit.append({
      actorType: audit.actorType,
      actorLabel: audit.actorLabel,
      action: audit.action,
      entityType: audit.entityType,
      entityId: audit.entityId ?? id,
      diff: { ...audit.diff },
      traceId: audit.traceId,
    });
  }

  function enqueue(run: DiscoveryRun): void {
    const key = `discovery_run:${run.id}`;
    if ([...jobs.values()].some((job) => job.idempotencyKey === key)) return;
    const id = newId();
    jobs.set(id, {
      id,
      kind: 'discovery_run',
      status: 'queued',
      idempotencyKey: key,
      payload: { runId: run.id },
      attempts: 0,
      maxAttempts,
      runAfter: now(),
      leaseOwner: null,
      leaseExpiresAt: null,
      cancelRequestedAt: null,
      lastErrorCode: null,
      traceId: run.traceId,
      createdAt: now(),
      startedAt: null,
      finishedAt: null,
    });
  }

  function jobFor(runId: string): AiJob | undefined {
    return [...jobs.values()].find((job) => job.idempotencyKey === `discovery_run:${runId}`);
  }

  function publicRun(run: DiscoveryRun & { confirmedAt: string | null }): DiscoveryRun {
    const { confirmedAt: _confirmed, ...rest } = run;
    return clone(rest);
  }

  const leaseExpired = (job: AiJob) =>
    job.leaseExpiresAt !== null && new Date(job.leaseExpiresAt).getTime() < nowMs();

  const repository: DiscoveryRepository = {
    async createRun(run, audit) {
      const stored = {
        ...clone(run),
        stage: null,
        intent: null,
        plan: null,
        progress: { ...EMPTY_DISCOVERY_PROGRESS },
        partial: false,
        failureCode: null,
        icpVersionId: null,
        offerId: null,
        scoringModelVersionId: null,
        promptIds: [],
        startedAt: null,
        finishedAt: null,
        cancelRequestedAt: null,
      } satisfies DiscoveryRun & { confirmedAt: string | null };
      runs.set(run.id, stored);
      await audited(audit, run.id);
      if (stored.status === 'queued') enqueue(stored);
      return publicRun(stored);
    },
    async getRun(id) {
      const run = runs.get(id);
      return run ? publicRun(run) : null;
    },
    async listRuns(filter) {
      return [...runs.values()]
        .filter((run) => !filter.statuses || filter.statuses.includes(run.status))
        .filter((run) => !filter.monitorId || run.monitorId === filter.monitorId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, filter.limit)
        .map(publicRun);
    },
    async updateRun(id, patch) {
      const run = runs.get(id);
      if (!run) return;
      const wasQueued = run.status === 'queued';
      Object.assign(run, clone(patch));
      if (run.status === 'queued' && !wasQueued) enqueue(run);
    },
    async confirmRun(id, confirmedAt, audit) {
      const run = runs.get(id);
      if (!run || run.status !== 'draft') return false;
      run.status = 'queued';
      run.confirmedAt = confirmedAt;
      await audited(audit, id);
      enqueue(run);
      return true;
    },
    async requestCancel(id, at, finishNow, audit) {
      const run = runs.get(id);
      if (
        !run ||
        run.cancelRequestedAt ||
        ['completed', 'failed', 'cancelled'].includes(run.status)
      ) {
        return false;
      }
      run.cancelRequestedAt = at;
      if (finishNow) {
        run.status = 'cancelled';
        run.finishedAt = at;
      }
      await audited(audit, id);
      const job = jobFor(id);
      if (job && (job.status === 'queued' || job.status === 'running')) job.cancelRequestedAt = at;
      return true;
    },
    async saveQuery(row) {
      queries.set(`${row.runId}|${row.position}`, clone(row));
    },
    async listQueries(runId) {
      return [...queries.values()]
        .filter((row) => row.runId === runId)
        .sort((a, b) => a.position - b.position)
        .map(({ retentionUntil: _retention, ...row }): DiscoveryRunQuery => clone(row));
    },
    async usageSince(since, triggers) {
      const selected = [...runs.values()].filter(
        (run) => run.createdAt >= since && triggers.includes(run.trigger),
      );
      return {
        runs: selected.length,
        credits: selected.reduce(
          (sum, run) =>
            sum +
            (run.status === 'queued' || run.status === 'running'
              ? Math.max(run.progress.creditsUsed, run.limits.maxSearches)
              : run.progress.creditsUsed),
          0,
        ),
      };
    },

    async findProspects(keys) {
      return [...prospects.values()]
        .filter(
          (item) =>
            keys.dedupeKeys.includes(item.dedupeKey) ||
            (item.domain !== null && keys.domains.includes(item.domain)) ||
            (item.cnpj !== null && keys.cnpjRoots.includes(item.cnpj.slice(0, 8))) ||
            keys.nameKeys.includes(item.nameKey),
        )
        .map(clone);
    },
    async insertProspect(prospect) {
      if ([...prospects.values()].some((item) => item.dedupeKey === prospect.dedupeKey)) {
        throw new AppError('conflict', 'prospect_duplicate');
      }
      const record: ProspectRecord = { ...clone(prospect), createdAt: now(), updatedAt: now() };
      prospects.set(record.id, record);
      return clone(record);
    },
    async updateProspect(id, patch) {
      const record = prospects.get(id);
      if (!record) return;
      if (
        patch.dedupeKey &&
        patch.dedupeKey !== record.dedupeKey &&
        [...prospects.values()].some((item) => item.dedupeKey === patch.dedupeKey)
      ) {
        throw new AppError('conflict', 'prospect_duplicate');
      }
      Object.assign(record, clone(patch), { updatedAt: now() });
    },
    async setProspectStatus(id, change, audit) {
      const record = prospects.get(id);
      if (!record) return false;
      record.status = change.status;
      record.dismissedReason = change.status === 'dismissed' ? change.dismissedReason : null;
      if (change.companyId !== undefined) record.companyId = change.companyId;
      record.updatedAt = now();
      await audited(audit, id);
      return true;
    },
    async linkRunProspect(link) {
      links.set(`${link.runId}|${link.prospectId}`, clone(link));
    },
    async getProspect(id) {
      const record = prospects.get(id);
      return record ? clone(record) : null;
    },
    async listProspects(filter) {
      const inRun = filter.runId
        ? new Set(
            [...links.values()]
              .filter((link) => link.runId === filter.runId)
              .map((link) => link.prospectId),
          )
        : null;
      const withSignal = filter.signalType
        ? new Set(
            [...signals.values()]
              .filter((signal) => signal.type === filter.signalType)
              .map((signal) => signal.prospectId),
          )
        : null;
      return [...prospects.values()]
        .filter((item) => !inRun || inRun.has(item.id))
        .filter((item) => !withSignal || withSignal.has(item.id))
        .filter((item) => filter.status.length === 0 || filter.status.includes(item.status))
        .filter(
          (item) =>
            filter.includeDismissed ||
            filter.status.includes('dismissed') ||
            item.status !== 'dismissed',
        )
        .filter((item) => filter.priority.length === 0 || filter.priority.includes(item.priority))
        .filter((item) => !filter.firstSeenSince || item.firstSeenAt >= filter.firstSeenSince)
        .sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt))
        .slice(0, filter.limit)
        .map(clone);
    },
    async runProspects(runId) {
      return [...links.values()]
        .filter((link) => link.runId === runId)
        .flatMap((link) => {
          const prospect = prospects.get(link.prospectId);
          return prospect ? [{ ...clone(link), prospect: clone(prospect) }] : [];
        })
        .sort((a, b) => a.position - b.position);
    },
    async upsertSources(rows) {
      const result: ProspectSource[] = [];
      for (const row of rows) {
        const existing = [...sources.values()].find(
          (item) => item.prospectId === row.prospectId && item.url === row.url,
        );
        if (existing) {
          result.push(clone(existing));
          continue;
        }
        const stored: ProspectSource = { ...clone(row), id: newId() };
        sources.set(stored.id, stored);
        result.push(clone(stored));
      }
      return result;
    },
    async sourcesFor(prospectIds) {
      return [...sources.values()]
        .filter((source) => prospectIds.includes(source.prospectId))
        .sort((a, b) => a.capturedAt.localeCompare(b.capturedAt))
        .map(clone);
    },
    async insertSignals(rows) {
      const inserted: ProspectSignal[] = [];
      for (const row of rows) {
        if ([...signals.values()].some((item) => item.fingerprint === row.fingerprint)) continue;
        const id = newId();
        const stored = { ...clone(row), id, createdAt: now() };
        signals.set(id, stored);
        const { retentionUntil: _r, ...signal } = stored;
        inserted.push(clone(signal));
      }
      return inserted;
    },
    async signalsFor(prospectIds) {
      return [...signals.values()]
        .filter((signal) => prospectIds.includes(signal.prospectId))
        .map(({ retentionUntil: _r, ...signal }) => clone(signal));
    },
    async listSignals(filter) {
      return [...signals.values()]
        .filter((signal) => !filter.types?.length || filter.types.includes(signal.type))
        .filter((signal) => !filter.since || signal.discoveredAt >= filter.since)
        .filter((signal) => !filter.runId || signal.runId === filter.runId)
        .sort((a, b) => b.discoveredAt.localeCompare(a.discoveredAt))
        .slice(0, filter.limit)
        .map(({ retentionUntil: _r, ...signal }) => clone(signal));
    },

    async createMonitor(monitor, audit) {
      const stored: DiscoveryMonitor = {
        ...clone(monitor),
        lastRunAt: null,
        lastRunId: null,
        missedRuns: 0,
        createdAt: now(),
        updatedAt: now(),
      };
      monitors.set(stored.id, stored);
      await audited(audit, stored.id);
      return clone(stored);
    },
    async updateMonitor(id, patch, audit) {
      const monitor = monitors.get(id);
      if (!monitor) return null;
      Object.assign(monitor, clone(patch), { updatedAt: now() });
      if (monitor.status !== 'active') monitor.nextRunAt = null;
      await audited(audit, id);
      return clone(monitor);
    },
    async scheduleMonitor(id, patch) {
      const monitor = monitors.get(id);
      if (!monitor) return;
      Object.assign(monitor, clone(patch), { updatedAt: now() });
    },
    async getMonitor(id) {
      const monitor = monitors.get(id);
      return monitor ? clone(monitor) : null;
    },
    async listMonitors(statuses) {
      return [...monitors.values()]
        .filter((monitor) => statuses.includes(monitor.status))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .map(clone);
    },
    async dueMonitors(at) {
      return [...monitors.values()]
        .filter(
          (monitor) =>
            monitor.status === 'active' && monitor.nextRunAt !== null && monitor.nextRunAt <= at,
        )
        .map(clone);
    },

    async claimMonitor(id, at, nextRunAt) {
      const monitor = monitors.get(id);
      if (!monitor || monitor.status !== 'active') return false;
      if (monitor.nextRunAt === null || monitor.nextRunAt > at) return false;
      monitor.nextRunAt = nextRunAt;
      monitor.updatedAt = now();
      return true;
    },

    async purgeExpired(at) {
      let purgedQueries = 0;
      let purgedSources = 0;
      let purgedSignals = 0;
      for (const row of queries.values()) {
        if (row.retentionUntil < at && row.results.length > 0) {
          row.results = [];
          purgedQueries += 1;
        }
      }
      for (const source of sources.values()) {
        if (source.retentionUntil < at && source.snippet !== '') {
          source.snippet = '';
          purgedSources += 1;
        }
      }
      for (const [id, signal] of signals) {
        if (signal.retentionUntil < at) {
          signals.delete(id);
          purgedSignals += 1;
        }
      }
      return { queries: purgedQueries, sources: purgedSources, signals: purgedSignals };
    },
  };

  const queue: JobQueue = {
    async claim(worker, kinds, leaseSeconds) {
      const ready = [...jobs.values()]
        .filter(
          (job) =>
            kinds.includes(job.kind) &&
            job.attempts < job.maxAttempts &&
            job.cancelRequestedAt === null &&
            ((job.status === 'queued' && new Date(job.runAfter).getTime() <= nowMs()) ||
              (job.status === 'running' && leaseExpired(job))),
        )
        .sort(
          (a, b) => a.runAfter.localeCompare(b.runAfter) || a.createdAt.localeCompare(b.createdAt),
        )[0];
      if (!ready) return null;
      ready.status = 'running';
      ready.attempts += 1;
      ready.leaseOwner = worker;
      ready.leaseExpiresAt = new Date(nowMs() + leaseSeconds * 1000).toISOString();
      ready.startedAt ??= now();
      return clone(ready);
    },
    async heartbeat(jobId, worker, leaseSeconds) {
      const job = jobs.get(jobId);
      if (!job || job.status !== 'running' || job.leaseOwner !== worker || job.cancelRequestedAt)
        return false;
      job.leaseExpiresAt = new Date(nowMs() + leaseSeconds * 1000).toISOString();
      return true;
    },
    async finish(jobId, worker, outcome) {
      const job = jobs.get(jobId);
      if (!job || job.status !== 'running' || job.leaseOwner !== worker) return false;
      job.leaseOwner = null;
      job.leaseExpiresAt = null;
      if (outcome.status === 'retry' && job.attempts < job.maxAttempts) {
        job.status = 'queued';
        job.lastErrorCode = outcome.errorCode;
        job.runAfter = new Date(
          nowMs() + Math.max(1, outcome.retryAfterSeconds) * 1000,
        ).toISOString();
        return true;
      }
      job.status = outcome.status === 'retry' ? 'failed' : outcome.status;
      job.lastErrorCode = outcome.status === 'succeeded' ? null : outcome.errorCode;
      job.finishedAt = now();
      return true;
    },
    async expire() {
      const expired: AiJob[] = [];
      for (const job of jobs.values()) {
        const exhaustedOrCancelled =
          job.attempts >= job.maxAttempts || job.cancelRequestedAt !== null;
        if (
          exhaustedOrCancelled &&
          ((job.status === 'running' && leaseExpired(job)) || job.status === 'queued')
        ) {
          job.status = job.cancelRequestedAt === null ? 'failed' : 'cancelled';
          if (job.cancelRequestedAt === null) job.lastErrorCode = 'attempts_exhausted';
          job.leaseOwner = null;
          job.leaseExpiresAt = null;
          job.finishedAt = now();
          expired.push(clone(job));
        }
      }
      return expired;
    },
  };

  return { repository, queue };
}
