import {
  THESIS_RECOMMENDATION_LABELS,
  type BusinessEvent,
  type BusinessEventType,
  type CommercialThesis,
  type EpistemicType,
} from '@prospector/contracts';
import { importanceOf, type EventEvidence } from './timeline';
import { brazilianPartialDate, fold } from './text';

/**
 * Seções do relatório da empresa (diretriz 2026-11-26, Parte 7): o resumo executivo com as cinco
 * perguntas e a separação dos acontecimentos por tema (produto e tecnologia, estrutura
 * organizacional). Só compõe o que já foi gravado (claims do ledger e a tese); nada novo é
 * afirmado aqui. Onde não há base, a resposta diz o que falta em vez de preencher.
 */

// -----------------------------------------------------------------------------
// Temas dos acontecimentos
// -----------------------------------------------------------------------------

export type ReportTopic = 'product_technology' | 'organization';

const PRODUCT_TYPES: ReadonlySet<BusinessEventType> = new Set(['launch', 'partnership']);
const ORGANIZATION_TYPES: ReadonlySet<BusinessEventType> = new Set([
  'leadership',
  'restructuring',
  'hiring',
  'expansion',
  'acquisition',
  'merger',
  'move',
]);
/** Tipos que contam como produto quando o texto fala de produto ou tecnologia. */
const PRODUCT_WHEN_MENTIONED: ReadonlySet<BusinessEventType> = new Set([
  'funding',
  'acquisition',
  'merger',
  'hiring',
  'new_market',
  'expansion',
]);

const PRODUCT_TERMS =
  /\b(produto|produtos|plataforma|tecnologia|tecnologias|software|aplicativo|app|api|apis|saas|inteligencia artificial|ia|engenharia|engenheiros|desenvolvedores|funcionalidade|funcionalidades|integracao|integracoes|cartao|cartoes)\b/;

function eventText(event: BusinessEvent): string {
  const purpose = event.funding?.purpose.status === 'declared' ? event.funding.purpose.value : null;
  return fold([event.headline, purpose?.text ?? '', purpose?.quote ?? ''].join(' '));
}

/** Em quais seções temáticas o acontecimento aparece (pode ser nenhuma ou as duas). */
export function reportTopics(event: BusinessEvent): ReportTopic[] {
  const topics: ReportTopic[] = [];
  if (
    PRODUCT_TYPES.has(event.type) ||
    (PRODUCT_WHEN_MENTIONED.has(event.type) && PRODUCT_TERMS.test(eventText(event)))
  ) {
    topics.push('product_technology');
  }
  if (ORGANIZATION_TYPES.has(event.type)) topics.push('organization');
  return topics;
}

/** Acontecimentos de um tema, do mais recente ao mais antigo (sem data no fim). */
export function eventsForTopic(
  items: readonly EventEvidence[],
  topic: ReportTopic,
): EventEvidence[] {
  return items
    .filter((item) => reportTopics(item.event).includes(topic))
    .sort((a, b) => (b.event.occurredOn ?? '').localeCompare(a.event.occurredOn ?? ''));
}

// -----------------------------------------------------------------------------
// Resumo executivo (cinco perguntas)
// -----------------------------------------------------------------------------

export type ExecutiveQuestion = 'who' | 'what' | 'why' | 'where' | 'how';

export const EXECUTIVE_QUESTION_LABELS: Readonly<Record<ExecutiveQuestion, string>> = Object.freeze(
  {
    who: 'Quem é a empresa?',
    what: 'O que está acontecendo?',
    why: 'Por que ela merece atenção?',
    where: 'Onde podemos contribuir?',
    how: 'Qual é a melhor abordagem?',
  },
);

/** De onde vem a resposta, para a tela apontar a seção completa. */
export type ExecutiveBasis = 'site' | 'registry' | 'events' | 'thesis' | 'offers';

export interface ExecutiveAnswer {
  readonly question: ExecutiveQuestion;
  readonly label: string;
  readonly text: string;
  /** false = a resposta diz o que falta (não há base gravada para responder). */
  readonly known: boolean;
  readonly basis: ExecutiveBasis | null;
}

/** O mínimo de um claim que o resumo usa. Sem `status`, vale como em vigor. */
export interface ReportClaim {
  readonly key: string;
  readonly statement: string;
  /** Inferência e hipótese aparecem marcadas (revisão de arquitetura de 27/11). */
  readonly epistemicType?: EpistemicType;
  /** Só `active` entra: vencido, contestado ou substituído não responde "quem é". */
  readonly status?: string;
}

export interface ExecutiveSummaryInput {
  readonly claims: readonly ReportClaim[];
  readonly events: readonly EventEvidence[];
  readonly thesis: CommercialThesis | null;
  /** Serviço recomendado pelo diagnóstico, para análises sem tese. */
  readonly fallbackOffer: string | null;
  /** Há pedido de não contato em vigor: a abordagem não é sugerida. */
  readonly contactBlocked: boolean;
}

const EPISTEMIC_WORDS: Readonly<Record<EpistemicType, string>> = {
  fact: 'fato',
  inference: 'inferência',
  hypothesis: 'hipótese a conferir',
};

const IMPORTANCE_RANK = { high: 0, medium: 1, low: 2, unknown: 3 } as const;

function lowerFirst(text: string): string {
  // Mantém siglas ("CTO", "PMO"): só baixa a inicial de palavra comum.
  return /^[A-ZÀ-Ý][a-zà-ÿ]/.test(text) ? text.charAt(0).toLowerCase() + text.slice(1) : text;
}

function sentence(text: string): string {
  const trimmed = text.trim();
  return /[.!?…]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

function firstClaim(claims: readonly ReportClaim[], keys: readonly string[]): ReportClaim | null {
  for (const key of keys) {
    const found = claims.find((claim) => claim.key === key);
    if (found) return found;
  }
  return null;
}

/** O enunciado com o tipo, quando não é fato ("… (inferência)."). */
function typed(claim: ReportClaim): string {
  const text = sentence(claim.statement);
  if (!claim.epistemicType || claim.epistemicType === 'fact') return text;
  return `${text.replace(/[.!?…]$/, '')} (${EPISTEMIC_WORDS[claim.epistemicType]}).`;
}

function who(all: readonly ReportClaim[]): Omit<ExecutiveAnswer, 'question' | 'label'> {
  const claims = all.filter((claim) => claim.status === undefined || claim.status === 'active');
  const identity = firstClaim(claims, [
    'positioning.value_proposition',
    'positioning.segment',
    'positioning.business_model',
  ]);
  const model = claims.find((claim) => claim.key === 'positioning.business_model');
  if (identity) {
    const parts = [typed(identity)];
    if (model && model !== identity) parts.push(typed(model));
    return { text: parts.join(' '), known: true, basis: 'site' };
  }
  // O sistema não sabe por que falta (site não lido, leitura descartada, site sem a informação):
  // diz só o que falta, sem afirmar a causa.
  const activity = firstClaim(claims, ['registry.cnae_main']);
  if (activity) {
    return {
      text: `${typed(activity)} A análise ainda não trouxe como a empresa se apresenta.`,
      known: true,
      basis: 'registry',
    };
  }
  return {
    text: 'Ainda não sabemos: a análise não trouxe como a empresa se apresenta nem a atividade do cadastro.',
    known: false,
    basis: null,
  };
}

function what(events: readonly EventEvidence[]): Omit<ExecutiveAnswer, 'question' | 'label'> {
  if (events.length === 0) {
    return {
      text: 'Nenhum acontecimento recente apareceu nas fontes consultadas.',
      known: false,
      basis: null,
    };
  }
  const top = [...events]
    .sort(
      (a, b) =>
        IMPORTANCE_RANK[importanceOf(a.event.type)] - IMPORTANCE_RANK[importanceOf(b.event.type)] ||
        (b.event.occurredOn ?? '').localeCompare(a.event.occurredOn ?? ''),
    )
    .slice(0, 2);
  const lines = top.map(({ event, epistemicType }) => {
    const when = event.occurredOn ? `${brazilianPartialDate(event.occurredOn)}: ` : '';
    return `${when}${event.headline.trim()} (${EPISTEMIC_WORDS[epistemicType]}, ${event.host})`;
  });
  const more = events.length - top.length;
  const tail =
    more > 0
      ? ` Mais ${more} ${more === 1 ? 'acontecimento' : 'acontecimentos'} na linha do tempo.`
      : '';
  return { text: `${lines.map(sentence).join(' ')}${tail}`, known: true, basis: 'events' };
}

function why(thesis: CommercialThesis | null): Omit<ExecutiveAnswer, 'question' | 'label'> {
  if (!thesis) {
    return {
      text: 'Sem tese comercial nesta análise. Atualize para ver o motivo e o momento.',
      known: false,
      basis: null,
    };
  }
  if (!thesis.principal) {
    return { text: sentence(thesis.recommendationReason), known: true, basis: 'thesis' };
  }
  return {
    text: `${sentence(thesis.principal.problem)} ${sentence(thesis.principal.whyNow)}`,
    known: true,
    basis: 'thesis',
  };
}

function where(
  thesis: CommercialThesis | null,
  fallbackOffer: string | null,
): Omit<ExecutiveAnswer, 'question' | 'label'> {
  const principal = thesis?.principal ?? null;
  if (principal) {
    return {
      text: `${principal.title}: ${principal.offer.join(', ')}.`,
      known: true,
      basis: 'thesis',
    };
  }
  if (!thesis && fallbackOffer) {
    return {
      text: `${fallbackOffer} (pela comparação com os serviços ativos).`,
      known: true,
      basis: 'offers',
    };
  }
  // Sem ângulo principal, o motivo costuma ser falta de base, não falta de encaixe.
  return {
    text: thesis
      ? 'Ainda sem base para dizer: nenhum acontecimento sustenta um ângulo.'
      : 'Ainda sem base para dizer: atualize a análise.',
    known: false,
    basis: thesis ? 'thesis' : null,
  };
}

function how(
  thesis: CommercialThesis | null,
  contactBlocked: boolean,
): Omit<ExecutiveAnswer, 'question' | 'label'> {
  if (contactBlocked) {
    return {
      text: 'Não abordar: a empresa pediu para não ser contatada.',
      known: true,
      basis: null,
    };
  }
  if (!thesis) {
    return {
      text: 'Sem tese comercial: atualize a análise para ver com quem falar e por onde abrir.',
      known: false,
      basis: null,
    };
  }
  const label = THESIS_RECOMMENDATION_LABELS[thesis.recommendation];
  const principal = thesis.principal;
  // Sem ângulo principal, "Por que ela merece atenção?" já trouxe o motivo: aqui só o rótulo.
  if (!principal) {
    return { text: sentence(label), known: true, basis: 'thesis' };
  }
  // O motivo já pode ter dois-pontos: rótulo e motivo em frases separadas, sem encadear.
  if (thesis.recommendation === 'deprioritize') {
    return {
      text: `${sentence(label)} ${sentence(thesis.recommendationReason)}`,
      known: true,
      basis: 'thesis',
    };
  }
  return {
    text: `${label}. Com quem falar: ${lowerFirst(sentence(principal.approachRole))} Para abrir: ${lowerFirst(sentence(principal.openingTopic))}`,
    known: true,
    basis: 'thesis',
  };
}

export function executiveSummary(input: ExecutiveSummaryInput): ExecutiveAnswer[] {
  const parts: Record<ExecutiveQuestion, Omit<ExecutiveAnswer, 'question' | 'label'>> = {
    who: who(input.claims),
    what: what(input.events),
    why: why(input.thesis),
    where: where(input.thesis, input.fallbackOffer),
    how: how(input.thesis, input.contactBlocked),
  };
  return (Object.keys(EXECUTIVE_QUESTION_LABELS) as ExecutiveQuestion[]).map((question) => ({
    question,
    label: EXECUTIVE_QUESTION_LABELS[question],
    ...parts[question],
  }));
}
