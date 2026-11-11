import type {
  DiscoveryRunPatch,
  MonitorSchedulePatch,
  MonitorUserPatch,
  NewDiscoveryRun,
  NewMonitor,
  NewProspect,
  NewProspectSignal,
  NewProspectSource,
  ProspectPatch,
  ProspectRecord,
  RunProspectLink,
  StoredRunQuery,
} from '@prospector/application';
import {
  AiJob,
  DiscoveryMonitor,
  DiscoveryRun,
  DiscoveryRunQuery,
  EMPTY_DISCOVERY_PROGRESS,
  Prospect,
  ProspectSignal,
  ProspectSource,
} from '@prospector/contracts';
import { z } from 'zod';

/**
 * Linhas da Descoberta e da fila (migração 20261111120000) ↔ contratos. Toda leitura passa pelo
 * contrato: uma mudança de esquema falha alto em vez de chegar torta à UI.
 */

/** numeric chega como número ou texto, conforme o tamanho. */
const Numeric = z.union([
  z.number(),
  z
    .string()
    .regex(/^-?\d+(\.\d+)?$/)
    .transform(Number),
]);

/** timestamptz do PostgREST (`+00:00`, até microssegundos) → ISO 8601 em UTC. */
const Timestamp = z.string().transform((value, ctx) => {
  const time = Date.parse(value);
  if (Number.isNaN(time)) {
    ctx.addIssue({ code: 'custom', message: 'Data inválida.' });
    return z.NEVER;
  }
  return new Date(time).toISOString();
});

// --- Fila ------------------------------------------------------------------------

export const JOB_SELECT =
  'id, kind, status, idempotency_key, payload, attempts, max_attempts, run_after, lease_owner, lease_expires_at, cancel_requested_at, last_error_code, trace_id, created_at, started_at, finished_at';

const JobRow = z.object({
  id: z.string(),
  kind: z.string(),
  status: z.string(),
  idempotency_key: z.string(),
  payload: z.record(z.string(), z.unknown()),
  attempts: Numeric,
  max_attempts: Numeric,
  run_after: Timestamp,
  lease_owner: z.string().nullable(),
  lease_expires_at: Timestamp.nullable(),
  cancel_requested_at: Timestamp.nullable(),
  last_error_code: z.string().nullable(),
  trace_id: z.string(),
  created_at: Timestamp,
  started_at: Timestamp.nullable(),
  finished_at: Timestamp.nullable(),
});

export function mapJob(raw: unknown): AiJob {
  const row = JobRow.parse(raw);
  return AiJob.parse({
    id: row.id,
    kind: row.kind,
    status: row.status,
    idempotencyKey: row.idempotency_key,
    payload: row.payload,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    runAfter: row.run_after,
    leaseOwner: row.lease_owner,
    leaseExpiresAt: row.lease_expires_at,
    cancelRequestedAt: row.cancel_requested_at,
    lastErrorCode: row.last_error_code,
    traceId: row.trace_id,
    createdAt: row.created_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  });
}

// --- Pesquisas -------------------------------------------------------------------

export const RUN_SELECT =
  'id, request, options, trigger, monitor_id, status, stage, intent, plan, limits, progress, partial, failure_code, icp_id, icp_version_id, offer_id, scoring_model_version_id, prompt_ids, trace_id, is_demo, created_at, started_at, finished_at, cancel_requested_at';

const RunRow = z.object({
  id: z.string(),
  request: z.string(),
  options: z.record(z.string(), z.unknown()),
  trigger: z.string(),
  monitor_id: z.string().nullable(),
  status: z.string(),
  stage: z.string().nullable(),
  intent: z.unknown(),
  plan: z.unknown(),
  limits: z.unknown(),
  progress: z.record(z.string(), z.unknown()),
  partial: z.boolean(),
  failure_code: z.string().nullable(),
  icp_id: z.string().nullable(),
  icp_version_id: z.string().nullable(),
  offer_id: z.string().nullable(),
  scoring_model_version_id: z.string().nullable(),
  prompt_ids: z.array(z.string()),
  trace_id: z.string(),
  is_demo: z.boolean(),
  created_at: Timestamp,
  started_at: Timestamp.nullable(),
  finished_at: Timestamp.nullable(),
  cancel_requested_at: Timestamp.nullable(),
});

export function mapRun(raw: unknown): DiscoveryRun {
  const row = RunRow.parse(raw);
  return DiscoveryRun.parse({
    id: row.id,
    request: row.request,
    options: row.options,
    trigger: row.trigger,
    monitorId: row.monitor_id,
    status: row.status,
    stage: row.stage,
    intent: row.intent ?? null,
    plan: row.plan ?? null,
    limits: row.limits,
    progress: { ...EMPTY_DISCOVERY_PROGRESS, ...row.progress },
    partial: row.partial,
    failureCode: row.failure_code,
    icpId: row.icp_id,
    icpVersionId: row.icp_version_id,
    offerId: row.offer_id,
    scoringModelVersionId: row.scoring_model_version_id,
    promptIds: row.prompt_ids,
    traceId: row.trace_id,
    isDemo: row.is_demo,
    createdAt: row.created_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    cancelRequestedAt: row.cancel_requested_at,
  });
}

export function runColumns(run: NewDiscoveryRun) {
  return {
    id: run.id,
    request: run.request,
    options: run.options,
    trigger: run.trigger,
    monitor_id: run.monitorId,
    status: run.status,
    limits: run.limits,
    progress: EMPTY_DISCOVERY_PROGRESS,
    icp_id: run.icpId,
    trace_id: run.traceId,
    is_demo: run.isDemo,
    created_at: run.createdAt,
    confirmed_at: run.confirmedAt,
  };
}

/** Só os campos presentes no patch (o trabalhador nunca toca em confirmação e cancelamento). */
export function runPatchColumns(patch: DiscoveryRunPatch): Record<string, unknown> {
  const map: Record<keyof DiscoveryRunPatch, string> = {
    status: 'status',
    stage: 'stage',
    intent: 'intent',
    plan: 'plan',
    limits: 'limits',
    progress: 'progress',
    partial: 'partial',
    failureCode: 'failure_code',
    icpId: 'icp_id',
    icpVersionId: 'icp_version_id',
    offerId: 'offer_id',
    scoringModelVersionId: 'scoring_model_version_id',
    promptIds: 'prompt_ids',
    startedAt: 'started_at',
    finishedAt: 'finished_at',
  };
  return pick(patch, map);
}

export const QUERY_SELECT =
  'run_id, position, query, status, results, credits_charged, failure, fetched_at';

const QueryRow = z.object({
  run_id: z.string(),
  position: Numeric,
  query: z.unknown(),
  status: z.string(),
  results: z.array(z.unknown()),
  credits_charged: Numeric,
  failure: z.string().nullable(),
  fetched_at: Timestamp,
});

export function mapQuery(raw: unknown): DiscoveryRunQuery {
  const row = QueryRow.parse(raw);
  return DiscoveryRunQuery.parse({
    runId: row.run_id,
    position: row.position,
    query: row.query,
    status: row.status,
    results: row.results,
    creditsCharged: row.credits_charged,
    failure: row.failure,
    fetchedAt: row.fetched_at,
  });
}

/** Colunas que mudam ao refazer uma busca que falhou (chave fica de fora: sem privilégio). */
export function queryUpdateColumns(row: StoredRunQuery) {
  return {
    status: row.status,
    results: row.results,
    credits_charged: row.creditsCharged,
    failure: row.failure,
    fetched_at: row.fetchedAt,
    retention_until: row.retentionUntil,
  };
}

export function queryColumns(row: StoredRunQuery) {
  return {
    run_id: row.runId,
    position: row.position,
    query: row.query,
    ...queryUpdateColumns(row),
  };
}

// --- Empresas encontradas --------------------------------------------------------

export const PROSPECT_SELECT =
  'id, dedupe_key, name_key, display_name, domain, website_url, segment, city, uf, description, cnpj, company_id, status, dismissed_reason, priority, priority_score, confidence, assessment, site_verified, first_seen_at, last_seen_at, last_verified_at, first_run_id, last_run_id, is_demo, created_at, updated_at';

const ProspectRow = z.object({
  id: z.string(),
  dedupe_key: z.string(),
  name_key: z.string(),
  display_name: z.string(),
  domain: z.string().nullable(),
  website_url: z.string().nullable(),
  segment: z.string().nullable(),
  city: z.string().nullable(),
  uf: z.string().nullable(),
  description: z.string().nullable(),
  cnpj: z.string().nullable(),
  company_id: z.string().nullable(),
  status: z.string(),
  dismissed_reason: z.string().nullable(),
  priority: z.string(),
  priority_score: Numeric.nullable(),
  confidence: z.string(),
  assessment: z.unknown(),
  site_verified: z.boolean(),
  first_seen_at: Timestamp,
  last_seen_at: Timestamp,
  last_verified_at: Timestamp.nullable(),
  first_run_id: z.string(),
  last_run_id: z.string(),
  is_demo: z.boolean(),
  created_at: Timestamp,
  updated_at: Timestamp,
});

export function mapProspect(raw: unknown): ProspectRecord {
  const row = ProspectRow.parse(raw);
  const prospect = Prospect.parse({
    id: row.id,
    dedupeKey: row.dedupe_key,
    displayName: row.display_name,
    domain: row.domain,
    websiteUrl: row.website_url,
    segment: row.segment,
    city: row.city,
    uf: row.uf,
    description: row.description,
    cnpj: row.cnpj,
    companyId: row.company_id,
    status: row.status,
    dismissedReason: row.dismissed_reason,
    priority: row.priority,
    priorityScore: row.priority_score,
    confidence: row.confidence,
    assessment: row.assessment ?? null,
    siteVerified: row.site_verified,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    lastVerifiedAt: row.last_verified_at,
    firstRunId: row.first_run_id,
    lastRunId: row.last_run_id,
    isDemo: row.is_demo,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
  return { ...prospect, nameKey: row.name_key };
}

const PROSPECT_COLUMNS: Record<keyof ProspectPatch, string> = {
  dedupeKey: 'dedupe_key',
  nameKey: 'name_key',
  displayName: 'display_name',
  domain: 'domain',
  websiteUrl: 'website_url',
  segment: 'segment',
  city: 'city',
  uf: 'uf',
  description: 'description',
  cnpj: 'cnpj',
  priority: 'priority',
  priorityScore: 'priority_score',
  confidence: 'confidence',
  assessment: 'assessment',
  siteVerified: 'site_verified',
  lastSeenAt: 'last_seen_at',
  lastVerifiedAt: 'last_verified_at',
  lastRunId: 'last_run_id',
};

export function prospectColumns(prospect: NewProspect) {
  return {
    id: prospect.id,
    ...pick(prospect, PROSPECT_COLUMNS),
    company_id: prospect.companyId,
    status: prospect.status,
    dismissed_reason: prospect.dismissedReason,
    first_seen_at: prospect.firstSeenAt,
    first_run_id: prospect.firstRunId,
    is_demo: prospect.isDemo,
  };
}

export function prospectPatchColumns(patch: ProspectPatch): Record<string, unknown> {
  return pick(patch, PROSPECT_COLUMNS);
}

export const LINK_SELECT = 'run_id, prospect_id, is_new, matched_by, position';

const LinkRow = z.object({
  run_id: z.string(),
  prospect_id: z.string(),
  is_new: z.boolean(),
  matched_by: z.enum(['cnpj', 'site', 'name_location']).nullable(),
  position: Numeric,
});

export function mapLink(raw: unknown): RunProspectLink {
  const row = LinkRow.parse(raw);
  return {
    runId: row.run_id,
    prospectId: row.prospect_id,
    isNew: row.is_new,
    matchedBy: row.matched_by,
    position: row.position,
  };
}

export function linkColumns(link: RunProspectLink) {
  return {
    run_id: link.runId,
    prospect_id: link.prospectId,
    is_new: link.isNew,
    matched_by: link.matchedBy,
    position: link.position,
  };
}

// --- Fontes e sinais -------------------------------------------------------------

export const SOURCE_SELECT =
  'id, prospect_id, run_id, url, host, title, snippet, kind, relation, provider, published_at, captured_at, retention_until';

const SourceRow = z.object({
  id: z.string(),
  prospect_id: z.string(),
  run_id: z.string(),
  url: z.string(),
  host: z.string(),
  title: z.string().nullable(),
  snippet: z.string(),
  kind: z.string(),
  relation: z.string(),
  provider: z.string(),
  published_at: z.string().nullable(),
  captured_at: Timestamp,
  retention_until: Timestamp,
});

export function mapSource(raw: unknown): ProspectSource {
  const row = SourceRow.parse(raw);
  return ProspectSource.parse({
    id: row.id,
    prospectId: row.prospect_id,
    runId: row.run_id,
    url: row.url,
    host: row.host,
    title: row.title,
    snippet: row.snippet,
    kind: row.kind,
    relation: row.relation,
    provider: row.provider,
    publishedAt: row.published_at,
    capturedAt: row.captured_at,
    retentionUntil: row.retention_until,
  });
}

export function sourceColumns(source: NewProspectSource) {
  return {
    prospect_id: source.prospectId,
    run_id: source.runId,
    url: source.url,
    host: source.host,
    title: source.title,
    snippet: source.snippet,
    kind: source.kind,
    relation: source.relation,
    provider: source.provider,
    published_at: source.publishedAt,
    captured_at: source.capturedAt,
    retention_until: source.retentionUntil,
  };
}

export const SIGNAL_SELECT =
  'id, prospect_id, run_id, source_id, type, summary, quote, event_date, published_at, discovered_at, verification, confidence, relevance, related_service, rationale, recency, fingerprint, created_at';

const SignalRow = z.object({
  id: z.string(),
  prospect_id: z.string(),
  run_id: z.string(),
  source_id: z.string(),
  type: z.string(),
  summary: z.string(),
  quote: z.string(),
  event_date: z.string().nullable(),
  published_at: z.string().nullable(),
  discovered_at: Timestamp,
  verification: z.string(),
  confidence: Numeric,
  relevance: z.string(),
  related_service: z.string().nullable(),
  rationale: z.string(),
  recency: z.string(),
  fingerprint: z.string(),
  created_at: Timestamp,
});

export function mapSignal(raw: unknown): ProspectSignal {
  const row = SignalRow.parse(raw);
  return ProspectSignal.parse({
    id: row.id,
    prospectId: row.prospect_id,
    runId: row.run_id,
    sourceId: row.source_id,
    type: row.type,
    summary: row.summary,
    quote: row.quote,
    eventDate: row.event_date,
    publishedAt: row.published_at,
    discoveredAt: row.discovered_at,
    verification: row.verification,
    confidence: row.confidence,
    relevance: row.relevance,
    relatedService: row.related_service,
    rationale: row.rationale,
    recency: row.recency,
    fingerprint: row.fingerprint,
    createdAt: row.created_at,
  });
}

export function signalColumns(signal: NewProspectSignal) {
  return {
    prospect_id: signal.prospectId,
    run_id: signal.runId,
    source_id: signal.sourceId,
    type: signal.type,
    summary: signal.summary,
    quote: signal.quote,
    event_date: signal.eventDate,
    published_at: signal.publishedAt,
    discovered_at: signal.discoveredAt,
    verification: signal.verification,
    confidence: signal.confidence,
    relevance: signal.relevance,
    related_service: signal.relatedService,
    rationale: signal.rationale,
    recency: signal.recency,
    fingerprint: signal.fingerprint,
    retention_until: signal.retentionUntil,
  };
}

// --- Monitoramentos --------------------------------------------------------------

export const MONITOR_SELECT =
  'id, name, request, frequency, status, max_searches, max_prospects, icp_id, next_run_at, last_run_at, last_run_id, missed_runs, is_demo, created_at, updated_at';

const MonitorRow = z.object({
  id: z.string(),
  name: z.string(),
  request: z.string(),
  frequency: z.string(),
  status: z.string(),
  max_searches: Numeric,
  max_prospects: Numeric,
  icp_id: z.string().nullable(),
  next_run_at: Timestamp.nullable(),
  last_run_at: Timestamp.nullable(),
  last_run_id: z.string().nullable(),
  missed_runs: Numeric,
  is_demo: z.boolean(),
  created_at: Timestamp,
  updated_at: Timestamp,
});

export function mapMonitor(raw: unknown): DiscoveryMonitor {
  const row = MonitorRow.parse(raw);
  return DiscoveryMonitor.parse({
    id: row.id,
    name: row.name,
    request: row.request,
    frequency: row.frequency,
    status: row.status,
    maxSearches: row.max_searches,
    maxProspects: row.max_prospects,
    icpId: row.icp_id,
    nextRunAt: row.next_run_at,
    lastRunAt: row.last_run_at,
    lastRunId: row.last_run_id,
    missedRuns: row.missed_runs,
    isDemo: row.is_demo,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

const MONITOR_COLUMNS: Record<keyof MonitorUserPatch | keyof MonitorSchedulePatch, string> = {
  name: 'name',
  request: 'request',
  frequency: 'frequency',
  status: 'status',
  maxSearches: 'max_searches',
  maxProspects: 'max_prospects',
  icpId: 'icp_id',
  nextRunAt: 'next_run_at',
  lastRunAt: 'last_run_at',
  lastRunId: 'last_run_id',
  missedRuns: 'missed_runs',
};

export function monitorColumns(monitor: NewMonitor) {
  return {
    id: monitor.id,
    ...pick(monitor, MONITOR_COLUMNS),
    is_demo: monitor.isDemo,
  };
}

export function monitorPatchColumns(
  patch: MonitorUserPatch | MonitorSchedulePatch,
): Record<string, unknown> {
  return pick(patch, MONITOR_COLUMNS);
}

/** Copia só os campos presentes (undefined = não mexe), já com o nome da coluna. */
function pick<T extends object>(
  source: T,
  map: Partial<Record<string, string>>,
): Record<string, unknown> {
  const columns: Record<string, unknown> = {};
  for (const [field, column] of Object.entries(map)) {
    const value = (source as Record<string, unknown>)[field];
    if (column && value !== undefined) columns[column] = value;
  }
  return columns;
}
