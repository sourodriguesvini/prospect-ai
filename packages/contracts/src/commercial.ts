import { z } from 'zod';
import { Uuid } from './common';
import { PartialDate } from './discovery';

/**
 * Inteligência comercial (diretriz 2026-11-26, Partes 1 a 4; doc 15 §7).
 *
 * - Perfil comercial: quem o Prospector representa (Found Studio, Blummy…). Cada perfil tem o
 *   próprio catálogo, público e restrições, e os perfis nunca se misturam (Parte 1.5).
 * - Catálogo: capacidade → problema → serviço → solução → entregável (Parte 1.3), com o modo de
 *   entrega de cada capacidade (Parte 1.4).
 * - Acontecimento empresarial: o que aconteceu, quando, com quem, valor, modalidade e
 *   finalidade declarada (ou "desconhecida"), sempre com trecho literal da fonte (Parte 2.3).
 * - Tese comercial: um ângulo principal, até duas alternativas, seis dimensões qualitativas com
 *   motivo e evidências, o que não oferecer e o que confirmar (Parte 4).
 */

const Text = (max: number) => z.string().trim().min(1).max(max);
const Slug = z
  .string()
  .regex(/^[a-z0-9]+(?:[-_][a-z0-9]+)*$/, { message: 'Use letras minúsculas, números e hífen.' })
  .max(60);

// -----------------------------------------------------------------------------
// Catálogo
// -----------------------------------------------------------------------------

/** Parte 1.4: o que é feito diretamente, dirigido, com parceiros ou ainda não comprovado. */
export const DeliveryMode = z.enum(['direct', 'directed', 'partners', 'unproven']);
export type DeliveryMode = z.infer<typeof DeliveryMode>;
export const DELIVERY_MODE_LABELS: Record<DeliveryMode, string> = {
  direct: 'Executado diretamente',
  directed: 'Dirigido ou coordenado',
  partners: 'Com parceiros e equipes',
  unproven: 'Ainda não comprovado comercialmente',
};

export const Capability = z.object({
  id: Slug,
  name: Text(120),
  deliveryMode: DeliveryMode,
});
export type Capability = z.infer<typeof Capability>;

export const CapabilityFamily = z.object({
  /** Letra da família (A a F na Found Studio) ou código curto do perfil. */
  code: z.string().regex(/^[A-Z]$/),
  name: Text(120),
  capabilities: z.array(Capability).min(1).max(30),
});
export type CapabilityFamily = z.infer<typeof CapabilityFamily>;

/** Tipos de acontecimento empresarial que a investigação reconhece (Parte 2.2, momento). */
export const BusinessEventType = z.enum([
  /** A empresa publicou que procura fornecedor ou profissional (Parte 8, Caso 5). */
  'explicit_demand',
  'funding',
  'acquisition',
  'merger',
  'expansion',
  'new_market',
  'launch',
  'partnership',
  'leadership',
  'restructuring',
  'hiring',
  'brand_change',
  'award',
  'move',
  'anniversary',
]);
export type BusinessEventType = z.infer<typeof BusinessEventType>;
export const BUSINESS_EVENT_LABELS: Record<BusinessEventType, string> = {
  explicit_demand: 'procura declarada por fornecedor ou profissional',
  funding: 'investimento ou rodada',
  acquisition: 'aquisição',
  merger: 'fusão',
  expansion: 'expansão ou nova unidade',
  new_market: 'entrada em novo mercado',
  launch: 'lançamento',
  partnership: 'parceria',
  leadership: 'mudança de liderança',
  restructuring: 'reestruturação',
  hiring: 'contratação',
  brand_change: 'mudança de marca',
  award: 'prêmio ou certificação',
  move: 'mudança de endereço ou reforma',
  anniversary: 'aniversário da empresa',
};

/** Sinais que não são acontecimentos: leituras do próprio site (medições, vagas no site). */
export const SiteSignal = z.enum(['site_accessibility', 'site_mobile', 'site_inconsistency']);
export type SiteSignal = z.infer<typeof SiteSignal>;

export const CommercialSignal = z.union([BusinessEventType, SiteSignal]);
export type CommercialSignal = z.infer<typeof CommercialSignal>;

/** Papel de quem deve ser abordado (Parte 4.3) e, no produto, quem usa, compra ou influencia. */
export const AudienceRole = z.enum(['user', 'buyer', 'influencer']);
export type AudienceRole = z.infer<typeof AudienceRole>;

export const CommercialProblem = z.object({
  id: Slug,
  /** Situação empresarial, sem afirmar que a empresa a tem (é hipótese até ser confirmada). */
  statement: Text(240),
  /** Sinais que tornam o problema plausível; o primeiro é o mais forte. */
  signals: z.array(CommercialSignal).min(1).max(12),
  capabilityIds: z.array(Slug).min(1).max(12),
  /** O que precisa ser confirmado antes de tratar o problema como necessidade. */
  toConfirm: z.array(Text(200)).max(5),
  /** Quem costuma decidir sobre esse problema. */
  approachRole: Text(160),
  /** Área da empresa de que a conversa trata ("produto e time"), usada no assunto de abertura. */
  openingArea: Text(80),
  /**
   * Termos da área (sem acento): um acontecimento que os cita pesa mais para este problema
   * (contratação de engenharia → produto; de marketing → marca).
   */
  terms: z.array(Text(60)).max(24),
});
export type CommercialProblem = z.infer<typeof CommercialProblem>;

export const CommercialService = z.object({
  id: Slug,
  name: Text(120),
  capabilityIds: z.array(Slug).min(1).max(12),
  deliverables: z.array(Text(160)).min(1).max(12),
});
export type CommercialService = z.infer<typeof CommercialService>;

export const CommercialSolution = z.object({
  id: Slug,
  name: Text(160),
  problemIds: z.array(Slug).min(1).max(8),
  /** Serviços combinados, na ordem em que entram (Parte 1.3: não reduzir a uma oferta só). */
  serviceIds: z.array(Slug).min(1).max(8),
  rationale: Text(400),
});
export type CommercialSolution = z.infer<typeof CommercialSolution>;

export const CommercialProfile = z.object({
  id: Slug,
  name: Text(80),
  kind: z.enum(['services', 'product']),
  description: Text(600),
  positioning: Text(600),
  premise: Text(200).nullable(),
  audience: z.array(Text(200)).min(1).max(10),
  icps: z
    .array(
      z.object({ name: Text(120), description: Text(400), roles: z.array(AudienceRole).max(3) }),
    )
    .max(10),
  valueProposition: Text(600),
  differentiators: z.array(Text(240)).max(10),
  language: Text(400),
  /** Restrições comerciais: o que este perfil não pode prometer ou fazer. */
  restrictions: z.array(Text(300)).max(12),
  /**
   * O que este perfil não oferece logo depois de certos acontecimentos (ex.: rebranding depois de
   * uma troca de marca). Vale enquanto o acontecimento for recente; entra em "o que não oferecer".
   */
  avoidAfterEvents: z
    .array(z.object({ type: BusinessEventType, item: Text(120), reason: Text(200) }))
    .max(8),
  /** O que ainda falta o usuário informar ("a confirmar"); nunca preenchido por suposição. */
  unknowns: z.array(Text(240)).max(12),
  /** Palavras que identificam o perfil num pedido (Parte 1.5: o Copiloto identifica a operação). */
  keywords: z.array(Text(60)).min(1).max(40),
  families: z.array(CapabilityFamily).min(1).max(10),
  problems: z.array(CommercialProblem).min(1).max(30),
  services: z.array(CommercialService).min(1).max(30),
  solutions: z.array(CommercialSolution).max(20),
  /** Versão do catálogo; muda a cada alteração do conteúdo. */
  version: z.number().int().min(1),
});
export type CommercialProfile = z.infer<typeof CommercialProfile>;

// -----------------------------------------------------------------------------
// Acontecimento empresarial (valor do claim `signal.web.*`)
// -----------------------------------------------------------------------------

export const FundingModality = z.enum(['equity', 'debt', 'credit', 'grant', 'unknown']);
export type FundingModality = z.infer<typeof FundingModality>;
export const FUNDING_MODALITY_LABELS: Record<FundingModality, string> = {
  equity: 'rodada de participação (equity)',
  debt: 'dívida',
  credit: 'crédito ou financiamento',
  grant: 'fomento ou subvenção',
  unknown: 'modalidade não informada',
};

/** Trecho literal da fonte que sustenta um campo extraído (o servidor confere que existe). */
export const QuotedValue = z.object({ text: Text(200), quote: Text(300) });
export type QuotedValue = z.infer<typeof QuotedValue>;

export const FundingDetails = z.object({
  /** Valor em centavos de real, quando a fonte diz o valor em reais. */
  amountCents: z.number().int().positive().nullable(),
  amount: QuotedValue.nullable(),
  round: QuotedValue.nullable(),
  investors: z.array(QuotedValue).max(6),
  modality: FundingModality,
  /** Parte 2.3: sem finalidade documentada, registra "desconhecida" — nunca orçamento. */
  purpose: z.discriminatedUnion('status', [
    z.object({ status: z.literal('declared'), value: QuotedValue }),
    z.object({ status: z.literal('unknown') }),
  ]),
  /** Contexto anterior declarado na fonte (ex.: "não precisava de dinheiro"). */
  context: QuotedValue.nullable(),
});
export type FundingDetails = z.infer<typeof FundingDetails>;

/**
 * Demanda declarada pela empresa (Parte 8, Caso 5): o que ela procura, o prazo e por onde
 * responder, cada um com o trecho literal. O canal só é guardado quando é da empresa (área ou
 * e-mail genérico como compras@); nome de pessoa nunca entra.
 */
export const DemandDetails = z.object({
  need: QuotedValue,
  deadline: QuotedValue.nullable(),
  /** Prazo em data, quando a fonte diz o dia (o ano, se faltar, vem da data da publicação). */
  deadlineOn: PartialDate.nullable(),
  responsible: QuotedValue.nullable(),
});
export type DemandDetails = z.infer<typeof DemandDetails>;

export const BusinessEvent = z.object({
  type: BusinessEventType,
  /** Data do acontecimento, quando a fonte diz; senão a de publicação; senão null. */
  occurredOn: PartialDate.nullable(),
  dateBasis: z.enum(['event', 'published', 'unknown']),
  headline: Text(300),
  url: z.string().url().max(2000),
  host: Text(200),
  sourceTier: z.enum(['official', 'recognized_press', 'other']),
  /** Hosts que repetem a mesma notícia (republicações, não confirmações). */
  republishedBy: z.array(Text(200)).max(10),
  /** Hosts de fontes independentes que confirmam o acontecimento. */
  confirmedBy: z.array(Text(200)).max(10),
  /** Divergências entre as fontes (Parte 8, Caso 6): registradas, nunca resolvidas por palpite. */
  conflicts: z.array(Text(300)).max(5).default([]),
  /** A página da fonte foi lida (não só o título da busca). */
  pageRead: z.boolean(),
  funding: FundingDetails.nullable(),
  /** Só em `explicit_demand`; ausente nos acontecimentos gravados antes de 27/11/2026. */
  demand: DemandDetails.nullable().optional(),
});
export type BusinessEvent = z.infer<typeof BusinessEvent>;

// -----------------------------------------------------------------------------
// Tese comercial (Parte 4)
// -----------------------------------------------------------------------------

/** Parte 4.2: faixas qualitativas, sem número de falsa precisão. */
export const QualitativeLevel = z.enum(['high', 'medium', 'low', 'unknown']);
export type QualitativeLevel = z.infer<typeof QualitativeLevel>;
export const QUALITATIVE_LEVEL_LABELS: Record<QualitativeLevel, string> = {
  high: 'Alto',
  medium: 'Médio',
  low: 'Baixo',
  unknown: 'Indeterminado',
};

export const ThesisDimensionKey = z.enum([
  'strategic_potential',
  'evidence_quality',
  'commercial_fit',
  'timing',
  'accessibility',
  'execution_viability',
]);
export type ThesisDimensionKey = z.infer<typeof ThesisDimensionKey>;
export const THESIS_DIMENSION_LABELS: Record<ThesisDimensionKey, string> = {
  strategic_potential: 'Potencial estratégico',
  evidence_quality: 'Qualidade das evidências',
  commercial_fit: 'Compatibilidade comercial',
  timing: 'Momento',
  accessibility: 'Acesso a quem decide',
  execution_viability: 'Viabilidade de execução',
};

export const ThesisDimension = z.object({
  key: ThesisDimensionKey,
  level: QualitativeLevel,
  reason: Text(400),
  claimIds: z.array(Uuid).max(8),
});
export type ThesisDimension = z.infer<typeof ThesisDimension>;

export const ThesisAngle = z.object({
  problemId: Slug,
  solutionId: Slug.nullable(),
  /** Nome curto da oportunidade (ex.: "Estruturação do produto digital"). */
  title: Text(160),
  /** Contexto que sustenta a oportunidade, só com o que tem fonte. */
  context: Text(600),
  /** Problema potencial: hipótese, nunca necessidade declarada pela empresa. */
  problem: Text(400),
  /** Serviços ou solução compatível, na ordem em que entram. */
  offer: z.array(Text(160)).min(1).max(8),
  why: Text(600),
  whyNow: Text(400),
  approachRole: Text(160),
  openingTopic: Text(300),
  /** Sinais que sustentam o ângulo. */
  signals: z.array(CommercialSignal).max(8),
  claimIds: z.array(Uuid).max(12),
});
export type ThesisAngle = z.infer<typeof ThesisAngle>;

export const ThesisRecommendation = z.enum(['approach', 'deepen_research', 'deprioritize']);
export type ThesisRecommendation = z.infer<typeof ThesisRecommendation>;
export const THESIS_RECOMMENDATION_LABELS: Record<ThesisRecommendation, string> = {
  approach: 'Vale preparar a abordagem',
  deepen_research: 'Vale aprofundar a pesquisa antes',
  deprioritize: 'Não priorizar agora',
};

export const COMPATIBILITY_VERSION = 'compatibility/v1';

export const CommercialThesis = z.object({
  version: z.literal(COMPATIBILITY_VERSION),
  profileId: Slug,
  profileVersion: z.number().int().min(1),
  recommendation: ThesisRecommendation,
  /** Por que esta recomendação (uma frase). */
  recommendationReason: Text(400),
  principal: ThesisAngle.nullable(),
  alternatives: z.array(ThesisAngle).max(2),
  dimensions: z.array(ThesisDimension).length(6),
  doNotOffer: z.array(z.object({ item: Text(160), reason: Text(300) })).max(8),
  toConfirm: z.array(Text(240)).max(10),
});
export type CommercialThesis = z.infer<typeof CommercialThesis>;

// -----------------------------------------------------------------------------
// Proposta da abordagem (ajuste de 27/11: a oferta sai da tese e do catálogo do perfil)
// -----------------------------------------------------------------------------

/**
 * O que a abordagem propõe. `recommended`: a solução que a tese recomenda (ou a combinação dela);
 * `custom`: as frentes que a pessoa escolheu no catálogo do perfil; `conversation`: nenhuma oferta
 * direta (networking, sondar interesse, entender o momento).
 */
export const ProposalMode = z.enum(['recommended', 'custom', 'conversation']);
export type ProposalMode = z.infer<typeof ProposalMode>;
export const PROPOSAL_MODE_LABELS: Record<ProposalMode, string> = {
  recommended: 'Seguir a recomendação',
  custom: 'Ajustar o que propor',
  conversation: 'Sem oferta: só abrir uma conversa',
};

/** Frente do catálogo do perfil (as famílias de capacidades: A a F na Found Studio). */
export const ProposalFamily = z.object({
  code: z.string().regex(/^[A-Z]$/),
  name: Text(120),
});
export type ProposalFamily = z.infer<typeof ProposalFamily>;

/** O que a tese recomenda propor, com o motivo (regra, sem modelo). */
export const ProposalRecommendation = z.object({
  title: Text(160),
  families: z.array(ProposalFamily).max(10),
  services: z.array(Text(160)).max(12),
  rationale: Text(600),
  /** Ângulo alternativo combinado ao principal (o mesmo acontecimento sustenta os dois). */
  combinedWith: Text(160).nullable(),
});
export type ProposalRecommendation = z.infer<typeof ProposalRecommendation>;

/**
 * A proposta gravada na estratégia e entregue à IA: perfil, frentes, serviços, justificativa e o
 * objetivo da primeira interação. Gravada pelo servidor (o modelo não escolhe a oferta).
 */
export const ApproachProposal = z.object({
  profileId: Slug,
  profileName: Text(80),
  profileKind: CommercialProfile.shape.kind,
  mode: ProposalMode,
  title: Text(160),
  families: z.array(ProposalFamily).max(10),
  services: z.array(Text(160)).max(12),
  rationale: Text(600),
  /** Objetivo da primeira interação (conversa, entender o momento, apresentar…). */
  objective: Text(300),
  /** O que a pessoa escreveu ao ajustar a proposta, nas palavras dela. */
  note: Text(400).nullable(),
});
export type ApproachProposal = z.infer<typeof ApproachProposal>;

// -----------------------------------------------------------------------------
// Linguagem pública da empresa (Parte 5.2)
// -----------------------------------------------------------------------------

/**
 * Medida, por regra, de como a empresa escreve nos textos dela que o ledger guardou (trechos
 * literais do site e dos perfis próprios). Serve para adaptar o registro da mensagem, nunca para
 * imitar a voz da empresa.
 */
export const LanguageFormality = z.enum(['formal', 'neutral', 'informal']);
export type LanguageFormality = z.infer<typeof LanguageFormality>;
export const LANGUAGE_FORMALITY_LABELS: Record<LanguageFormality, string> = {
  formal: 'formal',
  neutral: 'neutra',
  informal: 'informal',
};

export const LanguageAddress = z.enum(['second_person', 'third_person', 'unknown']);
export type LanguageAddress = z.infer<typeof LanguageAddress>;
export const LANGUAGE_ADDRESS_LABELS: Record<LanguageAddress, string> = {
  second_person: 'fala direto com o público ("você")',
  third_person: 'fala do público em terceira pessoa ("nossos clientes")',
  unknown: 'não deu para medir',
};

export const CompanyLanguage = z.object({
  formality: LanguageFormality,
  address: LanguageAddress,
  /** Palavras que se repetem em mais de um texto da empresa (como ela escreve). */
  terms: z.array(z.string().trim().min(2).max(40)).max(8),
  /** Quantos trechos foram medidos. */
  samples: z.number().int().min(0),
});
export type CompanyLanguage = z.infer<typeof CompanyLanguage>;
