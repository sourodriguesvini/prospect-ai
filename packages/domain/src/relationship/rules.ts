import {
  CLOSED_STAGES,
  type ApprovalProblem,
  type ApproachBasis,
  type ApproachInsights,
  type AttentionItem,
  type Claim,
  type ClaimDomain,
  type MessageChannel,
  type OpportunityStage,
  type OpportunitySummary,
  type ReplyClassification,
  type Task,
} from '@prospector/contracts';
import { confidenceBand, effectiveStatus } from '../evidence/confidence';

/**
 * Regras do Relacionamento (ADR-0014): puras, sem IO nem relógio (o "agora" e os limites do dia
 * chegam por parâmetro). Decisões de persistência, permissão e conformidade são daqui ou do
 * serviço; a IA só sugere.
 */

// -----------------------------------------------------------------------------
// Conteúdo aprovado: o hash cobre exatamente o que sai (canal, assunto, corpo)
// -----------------------------------------------------------------------------

/**
 * Texto canônico de uma mensagem para o `payload_hash` da aprovação (regra 2). Qualquer mudança
 * no canal, no assunto ou no corpo muda o hash; espaços nas pontas e quebras de linha do Windows
 * não contam.
 */
export function messagePayload(message: {
  channel: MessageChannel;
  subject: string | null;
  body: string;
}): string {
  const clean = (value: string) => value.replace(/\r\n/g, '\n').trim();
  return JSON.stringify({
    v: 1,
    channel: message.channel,
    subject: message.subject ? clean(message.subject) : null,
    body: clean(message.body),
  });
}

/**
 * Validade de uma aprovação de uso: 72 horas (docs/12 §2). O envio é manual, então a supressão só
 * é conferida de novo quando o contato é registrado; uma validade curta encurta esse intervalo.
 */
export const APPROVAL_VALIDITY_DAYS = 3;

/**
 * Por que uma mensagem aprovada não pode ser usada agora. Vazio = pode. Confere a aprovação, a
 * versão (editar invalida), o hash, a supressão e a conformidade NO MOMENTO do uso.
 */
export function approvalProblems(input: {
  message: { status: string; payloadHash: string; approvalId: string | null };
  isLatestVersion: boolean;
  approval: {
    id: string;
    status: string;
    payloadHash: string;
    expiresAt: string;
  } | null;
  /** Hash recalculado do texto atual da versão. */
  currentHash: string;
  suppressed: boolean;
  complianceReady: boolean;
  /** Já existe contato feito registrado com esta aprovação (uso único). */
  used?: boolean;
  now: Date;
}): ApprovalProblem[] {
  const problems: ApprovalProblem[] = [];
  const { message, approval } = input;
  if (!input.isLatestVersion) problems.push('edited');
  if (message.status !== 'approved' || !approval || message.approvalId !== approval.id) {
    problems.push('not_approved');
  } else if (input.used) {
    problems.push('used');
  } else {
    if (approval.status !== 'approved') problems.push('revoked');
    if (input.now.getTime() >= Date.parse(approval.expiresAt)) problems.push('expired');
    if (approval.payloadHash !== input.currentHash || message.payloadHash !== input.currentHash) {
      problems.push('hash_mismatch');
    }
  }
  if (input.suppressed) problems.push('suppressed');
  if (!input.complianceReady) problems.push('compliance');
  return problems;
}

// -----------------------------------------------------------------------------
// Estado do contato: identificação, opt-out, canais e marcadores
// -----------------------------------------------------------------------------

export interface MessageIssue {
  field: 'body' | 'subject' | 'channel' | '_form';
  message: string;
}

function fold(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Marcadores que a IA deixa para o usuário completar ("[nome do case]"). */
const PLACEHOLDER = /\[[^\]\n]{1,80}\]/;

/**
 * Em que pé está o contato com a empresa, a partir do que foi registrado (nunca do tipo da
 * mensagem): é isso que decide identificação, opt-out e canais permitidos.
 */
export interface ContactState {
  /** Nenhum contato feito registrado ainda: a próxima mensagem abre a conversa. */
  firstContact: boolean;
  /** A empresa ainda não respondeu: o opt-out vai em toda mensagem até lá (docs/12 §4). */
  awaitingFirstReply: boolean;
  /** A empresa escreveu pelo WhatsApp: só então esse canal pode ser usado (docs/12 §5). */
  whatsappOptIn: boolean;
}

export function contactState(
  interactions: ReadonlyArray<{ direction: string; channel: MessageChannel }>,
): ContactState {
  const inbound = interactions.filter((item) => item.direction === 'inbound');
  return {
    firstContact: !interactions.some((item) => item.direction === 'outbound'),
    awaitingFirstReply: inbound.length === 0,
    whatsappOptIn: inbound.some((item) => item.channel === 'whatsapp_optin'),
  };
}

/** Canais do primeiro contato: só os de texto, com registro e envio manual (docs/12 §5). */
export const FIRST_CONTACT_CHANNELS: ReadonlySet<MessageChannel> = new Set([
  'email',
  'linkedin_manual',
]);

/**
 * Canal permitido para a mensagem. Primeiro contato só por e-mail ou LinkedIn (envio manual);
 * WhatsApp só depois que a empresa escreveu por lá. Nenhum canal é automático.
 */
export function channelIssues(
  channel: MessageChannel,
  state: Pick<ContactState, 'firstContact' | 'whatsappOptIn'>,
): MessageIssue[] {
  if (channel === 'whatsapp_optin') {
    // Responder pelo canal que a própria empresa usou é permitido, mesmo antes do nosso contato.
    if (state.whatsappOptIn) return [];
    return [
      {
        field: 'channel',
        message:
          'WhatsApp só depois que a empresa escrever por lá (registre a resposta recebida pelo WhatsApp). Use e-mail ou LinkedIn (envio manual).',
      },
    ];
  }
  if (state.firstContact && !FIRST_CONTACT_CHANNELS.has(channel)) {
    return [
      {
        field: 'channel',
        message: 'O primeiro contato é só por e-mail ou LinkedIn (envio manual).',
      },
    ];
  }
  return [];
}

/**
 * Conferência determinística antes de aprovar (parte bloqueante do `message_verifier`, docs/12
 * §4). Vale pelo estado do contato, qualquer que seja o tipo escolhido: no primeiro contato, a
 * agência se identifica e o canal do titular aparece; até a empresa responder, toda mensagem leva
 * o opt-out; nenhuma mensagem é aprovada com marcador por completar.
 */
export function messageIssues(
  input: {
    channel: MessageChannel;
    subject: string | null;
    body: string;
    agencyName: string | null;
    optOutText: string | null;
    privacyContact: string | null;
  } & ContactState,
): MessageIssue[] {
  const issues: MessageIssue[] = [];
  issues.push(...channelIssues(input.channel, input));
  if (PLACEHOLDER.test(input.body) || (input.subject && PLACEHOLDER.test(input.subject))) {
    issues.push({
      field: 'body',
      message: 'Complete ou apague o que está entre colchetes antes de aprovar.',
    });
  }
  if (input.channel === 'email' && input.firstContact && !input.subject?.trim()) {
    issues.push({ field: 'subject', message: 'E-mail de primeiro contato precisa de assunto.' });
  }
  const body = fold(input.body);
  if (input.firstContact) {
    if (!input.agencyName || !body.includes(fold(input.agencyName))) {
      issues.push({
        field: 'body',
        message: input.agencyName
          ? `No primeiro contato, a mensagem precisa dizer quem escreve: cite "${input.agencyName}".`
          : 'Cadastre o nome da agência em Configuração > Conformidade > Identificação e opt-out.',
      });
    }
    if (input.privacyContact && !body.includes(fold(input.privacyContact))) {
      issues.push({
        field: 'body',
        message: `No primeiro contato, mantenha o canal do titular no fim da mensagem (${input.privacyContact}).`,
      });
    }
  }
  if (input.firstContact || input.awaitingFirstReply) {
    if (!input.optOutText || !body.includes(fold(input.optOutText))) {
      issues.push({
        field: 'body',
        message: input.optOutText
          ? 'Até a empresa responder, mantenha a frase de opt-out da política de contato no fim da mensagem.'
          : 'Cadastre o texto de opt-out em Configuração > Conformidade > Identificação e opt-out.',
      });
    }
  }
  return issues;
}

/** Acrescenta a frase de opt-out da política ao fim do texto, se ainda não estiver lá. */
export function withOptOut(body: string, optOutText: string | null): string {
  if (!optOutText) return body.trim();
  if (fold(body).includes(fold(optOutText))) return body.trim();
  return `${body.trim()}\n\n${optOutText.trim()}`;
}

/**
 * Rodapé que o sistema garante (não a IA): até a empresa responder, a frase de opt-out; no
 * primeiro contato, também o canal do titular. Não duplica o que já estiver no texto.
 */
export function withContactFooter(
  body: string,
  policy: { optOutText: string | null; privacyContact: string | null },
  state: Pick<ContactState, 'firstContact' | 'awaitingFirstReply'>,
): string {
  let text = body.trim();
  if (state.firstContact || state.awaitingFirstReply) text = withOptOut(text, policy.optOutText);
  if (state.firstContact && policy.privacyContact) {
    if (!fold(text).includes(fold(policy.privacyContact))) {
      text = `${text}\nPrivacidade e dados pessoais: ${policy.privacyContact.trim()}`;
    }
  }
  return text;
}

/**
 * O texto sem o rodapé que `withContactFooter` acrescentou (canal do titular e opt-out, nessa
 * ordem, no fim). Usado antes de mandar uma versão para a IA reescrever: o rodapé é do sistema,
 * não da IA, e volta depois. Rodapé editado à mão fica (e `withOptOut` não o duplica).
 */
export function withoutContactFooter(
  body: string,
  policy: { optOutText: string | null; privacyContact: string | null },
): string {
  let text = body.trim();
  const tails = [
    policy.privacyContact ? `Privacidade e dados pessoais: ${policy.privacyContact.trim()}` : '',
    policy.optOutText?.trim() ?? '',
  ];
  for (const tail of tails) {
    if (tail && text.endsWith(tail)) text = text.slice(0, -tail.length).trimEnd();
  }
  return text;
}

// -----------------------------------------------------------------------------
// Pedido para parar: regra determinística (vale antes e independente da IA)
// -----------------------------------------------------------------------------

/** Tempo ou ressalva logo depois do verbo: "não me procure agora" é adiamento, não opt-out. */
const NOT_NOW = String.raw`(?!\s+(agora|ainda|hoje|amanha|antes|durante|ate|por enquanto|no momento|nesta|nessa|neste|nesse|so\b|apenas|pel[oa] (whats|telefone|celular|e-?mail|linkedin)|por (aqui|whats|telefone|celular|e-?mail|linkedin)))`;

const STOP_PATTERNS: readonly RegExp[] = [
  // Palavras de opt-out.
  /\bdescadastr/,
  /\bunsubscribe\b/,
  /\bopt[- ]?out\b/,
  // "remova meu e-mail", "excluam meus dados", "remover este contato da lista".
  /\b(remov|retir|tir|exclu|apag|delet)(a|e|o|am|em|ar|er|ir|i|ue|uem)?\s+(o\s+|a\s+|os\s+|as\s+)?(meu|minha|meus|minhas|nosso|nossa|nossos|nossas|este|esse|esta|essa|estes|esses)\s+(e-?mails?|contatos?|enderecos?|numeros?|telefones?|cadastros?|nomes?|dados)\b/,
  /\b(remov|retir|tir|exclu|apag|delet)\w*\s+(o\s+|a\s+|os\s+|as\s+)?(e-?mails?|contatos?|enderecos?|numeros?|telefones?|cadastros?|nomes?|dados)\s+(da|de|do|dos|das)\s+(sua\s+|seu\s+|vossa\s+|tua\s+)?(lista|listas|base|mailing|cadastro|sistema|envios)\b/,
  // "me tirem da lista", "me tire do mailing", "nos removam da base".
  /\b(me|nos)\s+(remov|retir|tir|exclu|descadastr)\w*\s+(da|de|do|dos|das)\s+(sua\s+|seu\s+|vossa\s+|tua\s+)?(lista|listas|base|mailing|cadastro|contatos|envios|sistema)\b/,
  // "remova-me", "tirem-nos" (sem "tire-me uma dúvida").
  /\b(remova|remove|removam|retire|retirem|tire|tirem|exclua|excluam|descadastre|descadastrem)-(me|nos)\b(?!\s+(uma|um|umas|uns|as|os|a|o|essa|esta)\s+(duvidas?|questao|questoes|curiosidade))/,
  // "quero sair da lista", "sair do mailing".
  /\bsair\s+(da|do|de)\s+(sua\s+|seu\s+|vossa\s+)?(lista|listas|base|mailing|cadastro)\b/,
  // "não me contatem", "não nos procurem" (verbos de contato, sem adiamento).
  new RegExp(
    String.raw`\bnao\s+(me|nos)\s+(contate|contatem|contatar|contacte|contactem|procure|procurem|procurar|incomode|incomodem|incomodar|aborde|abordem)\b` +
      NOT_NOW,
  ),
  // "não me envie mais", "não mande e-mails novamente" (canal + "mais"/"de novo").
  /\bnao\s+(me\s+|nos\s+)?(envie|enviem|enviar|mande|mandem|mandar|ligue|liguem|ligar|escreva|escrevam|escrever|chame|chamem|chamar)\s+(\S+\s+){0,3}?(mais(?!\s+tarde)|novamente|de novo)\b/,
  // "não entrem em contato", "favor não entrar em contato".
  /\bnao\s+(entre|entrem|entrar|entra)\s+(mais\s+)?em\s+contato\b/,
  // "não quero mais receber", "não queremos ser contatados".
  /\bnao\s+(quero|queremos|desejo|desejamos|gostaria|gostariamos)\s+(mais\s+)?(receber\s+(mais\s+)?(nada|nenhum|nenhuma|e-?mails?|mensage|contato|comunicac|propaganda|ofertas|esse tipo|este tipo)|receber\s+mais\b|ser\s+(mais\s+)?(contatad|procurad|incomodad|abordad)|(mais\s+)?contato\b|(mais\s+)?mensage)/,
  // "parem de me mandar", "favor parar de enviar".
  /\b(pare|parem|parar|para)\s+de\s+(me\s+|nos\s+)?(enviar|mandar|contatar|ligar|procurar|escrever|incomodar|chamar)\b/,
  // "não insistam".
  /\bnao\s+(insista|insistam|insistir)\b/,
  // Inglês.
  /\b(remove\s+(me|us)|take\s+(me|us)\s+off|stop\s+(emailing|contacting|sending|messaging)|do\s+not\s+(contact|email|e-mail|message)|don'?t\s+(contact|email|e-mail|message))\b/,
];

/** Respostas curtas que, sozinhas, são pedido para parar ("Remover.", "Por favor, sair"). */
const STOP_KEYWORDS: ReadonlySet<string> = new Set([
  'remover',
  'remova',
  'remove',
  'descadastrar',
  'descadastre',
  'descadastro',
  'sair',
  'parar',
  'pare',
  'stop',
  'unsubscribe',
]);

const POLITENESS =
  /\b(por favor|pf|pfv|pfvr|favor|obrigad[oa]s?|grat[oa]|att|atenciosamente|abs|abracos?|ok|please|thanks)\b/g;

/** Cabeçalho do e-mail citado ("Em ter., 10 de nov., X escreveu:", "De: …", "On … wrote:"). */
const QUOTE_HEADER =
  /^(-{2,}\s*(mensagem original|original message)|_{5,}|(de|from|enviado|sent|para|to|assunto|subject):\s)|(^|\s)(escreveu|wrote):\s*$/;

/**
 * Só o que a empresa escreveu: corta a mensagem citada (linhas com ">" e tudo depois do cabeçalho
 * de resposta). Quem cola a conversa inteira não pode disparar o opt-out com o NOSSO rodapé.
 */
function ownWords(text: string): string[] {
  const kept: string[] = [];
  for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
    const folded = fold(line);
    if (QUOTE_HEADER.test(folded)) break;
    if (/^\s*>/.test(line)) continue;
    if (folded) kept.push(folded);
  }
  return kept;
}

/**
 * O que a empresa escreveu, com a grafia e as quebras de linha originais, sem a mensagem citada.
 * É isso que vai para a IA interpretar: o texto citado (a nossa mensagem, o nosso rodapé de
 * opt-out) não pode virar "pedido para parar" nem instrução. Se nada sobrar, o texto inteiro.
 */
export function replyOwnText(text: string): string {
  const kept: string[] = [];
  for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
    if (QUOTE_HEADER.test(fold(line))) break;
    if (/^\s*>/.test(line)) continue;
    kept.push(line);
  }
  const own = kept.join('\n').trim();
  return own || text.trim();
}

function coreWords(text: string): string {
  return text
    .replace(POLITENESS, ' ')
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Palavras entre aspas na frase de opt-out da política ("responda “sair”"): também valem sozinhas. */
function policyKeywords(optOutText: string | null | undefined): string[] {
  if (!optOutText) return [];
  const words: string[] = [];
  for (const match of optOutText.matchAll(/["“”'‘’«»]([^"“”'‘’«»\n]{2,24})["“”'‘’«»]/g)) {
    const word = coreWords(fold(match[1] ?? ''));
    if (word) words.push(word);
  }
  return words;
}

/**
 * Pedido explícito para parar o contato (opt-out). Determinístico: honrado na hora, sem esperar a
 * IA (regra 7). Na dúvida entre parar e seguir, prefere parar: a supressão pode ser retirada com
 * motivo, um contato indevido não pode ser desfeito. Negativa simples ("não temos interesse
 * agora") NÃO é opt-out: fica para a interpretação, que sugere respeitar a negativa sem insistir.
 * Ignora o texto citado e a própria frase de opt-out da política, se vier colada junto.
 */
export function detectStopRequest(
  text: string,
  policy: { optOutText?: string | null } = {},
): { matched: boolean; phrase: string | null } {
  const footer = policy.optOutText ? fold(policy.optOutText) : '';
  const withoutFooter = (value: string) => (footer ? value.split(footer).join(' ') : value);
  const lines = ownWords(text);
  const folded = withoutFooter(lines.join(' '));
  for (const pattern of STOP_PATTERNS) {
    const match = pattern.exec(folded);
    if (match) return { matched: true, phrase: match[0].trim().slice(0, 80) };
  }
  const keywords = new Set([...STOP_KEYWORDS, ...policyKeywords(policy.optOutText)]);
  for (const candidate of [coreWords(folded), coreWords(withoutFooter(lines[0] ?? ''))]) {
    if (candidate && candidate.length <= 30 && keywords.has(candidate)) {
      return { matched: true, phrase: candidate };
    }
  }
  return { matched: false, phrase: null };
}

// -----------------------------------------------------------------------------
// Base de evidência da abordagem
// -----------------------------------------------------------------------------

/** Domínios do ledger que dão gancho para uma abordagem (além do cadastro). */
const RELEVANT_DOMAINS: ReadonlySet<ClaimDomain> = new Set([
  'positioning',
  'visual',
  'digital_presence',
  'signal',
  'competitive',
]);

/**
 * Claim que a abordagem pode citar: em vigor, fato ou inferência, com confiança média ou alta.
 * Hipótese e confiança baixa ficam de fora (docs/08: hipótese não é argumento para o prospect).
 */
export function isCitableClaim(
  claim: Pick<Claim, 'status' | 'validUntil' | 'epistemicType' | 'confidence'>,
  now: Date,
): boolean {
  if (effectiveStatus(claim, now) !== 'active') return false;
  if (claim.epistemicType === 'hypothesis') return false;
  const band = confidenceBand(claim.confidence);
  return band === 'high' || band === 'medium';
}

export type ApproachBasisAssessment =
  | { basis: ApproachBasis; usableClaimIds: string[]; gaps: string[] }
  | { basis: 'insufficient'; usableClaimIds: string[]; gaps: string[] };

/**
 * Há base para abordar (ADR-0014, item 8)? Precisa de pelo menos um FATO citável no dossiê ou de
 * um diagnóstico de marca; sem nenhum dos dois, `insufficient` bloqueia a geração. Sem diagnóstico,
 * a base é `limited`: gera com aviso e lista o que investigar. Só claims citáveis entram.
 */
export function assessApproachBasis(input: {
  claims: ReadonlyArray<
    Pick<Claim, 'id' | 'domain' | 'status' | 'validUntil' | 'epistemicType' | 'confidence'>
  >;
  insights: ApproachInsights;
  hasDomain: boolean;
  now: Date;
}): ApproachBasisAssessment {
  const usable = input.claims.filter((claim) => isCitableClaim(claim, input.now));
  const usableClaimIds = usable.map((claim) => claim.id);
  const gaps: string[] = [];
  const diagnosis = input.insights.diagnosis;
  const hasFact = usable.some((claim) => claim.epistemicType === 'fact');
  if (!diagnosis) gaps.push('Diagnóstico de marca ainda não feito para esta empresa.');
  if (!input.hasDomain) gaps.push('Site da empresa não cadastrado.');
  if (!usable.some((claim) => RELEVANT_DOMAINS.has(claim.domain))) {
    gaps.push('Só há dados de cadastro: investigue presença digital, posicionamento ou visual.');
  }
  if (!usable.some((claim) => claim.domain === 'signal')) {
    gaps.push('Nenhum sinal comercial registrado (expansão, contratação, lançamento).');
  }
  if (!input.insights.recommendedService) {
    gaps.push('Serviço recomendado ainda não definido: a oferta é a que você escolher.');
  }
  if (!hasFact && !diagnosis) return { basis: 'insufficient', usableClaimIds, gaps };
  return { basis: diagnosis ? 'sufficient' : 'limited', usableClaimIds, gaps };
}

/**
 * Ids citados pela IA que não estão entre os citáveis (`isCitableClaim`). O serviço descarta esses
 * ids, e o ponto da estratégia que fica sem nenhum id válido sai.
 */
export function unknownIds(cited: readonly string[], allowed: ReadonlySet<string>): string[] {
  return [...new Set(cited.filter((id) => !allowed.has(id)))];
}

// -----------------------------------------------------------------------------
// Pipeline
// -----------------------------------------------------------------------------

export function isClosedStage(stage: OpportunityStage): boolean {
  return CLOSED_STAGES.has(stage);
}

/** Etapa nova: encerra, reabre ou só move. Mesma etapa não é mudança. */
export function stageTransition(
  from: OpportunityStage,
  to: OpportunityStage,
): { kind: 'none' | 'move' | 'close' | 'reopen' } {
  if (from === to) return { kind: 'none' };
  if (isClosedStage(to)) return { kind: isClosedStage(from) ? 'move' : 'close' };
  if (isClosedStage(from)) return { kind: 'reopen' };
  return { kind: 'move' };
}

// -----------------------------------------------------------------------------
// Atenção: quem precisa de acompanhamento (determinístico, explicável)
// -----------------------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000;
/** Sem resposta depois do nosso contato: vira "aguardando" depois disto. */
export const AWAITING_REPLY_DAYS = 5;
/** Sem nenhum contato: oportunidade esquecida. */
export const STALE_DAYS = 30;

const RANK: Record<AttentionItem['kind'], number> = {
  task_overdue: 0,
  reply_waiting_us: 1,
  task_due_today: 2,
  draft_to_review: 3,
  awaiting_their_reply: 4,
  no_next_step: 5,
  stale: 6,
  missing_info: 7,
};

function daysBetween(fromIso: string, now: Date): number {
  return Math.floor((now.getTime() - Date.parse(fromIso)) / DAY_MS);
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * Itens de atenção da central e do Copiloto. Só oportunidades abertas; empresa com opt-out não
 * gera cobrança de contato (só a tarefa vencida, se houver, para ser cancelada).
 */
export function attentionItems(input: {
  opportunities: readonly OpportunitySummary[];
  openTasks: readonly Pick<Task, 'id' | 'opportunityId' | 'title' | 'dueAt' | 'status'>[];
  /** Rascunhos (mais recentes de cada linha) esperando revisão, por oportunidade. */
  draftsByOpportunity: ReadonlyMap<string, number>;
  now: Date;
  /** Início e fim do dia de hoje no fuso da agência. */
  dayStart: Date;
  dayEnd: Date;
}): AttentionItem[] {
  const items: AttentionItem[] = [];
  const open = input.opportunities.filter((item) => item.closedAt === null);
  const byId = new Map(open.map((item) => [item.id, item]));

  for (const task of input.openTasks) {
    if (task.status !== 'open') continue;
    const opportunity = byId.get(task.opportunityId);
    if (!opportunity) continue;
    const due = Date.parse(task.dueAt);
    const base = {
      opportunityId: opportunity.id,
      companyId: opportunity.companyId,
      companyName: opportunity.companyName,
      at: task.dueAt,
      isDemo: opportunity.isDemo || opportunity.companyIsDemo,
    };
    if (due < input.dayStart.getTime()) {
      const late = Math.max(1, Math.ceil((input.dayStart.getTime() - due) / DAY_MS));
      items.push({
        ...base,
        kind: 'task_overdue',
        rank: RANK.task_overdue,
        detail: `"${task.title}" venceu há ${plural(late, 'dia', 'dias')}.`,
      });
    } else if (due < input.dayEnd.getTime()) {
      items.push({
        ...base,
        kind: 'task_due_today',
        rank: RANK.task_due_today,
        detail: `"${task.title}" é para hoje.`,
      });
    }
  }

  for (const item of open) {
    // Empresa que pediu para parar: nada a cobrar (rascunhos dela não podem ser aprovados).
    if (item.suppressed) continue;
    const base = {
      opportunityId: item.id,
      companyId: item.companyId,
      companyName: item.companyName,
      isDemo: item.isDemo || item.companyIsDemo,
    };
    const drafts = input.draftsByOpportunity.get(item.id) ?? 0;
    if (drafts > 0) {
      items.push({
        ...base,
        kind: 'draft_to_review',
        rank: RANK.draft_to_review,
        at: null,
        detail: `${plural(drafts, 'rascunho espera', 'rascunhos esperam')} sua revisão.`,
      });
    }
    const inbound = item.lastInboundAt ? Date.parse(item.lastInboundAt) : null;
    const outbound = item.lastOutboundAt ? Date.parse(item.lastOutboundAt) : null;
    if (inbound !== null && (outbound === null || inbound > outbound)) {
      items.push({
        ...base,
        kind: 'reply_waiting_us',
        rank: RANK.reply_waiting_us,
        at: item.lastInboundAt,
        detail: `Respondeu há ${plural(Math.max(0, daysBetween(item.lastInboundAt as string, input.now)), 'dia', 'dias')} e ainda não houve retorno.`,
      });
    } else if (
      outbound !== null &&
      item.openTasks === 0 &&
      daysBetween(item.lastOutboundAt as string, input.now) >= AWAITING_REPLY_DAYS
    ) {
      items.push({
        ...base,
        kind: 'awaiting_their_reply',
        rank: RANK.awaiting_their_reply,
        at: item.lastOutboundAt,
        detail: `Contato feito há ${plural(daysBetween(item.lastOutboundAt as string, input.now), 'dia', 'dias')}, sem resposta e sem follow-up marcado.`,
      });
    }
    if (item.openTasks === 0 && !item.nextAction) {
      items.push({
        ...base,
        kind: 'no_next_step',
        rank: RANK.no_next_step,
        at: null,
        detail: 'Nenhum follow-up nem próximo passo definido.',
      });
    }
    const last = item.lastInteractionAt ?? item.createdAt;
    const idle = daysBetween(last, input.now);
    if (idle >= STALE_DAYS) {
      items.push({
        ...base,
        kind: 'stale',
        rank: RANK.stale,
        at: last,
        detail: item.lastInteractionAt
          ? `Último contato há ${plural(idle, 'dia', 'dias')}.`
          : `Aberta há ${plural(idle, 'dia', 'dias')}, sem nenhum contato registrado.`,
      });
    }
    if (!item.offerId) {
      items.push({
        ...base,
        kind: 'missing_info',
        rank: RANK.missing_info,
        at: null,
        detail: 'Serviço potencial não definido.',
      });
    }
  }

  return items.sort(
    (a, b) =>
      a.rank - b.rank ||
      (a.at && b.at ? Date.parse(a.at) - Date.parse(b.at) : a.at ? -1 : b.at ? 1 : 0) ||
      a.companyName.localeCompare(b.companyName, 'pt-BR'),
  );
}

// -----------------------------------------------------------------------------
// Sugestão de etapa (Copiloto): só sugere; quem muda é a pessoa, na tela
// -----------------------------------------------------------------------------

/** Ordem do funil (abertas), para saber se uma etapa está "antes" de outra. */
const FUNNEL: readonly OpportunityStage[] = [
  'identified',
  'qualified',
  'approach_ready',
  'contacted',
  'in_conversation',
  'meeting',
  'proposal',
  'negotiation',
];

function before(stage: OpportunityStage, target: OpportunityStage): boolean {
  const at = FUNNEL.indexOf(stage);
  return at !== -1 && at < FUNNEL.indexOf(target);
}

export interface StageSuggestion {
  to: OpportunityStage;
  /** Por que, em pt-BR, com o fato registrado que justifica. */
  reason: string;
}

/**
 * Próxima etapa que os registros sustentam, ou null. Determinística e explicável: a leitura da
 * IA (classificação da última resposta) só entra se a pessoa já a viu na tela; nada muda sozinho.
 */
export function suggestStage(input: {
  stage: OpportunityStage;
  hasOutbound: boolean;
  hasInbound: boolean;
  /** Classificação da última resposta interpretada, se houver. */
  lastClassification: ReplyClassification | null;
}): StageSuggestion | null {
  const { stage, lastClassification } = input;
  if (isClosedStage(stage)) return null;
  if (lastClassification === 'refusal' || lastClassification === 'stop_request') {
    return {
      to: 'lost',
      reason: 'A última resposta interpretada é uma negativa ou um pedido para parar.',
    };
  }
  if (lastClassification === 'proposal_request' && before(stage, 'proposal')) {
    return { to: 'proposal', reason: 'A última resposta interpretada pede uma proposta.' };
  }
  if (lastClassification === 'meeting_request' && before(stage, 'meeting')) {
    return { to: 'meeting', reason: 'A última resposta interpretada pede uma reunião.' };
  }
  if (input.hasInbound && before(stage, 'in_conversation')) {
    return { to: 'in_conversation', reason: 'A empresa já respondeu um contato registrado.' };
  }
  if (input.hasOutbound && before(stage, 'contacted')) {
    return { to: 'contacted', reason: 'Já há contato feito registrado.' };
  }
  return null;
}
