import {
  BUSINESS_EVENT_LABELS,
  type BusinessEvent,
  type BusinessEventType,
  type EpistemicType,
  type QualitativeLevel,
} from '@prospector/contracts';
import { SIGNAL_STRENGTH } from './events';
import { contentTokens, jaccard } from './text';

/**
 * Linha do tempo empresarial (diretriz 2026-11-26, Parte 2.4): acontecimentos em ordem, com data,
 * fonte, importância, consequência possível e relação com os outros. Derivada dos claims
 * `signal.web.*` (consulta, não tabela).
 */

export interface EventEvidence {
  readonly claimId: string;
  readonly epistemicType: EpistemicType;
  readonly event: BusinessEvent;
}

/** Consequência possível por tipo: leitura cautelosa, nunca necessidade declarada. */
export const EVENT_CONSEQUENCES: Readonly<Record<BusinessEventType, string>> = Object.freeze({
  funding:
    'Pode abrir uma fase de crescimento; a destinação dos recursos precisa estar documentada antes de qualquer leitura de orçamento.',
  acquisition: 'Integração de operações, marcas e produtos costuma vir depois.',
  merger: 'Integração de operações, marcas e produtos costuma vir depois.',
  new_market: 'Entrar em mercado novo costuma exigir adaptar posicionamento e comunicação.',
  expansion: 'Mais unidades pedem padrão de marca, comunicação e processos.',
  launch: 'Lançamento pede comunicação e pode indicar evolução do produto.',
  partnership: 'Parceria pode trazer integração de produto ou comunicação conjunta.',
  leadership: 'Nova liderança costuma revisar prioridades nos primeiros meses.',
  restructuring: 'Reestruturação muda prioridades; a abordagem exige cuidado com o momento.',
  hiring: 'Contratações mostram onde a empresa está pondo esforço.',
  brand_change:
    'A marca acabou de mudar: a empresa tende a consolidar a identidade nova antes de revê-la.',
  award: 'Reconhecimento pode ser usado na comunicação.',
  move: 'Mudança de espaço pode pedir sinalização e ambientação.',
  anniversary: 'Data marcante pode motivar comunicação comemorativa.',
});

/** Sequências que mudam a leitura (Parte 2.4): o primeiro seguido do segundo em até 18 meses. */
const RELATED: ReadonlyArray<readonly [BusinessEventType, readonly BusinessEventType[]]> = [
  ['funding', ['hiring', 'launch', 'expansion', 'new_market', 'acquisition', 'leadership']],
  ['leadership', ['launch', 'restructuring', 'brand_change', 'new_market']],
  ['acquisition', ['brand_change', 'restructuring', 'launch', 'leadership']],
  ['merger', ['brand_change', 'restructuring', 'launch', 'leadership']],
  ['launch', ['expansion', 'new_market', 'hiring']],
  ['expansion', ['hiring', 'new_market']],
];
const SEQUENCE_DAYS = 540;
const DAY_MS = 86_400_000;

function dayOf(date: string | null): number | null {
  if (!date) return null;
  const [year, month = '06', day = '15'] = date.split('-');
  const time = Date.UTC(Number(year), Number(month) - 1, Number(day));
  return Number.isFinite(time) ? time : null;
}

export function importanceOf(type: BusinessEventType): QualitativeLevel {
  const strength = SIGNAL_STRENGTH[type];
  return strength >= 3 ? 'high' : strength >= 1.5 ? 'medium' : 'low';
}

export interface TimelineEntry {
  readonly claimId: string;
  readonly type: BusinessEventType;
  readonly label: string;
  readonly date: string | null;
  readonly dateBasis: BusinessEvent['dateBasis'];
  readonly headline: string;
  readonly host: string;
  readonly url: string;
  readonly epistemicType: EpistemicType;
  readonly importance: QualitativeLevel;
  readonly consequence: string;
  /** Confirmado por fonte independente (republicação não conta). */
  readonly independentlyConfirmed: boolean;
}

export interface TimelineSequence {
  readonly claimIds: readonly [string, string];
  readonly reading: string;
}

export interface BusinessTimeline {
  /** Do mais antigo ao mais recente; sem data no fim. */
  readonly entries: readonly TimelineEntry[];
  readonly sequences: readonly TimelineSequence[];
}

const EPISTEMIC_RANK: Readonly<Record<EpistemicType, number>> = {
  fact: 0,
  inference: 1,
  hypothesis: 2,
};

function sameEvent(a: BusinessEvent, b: BusinessEvent): boolean {
  if (a.type !== b.type) return false;
  const amountA = a.funding?.amountCents ?? null;
  const amountB = b.funding?.amountCents ?? null;
  if (amountA !== null && amountA === amountB) return true;
  return jaccard(contentTokens(a.headline), contentTokens(b.headline)) >= 0.5;
}

/**
 * Um acontecimento por vez: a mesma rodada gravada em análises diferentes (com a origem em outro
 * site, por exemplo) conta uma vez só. Fica a melhor versão: fato antes de hipótese, matéria lida
 * antes de título, e a mais recente.
 */
export function dedupeEventEvidence(items: readonly EventEvidence[]): EventEvidence[] {
  const better = (a: EventEvidence, b: EventEvidence) => {
    const rank = EPISTEMIC_RANK[a.epistemicType] - EPISTEMIC_RANK[b.epistemicType];
    if (rank !== 0) return rank < 0;
    if (a.event.pageRead !== b.event.pageRead) return a.event.pageRead;
    return (a.event.occurredOn ?? '') > (b.event.occurredOn ?? '');
  };
  const kept: EventEvidence[] = [];
  for (const item of items) {
    const index = kept.findIndex((other) => sameEvent(other.event, item.event));
    if (index === -1) kept.push(item);
    else if (better(item, kept[index] as EventEvidence)) kept[index] = item;
  }
  return kept;
}

export function buildBusinessTimeline(items: readonly EventEvidence[]): BusinessTimeline {
  const entries: TimelineEntry[] = items.map(({ claimId, epistemicType, event }) => ({
    claimId,
    type: event.type,
    label: BUSINESS_EVENT_LABELS[event.type],
    date: event.occurredOn,
    dateBasis: event.dateBasis,
    headline: event.headline,
    host: event.host,
    url: event.url,
    epistemicType,
    importance: importanceOf(event.type),
    consequence: EVENT_CONSEQUENCES[event.type],
    independentlyConfirmed: event.confirmedBy.length > 0,
  }));
  entries.sort((a, b) => {
    const at = dayOf(a.date);
    const bt = dayOf(b.date);
    if (at === null && bt === null) return 0;
    if (at === null) return 1;
    if (bt === null) return -1;
    return at - bt;
  });
  const sequences: TimelineSequence[] = [];
  for (const [index, first] of entries.entries()) {
    const firstDay = dayOf(first.date);
    if (firstDay === null) continue;
    const next = RELATED.find(([type]) => type === first.type)?.[1] ?? [];
    for (const second of entries.slice(index + 1)) {
      const secondDay = dayOf(second.date);
      if (secondDay === null || !next.includes(second.type)) continue;
      const gap = (secondDay - firstDay) / DAY_MS;
      if (gap < 0 || gap > SEQUENCE_DAYS) continue;
      sequences.push({
        claimIds: [first.claimId, second.claimId],
        reading: `${first.label} seguido de ${second.label}: lidos juntos, indicam uma fase de mudança, não um fato isolado.`,
      });
    }
  }
  return { entries, sequences: sequences.slice(0, 10) };
}
