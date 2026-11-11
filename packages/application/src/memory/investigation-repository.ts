import type {
  CompanyInvestigationSummary,
  Investigation,
  InvestigationStatus,
} from '@prospector/contracts';
import { systemClock, type Clock } from '../clock';
import { AppError } from '../errors';
import type { AuditRepository, PendingAudit } from '../ports/audit-repository';
import type { CaptureStore, InvestigationRepository } from '../ports/investigation';
import type { MemoryCompanyHooks } from './company-repository';

const clone = <T>(value: T): T => structuredClone(value);
const ACTIVE: ReadonlySet<InvestigationStatus> = new Set(['queued', 'running']);

/**
 * Investigações em memória: mesmo comportamento observável de `company_investigations` (uma
 * ativa por empresa, auditoria no início, no pedido de cancelamento e na conclusão, data da
 * última investigação na empresa ao concluir).
 */
export function createMemoryInvestigationRepository(options: {
  audit: AuditRepository;
  companies: MemoryCompanyHooks & { get(id: string): Promise<unknown> };
  clock?: Clock;
}): InvestigationRepository {
  const clock = options.clock ?? systemClock;
  const now = () => clock.now().toISOString();
  const rows = new Map<string, Investigation>();
  const meta = new Map<
    string,
    { runner: string | null; heartbeatAt: string | null; seq: number }
  >();
  let seq = 0;

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

  function activeFor(companyId: string, except: string | null): boolean {
    return [...rows.values()].some(
      (row) => row.companyId === companyId && row.id !== except && ACTIVE.has(row.status),
    );
  }

  function apply(id: string, patch: Parameters<InvestigationRepository['update']>[1]) {
    const row = rows.get(id);
    if (!row) return null;
    if (patch.status === 'queued' || patch.status === 'running') {
      if (activeFor(row.companyId, id)) throw new AppError('conflict', 'investigation_running');
    }
    const info = meta.get(id) ?? { runner: null, heartbeatAt: null, seq: 0 };
    const { runner, heartbeatAt, ...fields } = patch;
    for (const [key, value] of Object.entries(fields)) {
      if (value !== undefined) (row as unknown as Record<string, unknown>)[key] = clone(value);
    }
    if (patch.status === 'queued') row.cancelRequestedAt = null;
    if (runner !== undefined) info.runner = runner;
    if (heartbeatAt !== undefined) info.heartbeatAt = heartbeatAt;
    meta.set(id, info);
    row.updatedAt = now();
    return row;
  }

  function sorted(list: Investigation[]): Investigation[] {
    return list.sort(
      (a, b) =>
        b.createdAt.localeCompare(a.createdAt) ||
        (meta.get(b.id)?.seq ?? 0) - (meta.get(a.id)?.seq ?? 0),
    );
  }

  return {
    async create(row, audit) {
      if (!(await options.companies.get(row.companyId)))
        throw new AppError('not_found', 'not_found');
      if (activeFor(row.companyId, null)) throw new AppError('conflict', 'investigation_running');
      const at = now();
      const stored: Investigation = {
        id: row.id,
        companyId: row.companyId,
        status: 'queued',
        trigger: row.trigger,
        pipelineVersion: row.pipelineVersion,
        steps: clone(row.steps),
        usage: {
          searches: 0,
          searchCredits: 0,
          pagesRead: 0,
          captures: 0,
          captureBytes: 0,
          modelCalls: 0,
          modelMs: 0,
        },
        models: [],
        diagnosis: null,
        snapshot: null,
        changes: [],
        previousId: row.previousId,
        jobId: null,
        issue: null,
        cancelRequestedAt: null,
        startedAt: null,
        finishedAt: null,
        isDemo: row.isDemo,
        createdAt: at,
        updatedAt: at,
      };
      rows.set(stored.id, stored);
      meta.set(stored.id, { runner: null, heartbeatAt: null, seq: (seq += 1) });
      await audited(audit, stored.id);
      return clone(stored);
    },

    async get(id) {
      const row = rows.get(id);
      return row ? clone(row) : null;
    },

    async listForCompany(companyId, limit) {
      return sorted([...rows.values()].filter((row) => row.companyId === companyId))
        .slice(0, limit)
        .map(clone);
    },

    async update(id, patch) {
      const row = apply(id, patch);
      return row ? clone(row) : null;
    },

    async updateAudited(id, patch, audit) {
      const row = apply(id, patch);
      if (!row) return null;
      if (row.status === 'succeeded' || row.status === 'partial') {
        options.companies.markInvestigated(row.companyId, row.finishedAt ?? now());
      }
      await audited(audit, id);
      return clone(row);
    },

    async requestCancel(id, at, audit) {
      const row = rows.get(id);
      if (!row || !ACTIVE.has(row.status)) return false;
      row.cancelRequestedAt = at;
      row.updatedAt = now();
      await audited(audit, id);
      return true;
    },

    async touch(ids, runner, at) {
      const cancelled: string[] = [];
      for (const id of ids) {
        const row = rows.get(id);
        if (!row || !ACTIVE.has(row.status)) continue;
        const info = meta.get(id) ?? { runner: null, heartbeatAt: null, seq: 0 };
        info.runner = runner;
        info.heartbeatAt = at;
        meta.set(id, info);
        if (row.cancelRequestedAt) cancelled.push(id);
      }
      return cancelled;
    },

    async interruptStale(staleBefore, at) {
      let count = 0;
      for (const row of rows.values()) {
        if (!ACTIVE.has(row.status)) continue;
        const info = meta.get(row.id);
        const beat = info?.heartbeatAt ?? row.updatedAt;
        if (beat >= staleBefore) continue;
        row.status = 'interrupted';
        row.updatedAt = at;
        if (info) {
          info.runner = null;
          info.heartbeatAt = null;
        }
        count += 1;
      }
      return count;
    },

    async summaries(companyIds) {
      const wanted = new Set(companyIds);
      const byCompany = new Map<string, Investigation[]>();
      for (const row of rows.values()) {
        if (!wanted.has(row.companyId)) continue;
        byCompany.set(row.companyId, [...(byCompany.get(row.companyId) ?? []), row]);
      }
      const result: CompanyInvestigationSummary[] = [];
      for (const [companyId, list] of byCompany) {
        const [latest] = sorted([...list]);
        if (!latest) continue;
        const withDiagnosis = sorted([...list]).find((row) => row.diagnosis !== null);
        const diagnosis = withDiagnosis?.diagnosis ?? null;
        const offer = diagnosis?.offers.find(
          (item) => item.offerId === diagnosis.recommendedOfferId,
        );
        result.push({
          companyId,
          investigationId: latest.id,
          status: latest.status,
          finishedAt: latest.finishedAt,
          updatedAt: latest.updatedAt,
          recommendation: diagnosis?.recommendation ?? null,
          recommendedOfferName: offer?.offerName ?? null,
          priority: offer?.priority ?? null,
        });
      }
      return result;
    },

    async confirmSite(companyId, domain, audit) {
      const company = options.companies.confirmDomain(companyId, domain);
      if (!company) return null;
      await audited(audit, companyId);
      return company;
    },
  };
}

/** Capturas em memória (testes): caminho opaco por investigação e janela. */
export function createMemoryCaptureStore(): CaptureStore & { size(): number } {
  const files = new Map<string, Uint8Array>();
  return {
    async put({ companyId, investigationId, viewport, image, capturedAt }) {
      const storagePath = `${companyId}/${investigationId}-${viewport}.jpg`;
      files.set(storagePath, new Uint8Array(image.bytes));
      return { storagePath, bytes: image.bytes.length, sha256: image.sha256, capturedAt };
    },
    async get(storagePath) {
      const bytes = files.get(storagePath);
      return bytes ? { bytes: new Uint8Array(bytes), mime: 'image/jpeg' } : null;
    },
    async delete(storagePath) {
      files.delete(storagePath);
    },
    size: () => files.size,
  };
}
