import {
  AppError,
  type DiscoveryRepository,
  type JobQueue,
  type PendingAudit,
} from '@prospector/application';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  LINK_SELECT,
  MONITOR_SELECT,
  PROSPECT_SELECT,
  QUERY_SELECT,
  RUN_SELECT,
  SIGNAL_SELECT,
  SOURCE_SELECT,
  linkColumns,
  mapJob,
  mapLink,
  mapMonitor,
  mapProspect,
  mapQuery,
  mapRun,
  mapSignal,
  mapSource,
  monitorColumns,
  monitorPatchColumns,
  prospectColumns,
  prospectPatchColumns,
  queryColumns,
  queryUpdateColumns,
  runColumns,
  runPatchColumns,
  signalColumns,
  sourceColumns,
} from './discovery-rows';
import { toAppError } from './errors';
import { AUDIT_HEADER, encodeAuditHeader, type AuditedTable } from './strategy-repository';

interface DbError {
  message?: string | null;
  code?: string | null;
}

interface Result {
  data: unknown;
  error: DbError | null;
}

async function run(query: PromiseLike<Result>): Promise<unknown> {
  const { data, error } = await query;
  if (error) throw toAppError(error);
  return data;
}

async function rows(query: PromiseLike<Result>): Promise<unknown[]> {
  return ((await run(query)) as unknown[] | null) ?? [];
}

/** Chave única da empresa encontrada (`dedupe_key`) repetida: corrida entre duas gravações. */
async function prospectWrite(query: PromiseLike<Result>): Promise<unknown[]> {
  const { data, error } = await query;
  if (error?.code === '23505') {
    throw new AppError('conflict', 'prospect_duplicate', { cause: error });
  }
  if (error) throw toAppError(error);
  return (data as unknown[] | null) ?? [];
}

/** Lotes no filtro `in` (a URL do PostgREST tem limite). */
const IN_CHUNK = 100;

function chunks<T>(items: readonly T[]): T[][] {
  const unique = [...new Set(items)];
  const out: T[][] = [];
  for (let index = 0; index < unique.length; index += IN_CHUNK) {
    out.push(unique.slice(index, index + IN_CHUNK));
  }
  return out;
}

const FINAL_RUN = '("completed","failed","cancelled")';

/** Raiz de CNPJ segura para o filtro `like` (só letras maiúsculas e dígitos). */
const CNPJ_ROOT = /^[0-9A-Z]{8}$/;

interface WithHeader<T> {
  setHeader(name: string, value: string): T;
}

function audited<T extends WithHeader<T>>(query: T, table: AuditedTable, audit: PendingAudit): T {
  return query.setHeader(AUDIT_HEADER, encodeAuditHeader(table, audit));
}

/**
 * Descoberta via PostgREST (ADR-0013). O banco garante o que importa: pesquisa confirmada entra
 * na fila na mesma transação (trigger), cancelamento marca a tarefa, chave única da empresa e
 * impressão digital única do sinal. Decisões da pessoa vão com o registro de auditoria no
 * cabeçalho (ADR-0010); escrita do trabalhador (progresso, resultados) não é auditada linha a
 * linha — o que a pessoa vê é a pesquisa e as decisões.
 */
export function createSupabaseDiscoveryRepository(client: SupabaseClient): DiscoveryRepository {
  async function byIds(table: string, select: string, column: string, ids: readonly string[]) {
    const parts = await Promise.all(
      chunks(ids).map((part) => rows(client.from(table).select(select).in(column, part))),
    );
    return parts.flat();
  }

  async function getRun(id: string) {
    const data = await run(
      client.from('discovery_runs').select(RUN_SELECT).eq('id', id).maybeSingle(),
    );
    return data ? mapRun(data) : null;
  }

  async function getProspect(id: string) {
    const data = await run(
      client.from('discovery_prospects').select(PROSPECT_SELECT).eq('id', id).maybeSingle(),
    );
    return data ? mapProspect(data) : null;
  }

  return {
    async createRun(newRun, audit) {
      const data = await run(
        audited(
          client.from('discovery_runs').insert(runColumns(newRun)).select(RUN_SELECT).single(),
          'discovery_runs',
          audit,
        ),
      );
      return mapRun(data);
    },

    getRun,

    async listRuns(filter) {
      let query = client
        .from('discovery_runs')
        .select(RUN_SELECT)
        .order('created_at', { ascending: false })
        .limit(filter.limit);
      if (filter.monitorId) query = query.eq('monitor_id', filter.monitorId);
      if (filter.statuses?.length) query = query.in('status', [...filter.statuses]);
      return (await rows(query)).map(mapRun);
    },

    async updateRun(id, patch) {
      const columns = runPatchColumns(patch);
      if (Object.keys(columns).length === 0) return;
      await run(client.from('discovery_runs').update(columns).eq('id', id));
    },

    async confirmRun(id, confirmedAt, audit) {
      const updated = await rows(
        audited(
          client
            .from('discovery_runs')
            .update({ status: 'queued', confirmed_at: confirmedAt })
            .eq('id', id)
            .eq('status', 'draft')
            .select('id'),
          'discovery_runs',
          audit,
        ),
      );
      return updated.length > 0;
    },

    async requestCancel(id, at, finishNow, audit) {
      if (finishNow) {
        // Ainda não rodou: encerra já. Se o trabalhador pegou no meio tempo, cai no pedido simples.
        const finished = await rows(
          audited(
            client
              .from('discovery_runs')
              .update({ cancel_requested_at: at, status: 'cancelled', finished_at: at })
              .eq('id', id)
              .is('cancel_requested_at', null)
              .in('status', ['draft', 'queued'])
              .select('id'),
            'discovery_runs',
            audit,
          ),
        );
        if (finished.length > 0) return true;
      }
      const requested = await rows(
        audited(
          client
            .from('discovery_runs')
            .update({ cancel_requested_at: at })
            .eq('id', id)
            .is('cancel_requested_at', null)
            .not('status', 'in', FINAL_RUN)
            .select('id'),
          'discovery_runs',
          audit,
        ),
      );
      return requested.length > 0;
    },

    async saveQuery(row) {
      // Sem upsert: a chave (pesquisa, posição) não tem privilégio de UPDATE (migração).
      const updated = await rows(
        client
          .from('discovery_run_queries')
          .update(queryUpdateColumns(row))
          .eq('run_id', row.runId)
          .eq('position', row.position)
          .select('run_id'),
      );
      if (updated.length > 0) return;
      await run(client.from('discovery_run_queries').insert(queryColumns(row)));
    },

    async listQueries(runId) {
      return (
        await rows(
          client
            .from('discovery_run_queries')
            .select(QUERY_SELECT)
            .eq('run_id', runId)
            .order('position'),
        )
      ).map(mapQuery);
    },

    async usageSince(since, triggers) {
      const found = (await rows(
        client
          .from('discovery_runs')
          .select('status, limits, progress')
          .gte('created_at', since)
          .in('trigger', [...triggers])
          .limit(1000),
      )) as Array<{
        status?: unknown;
        limits?: { maxSearches?: unknown };
        progress?: { creditsUsed?: unknown };
      }>;
      const finite = (value: unknown) =>
        typeof value === 'number' && Number.isFinite(value) ? value : 0;
      return {
        runs: found.length,
        credits: found.reduce((sum, item) => {
          const used = finite(item.progress?.creditsUsed);
          const active = item.status === 'queued' || item.status === 'running';
          return sum + (active ? Math.max(used, finite(item.limits?.maxSearches)) : used);
        }, 0),
      };
    },

    async findProspects(keys) {
      const lookups: Array<Promise<unknown[]>> = [];
      const select = () => client.from('discovery_prospects').select(PROSPECT_SELECT);
      for (const part of chunks(keys.dedupeKeys))
        lookups.push(rows(select().in('dedupe_key', part)));
      for (const part of chunks(keys.domains)) lookups.push(rows(select().in('domain', part)));
      for (const part of chunks(keys.nameKeys)) lookups.push(rows(select().in('name_key', part)));
      const roots = [...new Set(keys.cnpjRoots)].filter((root) => CNPJ_ROOT.test(root));
      if (roots.length > 0) {
        lookups.push(rows(select().or(roots.map((root) => `cnpj.like.${root}*`).join(','))));
      }
      const found = new Map<string, ReturnType<typeof mapProspect>>();
      for (const raw of (await Promise.all(lookups)).flat()) {
        const prospect = mapProspect(raw);
        found.set(prospect.id, prospect);
      }
      return [...found.values()];
    },

    async insertProspect(prospect) {
      const [data] = await prospectWrite(
        client
          .from('discovery_prospects')
          .insert(prospectColumns(prospect))
          .select(PROSPECT_SELECT),
      );
      if (!data) throw new AppError('unexpected', 'unexpected');
      return mapProspect(data);
    },

    async updateProspect(id, patch) {
      const columns = prospectPatchColumns(patch);
      if (Object.keys(columns).length === 0) return;
      await prospectWrite(
        client.from('discovery_prospects').update(columns).eq('id', id).select('id'),
      );
    },

    async setProspectStatus(id, change, audit) {
      const columns: Record<string, unknown> = {
        status: change.status,
        dismissed_reason: change.status === 'dismissed' ? change.dismissedReason : null,
      };
      if (change.companyId !== undefined) columns.company_id = change.companyId;
      const updated = await rows(
        audited(
          client.from('discovery_prospects').update(columns).eq('id', id).select('id'),
          'discovery_prospects',
          audit,
        ),
      );
      return updated.length > 0;
    },

    async linkRunProspect(link) {
      await run(
        client
          .from('discovery_run_prospects')
          .upsert(linkColumns(link), { onConflict: 'run_id,prospect_id', ignoreDuplicates: true }),
      );
    },

    getProspect,

    async listProspects(filter) {
      let ids: string[] | null = null;
      if (filter.runId) {
        ids = (
          (await rows(
            client
              .from('discovery_run_prospects')
              .select('prospect_id')
              .eq('run_id', filter.runId)
              .limit(100),
          )) as Array<{ prospect_id: string }>
        ).map((row) => row.prospect_id);
      }
      if (filter.signalType) {
        const withSignal = new Set(
          (
            (await rows(
              client
                .from('discovery_signals')
                .select('prospect_id')
                .eq('type', filter.signalType)
                .order('discovered_at', { ascending: false })
                .limit(1000),
            )) as Array<{ prospect_id: string }>
          ).map((row) => row.prospect_id),
        );
        ids = ids ? ids.filter((id) => withSignal.has(id)) : [...withSignal];
      }
      if (ids && ids.length === 0) return [];
      let query = client
        .from('discovery_prospects')
        .select(PROSPECT_SELECT)
        .order('last_seen_at', { ascending: false })
        .limit(filter.limit);
      if (ids) query = query.in('id', ids.slice(0, 500));
      if (filter.status.length > 0) query = query.in('status', [...filter.status]);
      else if (!filter.includeDismissed) query = query.neq('status', 'dismissed');
      if (filter.priority.length > 0) query = query.in('priority', [...filter.priority]);
      if (filter.firstSeenSince) query = query.gte('first_seen_at', filter.firstSeenSince);
      return (await rows(query)).map(mapProspect);
    },

    async runProspects(runId) {
      const links = (
        await rows(
          client
            .from('discovery_run_prospects')
            .select(LINK_SELECT)
            .eq('run_id', runId)
            .order('position'),
        )
      ).map(mapLink);
      const prospects = new Map(
        (
          await byIds(
            'discovery_prospects',
            PROSPECT_SELECT,
            'id',
            links.map((link) => link.prospectId),
          )
        )
          .map(mapProspect)
          .map((prospect) => [prospect.id, prospect]),
      );
      return links.flatMap((link) => {
        const prospect = prospects.get(link.prospectId);
        return prospect ? [{ ...link, prospect }] : [];
      });
    },

    async upsertSources(input) {
      if (input.length === 0) return [];
      // Fonte repetida (mesma empresa e endereço) fica como está: nada de UPDATE na chave.
      await run(
        client.from('discovery_sources').upsert(input.map(sourceColumns), {
          onConflict: 'prospect_id,url',
          ignoreDuplicates: true,
        }),
      );
      const wanted = new Set(input.map((row) => `${row.prospectId}|${row.url}`));
      const stored = (
        await byIds(
          'discovery_sources',
          SOURCE_SELECT,
          'prospect_id',
          input.map((row) => row.prospectId),
        )
      )
        .map(mapSource)
        .filter((source) => wanted.has(`${source.prospectId}|${source.url}`));
      const byKey = new Map(stored.map((source) => [`${source.prospectId}|${source.url}`, source]));
      return input.flatMap((row) => {
        const source = byKey.get(`${row.prospectId}|${row.url}`);
        return source ? [source] : [];
      });
    },

    async sourcesFor(prospectIds) {
      return (await byIds('discovery_sources', SOURCE_SELECT, 'prospect_id', prospectIds))
        .map(mapSource)
        .sort((a, b) => a.capturedAt.localeCompare(b.capturedAt));
    },

    async insertSignals(input) {
      if (input.length === 0) return [];
      const inserted = await rows(
        client
          .from('discovery_signals')
          .upsert(input.map(signalColumns), { onConflict: 'fingerprint', ignoreDuplicates: true })
          .select(SIGNAL_SELECT),
      );
      return inserted.map(mapSignal);
    },

    async signalsFor(prospectIds) {
      return (await byIds('discovery_signals', SIGNAL_SELECT, 'prospect_id', prospectIds)).map(
        mapSignal,
      );
    },

    async listSignals(filter) {
      let query = client
        .from('discovery_signals')
        .select(SIGNAL_SELECT)
        .order('discovered_at', { ascending: false })
        .limit(filter.limit);
      if (filter.types?.length) query = query.in('type', [...filter.types]);
      if (filter.since) query = query.gte('discovered_at', filter.since);
      if (filter.runId) query = query.eq('run_id', filter.runId);
      return (await rows(query)).map(mapSignal);
    },

    async createMonitor(monitor, audit) {
      const data = await run(
        audited(
          client
            .from('discovery_monitors')
            .insert(monitorColumns(monitor))
            .select(MONITOR_SELECT)
            .single(),
          'discovery_monitors',
          audit,
        ),
      );
      return mapMonitor(data);
    },

    async updateMonitor(id, patch, audit) {
      const columns = monitorPatchColumns(patch);
      const [data] = await rows(
        audited(
          client.from('discovery_monitors').update(columns).eq('id', id).select(MONITOR_SELECT),
          'discovery_monitors',
          audit,
        ),
      );
      return data ? mapMonitor(data) : null;
    },

    async scheduleMonitor(id, patch) {
      const columns = monitorPatchColumns(patch);
      if (Object.keys(columns).length === 0) return;
      await run(client.from('discovery_monitors').update(columns).eq('id', id));
    },

    async getMonitor(id) {
      const data = await run(
        client.from('discovery_monitors').select(MONITOR_SELECT).eq('id', id).maybeSingle(),
      );
      return data ? mapMonitor(data) : null;
    },

    async listMonitors(statuses) {
      if (statuses.length === 0) return [];
      return (
        await rows(
          client
            .from('discovery_monitors')
            .select(MONITOR_SELECT)
            .in('status', [...statuses])
            .order('created_at', { ascending: false })
            .limit(100),
        )
      ).map(mapMonitor);
    },

    async dueMonitors(now) {
      return (
        await rows(
          client
            .from('discovery_monitors')
            .select(MONITOR_SELECT)
            .eq('status', 'active')
            .lte('next_run_at', now)
            .order('next_run_at')
            .limit(20),
        )
      ).map(mapMonitor);
    },

    async claimMonitor(id, now, nextRunAt) {
      const claimed = await rows(
        client
          .from('discovery_monitors')
          .update({ next_run_at: nextRunAt })
          .eq('id', id)
          .eq('status', 'active')
          .lte('next_run_at', now)
          .select('id'),
      );
      return claimed.length > 0;
    },

    async purgeExpired(now) {
      const [queries, sources, signals] = await Promise.all([
        rows(
          client
            .from('discovery_run_queries')
            .update({ results: [] })
            .lt('retention_until', now)
            .neq('results', '[]')
            .select('run_id'),
        ),
        rows(
          client
            .from('discovery_sources')
            .update({ snippet: '' })
            .lt('retention_until', now)
            .neq('snippet', '')
            .select('id'),
        ),
        rows(client.from('discovery_signals').delete().lt('retention_until', now).select('id')),
      ]);
      return { queries: queries.length, sources: sources.length, signals: signals.length };
    },
  };
}

/** Fila durável (ADR-0011) pelas funções do banco: claim com SKIP LOCKED, lease e retentativa. */
export function createSupabaseJobQueue(client: SupabaseClient): JobQueue {
  return {
    async claim(worker, kinds, leaseSeconds) {
      const data = await rows(
        client.rpc('claim_ai_job', {
          p_worker: worker,
          p_kinds: [...kinds],
          p_lease_seconds: leaseSeconds,
        }),
      );
      return data[0] ? mapJob(data[0]) : null;
    },

    async heartbeat(jobId, worker, leaseSeconds) {
      const data = await run(
        client.rpc('heartbeat_ai_job', {
          p_id: jobId,
          p_worker: worker,
          p_lease_seconds: leaseSeconds,
        }),
      );
      return data === true;
    },

    async finish(jobId, worker, outcome) {
      const data = await run(
        client.rpc('finish_ai_job', {
          p_id: jobId,
          p_worker: worker,
          p_status: outcome.status,
          p_error_code: outcome.status === 'succeeded' ? null : outcome.errorCode,
          p_retry_after_seconds: outcome.status === 'retry' ? outcome.retryAfterSeconds : null,
        }),
      );
      return data === true;
    },

    async expire() {
      return (await rows(client.rpc('expire_ai_jobs'))).map(mapJob);
    },
  };
}
