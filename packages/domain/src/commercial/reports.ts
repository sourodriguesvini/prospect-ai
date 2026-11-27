import type { BusinessEvent, BusinessEventType } from '@prospector/contracts';
import { detectEventTypes, fundingRoundOf, isExplainerContent, thirdPartyMention } from './events';
import { contentTokens, fold, jaccard } from './text';

/**
 * Fontes de acontecimentos (diretriz 2026-11-26, Partes 3.2 e 3.3): hierarquia (site da empresa
 * > imprensa reconhecida > outras), agrupamento das matérias que falam do mesmo acontecimento e
 * separação entre republicação (não confirma) e fonte independente (confirma).
 */

/**
 * Imprensa reconhecida (proposta, editável): veículos de negócios e tecnologia com redação
 * própria. Entrada só com domínio vale para os subdomínios. Alimenta a classificação de fontes do
 * ledger (`recognized_press`), que só se aplica à página lida — resultado de busca continua
 * cópia indireta (docs/08 §2.5).
 */
export const RECOGNIZED_PRESS_HOSTS: readonly string[] = Object.freeze([
  'neofeed.com.br',
  'valor.globo.com',
  'pipelinevalor.globo.com',
  'valorinternational.globo.com',
  'braziljournal.com',
  'exame.com',
  'estadao.com.br',
  'folha.uol.com.br',
  'infomoney.com.br',
  'bloomberglinea.com.br',
  'bloomberglinea.com',
  'startups.com.br',
  'g1.globo.com',
  'oglobo.globo.com',
  'epocanegocios.globo.com',
  'revistapegn.globo.com',
  'forbes.com.br',
  'istoedinheiro.com.br',
  'cnnbrasil.com.br',
  'veja.abril.com.br',
  'meioemensagem.com.br',
  'propmark.com.br',
  'mobiletime.com.br',
  'baguete.com.br',
  'convergenciadigital.com.br',
  'finsiders.com.br',
  'labsnews.com',
  'theshift.info',
  'reuters.com',
  'bloomberg.com',
  'techcrunch.com',
  'ft.com',
  'wsj.com',
  'cnbc.com',
  'sifted.eu',
]);

export type ReportTier = BusinessEvent['sourceTier'];

function hostMatches(host: string, entry: string): boolean {
  return host === entry || host.endsWith(`.${entry}`);
}

export function bareHost(urlOrHost: string): string {
  let host = urlOrHost.trim().toLowerCase();
  try {
    if (/^[a-z][a-z0-9+.-]*:\/\//.test(host)) host = new URL(host).hostname;
  } catch {
    // Sem URL válida: usa o texto como host.
  }
  return host.replace(/^www\./, '').replace(/\.$/, '');
}

/** Parte 3.2: site da empresa (1, 5), imprensa reconhecida (7) ou outra fonte. */
export function reportTier(url: string, companyDomain: string | null): ReportTier {
  const host = bareHost(url);
  if (companyDomain && hostMatches(host, bareHost(companyDomain))) return 'official';
  if (RECOGNIZED_PRESS_HOSTS.some((entry) => hostMatches(host, entry))) return 'recognized_press';
  return 'other';
}

const TIER_RANK: Readonly<Record<ReportTier, number>> = {
  official: 0,
  recognized_press: 1,
  other: 2,
};

export interface EventReport {
  readonly url: string;
  readonly title: string;
  readonly snippet: string;
  readonly publishedAt: string | null;
}

export interface EventReportGroup<T extends EventReport = EventReport> {
  readonly type: BusinessEventType;
  /** Matéria de origem: melhor fonte na hierarquia e, no empate, a mais antiga. */
  readonly origin: T;
  readonly originTier: ReportTier;
  /** Hosts que repetem a mesma notícia (título quase igual ou citam a origem). */
  readonly republishedBy: string[];
  /** Hosts com apuração própria sobre o mesmo acontecimento (confirmação independente). */
  readonly confirmedBy: string[];
  /** Divergências entre as fontes do grupo (ex.: valores diferentes para a mesma rodada). */
  readonly conflicts: string[];
  readonly members: readonly T[];
}

const AMOUNT_TEXT =
  /(R\$|US\$)\s?\d{1,3}(?:[.,]\d{1,3})*(?:\s?(?:mil|milhões|milhão|milhoes|milhao|mi|bilhões|bilhão|bilhoes|bilhao|bi)(?![a-zà-ú]))?/i;

/** Valores diferentes citados para o mesmo acontecimento, com a fonte de cada um. */
function amountConflicts(reports: readonly EventReport[]): string[] {
  const byKey = new Map<string, { text: string; hosts: string[] }>();
  for (const report of reports) {
    const text = `${report.title} ${report.snippet}`;
    const key = amountKey(text);
    const shown = AMOUNT_TEXT.exec(text)?.[0];
    if (!key || !shown) continue;
    const entry = byKey.get(key) ?? { text: shown, hosts: [] };
    const host = bareHost(report.url);
    if (!entry.hosts.includes(host)) entry.hosts.push(host);
    byKey.set(key, entry);
  }
  if (byKey.size < 2) return [];
  const parts = [...byKey.values()].map((entry) => `${entry.text} (${entry.hosts.join(', ')})`);
  return [`Valores diferentes entre as fontes: ${parts.join(' e ')}.`.slice(0, 300)];
}

/** Valor monetário citado (dígitos), para reconhecer o mesmo investimento em títulos diferentes. */
function amountKey(text: string): string | null {
  const match =
    /(r\$|us\$)\s?(\d{1,3}(?:[.,]\d{1,3})*)\s?(mil|mi|milhoes|milhao|bi|bilhoes|bilhao)?/.exec(
      fold(text),
    );
  return match
    ? `${match[1]}${match[2]?.replace(/[.,]/g, '')}${match[3]?.slice(0, 2) ?? ''}`
    : null;
}

/** O texto cita a origem pelo nome do veículo ("segundo o NeoFeed", "com informações da Exame")? */
function citesOrigin(text: string, originHost: string): boolean {
  const brand = originHost.split('.')[0] ?? '';
  if (brand.length < 4) return false;
  const folded = fold(text);
  // O host vem validado (Zod), mas o nome do veículo entra escapado na expressão por garantia.
  const escaped = fold(brand).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(
    `(segundo|de acordo com|conforme|com informacoes d[aoe]s?|informou|publicou|apurou)[^.]{0,30}\\b${escaped}\\b`,
  ).test(folded);
}

/** Datas de publicação compatíveis com o mesmo acontecimento (uma delas sem data também vale). */
function closeDates(a: string | null, b: string | null, days = 120): boolean {
  if (!a || !b) return true;
  const gap = Math.abs(Date.parse(a.slice(0, 10)) - Date.parse(b.slice(0, 10)));
  return Number.isFinite(gap) && gap <= days * 86_400_000;
}

/**
 * Agrupa as matérias por acontecimento: mesmo tipo principal e (mesmo valor citado, mesma rodada
 * em datas próximas ou títulos parecidos). Em cada grupo, separa republicação de confirmação
 * independente (Parte 3.3: "não considere republicações da mesma notícia como confirmações
 * independentes"). Página de conteúdo permanente ("O que é SaaS?") não é acontecimento. Com o
 * nome da empresa (`nameTokens`), "investe R$" só conta como investimento que ela recebeu.
 */
export function groupEventReports<T extends EventReport>(
  reports: readonly T[],
  companyDomain: string | null,
  nameTokens: readonly string[] = [],
): EventReportGroup<T>[] {
  const typed = reports.flatMap((report) => {
    if (isExplainerContent(report.title, report.url)) return [];
    const text = `${report.title} ${report.snippet}`;
    // A empresa só aparece como cliente, parceira ou concorrente de outra: não é dela.
    const tokens = nameTokens.map((token) => fold(token));
    if (thirdPartyMention(fold(text), tokens)) return [];
    const [type] = detectEventTypes(text, nameTokens);
    return type
      ? [
          {
            report,
            type,
            tokens: contentTokens(report.title),
            amount: amountKey(text),
            round: type === 'funding' ? fundingRoundOf(text) : null,
          },
        ]
      : [];
  });
  const groups: Array<{ type: BusinessEventType; items: typeof typed }> = [];
  for (const item of typed) {
    const group = groups.find(
      (candidate) =>
        candidate.type === item.type &&
        candidate.items.some(
          (other) =>
            // Rodadas diferentes (Série A e Série D) nunca são o mesmo acontecimento.
            !(item.round !== null && other.round !== null && item.round !== other.round) &&
            ((item.amount !== null && item.amount === other.amount) ||
              (item.round !== null &&
                item.round === other.round &&
                closeDates(item.report.publishedAt, other.report.publishedAt)) ||
              jaccard(item.tokens, other.tokens) >= 0.35),
        ),
    );
    if (group) group.items.push(item);
    else groups.push({ type: item.type, items: [item] });
  }
  return groups.map(({ type, items }) => {
    const sorted = [...items].sort((a, b) => {
      const tier =
        TIER_RANK[reportTier(a.report.url, companyDomain)] -
        TIER_RANK[reportTier(b.report.url, companyDomain)];
      if (tier !== 0) return tier;
      const at = a.report.publishedAt ?? '9999';
      const bt = b.report.publishedAt ?? '9999';
      return at < bt ? -1 : at > bt ? 1 : 0;
    });
    const [first] = sorted;
    if (!first) throw new Error('grupo vazio');
    const originHost = bareHost(first.report.url);
    const republishedBy: string[] = [];
    const confirmedBy: string[] = [];
    for (const item of sorted.slice(1)) {
      const host = bareHost(item.report.url);
      if (host === originHost || republishedBy.includes(host) || confirmedBy.includes(host)) {
        continue;
      }
      const copy =
        jaccard(item.tokens, first.tokens) >= 0.6 ||
        citesOrigin(`${item.report.title} ${item.report.snippet}`, originHost);
      (copy ? republishedBy : confirmedBy).push(host);
    }
    return {
      type,
      origin: first.report,
      originTier: reportTier(first.report.url, companyDomain),
      republishedBy: republishedBy.slice(0, 10),
      confirmedBy: confirmedBy.slice(0, 10),
      conflicts: amountConflicts(sorted.map((item) => item.report)),
      members: sorted.map((item) => item.report),
    };
  });
}
