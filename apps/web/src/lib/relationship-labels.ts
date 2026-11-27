import {
  type AiReviewKind,
  APPROVAL_PROBLEM_LABELS,
  MESSAGE_CHANNEL_LABELS,
  MESSAGE_KIND_LABELS,
  MESSAGE_TONE_LABELS,
  OPPORTUNITY_PRIORITY_LABELS,
  OPPORTUNITY_STAGE_LABELS,
  OPPORTUNITY_STAGES,
  SUPPRESSION_REASON_LABELS,
  TASK_KIND_LABELS,
  type ApprovalProblem,
  type MessageChannel,
  type MessageKind,
  type OpportunityStage,
} from '@prospector/contracts';
import { OPPORTUNITY_NOTICES, type OpportunityNotice } from './relationship-routes';

/** Opções dos formulários do Relacionamento, a partir dos rótulos dos contratos. */

type Option = { value: string; label: string };

const options = <K extends string>(labels: Record<K, string>, keys?: readonly K[]): Option[] =>
  (keys ?? (Object.keys(labels) as K[])).map((value) => ({ value, label: labels[value] }));

export const STAGE_OPTIONS = options(OPPORTUNITY_STAGE_LABELS, OPPORTUNITY_STAGES);
export const PRIORITY_OPTIONS = options(OPPORTUNITY_PRIORITY_LABELS, ['high', 'medium', 'low']);
export const TONE_OPTIONS = options(MESSAGE_TONE_LABELS);
export const TASK_KIND_OPTIONS = options(TASK_KIND_LABELS);
export const SUPPRESSION_REASON_OPTIONS = options(SUPPRESSION_REASON_LABELS, [
  'manual',
  'opt_out',
  'refused',
  'legal_request',
]);

/** Tipos de primeira mensagem (preparar abordagem). */
export const FIRST_MESSAGE_KINDS: readonly MessageKind[] = [
  'initial_email',
  'short_message',
  'presentation',
  'meeting_invite',
];
export const FIRST_MESSAGE_KIND_OPTIONS = options(MESSAGE_KIND_LABELS, FIRST_MESSAGE_KINDS);
export const MESSAGE_KIND_OPTIONS = options(MESSAGE_KIND_LABELS);

/**
 * Canais manuais permitidos no estado do contato (as mesmas regras do domínio, `channelIssues`):
 * primeiro contato só por e-mail ou LinkedIn; WhatsApp só depois que a empresa escreveu por lá.
 */
export function channelOptions(state: { firstContact: boolean; whatsappOptIn: boolean }): Option[] {
  const keys = (Object.keys(MESSAGE_CHANNEL_LABELS) as MessageChannel[]).filter((channel) => {
    if (channel === 'whatsapp_optin') return state.whatsappOptIn;
    return !state.firstContact || channel === 'email' || channel === 'linkedin_manual';
  });
  return options(MESSAGE_CHANNEL_LABELS, keys);
}

/** O canal numa frase ("aprovo o uso por e-mail", "só pelo LinkedIn (envio manual)"). */
const CHANNEL_PHRASES: Record<MessageChannel, string> = {
  email: 'por e-mail',
  linkedin_manual: 'pelo LinkedIn (envio manual)',
  phone: 'por telefone',
  in_person: 'pessoalmente',
  whatsapp_optin: 'pelo WhatsApp',
  other: 'por outro canal',
};

export function channelPhrase(channel: MessageChannel): string {
  return CHANNEL_PHRASES[channel];
}

/** Canais para registrar um contato recebido ou uma nota (qualquer um). */
export const ANY_CHANNEL_OPTIONS = options(MESSAGE_CHANNEL_LABELS);

export function stageLabel(stage: OpportunityStage): string {
  return OPPORTUNITY_STAGE_LABELS[stage];
}

export function problemLabels(problems: readonly ApprovalProblem[]): string[] {
  return problems.map((problem) => APPROVAL_PROBLEM_LABELS[problem]);
}

/**
 * Selo de uma mensagem aprovada que não vale mais, pelo motivo principal (o primeiro da lista do
 * domínio): "Usada", "Revogada", "Vencida" ou "Não vale mais".
 */
export function approvalStateLabel(problems: readonly ApprovalProblem[]): string | null {
  if (problems.length === 0) return null;
  if (problems.includes('used')) return 'Usada';
  if (problems.includes('revoked')) return 'Revogada';
  if (problems.includes('expired')) return 'Vencida';
  return 'Não vale mais';
}

/**
 * A aprovação acabou por tempo ou por decisão sua (revogada, vencida), e o texto continua o
 * mesmo: dá para gerar uma versão nova, igual, e aprovar de novo.
 */
export function canPrepareReapproval(problems: readonly ApprovalProblem[]): boolean {
  return (
    problems.length > 0 &&
    !problems.includes('used') &&
    !problems.includes('suppressed') &&
    (problems.includes('revoked') || problems.includes('expired'))
  );
}

/**
 * O que cada tipo de aviso da conferência automática pede para conferir (KI-150). A versão gravada
 * guarda só o tipo, não o trecho: o texto está no cartão, logo acima do aviso.
 */
export const AI_REVIEW_KIND_TEXT: Record<AiReviewKind, string> = {
  source:
    'Uma informação aparece como vista no site ou no Instagram da empresa, mas as evidências de lá não trazem isso. Confira de onde ela veio.',
  added: 'A nova versão traz nome ou número que não estava na versão anterior nem no seu pedido.',
  invented:
    'O texto cita nome, número ou lugar que não está nas evidências da empresa nem no seu pedido.',
  strategy: 'A estratégia cita algo que não está nas evidências da empresa nem no seu pedido.',
  request: 'O seu pedido mandava citar algo que o texto não traz.',
  tone: 'O texto usa palavra forte (como "grave" ou "urgente") que nenhum fato registrado sustenta.',
  proportion: 'O texto diz uma proporção ou medida que as evidências não mostram.',
  agency:
    'O texto diz algo da agência (experiência, clientes, resultados) que não está nos dados da agência.',
};

/** Ajustes do sistema depois da correção: menções de fonte errada tiradas do texto. */
export function adjustedSourcesText(count: number): string {
  return count === 1
    ? 'O sistema tirou do texto uma menção de fonte que não batia com as evidências (como "no site da empresa"). Confira se a frase continua correta.'
    : `O sistema tirou do texto ${count} menções de fonte que não batiam com as evidências (como "no site da empresa"). Confira se as frases continuam corretas.`;
}

/** Aviso de conferência (a IA deixou trecho para checar) aparece como alerta, não como sucesso. */
export function noticeTone(notice: OpportunityNotice): 'success' | 'warning' {
  return notice === OPPORTUNITY_NOTICES.preparedReview ||
    notice === OPPORTUNITY_NOTICES.messageRewrittenReview ||
    notice === OPPORTUNITY_NOTICES.messageCreatedReview
    ? 'warning'
    : 'success';
}

export const NOTICE_TEXT: Record<OpportunityNotice, string> = {
  [OPPORTUNITY_NOTICES.prepared]:
    'Abordagem preparada: a estratégia e o primeiro rascunho estão abaixo. Revise o texto antes de aprovar; nada foi enviado.',
  [OPPORTUNITY_NOTICES.preparedReview]:
    'Abordagem preparada, mas a conferência automática deixou avisos no rascunho (veja no cartão da mensagem). Confira cada informação antes de aprovar; nada foi enviado.',
  [OPPORTUNITY_NOTICES.opened]:
    'Oportunidade aberta. Escreva a primeira mensagem, com ou sem a IA, ou registre um contato que já aconteceu.',
  [OPPORTUNITY_NOTICES.existing]:
    'Essa empresa já tinha uma oportunidade aberta. Nada foi criado: esta é a oportunidade dela.',
  [OPPORTUNITY_NOTICES.approved]:
    'Mensagem aprovada para uso por 72 horas. O Prospector não envia nada: envie você mesmo e depois registre o contato feito.',
  [OPPORTUNITY_NOTICES.revoked]:
    'Aprovação revogada. A mensagem não pode ser usada; para usar o texto de novo, prepare uma versão nova e aprove.',
  [OPPORTUNITY_NOTICES.reapproval]:
    'Versão nova criada como rascunho, com o mesmo texto. Revise e aprove de novo antes de usar.',
  [OPPORTUNITY_NOTICES.messageEdited]:
    'Nova versão salva como rascunho. Revise e aprove antes de usar; uma aprovação anterior deixa de valer.',
  [OPPORTUNITY_NOTICES.messageRewritten]:
    'A IA escreveu uma nova versão, em rascunho. Revise e aprove antes de usar.',
  [OPPORTUNITY_NOTICES.messageRewrittenReview]:
    'A IA escreveu uma nova versão, em rascunho, mas a conferência automática deixou avisos (veja no cartão da mensagem). Confira cada informação antes de aprovar.',
  [OPPORTUNITY_NOTICES.messageCreated]:
    'A IA escreveu o rascunho. Revise e aprove antes de usar; nada foi enviado.',
  [OPPORTUNITY_NOTICES.messageCreatedReview]:
    'A IA escreveu o rascunho, mas a conferência automática deixou avisos (veja no cartão da mensagem). Confira cada informação antes de aprovar; nada foi enviado.',
  [OPPORTUNITY_NOTICES.messageDiscarded]:
    'Mensagem descartada. As versões continuam no histórico da auditoria.',
  [OPPORTUNITY_NOTICES.planDiscarded]: 'Estratégia descartada. As mensagens já escritas continuam.',
  [OPPORTUNITY_NOTICES.contactRecorded]:
    'Contato registrado. A aprovação foi usada; para escrever de novo, crie outra mensagem.',
  [OPPORTUNITY_NOTICES.suppressed]:
    'Empresa na lista de supressão: nenhum contato novo, e os follow-ups abertos foram cancelados.',
  [OPPORTUNITY_NOTICES.lifted]: 'Supressão retirada. O motivo ficou registrado na auditoria.',
  [OPPORTUNITY_NOTICES.taskDone]: 'Follow-up concluído.',
  [OPPORTUNITY_NOTICES.taskCancelled]: 'Follow-up cancelado.',
};

/** Etapas abertas, na ordem das colunas do kanban. */
export const OPEN_STAGES = OPPORTUNITY_STAGES.filter(
  (stage) => stage !== 'won' && stage !== 'lost',
);

/** Confiança do serviço recomendado (faixas do diagnóstico de Empresas, KI-129). */
export const INSIGHT_CONFIDENCE_LABELS: Record<'low' | 'medium' | 'high', string> = {
  low: 'baixa',
  medium: 'média',
  high: 'alta',
};

/**
 * Oferta já marcada em "Preparar abordagem": a escolhida antes; senão, a recomendada pelo
 * diagnóstico, se estiver entre as ativas; senão, nenhuma (o formulário usa a primeira).
 */
export function preparedOfferId(
  offers: readonly Option[],
  current: string | null,
  recommended: string | null,
): string | null {
  const active = (id: string | null) =>
    id && offers.some((offer) => offer.value === id) ? id : null;
  return active(current) ?? active(recommended);
}
