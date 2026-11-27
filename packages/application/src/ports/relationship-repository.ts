import type {
  AiReviewRecord,
  ApproachBasis,
  ApproachPlan,
  ApproachStrategyContent,
  Approval,
  ApprovalClearance,
  Company,
  Interaction,
  InteractionDirection,
  MessageChannel,
  MessageKind,
  MessageOrigin,
  MessageStatus,
  MessageTone,
  Opportunity,
  OpportunityPriority,
  OpportunitySource,
  OpportunityStage,
  OpportunitySummary,
  OutboundMessage,
  ReplyAnalysis,
  StageChange,
  SuppressionEntry,
  SuppressionReason,
  SuppressionSource,
  Task,
  TaskCancelReason,
  TaskKind,
  TaskStatus,
} from '@prospector/contracts';
import type { PendingAudit } from './audit-repository';

/**
 * Persistência do Relacionamento (ADR-0014). As regras que importam também valem no banco: uma
 * oportunidade aberta por empresa, etapa movida só a partir da etapa vista, conteúdo de rascunho
 * imutável (editar = nova versão), aprovação do conteúdo exato da versão mais recente, contato
 * registrado só com aprovação válida, e supressão que bloqueia e cancela follow-ups. Toda escrita
 * leva o registro de auditoria (uma linha por operação, ADR-0010).
 */

/** Resumo como a persistência devolve; o nome da oferta vem da estratégia, no serviço. */
export type OpportunitySummaryRow = Omit<OpportunitySummary, 'offerName'>;

export interface OpportunityFilter {
  /** Só estas etapas (vazio ou ausente = todas). */
  stages?: readonly OpportunityStage[];
  /** Inclui ganhas e perdidas (padrão: só abertas). */
  includeClosed?: boolean;
  companyId?: string;
  limit?: number;
}

export interface NewOpportunity {
  id: string;
  companyId: string;
  offerId: string | null;
  stage: Extract<OpportunityStage, 'identified' | 'qualified' | 'approach_ready'>;
  priority: OpportunityPriority;
  source: OpportunitySource;
  isDemo: boolean;
}

export interface StageMove {
  from: OpportunityStage;
  to: OpportunityStage;
  note: string | null;
}

export interface OpportunityPatch {
  offerId: string | null;
  priority: OpportunityPriority;
  valueEstimateCents: number | null;
  valueBasis: string | null;
  nextAction: string | null;
  nextActionDueAt: string | null;
  lostReason: string | null;
}

export interface NewApproachPlan {
  id: string;
  opportunityId: string;
  companyId: string;
  /** Oferta da Estratégia; null quando a proposta sai só do perfil comercial (ADR-0021). */
  offerId: string | null;
  offerVersionId: string | null;
  basis: ApproachBasis;
  content: ApproachStrategyContent;
  claimIds: string[];
  promptId: string | null;
  model: string | null;
  isDemo: boolean;
}

export interface NewOutboundMessage {
  id: string;
  opportunityId: string;
  planId: string | null;
  replyToInteractionId: string | null;
  kind: MessageKind;
  channel: MessageChannel;
  tone: MessageTone | null;
  subject: string | null;
  body: string;
  /** Linha de versões (id da primeira versão); a versão é atribuída pela persistência. */
  threadId: string;
  origin: MessageOrigin;
  payloadHash: string;
  claimIds: string[];
  promptId: string | null;
  model: string | null;
  isDemo: boolean;
}

export interface MessageFilter {
  opportunityId?: string;
  status?: MessageStatus;
  /** Só a versão mais recente de cada linha. */
  latestOnly?: boolean;
  limit?: number;
}

export interface NewApproval {
  id: string;
  messageId: string;
  opportunityId: string;
  payloadHash: string;
  channel: MessageChannel;
  clearance: ApprovalClearance;
  expiresAt: string;
}

export interface NewInteraction {
  id: string;
  opportunityId: string;
  companyId: string;
  direction: InteractionDirection;
  channel: MessageChannel;
  occurredAt: string;
  summary: string | null;
  body: string | null;
  messageId: string | null;
  approvalId: string | null;
  counterpartRole: string | null;
  retentionUntil: string;
  isDemo: boolean;
}

export interface NewSuppression {
  reason: SuppressionReason;
  source: SuppressionSource;
  /**
   * Interação que originou o pedido (resposta ou nota da mesma empresa). Na gravação junto da
   * interação (`recordInteraction`), vale a própria interação gravada.
   */
  interactionId?: string | null;
}

export interface NewTask {
  id: string;
  opportunityId: string;
  companyId: string;
  kind: TaskKind;
  title: string;
  notes: string | null;
  dueAt: string;
  origin: Task['origin'];
  isDemo: boolean;
}

export type TaskPatch =
  { status: 'done' } | { status: 'cancelled'; cancelReason: TaskCancelReason } | { dueAt: string };

export interface TaskFilter {
  opportunityId?: string;
  status?: TaskStatus;
  limit?: number;
}

export interface ReplyAnalysisRecord {
  analysis: ReplyAnalysis;
  promptId: string | null;
  model: string | null;
}

export interface RelationshipRepository {
  // Leitura -------------------------------------------------------------------
  /** Da atividade mais recente para a mais antiga. */
  listOpportunities(filter: OpportunityFilter): Promise<OpportunitySummaryRow[]>;
  getOpportunitySummary(id: string): Promise<OpportunitySummaryRow | null>;
  getOpportunity(id: string): Promise<Opportunity | null>;
  /** A oportunidade aberta da empresa, se houver. */
  openOpportunityFor(companyId: string): Promise<Opportunity | null>;
  /** Em ordem cronológica. */
  listStageChanges(opportunityId: string): Promise<StageChange[]>;
  /** Mais recente primeiro. */
  listPlans(opportunityId: string): Promise<ApproachPlan[]>;
  /** Mais recente primeiro. */
  listMessages(filter: MessageFilter): Promise<OutboundMessage[]>;
  getMessage(id: string): Promise<OutboundMessage | null>;
  latestVersionOf(threadId: string): Promise<OutboundMessage | null>;
  /**
   * Conferência automática gravada com cada versão gerada pela IA (`aiReview` do registro de
   * auditoria da inclusão; só tipos e contagens, KI-150). Versões sem conferência ficam de fora.
   */
  messageReviews(messageIds: readonly string[]): Promise<Map<string, AiReviewRecord>>;
  /** Mais recente primeiro. */
  listApprovals(filter: { opportunityId?: string; limit?: number }): Promise<Approval[]>;
  getApproval(id: string): Promise<Approval | null>;
  /** Mais recente (occurredAt) primeiro. */
  listInteractions(filter: { opportunityId?: string; limit?: number }): Promise<Interaction[]>;
  getInteraction(id: string): Promise<Interaction | null>;
  /** Por vencimento. */
  listTasks(filter: TaskFilter): Promise<Task[]>;
  getTask(id: string): Promise<Task | null>;
  /** Supressões em vigor que alcançam a empresa (por ela, pela raiz do CNPJ ou pelo domínio). */
  activeSuppressions(
    company: Pick<Company, 'id' | 'cnpjRoot' | 'primaryDomain'>,
  ): Promise<SuppressionEntry[]>;
  /** Histórico de supressões da empresa (inclui as retiradas). */
  listSuppressions(companyId: string): Promise<SuppressionEntry[]>;
  getSuppression(id: string): Promise<SuppressionEntry | null>;

  // Escrita (todas auditadas) -------------------------------------------------
  /** AppError('conflict', 'opportunity_open_exists') se a empresa já tem uma aberta. */
  openOpportunity(row: NewOpportunity, audit: PendingAudit): Promise<Opportunity>;
  /** AppError('conflict', 'concurrent_change') se a etapa atual não é `move.from`. */
  changeStage(id: string, move: StageMove, audit: PendingAudit): Promise<Opportunity>;
  updateOpportunity(id: string, patch: OpportunityPatch, audit: PendingAudit): Promise<Opportunity>;
  insertPlan(plan: NewApproachPlan, audit: PendingAudit): Promise<ApproachPlan>;
  /** Só a partir de rascunho. */
  decidePlan(
    id: string,
    status: 'approved' | 'discarded',
    audit: PendingAudit,
  ): Promise<ApproachPlan>;
  insertMessage(message: NewOutboundMessage, audit: PendingAudit): Promise<OutboundMessage>;
  /** Só a partir de rascunho. */
  discardMessage(id: string, audit: PendingAudit): Promise<OutboundMessage>;
  /**
   * Aprova o conteúdo exato (rascunho, versão mais recente, mesmo hash e canal, oportunidade
   * aberta, empresa sem supressão) e marca a mensagem como aprovada, numa operação só.
   */
  approveMessage(approval: NewApproval, audit: PendingAudit): Promise<Approval>;
  revokeApproval(id: string, reason: string, audit: PendingAudit): Promise<Approval>;
  /**
   * Grava a interação e, na mesma operação, a mudança de etapa pedida e a supressão (que cancela
   * os follow-ups abertos). Contato feito: a aprovação é conferida de novo (AppError
   * 'approval_invalid' / 'company_suppressed' / 'opportunity_closed').
   */
  recordInteraction(
    row: NewInteraction,
    stage: StageMove | null,
    suppression: NewSuppression | null,
    audit: PendingAudit,
  ): Promise<Interaction>;
  saveAnalysis(id: string, record: ReplyAnalysisRecord, audit: PendingAudit): Promise<Interaction>;
  insertTask(task: NewTask, audit: PendingAudit): Promise<Task>;
  /** Só follow-up aberto muda (concluído e cancelado são finais). */
  updateTask(id: string, patch: TaskPatch, audit: PendingAudit): Promise<Task>;
  /** Suprime a empresa (raiz do CNPJ e domínio copiados) e cancela os follow-ups abertos. */
  suppress(
    companyId: string,
    entry: NewSuppression,
    audit: PendingAudit,
  ): Promise<SuppressionEntry>;
  liftSuppression(id: string, reason: string, audit: PendingAudit): Promise<SuppressionEntry>;
}
