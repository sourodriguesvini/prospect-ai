import { z } from 'zod';
import { Uuid } from './common';
import { ClaimKey } from './evidence';

/**
 * Investigação de empresas e Brand Intelligence (módulo Empresas, ADR-0015). Uma investigação é
 * uma execução com etapas idempotentes: coleta (site, páginas, capturas, sinais, concorrentes),
 * análises com a IA local e consolidação. As CONCLUSÕES nunca ficam aqui: viram claims no
 * Evidence Ledger (`evidence.ts`). Este registro guarda o estado da execução, o consumo, os
 * modelos usados, as mudanças detectadas e a composição do diagnóstico (ids de claims, notas
 * determinísticas e a recomendação), para a tela e o Copiloto.
 */

const IsoDateTime = z.iso.datetime({ offset: true, error: 'Data e hora inválidas (ISO 8601).' });

/** Versão do processo de investigação (etapas, limites e regras). Sobe quando muda o resultado. */
export const INVESTIGATION_PIPELINE_VERSION = 1;

// -----------------------------------------------------------------------------
// Execução
// -----------------------------------------------------------------------------

/**
 * `partial`: terminou com parte das etapas sem resultado (site fora do ar, IA indisponível), mas
 * com o suficiente para um diagnóstico honesto. `interrupted`: o processo do servidor parou no
 * meio (reinício); pode ser retomada sem repetir as etapas concluídas.
 */
export const InvestigationStatus = z.enum([
  'queued',
  'running',
  'succeeded',
  'partial',
  'failed',
  'cancelled',
  'interrupted',
]);
export type InvestigationStatus = z.infer<typeof InvestigationStatus>;

export const INVESTIGATION_STATUS_LABELS: Record<InvestigationStatus, string> = {
  queued: 'Na fila',
  running: 'Investigando',
  succeeded: 'Concluída',
  partial: 'Concluída com lacunas',
  failed: 'Falhou',
  cancelled: 'Cancelada',
  interrupted: 'Interrompida',
};

/** Estados em que a investigação ainda vai andar sozinha. */
export const ACTIVE_INVESTIGATION_STATUSES: readonly InvestigationStatus[] = ['queued', 'running'];

/** Na ordem de execução: as duas análises da IA ficam juntas (mesmo modelo carregado). */
export const InvestigationStepKey = z.enum([
  'context',
  'site',
  'pages',
  'capture',
  'business_analysis',
  'visual_analysis',
  'signals',
  'competitors',
  'competitive_analysis',
  'diagnosis',
  'qualification',
]);
export type InvestigationStepKey = z.infer<typeof InvestigationStepKey>;
export const INVESTIGATION_STEPS = InvestigationStepKey.options;

export const INVESTIGATION_STEP_LABELS: Record<InvestigationStepKey, string> = {
  context: 'Reunir o que já sabemos',
  site: 'Identificar o site oficial',
  pages: 'Ler as páginas do site',
  capture: 'Capturar a marca (computador e celular)',
  business_analysis: 'Analisar o negócio',
  visual_analysis: 'Auditar a marca',
  signals: 'Procurar sinais recentes',
  competitors: 'Encontrar concorrentes',
  competitive_analysis: 'Comparar com concorrentes',
  diagnosis: 'Montar o diagnóstico',
  qualification: 'Avaliar ofertas e prioridade',
};

/** `reused`: dados ainda válidos de investigação anterior, sem nova coleta nem nova inferência. */
export const InvestigationStepState = z.enum([
  'pending',
  'running',
  'done',
  'reused',
  'skipped',
  'failed',
]);
export type InvestigationStepState = z.infer<typeof InvestigationStepState>;

/** Motivo estável de etapa pulada ou com falha (a tela traduz). */
export const InvestigationIssueCode = z.enum([
  'no_site',
  'site_unreachable',
  'site_blocked',
  'search_unavailable',
  'search_budget',
  'reader_unavailable',
  'capture_unavailable',
  'capture_storage_missing',
  'ai_unavailable',
  'ai_invalid_output',
  'no_competitors',
  'not_enough_evidence',
  'no_offers',
  'company_archived',
  'cancelled',
  'unexpected',
]);
export type InvestigationIssueCode = z.infer<typeof InvestigationIssueCode>;

export const INVESTIGATION_ISSUE_MESSAGES: Record<InvestigationIssueCode, string> = {
  no_site:
    'A empresa não tem site confirmado. Confirme um dos candidatos ou informe o site para a investigação ler as páginas e capturar a marca.',
  site_unreachable:
    'O site não respondeu nesta coleta. Isso pode ser temporário: nada foi concluído a partir da falha.',
  site_blocked:
    'O site não pode ser lido automaticamente (robots.txt, login ou pedido para não ser usado com IA). O Prospector respeita o bloqueio.',
  search_unavailable: 'A pesquisa na internet não está disponível agora.',
  search_budget:
    'O orçamento de pesquisas do mês acabou; a etapa usou só o que já estava guardado.',
  reader_unavailable: 'O leitor de páginas está desligado ou indisponível.',
  capture_unavailable:
    'A captura de telas não está disponível (navegador não encontrado ou falhou).',
  capture_storage_missing:
    'A pasta das capturas não está configurada (PROSPECTOR_CAPTURES_DIR). As imagens foram analisadas nesta investigação, mas não ficaram guardadas: uma nova auditoria precisa capturar de novo.',
  ai_unavailable: 'A IA local não respondeu (Ollama fora do ar, ocupado ou sem memória de vídeo).',
  ai_invalid_output:
    'A IA respondeu fora do formato combinado; nenhuma conclusão dela foi aproveitada nesta etapa.',
  no_competitors: 'Nenhum concorrente verificável apareceu na pesquisa.',
  not_enough_evidence: 'Não há evidência suficiente para concluir esta parte.',
  no_offers: 'Nenhuma oferta ativa cadastrada em Estratégia para comparar.',
  company_archived:
    'A empresa foi arquivada antes de a investigação começar: nada foi coletado. Reative a empresa para investigar.',
  cancelled: 'Cancelada a pedido.',
  unexpected: 'Erro inesperado nesta etapa.',
};

export const InvestigationStep = z.object({
  key: InvestigationStepKey,
  state: InvestigationStepState,
  startedAt: IsoDateTime.nullable().default(null),
  finishedAt: IsoDateTime.nullable().default(null),
  issue: InvestigationIssueCode.nullable().default(null),
  /** Contagens da etapa (páginas lidas, claims gravados…), para a tela e o histórico. */
  counts: z.record(z.string().max(40), z.number().int().min(0)).default({}),
});
export type InvestigationStep = z.infer<typeof InvestigationStep>;

/** Como a investigação começou. */
export const InvestigationTrigger = z.enum(['user', 'copilot', 'discovery']);
export type InvestigationTrigger = z.infer<typeof InvestigationTrigger>;

/** Recursos gastos: o usuário vê o custo real de cada investigação. */
export const InvestigationUsage = z.object({
  searches: z.number().int().min(0).default(0),
  /** Créditos da Tavily gastos (0 quando veio do cache). */
  searchCredits: z.number().int().min(0).default(0),
  pagesRead: z.number().int().min(0).default(0),
  captures: z.number().int().min(0).default(0),
  captureBytes: z.number().int().min(0).default(0),
  modelCalls: z.number().int().min(0).default(0),
  /** Tempo total de geração na GPU, em milissegundos. */
  modelMs: z.number().int().min(0).default(0),
});
export type InvestigationUsage = z.infer<typeof InvestigationUsage>;

/** Modelo e versão de prompt usados em cada análise (rastreabilidade da conclusão). */
export const InvestigationModelUse = z.object({
  agent: z.string().regex(/^[a-z][a-z0-9-]{1,40}$/),
  model: z.string().min(1).max(120),
  promptVersion: z.string().min(1).max(60),
});
export type InvestigationModelUse = z.infer<typeof InvestigationModelUse>;

// -----------------------------------------------------------------------------
// Mudanças entre investigações (§16 da especificação)
// -----------------------------------------------------------------------------

export const InvestigationChangeKind = z.enum([
  'site_changed',
  'page_added',
  'page_missing',
  'offering_added',
  'offering_missing',
  'communication_changed',
  'visual_changed',
  'new_signal',
  'competitor_added',
  /** Página ou site fora do ar NESTA coleta: registrado, nunca tratado como mudança definitiva. */
  'temporarily_unavailable',
]);
export type InvestigationChangeKind = z.infer<typeof InvestigationChangeKind>;

export const InvestigationChange = z.object({
  kind: InvestigationChangeKind,
  /** Texto montado pelo sistema (nunca pelo modelo), com o que mudou. */
  text: z.string().min(1).max(300),
  claimIds: z.array(Uuid).max(8).default([]),
});
export type InvestigationChange = z.infer<typeof InvestigationChange>;

const Sha256 = z.string().regex(/^[a-f0-9]{64}$/);

/**
 * Retrato compacto do que a coleta encontrou (sem conclusões): base da comparação com a próxima
 * investigação. Rótulos e domínios, nunca texto de página inteiro.
 */
export const InvestigationSnapshot = z.object({
  siteUrl: z.string().max(2048).nullable(),
  /** null = não houve tentativa (sem site). */
  siteReachable: z.boolean().nullable(),
  pages: z
    .array(
      z.object({
        url: z.string().max(2048),
        category: z.string().max(20),
        ok: z.boolean(),
        contentHash: Sha256.nullable(),
      }),
    )
    .max(10),
  offerings: z.array(z.string().max(80)).max(12),
  valueProposition: z.string().max(300).nullable(),
  fonts: z.array(z.string().max(120)).max(5),
  colors: z.array(z.string().regex(/^#[0-9A-F]{6}$/)).max(12),
  captureHashes: z.object({ desktop: Sha256.nullable(), mobile: Sha256.nullable() }),
  signals: z.array(z.string().max(120)).max(10),
  competitors: z.array(z.string().max(253)).max(10),
});
export type InvestigationSnapshot = z.infer<typeof InvestigationSnapshot>;

export const EMPTY_INVESTIGATION_SNAPSHOT: InvestigationSnapshot = {
  siteUrl: null,
  siteReachable: null,
  pages: [],
  offerings: [],
  valueProposition: null,
  fonts: [],
  colors: [],
  captureHashes: { desktop: null, mobile: null },
  signals: [],
  competitors: [],
};

// -----------------------------------------------------------------------------
// Qualificação e diagnóstico (composição; as afirmações estão no ledger)
// -----------------------------------------------------------------------------

/** Saídas do doc 08 §3.4. */
export const Recommendation = z.enum([
  'pursue',
  'prepare_access',
  'investigate_more',
  'monitor',
  'discard',
  'insufficient_evidence',
]);
export type Recommendation = z.infer<typeof Recommendation>;

export const RECOMMENDATION_LABELS: Record<Recommendation, string> = {
  pursue: 'Abordar agora',
  prepare_access: 'Preparar acesso',
  investigate_more: 'Investigar mais',
  monitor: 'Acompanhar',
  discard: 'Descartar por enquanto',
  insufficient_evidence: 'Sem base suficiente',
};

/** Um critério do Fit (ICP), avaliado pelo sistema. `null` em `met` = dado desconhecido. */
export const FitCheck = z.object({
  criterion: z.enum(['cnae', 'uf', 'municipality', 'size', 'age', 'exclusion', 'registry_status']),
  met: z.boolean().nullable(),
  text: z.string().min(1).max(200),
});
export type FitCheck = z.infer<typeof FitCheck>;

/** Pontuação de 0 a 100 com critério explícito; nunca é probabilidade de fechamento. */
const Score = z.number().int().min(0).max(100);

export const OfferAssessment = z.object({
  offerId: Uuid,
  offerVersionId: Uuid,
  offerName: z.string().min(1).max(120),
  scoringModelId: Uuid.nullable(),
  icpVersionId: Uuid.nullable(),
  /** Aderência ao ICP (Fit): só critérios cadastrados, dado desconhecido não soma nem tira. */
  fit: z.object({ score: Score.nullable(), checks: z.array(FitCheck).max(10) }),
  /** Relevância da oportunidade (Opportunity): necessidade observada + sinais. */
  opportunity: z.object({ score: Score, claimIds: z.array(Uuid).max(12) }),
  /** Confiança nas informações usadas (Confidence): cobertura e força das evidências. */
  confidence: z.object({ score: Score, coveredDimensions: z.number().int().min(0).max(5) }),
  potential: Score,
  priority: Score,
  recommendation: Recommendation,
  /** Desqualificadores acionados (doc 08 §3.3), em texto do sistema. */
  gates: z.array(z.string().min(1).max(200)).max(6),
  /**
   * Leitura da IA para esta oferta, gravada no ledger (claim de oportunidade, inferência ou
   * hipótese, inclusive relevância "nenhuma"): justificativa, ângulo, objeções e o que conferir
   * ficam no próprio claim. Nulo quando a IA não leu a oferta ou a leitura não passou na
   * verificação; aí relevância e desqualificadores da IA não contam.
   */
  readingClaimId: Uuid.nullable(),
});
export type OfferAssessment = z.infer<typeof OfferAssessment>;

/** O que ainda não sabemos, em texto do sistema. */
export const KnowledgeGap = z.object({
  code: z.enum([
    'no_site',
    'site_not_read',
    'no_capture',
    'no_visual_analysis',
    'no_competitors',
    'no_signals',
    'no_contact_channel',
    'registry_missing',
    'few_sources',
  ]),
  text: z.string().min(1).max(200),
});
export type KnowledgeGap = z.infer<typeof KnowledgeGap>;

export const NextStep = z.enum([
  'investigate_more',
  'prepare_approach',
  'watch_signal',
  'discard_for_now',
  'confirm_site',
]);
export type NextStep = z.infer<typeof NextStep>;

export const NEXT_STEP_LABELS: Record<NextStep, string> = {
  investigate_more: 'Investigar mais',
  prepare_approach: 'Preparar abordagem',
  watch_signal: 'Acompanhar um sinal',
  discard_for_now: 'Descartar por enquanto',
  confirm_site: 'Confirmar o site oficial',
};

export const Diagnosis = z.object({
  /** Inferência-síntese no ledger ("Por que esta empresa merece atenção?"); null = base insuficiente. */
  summaryClaimId: Uuid.nullable(),
  /** Fatos que sustentam o diagnóstico (observações confirmadas, com fonte). */
  factClaimIds: z.array(Uuid).max(40),
  inferenceClaimIds: z.array(Uuid).max(30),
  hypothesisClaimIds: z.array(Uuid).max(20),
  /** Oportunidades (inferências ou hipóteses) ligadas às ofertas. */
  opportunityClaimIds: z.array(Uuid).max(10),
  gaps: z.array(KnowledgeGap).max(10),
  /** Ofertas avaliadas, da maior prioridade para a menor. */
  offers: z.array(OfferAssessment).max(10),
  recommendedOfferId: Uuid.nullable(),
  recommendation: Recommendation,
  nextStep: NextStep,
  /** Confiança geral (0 a 100) = cobertura e força das evidências usadas. */
  confidence: Score,
  /** Avisos da verificação (conclusões descartadas por falta de suporte, duplicadas…). */
  verification: z
    .object({
      discarded: z.number().int().min(0),
      reasons: z.array(z.string().min(1).max(160)).max(10),
    })
    .default({ discarded: 0, reasons: [] }),
});
export type Diagnosis = z.infer<typeof Diagnosis>;

// -----------------------------------------------------------------------------
// Investigação gravada
// -----------------------------------------------------------------------------

export const Investigation = z.object({
  id: Uuid,
  companyId: Uuid,
  status: InvestigationStatus,
  trigger: InvestigationTrigger,
  pipelineVersion: z.number().int().min(1),
  steps: z.array(InvestigationStep).max(20),
  usage: InvestigationUsage,
  models: z.array(InvestigationModelUse).max(10),
  diagnosis: Diagnosis.nullable(),
  snapshot: InvestigationSnapshot.nullable(),
  changes: z.array(InvestigationChange).max(30),
  /** Investigação anterior usada como base de comparação. */
  previousId: Uuid.nullable(),
  /** Tarefa na fila (ai_jobs, ADR-0011) quando existir. */
  jobId: z.string().max(80).nullable(),
  issue: InvestigationIssueCode.nullable(),
  cancelRequestedAt: IsoDateTime.nullable(),
  startedAt: IsoDateTime.nullable(),
  finishedAt: IsoDateTime.nullable(),
  isDemo: z.boolean(),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type Investigation = z.infer<typeof Investigation>;

export const StartInvestigationInput = z.object({
  companyId: Uuid,
  trigger: InvestigationTrigger.default('user'),
  /** true = ignora dados ainda válidos e coleta tudo de novo (custa mais buscas). */
  force: z.boolean().default(false),
});
export type StartInvestigationInput = z.infer<typeof StartInvestigationInput>;
export type StartInvestigationDraft = z.input<typeof StartInvestigationInput>;

/** Linha da lista de empresas: projeção da última investigação (view). */
export const CompanyInvestigationSummary = z.object({
  companyId: Uuid,
  investigationId: Uuid,
  status: InvestigationStatus,
  finishedAt: IsoDateTime.nullable(),
  updatedAt: IsoDateTime,
  recommendation: Recommendation.nullable(),
  recommendedOfferName: z.string().max(120).nullable(),
  priority: Score.nullable(),
});
export type CompanyInvestigationSummary = z.infer<typeof CompanyInvestigationSummary>;

// -----------------------------------------------------------------------------
// Catálogo de chaves do módulo (docs/08 §2; validade por domínio em @prospector/domain)
// -----------------------------------------------------------------------------

/** Segmento de chave a partir de um texto livre (`Implante dentário` → `implante_dentario`). */
export function keySlug(text: string, max = 40): string {
  const slug = text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, max)
    .replace(/_+$/g, '');
  const safe = /^[a-z]/.test(slug) ? slug : `x_${slug}`;
  return safe.length >= 2 ? safe : 'item';
}

export const INVESTIGATION_KEYS = {
  officialSiteCandidate: 'digital_presence.official_site_candidate',
  capture: (kind: 'site_desktop' | 'site_mobile') => `visual.capture.${kind}`,
  metric: (name: string) => `visual.metric.${keySlug(name)}`,
  palette: 'visual.identity.palette',
  typography: 'visual.identity.typography',
  audit: (criterion: string) => `visual.audit.${keySlug(criterion)}`,
  visualPositioning: 'visual.identity.positioning',
  offering: (label: string) => `positioning.offering.${keySlug(label)}`,
  audience: (label: string) => `positioning.audience.${keySlug(label)}`,
  differentiator: (label: string) => `positioning.differentiator.${keySlug(label)}`,
  region: 'positioning.region_served',
  valueProposition: 'positioning.value_proposition',
  tone: 'positioning.tone_of_voice',
  businessModel: 'positioning.business_model',
  pageSignal: (label: string) => `signal.site.${keySlug(label)}`,
  webSignal: (label: string) => `signal.web.${keySlug(label, 60)}`,
  competitor: (domain: string) => `competitive.competitor.${keySlug(domain, 60)}`,
  peerPage: (domain: string) => `competitive.peer_page.${keySlug(domain, 60)}`,
  competitiveFinding: (label: string) => `competitive.finding.${keySlug(label)}`,
  summary: 'positioning.diagnosis_summary',
  hypothesis: (label: string) => `positioning.hypothesis.${keySlug(label)}`,
  opportunity: (offerName: string) => `positioning.opportunity.${keySlug(offerName)}`,
} as const;

/** Toda chave gerada passa pelo formato do ledger. */
export function assertClaimKey(key: string): string {
  return ClaimKey.parse(key);
}
