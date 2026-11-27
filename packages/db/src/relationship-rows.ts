import type {
  NewApproachPlan,
  NewInteraction,
  NewOpportunity,
  NewOutboundMessage,
  NewTask,
  OpportunityPatch,
  OpportunitySummaryRow,
} from '@prospector/application';
import {
  ApproachPlan,
  Approval,
  Interaction,
  Opportunity,
  OpportunitySummary,
  OutboundMessage,
  StageChange,
  SuppressionEntry,
  Task,
} from '@prospector/contracts';

/**
 * Linhas do Relacionamento (migração 20261111170000) ↔ contratos. Toda leitura passa pelo
 * contrato: mudança de esquema falha alto em vez de chegar torta à UI. Datas viram ISO em UTC
 * (o PostgREST manda `+00:00` com microssegundos), para comparar e ordenar como texto.
 */

const camel = (key: string) =>
  key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());

function normalize(raw: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries((raw ?? {}) as Record<string, unknown>)) {
    if ((key.endsWith('_at') || key.endsWith('_until')) && typeof value === 'string') {
      const time = Date.parse(value);
      out[camel(key)] = Number.isNaN(time) ? value : new Date(time).toISOString();
    } else if (key === 'value_estimate_cents' && typeof value === 'string') {
      out[camel(key)] = Number(value);
    } else {
      out[camel(key)] = value;
    }
  }
  return out;
}

const SummaryRow = OpportunitySummary.omit({ offerName: true });

export const mapOpportunity = (raw: unknown): Opportunity => Opportunity.parse(normalize(raw));
export const mapSummary = (raw: unknown): OpportunitySummaryRow => SummaryRow.parse(normalize(raw));
export const mapStageChange = (raw: unknown): StageChange => StageChange.parse(normalize(raw));
export const mapPlan = (raw: unknown): ApproachPlan => ApproachPlan.parse(normalize(raw));
export const mapMessage = (raw: unknown): OutboundMessage => OutboundMessage.parse(normalize(raw));
export const mapApproval = (raw: unknown): Approval => Approval.parse(normalize(raw));
export const mapInteraction = (raw: unknown): Interaction => Interaction.parse(normalize(raw));
export const mapTask = (raw: unknown): Task => Task.parse(normalize(raw));
export const mapSuppression = (raw: unknown): SuppressionEntry =>
  SuppressionEntry.parse(normalize(raw));

export function opportunityColumns(row: NewOpportunity) {
  return {
    id: row.id,
    company_id: row.companyId,
    offer_id: row.offerId,
    stage: row.stage,
    priority: row.priority,
    source: row.source,
    is_demo: row.isDemo,
  };
}

export function opportunityPatchColumns(patch: OpportunityPatch) {
  return {
    offer_id: patch.offerId,
    priority: patch.priority,
    value_estimate_cents: patch.valueEstimateCents,
    value_basis: patch.valueBasis,
    next_action: patch.nextAction,
    next_action_due_at: patch.nextActionDueAt,
    lost_reason: patch.lostReason,
  };
}

export function planColumns(plan: NewApproachPlan) {
  return {
    id: plan.id,
    opportunity_id: plan.opportunityId,
    company_id: plan.companyId,
    offer_id: plan.offerId,
    offer_version_id: plan.offerVersionId,
    basis: plan.basis,
    content: plan.content,
    claim_ids: plan.claimIds,
    prompt_id: plan.promptId,
    model: plan.model,
    is_demo: plan.isDemo,
  };
}

export function messageColumns(message: NewOutboundMessage) {
  return {
    id: message.id,
    opportunity_id: message.opportunityId,
    plan_id: message.planId,
    reply_to_interaction_id: message.replyToInteractionId,
    kind: message.kind,
    channel: message.channel,
    tone: message.tone,
    subject: message.subject,
    body: message.body,
    thread_id: message.threadId,
    origin: message.origin,
    payload_hash: message.payloadHash,
    claim_ids: message.claimIds,
    prompt_id: message.promptId,
    model: message.model,
    is_demo: message.isDemo,
  };
}

export function interactionColumns(row: NewInteraction) {
  return {
    id: row.id,
    opportunity_id: row.opportunityId,
    company_id: row.companyId,
    direction: row.direction,
    channel: row.channel,
    occurred_at: row.occurredAt,
    summary: row.summary,
    body: row.body,
    message_id: row.messageId,
    approval_id: row.approvalId,
    counterpart_role: row.counterpartRole,
    retention_until: row.retentionUntil,
    is_demo: row.isDemo,
  };
}

export function taskColumns(task: NewTask) {
  return {
    id: task.id,
    opportunity_id: task.opportunityId,
    company_id: task.companyId,
    kind: task.kind,
    title: task.title,
    notes: task.notes,
    due_at: task.dueAt,
    origin: task.origin,
    is_demo: task.isDemo,
  };
}
