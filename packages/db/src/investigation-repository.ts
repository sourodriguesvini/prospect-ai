import {
  AppError,
  type InvestigationPatch,
  type InvestigationRepository,
} from '@prospector/application';
import { CompanyInvestigationSummary, Investigation } from '@prospector/contracts';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { COMPANY_SELECT, mapCompany } from './company-rows';
import { toAppError } from './errors';
import { AUDIT_HEADER, encodeAuditHeader } from './strategy-repository';

/**
 * Investigações de empresas via PostgREST (Módulo 02, migração 20261111150000, ADR-0015). Início,
 * pedido de cancelamento, retomada e conclusão levam o registro de auditoria no cabeçalho; o
 * progresso e o batimento não são auditados (o trigger só dispara nas transições de estado).
 */

interface DbError {
  message?: string | null;
  code?: string | null;
}

interface Result {
  data: unknown;
  error: DbError | null;
}

/** A segunda investigação ativa da mesma empresa esbarra no índice único parcial. */
function mapError(error: DbError): AppError {
  if (
    error.code === '23505' &&
    (error.message ?? '').includes('company_investigations_active_key')
  ) {
    return new AppError('conflict', 'investigation_running', { cause: error });
  }
  return toAppError(error);
}

async function run(query: PromiseLike<Result>): Promise<unknown> {
  const { data, error } = await query;
  if (error) throw mapError(error);
  return data;
}

async function rows(query: PromiseLike<Result>): Promise<unknown[]> {
  return ((await run(query)) as unknown[] | null) ?? [];
}

const IN_CHUNK = 100;
const ACTIVE = ['queued', 'running'] as const;

/** timestamptz do PostgREST (`+00:00`, até microssegundos) → ISO 8601 em UTC. */
const Timestamp = z.string().transform((value, ctx) => {
  const time = Date.parse(value);
  if (Number.isNaN(time)) {
    ctx.addIssue({ code: 'custom', message: 'Data inválida.' });
    return z.NEVER;
  }
  return new Date(time).toISOString();
});

export const INVESTIGATION_SELECT =
  'id, company_id, status, trigger, pipeline_version, steps, usage, models, diagnosis, snapshot, changes, previous_id, job_id, issue, cancel_requested_at, started_at, finished_at, is_demo, created_at, updated_at';

const InvestigationRow = z.object({
  id: z.string(),
  company_id: z.string(),
  status: z.string(),
  trigger: z.string(),
  pipeline_version: z.number(),
  steps: z.unknown(),
  usage: z.record(z.string(), z.unknown()),
  models: z.unknown(),
  diagnosis: z.unknown().nullable(),
  snapshot: z.unknown().nullable(),
  changes: z.unknown(),
  previous_id: z.string().nullable(),
  job_id: z.string().nullable(),
  issue: z.string().nullable(),
  cancel_requested_at: Timestamp.nullable(),
  started_at: Timestamp.nullable(),
  finished_at: Timestamp.nullable(),
  is_demo: z.boolean(),
  created_at: Timestamp,
  updated_at: Timestamp,
});

const EMPTY_USAGE = {
  searches: 0,
  searchCredits: 0,
  pagesRead: 0,
  captures: 0,
  captureBytes: 0,
  modelCalls: 0,
  modelMs: 0,
};

/** Toda leitura passa pelo contrato: mudança de esquema falha alto em vez de chegar torta à UI. */
export function mapInvestigation(raw: unknown): Investigation {
  const row = InvestigationRow.parse(raw);
  return Investigation.parse({
    id: row.id,
    companyId: row.company_id,
    status: row.status,
    trigger: row.trigger,
    pipelineVersion: row.pipeline_version,
    steps: row.steps,
    usage: { ...EMPTY_USAGE, ...row.usage },
    models: row.models,
    diagnosis: row.diagnosis ?? null,
    snapshot: row.snapshot ?? null,
    changes: row.changes,
    previousId: row.previous_id,
    jobId: row.job_id,
    issue: row.issue,
    cancelRequestedAt: row.cancel_requested_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    isDemo: row.is_demo,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

const SUMMARY_SELECT =
  'company_id, investigation_id, status, finished_at, updated_at, recommendation, recommended_offer_name, priority';

const SummaryRow = z.object({
  company_id: z.string(),
  investigation_id: z.string(),
  status: z.string(),
  finished_at: Timestamp.nullable(),
  updated_at: Timestamp,
  recommendation: z.string().nullable(),
  recommended_offer_name: z.string().nullable(),
  priority: z.number().nullable(),
});

export function mapInvestigationSummary(raw: unknown): CompanyInvestigationSummary {
  const row = SummaryRow.parse(raw);
  return CompanyInvestigationSummary.parse({
    companyId: row.company_id,
    investigationId: row.investigation_id,
    status: row.status,
    finishedAt: row.finished_at,
    updatedAt: row.updated_at,
    recommendation: row.recommendation,
    recommendedOfferName: row.recommended_offer_name,
    priority: row.priority,
  });
}

/** Só os campos presentes no patch. */
export function investigationPatchColumns(patch: InvestigationPatch): Record<string, unknown> {
  const columns: Record<string, unknown> = {};
  const set = (column: string, value: unknown) => {
    if (value !== undefined) columns[column] = value;
  };
  set('status', patch.status);
  set('steps', patch.steps);
  set('usage', patch.usage);
  set('models', patch.models);
  set('diagnosis', patch.diagnosis);
  set('snapshot', patch.snapshot);
  set('changes', patch.changes);
  set('issue', patch.issue);
  set('started_at', patch.startedAt);
  set('finished_at', patch.finishedAt);
  set('job_id', patch.jobId);
  set('runner', patch.runner);
  set('heartbeat_at', patch.heartbeatAt);
  // Retomada: o pedido de cancelamento antigo não vale para a nova volta na fila.
  if (patch.status === 'queued') columns.cancel_requested_at = null;
  return columns;
}

export function createSupabaseInvestigationRepository(
  client: SupabaseClient,
): InvestigationRepository {
  async function byId(id: string): Promise<Investigation | null> {
    const data = await run(
      client.from('company_investigations').select(INVESTIGATION_SELECT).eq('id', id).maybeSingle(),
    );
    return data ? mapInvestigation(data) : null;
  }

  return {
    async create(row, audit) {
      const created = await run(
        client
          .from('company_investigations')
          .insert({
            id: row.id,
            company_id: row.companyId,
            trigger: row.trigger,
            pipeline_version: row.pipelineVersion,
            steps: row.steps,
            previous_id: row.previousId,
            is_demo: row.isDemo,
          })
          .select(INVESTIGATION_SELECT)
          .single()
          .setHeader(AUDIT_HEADER, encodeAuditHeader('company_investigations', audit)),
      );
      return mapInvestigation(created);
    },

    get: byId,

    async listForCompany(companyId, limit) {
      return (
        await rows(
          client
            .from('company_investigations')
            .select(INVESTIGATION_SELECT)
            .eq('company_id', companyId)
            .order('created_at', { ascending: false })
            .limit(limit),
        )
      ).map(mapInvestigation);
    },

    async update(id, patch) {
      const updated = await rows(
        client
          .from('company_investigations')
          .update(investigationPatchColumns(patch))
          .eq('id', id)
          .select(INVESTIGATION_SELECT),
      );
      return updated[0] ? mapInvestigation(updated[0]) : null;
    },

    async updateAudited(id, patch, audit) {
      // A conclusão com resultado também atualiza `companies.last_investigated_at` (trigger),
      // coberta pelo mesmo registro.
      const updated = await rows(
        client
          .from('company_investigations')
          .update(investigationPatchColumns(patch))
          .eq('id', id)
          .select(INVESTIGATION_SELECT)
          .setHeader(
            AUDIT_HEADER,
            encodeAuditHeader('company_investigations', audit, ['companies']),
          ),
      );
      return updated[0] ? mapInvestigation(updated[0]) : null;
    },

    async requestCancel(id, at, audit) {
      const updated = await rows(
        client
          .from('company_investigations')
          .update({ cancel_requested_at: at })
          .eq('id', id)
          .in('status', ACTIVE)
          .is('cancel_requested_at', null)
          .select('id')
          .setHeader(AUDIT_HEADER, encodeAuditHeader('company_investigations', audit)),
      );
      if (updated.length > 0) return true;
      // Já pedido antes (e ainda ativa): nada novo a gravar nem auditar.
      const current = await byId(id);
      return (
        current !== null &&
        current.cancelRequestedAt !== null &&
        ACTIVE.some((status) => status === current.status)
      );
    },

    async touch(ids, runner, at) {
      if (ids.length === 0) return [];
      const touched = (await rows(
        client
          .from('company_investigations')
          .update({ runner, heartbeat_at: at })
          .in('id', [...new Set(ids)].slice(0, IN_CHUNK))
          .in('status', ACTIVE)
          .select('id, cancel_requested_at'),
      )) as Array<{ id: string; cancel_requested_at: string | null }>;
      return touched.filter((row) => row.cancel_requested_at !== null).map((row) => row.id);
    },

    async interruptStale(staleBefore) {
      // Sem batimento (na fila de um processo que morreu antes do primeiro), vale a última
      // atualização. ISO 8601 não tem vírgula nem parêntese: seguro no filtro `or`.
      const before = new Date(staleBefore).toISOString();
      const updated = await rows(
        client
          .from('company_investigations')
          .update({ status: 'interrupted', runner: null, heartbeat_at: null })
          .in('status', ACTIVE)
          .or(`heartbeat_at.lt.${before},and(heartbeat_at.is.null,updated_at.lt.${before})`)
          .select('id'),
      );
      return updated.length;
    },

    async summaries(companyIds) {
      const unique = [...new Set(companyIds)];
      const parts = await Promise.all(
        Array.from({ length: Math.ceil(unique.length / IN_CHUNK) }, (_, index) =>
          rows(
            client
              .from('company_investigation_summaries')
              .select(SUMMARY_SELECT)
              .in('company_id', unique.slice(index * IN_CHUNK, (index + 1) * IN_CHUNK)),
          ),
        ),
      );
      return parts.flat().map(mapInvestigationSummary);
    },

    async confirmSite(companyId, domain, audit) {
      const ok = await run(
        client
          .rpc('confirm_company_site', { p_company_id: companyId, p_domain: domain })
          .setHeader(AUDIT_HEADER, encodeAuditHeader('companies', audit, ['company_identifiers'])),
      );
      if (ok !== true) return null;
      const company = await run(
        client.from('companies').select(COMPANY_SELECT).eq('id', companyId).maybeSingle(),
      );
      if (!company) throw new AppError('unexpected', 'unexpected');
      return mapCompany(company);
    },
  };
}
