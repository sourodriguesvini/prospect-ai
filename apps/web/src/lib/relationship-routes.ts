/** Endereços das telas do Relacionamento e das Aprovações (ADR-0014). */
const HUB = '/relacionamento';
const APPROVALS = '/aprovacoes';

/**
 * Valores conhecidos de `?aviso=` no detalhe da oportunidade (só esses viram mensagem). Ações cujo
 * formulário some depois de dar certo (aprovar, revogar, descartar, registrar o contato, supressão,
 * concluir um follow-up) voltam para a página com o aviso, em vez de uma mensagem que sumiria
 * junto do formulário. Editar e reescrever também: a versão nova recria os formulários da
 * mensagem, e um aviso preso ao formulário ficaria velho depois de aprovar (KI-154).
 */
export const OPPORTUNITY_NOTICES = {
  prepared: 'abordagem-preparada',
  opened: 'oportunidade-aberta',
  existing: 'oportunidade-existente',
  approved: 'mensagem-aprovada',
  revoked: 'aprovacao-revogada',
  reapproval: 'nova-versao-para-aprovar',
  messageEdited: 'nova-versao-salva',
  messageRewritten: 'versao-reescrita',
  messageDiscarded: 'mensagem-descartada',
  planDiscarded: 'estrategia-descartada',
  contactRecorded: 'contato-registrado',
  suppressed: 'empresa-na-supressao',
  lifted: 'supressao-retirada',
  taskDone: 'follow-up-concluido',
  taskCancelled: 'follow-up-cancelado',
} as const;
export type OpportunityNotice = (typeof OPPORTUNITY_NOTICES)[keyof typeof OPPORTUNITY_NOTICES];

/** Avisos da fila de Aprovações (o que dá para fazer lá com um rascunho). */
export const APPROVAL_NOTICES = {
  approved: OPPORTUNITY_NOTICES.approved,
  messageEdited: OPPORTUNITY_NOTICES.messageEdited,
  messageRewritten: OPPORTUNITY_NOTICES.messageRewritten,
  messageDiscarded: OPPORTUNITY_NOTICES.messageDiscarded,
} as const;
export type ApprovalNotice = (typeof APPROVAL_NOTICES)[keyof typeof APPROVAL_NOTICES];

/** Origem "fila de Aprovações" de uma ação; fora isso, a origem é o id da oportunidade. */
export const FROM_APPROVALS = 'aprovacoes';

export const relationshipRoutes = {
  hub: HUB,
  approaches: HUB,
  conversations: `${HUB}/conversas`,
  pipeline: `${HUB}/pipeline`,
  /** Pipeline em lista (a mesma informação do kanban, para leitores de tela e telas estreitas). */
  pipelineList: `${HUB}/pipeline?vista=lista`,
  opportunity: (id: string, notice?: OpportunityNotice, focusMessageId?: string) =>
    `${HUB}/oportunidades/${encodeURIComponent(id)}${notice ? `?aviso=${notice}${focusParam(focusMessageId)}` : ''}`,
  /** Âncoras das seções do detalhe. */
  opportunitySection: (id: string, section: 'mensagens' | 'conversa' | 'follow-ups' | 'etapa') =>
    `${HUB}/oportunidades/${encodeURIComponent(id)}#${section}`,
  approvals: APPROVALS,
  approvalsNotice: (notice: ApprovalNotice, focusMessageId?: string) =>
    `${APPROVALS}?aviso=${notice}${focusParam(focusMessageId)}`,
} as const;

const isApprovalNotice = (notice: OpportunityNotice): notice is ApprovalNotice =>
  (Object.values(APPROVAL_NOTICES) as readonly string[]).includes(notice);

/**
 * Para onde uma ação volta, com o aviso. `from` é `FROM_APPROVALS` ou o id da oportunidade; o
 * endereço é sempre montado aqui (nunca vem pronto do navegador).
 */
export function backWith(from: string, notice: OpportunityNotice, focusMessageId?: string): string {
  if (from === FROM_APPROVALS) {
    return isApprovalNotice(notice)
      ? relationshipRoutes.approvalsNotice(notice, focusMessageId)
      : APPROVALS;
  }
  return relationshipRoutes.opportunity(from, notice, focusMessageId);
}

/**
 * Mensagem que recebe o foco na chegada (`?mensagem=`), depois de editar ou reescrever: o botão
 * clicado some com a versão nova, e o foco iria para o início da página (KI-154).
 */
export const FOCUS_MESSAGE_PARAM = 'mensagem';

function focusParam(messageId: string | undefined): string {
  return messageId ? `&${FOCUS_MESSAGE_PARAM}=${encodeURIComponent(messageId)}` : '';
}

/** Id do `?mensagem=` só quando tem forma de UUID (vira id de elemento na página). */
export function focusMessageId(value: string | string[] | undefined): string | null {
  return typeof value === 'string' && /^[0-9a-f-]{36}$/i.test(value) ? value : null;
}

/** Rotas antigas, de quando cada parte era um módulo (redirecionadas no next.config.ts). */
export const LEGACY_RELATIONSHIP_REDIRECTS = [
  { source: '/abordagens', destination: relationshipRoutes.approaches },
  { source: '/conversas', destination: relationshipRoutes.conversations },
  { source: '/pipeline', destination: relationshipRoutes.pipeline },
] as const;
