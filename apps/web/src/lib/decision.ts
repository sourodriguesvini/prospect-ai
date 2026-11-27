import {
  THESIS_RECOMMENDATION_LABELS,
  type CommercialThesis,
  type Company,
  type Diagnosis,
  type Investigation,
  type OfferAssessment,
  type Recommendation,
} from '@prospector/contracts';
import { CONFIDENCE_BAND_THRESHOLDS } from '@prospector/domain';

/**
 * Leitura comercial do diagnóstico para o topo da página da empresa ("Vale abordar?").
 *
 * Três dimensões que não se misturam (pedido do usuário, 26/11):
 * - potencial comercial: a recomendação do diagnóstico, dita em linguagem de negócio;
 * - segurança da análise: quanto as evidências cobrem (confiança geral de 0 a 100);
 * - com quem falar: disponibilidade de contato, que o Prospector ainda não registra.
 *
 * `prepare_access` ("Preparar acesso") é a mesma oportunidade de `pursue` sem contato conhecido
 * (o modelo de qualificação desconta a prioridade por isso). Aqui ela aparece como "Vale abordar",
 * com a falta de contato na dimensão própria: uma boa oportunidade não parece pior só porque o
 * decisor ainda não foi encontrado. O modelo gravado não muda (docs/decisoes-entrega-1).
 */

export type DecisionAction = 'prepare_message' | 'complete_analysis' | 'watch' | 'none';
export type DecisionTone = 'positive' | 'neutral' | 'caution';

export interface RecommendationView {
  /** Resposta curta para "Vale abordar?". */
  headline: string;
  tone: DecisionTone;
  action: DecisionAction;
}

export const RECOMMENDATION_VIEW: Record<Recommendation, RecommendationView> = {
  pursue: { headline: 'Vale abordar agora', tone: 'positive', action: 'prepare_message' },
  prepare_access: { headline: 'Vale abordar', tone: 'positive', action: 'prepare_message' },
  investigate_more: {
    headline: 'Falta informação para decidir',
    tone: 'neutral',
    action: 'complete_analysis',
  },
  monitor: { headline: 'Ainda não é o momento', tone: 'neutral', action: 'watch' },
  discard: { headline: 'Não parece uma boa oportunidade agora', tone: 'caution', action: 'none' },
  insufficient_evidence: {
    headline: 'Não achamos informação suficiente',
    tone: 'caution',
    action: 'complete_analysis',
  },
};

/**
 * Validação real do Flash e revisão de UX (27/11): o título vem da comparação com os serviços e a
 * tese comercial vem de outra regra; quando discordam, o cartão não pode dar duas respostas
 * opostas sem dizer. A tese entra como ressalva logo abaixo do título, com o motivo dela.
 */
export function thesisCaveat(
  recommendation: Recommendation,
  thesis: CommercialThesis | null,
): string | null {
  if (!thesis) return null;
  const approachTitle = RECOMMENDATION_VIEW[recommendation].action === 'prepare_message';
  if (approachTitle && thesis.recommendation !== 'approach') {
    // Rótulo e motivo em frases separadas: o motivo já costuma ter dois-pontos.
    const reason = thesis.recommendationReason.trim().replace(/[.!?…]$/, '');
    return `Ressalva da tese comercial: ${THESIS_RECOMMENDATION_LABELS[thesis.recommendation].toLowerCase()}. ${reason}.`;
  }
  if (!approachTitle && thesis.recommendation === 'approach' && thesis.principal) {
    return `A tese comercial vê um ângulo para abordar (${thesis.principal.title}). Confira os pontos abertos dela antes de decidir.`;
  }
  return null;
}

/**
 * Validação real do Flash (27/11): "O que mudou" dizia "nenhuma mudança" quando o veredito tinha
 * passado de "Falta informação" para "Vale abordar". As mudanças do retrato (páginas, sinais) não
 * cobrem o diagnóstico; estas frases cobrem, com as mesmas palavras do topo.
 */
export function verdictChanges(previous: Diagnosis | null, current: Diagnosis | null): string[] {
  if (!previous || !current) return [];
  const out: string[] = [];
  if (previous.recommendation !== current.recommendation) {
    out.push(
      `O veredito mudou de “${RECOMMENDATION_VIEW[previous.recommendation].headline}” para “${RECOMMENDATION_VIEW[current.recommendation].headline}”.`,
    );
  }
  const before = previous.thesis?.recommendation;
  const after = current.thesis?.recommendation;
  if (before && after && before !== after) {
    out.push(
      `A tese comercial mudou de “${THESIS_RECOMMENDATION_LABELS[before]}” para “${THESIS_RECOMMENDATION_LABELS[after]}”.`,
    );
  }
  return out;
}

/** Rótulo curto da recomendação para selos e listas (mesmas palavras do topo da empresa). */
export const RECOMMENDATION_SHORT: Record<Recommendation, string> = {
  pursue: 'Vale abordar agora',
  prepare_access: 'Vale abordar',
  investigate_more: 'Falta informação',
  monitor: 'Acompanhar',
  discard: 'Não agora',
  insufficient_evidence: 'Pouca informação',
};

/** Oferta que o diagnóstico recomenda; sem ela, a de maior prioridade que não foi descartada. */
export function recommendedOffer(diagnosis: Diagnosis): OfferAssessment | null {
  const byId = diagnosis.recommendedOfferId
    ? diagnosis.offers.find((offer) => offer.offerId === diagnosis.recommendedOfferId)
    : undefined;
  if (byId) return byId;
  return diagnosis.offers.find((offer) => offer.recommendation !== 'discard') ?? null;
}

export type SecurityLevel = 'high' | 'medium' | 'low';

/**
 * Segurança da análise a partir da confiança geral (0 a 100). Mesmos cortes do selo de confiança
 * das evidências (0,8 e 0,6, `CONFIDENCE_BAND_THRESHOLDS` do domínio), para as telas não terem
 * duas escalas diferentes.
 */
export function securityLevel(confidence: number): SecurityLevel {
  if (confidence >= CONFIDENCE_BAND_THRESHOLDS.high * 100) return 'high';
  if (confidence >= CONFIDENCE_BAND_THRESHOLDS.medium * 100) return 'medium';
  return 'low';
}

/**
 * Situação do contato com a empresa, lida do Relacionamento. `null` = não foi possível ler agora
 * (sem banco ou falha): na dúvida, o topo não oferece "Preparar mensagem".
 */
export interface ContactSituation {
  /** Pedidos de não contato em vigor (opt-out, pedido legal, "não contatar"). */
  suppressions: readonly { reason: string; createdAt: string }[];
  openOpportunityId: string | null;
}

export type DecisionNext =
  | { kind: 'suppressed' }
  | { kind: 'open_conversation'; opportunityId: string }
  | { kind: 'archived' }
  | { kind: 'disqualified' }
  | { kind: 'prepare_message' }
  | { kind: 'complete_analysis' }
  | { kind: 'watch' }
  | { kind: 'none' };

/**
 * Próximo passo do topo "Vale abordar?". O pedido de não contato vem antes de tudo (regra 7): a
 * tela nunca sugere abordar quem pediu para parar. Depois, conversa aberta, empresa arquivada ou
 * descartada pela pessoa e, só então, o que a recomendação pede.
 */
export function decisionNext(input: {
  recommendation: Recommendation;
  lifecycle: Company['lifecycle'];
  contact: ContactSituation | null;
}): DecisionNext {
  const { contact, lifecycle } = input;
  if (contact && contact.suppressions.length > 0) return { kind: 'suppressed' };
  if (contact?.openOpportunityId) {
    return { kind: 'open_conversation', opportunityId: contact.openOpportunityId };
  }
  if (lifecycle === 'archived') return { kind: 'archived' };
  if (lifecycle === 'disqualified') return { kind: 'disqualified' };
  const action = RECOMMENDATION_VIEW[input.recommendation].action;
  if (action === 'prepare_message') return contact ? { kind: 'prepare_message' } : { kind: 'none' };
  return { kind: action };
}

/** Estados da análise sem diagnóstico, para o topo não dizer "nunca analisamos" sem ser verdade. */
export type UndiagnosedState = 'never' | 'unfinished' | 'cancelled' | 'no_conclusion';

export function undiagnosedState(latest: Pick<Investigation, 'status'> | null): UndiagnosedState {
  if (!latest) return 'never';
  if (latest.status === 'failed' || latest.status === 'interrupted') return 'unfinished';
  if (latest.status === 'cancelled') return 'cancelled';
  // Terminou sem diagnóstico (sem evidência suficiente para concluir).
  return 'no_conclusion';
}

/** O custo dito antes de começar (até 3 buscas por análise, `collect.ts`). */
export const ANALYSIS_COST_TEXT =
  'Usa até 3 buscas na internet (gastam créditos do buscador), consulta o CNPJ na Receita quando há CNPJ e usa a IA deste computador; leva alguns minutos.';

export const SECURITY_LABELS: Record<SecurityLevel, string> = {
  high: 'Alta',
  medium: 'Média',
  low: 'Baixa',
};

export const SECURITY_HELP: Record<SecurityLevel, string> = {
  high: 'As conclusões se apoiam em várias fontes conferidas.',
  medium: 'Parte das conclusões se apoia em uma fonte só ou em informação antiga.',
  low: 'Há poucas fontes; trate as conclusões como pistas.',
};
