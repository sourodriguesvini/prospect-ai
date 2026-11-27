import { z } from 'zod';
import { Uuid } from './common';
import { ThesisAngle, ThesisRecommendation } from './commercial';
import { ApproachClearance } from './strategy';

/**
 * Contratos do Relacionamento (F10 a F12 enxutas, ADR-0014): oportunidades, estratégia de
 * abordagem, rascunhos versionados, aprovação de uso, interações (contato feito, resposta recebida,
 * nota), follow-ups e supressão por opt-out. Aqui fica só o FORMATO; as regras (quando aprovar,
 * opt-out, atenção) ficam em @prospector/domain e no serviço. Mensagens em pt-BR.
 *
 * Nada aqui envia mensagem: o envio é sempre manual, feito pelo usuário fora do app, e só depois de
 * uma aprovação válida (regra 2 do CLAUDE.md). O app registra o que foi feito.
 */

const REQUIRED = 'Campo obrigatório.';
const maxChars = (max: number) => ({ error: `Use no máximo ${max} caracteres.` });

function text(min: number, max: number) {
  return z
    .string({ error: REQUIRED })
    .trim()
    .min(min, { error: min <= 1 ? REQUIRED : `Use ao menos ${min} caracteres.` })
    .max(max, maxChars(max));
}

/** Texto opcional: vazio vira null. */
function optional(max: number) {
  return z
    .string()
    .trim()
    .max(max, maxChars(max))
    .nullish()
    .transform((value) => (value ? value : null));
}

const IsoDateTime = z.iso.datetime({ offset: true, error: 'Data e hora inválidas.' });

// -----------------------------------------------------------------------------
// Pipeline
// -----------------------------------------------------------------------------

/** Etapas do pipeline (spec do usuário §7.2). Ordem = ordem das colunas. */
export const OpportunityStage = z.enum(
  [
    'identified',
    'qualified',
    'approach_ready',
    'contacted',
    'in_conversation',
    'meeting',
    'proposal',
    'negotiation',
    'won',
    'lost',
  ],
  { error: 'Etapa inválida.' },
);
export type OpportunityStage = z.infer<typeof OpportunityStage>;

export const OPPORTUNITY_STAGES: readonly OpportunityStage[] = OpportunityStage.options;

export const OPPORTUNITY_STAGE_LABELS: Record<OpportunityStage, string> = {
  identified: 'Oportunidade identificada',
  qualified: 'Qualificada',
  approach_ready: 'Abordagem preparada',
  contacted: 'Contatada',
  in_conversation: 'Em conversa',
  meeting: 'Reunião',
  proposal: 'Proposta',
  negotiation: 'Negociação',
  won: 'Ganha',
  lost: 'Perdida',
};

/** Etapas que encerram a oportunidade (`closed_at` preenchido). */
export const CLOSED_STAGES: ReadonlySet<OpportunityStage> = new Set(['won', 'lost']);

export const OpportunityPriority = z.enum(['high', 'medium', 'low'], {
  error: 'Prioridade inválida.',
});
export type OpportunityPriority = z.infer<typeof OpportunityPriority>;

export const OPPORTUNITY_PRIORITY_LABELS: Record<OpportunityPriority, string> = {
  high: 'Alta',
  medium: 'Média',
  low: 'Baixa',
};

/** Como a oportunidade nasceu: pelo dossiê da empresa, pela Descoberta ou pelo Copiloto. */
export const OpportunitySource = z.enum(['company', 'discovery', 'copilot']);
export type OpportunitySource = z.infer<typeof OpportunitySource>;

/** Valor estimado: só com uma base real informada (nunca inventado). Centavos de real. */
const ValueCents = z
  .number({ error: 'Valor inválido.' })
  .int({ error: 'Valor inválido.' })
  .min(0, { error: 'O valor não pode ser negativo.' })
  .max(100_000_000_00, { error: 'Valor alto demais.' });

export const Opportunity = z.object({
  id: Uuid,
  companyId: Uuid,
  offerId: Uuid.nullable(),
  stage: OpportunityStage,
  priority: OpportunityPriority,
  valueEstimateCents: ValueCents.nullable(),
  /** De onde veio o valor ("orçamento citado na reunião de 10/11"); obrigatório com valor. */
  valueBasis: z.string().nullable(),
  nextAction: z.string().nullable(),
  nextActionDueAt: z.string().nullable(),
  lostReason: z.string().nullable(),
  source: OpportunitySource,
  closedAt: z.string().nullable(),
  isDemo: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Opportunity = z.infer<typeof Opportunity>;

/** Oportunidade com o que a lista e o kanban precisam (empresa e atividade). */
export const OpportunitySummary = Opportunity.extend({
  companyName: z.string(),
  companyIsDemo: z.boolean(),
  offerName: z.string().nullable(),
  lastInteractionAt: z.string().nullable(),
  lastInboundAt: z.string().nullable(),
  lastOutboundAt: z.string().nullable(),
  openTasks: z.number().int().min(0),
  nextTaskDueAt: z.string().nullable(),
  /** Empresa com opt-out ou pedido para parar em vigor: nenhum contato novo. */
  suppressed: z.boolean(),
});
export type OpportunitySummary = z.infer<typeof OpportunitySummary>;

export const StageChange = z.object({
  id: Uuid,
  opportunityId: Uuid,
  fromStage: OpportunityStage.nullable(),
  toStage: OpportunityStage,
  note: z.string().nullable(),
  createdAt: z.string(),
});
export type StageChange = z.infer<typeof StageChange>;

export const OpenOpportunityInput = z.object({
  companyId: Uuid,
  offerId: Uuid.nullable().default(null),
  source: OpportunitySource.default('company'),
  stage: z.enum(['identified', 'qualified', 'approach_ready']).default('identified'),
});
export type OpenOpportunityInput = z.input<typeof OpenOpportunityInput>;

export const ChangeStageInput = z.object({
  opportunityId: Uuid,
  /** Etapa que a tela mostrava: se mudou nesse meio-tempo, nada é gravado (concurrent_change). */
  fromStage: OpportunityStage,
  toStage: OpportunityStage,
  note: optional(300),
});
export type ChangeStageInput = z.input<typeof ChangeStageInput>;

export const UpdateOpportunityInput = z
  .object({
    opportunityId: Uuid,
    offerId: Uuid.nullable(),
    priority: OpportunityPriority,
    valueEstimateCents: ValueCents.nullable().default(null),
    valueBasis: optional(300),
    nextAction: optional(300),
    nextActionDueAt: IsoDateTime.nullable().default(null),
    lostReason: optional(300),
  })
  .superRefine((value, ctx) => {
    if (value.valueEstimateCents !== null && !value.valueBasis) {
      ctx.addIssue({
        code: 'custom',
        path: ['valueBasis'],
        message: 'Diga de onde vem o valor (ex.: orçamento citado pelo cliente).',
      });
    }
    if (value.valueEstimateCents === null && value.valueBasis) {
      ctx.addIssue({
        code: 'custom',
        path: ['valueEstimateCents'],
        message: 'Informe o valor ou apague a base.',
      });
    }
  });
export type UpdateOpportunityInput = z.input<typeof UpdateOpportunityInput>;

// -----------------------------------------------------------------------------
// Canais, tipos de mensagem e tom
// -----------------------------------------------------------------------------

/**
 * Canais do envio MANUAL (docs/12 §5). Nenhum é automático: o app prepara o texto e o usuário envia
 * fora. WhatsApp só com pedido do prospect (opt-in) — nunca para primeiro contato.
 */
export const MessageChannel = z.enum(
  ['email', 'linkedin_manual', 'phone', 'in_person', 'whatsapp_optin', 'other'],
  { error: 'Canal inválido.' },
);
export type MessageChannel = z.infer<typeof MessageChannel>;

export const MESSAGE_CHANNEL_LABELS: Record<MessageChannel, string> = {
  email: 'E-mail',
  linkedin_manual: 'LinkedIn (envio manual)',
  phone: 'Telefone',
  in_person: 'Pessoalmente',
  whatsapp_optin: 'WhatsApp (só se o prospect pediu)',
  other: 'Outro',
};

export const MessageKind = z.enum(
  [
    'initial_email',
    'short_message',
    'presentation',
    'meeting_invite',
    'follow_up',
    'objection_reply',
    'reengagement',
    'reply',
  ],
  { error: 'Tipo de mensagem inválido.' },
);
export type MessageKind = z.infer<typeof MessageKind>;

export const MESSAGE_KIND_LABELS: Record<MessageKind, string> = {
  initial_email: 'E-mail inicial',
  short_message: 'Mensagem curta',
  presentation: 'Apresentação comercial',
  meeting_invite: 'Convite para conversa',
  follow_up: 'Follow-up',
  objection_reply: 'Resposta a objeção',
  reengagement: 'Retomada de contato',
  reply: 'Resposta',
};

/**
 * Tipos pensados para abrir a conversa (sugestão de tipo na tela e no prompt). Identificação,
 * opt-out e canal do titular NÃO dependem do tipo: dependem do estado do contato (domínio,
 * `contactState`), para que trocar o tipo não tire o rodapé obrigatório.
 */
export const FIRST_CONTACT_KINDS: ReadonlySet<MessageKind> = new Set([
  'initial_email',
  'short_message',
  'presentation',
  'meeting_invite',
]);

export const MessageTone = z.enum(['consultative', 'direct', 'warm', 'formal'], {
  error: 'Tom inválido.',
});
export type MessageTone = z.infer<typeof MessageTone>;

export const MESSAGE_TONE_LABELS: Record<MessageTone, string> = {
  consultative: 'Consultivo',
  direct: 'Direto',
  warm: 'Próximo',
  formal: 'Formal',
};

// -----------------------------------------------------------------------------
// Insumos da abordagem vindos de Empresas (diagnóstico) — porta ApproachInsightsSource
// -----------------------------------------------------------------------------

const ClaimIds = (min: number, max: number) => z.array(Uuid).min(min).max(max);

/** Diagnóstico de marca resumido; toda frase cita claims do ledger. */
export const DiagnosisSummary = z.object({
  id: Uuid,
  status: z.enum(['complete', 'partial']),
  summary: z.string().trim().min(1).max(1200),
  findings: z
    .array(z.object({ statement: z.string().trim().min(5).max(500), claimIds: ClaimIds(1, 20) }))
    .max(12),
  producedAt: z.string(),
  promptId: z.string().nullable(),
});
export type DiagnosisSummary = z.infer<typeof DiagnosisSummary>;

export const RecommendedService = z.object({
  offerId: Uuid,
  offerVersionId: Uuid.nullable(),
  rationale: z.string().trim().min(1).max(800),
  claimIds: ClaimIds(0, 20),
  confidence: z.enum(['low', 'medium', 'high']),
});
export type RecommendedService = z.infer<typeof RecommendedService>;

/**
 * Ângulo da tese que a pessoa escolhe ao pedir a abordagem (diretriz 2026-11-26, Parte 5.1: a
 * mensagem é consequência de uma tese aprovada). "none" = abordagem só pelo dossiê, como antes.
 */
export const ThesisChoice = z.enum(['principal', 'alternative_1', 'alternative_2', 'none']);
export type ThesisChoice = z.infer<typeof ThesisChoice>;
export const THESIS_CHOICE_LABELS: Record<ThesisChoice, string> = {
  principal: 'Ângulo principal',
  alternative_1: 'Primeira alternativa',
  alternative_2: 'Segunda alternativa',
  none: 'Sem a tese (só o dossiê)',
};
export const ChosenThesisAngle = ThesisChoice.exclude(['none']);
export type ChosenThesisAngle = z.infer<typeof ChosenThesisAngle>;

const ThesisCaveats = {
  doNotOffer: z
    .array(z.object({ item: z.string().trim().min(1).max(160), reason: z.string().trim().max(300) }))
    .max(8),
  toConfirm: z.array(z.string().trim().min(1).max(240)).max(10),
};

/** Tese comercial da investigação mais recente, como insumo da abordagem (regra, sem modelo). */
export const ApproachThesis = z.object({
  investigationId: Uuid,
  recommendation: ThesisRecommendation,
  recommendationReason: z.string().trim().min(1).max(400),
  principal: ThesisAngle.nullable(),
  alternatives: z.array(ThesisAngle).max(2),
  ...ThesisCaveats,
});
export type ApproachThesis = z.infer<typeof ApproachThesis>;

/** O ângulo escolhido, com o que não oferecer e o que confirmar: o que o modelo recebe. */
export const SelectedThesis = z.object({
  investigationId: Uuid,
  choice: ChosenThesisAngle,
  recommendation: ThesisRecommendation,
  recommendationReason: z.string().trim().min(1).max(400),
  angle: ThesisAngle,
  ...ThesisCaveats,
});
export type SelectedThesis = z.infer<typeof SelectedThesis>;

/** Qual ângulo a pessoa aprovou ao pedir a abordagem (gravado na estratégia, conferível depois). */
export const ThesisBasis = z.object({
  investigationId: Uuid,
  choice: ChosenThesisAngle,
  title: z.string().trim().min(1).max(160),
  approvedAt: z.string(),
});
export type ThesisBasis = z.infer<typeof ThesisBasis>;

export const ApproachInsights = z.object({
  diagnosis: DiagnosisSummary.nullable(),
  recommendedService: RecommendedService.nullable(),
  qualification: z
    .object({
      priority: OpportunityPriority,
      recommendation: z.string().trim().min(1).max(300),
      assessedAt: z.string(),
    })
    .nullable(),
  /** Tese da investigação (ausente nas anteriores ao motor de inteligência). */
  thesis: ApproachThesis.nullable().optional(),
});
export type ApproachInsights = z.infer<typeof ApproachInsights>;

export const EMPTY_APPROACH_INSIGHTS: ApproachInsights = {
  diagnosis: null,
  recommendedService: null,
  qualification: null,
};

// -----------------------------------------------------------------------------
// Estratégia de abordagem (saída da IA, validada no servidor)
// -----------------------------------------------------------------------------

export const ApproachObjective = z.enum(['introduction', 'conversation', 'meeting', 'deepening']);
export type ApproachObjective = z.infer<typeof ApproachObjective>;

export const APPROACH_OBJECTIVE_LABELS: Record<ApproachObjective, string> = {
  introduction: 'Apresentação',
  conversation: 'Abrir uma conversa',
  meeting: 'Marcar uma reunião',
  deepening: 'Aprofundar o relacionamento',
};

/** Frase que a estratégia sustenta com claims do dossiê (ids conferidos no servidor). */
export const GroundedPoint = z.object({
  statement: z.string().trim().min(5).max(400),
  claimIds: z.array(Uuid).max(10),
});
export type GroundedPoint = z.infer<typeof GroundedPoint>;

/**
 * Estratégia de abordagem (spec §5.3). O interlocutor é uma FUNÇÃO ou área, nunca o nome de uma
 * pessoa; o canal é um dos permitidos; cada argumento cita os claims que o sustentam.
 */
export const ApproachStrategyContent = z.object({
  opportunity: text(10, 500),
  objective: ApproachObjective,
  counterpartRole: text(3, 120),
  channel: MessageChannel,
  channelReason: text(5, 300),
  argument: text(10, 800),
  evidence: z.array(GroundedPoint).max(8),
  nextStep: text(5, 300),
  /** O que falta saber (vira sugestão de investigação). */
  gaps: z.array(z.string().trim().min(3).max(200)).max(6),
  risks: z.array(z.string().trim().min(3).max(200)).max(5),
  /** Cases citáveis usados (só `publicOk`, conferidos no servidor). */
  caseIds: z.array(Uuid).max(3),
  /** Ângulo da tese aprovado ao pedir a abordagem; gravado pelo servidor, nunca pelo modelo. */
  thesisBasis: ThesisBasis.optional(),
});
export type ApproachStrategyContent = z.infer<typeof ApproachStrategyContent>;

/** Base de evidência da abordagem (regra determinística, @prospector/domain). */
export const ApproachBasis = z.enum(['sufficient', 'limited']);
export type ApproachBasis = z.infer<typeof ApproachBasis>;

export const ApproachPlanStatus = z.enum(['draft', 'approved', 'discarded']);
export type ApproachPlanStatus = z.infer<typeof ApproachPlanStatus>;

export const ApproachPlan = z.object({
  id: Uuid,
  opportunityId: Uuid,
  companyId: Uuid,
  offerId: Uuid,
  offerVersionId: Uuid,
  version: z.number().int().min(1),
  status: ApproachPlanStatus,
  basis: ApproachBasis,
  content: ApproachStrategyContent,
  claimIds: z.array(Uuid),
  promptId: z.string().nullable(),
  model: z.string().nullable(),
  decidedAt: z.string().nullable(),
  isDemo: z.boolean(),
  createdAt: z.string(),
});
export type ApproachPlan = z.infer<typeof ApproachPlan>;

// -----------------------------------------------------------------------------
// Mensagens (rascunhos versionados)
// -----------------------------------------------------------------------------

/**
 * Situação gravada da versão. Uma versão que não é a mais recente da sua linha vale como
 * "substituída" (calculado, nunca gravado): editar uma mensagem aprovada invalida a aprovação.
 */
export const MessageStatus = z.enum(['draft', 'approved', 'discarded']);
export type MessageStatus = z.infer<typeof MessageStatus>;
export type EffectiveMessageStatus = MessageStatus | 'superseded';

export const MESSAGE_STATUS_LABELS: Record<EffectiveMessageStatus, string> = {
  draft: 'Rascunho',
  approved: 'Aprovada para uso',
  discarded: 'Descartada',
  superseded: 'Versão anterior',
};

export const MessageOrigin = z.enum(['ai', 'user', 'copilot']);
export type MessageOrigin = z.infer<typeof MessageOrigin>;

export const Sha256Hex = z.string().regex(/^[a-f0-9]{64}$/);

export const OutboundMessage = z.object({
  id: Uuid,
  opportunityId: Uuid,
  planId: Uuid.nullable(),
  replyToInteractionId: Uuid.nullable(),
  kind: MessageKind,
  channel: MessageChannel,
  tone: MessageTone.nullable(),
  subject: z.string().nullable(),
  body: z.string(),
  /** Linha de versões: id da primeira versão. */
  threadId: Uuid,
  version: z.number().int().min(1),
  origin: MessageOrigin,
  status: MessageStatus,
  payloadHash: Sha256Hex,
  approvalId: Uuid.nullable(),
  claimIds: z.array(Uuid),
  promptId: z.string().nullable(),
  model: z.string().nullable(),
  decidedAt: z.string().nullable(),
  isDemo: z.boolean(),
  createdAt: z.string(),
});
export type OutboundMessage = z.infer<typeof OutboundMessage>;

/**
 * Tipos de aviso da conferência automática do texto da IA (KI-150). A auditoria guarda só os
 * tipos e as contagens, nunca o texto (ADR-0014 item 11); a tela mostra cada tipo em pt-BR.
 */
export const AiReviewKind = z.enum([
  'source',
  'added',
  'invented',
  'strategy',
  'request',
  'tone',
  'proportion',
  'agency',
]);
export type AiReviewKind = z.infer<typeof AiReviewKind>;

/** O que a conferência deixou numa versão gerada pela IA (gravado com ela, na auditoria). */
export const AiReviewRecord = z.object({
  /** A IA foi chamada de novo para corrigir o próprio texto. */
  corrected: z.boolean(),
  /** Tipos do que ainda ficou no texto (avisos para quem revisa antes de aprovar). */
  kinds: z.array(AiReviewKind).max(AiReviewKind.options.length).default([]),
  /** Menções de fonte errada que o sistema tirou depois da correção. */
  adjusted: z.number().int().min(0).max(50).default(0),
});
export type AiReviewRecord = z.infer<typeof AiReviewRecord>;

/** Texto escrito pela IA (validado antes de virar rascunho). */
export const MessageDraftText = z.object({
  subject: z.string().trim().max(200).nullable(),
  body: z.string().trim().min(20).max(6000),
});
export type MessageDraftText = z.infer<typeof MessageDraftText>;

// -----------------------------------------------------------------------------
// Aprovação de uso (regra 2): payload_hash do conteúdo exato, canal e validade
// -----------------------------------------------------------------------------

export const ApprovalStatus = z.enum(['approved', 'revoked']);
export type ApprovalStatus = z.infer<typeof ApprovalStatus>;

/** Versões que a barreira de abordagem conferiu no momento da aprovação (oferta, LIA, voz...). */
export const ApprovalClearance = ApproachClearance;
export type ApprovalClearance = ApproachClearance;

export const Approval = z.object({
  id: Uuid,
  actionType: z.literal('message.use'),
  entityType: z.literal('outbound_message'),
  entityId: Uuid,
  opportunityId: Uuid,
  payloadHash: Sha256Hex,
  channel: MessageChannel,
  status: ApprovalStatus,
  clearance: ApprovalClearance,
  decidedAt: z.string(),
  expiresAt: z.string(),
  revokedAt: z.string().nullable(),
  revokeReason: z.string().nullable(),
  createdAt: z.string(),
});
export type Approval = z.infer<typeof Approval>;

/** Por que uma aprovação não vale mais (calculado no domínio). */
export const ApprovalProblem = z.enum([
  'not_approved',
  'used',
  'revoked',
  'expired',
  'edited',
  'hash_mismatch',
  'suppressed',
  'compliance',
]);
export type ApprovalProblem = z.infer<typeof ApprovalProblem>;

export const APPROVAL_PROBLEM_LABELS: Record<ApprovalProblem, string> = {
  not_approved: 'A mensagem ainda não foi aprovada.',
  used: 'Já registrada como contato feito. Para escrever de novo, crie outra mensagem.',
  revoked: 'A aprovação foi revogada.',
  expired: 'A aprovação venceu. Revise e aprove de novo.',
  edited: 'A mensagem foi editada depois da aprovação. Aprove a versão nova.',
  hash_mismatch: 'O texto não é o mesmo que foi aprovado.',
  suppressed: 'A empresa pediu para não ser contatada (opt-out).',
  compliance: 'As condições de conformidade para abordar não estão atendidas.',
};

// -----------------------------------------------------------------------------
// Interações: contato feito (manual), resposta recebida, nota
// -----------------------------------------------------------------------------

export const InteractionDirection = z.enum(['outbound', 'inbound', 'note']);
export type InteractionDirection = z.infer<typeof InteractionDirection>;

export const INTERACTION_DIRECTION_LABELS: Record<InteractionDirection, string> = {
  outbound: 'Contato feito',
  inbound: 'Resposta recebida',
  note: 'Nota',
};

/** Interpretação da resposta (spec §6.3). Sempre com a incerteza dita. */
export const ReplyClassification = z.enum([
  'interest',
  'info_request',
  'question',
  'objection',
  'proposal_request',
  'meeting_request',
  'no_priority',
  'refusal',
  'stop_request',
  'out_of_office',
  'unclear',
]);
export type ReplyClassification = z.infer<typeof ReplyClassification>;

export const REPLY_CLASSIFICATION_LABELS: Record<ReplyClassification, string> = {
  interest: 'Interesse',
  info_request: 'Pedido de informações',
  question: 'Dúvida',
  objection: 'Objeção',
  proposal_request: 'Pede proposta',
  meeting_request: 'Pede reunião',
  no_priority: 'Sem prioridade agora',
  refusal: 'Negativa',
  stop_request: 'Pede para parar o contato',
  out_of_office: 'Ausência temporária',
  unclear: 'Não está claro',
};

export const ReplyConfidence = z.enum(['low', 'medium', 'high']);
export type ReplyConfidence = z.infer<typeof ReplyConfidence>;

export const REPLY_CONFIDENCE_LABELS: Record<ReplyConfidence, string> = {
  low: 'baixa',
  medium: 'média',
  high: 'alta',
};

export const ReplyAnalysis = z.object({
  classification: ReplyClassification,
  confidence: ReplyConfidence,
  /** Outras leituras possíveis quando há dúvida. */
  alternatives: z.array(ReplyClassification).max(3),
  uncertainty: z.string().trim().max(300).nullable(),
  summary: z.string().trim().min(5).max(500),
  objections: z.array(z.string().trim().min(3).max(200)).max(4),
  /** Prazo que o prospect citou ("depois de março"), como ele disse. */
  mentionedDeadline: z.string().trim().max(120).nullable(),
  /** Perguntas que ainda faltam (não repete o que já foi respondido). */
  qualifyingQuestions: z.array(z.string().trim().min(5).max(200)).max(4),
  nextStep: z.string().trim().min(5).max(300),
  followUpInDays: z.number().int().min(1).max(180).nullable(),
  suggestedReply: MessageDraftText.nullable(),
  /** Cases citáveis sugeridos (ids conferidos no servidor). */
  caseIds: z.array(Uuid).max(2),
});
export type ReplyAnalysis = z.infer<typeof ReplyAnalysis>;

export const Interaction = z.object({
  id: Uuid,
  opportunityId: Uuid,
  companyId: Uuid,
  direction: InteractionDirection,
  channel: MessageChannel,
  occurredAt: z.string(),
  summary: z.string().nullable(),
  body: z.string().nullable(),
  messageId: Uuid.nullable(),
  approvalId: Uuid.nullable(),
  /** Função ou área do interlocutor (nunca o nome): minimização (regra 7). */
  counterpartRole: z.string().nullable(),
  analysis: ReplyAnalysis.nullable(),
  analysisPromptId: z.string().nullable(),
  analysisModel: z.string().nullable(),
  analyzedAt: z.string().nullable(),
  /** O texto recebido é guardado por 12 meses (minimização). */
  retentionUntil: z.string(),
  isDemo: z.boolean(),
  createdAt: z.string(),
});
export type Interaction = z.infer<typeof Interaction>;

const OccurredAt = IsoDateTime;

export const RecordOutboundInput = z.object({
  messageId: Uuid,
  occurredAt: OccurredAt,
  counterpartRole: optional(120),
  /** Decisão explícita do usuário no formulário (nunca silenciosa). */
  moveToContacted: z.boolean().default(false),
});
export type RecordOutboundInput = z.input<typeof RecordOutboundInput>;

export const RecordInboundInput = z.object({
  opportunityId: Uuid,
  channel: MessageChannel,
  occurredAt: OccurredAt,
  body: text(2, 8000),
  counterpartRole: optional(120),
  moveToInConversation: z.boolean().default(false),
});
export type RecordInboundInput = z.input<typeof RecordInboundInput>;

export const RecordNoteInput = z.object({
  opportunityId: Uuid,
  channel: MessageChannel.default('other'),
  occurredAt: OccurredAt,
  summary: text(2, 500),
});
export type RecordNoteInput = z.input<typeof RecordNoteInput>;

// -----------------------------------------------------------------------------
// Follow-ups (tarefas)
// -----------------------------------------------------------------------------

export const TaskKind = z.enum(['follow_up', 'meeting', 'proposal', 'research', 'other'], {
  error: 'Tipo inválido.',
});
export type TaskKind = z.infer<typeof TaskKind>;

export const TASK_KIND_LABELS: Record<TaskKind, string> = {
  follow_up: 'Follow-up',
  meeting: 'Reunião',
  proposal: 'Proposta',
  research: 'Investigar',
  other: 'Outro',
};

export const TaskStatus = z.enum(['open', 'done', 'cancelled']);
export type TaskStatus = z.infer<typeof TaskStatus>;

export const TaskCancelReason = z.enum(['opt_out', 'user', 'opportunity_closed']);
export type TaskCancelReason = z.infer<typeof TaskCancelReason>;

export const Task = z.object({
  id: Uuid,
  opportunityId: Uuid,
  companyId: Uuid,
  kind: TaskKind,
  title: z.string(),
  notes: z.string().nullable(),
  dueAt: z.string(),
  status: TaskStatus,
  origin: z.enum(['user', 'suggested', 'copilot']),
  completedAt: z.string().nullable(),
  cancelReason: TaskCancelReason.nullable(),
  isDemo: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Task = z.infer<typeof Task>;

export const CreateTaskInput = z.object({
  opportunityId: Uuid,
  kind: TaskKind.default('follow_up'),
  title: text(3, 200),
  notes: optional(1000),
  dueAt: IsoDateTime,
  origin: z.enum(['user', 'suggested', 'copilot']).default('user'),
});
export type CreateTaskInput = z.input<typeof CreateTaskInput>;

// -----------------------------------------------------------------------------
// Supressão (opt-out e pedidos para parar)
// -----------------------------------------------------------------------------

export const SuppressionReason = z.enum(['opt_out', 'refused', 'legal_request', 'manual']);
export type SuppressionReason = z.infer<typeof SuppressionReason>;

export const SUPPRESSION_REASON_LABELS: Record<SuppressionReason, string> = {
  opt_out: 'Pediu para não receber mais mensagens',
  refused: 'Recusou e pediu para não insistir',
  legal_request: 'Pedido de titular (LGPD)',
  manual: 'Marcado por você',
};

export const SuppressionSource = z.enum(['reply_rule', 'reply_ai', 'user']);
export type SuppressionSource = z.infer<typeof SuppressionSource>;

export const SuppressionEntry = z.object({
  id: Uuid,
  companyId: Uuid,
  cnpjRoot: z.string().nullable(),
  domain: z.string().nullable(),
  reason: SuppressionReason,
  source: SuppressionSource,
  interactionId: Uuid.nullable(),
  liftedAt: z.string().nullable(),
  liftReason: z.string().nullable(),
  createdAt: z.string(),
});
export type SuppressionEntry = z.infer<typeof SuppressionEntry>;

export const SuppressCompanyInput = z.object({
  companyId: Uuid,
  reason: SuppressionReason.default('manual'),
});
export type SuppressCompanyInput = z.input<typeof SuppressCompanyInput>;

export const LiftSuppressionInput = z.object({
  /** Empresa do dossiê onde a retirada foi pedida: só a dona da supressão pode retirá-la. */
  companyId: Uuid,
  suppressionId: Uuid,
  reason: text(10, 300),
});
export type LiftSuppressionInput = z.input<typeof LiftSuppressionInput>;

// -----------------------------------------------------------------------------
// Pedidos à IA
// -----------------------------------------------------------------------------

export const PrepareApproachInput = z.object({
  companyId: Uuid,
  /** Oferta escolhida; sem ela, usa a da oportunidade, a recomendada ou a única ativa. */
  offerId: Uuid.nullable().default(null),
  kind: MessageKind.default('initial_email'),
  tone: MessageTone.default('consultative'),
  /** Pedido livre do usuário ("cite a expansão para Campinas"); é dado, não instrução de sistema. */
  instruction: optional(500),
  /**
   * Ângulo da tese aprovado (Parte 5.1). Sem ele: o principal, quando a tese tem um; "none" faz a
   * abordagem só pelo dossiê.
   */
  thesisAngle: ThesisChoice.optional(),
});
export type PrepareApproachInput = z.input<typeof PrepareApproachInput>;

export const RegenerateMessageInput = z.object({
  /** Versão de partida (a nova versão entra na mesma linha). */
  messageId: Uuid,
  kind: MessageKind.optional(),
  tone: MessageTone.optional(),
  instruction: optional(500),
});
export type RegenerateMessageInput = z.input<typeof RegenerateMessageInput>;

export const NewVariantInput = z.object({
  opportunityId: Uuid,
  kind: MessageKind,
  tone: MessageTone.default('consultative'),
  channel: MessageChannel.optional(),
  instruction: optional(500),
  /** Resposta a uma mensagem recebida (usa a interpretação dela). */
  replyToInteractionId: Uuid.nullable().default(null),
});
export type NewVariantInput = z.input<typeof NewVariantInput>;

export const EditMessageInput = z.object({
  messageId: Uuid,
  subject: optional(200),
  body: text(20, 6000),
});
export type EditMessageInput = z.input<typeof EditMessageInput>;

/** Saída da IA ao preparar a abordagem: estratégia + primeira mensagem (JSON pedido ao modelo). */
export const ApproachAiOutput = z.object({
  strategy: ApproachStrategyContent,
  message: MessageDraftText,
});
export type ApproachAiOutput = z.infer<typeof ApproachAiOutput>;

export const RevokeApprovalInput = z.object({
  approvalId: Uuid,
  reason: text(3, 300),
});
export type RevokeApprovalInput = z.input<typeof RevokeApprovalInput>;

export const RescheduleTaskInput = z.object({
  taskId: Uuid,
  dueAt: IsoDateTime,
});
export type RescheduleTaskInput = z.input<typeof RescheduleTaskInput>;

/** Filtros da lista e do kanban. */
export const OpportunityListFilter = z.object({
  stages: z.array(OpportunityStage).max(10).optional(),
  includeClosed: z.boolean().default(false),
  priority: OpportunityPriority.optional(),
  search: z.string().trim().max(120).optional(),
  /** Só empresas com supressão (true) ou sem (false). */
  suppressed: z.boolean().optional(),
});
export type OpportunityListFilter = z.input<typeof OpportunityListFilter>;

export const ApproveMessageInput = z.object({
  messageId: Uuid,
  /** Hash do texto que a tela mostrava: se mudou, a aprovação é recusada. */
  payloadHash: Sha256Hex,
});
export type ApproveMessageInput = z.input<typeof ApproveMessageInput>;

// -----------------------------------------------------------------------------
// Atenção (visão geral e Copiloto)
// -----------------------------------------------------------------------------

export const AttentionKind = z.enum([
  'task_overdue',
  'task_due_today',
  'reply_waiting_us',
  'awaiting_their_reply',
  'no_next_step',
  'draft_to_review',
  'stale',
  'missing_info',
]);
export type AttentionKind = z.infer<typeof AttentionKind>;

export const ATTENTION_LABELS: Record<AttentionKind, string> = {
  task_overdue: 'Follow-up vencido',
  task_due_today: 'Follow-up para hoje',
  reply_waiting_us: 'Respondeu e espera retorno',
  awaiting_their_reply: 'Aguardando resposta',
  no_next_step: 'Sem próximo passo',
  draft_to_review: 'Rascunho para revisar',
  stale: 'Sem contato há muito tempo',
  missing_info: 'Faltam informações',
};

export const AttentionItem = z.object({
  kind: AttentionKind,
  opportunityId: Uuid,
  companyId: Uuid,
  companyName: z.string(),
  /** Explicação curta, com a data que a justifica. */
  detail: z.string(),
  /** Instante de referência (vencimento, último contato). */
  at: z.string().nullable(),
  /** Ordem: menor = mais urgente. */
  rank: z.number().int(),
  /** Oportunidade ou empresa de demonstração (selo DEMO na tela). */
  isDemo: z.boolean(),
});
export type AttentionItem = z.infer<typeof AttentionItem>;
