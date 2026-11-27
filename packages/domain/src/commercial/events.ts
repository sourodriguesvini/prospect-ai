import type {
  BusinessEventType,
  CommercialSignal,
  FundingDetails,
  FundingModality,
  QuotedValue,
} from '@prospector/contracts';
import {
  fold,
  foldWithMap,
  originalSlice,
  sentenceAround,
  sentences,
  type FoldedText,
} from './text';

/**
 * Acontecimentos empresariais (diretriz 2026-11-26, Parte 2.3): reconhecer o tipo num título ou
 * trecho e extrair, de uma matéria lida, o que dá para sustentar com trecho literal — valor,
 * rodada, investidores, modalidade, finalidade declarada e contexto anterior. O que a fonte não
 * diz fica `unknown` (a finalidade nunca é presumida: investimento não é orçamento).
 */

/** Padrões sobre texto dobrado (sem acento, minúsculo), na ordem de prioridade. */
const EVENT_PATTERNS: ReadonlyArray<{ type: BusinessEventType; pattern: RegExp }> = [
  {
    type: 'funding',
    pattern:
      /\b(rodada|series? [a-h]\b|aporte|capta(cao|cou|r|m)\b|levant(a|ou|am|aram) (r\$|us\$|\d|cerca|mais)|recebe(u)? (um |novo )?investimento|investimento de (r\$|us\$|\d)|pre-?seed|seed\b|venture debt|debentures?\b|investe (r\$|us\$)|investira (r\$|us\$))/,
  },
  {
    type: 'acquisition',
    pattern:
      /\b(adquir(e|iu|ida|ido)|aquisicao|compra (a|o|da|do) [a-z]|comprou (a|o) [a-z]|incorpora(cao|da)? )/,
  },
  { type: 'merger', pattern: /\b(fusao|se fundem|fundem-se|joint venture)\b/ },
  {
    type: 'new_market',
    pattern:
      /\b(entra (no|em|na) (mercado|segmento)|novos? mercados?|internacionaliz|chega (ao|a|aos|as) (mexico|eua|estados unidos|europa|argentina|chile|colombia|portugal|america latina|peru|uruguai))/,
  },
  {
    type: 'expansion',
    pattern:
      /\b(inaugur|nova unidade|nova loja|nova filial|nova clinica|expans|abre as portas|abertura d|novas unidades|novo centro de distribuicao)/,
  },
  {
    type: 'launch',
    pattern:
      /\b(lanca|lancamento|novo produto|nova linha|novo servico|nova plataforma|nova funcionalidade|novas funcionalidades)/,
  },
  {
    type: 'partnership',
    pattern: /\b(parceria|firma acordo|fecha acordo|se une a|alianca estrategica)/,
  },
  {
    type: 'leadership',
    pattern:
      /\b(nov[oa] (ceo|cto|cpo|cmo|coo|cfo|presidente|diretor[a]?|head|vice-presidente)|assume (o cargo|a presidencia|a diretoria|como|o comando)|nomeia|anuncia (o|a) nov[oa])/,
  },
  {
    type: 'restructuring',
    pattern:
      /\b(reestrutura|demiss|layoffs?\b|corte de (funcionarios|vagas|pessoal)|recuperacao judicial|reorganiza)/,
  },
  { type: 'hiring', pattern: /\b(vagas?|contratando|processo seletivo|trabalhe conosco)\b/ },
  {
    type: 'brand_change',
    pattern: /\b(nova marca|nova identidade|rebranding|novo logo|repaginad|nova logomarca)/,
  },
  {
    type: 'award',
    // "premi" sozinho pegaria "premium" (nome de linha de produto).
    pattern: /\b(premio|premios|premiad|premiacao|certificad|certificacao)/,
  },
  { type: 'move', pattern: /\b(novo endereco|mudou[- ]se|nova sede|reforma)/ },
  {
    type: 'anniversary',
    // Só idade da empresa: "45 anos de idade" de uma pessoa não é sinal (e é dado pessoal).
    pattern:
      /\b(\d{1,3} anos de (historia|mercado|tradicao|atuacao|experiencia|fundacao)|aniversario da (empresa|loja|marca|clinica))/,
  },
];

/** Tipos de acontecimento que o texto menciona, do mais forte para o mais fraco. */
export function detectEventTypes(text: string): BusinessEventType[] {
  const folded = fold(text);
  return EVENT_PATTERNS.filter((item) => item.pattern.test(folded)).map((item) => item.type);
}

/**
 * Peso de cada sinal para ordenar as oportunidades (nunca exibido como nota, Parte 4.2):
 * acontecimentos estruturais pesam mais que sinais de rotina; medições do site pesam pouco.
 */
export const SIGNAL_STRENGTH: Readonly<Record<CommercialSignal, number>> = Object.freeze({
  funding: 3,
  acquisition: 3,
  merger: 3,
  new_market: 2.5,
  expansion: 2,
  launch: 2,
  leadership: 2,
  restructuring: 2,
  partnership: 1.5,
  hiring: 1.5,
  brand_change: 1,
  award: 0.5,
  move: 0.5,
  anniversary: 0.5,
  site_accessibility: 0.5,
  site_mobile: 0.5,
  site_inconsistency: 0.5,
});

/** Acontecimentos que valem ler a matéria inteira (Parte 2.3), em vez de ficar no título. */
export const DEEP_READ_EVENTS: ReadonlySet<BusinessEventType> = new Set([
  'funding',
  'acquisition',
  'merger',
  'new_market',
  'expansion',
  'launch',
  'leadership',
  'restructuring',
  'partnership',
]);

// -----------------------------------------------------------------------------
// Extração de investimento
// -----------------------------------------------------------------------------

const MULTIPLIERS: Readonly<Record<string, number>> = {
  mil: 1e3,
  mi: 1e6,
  milhao: 1e6,
  milhoes: 1e6,
  bi: 1e9,
  bilhao: 1e9,
  bilhoes: 1e9,
};

function quoted(text: string, base: FoldedText, start: number, end: number): QuotedValue | null {
  const value = originalSlice(text, base, start, end).trim().slice(0, 200);
  const at = base.map[start] ?? 0;
  const quote = sentenceAround(text, at);
  return value && quote ? { text: value, quote } : null;
}

/** "150", "1,5", "1.500.000" → número. */
function parseNumber(raw: string): number | null {
  const normalized = raw.includes(',')
    ? raw.replace(/\./g, '').replace(',', '.')
    : raw.replace(/\.(?=\d{3}(\D|$))/g, '');
  const value = Number(normalized);
  return Number.isFinite(value) && value > 0 ? value : null;
}

const AMOUNT =
  /(r\$|us\$|u\$)\s?(\d{1,3}(?:[.,]\d{1,3})*)(?:\s?(mil|milhoes|milhao|mi|bilhoes|bilhao|bi)\b)?/g;

function extractAmount(
  text: string,
  base: FoldedText,
): { amount: QuotedValue | null; amountCents: number | null } {
  for (const match of base.folded.matchAll(AMOUNT)) {
    const start = match.index ?? 0;
    const number = parseNumber(match[2] ?? '');
    if (number === null) continue;
    const multiplier = match[3] ? (MULTIPLIERS[match[3]] ?? 1) : 1;
    const value = number * multiplier;
    // Valor pequeno sem unidade (R$ 50) não é rodada; é preço de produto citado na matéria.
    if (value < 100_000) continue;
    const amount = quoted(text, base, start, start + match[0].length);
    if (!amount) continue;
    const cents = match[1] === 'r$' ? Math.round(value * 100) : null;
    return { amount, amountCents: cents !== null && Number.isSafeInteger(cents) ? cents : null };
  }
  return { amount: null, amountCents: null };
}

const ROUND =
  /\b(series? ([a-h])\b|pre-?seed\b|seed\b|rodada anjo|investimento anjo|pre-series? ([a-h])\b)/;

function roundLabel(match: RegExpMatchArray): string {
  const [all = ''] = match;
  const letter = match[2] ?? match[3];
  if (all.startsWith('pre-serie') || all.startsWith('pre-series')) {
    return `Pré-Série ${(letter ?? '').toUpperCase()}`;
  }
  if (letter) return `Série ${letter.toUpperCase()}`;
  if (all.includes('pre')) return 'Pré-seed';
  if (all.includes('seed')) return 'Seed';
  return 'Anjo';
}

const INVESTOR_LEAD =
  /\b(liderad[ao]s? (?:pel[ao]s?|por)|com (?:a )?participacao (?:de|da|do|das|dos))\s+/g;
const INVESTOR_END =
  /[.;:()]|\s(para|que|em|no|na|nos|nas|com o objetivo|e conta|e teve|segundo)\s/;
const INVESTOR_SPLIT = /,\s*|\s+e\s+(?:(?:por|pel[ao]s?|d[aoe]s?)\s+)?/;

function extractInvestors(text: string, base: FoldedText): QuotedValue[] {
  const out: QuotedValue[] = [];
  const seen = new Set<string>();
  for (const lead of base.folded.matchAll(INVESTOR_LEAD)) {
    const from = (lead.index ?? 0) + lead[0].length;
    const rest = base.folded.slice(from, from + 160);
    const stop = rest.search(INVESTOR_END);
    const span = stop >= 0 ? rest.slice(0, stop) : rest;
    let offset = 0;
    for (const part of span.split(INVESTOR_SPLIT)) {
      const index = span.indexOf(part, offset);
      if (index < 0) continue;
      offset = index + part.length;
      const lead = part.length - part.trimStart().length;
      const article = /^(a|o|as|os)\s+/.exec(part.trimStart())?.[0].length ?? 0;
      const clean = part.trimStart().slice(article).trimEnd();
      if (clean.length < 2 || clean.split(/\s+/).length > 6) continue;
      const start = from + index + lead + article;
      const original = originalSlice(text, base, start, start + clean.length).trim();
      // Nome próprio começa com maiúscula no original; "investidores" ou "fundos" não é nome.
      if (!/^[A-Z0-9À-Ý]/.test(original) || seen.has(fold(original))) continue;
      const quote = sentenceAround(text, base.map[start] ?? 0);
      if (!quote) continue;
      seen.add(fold(original));
      out.push({ text: original, quote });
      if (out.length >= 6) return out;
    }
  }
  return out;
}

const PURPOSE = [
  /\b(recursos|aporte|dinheiro|capital|valor captado|investimento)\b[^.!?]{0,60}?\b(serao|sera|vao|vai|devem|deve)\s+(ser\s+)?(usad|destinad|aplicad|investid|empregad|direcionad|utilizad)[a-z]*\b/,
  /\b(para|com o objetivo de|com a meta de|a fim de)\s+(acelerar|expandir|ampliar|investir|financiar|desenvolver|fortalecer|contratar|lancar|crescer|aprofundar|consolidar|levar|reforcar)\b/,
];
const PURPOSE_CONTEXT = /\b(recursos|aporte|rodada|investimento|captacao|dinheiro|capital)\b/;

function extractPurpose(text: string, base: FoldedText): FundingDetails['purpose'] {
  for (const pattern of PURPOSE) {
    const match = pattern.exec(base.folded);
    if (!match) continue;
    const start = match.index;
    const quote = sentenceAround(text, base.map[start] ?? 0);
    if (!quote || !PURPOSE_CONTEXT.test(fold(quote))) continue;
    const value = originalSlice(text, base, start, start + 200)
      .split(/[.!?\n]/)[0]
      ?.trim();
    if (!value) continue;
    // O valor exibido sai da frase citada (os dois do mesmo trecho literal).
    const shown = quote.includes(value) ? value : quote;
    return { status: 'declared', value: { text: shown.slice(0, 200).trim(), quote } };
  }
  return { status: 'unknown' };
}

const CONTEXT =
  /\b(nao precisava (de|do) dinheiro|nao precisava (de|do) capital|ja (e|era) lucrativ[ao]s?|lucrativ[ao]s?\b|break-?even|equilibrio financeiro|reforcar o caixa|sem queimar caixa|geracao de caixa|rentavel)/;

function modalityOf(folded: string, round: boolean): FundingModality {
  if (round || /\b(aporte|rodada|participacao acionaria|equity|venture capital)\b/.test(folded)) {
    return 'equity';
  }
  if (/\b(divida|debentures?|venture debt|emissao de notas)\b/.test(folded)) return 'debt';
  if (/\b(subvencao|fomento|nao reembolsavel|edital)\b/.test(folded)) return 'grant';
  if (/\b(linha de credito|financiamento de|emprestimo)\b/.test(folded)) return 'credit';
  return 'unknown';
}

/**
 * Detalhes de um investimento lidos na matéria (título + texto). Cada campo traz o trecho literal
 * que o sustenta; o que a fonte não diz fica null ou `unknown`.
 */
export function extractFunding(text: string): FundingDetails {
  const base = foldWithMap(text);
  const { amount, amountCents } = extractAmount(text, base);
  const roundMatch = ROUND.exec(base.folded);
  const round = roundMatch
    ? (() => {
        const start = roundMatch.index;
        const quote = sentenceAround(text, base.map[start] ?? 0);
        return quote ? { text: roundLabel(roundMatch), quote } : null;
      })()
    : null;
  const contextMatch = CONTEXT.exec(base.folded);
  return {
    amountCents,
    amount,
    round,
    investors: extractInvestors(text, base),
    modality: modalityOf(base.folded, round !== null),
    purpose: extractPurpose(text, base),
    context: contextMatch
      ? quoted(text, base, contextMatch.index, contextMatch.index + contextMatch[0].length)
      : null,
  };
}

/**
 * Frase da matéria que cita a empresa e o acontecimento (trecho principal da evidência). Prefere
 * a que tem todas as palavras do nome; sem nenhuma, null (a matéria não é sobre a empresa).
 */
export function eventLeadQuote(
  text: string,
  nameTokens: readonly string[],
  type: BusinessEventType,
): string | null {
  const candidates = sentences(text).filter((sentence) =>
    detectEventTypes(sentence.text).includes(type),
  );
  const tokens = nameTokens.map((token) => fold(token));
  const score = (sentence: string) => {
    const folded = fold(sentence);
    return tokens.filter((token) => folded.includes(token)).length;
  };
  const best = [...candidates].sort((a, b) => score(b.text) - score(a.text))[0];
  if (!best || (tokens.length > 0 && score(best.text) === 0)) return null;
  return sentenceAround(text, best.start);
}

/**
 * Trecho da matéria que fala da empresa: as frases que citam o nome e as `follow` seguintes (onde
 * costumam vir rodada, investidores e finalidade), uma por linha, cada uma literal do original.
 * Uma página traz menu, "leia também" e chamadas de outras matérias: o investimento só é lido
 * daqui, para não atribuir à empresa o valor de outra notícia. Sem nome para procurar, o texto todo.
 */
export function companyPassage(text: string, nameTokens: readonly string[], follow = 2): string {
  const tokens = nameTokens.map((token) => fold(token)).filter((token) => token.length > 0);
  if (tokens.length === 0) return text;
  const all = sentences(text);
  const keep = new Set<number>();
  for (const [index, sentence] of all.entries()) {
    const folded = fold(sentence.text);
    if (!tokens.some((token) => folded.includes(token))) continue;
    for (let next = index; next <= Math.min(all.length - 1, index + follow); next += 1) {
      keep.add(next);
    }
  }
  return all
    .filter((_, index) => keep.has(index))
    .map((sentence) => sentence.text)
    .join('\n');
}

/**
 * Investimento da empresa numa matéria lida. Valor e rodada só de frases que citam a empresa
 * (título incluído): a chamada "Leia também: outra empresa capta R$ 500 milhões" não entra.
 * Investidores, finalidade e contexto vêm do texto em volta dessas frases (as seguintes no corpo
 * da matéria, sem o título), onde a notícia costuma continuar sem repetir o nome.
 */
export function extractCompanyFunding(
  title: string | null,
  text: string,
  nameTokens: readonly string[],
): FundingDetails {
  const body = [title, text].filter(Boolean).join('\n');
  const strict = extractFunding(companyPassage(body, nameTokens, 0));
  const near = extractFunding(companyPassage(text, nameTokens, 2));
  return {
    amountCents: strict.amountCents,
    amount: strict.amount,
    round: strict.round,
    investors: near.investors,
    modality: strict.modality !== 'unknown' ? strict.modality : near.modality,
    purpose: near.purpose,
    context: near.context ?? strict.context,
  };
}

/** Todos os trechos citados num investimento (vão para a fonte e para a evidência do claim). */
export function fundingQuotes(details: FundingDetails): string[] {
  const quotes = [
    details.amount?.quote,
    details.round?.quote,
    ...details.investors.map((item) => item.quote),
    details.purpose.status === 'declared' ? details.purpose.value.quote : undefined,
    details.context?.quote,
  ].filter((quote): quote is string => typeof quote === 'string' && quote.length > 0);
  return [...new Set(quotes)];
}

/** "R$ 150 milhões" a partir de centavos (para textos curtos). */
export function formatBrlAmount(cents: number): string {
  const reais = cents / 100;
  const scale: Array<[number, string, string]> = [
    [1e9, 'bilhão', 'bilhões'],
    [1e6, 'milhão', 'milhões'],
    [1e3, 'mil', 'mil'],
  ];
  for (const [unit, one, many] of scale) {
    if (reais >= unit) {
      const value = reais / unit;
      const text = Number.isInteger(value)
        ? String(value)
        : value.toLocaleString('pt-BR', { maximumFractionDigits: 1 });
      return `R$ ${text} ${value === 1 ? one : many}`;
    }
  }
  return `R$ ${reais.toLocaleString('pt-BR')}`;
}
