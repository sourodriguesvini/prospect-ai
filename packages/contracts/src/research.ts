import { z } from 'zod';
import { AudienceRole } from './commercial';
import { Uuid } from './common';
import { LiaDataSource, UF } from './strategy';

/**
 * Pesquisa extensa do Copiloto (diretriz de 2026-11-26, Partes 6.3 a 6.5; migração
 * `20261127120000_copilot_research`). Um pedido como "100 terapeutas ocupacionais no Brasil para
 * apresentar a Blummy" vira uma pesquisa ligada à conversa, com critérios, plano de buscas,
 * progresso e resultados guardados. Uma mudança pedida depois ("agora priorize SP e MG") ajusta a
 * mesma pesquisa sem refazer o que já foi achado. Nada aqui contata ninguém.
 */

const IsoDateTime = z.iso.datetime({ offset: true, error: 'Data e hora inválidas (ISO 8601).' });

export const RESEARCH_MAX_COUNT = 500;
export const RESEARCH_MAX_CREDITS = 300;

export const ResearchEntityKind = z.enum(['person', 'organization']);
export type ResearchEntityKind = z.infer<typeof ResearchEntityKind>;

/** Para o perfil: quem usa, quem compra, quem influencia (Parte 6.5); "a conferir" na dúvida. */
export const ResearchAudienceRole = z.enum([...AudienceRole.options, 'unknown']);
export type ResearchAudienceRole = z.infer<typeof ResearchAudienceRole>;
export const RESEARCH_AUDIENCE_LABELS: Record<ResearchAudienceRole, string> = {
  user: 'Usuário potencial',
  buyer: 'Comprador',
  influencer: 'Influenciador',
  unknown: 'A conferir',
};

export const ResearchSegment = z.enum([
  'independent_professional',
  'clinic',
  'manager',
  'employed_professional',
  'organization',
  'unknown',
]);
export type ResearchSegment = z.infer<typeof ResearchSegment>;
export const RESEARCH_SEGMENT_LABELS: Record<ResearchSegment, string> = {
  independent_professional: 'Profissional independente',
  clinic: 'Clínica',
  manager: 'Gestor ou sócio',
  employed_professional: 'Profissional em organização',
  organization: 'Organização',
  unknown: 'A conferir',
};

/**
 * De onde veio a pessoa: o mesmo vocabulário da LIA (a cobertura compara os dois). O trecho do
 * buscador num diretório profissional é `professional_directory`; o resto, `search_result`.
 */
export const ResearchSourceKind = LiaDataSource.extract([
  'professional_directory',
  'search_result',
]);
export type ResearchSourceKind = z.infer<typeof ResearchSourceKind>;

/** Por que um resultado de busca não virou item (contado em `progress.discarded`). */
export const ResearchDiscardReason = z.enum([
  'duplicate',
  'suppressed',
  'opted_out',
  'restricted_host',
  'listing',
  'no_profession',
  'no_name',
  'out_of_region',
  'invalid',
]);
export type ResearchDiscardReason = z.infer<typeof ResearchDiscardReason>;
export const RESEARCH_DISCARD_LABELS: Record<ResearchDiscardReason, string> = {
  duplicate: 'repetidos',
  suppressed: 'na lista de quem pediu para não ser contatado',
  opted_out: 'que já tinham pedido opt-out nesta pesquisa',
  restricted_host: 'de redes sociais, agregadores de dados ou sites que não permitem coleta',
  listing: 'listas de "melhores" sem nome de alguém',
  no_profession: 'sem a profissão no trecho',
  no_name: 'sem nome identificável',
  out_of_region: 'fora da região pedida',
  invalid: 'com dado recusado na conferência',
};

/** Onde a cidade foi conferida: no trecho da fonte, só pela busca daquela região, ou em nenhum. */
export const ResearchLocationBasis = z.enum(['quote', 'query', 'none']);
export type ResearchLocationBasis = z.infer<typeof ResearchLocationBasis>;

const Term = z.string().trim().min(2).max(80);

/**
 * Critérios da pesquisa (coluna `criteria`, até 8 KB). As consultas saem daqui: profissão (e as
 * variações) por região, nunca pelo nome de uma pessoa.
 */
export const ResearchCriteria = z.object({
  /** Profissão ou segmento como a pessoa pediu ("terapeutas ocupacionais"). */
  profession: Term,
  /** Variações usadas nas consultas (singular, com e sem acento, "clínica de …"). */
  terms: z.array(Term).min(1).max(6),
  entityKinds: z.array(ResearchEntityKind).min(1).max(2),
  /** Vazio = Brasil inteiro. */
  ufs: z.array(UF).max(27),
  /** UFs que vão primeiro no plano ("agora priorize SP e MG"). */
  priorityUfs: z.array(UF).max(27),
  cities: z.array(z.string().trim().min(2).max(80)).max(20),
  /** Premissas adotadas sem perguntar (Parte 6.6), para a tela mostrar. */
  assumptions: z.array(z.string().trim().min(3).max(240)).max(8),
});
export type ResearchCriteria = z.infer<typeof ResearchCriteria>;

export const ResearchQueryStatus = z.enum(['pending', 'done', 'failed', 'skipped']);
export type ResearchQueryStatus = z.infer<typeof ResearchQueryStatus>;

export const ResearchQuery = z.object({
  index: z.number().int().min(0).max(999),
  query: z.string().trim().min(3).max(300),
  uf: UF.nullable(),
  city: z.string().max(80).nullable(),
  status: ResearchQueryStatus,
  results: z.number().int().min(0).max(50).default(0),
  added: z.number().int().min(0).max(50).default(0),
});
export type ResearchQuery = z.infer<typeof ResearchQuery>;

/** Plano de buscas (coluna `plan`, até 64 KB). */
export const ResearchPlan = z.object({
  queries: z.array(ResearchQuery).max(400),
});
export type ResearchPlan = z.infer<typeof ResearchPlan>;

/** Contagens e créditos (coluna `progress`, até 4 KB). */
export const ResearchProgress = z.object({
  batches: z.number().int().min(0).default(0),
  queriesDone: z.number().int().min(0).default(0),
  creditsUsed: z.number().int().min(0).default(0),
  people: z.number().int().min(0).default(0),
  organizations: z.number().int().min(0).default(0),
  /** Descartados, por motivo (`ResearchDiscardReason`; chave desconhecida de versão antiga é lida). */
  discarded: z.record(z.string().max(40), z.number().int().min(0)).default({}),
  /** Pessoas achadas que não foram guardadas (sem chave de deduplicação configurada). */
  peopleNotStored: z.number().int().min(0).default(0),
  /**
   * A chave das pessoas deste computador não é a que gravou as pessoas no banco (arquivo trocado ou
   * perdido): ninguém é guardado até a chave certa voltar, senão a supressão deixaria de valer.
   */
  keyMismatch: z.boolean().default(false),
  /** Causa da última falha da busca (texto do provedor, sem dado de pessoa). */
  lastError: z.string().max(240).nullable().default(null),
});
export type ResearchProgress = z.infer<typeof ResearchProgress>;

export const ResearchRevision = z.object({
  at: IsoDateTime,
  request: z.string().trim().min(1).max(500),
  /** O que mudou, em uma frase (para a tela e o histórico). */
  change: z.string().trim().min(3).max(240),
});
export type ResearchRevision = z.infer<typeof ResearchRevision>;

export const ResearchStatus = z.enum([
  'queued',
  'running',
  'paused',
  'done',
  'failed',
  'cancelled',
]);
export type ResearchStatus = z.infer<typeof ResearchStatus>;
export const RESEARCH_STATUS_LABELS: Record<ResearchStatus, string> = {
  queued: 'Na fila',
  running: 'Pesquisando',
  paused: 'Pausada',
  done: 'Concluída',
  failed: 'Com falha',
  cancelled: 'Cancelada',
};

/** Por que a pesquisa parou (antes ou ao atingir a quantidade). */
export const ResearchStopReason = z.enum([
  'count_reached',
  'credit_cap',
  'budget_exhausted',
  'sources_exhausted',
  'search_unavailable',
  'cancelled',
]);
export type ResearchStopReason = z.infer<typeof ResearchStopReason>;
export const RESEARCH_STOP_LABELS: Record<ResearchStopReason, string> = {
  count_reached: 'A quantidade pedida foi atingida.',
  credit_cap: 'O teto de buscas desta pesquisa acabou antes da quantidade pedida.',
  budget_exhausted: 'O orçamento de buscas do mês acabou (plano gratuito da Tavily).',
  sources_exhausted:
    'As buscas planejadas terminaram antes da quantidade pedida: as fontes públicas não trouxeram mais resultados novos.',
  search_unavailable:
    'A pesquisa na internet ficou indisponível (desligada, sem chave ou fora do ar).',
  cancelled: 'A pesquisa foi cancelada.',
};

/** A pesquisa como o app a mostra. */
export const CopilotResearch = z.object({
  id: Uuid,
  threadId: Uuid,
  profileKey: z.string(),
  profileName: z.string(),
  request: z.string(),
  objective: z.string(),
  audience: z.string(),
  criteria: ResearchCriteria,
  requestedCount: z.number().int().min(1).max(RESEARCH_MAX_COUNT),
  foundCount: z.number().int().min(0),
  status: ResearchStatus,
  stopReason: ResearchStopReason.nullable(),
  plan: ResearchPlan,
  progress: ResearchProgress,
  revisions: z.array(ResearchRevision),
  version: z.number().int().min(1),
  /** Sobe em toda gravação (concorrência); `version` sobe só com mudança pedida pela pessoa. */
  rowVersion: z.number().int().min(1),
  creditCap: z.number().int().min(1).max(RESEARCH_MAX_CREDITS),
  traceId: Uuid,
  isDemo: z.boolean(),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  finishedAt: IsoDateTime.nullable(),
  retentionUntil: IsoDateTime,
});
export type CopilotResearch = z.infer<typeof CopilotResearch>;

/**
 * Um resultado como a tela de revisão mostra. Pessoa: os dados vêm de `people` (origem, base
 * legal, prazo e opt-out ficam lá); organização: do próprio item.
 */
export const ResearchItemView = z.object({
  id: Uuid,
  kind: ResearchEntityKind,
  personId: Uuid.nullable(),
  name: z.string(),
  profession: z.string().nullable(),
  roleTitle: z.string().nullable(),
  organization: z.string().nullable(),
  city: z.string().nullable(),
  uf: UF.nullable(),
  website: z.httpUrl().nullable(),
  profileUrl: z.httpUrl().nullable(),
  publicEmail: z.string().nullable(),
  publicPhone: z.string().nullable(),
  sourceUrl: z.httpUrl(),
  sourceQuote: z.string(),
  verifiedAt: IsoDateTime,
  audienceRole: ResearchAudienceRole,
  segment: ResearchSegment,
  fitReason: z.string(),
  locationBasis: ResearchLocationBasis,
  queryIndex: z.number().int().nullable(),
  rank: z.number().int(),
  /** Versão da LIA gravada com a pessoa (null = nenhuma cobria a linha na hora). */
  liaVersion: z.number().int().min(1).nullable(),
  /**
   * Coberta pela LIA em vigor hoje (aprovada, não revogada, revisão em dia, mesma versão gravada) e
   * sem opt-out. O serviço confere de novo a cada leitura (KI-214); organização: sem supressão.
   */
  approachable: z.boolean(),
  optedOut: z.boolean(),
  /** Até quando a linha fica guardada (pessoa: `people.retention_until`). */
  retentionUntil: IsoDateTime,
});
export type ResearchItemView = z.infer<typeof ResearchItemView>;

// -----------------------------------------------------------------------------
// Entradas
// -----------------------------------------------------------------------------

/** Pedido de pesquisa já interpretado (pela regra ou pela ferramenta do Copiloto). */
export const StartResearchInput = z.object({
  threadId: Uuid,
  request: z.string().trim().min(3).max(1000),
});
export type StartResearchInput = z.infer<typeof StartResearchInput>;

export const ReviseResearchInput = z.object({
  researchId: Uuid,
  request: z.string().trim().min(1).max(500),
});
export type ReviseResearchInput = z.infer<typeof ReviseResearchInput>;

export const ResearchRef = z.object({ researchId: Uuid });
export type ResearchRef = z.infer<typeof ResearchRef>;

/** Um resultado da pesquisa (opt-out registrado pela tela). */
export const ResearchItemRef = z.object({ researchId: Uuid, itemId: Uuid });
export type ResearchItemRef = z.infer<typeof ResearchItemRef>;
