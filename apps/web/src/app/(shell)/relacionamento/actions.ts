'use server';

import { reviewNeedsAttention } from '@prospector/application';
import { all, brlToCents, checked, formValues, text } from '@/lib/form-data';
import type { FormState } from '@/lib/form-state';
import { localDateTimeToIso, localDateToIso } from '@/lib/relationship-dates';
import { backWith, OPPORTUNITY_NOTICES, relationshipRoutes } from '@/lib/relationship-routes';
import { runRelationshipAction } from '@/server/relationship';

/**
 * Server Actions do Relacionamento (ADR-0014). Só convertem o formulário e chamam o
 * RelationshipService; validação, regras de aprovação, supressão e auditoria ficam no serviço.
 * Nenhuma ação envia mensagem: o envio é manual, fora do app, e aqui só se registra.
 *
 * `from` (primeiro argumento ligado) diz de onde a ação veio: o id da oportunidade ou a fila de
 * Aprovações (`FROM_APPROVALS`). Quando o formulário some depois de dar certo, a ação volta para lá
 * com `?aviso=`; o endereço é montado no servidor (`backWith`).
 */

const optionalText = (values: Parameters<typeof text>[0], name: string) => {
  const value = text(values, name).trim();
  return value === '' ? null : value;
};

// --- Oportunidade e abordagem -----------------------------------------------------------------

/**
 * Gera estratégia + primeiro rascunho com a IA local; nada é gravado se a IA falhar. A proposta
 * (perfil, modo e frentes) e a oferta da Estratégia, opcional, vêm do formulário; a barreira de
 * coerência é do serviço (ajuste e correção de 27/11).
 */
export async function prepareApproachAction(
  companyId: string,
  _prev: FormState,
  formData: FormData,
) {
  const values = formValues(formData);
  return runRelationshipAction(values, async (relationship, ctx) => {
    const result = await relationship.prepareApproach(ctx, {
      companyId,
      offerId: optionalText(values, 'offerId'),
      profileId: optionalText(values, 'profileId') ?? undefined,
      proposalMode: text(values, 'proposalMode') || undefined,
      families: all(values, 'families'),
      kind: text(values, 'kind') || undefined,
      tone: text(values, 'tone') || undefined,
      instruction: optionalText(values, 'instruction'),
      thesisAngle: text(values, 'thesisAngle') || undefined,
    });
    if (result.status === 'ai_failed') return { error: result.failure.message };
    return relationshipRoutes.opportunity(
      result.opportunity.id,
      reviewNeedsAttention(result.review)
        ? OPPORTUNITY_NOTICES.preparedReview
        : OPPORTUNITY_NOTICES.prepared,
    );
  });
}

/** Abre a oportunidade sem IA (para escrever a mensagem à mão ou registrar um contato). */
export async function openOpportunityAction(
  companyId: string,
  _prev: FormState,
  formData: FormData,
) {
  const values = formValues(formData);
  return runRelationshipAction(values, async (relationship, ctx) => {
    const result = await relationship.openOpportunity(ctx, {
      companyId,
      offerId: optionalText(values, 'offerId'),
    });
    return relationshipRoutes.opportunity(
      result.opportunity.id,
      result.created ? OPPORTUNITY_NOTICES.opened : OPPORTUNITY_NOTICES.existing,
    );
  });
}

export async function changeStageAction(
  opportunityId: string,
  _prev: FormState,
  formData: FormData,
) {
  const values = formValues(formData);
  return runRelationshipAction(values, async (relationship, ctx) => {
    await relationship.changeStage(ctx, {
      opportunityId,
      fromStage: text(values, 'fromStage'),
      toStage: text(values, 'toStage'),
      note: optionalText(values, 'note'),
    });
    return { message: 'Etapa alterada.' };
  });
}

export async function updateOpportunityAction(
  opportunityId: string,
  _prev: FormState,
  formData: FormData,
) {
  const values = formValues(formData);
  return runRelationshipAction(values, async (relationship, ctx) => {
    await relationship.updateOpportunity(ctx, {
      opportunityId,
      offerId: optionalText(values, 'offerId'),
      priority: text(values, 'priority'),
      valueEstimateCents: brlToCents(text(values, 'valueEstimateCents')),
      valueBasis: optionalText(values, 'valueBasis'),
      nextAction: optionalText(values, 'nextAction'),
      nextActionDueAt: localDateToIso(text(values, 'nextActionDueAt')),
      lostReason: optionalText(values, 'lostReason'),
    });
  });
}

export async function discardPlanAction(opportunityId: string, planId: string) {
  return runRelationshipAction({}, async (relationship, ctx) => {
    await relationship.discardPlan(ctx, planId);
    return backWith(opportunityId, OPPORTUNITY_NOTICES.planDiscarded);
  });
}

// --- Mensagens --------------------------------------------------------------------------------

export async function regenerateMessageAction(
  from: string,
  messageId: string,
  _prev: FormState,
  formData: FormData,
) {
  const values = formValues(formData);
  return runRelationshipAction(values, async (relationship, ctx) => {
    const result = await relationship.regenerateMessage(ctx, {
      messageId,
      tone: text(values, 'tone') || undefined,
      instruction: optionalText(values, 'instruction'),
    });
    if (result.status === 'ai_failed') return { error: result.failure.message };
    return backWith(
      from,
      reviewNeedsAttention(result.review)
        ? OPPORTUNITY_NOTICES.messageRewrittenReview
        : OPPORTUNITY_NOTICES.messageRewritten,
      result.message.id,
    );
  });
}

export async function newMessageAction(
  opportunityId: string,
  _prev: FormState,
  formData: FormData,
) {
  const values = formValues(formData);
  return runRelationshipAction(values, async (relationship, ctx) => {
    const result = await relationship.newMessage(ctx, {
      opportunityId,
      kind: text(values, 'kind'),
      tone: text(values, 'tone') || undefined,
      channel: text(values, 'channel') || undefined,
      instruction: optionalText(values, 'instruction'),
      replyToInteractionId: optionalText(values, 'replyToInteractionId'),
    });
    if (result.status === 'ai_failed') return { error: result.failure.message };
    // Volta para a página com o aviso e o foco no rascunho novo, como reescrever (KI-154): o
    // aviso de conferência é alerta, e os detalhes ficam no cartão da mensagem (KI-150).
    return relationshipRoutes.opportunity(
      opportunityId,
      reviewNeedsAttention(result.review)
        ? OPPORTUNITY_NOTICES.messageCreatedReview
        : OPPORTUNITY_NOTICES.messageCreated,
      result.message.id,
    );
  });
}

export async function writeMessageAction(
  opportunityId: string,
  _prev: FormState,
  formData: FormData,
) {
  const values = formValues(formData);
  return runRelationshipAction(values, async (relationship, ctx) => {
    await relationship.writeMessage(ctx, {
      opportunityId,
      kind: text(values, 'kind'),
      channel: text(values, 'channel'),
      subject: optionalText(values, 'subject'),
      body: text(values, 'body'),
      replyToInteractionId: optionalText(values, 'replyToInteractionId'),
    });
    return { message: 'Rascunho salvo. Revise antes de aprovar.' };
  });
}

export async function editMessageAction(
  from: string,
  messageId: string,
  _prev: FormState,
  formData: FormData,
) {
  const values = formValues(formData);
  return runRelationshipAction(values, async (relationship, ctx) => {
    const message = await relationship.editMessage(ctx, {
      messageId,
      subject: optionalText(values, 'subject'),
      body: text(values, 'body'),
    });
    return message.id === messageId
      ? { message: 'Nenhuma alteração: o texto é o mesmo.' }
      : backWith(from, OPPORTUNITY_NOTICES.messageEdited, message.id);
  });
}

export async function discardMessageAction(from: string, messageId: string) {
  return runRelationshipAction({}, async (relationship, ctx) => {
    await relationship.discardMessage(ctx, messageId);
    return backWith(from, OPPORTUNITY_NOTICES.messageDiscarded);
  });
}

/**
 * Aprovação revogada ou vencida, texto igual: cria uma versão nova (rascunho) com o mesmo texto
 * para aprovar de novo. O texto vem do servidor (a versão atual), não do formulário.
 */
export async function prepareReapprovalAction(opportunityId: string, messageId: string) {
  return runRelationshipAction({}, async (relationship, ctx) => {
    const detail = await relationship.opportunity(ctx, opportunityId);
    const view = detail.threads.find((thread) => thread.message.id === messageId);
    if (!view) {
      return { error: 'Esta versão da mensagem não é mais a atual. Recarregue a página.' };
    }
    await relationship.editMessage(ctx, {
      messageId,
      subject: view.message.subject,
      body: view.message.body,
    });
    return backWith(opportunityId, OPPORTUNITY_NOTICES.reapproval);
  });
}

/**
 * Aprovação humana do texto exato que a tela mostrava (`payloadHash`), com a caixa de confirmação
 * marcada. Não envia nada.
 */
export async function approveMessageAction(
  from: string,
  messageId: string,
  payloadHash: string,
  _prev: FormState,
  formData: FormData,
) {
  const values = formValues(formData);
  return runRelationshipAction(values, async (relationship, ctx) => {
    if (!checked(values, 'confirm')) {
      return { error: 'Marque a caixa para confirmar que revisou o texto.' };
    }
    await relationship.approveMessage(ctx, { messageId, payloadHash });
    return backWith(from, OPPORTUNITY_NOTICES.approved);
  });
}

export async function revokeApprovalAction(
  opportunityId: string,
  approvalId: string,
  _prev: FormState,
  formData: FormData,
) {
  const values = formValues(formData);
  return runRelationshipAction(values, async (relationship, ctx) => {
    await relationship.revokeApproval(ctx, { approvalId, reason: text(values, 'reason') });
    return backWith(opportunityId, OPPORTUNITY_NOTICES.revoked);
  });
}

// --- Contatos e respostas ---------------------------------------------------------------------

export async function recordOutboundAction(
  opportunityId: string,
  messageId: string,
  _prev: FormState,
  formData: FormData,
) {
  const values = formValues(formData);
  return runRelationshipAction(values, async (relationship, ctx) => {
    await relationship.recordOutbound(ctx, {
      messageId,
      occurredAt: localDateTimeToIso(text(values, 'occurredAt')) ?? '',
      counterpartRole: optionalText(values, 'counterpartRole'),
      moveToContacted: checked(values, 'moveToContacted'),
    });
    return backWith(opportunityId, OPPORTUNITY_NOTICES.contactRecorded);
  });
}

export async function recordInboundAction(
  opportunityId: string,
  _prev: FormState,
  formData: FormData,
) {
  const values = formValues(formData);
  return runRelationshipAction(values, async (relationship, ctx) => {
    const result = await relationship.recordInbound(ctx, {
      opportunityId,
      channel: text(values, 'channel'),
      occurredAt: localDateTimeToIso(text(values, 'occurredAt')) ?? '',
      body: text(values, 'body'),
      counterpartRole: optionalText(values, 'counterpartRole'),
      moveToInConversation: checked(values, 'moveToInConversation'),
    });
    if (result.stopDetected) {
      return {
        message: `Resposta registrada. Ela pede para parar o contato ("${result.stopPhrase ?? ''}"): a empresa entrou na lista de supressão e os follow-ups abertos foram cancelados.`,
      };
    }
    return { message: 'Resposta registrada. Use "Interpretar com a IA" para a leitura sugerida.' };
  });
}

export async function analyzeReplyAction(interactionId: string) {
  return runRelationshipAction({}, async (relationship, ctx) => {
    const result = await relationship.analyzeReply(ctx, interactionId);
    if (result.status === 'ai_failed') return { error: result.failure.message };
    return {
      message: result.suppressedByAi
        ? 'Interpretação salva. A IA leu um pedido para parar o contato: a empresa entrou na lista de supressão (você pode retirar, se for engano).'
        : 'Interpretação salva. Confira antes de agir.',
    };
  });
}

export async function draftSuggestedReplyAction(interactionId: string) {
  return runRelationshipAction({}, async (relationship, ctx) => {
    await relationship.draftSuggestedReply(ctx, interactionId);
    return { message: 'Rascunho de resposta criado em Mensagens. Revise antes de aprovar.' };
  });
}

export async function recordNoteAction(
  opportunityId: string,
  _prev: FormState,
  formData: FormData,
) {
  const values = formValues(formData);
  return runRelationshipAction(values, async (relationship, ctx) => {
    const { stopDetected } = await relationship.recordNote(ctx, {
      opportunityId,
      channel: text(values, 'channel') || undefined,
      occurredAt: localDateTimeToIso(text(values, 'occurredAt')) ?? '',
      summary: text(values, 'summary'),
    });
    return {
      message: stopDetected
        ? 'Nota registrada. Ela relata um pedido para parar: a empresa entrou na lista de supressão e os follow-ups abertos foram cancelados.'
        : 'Nota registrada.',
    };
  });
}

// --- Follow-ups -------------------------------------------------------------------------------

export async function createTaskAction(
  opportunityId: string,
  _prev: FormState,
  formData: FormData,
) {
  const values = formValues(formData);
  return runRelationshipAction(values, async (relationship, ctx) => {
    await relationship.createTask(ctx, {
      opportunityId,
      kind: text(values, 'kind') || undefined,
      title: text(values, 'title'),
      notes: optionalText(values, 'notes'),
      dueAt: localDateToIso(text(values, 'dueAt')) ?? '',
      origin: text(values, 'origin') === 'suggested' ? 'suggested' : 'user',
    });
    return { message: 'Follow-up marcado.' };
  });
}

export async function completeTaskAction(opportunityId: string, taskId: string) {
  return runRelationshipAction({}, async (relationship, ctx) => {
    await relationship.completeTask(ctx, taskId);
    return backWith(opportunityId, OPPORTUNITY_NOTICES.taskDone);
  });
}

export async function cancelTaskAction(opportunityId: string, taskId: string) {
  return runRelationshipAction({}, async (relationship, ctx) => {
    await relationship.cancelTask(ctx, taskId);
    return backWith(opportunityId, OPPORTUNITY_NOTICES.taskCancelled);
  });
}

export async function rescheduleTaskAction(taskId: string, _prev: FormState, formData: FormData) {
  const values = formValues(formData);
  return runRelationshipAction(values, async (relationship, ctx) => {
    await relationship.rescheduleTask(ctx, {
      taskId,
      dueAt: localDateToIso(text(values, 'dueAt')) ?? '',
    });
    return { message: 'Nova data salva.' };
  });
}

// --- Supressão --------------------------------------------------------------------------------

export async function suppressCompanyAction(
  opportunityId: string,
  companyId: string,
  _prev: FormState,
  formData: FormData,
) {
  const values = formValues(formData);
  return runRelationshipAction(values, async (relationship, ctx) => {
    await relationship.suppressCompany(ctx, {
      companyId,
      reason: text(values, 'reason') || undefined,
    });
    return backWith(opportunityId, OPPORTUNITY_NOTICES.suppressed);
  });
}

/**
 * `companyId`: o dossiê onde a retirada foi pedida (só a empresa dona da supressão retira).
 * `opportunityId`: a oportunidade onde o formulário estava, para voltar com o aviso; null no
 * painel do dossiê (a mensagem aparece ali mesmo).
 */
export async function liftSuppressionAction(
  opportunityId: string | null,
  companyId: string,
  suppressionId: string,
  _prev: FormState,
  formData: FormData,
) {
  const values = formValues(formData);
  return runRelationshipAction(values, async (relationship, ctx) => {
    await relationship.liftSuppression(ctx, {
      companyId,
      suppressionId,
      reason: text(values, 'reason'),
    });
    return opportunityId
      ? backWith(opportunityId, OPPORTUNITY_NOTICES.lifted)
      : { message: 'Supressão retirada. O motivo ficou registrado na auditoria.' };
  });
}
