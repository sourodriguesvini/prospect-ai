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

/** Lugares que uma expansão abre: "nova loja", "3ª unidade", "abre filial". */
const UNIT = String.raw`(unidades?|lojas?|filia(l|is)|sedes?|clinicas?|enderecos?|pontos?|espacos?|fabricas?|franquias?|restaurantes?|escritorios?|operac(ao|oes)|plantas?|hospita(l|is)|consultorios?|academias?|escolas?|farmacias?|agencias?|centros? de distribuicao|galp(ao|oes)|quiosques?)`;

/** Palavras que podem vir entre o verbo e o lugar ("abre sua segunda loja"). */
const BEFORE_UNIT = String.raw`((a|o|as|os|sua|seu|suas|seus|mais|uma?|duas|tres|\d+|primeir[ao]s?|segund[ao]s?|terceir[ao]s?|quart[ao]s?|nov[ao]s?) )*`;

/** Dias e horários: "abrimos no sábado", "abre aos domingos" falam do horário, não de loja nova. */
const SCHEDULE = String.raw`(sabados?|domingos?|feriados?|segundas?|tercas?|quartas?|quintas?|sextas?|dias?|fins? de semana|fim de semana|horarios?|periodos?|natal|carnaval|mesmo dia|manha|tarde|noite|madrugada|\d)`;

/** Depois de "chega em/no": prazo de entrega ou frase feita, não cidade nova. */
const NOT_A_PLACE = String.raw`(hora|horas|vez|momento|fim|final|ate|mesmo|sua|seu|suas|seus|casa|lojas?|minutos?|dias?|\d)`;

/**
 * Marcas de acontecimento num trecho de expansão: verbo de abrir, inaugurar, ampliar, chegar ou
 * anunciar com o lugar que abre, "nova unidade", "3ª loja", "em breve mais uma". Sem nenhuma delas
 * o trecho só descreve o que já existe. Palavra solta não basta: "a nova forma de cuidar", "rede
 * em expansão", "abre às 8h", "móveis planejados" e "instalações modernas" são frases de loja
 * (revisão do KI-148). Também não bastam horário ("abrimos no sábado"), prazo de entrega ("chega
 * em até 2 horas"), especialidade ("especialistas em reforma"), programa de pontos ("acumule
 * novos pontos") e serviço ("ampliação de cílios") (segunda revisão do KI-148).
 */
const EXPANSION_EVENT = new RegExp(
  [
    String.raw`\b(re)?inaugur\w*`,
    String.raw`\breabr(e|em|iu|iram|ira|irao|indo)\b`,
    String.raw`\babr(e|em|iu|iram|ira|irao|indo|ir|imos|iremos) (as portas|${BEFORE_UNIT}${UNIT}\b|(em|no|na|nos|nas) (?!${SCHEDULE}\b))`,
    String.raw`\babertura (d[aeo]s? )?${BEFORE_UNIT}${UNIT}\b`,
    String.raw`\babertura em\b`,
    String.raw`\b(foi|foram|sera|serao|recem|acaba de ser|acabou de ser) abert[ao]s?\b`,
    String.raw`\bnov[ao]s? (${UNIT}|cidades?|estados?|pracas?)\b`,
    String.raw`\b(proxim|futur)[ao]s? ${UNIT}\b`,
    String.raw`\bexpand(e|em|iu|iram|ira|irao|ir|indo)\b`,
    String.raw`\bplanos? de expansao\b`,
    String.raw`(?<!\bem )\bexpansao (para|pelo|pela|no|na|nos|nas|em|ate|rumo|d[aeo]s? ${UNIT})\b`,
    String.raw`\bampli(a|am|ou|aram|ara|ar|ando) ${BEFORE_UNIT}(${UNIT}|presenca|atuacao|estrutura|capacidade|rede|area|operacao)\b`,
    String.raw`\bampliacao d[aeo]s? ${BEFORE_UNIT}(${UNIT}|presenca|atuacao|estrutura|capacidade|rede|area|operacao)\b`,
    String.raw`\bganh(a|am|ou|aram|ara|ar|ando) ${BEFORE_UNIT}${UNIT}\b`,
    String.raw`\bganh(a|am|ou|aram|ara|ar|ando) (mais|nova|novo|novas|novos)\b`,
    String.raw`\bcheg(a|am|ou|aram|ara|ar|ando|ada) (a|ao|em|no|na|nos|nas) (?!${NOT_A_PLACE}\b)`,
    String.raw`\bdesembarc(a|am|ou|aram|ara|ar|ando)\b`,
    String.raw`\bestrei(a|am|ou|aram|ara) ((em|no|na|nos|nas)\b|${BEFORE_UNIT}${UNIT}\b)`,
    String.raw`\b(comec|pass)(a|am|ou|aram|ara|ar) a (atender|operar|funcionar)\b`,
    String.raw`\binici(a|am|ou|aram|ara|ar) (as )?(atividades|operac(ao|oes))\b`,
    String.raw`\bse instal(a|am|ou|aram|ara|ar|ando) (em|no|na|nos|nas)\b`,
    String.raw`\binstal(a|am|ou|aram|ara|ar|ando)( se)? (em|no|na|nos|nas) (?!${NOT_A_PLACE}\b|residencias?\b|empresas?\b)`,
    String.raw`\binstal(a|am|ou|aram|ara|ar|ando) ${BEFORE_UNIT}${UNIT}\b`,
    String.raw`\bagora tambem (em|no|na|nos|nas)\b`,
    String.raw`\blev(a|am|ou|aram|ara|ar|ando) ${BEFORE_UNIT}(${UNIT}|marca|rede|negocio) (para|a|ao)\b`,
    String.raw`\bter(a|ao) ${BEFORE_UNIT}${UNIT} (em|no|na|nos|nas)\b`,
    String.raw`\banunci(a|am|ou|aram|ara|ando)\b`,
    String.raw`\bplanej(a|am|ou|aram|ava|avam|ando)\b`,
    String.raw`\b(preve|preveem|prevista|previsto|previstas|previstos|pretende|pretendem)\b`,
    String.raw`\b(vai|vao|ira|irao) (abrir|inaugurar|ganhar|chegar|ampliar|expandir|instalar)\b`,
    String.raw`\b(vai|vao|ira|irao|deve|devem) (somar|ter|alcancar|atingir|chegar a) ${BEFORE_UNIT}${UNIT}\b`,
    String.raw`(?<!\b(especialistas?|especializad[ao]s?|especialidade|servicos?|atuamos|atua|trabalhamos|trabalha|experiencia|referencia|solucoes) )\bem (obras|construcao|reforma)\b(?! (civil|de|residencia\w*|comercia\w*|predia\w*)\b)`,
    String.raw`\b(obras|construcao|reforma) d[aeo]s? ${BEFORE_UNIT}${UNIT}\b`,
    String.raw`\bem breve (mais|nova|novo|novas|novos|uma?|em|no|na|${UNIT})\b`,
    String.raw`\b(segund|terceir|quart|quint|sext|setim|oitav|non|decim)[ao]s? ${UNIT}\b`,
    String.raw`\b\d+[ao] ${UNIT}\b`,
    String.raw`\bmud(a|am|ou|aram|ara)( se)? (para|de endereco|de sede)\b`,
    String.raw`\bmudanca (de endereco|de sede|para)\b`,
  ].join('|'),
);

/** Trechos que falam do passado ou de outra coisa e saem antes da conferência. */
const NOT_AN_EVENT: readonly RegExp[] = [
  // Programa de pontos: "acumule novos pontos e troque por descontos".
  /\b(acumul\w*|junte|juntar|ganhe|troque|trocar|resgate|resgatar|some|somar)( (seus|os|mais|novos|seus novos))* pontos?\b/g,
];

/** "Inaugurada em 1987", "fundada em 1998": história da empresa, não acontecimento recente. */
const PAST_YEAR =
  /\b(foi |foram |e |sendo )?(re)?(inaugurad|fundad|criad|abert)[ao]s? (em|no ano de) ((19|20)\d\d)\b/g;

/**
 * O trecho de um sinal de expansão mostra um acontecimento (KI-148)? Frase institucional de
 * página de loja ("mais uma unidade do maior pet shop do Brasil", "a maior rede do Sul",
 * "presente em 20 cidades") descreve o que já existe e não é sinal: o servidor descarta.
 * `referenceYear` é o ano da pesquisa: "inaugurada em <ano>" só conta se o ano for este ou o
 * anterior; sem ele, a frase com ano conta como história.
 */
export function expansionEventIn(quote: string, referenceYear?: number): boolean {
  // NFKD também desfaz "ª" e "º" ("3ª unidade" → "3a unidade").
  let text = ` ${quote
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')} `;
  text = text.replace(PAST_YEAR, (whole: string, ...groups: unknown[]) => {
    const year = Number(groups[4]);
    return referenceYear !== undefined && year >= referenceYear - 1 ? whole : ' ';
  });
  for (const pattern of NOT_AN_EVENT) text = text.replace(pattern, ' ');
  return EXPANSION_EVENT.test(text);
}
