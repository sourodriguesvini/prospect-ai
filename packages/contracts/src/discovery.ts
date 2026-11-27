import { z } from 'zod';
import { Uuid } from './common';
import { UF } from './strategy';
import { WebSearchQuery, WebSearchTopic } from './web-research';

/**
 * Descoberta (F4, ADR-0013): pesquisa em linguagem natural que vira plano de buscas na internet,
 * empresas identificadas e deduplicadas, sinais comerciais com fonte e uma triagem inicial
 * explicada. A Descoberta encontra e pré-qualifica; o dossiê completo é do módulo Empresas.
 *
 * Regras que estes formatos sustentam:
 * - todo sinal tem fonte (URL), data da coleta e, quando há, data de publicação e do acontecimento
 *   (separadas: notícia antiga achada hoje não vira acontecimento recente);
 * - sinal "confirmado" só quando o trecho citado está na fonte e descreve o fato; o resto é
 *   hipótese a investigar;
 * - prioridade segue uma rubrica versionada (`discovery-triage/v1`) e a confiança da análise é
 *   mostrada à parte; nenhum número é probabilidade de contratação.
 */

const IsoDateTime = z.iso.datetime({ offset: true, error: 'Data e hora inválidas (ISO 8601).' });

// -----------------------------------------------------------------------------
// Sinais comerciais
// -----------------------------------------------------------------------------

export const SignalType = z.enum([
  'expansion',
  'hiring',
  'launch',
  'strategic_change',
  'investment',
  'brand_communication',
]);
export type SignalType = z.infer<typeof SignalType>;

export const SIGNAL_TYPE_LABELS: Record<SignalType, string> = {
  expansion: 'Expansão',
  hiring: 'Contratações e vagas',
  launch: 'Lançamento',
  strategic_change: 'Mudança estratégica',
  investment: 'Investimento',
  brand_communication: 'Comunicação e marca',
};

/** Exemplos do que cada tipo cobre (vão para o prompt e para a tela). */
export const SIGNAL_TYPE_HINTS: Record<SignalType, string> = {
  expansion:
    'novas unidades, novos mercados, ampliação da operação, novas regiões, portfólio maior',
  hiring:
    'vagas públicas de marketing, branding, comunicação, design, direção de marketing ou crescimento comercial',
  launch: 'produtos, serviços, linhas de negócio, novas marcas ou novas empresas',
  strategic_change:
    'reposicionamento anunciado, reestruturação, novo público, fusão, aquisição, nova liderança',
  investment: 'captação anunciada, novo projeto, investimento público, ampliação de operação',
  brand_communication:
    'site novo, mudança de comunicação, campanha institucional, nova identidade visual',
};

/** Serviços da agência a que um sinal pode se ligar (ofertas: identidade visual, rebranding, sites). */
export const ServiceHint = z.enum(['brand_identity', 'rebranding', 'website']);
export type ServiceHint = z.infer<typeof ServiceHint>;

export const SERVICE_HINT_LABELS: Record<ServiceHint, string> = {
  brand_identity: 'Identidade visual',
  rebranding: 'Rebranding',
  website: 'Site institucional',
};

export const SignalRelevance = z.enum(['high', 'medium', 'low']);
export type SignalRelevance = z.infer<typeof SignalRelevance>;

export const SIGNAL_RELEVANCE_LABELS: Record<SignalRelevance, string> = {
  high: 'Relevância alta',
  medium: 'Relevância média',
  low: 'Relevância baixa',
};

/** confirmed = o trecho na fonte descreve o fato; hypothesis = precisa de investigação. */
export const SignalVerification = z.enum(['confirmed', 'hypothesis']);
export type SignalVerification = z.infer<typeof SignalVerification>;

export const SIGNAL_VERIFICATION_LABELS: Record<SignalVerification, string> = {
  confirmed: 'Confirmado na fonte',
  hypothesis: 'Hipótese a investigar',
};

/** Atualidade do acontecimento, pela data do acontecimento ou, sem ela, da publicação. */
export const SignalRecency = z.enum(['recent', 'older', 'unknown']);
export type SignalRecency = z.infer<typeof SignalRecency>;

export const SIGNAL_RECENCY_LABELS: Record<SignalRecency, string> = {
  recent: 'Recente',
  older: 'Antigo',
  unknown: 'Data desconhecida',
};

/** Data parcial: dia, mês ou só ano (AAAA-MM-DD, AAAA-MM ou AAAA). */
export const PartialDate = z.string().regex(/^\d{4}(-(0[1-9]|1[0-2])(-(0[1-9]|[12]\d|3[01]))?)?$/, {
  error: 'Data parcial inválida.',
});
export type PartialDate = z.infer<typeof PartialDate>;

// -----------------------------------------------------------------------------
// Pedido, interpretação e plano
// -----------------------------------------------------------------------------

export const DiscoveryDepth = z.enum(['quick', 'standard', 'deep']);
export type DiscoveryDepth = z.infer<typeof DiscoveryDepth>;

export const DISCOVERY_DEPTH_LABELS: Record<DiscoveryDepth, string> = {
  quick: 'Rápida',
  standard: 'Padrão',
  deep: 'Aprofundada',
};

export const RegionScope = z.enum(['city', 'region', 'state', 'country', 'unspecified']);
export type RegionScope = z.infer<typeof RegionScope>;

export const DISCOVERY_REQUEST_MAX = 500;
export const DISCOVERY_MAX_QUANTITY = 50;

/** O que a tela (ou o Copiloto) manda. Só o texto é obrigatório; o resto são filtros opcionais. */
export const DiscoveryRequestInput = z.object({
  request: z
    .string({ error: 'Escreva o que você quer encontrar.' })
    .trim()
    .min(8, { error: 'Descreva um pouco mais o que você quer encontrar (mínimo de 8 letras).' })
    .max(DISCOVERY_REQUEST_MAX, {
      error: `Use no máximo ${DISCOVERY_REQUEST_MAX} caracteres.`,
    }),
  quantity: z
    .number()
    .int()
    .min(1)
    .max(DISCOVERY_MAX_QUANTITY, { error: `No máximo ${DISCOVERY_MAX_QUANTITY} empresas.` })
    .nullable()
    .default(null),
  depth: DiscoveryDepth.nullable().default(null),
  uf: UF.nullable().default(null),
  city: z
    .string()
    .trim()
    .max(80)
    .transform((value) => (value === '' ? null : value))
    .nullable()
    .default(null),
  /** ICP a usar na triagem; null = o sistema escolhe o ICP ativo mais adequado. */
  icpId: Uuid.nullable().default(null),
  signals: z.array(SignalType).max(6).default([]),
});
export type DiscoveryRequestInput = z.infer<typeof DiscoveryRequestInput>;
export type DiscoveryRequestDraft = z.input<typeof DiscoveryRequestInput>;

/** Intenção interpretada do pedido (modelo local + padrões do servidor). */
export const DiscoveryIntent = z.object({
  /** Uma frase pt-BR do que será buscado, para a tela. */
  summary: z.string().max(300),
  segment: z.string().max(120).nullable(),
  segmentTerms: z.array(z.string().max(60)).max(8),
  region: z.object({
    scope: RegionScope,
    cities: z.array(z.string().max(80)).max(10),
    ufs: z.array(UF).max(5),
    label: z.string().max(120).nullable(),
  }),
  sizeHint: z.string().max(80).nullable(),
  services: z.array(ServiceHint).max(3),
  signals: z.array(SignalType).max(6),
  quantity: z.number().int().min(1).max(DISCOVERY_MAX_QUANTITY),
  depth: DiscoveryDepth,
  constraints: z.array(z.string().max(160)).max(6),
  /** O que veio do pedido e o que foi preenchido por padrão (transparência). */
  defaultsApplied: z.array(z.string().max(160)).max(8),
});
export type DiscoveryIntent = z.infer<typeof DiscoveryIntent>;

export const DiscoveryQueryPurpose = z.enum(['companies', 'signals']);
export type DiscoveryQueryPurpose = z.infer<typeof DiscoveryQueryPurpose>;

export const DiscoveryQuery = z.object({
  text: WebSearchQuery,
  purpose: DiscoveryQueryPurpose,
  signal: SignalType.nullable(),
  topic: WebSearchTopic,
  timeRange: z.enum(['month', 'year']).nullable(),
});
export type DiscoveryQuery = z.infer<typeof DiscoveryQuery>;

export const DISCOVERY_MAX_QUERIES = 12;

export const DiscoveryPlan = z.object({
  queries: z.array(DiscoveryQuery).min(1).max(DISCOVERY_MAX_QUERIES),
});
export type DiscoveryPlan = z.infer<typeof DiscoveryPlan>;

/** Limites de uma execução (segurança econômica). */
export const DiscoveryLimits = z.object({
  /** Buscas na internet (1 crédito da Tavily cada; cache não gasta). */
  maxSearches: z.number().int().min(1).max(DISCOVERY_MAX_QUERIES),
  /** Páginas lidas para verificar sites (não gastam crédito, gastam tempo). */
  maxPages: z.number().int().min(0).max(12),
  /** Empresas analisadas por execução. */
  maxProspects: z.number().int().min(1).max(DISCOVERY_MAX_QUANTITY),
});
export type DiscoveryLimits = z.infer<typeof DiscoveryLimits>;

export const DISCOVERY_DEPTH_LIMITS: Record<DiscoveryDepth, DiscoveryLimits> = {
  quick: { maxSearches: 3, maxPages: 3, maxProspects: 15 },
  standard: { maxSearches: 6, maxPages: 6, maxProspects: 25 },
  deep: { maxSearches: 10, maxPages: 10, maxProspects: 40 },
};

// -----------------------------------------------------------------------------
// Execução (pesquisa)
// -----------------------------------------------------------------------------

/**
 * draft = preparada (pelo Copiloto) e esperando o usuário confirmar; queued/running = na fila ou
 * rodando em segundo plano; os três últimos são finais.
 */
export const DiscoveryRunStatus = z.enum([
  'draft',
  'queued',
  'running',
  'completed',
  'failed',
  'cancelled',
]);
export type DiscoveryRunStatus = z.infer<typeof DiscoveryRunStatus>;

export const DISCOVERY_RUN_STATUS_LABELS: Record<DiscoveryRunStatus, string> = {
  draft: 'Esperando confirmação',
  queued: 'Na fila',
  running: 'Pesquisando',
  completed: 'Concluída',
  failed: 'Falhou',
  cancelled: 'Cancelada',
};

export const DiscoveryStage = z.enum([
  'interpreting',
  'searching',
  'verifying',
  'qualifying',
  'done',
]);
export type DiscoveryStage = z.infer<typeof DiscoveryStage>;

export const DISCOVERY_STAGE_LABELS: Record<DiscoveryStage, string> = {
  interpreting: 'Entendendo o pedido e planejando as buscas',
  searching: 'Buscando na internet e identificando empresas',
  verifying: 'Conferindo sites e dados básicos',
  qualifying: 'Fazendo a triagem',
  done: 'Concluída',
};

export const DiscoveryTrigger = z.enum(['user', 'copilot', 'schedule', 'catch_up']);
export type DiscoveryTrigger = z.infer<typeof DiscoveryTrigger>;

export const DiscoveryFailure = z.enum([
  'search_not_configured',
  'search_disabled',
  'budget_exhausted',
  'quota_exceeded',
  'search_unavailable',
  'ai_unavailable',
  'ai_failed',
  'database_unavailable',
  'interrupted',
  'unexpected',
]);
export type DiscoveryFailure = z.infer<typeof DiscoveryFailure>;

export const DISCOVERY_FAILURE_MESSAGES: Record<DiscoveryFailure, string> = {
  search_not_configured:
    'A pesquisa na internet não está configurada: falta a chave da Tavily (TAVILY_API_KEY) em apps/web/.env.local. Nenhum resultado foi inventado.',
  search_disabled:
    'A pesquisa na internet está desligada nesta instalação (PROSPECTOR_WEB_SEARCH=off) ou o banco não está configurado.',
  budget_exhausted:
    'O orçamento de buscas do mês acabou (WEB_SEARCH_MONTHLY_CREDITS). O que já foi encontrado ficou salvo; novas buscas só no mês que vem.',
  quota_exceeded:
    'A Tavily recusou a busca: os créditos do plano gratuito acabaram. As buscas voltam quando os créditos renovarem.',
  search_unavailable:
    'O buscador não respondeu (fora do ar, lento ou sem internet). O que já foi encontrado ficou salvo; tente de novo mais tarde.',
  ai_unavailable:
    'A IA local (Ollama) não está respondendo. Abra o Ollama e tente de novo; nenhuma busca foi gasta antes de o pedido ser entendido.',
  ai_failed:
    'A IA local não conseguiu organizar os resultados desta vez. O que já foi encontrado ficou salvo; tente de novo.',
  database_unavailable: 'Não foi possível gravar no banco de dados. Tente de novo em instantes.',
  interrupted:
    'A pesquisa parou no meio várias vezes (app fechado ou erro inesperado) e não foi concluída. O que já foi encontrado ficou salvo; tente de novo: as buscas feitas nas últimas 24 horas não gastam crédito.',
  unexpected:
    'Algo deu errado nesta pesquisa. Tente de novo; se repetir, anote o código de rastreio.',
};

export const DiscoveryProgress = z.object({
  searchesPlanned: z.number().int().min(0),
  searchesDone: z.number().int().min(0),
  /** Créditos gastos nesta execução (buscas reaproveitadas não gastam). */
  creditsUsed: z.number().int().min(0),
  pagesRead: z.number().int().min(0),
  prospects: z.number().int().min(0),
  newProspects: z.number().int().min(0),
  signals: z.number().int().min(0),
});
export type DiscoveryProgress = z.infer<typeof DiscoveryProgress>;

export const EMPTY_DISCOVERY_PROGRESS: DiscoveryProgress = {
  searchesPlanned: 0,
  searchesDone: 0,
  creditsUsed: 0,
  pagesRead: 0,
  prospects: 0,
  newProspects: 0,
  signals: 0,
};

export const DiscoveryRun = z.object({
  id: Uuid,
  request: z.string().max(DISCOVERY_REQUEST_MAX),
  /** Filtros opcionais da tela, como foram pedidos. */
  options: DiscoveryRequestInput.omit({ request: true }),
  trigger: DiscoveryTrigger,
  monitorId: Uuid.nullable(),
  status: DiscoveryRunStatus,
  stage: DiscoveryStage.nullable(),
  intent: DiscoveryIntent.nullable(),
  plan: DiscoveryPlan.nullable(),
  limits: DiscoveryLimits,
  progress: DiscoveryProgress,
  /** Terminou com parte do plano feita (orçamento, buscador fora, cancelamento). */
  partial: z.boolean(),
  failureCode: DiscoveryFailure.nullable(),
  /** ICP e versões usadas na triagem (null = sem ICP aplicável). */
  icpId: Uuid.nullable(),
  icpVersionId: Uuid.nullable(),
  offerId: Uuid.nullable(),
  scoringModelVersionId: Uuid.nullable(),
  promptIds: z.array(z.string().max(60)).max(6),
  traceId: Uuid,
  isDemo: z.boolean(),
  createdAt: IsoDateTime,
  startedAt: IsoDateTime.nullable(),
  finishedAt: IsoDateTime.nullable(),
  cancelRequestedAt: IsoDateTime.nullable(),
});
export type DiscoveryRun = z.infer<typeof DiscoveryRun>;

/** Uma busca do plano e os resultados que ela trouxe (reaproveitados ao retomar). */
export const DiscoveryQueryResult = z.object({
  rank: z.number().int().min(1).max(50),
  url: z.httpUrl().max(2048),
  title: z.string().max(300),
  snippet: z.string().max(600),
  publishedAt: z.iso.date().nullable(),
});
export type DiscoveryQueryResult = z.infer<typeof DiscoveryQueryResult>;

export const DiscoveryRunQuery = z.object({
  runId: Uuid,
  position: z
    .number()
    .int()
    .min(0)
    .max(DISCOVERY_MAX_QUERIES - 1),
  query: DiscoveryQuery,
  status: z.enum(['done', 'failed']),
  results: z.array(DiscoveryQueryResult).max(10),
  creditsCharged: z.number().int().min(0),
  fetchedAt: IsoDateTime,
  /** Código da falha do buscador, quando falhou. */
  failure: z.string().max(40).nullable(),
});
export type DiscoveryRunQuery = z.infer<typeof DiscoveryRunQuery>;

// -----------------------------------------------------------------------------
// Empresas encontradas (deduplicadas entre pesquisas)
// -----------------------------------------------------------------------------

export const ProspectStatus = z.enum(['new', 'saved', 'investigating', 'dismissed']);
export type ProspectStatus = z.infer<typeof ProspectStatus>;

export const PROSPECT_STATUS_LABELS: Record<ProspectStatus, string> = {
  new: 'Nova',
  saved: 'Salva',
  investigating: 'Em investigação',
  dismissed: 'Ignorada',
};

export const PriorityBand = z.enum(['high', 'medium', 'low', 'insufficient']);
export type PriorityBand = z.infer<typeof PriorityBand>;

export const PRIORITY_BAND_LABELS: Record<PriorityBand, string> = {
  high: 'Alta prioridade',
  medium: 'Média prioridade',
  low: 'Baixa prioridade',
  insufficient: 'Informações insuficientes',
};

export const AnalysisConfidence = z.enum(['high', 'medium', 'low']);
export type AnalysisConfidence = z.infer<typeof AnalysisConfidence>;

export const ANALYSIS_CONFIDENCE_LABELS: Record<AnalysisConfidence, string> = {
  high: 'Confiança alta',
  medium: 'Confiança média',
  low: 'Confiança baixa',
};

/** Rubrica da triagem: versão nova = arquivo e regras novos (`@prospector/domain`). */
export const DISCOVERY_TRIAGE_RUBRIC = 'discovery-triage/v1';

export const TriageDimension = z.enum(['fit', 'signal', 'timing', 'capacity']);
export type TriageDimension = z.infer<typeof TriageDimension>;

export const TRIAGE_DIMENSION_LABELS: Record<TriageDimension, string> = {
  fit: 'Aderência ao perfil',
  signal: 'Sinais comerciais',
  timing: 'Atualidade',
  capacity: 'Porte e capacidade',
};

export const TriageReason = z.object({
  text: z.string().max(300),
  /** Fontes que sustentam o motivo (ids de `discovery_sources`); vazio = regra do sistema. */
  sourceIds: z.array(Uuid).max(10),
});
export type TriageReason = z.infer<typeof TriageReason>;

export const ProspectAssessment = z.object({
  rubric: z.literal(DISCOVERY_TRIAGE_RUBRIC),
  /** Pontos de 0 a 100 por dimensão; null = sem evidência para avaliar. */
  dimensions: z.record(TriageDimension, z.number().int().min(0).max(100).nullable()),
  /** Pesos usados (do modelo de score da oferta; "need" fica para o diagnóstico em Empresas). */
  weights: z.record(TriageDimension, z.number().min(0).max(1)),
  /** Dimensões com evidência / dimensões avaliáveis. */
  coverage: z.number().min(0).max(1),
  reasons: z.array(TriageReason).max(8),
  /** O que falta saber (vira o próximo passo da investigação). */
  missing: z.array(z.string().max(200)).max(6),
  /** Bloqueios: exclusão do ICP, cliente atual, empresa arquivada. */
  gates: z.array(z.string().max(200)).max(4),
  icpVersionId: Uuid.nullable(),
  scoringModelVersionId: Uuid.nullable(),
  assessedAt: IsoDateTime,
});
export type ProspectAssessment = z.infer<typeof ProspectAssessment>;

export const Prospect = z.object({
  id: Uuid,
  /** Chave de deduplicação: `domain:<host>` ou `name:<nome normalizado>|<cidade>|<uf>`. */
  dedupeKey: z.string().min(3).max(300),
  displayName: z.string().min(1).max(160),
  domain: z.string().max(253).nullable(),
  websiteUrl: z.httpUrl().max(2048).nullable(),
  segment: z.string().max(120).nullable(),
  city: z.string().max(120).nullable(),
  uf: UF.nullable(),
  /** Resumo gerado a partir das fontes (não é evidência). */
  description: z.string().max(400).nullable(),
  /** CNPJ achado no site oficial (conferido pelos dígitos), quando houver. */
  cnpj: z
    .string()
    .regex(/^[0-9A-Z]{14}$/)
    .nullable(),
  /** Empresa do módulo Empresas ligada a este resultado (mesmo domínio ou CNPJ, ou investigada). */
  companyId: Uuid.nullable(),
  status: ProspectStatus,
  dismissedReason: z.string().max(200).nullable(),
  priority: PriorityBand,
  /** Pontos da rubrica (0–100); não é probabilidade. null = informações insuficientes. */
  priorityScore: z.number().int().min(0).max(100).nullable(),
  confidence: AnalysisConfidence,
  assessment: ProspectAssessment.nullable(),
  /** O site oficial foi lido e confere com o nome. */
  siteVerified: z.boolean(),
  firstSeenAt: IsoDateTime,
  lastSeenAt: IsoDateTime,
  lastVerifiedAt: IsoDateTime.nullable(),
  firstRunId: Uuid,
  lastRunId: Uuid,
  isDemo: z.boolean(),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type Prospect = z.infer<typeof Prospect>;

/** Papel da fonte para a empresa. */
export const ProspectSourceRelation = z.enum([
  'official_site',
  'mention',
  'directory',
  'news',
  'job_post',
]);
export type ProspectSourceRelation = z.infer<typeof ProspectSourceRelation>;

export const PROSPECT_SOURCE_RELATION_LABELS: Record<ProspectSourceRelation, string> = {
  official_site: 'Site oficial',
  mention: 'Menção',
  directory: 'Guia ou diretório',
  news: 'Notícia',
  job_post: 'Anúncio de vaga',
};

/** Trecho guardado de cada fonte: curto, com prazo de guarda (ADR-0012). */
export const DISCOVERY_SNIPPET_MAX = 300;

export const ProspectSource = z.object({
  id: Uuid,
  prospectId: Uuid,
  runId: Uuid,
  url: z.httpUrl().max(2048),
  host: z.string().max(253),
  title: z.string().max(300).nullable(),
  snippet: z.string().max(DISCOVERY_SNIPPET_MAX),
  kind: z.enum(['search_result', 'web_page']),
  relation: ProspectSourceRelation,
  provider: z.string().max(40),
  publishedAt: z.iso.date().nullable(),
  capturedAt: IsoDateTime,
  retentionUntil: IsoDateTime,
});
export type ProspectSource = z.infer<typeof ProspectSource>;

export const ProspectSignal = z.object({
  id: Uuid,
  prospectId: Uuid,
  runId: Uuid,
  sourceId: Uuid,
  type: SignalType,
  /** Descrição objetiva (frase do sistema/modelo, não é citação). */
  summary: z.string().min(1).max(300),
  /** Trecho literal da fonte que sustenta o sinal (conferido no servidor). */
  quote: z.string().min(1).max(DISCOVERY_SNIPPET_MAX),
  eventDate: PartialDate.nullable(),
  publishedAt: z.iso.date().nullable(),
  discoveredAt: IsoDateTime,
  verification: SignalVerification,
  /** Confiança calculada no servidor (fonte, conferência do trecho e atualidade), de 0 a 1. */
  confidence: z.number().min(0).max(1),
  relevance: SignalRelevance,
  relatedService: ServiceHint.nullable(),
  /** Por que o sinal pode ou não ser relevante para a agência. */
  rationale: z.string().max(400),
  recency: SignalRecency,
  /** Mesmo acontecimento = mesma impressão digital (não aparece de novo como novidade). */
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  createdAt: IsoDateTime,
});
export type ProspectSignal = z.infer<typeof ProspectSignal>;

export const ProspectListFilter = z.object({
  runId: Uuid.nullable().default(null),
  status: z.array(ProspectStatus).max(4).default([]),
  priority: z.array(PriorityBand).max(4).default([]),
  signalType: SignalType.nullable().default(null),
  /** Só as vistas pela primeira vez desde esta data (novidades). */
  firstSeenSince: IsoDateTime.nullable().default(null),
  includeDismissed: z.boolean().default(false),
  limit: z.number().int().min(1).max(100).default(30),
});
export type ProspectListFilter = z.infer<typeof ProspectListFilter>;
export type ProspectListFilterDraft = z.input<typeof ProspectListFilter>;

export const ProspectDecisionInput = z.object({
  prospectId: Uuid,
  status: z.enum(['saved', 'dismissed', 'new']),
  reason: z
    .string()
    .trim()
    .max(200)
    .transform((value) => (value === '' ? null : value))
    .nullable()
    .default(null),
});
export type ProspectDecisionInput = z.infer<typeof ProspectDecisionInput>;

// -----------------------------------------------------------------------------
// Monitoramentos
// -----------------------------------------------------------------------------

export const MonitorFrequency = z.enum(['daily', 'every_3_days', 'weekly']);
export type MonitorFrequency = z.infer<typeof MonitorFrequency>;

export const MONITOR_FREQUENCY_LABELS: Record<MonitorFrequency, string> = {
  daily: 'Todo dia',
  every_3_days: 'A cada 3 dias',
  weekly: 'Toda semana',
};

export const MONITOR_FREQUENCY_HOURS: Record<MonitorFrequency, number> = {
  daily: 24,
  every_3_days: 72,
  weekly: 168,
};

export const MonitorStatus = z.enum(['active', 'paused', 'archived']);
export type MonitorStatus = z.infer<typeof MonitorStatus>;

export const MONITOR_STATUS_LABELS: Record<MonitorStatus, string> = {
  active: 'Ativo',
  paused: 'Pausado',
  archived: 'Arquivado',
};

export const MonitorInput = z.object({
  name: z
    .string({ error: 'Dê um nome ao monitoramento.' })
    .trim()
    .min(3, { error: 'Dê um nome ao monitoramento (mínimo de 3 letras).' })
    .max(120, { error: 'Use no máximo 120 caracteres.' }),
  request: DiscoveryRequestInput.shape.request,
  frequency: MonitorFrequency.default('daily'),
  /** Buscas por execução (cada uma pode gastar 1 crédito). */
  maxSearches: z.number().int().min(1).max(6).default(3),
  /** Empresas analisadas por execução. */
  maxProspects: z.number().int().min(1).max(30).default(15),
  icpId: Uuid.nullable().default(null),
});
export type MonitorInput = z.infer<typeof MonitorInput>;
export type MonitorInputDraft = z.input<typeof MonitorInput>;

export const DiscoveryMonitor = z.object({
  id: Uuid,
  name: z.string().max(120),
  request: z.string().max(DISCOVERY_REQUEST_MAX),
  frequency: MonitorFrequency,
  status: MonitorStatus,
  maxSearches: z.number().int().min(1).max(6),
  maxProspects: z.number().int().min(1).max(30),
  icpId: Uuid.nullable(),
  nextRunAt: IsoDateTime.nullable(),
  lastRunAt: IsoDateTime.nullable(),
  lastRunId: Uuid.nullable(),
  /** Execuções que não aconteceram com o computador desligado (recuperadas numa só). */
  missedRuns: z.number().int().min(0),
  isDemo: z.boolean(),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type DiscoveryMonitor = z.infer<typeof DiscoveryMonitor>;

// -----------------------------------------------------------------------------
// Saídas estruturadas do modelo local (validadas no servidor; nada aqui é confiável sozinho)
// -----------------------------------------------------------------------------

const ModelText = (max: number) =>
  z
    .string()
    .transform((value) => value.replace(/\s+/g, ' ').trim().slice(0, max))
    .nullable()
    .catch(null);

const ModelList = <T extends z.ZodType>(item: T, max: number) =>
  z
    .array(z.unknown())
    .catch([])
    .transform((items) =>
      items
        .map((value) => item.safeParse(value))
        .filter((parsed) => parsed.success)
        .map((parsed) => parsed.data as z.output<T>)
        .slice(0, max),
    );

/**
 * Resposta do intérprete (`prompts/discovery-interpreter/vN.md`). Tolerante: campo ruim vira
 * vazio em vez de derrubar a pesquisa; o servidor completa com padrões e valida o plano.
 */
export const InterpreterOutput = z.object({
  summary: ModelText(300),
  segment: ModelText(120),
  segmentTerms: ModelList(z.string().trim().min(2).max(60), 8),
  cities: ModelList(z.string().trim().min(2).max(80), 10),
  ufs: ModelList(UF, 5),
  regionScope: RegionScope.catch('unspecified'),
  sizeHint: ModelText(80),
  services: ModelList(ServiceHint, 3),
  signals: ModelList(SignalType, 6),
  quantity: z.number().int().min(1).max(DISCOVERY_MAX_QUANTITY).nullable().catch(null),
  constraints: ModelList(z.string().trim().min(2).max(160), 6),
  queries: ModelList(
    z.object({
      text: z.string().trim().min(3).max(300),
      purpose: DiscoveryQueryPurpose.catch('companies'),
      signal: SignalType.nullable().catch(null),
      recent: z.boolean().catch(false),
    }),
    DISCOVERY_MAX_QUERIES,
  ),
});
export type InterpreterOutput = z.output<typeof InterpreterOutput>;

/** Tipo de página de um resultado de busca, segundo o extrator. */
export const ResultKind = z.enum(['company_site', 'directory', 'news', 'job_post', 'other']);
export type ResultKind = z.infer<typeof ResultKind>;

/**
 * Resposta do extrator (`prompts/discovery-extractor/vN.md`) para um lote de resultados de busca.
 * `result` é o número do resultado no lote; o servidor confere que existe, que o trecho citado
 * está no texto e que o site oficial não é portal, rede social ou diretório.
 */
export const ExtractorOutput = z.object({
  results: ModelList(
    z.object({
      result: z.number().int().min(1).max(50),
      kind: ResultKind.catch('other'),
    }),
    50,
  ),
  companies: ModelList(
    z.object({
      result: z.number().int().min(1).max(50),
      name: z.string().trim().min(2).max(160),
      officialSite: z.boolean().catch(false),
      city: ModelText(80),
      uf: UF.nullable().catch(null),
      segment: ModelText(120),
      description: ModelText(400),
    }),
    40,
  ),
  signals: ModelList(
    z.object({
      result: z.number().int().min(1).max(50),
      company: z.string().trim().min(2).max(160),
      type: SignalType,
      summary: z.string().trim().min(3).max(300),
      quote: z.string().trim().min(3).max(DISCOVERY_SNIPPET_MAX),
      eventDate: PartialDate.nullable().catch(null),
      explicit: z.boolean().catch(false),
      relevance: SignalRelevance.catch('low'),
      service: ServiceHint.nullable().catch(null),
      rationale: ModelText(400),
    }),
    40,
  ),
});
export type ExtractorOutput = z.output<typeof ExtractorOutput>;
