import type {
  AiErrorCode,
  AiJob,
  AiJobKind,
  DiscoveryIntent,
  DiscoveryMonitor,
  DiscoveryRequestInput,
  DiscoveryRun,
  DiscoveryRunQuery,
  DiscoveryRunStatus,
  DiscoveryTrigger,
  ExtractorOutput,
  InterpreterOutput,
  MonitorStatus,
  Prospect,
  ProspectListFilter,
  ProspectSignal,
  ProspectSource,
  ProspectStatus,
  SignalType,
} from '@prospector/contracts';
import type { PendingAudit } from './audit-repository';

// -----------------------------------------------------------------------------
// Repositório da Descoberta (F4, ADR-0013; migração 20261111120000)
// -----------------------------------------------------------------------------

/** Pesquisa a gravar. `confirmedAt` null = rascunho do Copiloto (espera a pessoa confirmar). */
export type NewDiscoveryRun = Pick<
  DiscoveryRun,
  | 'id'
  | 'request'
  | 'options'
  | 'trigger'
  | 'monitorId'
  | 'status'
  | 'limits'
  | 'icpId'
  | 'traceId'
  | 'isDemo'
  | 'createdAt'
> & { confirmedAt: string | null };

/** Escrita do trabalhador (progresso e resultado), sem auditoria por linha. */
export type DiscoveryRunPatch = Partial<
  Pick<
    DiscoveryRun,
    | 'status'
    | 'stage'
    | 'intent'
    | 'plan'
    | 'limits'
    | 'progress'
    | 'partial'
    | 'failureCode'
    | 'icpId'
    | 'icpVersionId'
    | 'offerId'
    | 'scoringModelVersionId'
    | 'promptIds'
    | 'startedAt'
    | 'finishedAt'
  >
>;

export type StoredRunQuery = DiscoveryRunQuery & { retentionUntil: string };

/** Empresa encontrada como gravada (com o nome normalizado da deduplicação). */
export type ProspectRecord = Prospect & { nameKey: string };

export type NewProspect = Omit<ProspectRecord, 'createdAt' | 'updatedAt'>;

/** Campos que o trabalhador atualiza (nunca status, motivo ou ligação com Empresas). */
export type ProspectPatch = Partial<
  Pick<
    ProspectRecord,
    | 'dedupeKey'
    | 'nameKey'
    | 'displayName'
    | 'domain'
    | 'websiteUrl'
    | 'segment'
    | 'city'
    | 'uf'
    | 'description'
    | 'cnpj'
    | 'priority'
    | 'priorityScore'
    | 'confidence'
    | 'assessment'
    | 'siteVerified'
    | 'lastSeenAt'
    | 'lastVerifiedAt'
    | 'lastRunId'
  >
>;

export interface RunProspectLink {
  runId: string;
  prospectId: string;
  isNew: boolean;
  matchedBy: 'cnpj' | 'site' | 'name_location' | null;
  position: number;
}

export type NewProspectSource = Omit<ProspectSource, 'id'>;
export type NewProspectSignal = Omit<ProspectSignal, 'id' | 'createdAt'> & {
  retentionUntil: string;
};

/** Monitoramento a gravar; `nextRunAt` calculado pelo serviço. */
export type NewMonitor = Omit<
  DiscoveryMonitor,
  'createdAt' | 'updatedAt' | 'lastRunAt' | 'lastRunId' | 'missedRuns'
>;

/** O que a pessoa muda num monitoramento (auditado). */
export type MonitorUserPatch = Partial<
  Pick<
    DiscoveryMonitor,
    | 'name'
    | 'request'
    | 'frequency'
    | 'status'
    | 'maxSearches'
    | 'maxProspects'
    | 'icpId'
    | 'nextRunAt'
  >
>;

/** O que o agendador muda (sem auditoria). */
export type MonitorSchedulePatch = Partial<
  Pick<DiscoveryMonitor, 'nextRunAt' | 'lastRunAt' | 'lastRunId' | 'missedRuns'>
>;

export interface DiscoveryRunListFilter {
  limit: number;
  monitorId?: string | null;
  statuses?: readonly DiscoveryRunStatus[];
}

export interface DiscoveryRepository {
  createRun(run: NewDiscoveryRun, audit: PendingAudit): Promise<DiscoveryRun>;
  getRun(id: string): Promise<DiscoveryRun | null>;
  listRuns(filter: DiscoveryRunListFilter): Promise<DiscoveryRun[]>;
  updateRun(id: string, patch: DiscoveryRunPatch): Promise<void>;
  /** Rascunho → fila (auditado). false quando a pesquisa não é mais rascunho. */
  confirmRun(id: string, confirmedAt: string, audit: PendingAudit): Promise<boolean>;
  /**
   * Pede o cancelamento (auditado). Com `finishNow`, a pesquisa que ainda não rodou já fica
   * cancelada. false quando ela já terminou ou já tinha cancelamento pedido.
   */
  requestCancel(id: string, at: string, finishNow: boolean, audit: PendingAudit): Promise<boolean>;
  saveQuery(row: StoredRunQuery): Promise<void>;
  listQueries(runId: string): Promise<DiscoveryRunQuery[]>;
  /**
   * Pesquisas criadas desde `since` por estes gatilhos e os créditos comprometidos: os gastos
   * pelas que terminaram e o teto (`limits.maxSearches`) das que ainda estão na fila ou rodando,
   * para o teto diário valer mesmo com várias pesquisas criadas na mesma volta.
   */
  usageSince(
    since: string,
    triggers: readonly DiscoveryTrigger[],
  ): Promise<{ runs: number; credits: number }>;

  /** Candidatas para deduplicar: mesma chave, domínio, raiz de CNPJ ou nome normalizado. */
  findProspects(keys: {
    dedupeKeys: readonly string[];
    domains: readonly string[];
    cnpjRoots: readonly string[];
    nameKeys: readonly string[];
  }): Promise<ProspectRecord[]>;
  /** AppError('conflict', 'prospect_duplicate') quando a chave já existe (corrida). */
  insertProspect(prospect: NewProspect): Promise<ProspectRecord>;
  updateProspect(id: string, patch: ProspectPatch): Promise<void>;
  /** Decisão da pessoa ou ligação com Empresas (auditada). false = empresa não existe. */
  setProspectStatus(
    id: string,
    change: { status: ProspectStatus; dismissedReason: string | null; companyId?: string | null },
    audit: PendingAudit,
  ): Promise<boolean>;
  linkRunProspect(link: RunProspectLink): Promise<void>;
  getProspect(id: string): Promise<ProspectRecord | null>;
  listProspects(filter: ProspectListFilter): Promise<ProspectRecord[]>;
  runProspects(runId: string): Promise<Array<RunProspectLink & { prospect: ProspectRecord }>>;
  /** Grava as fontes novas e devolve todas (as já existentes para a mesma empresa e URL também). */
  upsertSources(rows: readonly NewProspectSource[]): Promise<ProspectSource[]>;
  sourcesFor(prospectIds: readonly string[]): Promise<ProspectSource[]>;
  /** Grava os sinais novos (impressão digital repetida é ignorada) e devolve os gravados. */
  insertSignals(rows: readonly NewProspectSignal[]): Promise<ProspectSignal[]>;
  signalsFor(prospectIds: readonly string[]): Promise<ProspectSignal[]>;
  /** Sinais mais recentes (descoberta), com filtro opcional por tipo e data. */
  listSignals(filter: {
    types?: readonly SignalType[];
    since?: string | null;
    runId?: string | null;
    limit: number;
  }): Promise<ProspectSignal[]>;

  createMonitor(monitor: NewMonitor, audit: PendingAudit): Promise<DiscoveryMonitor>;
  updateMonitor(
    id: string,
    patch: MonitorUserPatch,
    audit: PendingAudit,
  ): Promise<DiscoveryMonitor | null>;
  scheduleMonitor(id: string, patch: MonitorSchedulePatch): Promise<void>;
  getMonitor(id: string): Promise<DiscoveryMonitor | null>;
  listMonitors(statuses: readonly MonitorStatus[]): Promise<DiscoveryMonitor[]>;
  dueMonitors(now: string): Promise<DiscoveryMonitor[]>;
  /**
   * "Pega" o monitoramento vencido: muda `next_run_at` só se ele ainda estiver vencido em `now`.
   * false = outro agendador (por exemplo, o app instalado no mesmo banco) já pegou.
   */
  claimMonitor(id: string, now: string, nextRunAt: string): Promise<boolean>;

  /** Prazo de guarda (ADR-0012): esvazia trechos e resultados vencidos e apaga sinais vencidos. */
  purgeExpired(now: string): Promise<{ queries: number; sources: number; signals: number }>;
}

// -----------------------------------------------------------------------------
// Fila durável (ADR-0011)
// -----------------------------------------------------------------------------

export type JobOutcome =
  | { status: 'succeeded' }
  | { status: 'failed' | 'cancelled'; errorCode: string | null }
  | { status: 'retry'; errorCode: string; retryAfterSeconds: number };

export interface JobQueue {
  /** Próxima tarefa pronta (ou com lease vencido); null = fila vazia. */
  claim(worker: string, kinds: readonly AiJobKind[], leaseSeconds: number): Promise<AiJob | null>;
  /** false = perdeu a tarefa ou o cancelamento foi pedido: parar. */
  heartbeat(jobId: string, worker: string, leaseSeconds: number): Promise<boolean>;
  finish(jobId: string, worker: string, outcome: JobOutcome): Promise<boolean>;
  /** Encerra as que caíram sem tentativa sobrando (ou canceladas antes de rodar). */
  expire(): Promise<AiJob[]>;
}

// -----------------------------------------------------------------------------
// IA local da Descoberta (implementação em @prospector/agents, via raiz de composição)
// -----------------------------------------------------------------------------

export interface InterpretInput {
  request: string;
  options: Omit<DiscoveryRequestInput, 'request'>;
  /** Data de hoje (AAAA-MM-DD, fuso da agência): o modelo não sabe a data sozinho. */
  today: string;
  /** Resumo do ICP e da oferta ativos (dado, não instrução). */
  context: {
    offer: string | null;
    icpRegions: string[];
    services: string[];
  };
}

export interface ExtractInput {
  intent: DiscoveryIntent;
  today: string;
  /** Resultados numerados (1…n) do lote; texto de terceiros, tratado como dado. */
  results: Array<{
    n: number;
    url: string;
    host: string;
    /** Categoria determinística do host (social, notícia, vaga…) ou null. */
    hostKind: string | null;
    title: string;
    snippet: string;
    publishedAt: string | null;
  }>;
}

/** Falha da IA local com o código do gateway (mensagem pt-BR em AI_ERROR_MESSAGES). */
export class DiscoveryAiError extends Error {
  constructor(readonly code: AiErrorCode) {
    super(code);
    this.name = 'DiscoveryAiError';
  }
}

export interface DiscoveryAi {
  /** Versões dos prompts (gravadas na pesquisa). */
  readonly promptIds: { interpreter: string; extractor: string };
  /** Lança DiscoveryAiError. Saída já validada (tolerante) pelo contrato. */
  interpret(input: InterpretInput, signal?: AbortSignal): Promise<InterpreterOutput>;
  extract(input: ExtractInput, signal?: AbortSignal): Promise<ExtractorOutput>;
}
