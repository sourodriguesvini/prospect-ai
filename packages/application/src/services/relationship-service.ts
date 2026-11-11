import {
  AI_ERROR_MESSAGES,
  APPROVAL_PROBLEM_LABELS,
  ApproachAiOutput,
  ApproveMessageInput,
  ChangeStageInput,
  CreateTaskInput,
  EMPTY_APPROACH_INSIGHTS,
  EditMessageInput,
  LiftSuppressionInput,
  MessageDraftText,
  NewVariantInput,
  OPPORTUNITY_STAGES,
  OpenOpportunityInput,
  OpportunityListFilter,
  PrepareApproachInput,
  RecordInboundInput,
  RecordNoteInput,
  RecordOutboundInput,
  RegenerateMessageInput,
  ReplyAnalysis,
  RescheduleTaskInput,
  RevokeApprovalInput,
  SuppressCompanyInput,
  UpdateOpportunityInput,
  Uuid,
  type AiErrorCode,
  type ApproachClearance,
  type ApproachInsights,
  type ApproachPlan,
  type ApproachStrategyContent,
  type Approval,
  type ApprovalProblem,
  type AttentionItem,
  type Company,
  type EffectiveMessageStatus,
  type Interaction,
  type MessageChannel,
  type MessageKind,
  type Offer,
  type Opportunity,
  type OpportunityStage,
  type OpportunitySummary,
  type OutboundMessage,
  type StageChange,
  type StrategySnapshot,
  type SuppressionEntry,
  type Task,
} from '@prospector/contracts';
import {
  APPROVAL_VALIDITY_DAYS,
  approvalProblems,
  assessApproachBasis,
  attentionItems,
  isClosedStage,
  channelIssues,
  contactState,
  isCitableClaim,
  type ContactState,
  messageIssues,
  messagePayload,
  withContactFooter,
  withoutContactFooter,
  detectStopRequest,
  replyOwnText,
  type ApproachBasisAssessment,
  type MessageIssue,
} from '@prospector/domain';
import { calendarDayBounds, systemClock, type Clock } from '../clock';
import type { RequestContext } from '../context';
import { AppError, groupFieldErrors, isAppError, parseInput } from '../errors';
import type { AiTelemetryRepository } from '../ports/copilot-repository';
import type {
  AiCase,
  AiContext,
  AiOutcome,
  ApproachInsightsSource,
  RelationshipAi,
} from '../ports/relationship-ai';
import type {
  NewOutboundMessage,
  OpportunitySummaryRow,
  RelationshipRepository,
  StageMove,
} from '../ports/relationship-repository';
import type { CompanyDossier, CompanyService } from './company-service';
import { pendingAudit } from './pending-audit';
import type { StrategyService } from './strategy-service';

/**
 * Relacionamento (ADR-0014): oportunidades, estratégia de abordagem, rascunhos versionados,
 * aprovação de uso, interações, follow-ups e supressão. Nada aqui envia mensagem: o envio é
 * manual, feito pelo usuário fora do app; o serviço prepara, confere e registra. Etapa só muda
 * por pedido explícito do usuário (inclusive pela caixa marcada no formulário de registro).
 */

const DAY_MS = 86_400_000;
/** Texto recebido guardado por 12 meses (minimização, docs/12 §6). */
const RETENTION_DAYS = 365;
/** Registro de contato com data no futuro: tolerância para relógios diferentes. */
const FUTURE_TOLERANCE_MS = 10 * 60_000;
const MAX_CASES = 5;
const MAX_GAPS = 6;
/** Etapas antes do contato: "mover para Contatada" só faz sentido a partir delas. */
const BEFORE_CONTACT: ReadonlySet<OpportunityStage> = new Set([
  'identified',
  'qualified',
  'approach_ready',
]);
const BEFORE_CONVERSATION: ReadonlySet<OpportunityStage> = new Set([
  'identified',
  'qualified',
  'approach_ready',
  'contacted',
]);

export type RelationshipAiFailureCode =
  AiErrorCode | 'invalid_output' | 'context_too_large' | 'no_ai';

export const RELATIONSHIP_AI_MESSAGES: Record<
  'invalid_output' | 'context_too_large' | 'no_ai',
  string
> = {
  invalid_output:
    'A IA local devolveu uma resposta fora do formato esperado. Nada foi salvo; tente de novo.',
  context_too_large:
    'O pedido passou do que a IA local lê de uma vez (texto colado, versão anterior ou pedido longos). Nada foi salvo: encurte o pedido ou escreva a mensagem à mão.',
  no_ai:
    'A IA local não está disponível agora. Você pode escrever a mensagem à mão em "Nova mensagem".',
};

export interface RelationshipAiFailure {
  code: RelationshipAiFailureCode;
  message: string;
}

function aiFailure(code: RelationshipAiFailureCode): RelationshipAiFailure {
  const message =
    code === 'invalid_output' || code === 'context_too_large' || code === 'no_ai'
      ? RELATIONSHIP_AI_MESSAGES[code]
      : AI_ERROR_MESSAGES[code];
  return { code, message };
}

/** Versão mais recente de uma linha de mensagens, com o que a tela e a aprovação precisam. */
export interface MessageView {
  message: OutboundMessage;
  status: EffectiveMessageStatus;
  /** Quantas versões a linha tem. */
  versionCount: number;
  approval: Approval | null;
  /** Por que a aprovação não pode ser usada agora (vazio = pode registrar o contato). */
  problems: ApprovalProblem[];
  /** O que impede aprovar este rascunho (vazio = pode, se a conformidade estiver liberada). */
  issues: MessageIssue[];
  /** Ainda não houve contato feito com esta oportunidade. */
  firstContact: boolean;
  /** Estado do contato que decide identificação, opt-out e canais (domínio, `contactState`). */
  contact: ContactState;
}

export interface ComplianceState {
  ready: boolean;
  /** O que falta, em pt-BR (checklist da barreira de abordagem). */
  missing: string[];
}

export interface OpportunityDetail {
  opportunity: OpportunitySummary;
  company: Company;
  stageChanges: StageChange[];
  /** Estratégia vigente (a versão mais recente não descartada). */
  plan: ApproachPlan | null;
  planCount: number;
  /** Uma por linha de mensagens (versão mais recente), mais recente primeiro. */
  threads: MessageView[];
  /** Versões anteriores, por linha. */
  previousVersions: Record<string, OutboundMessage[]>;
  interactions: Interaction[];
  tasks: Task[];
  activeSuppressions: SuppressionEntry[];
  compliance: ComplianceState;
  /** Em que pé está o contato (identificação, opt-out e canais da próxima mensagem). */
  contact: ContactState;
  /** Base de evidência da empresa para gerar abordagem (null se o dossiê não pôde ser lido). */
  basis: ApproachBasisAssessment;
  /** Diagnóstico de Empresas que a abordagem usa (KI-129); vazio sem investigação concluída. */
  insights: ApproachInsights;
  readAt: string;
}

export interface RelationshipOverview {
  opportunities: OpportunitySummary[];
  attention: AttentionItem[];
  byStage: Record<OpportunityStage, number>;
  openCount: number;
  draftsToReview: number;
  tasksOverdue: number;
  tasksToday: number;
  /** Soma dos valores informados (só os com base), em centavos. */
  valueWithBasisCents: number;
  valuedCount: number;
  readAt: string;
}

export interface CompanyRelationship {
  open: OpportunitySummary | null;
  closed: OpportunitySummary[];
  activeSuppressions: SuppressionEntry[];
  /** Diagnóstico de Empresas que "Preparar abordagem" vai usar (KI-129). */
  insights: ApproachInsights;
}

export interface ApprovalQueueItem {
  view: MessageView;
  opportunity: OpportunitySummary;
  /** Conformidade da oferta desta oportunidade (cada item tem a sua). */
  compliance: ComplianceState;
}

export interface ApprovalQueue {
  pending: ApprovalQueueItem[];
  recent: Array<{
    approval: Approval;
    message: OutboundMessage | null;
    opportunity: OpportunitySummary | null;
    problems: ApprovalProblem[];
  }>;
  compliance: ComplianceState;
  readAt: string;
}

export type PrepareApproachResult =
  | {
      status: 'created';
      opportunity: Opportunity;
      plan: ApproachPlan;
      message: OutboundMessage;
      gaps: string[];
    }
  | { status: 'ai_failed'; failure: RelationshipAiFailure };

export type GenerateMessageResult =
  | { status: 'created'; message: OutboundMessage }
  | { status: 'ai_failed'; failure: RelationshipAiFailure };

export type AnalyzeReplyResult =
  | { status: 'analyzed'; interaction: Interaction; suppressedByAi: boolean }
  | { status: 'ai_failed'; failure: RelationshipAiFailure };

export interface RecordInboundResult {
  interaction: Interaction;
  /** Pedido explícito para parar detectado pela regra: a empresa foi suprimida na hora. */
  stopDetected: boolean;
  stopPhrase: string | null;
}

export interface RecordNoteResult {
  interaction: Interaction;
  /** A nota relata um pedido para parar: a empresa foi suprimida na hora (com a nota de origem). */
  stopDetected: boolean;
}

export interface RelationshipService {
  overview(ctx: RequestContext): Promise<RelationshipOverview>;
  listOpportunities(ctx: RequestContext, filter?: unknown): Promise<OpportunitySummary[]>;
  opportunity(ctx: RequestContext, id: string): Promise<OpportunityDetail>;
  forCompany(ctx: RequestContext, companyId: string): Promise<CompanyRelationship>;
  approvalQueue(ctx: RequestContext): Promise<ApprovalQueue>;

  /** Idempotente: se a empresa já tem oportunidade aberta, devolve essa (created: false). */
  openOpportunity(
    ctx: RequestContext,
    raw: unknown,
  ): Promise<{ opportunity: Opportunity; created: boolean }>;
  changeStage(ctx: RequestContext, raw: unknown): Promise<Opportunity>;
  updateOpportunity(ctx: RequestContext, raw: unknown): Promise<Opportunity>;

  prepareApproach(
    ctx: RequestContext,
    raw: unknown,
    signal?: AbortSignal,
  ): Promise<PrepareApproachResult>;
  discardPlan(ctx: RequestContext, planId: string): Promise<void>;
  regenerateMessage(
    ctx: RequestContext,
    raw: unknown,
    signal?: AbortSignal,
  ): Promise<GenerateMessageResult>;
  newMessage(
    ctx: RequestContext,
    raw: unknown,
    signal?: AbortSignal,
  ): Promise<GenerateMessageResult>;
  /** Rascunho escrito pelo usuário, sem IA (nova linha). */
  writeMessage(ctx: RequestContext, raw: unknown): Promise<OutboundMessage>;
  editMessage(ctx: RequestContext, raw: unknown): Promise<OutboundMessage>;
  discardMessage(ctx: RequestContext, messageId: string): Promise<void>;
  approveMessage(ctx: RequestContext, raw: unknown): Promise<Approval>;
  revokeApproval(ctx: RequestContext, raw: unknown): Promise<void>;

  recordOutbound(ctx: RequestContext, raw: unknown): Promise<Interaction>;
  recordInbound(ctx: RequestContext, raw: unknown): Promise<RecordInboundResult>;
  analyzeReply(
    ctx: RequestContext,
    interactionId: string,
    signal?: AbortSignal,
  ): Promise<AnalyzeReplyResult>;
  /** Rascunho de resposta a partir da sugestão da interpretação (sem nova chamada à IA). */
  draftSuggestedReply(ctx: RequestContext, interactionId: string): Promise<OutboundMessage>;
  recordNote(ctx: RequestContext, raw: unknown): Promise<RecordNoteResult>;

  createTask(ctx: RequestContext, raw: unknown): Promise<Task>;
  completeTask(ctx: RequestContext, taskId: string): Promise<Task>;
  cancelTask(ctx: RequestContext, taskId: string): Promise<Task>;
  rescheduleTask(ctx: RequestContext, raw: unknown): Promise<Task>;

  suppressCompany(ctx: RequestContext, raw: unknown): Promise<SuppressionEntry>;
  liftSuppression(ctx: RequestContext, raw: unknown): Promise<SuppressionEntry>;
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function messageHash(message: {
  channel: MessageChannel;
  subject: string | null;
  body: string;
}): Promise<string> {
  return sha256(messagePayload(message));
}

/** Escrito pelo usuário: nova linha de mensagem sem IA. */
const WriteMessageInput = NewVariantInput.pick({
  opportunityId: true,
  kind: true,
  replyToInteractionId: true,
}).extend({
  channel: NewVariantInput.shape.channel.unwrap(),
  subject: EditMessageInput.shape.subject,
  body: EditMessageInput.shape.body,
});

function offerById(snapshot: StrategySnapshot, offerId: string | null): Offer | null {
  if (!offerId) return null;
  return snapshot.offers.find((offer) => offer.id === offerId && offer.current) ?? null;
}

/** Cases citáveis: autorizados (publicOk com registro), não arquivados, da oferta ou gerais. */
function citableCases(
  snapshot: StrategySnapshot,
  offerId: string | null,
  demoCompany: boolean,
): AiCase[] {
  return snapshot.proofAssets
    .filter(
      (asset) =>
        asset.publicOk &&
        asset.consentRef &&
        !asset.archivedAt &&
        // Case de demonstração nunca vai para mensagem de empresa real (regra 4).
        (!asset.isDemo || demoCompany) &&
        (asset.offerId === null || asset.offerId === offerId),
    )
    .slice(0, MAX_CASES)
    .map((asset) => ({
      id: asset.id,
      title: asset.title,
      segment: asset.segment,
      summary: asset.summary,
      results: asset.results,
    }));
}

/** Canal sugerido pela IA, trocado por e-mail se não for permitido no estado do contato. */
function channelFor(
  kind: MessageKind,
  suggested: MessageChannel,
  state: ContactState,
): MessageChannel {
  if (kind === 'initial_email') return 'email';
  return channelIssues(suggested, state).length === 0 ? suggested : 'email';
}

/**
 * A empresa já tem um pedido para parar dela própria (não herdado pela raiz do CNPJ ou pelo
 * domínio, nem só a supressão manual): um novo pedido não precisa de outra entrada.
 */
function hasOwnStop(active: readonly SuppressionEntry[], companyId: string): boolean {
  return active.some(
    (entry) =>
      entry.companyId === companyId &&
      (entry.reason === 'opt_out' || entry.reason === 'legal_request'),
  );
}

/** Aprovações já usadas num contato feito (uso único). */
function usedApprovalIds(interactions: readonly Interaction[]): Set<string> {
  return new Set(
    interactions
      .filter((item) => item.direction === 'outbound' && item.approvalId)
      .map((item) => item.approvalId as string),
  );
}

/** O que o rodapé obrigatório usa da política de contato vigente. */
function footerPolicy(snapshot: StrategySnapshot): {
  optOutText: string | null;
  privacyContact: string | null;
} {
  const policy = snapshot.contactPolicy?.content ?? null;
  return { optOutText: policy?.optOutText ?? null, privacyContact: policy?.privacyContact ?? null };
}

/** Só o que o dossiê sustenta: ids desconhecidos saem, e ponto sem nenhum id válido sai. */
function groundStrategy(
  strategy: ApproachStrategyContent,
  allowedClaims: ReadonlySet<string>,
  allowedCases: ReadonlySet<string>,
  deterministicGaps: readonly string[],
): { content: ApproachStrategyContent; claimIds: string[] } {
  const evidence = strategy.evidence
    .map((point) => ({
      statement: point.statement,
      claimIds: point.claimIds.filter((id) => allowedClaims.has(id)),
    }))
    .filter((point) => point.claimIds.length > 0);
  // As lacunas do Prospector vêm primeiro: viram sugestão de investigação e não podem sumir no corte.
  const gaps = [...new Set([...deterministicGaps, ...strategy.gaps])].slice(0, MAX_GAPS);
  const claimIds = [...new Set(evidence.flatMap((point) => point.claimIds))];
  return {
    content: {
      ...strategy,
      evidence,
      gaps,
      caseIds: strategy.caseIds.filter((id) => allowedCases.has(id)),
    },
    claimIds,
  };
}

export function createRelationshipService(deps: {
  repo: RelationshipRepository;
  companies: CompanyService;
  strategy: StrategyService;
  /** null = IA local indisponível (o resto do módulo continua funcionando). */
  ai: RelationshipAi | null;
  insights?: ApproachInsightsSource;
  telemetry: AiTelemetryRepository | null;
  /** Saída da IA vem de fixture (E2E): o que ela gerar fica marcado como demonstração. */
  syntheticAi?: boolean;
  clock?: Clock;
  newId?: () => string;
}): RelationshipService {
  const { repo, companies, strategy } = deps;
  const clock = deps.clock ?? systemClock;
  const newId = deps.newId ?? (() => crypto.randomUUID());
  const insightsSource: ApproachInsightsSource = deps.insights ?? {
    forCompany: async () => EMPTY_APPROACH_INSIGHTS,
  };
  const synthetic = deps.syntheticAi ?? false;

  // ---------------------------------------------------------------------------
  // Leitura de apoio
  // ---------------------------------------------------------------------------

  async function requireOpportunity(id: string): Promise<Opportunity> {
    const parsed = Uuid.safeParse(id);
    const found = parsed.success ? await repo.getOpportunity(parsed.data) : null;
    if (!found) throw new AppError('not_found', 'not_found');
    return found;
  }

  async function requireOpen(id: string): Promise<Opportunity> {
    const found = await requireOpportunity(id);
    if (found.closedAt) throw new AppError('conflict', 'opportunity_closed');
    return found;
  }

  async function requireMessage(id: string): Promise<OutboundMessage> {
    const parsed = Uuid.safeParse(id);
    const found = parsed.success ? await repo.getMessage(parsed.data) : null;
    if (!found) throw new AppError('not_found', 'not_found');
    return found;
  }

  /** A versão pedida precisa ser a mais recente da linha (a tela estava atualizada). */
  async function requireLatest(id: string): Promise<OutboundMessage> {
    const message = await requireMessage(id);
    const latest = await repo.latestVersionOf(message.threadId);
    if (!latest || latest.id !== message.id) throw new AppError('conflict', 'concurrent_change');
    return message;
  }

  async function requireInteraction(id: string): Promise<Interaction> {
    const parsed = Uuid.safeParse(id);
    const found = parsed.success ? await repo.getInteraction(parsed.data) : null;
    if (!found) throw new AppError('not_found', 'not_found');
    return found;
  }

  async function requireTask(id: string): Promise<Task> {
    const parsed = Uuid.safeParse(id);
    const found = parsed.success ? await repo.getTask(parsed.data) : null;
    if (!found) throw new AppError('not_found', 'not_found');
    return found;
  }

  async function snapshotOf(ctx: RequestContext): Promise<StrategySnapshot> {
    return (await strategy.overview(ctx)).snapshot;
  }

  async function isSuppressed(company: Company): Promise<boolean> {
    return (await repo.activeSuppressions(company)).length > 0;
  }

  async function assertNotSuppressed(company: Company): Promise<void> {
    if (await isSuppressed(company)) throw new AppError('conflict', 'company_suppressed');
  }

  /** Em que pé está o contato: decide identificação, opt-out e canais (ADR-0014). */
  async function contactStateOf(opportunityId: string): Promise<ContactState> {
    return contactState(await repo.listInteractions({ opportunityId }));
  }

  async function compliance(
    ctx: RequestContext,
    offerId: string | null,
  ): Promise<ComplianceState & { clearance: ApproachClearance | null }> {
    if (!offerId) {
      return {
        ready: false,
        missing: ['Escolha a oferta desta oportunidade (em Detalhes).'],
        clearance: null,
      };
    }
    try {
      const clearance = await strategy.assertReadyToApproach(ctx, { offerId });
      return { ready: true, missing: [], clearance };
    } catch (error) {
      if (isAppError(error) && error.reason === 'approach_blocked') {
        return {
          ready: false,
          missing: Object.values(error.fieldErrors ?? {}).flat(),
          clearance: null,
        };
      }
      throw error;
    }
  }

  function withOfferName(
    row: OpportunitySummaryRow,
    snapshot: StrategySnapshot,
  ): OpportunitySummary {
    const offer = row.offerId ? snapshot.offers.find((item) => item.id === row.offerId) : null;
    return { ...row, offerName: offer?.current?.content.name ?? null };
  }

  function aiContext(
    dossier: CompanyDossier,
    insights: ApproachInsights,
    offer: Offer,
    snapshot: StrategySnapshot,
  ): AiContext {
    const content = offer.current!.content;
    const company = dossier.company;
    return {
      company: {
        displayName: company.displayName,
        city: company.city,
        uf: company.uf,
        cnaeMain: company.cnaeMain,
        sizeBand: company.sizeBand,
        primaryDomain: company.primaryDomain,
        individual: dossier.individual,
      },
      // A IA só vê o que pode citar: em vigor, sem hipótese nem confiança baixa (ADR-0014).
      claims: dossier.claims
        .filter((view) => isCitableClaim(view.claim, clock.now()))
        .map((view) => ({
          id: view.claim.id,
          domain: view.claim.domain,
          statement: view.claim.statement,
          epistemicType: view.claim.epistemicType,
          band: view.band,
        })),
      insights,
      offer: {
        name: content.name,
        description: content.description,
        problems: content.problems,
        needSignals: content.needSignals,
        deliverables: content.deliverables,
        valueProps: content.valueProps,
      },
      voice: snapshot.voiceGuide?.content ?? null,
      agencyName: snapshot.contactPolicy?.content.agencyName ?? null,
      optOutText: snapshot.contactPolicy?.content.optOutText ?? null,
      cases: citableCases(snapshot, offer.id, company.isDemo),
    };
  }

  /** `invalidOutput`: a resposta veio, mas não passou na validação (conta como erro). */
  async function recordAi(
    ctx: RequestContext,
    outcome: AiOutcome,
    invalidOutput = false,
  ): Promise<void> {
    if (!deps.telemetry) return;
    await deps.telemetry.recordLlmCall({
      task: 'copilot',
      provider: 'ollama',
      model: (outcome.model ?? '').slice(0, 120) || 'desconhecido',
      promptVersion: outcome.promptId,
      traceId: ctx.traceId,
      threadId: null,
      jobId: null,
      status: !outcome.ok
        ? outcome.code === 'cancelled'
          ? 'cancelled'
          : 'error'
        : invalidOutput
          ? 'error'
          : 'ok',
      errorCode: !outcome.ok ? outcome.code : invalidOutput ? 'invalid_output' : null,
      doneReason: outcome.ok ? (outcome.doneReason?.slice(0, 40) ?? null) : null,
      inputTokens: outcome.usage?.inputTokens ?? null,
      outputTokens: outcome.usage?.outputTokens ?? null,
      totalMs: outcome.usage?.totalMs ?? null,
      loadMs: outcome.usage?.loadMs ?? null,
    });
  }

  function currentPlan(plans: readonly ApproachPlan[]): ApproachPlan | null {
    return plans.find((plan) => plan.status !== 'discarded') ?? null;
  }

  async function insertVersion(
    ctx: RequestContext,
    row: Omit<NewOutboundMessage, 'payloadHash'>,
    action: string,
  ): Promise<OutboundMessage> {
    const payloadHash = await messageHash(row);
    return repo.insertMessage(
      { ...row, payloadHash },
      pendingAudit(ctx, {
        action,
        entityType: 'outbound_message',
        diff: { opportunityId: row.opportunityId, threadId: row.threadId, origin: row.origin },
        withVersion: true,
      }),
    );
  }

  async function buildViews(
    ctx: RequestContext,
    opportunity: Opportunity,
    company: Company,
    snapshot: StrategySnapshot,
  ): Promise<{
    threads: MessageView[];
    previousVersions: Record<string, OutboundMessage[]>;
    compliance: ComplianceState;
    firstContact: boolean;
    contact: ContactState;
  }> {
    const [messages, approvals, interactions, suppressed, state] = await Promise.all([
      repo.listMessages({ opportunityId: opportunity.id }),
      repo.listApprovals({ opportunityId: opportunity.id }),
      repo.listInteractions({ opportunityId: opportunity.id }),
      isSuppressed(company),
      compliance(ctx, opportunity.offerId),
    ]);
    const policy = snapshot.contactPolicy?.content ?? null;
    const contact = contactState(interactions);
    const usedApprovals = usedApprovalIds(interactions);
    const byThread = new Map<string, OutboundMessage[]>();
    for (const message of messages) {
      const list = byThread.get(message.threadId) ?? [];
      list.push(message);
      byThread.set(message.threadId, list);
    }
    const approvalById = new Map(approvals.map((approval) => [approval.id, approval]));
    const now = clock.now();
    const threads: MessageView[] = [];
    const previousVersions: Record<string, OutboundMessage[]> = {};
    for (const [threadId, versions] of byThread) {
      versions.sort((a, b) => b.version - a.version);
      const [latest, ...older] = versions as [OutboundMessage, ...OutboundMessage[]];
      previousVersions[threadId] = older;
      const approval = latest.approvalId ? (approvalById.get(latest.approvalId) ?? null) : null;
      const problems =
        latest.status === 'approved'
          ? approvalProblems({
              message: latest,
              isLatestVersion: true,
              approval,
              currentHash: await messageHash(latest),
              suppressed,
              complianceReady: state.ready,
              used: usedApprovals.has(latest.approvalId ?? ''),
              now,
            })
          : [];
      const issues =
        latest.status === 'draft'
          ? messageIssues({
              channel: latest.channel,
              subject: latest.subject,
              body: latest.body,
              ...contact,
              agencyName: policy?.agencyName ?? null,
              optOutText: policy?.optOutText ?? null,
              privacyContact: policy?.privacyContact ?? null,
            })
          : [];
      threads.push({
        message: latest,
        status: latest.status,
        versionCount: versions.length,
        approval,
        problems,
        issues,
        firstContact: contact.firstContact,
        contact,
      });
    }
    threads.sort((a, b) => b.message.createdAt.localeCompare(a.message.createdAt));
    return {
      threads,
      previousVersions,
      compliance: { ready: state.ready, missing: state.missing },
      firstContact: contact.firstContact,
      contact,
    };
  }

  /** Abre a oportunidade (ou devolve a aberta), sem pedir a empresa de novo. */
  async function ensureOpportunity(
    ctx: RequestContext,
    company: Company,
    offerId: string | null,
    stage: 'identified' | 'qualified' | 'approach_ready',
    source: Opportunity['source'],
  ): Promise<{ opportunity: Opportunity; created: boolean }> {
    const existing = await repo.openOpportunityFor(company.id);
    if (existing) return { opportunity: existing, created: false };
    try {
      const opportunity = await repo.openOpportunity(
        {
          id: newId(),
          companyId: company.id,
          offerId,
          stage,
          priority: 'medium',
          source,
          isDemo: company.isDemo,
        },
        pendingAudit(ctx, {
          action: 'relationship.opportunity.opened',
          entityType: 'opportunity',
          diff: { companyId: company.id, stage, source },
        }),
      );
      return { opportunity, created: true };
    } catch (error) {
      if (isAppError(error) && error.reason === 'opportunity_open_exists') {
        const current = await repo.openOpportunityFor(company.id);
        if (current) return { opportunity: current, created: false };
      }
      throw error;
    }
  }

  async function setOffer(
    ctx: RequestContext,
    opportunity: Opportunity,
    offerId: string,
  ): Promise<Opportunity> {
    if (opportunity.offerId === offerId) return opportunity;
    return repo.updateOpportunity(
      opportunity.id,
      {
        offerId,
        priority: opportunity.priority,
        valueEstimateCents: opportunity.valueEstimateCents,
        valueBasis: opportunity.valueBasis,
        nextAction: opportunity.nextAction,
        nextActionDueAt: opportunity.nextActionDueAt,
        lostReason: opportunity.lostReason,
      },
      pendingAudit(ctx, {
        action: 'relationship.opportunity.updated',
        entityType: 'opportunity',
        entityId: opportunity.id,
        diff: { fields: ['offerId'] },
      }),
    );
  }

  function assertNotFuture(occurredAt: string): void {
    if (Date.parse(occurredAt) > clock.now().getTime() + FUTURE_TOLERANCE_MS) {
      throw new AppError('validation', 'invalid_input', {
        fieldErrors: { occurredAt: ['A data não pode estar no futuro.'] },
      });
    }
  }

  function retentionUntil(): string {
    return new Date(clock.now().getTime() + RETENTION_DAYS * DAY_MS).toISOString();
  }

  /** Mensagem gerada pela IA: valida, completa o opt-out no primeiro contato e grava. */
  async function generateMessage(
    ctx: RequestContext,
    args: {
      opportunity: Opportunity;
      dossier: CompanyDossier;
      kind: MessageKind;
      tone: NonNullable<OutboundMessage['tone']>;
      channel: MessageChannel;
      instruction: string | null;
      previous: OutboundMessage | null;
      replyTo: Interaction | null;
      signal: AbortSignal | undefined;
    },
  ): Promise<GenerateMessageResult> {
    if (!deps.ai) return { status: 'ai_failed', failure: aiFailure('no_ai') };
    const snapshot = await snapshotOf(ctx);
    const offer = offerById(snapshot, args.opportunity.offerId);
    if (!offer) {
      throw new AppError('validation', 'invalid_input', {
        fieldErrors: { offerId: ['Escolha a oferta desta oportunidade (em Detalhes).'] },
      });
    }
    const insights = await insightsSource.forCompany(ctx, args.dossier.company.id);
    const plans = await repo.listPlans(args.opportunity.id);
    const plan = currentPlan(plans);
    const contact = await contactStateOf(args.opportunity.id);
    const channel = channelFor(args.kind, args.channel, contact);
    const context = aiContext(args.dossier, insights, offer, snapshot);
    const outcome = await deps.ai.message(
      {
        ...context,
        kind: args.kind,
        tone: args.tone,
        channel,
        firstContact: contact.firstContact,
        strategy: plan?.content ?? null,
        // A versão anterior vai sem o rodapé (o sistema o acrescenta de novo, sem duplicar) e a
        // resposta da empresa vai sem o texto citado (a nossa própria mensagem).
        previous: args.previous
          ? {
              subject: args.previous.subject,
              body: withoutContactFooter(args.previous.body, footerPolicy(snapshot)),
            }
          : null,
        replyTo: args.replyTo
          ? { body: replyOwnText(args.replyTo.body ?? ''), analysis: args.replyTo.analysis }
          : null,
        instruction: args.instruction,
      },
      args.signal,
    );
    if (!outcome.ok) {
      await recordAi(ctx, outcome);
      return { status: 'ai_failed', failure: aiFailure(outcome.code) };
    }
    const parsed = MessageDraftText.safeParse(outcome.data);
    await recordAi(ctx, outcome, !parsed.success);
    if (!parsed.success) return { status: 'ai_failed', failure: aiFailure('invalid_output') };
    // O rodapé vale pelo estado do contato, qualquer que seja o tipo (ADR-0014): opt-out até a
    // empresa responder e, no primeiro contato, o canal do titular. Quem garante é o sistema.
    const body = withContactFooter(parsed.data.body, footerPolicy(snapshot), contact);
    const id = newId();
    const message = await insertVersion(
      ctx,
      {
        id,
        opportunityId: args.opportunity.id,
        planId: args.previous?.planId ?? plan?.id ?? null,
        replyToInteractionId: args.replyTo?.id ?? args.previous?.replyToInteractionId ?? null,
        kind: args.kind,
        channel,
        tone: args.tone,
        subject: channel === 'email' ? parsed.data.subject || null : null,
        body,
        threadId: args.previous?.threadId ?? id,
        origin: 'ai',
        claimIds: args.previous?.claimIds ?? plan?.claimIds ?? [],
        promptId: outcome.promptId,
        model: outcome.model,
        isDemo: synthetic || args.dossier.company.isDemo,
      },
      args.previous ? 'relationship.message.regenerated' : 'relationship.message.generated',
    );
    return { status: 'created', message };
  }

  // ---------------------------------------------------------------------------
  // Serviço
  // ---------------------------------------------------------------------------

  return {
    async overview(ctx) {
      const [rows, openTasks, drafts, snapshot] = await Promise.all([
        repo.listOpportunities({}),
        repo.listTasks({ status: 'open' }),
        repo.listMessages({ status: 'draft', latestOnly: true }),
        snapshotOf(ctx),
      ]);
      const opportunities = rows.map((row) => withOfferName(row, snapshot));
      const openIds = new Set(opportunities.map((item) => item.id));
      const draftsByOpportunity = new Map<string, number>();
      for (const draft of drafts) {
        if (!openIds.has(draft.opportunityId)) continue;
        draftsByOpportunity.set(
          draft.opportunityId,
          (draftsByOpportunity.get(draft.opportunityId) ?? 0) + 1,
        );
      }
      const now = clock.now();
      const day = calendarDayBounds(now);
      const tasks = openTasks.filter((task) => openIds.has(task.opportunityId));
      const attention = attentionItems({
        opportunities,
        openTasks: tasks,
        draftsByOpportunity,
        now,
        dayStart: day.start,
        dayEnd: day.end,
      });
      const byStage = Object.fromEntries(OPPORTUNITY_STAGES.map((stage) => [stage, 0])) as Record<
        OpportunityStage,
        number
      >;
      let valueWithBasisCents = 0;
      let valuedCount = 0;
      for (const item of opportunities) {
        byStage[item.stage] += 1;
        if (item.valueEstimateCents !== null && item.valueBasis) {
          valueWithBasisCents += item.valueEstimateCents;
          valuedCount += 1;
        }
      }
      return {
        opportunities,
        attention,
        byStage,
        openCount: opportunities.length,
        draftsToReview: [...draftsByOpportunity.values()].reduce((sum, n) => sum + n, 0),
        tasksOverdue: tasks.filter((task) => Date.parse(task.dueAt) < day.start.getTime()).length,
        tasksToday: tasks.filter((task) => {
          const due = Date.parse(task.dueAt);
          return due >= day.start.getTime() && due < day.end.getTime();
        }).length,
        valueWithBasisCents,
        valuedCount,
        readAt: now.toISOString(),
      };
    },

    async listOpportunities(ctx, raw) {
      const filter = parseInput(OpportunityListFilter, raw ?? {});
      const includeClosed =
        filter.includeClosed || (filter.stages ?? []).some((stage) => isClosedStage(stage));
      const [rows, snapshot] = await Promise.all([
        repo.listOpportunities({
          ...(filter.stages?.length ? { stages: filter.stages } : {}),
          includeClosed,
        }),
        snapshotOf(ctx),
      ]);
      const term = filter.search
        ? filter.search.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
        : '';
      return rows
        .map((row) => withOfferName(row, snapshot))
        .filter((item) => !filter.priority || item.priority === filter.priority)
        .filter((item) => filter.suppressed === undefined || item.suppressed === filter.suppressed)
        .filter(
          (item) =>
            !term ||
            item.companyName.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().includes(term),
        );
    },

    async opportunity(ctx, id) {
      const opportunity = await requireOpportunity(id);
      const [summaryRow, dossier, snapshot, stageChanges, plans, interactions, tasks] =
        await Promise.all([
          repo.getOpportunitySummary(opportunity.id),
          companies.dossier(ctx, opportunity.companyId),
          snapshotOf(ctx),
          repo.listStageChanges(opportunity.id),
          repo.listPlans(opportunity.id),
          repo.listInteractions({ opportunityId: opportunity.id }),
          repo.listTasks({ opportunityId: opportunity.id }),
        ]);
      if (!summaryRow) throw new AppError('not_found', 'not_found');
      const [views, activeSuppressions, insights] = await Promise.all([
        buildViews(ctx, opportunity, dossier.company, snapshot),
        repo.activeSuppressions(dossier.company),
        insightsSource.forCompany(ctx, dossier.company.id),
      ]);
      const now = clock.now();
      return {
        opportunity: withOfferName(summaryRow, snapshot),
        company: dossier.company,
        stageChanges,
        plan: currentPlan(plans),
        planCount: plans.length,
        threads: views.threads,
        previousVersions: views.previousVersions,
        interactions,
        tasks,
        activeSuppressions,
        compliance: views.compliance,
        contact: views.contact,
        basis: assessApproachBasis({
          claims: dossier.claims.map((view) => view.claim),
          insights,
          hasDomain: Boolean(dossier.company.primaryDomain),
          now,
        }),
        insights,
        readAt: now.toISOString(),
      };
    },

    async forCompany(ctx, companyId) {
      const id = parseInput(Uuid, companyId);
      const dossier = await companies.dossier(ctx, id);
      const [rows, snapshot, activeSuppressions, insights] = await Promise.all([
        repo.listOpportunities({ companyId: id, includeClosed: true }),
        snapshotOf(ctx),
        repo.activeSuppressions(dossier.company),
        insightsSource.forCompany(ctx, id),
      ]);
      const summaries = rows.map((row) => withOfferName(row, snapshot));
      return {
        open: summaries.find((item) => !item.closedAt) ?? null,
        closed: summaries.filter((item) => item.closedAt),
        activeSuppressions,
        insights,
      };
    },

    async approvalQueue(ctx) {
      const [drafts, approvals, rows, snapshot] = await Promise.all([
        repo.listMessages({ status: 'draft', latestOnly: true, limit: 100 }),
        repo.listApprovals({ limit: 50 }),
        repo.listOpportunities({ includeClosed: true }),
        snapshotOf(ctx),
      ]);
      const summaries = new Map(rows.map((row) => [row.id, withOfferName(row, snapshot)]));
      const policy = snapshot.contactPolicy?.content ?? null;
      const contactCache = new Map<string, ContactState>();
      const contactOf = async (opportunityId: string) => {
        const cached = contactCache.get(opportunityId);
        if (cached !== undefined) return cached;
        const value = await contactStateOf(opportunityId);
        contactCache.set(opportunityId, value);
        return value;
      };
      const now = clock.now();
      const offers = [...new Set(rows.map((row) => row.offerId).filter(Boolean))] as string[];
      const states = new Map<string, ComplianceState>();
      for (const offerId of offers) {
        const state = await compliance(ctx, offerId);
        states.set(offerId, { ready: state.ready, missing: state.missing });
      }
      const noOffer: ComplianceState = {
        ready: false,
        missing: ['Escolha a oferta desta oportunidade (em Detalhes).'],
      };
      const complianceOf = (offerId: string | null) =>
        (offerId ? states.get(offerId) : null) ?? noOffer;
      const pending: ApprovalQueueItem[] = [];
      for (const message of drafts) {
        const opportunity = summaries.get(message.opportunityId);
        if (!opportunity || opportunity.closedAt) continue;
        const contact = await contactOf(message.opportunityId);
        pending.push({
          opportunity,
          compliance: complianceOf(opportunity.offerId),
          view: {
            message,
            status: 'draft',
            versionCount: message.version,
            approval: null,
            problems: [],
            issues: messageIssues({
              channel: message.channel,
              subject: message.subject,
              body: message.body,
              ...contact,
              agencyName: policy?.agencyName ?? null,
              optOutText: policy?.optOutText ?? null,
              privacyContact: policy?.privacyContact ?? null,
            }),
            firstContact: contact.firstContact,
            contact,
          },
        });
      }
      const recent: ApprovalQueue['recent'] = [];
      for (const approval of approvals) {
        const message = await repo.getMessage(approval.entityId);
        const opportunity = summaries.get(approval.opportunityId) ?? null;
        const latest = message ? await repo.latestVersionOf(message.threadId) : null;
        const problems = message
          ? approvalProblems({
              message,
              isLatestVersion: latest?.id === message.id,
              approval,
              currentHash: await messageHash(message),
              suppressed: opportunity?.suppressed ?? false,
              complianceReady: complianceOf(opportunity?.offerId ?? null).ready,
              used: (await repo.listInteractions({ opportunityId: approval.opportunityId })).some(
                (item) => item.direction === 'outbound' && item.approvalId === approval.id,
              ),
              now,
            })
          : (['not_approved'] as ApprovalProblem[]);
        recent.push({ approval, message, opportunity, problems });
      }
      // A conformidade geral: a oferta mais usada nos rascunhos pendentes, ou a primeira ativa.
      const firstOffer =
        pending.find((item) => item.opportunity.offerId)?.opportunity.offerId ??
        snapshot.offers.find((offer) => offer.status === 'active')?.id ??
        null;
      const state = await compliance(ctx, firstOffer);
      return {
        pending,
        recent,
        compliance: { ready: state.ready, missing: state.missing },
        readAt: now.toISOString(),
      };
    },

    async openOpportunity(ctx, raw) {
      const input = parseInput(OpenOpportunityInput, raw);
      const dossier = await companies.dossier(ctx, input.companyId);
      if (dossier.company.lifecycle === 'archived') {
        throw new AppError('conflict', 'company_archived');
      }
      if (input.offerId && !offerById(await snapshotOf(ctx), input.offerId)) {
        throw new AppError('not_found', 'not_found');
      }
      return ensureOpportunity(ctx, dossier.company, input.offerId, input.stage, input.source);
    },

    async changeStage(ctx, raw) {
      const input = parseInput(ChangeStageInput, raw);
      if (input.fromStage === input.toStage) {
        throw new AppError('validation', 'invalid_input', {
          fieldErrors: { toStage: ['Escolha uma etapa diferente da atual.'] },
        });
      }
      if (input.toStage === 'lost' && !input.note) {
        throw new AppError('validation', 'invalid_input', {
          fieldErrors: { note: ['Diga o motivo da perda (fica no histórico).'] },
        });
      }
      const opportunity = await requireOpportunity(input.opportunityId);
      return repo.changeStage(
        opportunity.id,
        { from: input.fromStage, to: input.toStage, note: input.note },
        pendingAudit(ctx, {
          action: 'relationship.opportunity.stage_changed',
          entityType: 'opportunity',
          entityId: opportunity.id,
          diff: { from: input.fromStage, to: input.toStage },
        }),
      );
    },

    async updateOpportunity(ctx, raw) {
      const input = parseInput(UpdateOpportunityInput, raw);
      const opportunity = await requireOpportunity(input.opportunityId);
      if (input.offerId && input.offerId !== opportunity.offerId) {
        if (!offerById(await snapshotOf(ctx), input.offerId)) {
          throw new AppError('not_found', 'not_found');
        }
      }
      const patch = {
        offerId: input.offerId,
        priority: input.priority,
        valueEstimateCents: input.valueEstimateCents,
        valueBasis: input.valueBasis,
        nextAction: input.nextAction,
        nextActionDueAt: input.nextActionDueAt,
        lostReason: opportunity.stage === 'lost' ? input.lostReason : null,
      };
      const fields = (Object.keys(patch) as Array<keyof typeof patch>).filter(
        (key) => patch[key] !== opportunity[key],
      );
      if (fields.length === 0) return opportunity;
      return repo.updateOpportunity(
        opportunity.id,
        patch,
        pendingAudit(ctx, {
          action: 'relationship.opportunity.updated',
          entityType: 'opportunity',
          entityId: opportunity.id,
          diff: { fields },
        }),
      );
    },

    async prepareApproach(ctx, raw, signal) {
      const input = parseInput(PrepareApproachInput, raw);
      const dossier = await companies.dossier(ctx, input.companyId);
      const company = dossier.company;
      if (company.lifecycle === 'archived') throw new AppError('conflict', 'company_archived');
      await assertNotSuppressed(company);
      const existing = await repo.openOpportunityFor(company.id);
      const [snapshot, insights] = await Promise.all([
        snapshotOf(ctx),
        insightsSource.forCompany(ctx, company.id),
      ]);
      const activeOffers = snapshot.offers.filter(
        (offer) => offer.status === 'active' && offer.current,
      );
      const offer =
        offerById(snapshot, input.offerId) ??
        offerById(snapshot, existing?.offerId ?? null) ??
        offerById(snapshot, insights.recommendedService?.offerId ?? null) ??
        (activeOffers.length === 1 ? activeOffers[0]! : null);
      if (!offer) {
        throw new AppError('validation', 'invalid_input', {
          fieldErrors: { offerId: ['Escolha a oferta que você quer propor.'] },
        });
      }
      // A abordagem só propõe oferta ativa (ADR-0014, item 8): rascunho ou arquivada não sai.
      if (offer.status !== 'active') {
        throw new AppError('validation', 'invalid_input', {
          fieldErrors: {
            offerId: ['Esta oferta não está ativa. Ative-a em Estratégia ou escolha outra.'],
          },
        });
      }
      const now = clock.now();
      const basis = assessApproachBasis({
        claims: dossier.claims.map((view) => view.claim),
        insights,
        hasDomain: Boolean(company.primaryDomain),
        now,
      });
      if (basis.basis === 'insufficient') {
        throw new AppError('validation', 'approach_basis_insufficient');
      }
      if (!deps.ai) return { status: 'ai_failed', failure: aiFailure('no_ai') };

      const context = aiContext(dossier, insights, offer, snapshot);
      // O modelo sabe se a empresa já foi contatada (canal e identificação do primeiro contato).
      const before = existing ? await contactStateOf(existing.id) : null;
      const outcome = await deps.ai.approach(
        {
          ...context,
          basis: basis.basis,
          gaps: basis.gaps,
          firstContact: before?.firstContact ?? true,
          kind: input.kind,
          tone: input.tone,
          instruction: input.instruction,
        },
        signal,
      );
      if (!outcome.ok) {
        await recordAi(ctx, outcome);
        return { status: 'ai_failed', failure: aiFailure(outcome.code) };
      }
      const parsed = ApproachAiOutput.safeParse(outcome.data);
      await recordAi(ctx, outcome, !parsed.success);
      if (!parsed.success) return { status: 'ai_failed', failure: aiFailure('invalid_output') };

      const grounded = groundStrategy(
        parsed.data.strategy,
        new Set(basis.usableClaimIds),
        new Set(context.cases.map((item) => item.id)),
        basis.gaps,
      );

      // Só depois da geração válida: nada fica gravado se a IA falhar.
      let { opportunity } = await ensureOpportunity(
        ctx,
        company,
        offer.id,
        'approach_ready',
        'company',
      );
      if (!opportunity.offerId) opportunity = await setOffer(ctx, opportunity, offer.id);
      const contact = await contactStateOf(opportunity.id);
      const channel = channelFor(input.kind, grounded.content.channel, contact);
      const content: ApproachStrategyContent = { ...grounded.content, channel };

      const plan = await repo.insertPlan(
        {
          id: newId(),
          opportunityId: opportunity.id,
          companyId: company.id,
          offerId: offer.id,
          offerVersionId: offer.current!.id,
          basis: basis.basis,
          content,
          claimIds: grounded.claimIds,
          promptId: outcome.promptId,
          model: outcome.model,
          isDemo: synthetic || company.isDemo,
        },
        pendingAudit(ctx, {
          action: 'relationship.approach.generated',
          entityType: 'approach_plan',
          diff: {
            opportunityId: opportunity.id,
            basis: basis.basis,
            promptId: outcome.promptId,
            // Investigação de Empresas cujo diagnóstico entrou na geração (KI-129); null sem ele.
            diagnosisId: insights.diagnosis?.id ?? null,
          },
          withVersion: true,
        }),
      );
      const body = withContactFooter(parsed.data.message.body, footerPolicy(snapshot), contact);
      const id = newId();
      const message = await insertVersion(
        ctx,
        {
          id,
          opportunityId: opportunity.id,
          planId: plan.id,
          replyToInteractionId: null,
          kind: input.kind,
          channel,
          tone: input.tone,
          // Assunto só existe em e-mail (o canal pode ter mudado para LinkedIn).
          subject: channel === 'email' ? parsed.data.message.subject || null : null,
          body,
          threadId: id,
          origin: 'ai',
          claimIds: grounded.claimIds,
          promptId: outcome.promptId,
          model: outcome.model,
          isDemo: synthetic || company.isDemo,
        },
        'relationship.message.generated',
      );
      return { status: 'created', opportunity, plan, message, gaps: content.gaps };
    },

    async discardPlan(ctx, planId) {
      const id = parseInput(Uuid, planId);
      await repo.decidePlan(
        id,
        'discarded',
        pendingAudit(ctx, {
          action: 'relationship.approach.discarded',
          entityType: 'approach_plan',
          entityId: id,
        }),
      );
    },

    async regenerateMessage(ctx, raw, signal) {
      const input = parseInput(RegenerateMessageInput, raw);
      const previous = await requireLatest(input.messageId);
      if (previous.status === 'discarded') {
        throw new AppError('conflict', 'invalid_status_change');
      }
      const opportunity = await requireOpen(previous.opportunityId);
      const dossier = await companies.dossier(ctx, opportunity.companyId);
      await assertNotSuppressed(dossier.company);
      const replyTo = previous.replyToInteractionId
        ? await repo.getInteraction(previous.replyToInteractionId)
        : null;
      return generateMessage(ctx, {
        opportunity,
        dossier,
        kind: input.kind ?? previous.kind,
        tone: input.tone ?? previous.tone ?? 'consultative',
        channel: previous.channel,
        instruction: input.instruction,
        previous,
        replyTo,
        signal,
      });
    },

    async newMessage(ctx, raw, signal) {
      const input = parseInput(NewVariantInput, raw);
      const opportunity = await requireOpen(input.opportunityId);
      const dossier = await companies.dossier(ctx, opportunity.companyId);
      await assertNotSuppressed(dossier.company);
      let replyTo: Interaction | null = null;
      if (input.replyToInteractionId) {
        replyTo = await requireInteraction(input.replyToInteractionId);
        if (replyTo.opportunityId !== opportunity.id || replyTo.direction !== 'inbound') {
          throw new AppError('not_found', 'not_found');
        }
      }
      const plan = currentPlan(await repo.listPlans(opportunity.id));
      return generateMessage(ctx, {
        opportunity,
        dossier,
        kind: input.kind,
        tone: input.tone,
        channel: input.channel ?? replyTo?.channel ?? plan?.content.channel ?? 'email',
        instruction: input.instruction,
        previous: null,
        replyTo,
        signal,
      });
    },

    async writeMessage(ctx, raw) {
      const input = parseInput(WriteMessageInput, raw);
      const opportunity = await requireOpen(input.opportunityId);
      const dossier = await companies.dossier(ctx, opportunity.companyId);
      await assertNotSuppressed(dossier.company);
      if (input.replyToInteractionId) {
        const replyTo = await requireInteraction(input.replyToInteractionId);
        if (replyTo.opportunityId !== opportunity.id) throw new AppError('not_found', 'not_found');
      }
      const plan = currentPlan(await repo.listPlans(opportunity.id));
      // Como na mensagem da IA: o rodapé obrigatório (opt-out e canal do titular) entra no fim.
      const [contact, snapshot] = await Promise.all([
        contactStateOf(opportunity.id),
        snapshotOf(ctx),
      ]);
      const id = newId();
      return insertVersion(
        ctx,
        {
          id,
          opportunityId: opportunity.id,
          planId: plan?.id ?? null,
          replyToInteractionId: input.replyToInteractionId,
          kind: input.kind,
          channel: input.channel,
          tone: null,
          subject: input.subject,
          body: withContactFooter(input.body, footerPolicy(snapshot), contact),
          threadId: id,
          origin: 'user',
          claimIds: [],
          promptId: null,
          model: null,
          isDemo: dossier.company.isDemo,
        },
        'relationship.message.written',
      );
    },

    async editMessage(ctx, raw) {
      const input = parseInput(EditMessageInput, raw);
      const previous = await requireLatest(input.messageId);
      if (previous.status === 'discarded') {
        throw new AppError('conflict', 'invalid_status_change');
      }
      const opportunity = await requireOpen(previous.opportunityId);
      const dossier = await companies.dossier(ctx, opportunity.companyId);
      await assertNotSuppressed(dossier.company);
      // Rascunho sem mudança fica como está. Aprovada (vencida, revogada ou não), o mesmo texto
      // vira versão nova em rascunho: é o caminho para aprovar de novo.
      const same = previous.subject === input.subject && previous.body === input.body;
      if (same && previous.status === 'draft') return previous;
      return insertVersion(
        ctx,
        {
          id: newId(),
          opportunityId: opportunity.id,
          planId: previous.planId,
          replyToInteractionId: previous.replyToInteractionId,
          kind: previous.kind,
          channel: previous.channel,
          tone: previous.tone,
          subject: input.subject,
          body: input.body,
          threadId: previous.threadId,
          origin: 'user',
          claimIds: previous.claimIds,
          promptId: previous.promptId,
          model: previous.model,
          isDemo: previous.isDemo,
        },
        'relationship.message.edited',
      );
    },

    async discardMessage(ctx, messageId) {
      const message = await requireLatest(messageId);
      if (message.status !== 'draft') throw new AppError('conflict', 'invalid_status_change');
      await repo.discardMessage(
        message.id,
        pendingAudit(ctx, {
          action: 'relationship.message.discarded',
          entityType: 'outbound_message',
          entityId: message.id,
        }),
      );
    },

    async approveMessage(ctx, raw) {
      const input = parseInput(ApproveMessageInput, raw);
      const message = await requireLatest(input.messageId);
      if (message.status !== 'draft') throw new AppError('conflict', 'invalid_status_change');
      const currentHash = await messageHash(message);
      if (input.payloadHash !== message.payloadHash || currentHash !== message.payloadHash) {
        throw new AppError('conflict', 'concurrent_change');
      }
      const opportunity = await requireOpen(message.opportunityId);
      const dossier = await companies.dossier(ctx, opportunity.companyId);
      await assertNotSuppressed(dossier.company);
      const state = await compliance(ctx, opportunity.offerId);
      if (!state.ready || !state.clearance) {
        throw new AppError('conflict', 'approach_blocked', {
          fieldErrors: { _form: state.missing },
        });
      }
      const snapshot = await snapshotOf(ctx);
      const policy = snapshot.contactPolicy?.content ?? null;
      const issues = messageIssues({
        channel: message.channel,
        subject: message.subject,
        body: message.body,
        ...(await contactStateOf(opportunity.id)),
        agencyName: policy?.agencyName ?? null,
        optOutText: policy?.optOutText ?? null,
        privacyContact: policy?.privacyContact ?? null,
      });
      if (issues.length > 0) {
        throw new AppError('validation', 'message_blocked', {
          fieldErrors: groupFieldErrors(issues),
        });
      }
      const now = clock.now();
      return repo.approveMessage(
        {
          id: newId(),
          messageId: message.id,
          opportunityId: opportunity.id,
          payloadHash: message.payloadHash,
          channel: message.channel,
          clearance: state.clearance,
          expiresAt: new Date(now.getTime() + APPROVAL_VALIDITY_DAYS * DAY_MS).toISOString(),
        },
        pendingAudit(ctx, {
          action: 'relationship.message.approved',
          entityType: 'outbound_message',
          entityId: message.id,
          diff: { channel: message.channel, version: message.version },
        }),
      );
    },

    async revokeApproval(ctx, raw) {
      const input = parseInput(RevokeApprovalInput, raw);
      const approval = await repo.getApproval(input.approvalId);
      if (!approval) throw new AppError('not_found', 'not_found');
      if (approval.status !== 'approved') throw new AppError('conflict', 'invalid_status_change');
      await repo.revokeApproval(
        approval.id,
        input.reason,
        pendingAudit(ctx, {
          action: 'relationship.approval.revoked',
          entityType: 'approval',
          entityId: approval.id,
        }),
      );
    },

    async recordOutbound(ctx, raw) {
      const input = parseInput(RecordOutboundInput, raw);
      assertNotFuture(input.occurredAt);
      const message = await requireMessage(input.messageId);
      const opportunity = await requireOpen(message.opportunityId);
      const [latest, approval, dossier] = await Promise.all([
        repo.latestVersionOf(message.threadId),
        message.approvalId ? repo.getApproval(message.approvalId) : Promise.resolve(null),
        companies.dossier(ctx, opportunity.companyId),
      ]);
      const [suppressed, state, interactions] = await Promise.all([
        isSuppressed(dossier.company),
        compliance(ctx, opportunity.offerId),
        repo.listInteractions({ opportunityId: opportunity.id }),
      ]);
      const problems = approvalProblems({
        message,
        isLatestVersion: latest?.id === message.id,
        approval,
        currentHash: await messageHash(message),
        suppressed,
        complianceReady: state.ready,
        used: usedApprovalIds(interactions).has(approval?.id ?? ''),
        now: clock.now(),
      });
      if (problems.length > 0) {
        const reason = suppressed
          ? 'company_suppressed'
          : problems.includes('used')
            ? 'approval_used'
            : 'approval_invalid';
        throw new AppError('conflict', reason, {
          fieldErrors: { _form: problems.map((problem) => APPROVAL_PROBLEM_LABELS[problem]) },
        });
      }
      // O contato não pode ter sido feito antes de o texto ser aprovado.
      if (Date.parse(input.occurredAt) < Date.parse(approval!.decidedAt)) {
        throw new AppError('validation', 'invalid_input', {
          fieldErrors: {
            occurredAt: ['O contato não pode ser anterior à aprovação da mensagem.'],
          },
        });
      }
      const stage: StageMove | null =
        input.moveToContacted && BEFORE_CONTACT.has(opportunity.stage)
          ? { from: opportunity.stage, to: 'contacted', note: null }
          : null;
      return repo.recordInteraction(
        {
          id: newId(),
          opportunityId: opportunity.id,
          companyId: opportunity.companyId,
          direction: 'outbound',
          channel: message.channel,
          occurredAt: input.occurredAt,
          summary: message.subject,
          body: null,
          messageId: message.id,
          approvalId: approval!.id,
          counterpartRole: input.counterpartRole,
          retentionUntil: retentionUntil(),
          isDemo: message.isDemo,
        },
        stage,
        null,
        pendingAudit(ctx, {
          action: 'relationship.contact.recorded',
          entityType: 'interaction',
          diff: {
            opportunityId: opportunity.id,
            messageId: message.id,
            channel: message.channel,
            ...(stage ? { stage: { from: stage.from, to: stage.to } } : {}),
          },
        }),
      );
    },

    async recordInbound(ctx, raw) {
      const input = parseInput(RecordInboundInput, raw);
      assertNotFuture(input.occurredAt);
      const opportunity = await requireOpportunity(input.opportunityId);
      const dossier = await companies.dossier(ctx, opportunity.companyId);
      const snapshot = await snapshotOf(ctx);
      const stop = detectStopRequest(input.body, {
        optOutText: snapshot.contactPolicy?.content.optOutText ?? null,
      });
      // O pedido da própria empresa é registrado mesmo se ela já estiver suprimida por herança ou
      // à mão: retirar aquela supressão não pode apagar este pedido.
      const ownStop = hasOwnStop(
        await repo.activeSuppressions(dossier.company),
        dossier.company.id,
      );
      const stage: StageMove | null =
        input.moveToInConversation &&
        !opportunity.closedAt &&
        BEFORE_CONVERSATION.has(opportunity.stage)
          ? { from: opportunity.stage, to: 'in_conversation', note: null }
          : null;
      const interaction = await repo.recordInteraction(
        {
          id: newId(),
          opportunityId: opportunity.id,
          companyId: opportunity.companyId,
          direction: 'inbound',
          channel: input.channel,
          occurredAt: input.occurredAt,
          summary: null,
          body: input.body,
          messageId: null,
          approvalId: null,
          counterpartRole: input.counterpartRole,
          retentionUntil: retentionUntil(),
          isDemo: dossier.company.isDemo,
        },
        stage,
        stop.matched && !ownStop ? { reason: 'opt_out', source: 'reply_rule' } : null,
        pendingAudit(ctx, {
          action: 'relationship.reply.recorded',
          entityType: 'interaction',
          diff: {
            opportunityId: opportunity.id,
            channel: input.channel,
            stopDetected: stop.matched,
            ...(stage ? { stage: { from: stage.from, to: stage.to } } : {}),
          },
        }),
      );
      return { interaction, stopDetected: stop.matched, stopPhrase: stop.phrase };
    },

    async analyzeReply(ctx, interactionId, signal) {
      const interaction = await requireInteraction(interactionId);
      if (interaction.direction !== 'inbound' || !interaction.body) {
        throw new AppError('validation', 'invalid_input');
      }
      if (!deps.ai) return { status: 'ai_failed', failure: aiFailure('no_ai') };
      const opportunity = await requireOpportunity(interaction.opportunityId);
      const [dossier, snapshot, messages] = await Promise.all([
        companies.dossier(ctx, opportunity.companyId),
        snapshotOf(ctx),
        repo.listInteractions({ opportunityId: opportunity.id }),
      ]);
      const lastOutbound = messages.find(
        (item) => item.direction === 'outbound' && item.occurredAt <= interaction.occurredAt,
      );
      const used = lastOutbound?.messageId ? await repo.getMessage(lastOutbound.messageId) : null;
      const cases = citableCases(snapshot, opportunity.offerId, dossier.company.isDemo);
      const outcome = await deps.ai.analyzeReply(
        {
          companyName: dossier.company.displayName,
          companyIndividual: dossier.individual,
          offerName: offerById(snapshot, opportunity.offerId)?.current?.content.name ?? null,
          agencyName: snapshot.contactPolicy?.content.agencyName ?? null,
          lastOutbound: used
            ? {
                subject: used.subject,
                body: withoutContactFooter(used.body, footerPolicy(snapshot)),
              }
            : null,
          // Só as palavras da empresa: o texto citado (a nossa mensagem e o nosso opt-out) não pode
          // levar a IA a ler um pedido para parar que a empresa não fez.
          replyBody: replyOwnText(interaction.body),
          cases,
        },
        signal,
      );
      if (!outcome.ok) {
        await recordAi(ctx, outcome);
        return { status: 'ai_failed', failure: aiFailure(outcome.code) };
      }
      const parsed = ReplyAnalysis.safeParse(outcome.data);
      await recordAi(ctx, outcome, !parsed.success);
      if (!parsed.success) return { status: 'ai_failed', failure: aiFailure('invalid_output') };
      const allowedCases = new Set(cases.map((item) => item.id));
      let analysis = {
        ...parsed.data,
        caseIds: parsed.data.caseIds.filter((id) => allowedCases.has(id)),
      };
      const active = await repo.activeSuppressions(dossier.company);
      let suppressed = active.length > 0;
      let suppressedByAi = false;
      if (
        !hasOwnStop(active, dossier.company.id) &&
        analysis.classification === 'stop_request' &&
        analysis.confidence !== 'low'
      ) {
        await repo.suppress(
          dossier.company.id,
          { reason: 'opt_out', source: 'reply_ai', interactionId: interaction.id },
          pendingAudit(ctx, {
            action: 'relationship.suppression.created',
            entityType: 'company',
            entityId: dossier.company.id,
            diff: { reason: 'opt_out', source: 'reply_ai', interactionId: interaction.id },
          }),
        );
        suppressed = true;
        suppressedByAi = true;
      }
      // Empresa que pediu para parar (ou recusou) não recebe sugestão de resposta, de follow-up,
      // de case nem de pergunta: insistir depois de uma negativa não é decisão da IA. Resposta
      // automática (ausência) não tem a quem responder; o follow-up continua valendo.
      const stopOrRefusal =
        analysis.classification === 'stop_request' || analysis.classification === 'refusal';
      if (suppressed || stopOrRefusal) {
        analysis = {
          ...analysis,
          suggestedReply: null,
          followUpInDays: null,
          caseIds: [],
          qualifyingQuestions: [],
        };
      } else if (analysis.classification === 'out_of_office') {
        analysis = { ...analysis, suggestedReply: null, caseIds: [], qualifyingQuestions: [] };
      }
      const saved = await repo.saveAnalysis(
        interaction.id,
        { analysis, promptId: outcome.promptId, model: outcome.model },
        pendingAudit(ctx, {
          action: 'relationship.reply.analyzed',
          entityType: 'interaction',
          entityId: interaction.id,
          diff: { classification: analysis.classification, confidence: analysis.confidence },
        }),
      );
      return { status: 'analyzed', interaction: saved, suppressedByAi };
    },

    async draftSuggestedReply(ctx, interactionId) {
      const interaction = await requireInteraction(interactionId);
      const suggestion = interaction.analysis?.suggestedReply;
      if (!suggestion) throw new AppError('not_found', 'not_found');
      const opportunity = await requireOpen(interaction.opportunityId);
      const dossier = await companies.dossier(ctx, opportunity.companyId);
      await assertNotSuppressed(dossier.company);
      const [plans, contact, snapshot] = await Promise.all([
        repo.listPlans(opportunity.id),
        contactStateOf(opportunity.id),
        snapshotOf(ctx),
      ]);
      const plan = currentPlan(plans);
      const id = newId();
      return insertVersion(
        ctx,
        {
          id,
          opportunityId: opportunity.id,
          planId: plan?.id ?? null,
          replyToInteractionId: interaction.id,
          kind: 'reply',
          channel: interaction.channel,
          tone: null,
          // Assunto só existe em e-mail.
          subject: interaction.channel === 'email' ? suggestion.subject || null : null,
          body: withContactFooter(suggestion.body, footerPolicy(snapshot), contact),
          threadId: id,
          origin: 'ai',
          claimIds: [],
          promptId: interaction.analysisPromptId,
          model: interaction.analysisModel,
          isDemo: synthetic || dossier.company.isDemo,
        },
        'relationship.message.generated',
      );
    },

    async recordNote(ctx, raw) {
      const input = parseInput(RecordNoteInput, raw);
      assertNotFuture(input.occurredAt);
      const opportunity = await requireOpportunity(input.opportunityId);
      const dossier = await companies.dossier(ctx, opportunity.companyId);
      // Nota de ligação ou conversa que relata um pedido para parar: honrado na hora (regra 7).
      const stop = detectStopRequest(input.summary);
      const ownStop = hasOwnStop(
        await repo.activeSuppressions(dossier.company),
        dossier.company.id,
      );
      const interaction = await repo.recordInteraction(
        {
          id: newId(),
          opportunityId: opportunity.id,
          companyId: opportunity.companyId,
          direction: 'note',
          channel: input.channel,
          occurredAt: input.occurredAt,
          summary: input.summary,
          body: null,
          messageId: null,
          approvalId: null,
          counterpartRole: null,
          retentionUntil: retentionUntil(),
          isDemo: opportunity.isDemo,
        },
        null,
        stop.matched && !ownStop ? { reason: 'opt_out', source: 'user' } : null,
        pendingAudit(ctx, {
          action: 'relationship.note.recorded',
          entityType: 'interaction',
          diff: { opportunityId: opportunity.id, stopDetected: stop.matched },
        }),
      );
      return { interaction, stopDetected: stop.matched };
    },

    async createTask(ctx, raw) {
      const input = parseInput(CreateTaskInput, raw);
      const opportunity = await requireOpen(input.opportunityId);
      if (input.kind === 'follow_up') {
        const dossier = await companies.dossier(ctx, opportunity.companyId);
        await assertNotSuppressed(dossier.company);
      }
      return repo.insertTask(
        {
          id: newId(),
          opportunityId: opportunity.id,
          companyId: opportunity.companyId,
          kind: input.kind,
          title: input.title,
          notes: input.notes,
          dueAt: input.dueAt,
          origin: input.origin,
          isDemo: opportunity.isDemo,
        },
        pendingAudit(ctx, {
          action: 'relationship.task.created',
          entityType: 'task',
          diff: { opportunityId: opportunity.id, kind: input.kind, origin: input.origin },
        }),
      );
    },

    async completeTask(ctx, taskId) {
      const task = await requireTask(taskId);
      if (task.status !== 'open') throw new AppError('conflict', 'invalid_status_change');
      return repo.updateTask(
        task.id,
        { status: 'done' },
        pendingAudit(ctx, {
          action: 'relationship.task.completed',
          entityType: 'task',
          entityId: task.id,
        }),
      );
    },

    async cancelTask(ctx, taskId) {
      const task = await requireTask(taskId);
      if (task.status !== 'open') throw new AppError('conflict', 'invalid_status_change');
      return repo.updateTask(
        task.id,
        { status: 'cancelled', cancelReason: 'user' },
        pendingAudit(ctx, {
          action: 'relationship.task.cancelled',
          entityType: 'task',
          entityId: task.id,
        }),
      );
    },

    async rescheduleTask(ctx, raw) {
      const input = parseInput(RescheduleTaskInput, raw);
      const task = await requireTask(input.taskId);
      if (task.status !== 'open') throw new AppError('conflict', 'invalid_status_change');
      return repo.updateTask(
        task.id,
        { dueAt: input.dueAt },
        pendingAudit(ctx, {
          action: 'relationship.task.rescheduled',
          entityType: 'task',
          entityId: task.id,
        }),
      );
    },

    async suppressCompany(ctx, raw) {
      const input = parseInput(SuppressCompanyInput, raw);
      const dossier = await companies.dossier(ctx, input.companyId);
      const active = await repo.activeSuppressions(dossier.company);
      const own = active.find(
        (entry) => entry.companyId === dossier.company.id && entry.reason === input.reason,
      );
      if (own) return own;
      return repo.suppress(
        dossier.company.id,
        { reason: input.reason, source: 'user' },
        pendingAudit(ctx, {
          action: 'relationship.suppression.created',
          entityType: 'company',
          entityId: dossier.company.id,
          diff: { reason: input.reason, source: 'user' },
        }),
      );
    },

    async liftSuppression(ctx, raw) {
      const input = parseInput(LiftSuppressionInput, raw);
      const entry = await repo.getSuppression(input.suppressionId);
      if (!entry) throw new AppError('not_found', 'not_found');
      if (entry.liftedAt) throw new AppError('conflict', 'invalid_status_change');
      // Só no dossiê da empresa que pediu: a herdada (raiz do CNPJ, domínio) não sai por outra.
      if (entry.companyId !== input.companyId) {
        throw new AppError('conflict', 'suppression_inherited');
      }
      if (entry.reason === 'legal_request') throw new AppError('conflict', 'suppression_locked');
      return repo.liftSuppression(
        entry.id,
        input.reason,
        pendingAudit(ctx, {
          action: 'relationship.suppression.lifted',
          entityType: 'company',
          entityId: entry.companyId,
          diff: { suppressionId: entry.id },
        }),
      );
    },
  };
}
