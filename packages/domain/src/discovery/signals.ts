import type {
  PartialDate,
  ProspectSourceRelation,
  SignalRecency,
  SignalVerification,
} from '@prospector/contracts';

/**
 * Regras dos sinais comerciais (F4). Determinísticas: o modelo propõe o sinal e o trecho, e
 * estas funções decidem atualidade, verificação e confiança.
 *
 * Datas: o acontecimento vale mais que a publicação; sem nenhuma das duas, a atualidade é
 * "desconhecida" (nunca "recente" só porque a busca achou hoje).
 */

/** Até quantos dias um acontecimento conta como recente. */
export const SIGNAL_RECENT_DAYS = 180;
/** Depois disso o sinal ainda é mostrado, mas como antigo e com peso pequeno. */
export const SIGNAL_OLD_DAYS = 540;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Último dia possível de uma data parcial (`2026-03` → 31/03/2026). Usado para dizer se o
 * acontecimento PODE ser recente: um ano inteiro só conta pelo seu último dia.
 */
export function latestDayOf(date: PartialDate): Date {
  const [year, month, day] = date.split('-').map(Number);
  if (year === undefined || Number.isNaN(year)) return new Date(Number.NaN);
  if (month === undefined) return new Date(Date.UTC(year, 11, 31));
  if (day === undefined) return new Date(Date.UTC(year, month, 0));
  return new Date(Date.UTC(year, month - 1, day));
}

/** Primeiro dia possível (`2026-03` → 01/03/2026). */
export function earliestDayOf(date: PartialDate): Date {
  const [year, month, day] = date.split('-').map(Number);
  if (year === undefined || Number.isNaN(year)) return new Date(Number.NaN);
  return new Date(Date.UTC(year, (month ?? 1) - 1, day ?? 1));
}

/**
 * Atualidade pela data do acontecimento ou, sem ela, pela publicação. Data só com o ano conta
 * como recente apenas quando o ano inteiro cabe na janela (nunca por estar no ano corrente).
 * Data no futuro (anúncio de inauguração) conta como recente.
 */
export function signalRecency(
  eventDate: PartialDate | null,
  publishedAt: string | null,
  now: Date,
): SignalRecency {
  const reference = eventDate ?? publishedAt;
  if (!reference) return 'unknown';
  const earliest = earliestDayOf(reference);
  const latest = latestDayOf(reference);
  if (Number.isNaN(earliest.getTime())) return 'unknown';
  const recentLimit = now.getTime() - SIGNAL_RECENT_DAYS * DAY_MS;
  if (earliest.getTime() >= recentLimit) return 'recent';
  if (latest.getTime() < recentLimit) return 'older';
  // A janela corta a data parcial ao meio (ex.: "2026" visto em novembro): não dá para afirmar.
  return 'unknown';
}

export interface SignalAssessmentInput {
  relation: ProspectSourceRelation;
  /** O trecho citado foi achado no texto da fonte (sem isso o sinal nem é gravado). */
  quoteVerified: boolean;
  /** O trecho descreve o acontecimento de forma direta (segundo o extrator). */
  explicit: boolean;
  recency: SignalRecency;
}

/** Fontes que descrevem um acontecimento por conta própria (não só repetem um cadastro). */
const PRIMARY_RELATIONS: readonly ProspectSourceRelation[] = ['official_site', 'news', 'job_post'];

export function signalVerification(input: SignalAssessmentInput): SignalVerification {
  return input.quoteVerified && input.explicit && PRIMARY_RELATIONS.includes(input.relation)
    ? 'confirmed'
    : 'hypothesis';
}

const RELATION_BASE: Record<ProspectSourceRelation, number> = {
  official_site: 0.85,
  job_post: 0.8,
  news: 0.75,
  mention: 0.55,
  directory: 0.5,
};

const RECENCY_FACTOR: Record<SignalRecency, number> = { recent: 1, unknown: 0.85, older: 0.7 };

/**
 * Confiança do sinal (0 a 1), calculada no servidor: tipo da fonte × trecho direto × atualidade.
 * Trecho não conferido = 0 (o sinal é descartado antes de gravar).
 */
export function signalConfidence(input: SignalAssessmentInput): number {
  if (!input.quoteVerified) return 0;
  const value =
    RELATION_BASE[input.relation] * (input.explicit ? 1 : 0.7) * RECENCY_FACTOR[input.recency];
  return Math.round(value * 100) / 100;
}

/** Texto da impressão digital (o hash fica na aplicação): mesma empresa, tipo e endereço. */
export function signalFingerprintText(input: {
  prospectId: string;
  type: string;
  url: string;
}): string {
  let url = input.url;
  try {
    const parsed = new URL(input.url);
    parsed.hash = '';
    url = `${parsed.hostname.replace(/^www\./, '')}${parsed.pathname.replace(/\/$/, '')}${parsed.search}`;
  } catch {
    // endereço inválido nunca chega aqui (validado antes); usa o texto como veio
  }
  return `${input.prospectId}|${input.type}|${url.toLowerCase()}`;
}

const MONTHS = [
  ['janeiro', 'jan'],
  ['fevereiro', 'fev'],
  ['março', 'mar'],
  ['abril', 'abr'],
  ['maio', 'mai'],
  ['junho', 'jun'],
  ['julho', 'jul'],
  ['agosto', 'ago'],
  ['setembro', 'set'],
  ['outubro', 'out'],
  ['novembro', 'nov'],
  ['dezembro', 'dez'],
] as const;

/**
 * Data do acontecimento que o texto sustenta. O modelo pequeno às vezes devolve a data de hoje
 * para um texto sem data (e a atualidade subia para "recente"): o servidor só aceita o ano, o
 * mês e o dia que aparecem no título ou no trecho. Sem o ano no texto, null.
 */
export function supportedEventDate(date: PartialDate | null, text: string): PartialDate | null {
  if (!date) return null;
  const [year, month, day] = date.split('-');
  if (!year || !new RegExp(`(^|\\D)${year}(\\D|$)`).test(text)) return null;
  if (!month) return year;
  const lower = text.toLowerCase();
  const index = Number(month) - 1;
  const names = MONTHS[index];
  const numeric = new RegExp(`(^|\\D)0?${Number(month)}[/.-]${year}(\\D|$)`);
  const monthFound =
    (names !== undefined &&
      new RegExp(`(^|[^a-zà-ú])(${names[0]}|${names[1]}\\.?)(\\s+de)?\\s+(de\\s+)?${year}`).test(
        lower,
      )) ||
    numeric.test(text) ||
    new RegExp(`(^|\\D)\\d{1,2}[/.-]0?${Number(month)}[/.-]${year}(\\D|$)`).test(text) ||
    (names !== undefined && new RegExp(`\\d{1,2}\\s+de\\s+${names[0]}`).test(lower));
  if (!monthFound) return year;
  if (!day) return `${year}-${month}`;
  const dayFound =
    new RegExp(`(^|\\D)0?${Number(day)}[/.-]0?${Number(month)}[/.-]${year}(\\D|$)`).test(text) ||
    (names !== undefined &&
      new RegExp(`(^|\\D)0?${Number(day)}º?\\s+de\\s+${names[0]}`).test(lower));
  return dayFound ? `${year}-${month}-${day}` : `${year}-${month}`;
}

/** `2026-03` → `março de 2026`; `2026-03-05` → `05/03/2026`; `2026` → `2026`. */
export function formatPartialDate(date: PartialDate): string {
  const [year, month, day] = date.split('-');
  if (!month) return year ?? date;
  if (!day) {
    const names = [
      'janeiro',
      'fevereiro',
      'março',
      'abril',
      'maio',
      'junho',
      'julho',
      'agosto',
      'setembro',
      'outubro',
      'novembro',
      'dezembro',
    ];
    return `${names[Number(month) - 1] ?? month} de ${year}`;
  }
  return `${day}/${month}/${year}`;
}
