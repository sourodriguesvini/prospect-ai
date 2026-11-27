/**
 * Utilitários de texto do motor comercial: comparação sem acento e sem caixa, mas com os trechos
 * devolvidos no texto ORIGINAL (o ledger confere a citação literal na fonte, docs/08 §2.4).
 */

/** Texto dobrado (sem acento, minúsculo) e, para cada caractere dobrado, a posição no original. */
export interface FoldedText {
  readonly folded: string;
  readonly map: readonly number[];
}

export function foldWithMap(text: string): FoldedText {
  let folded = '';
  const map: number[] = [];
  let index = 0;
  for (const char of text) {
    const plain = char.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    for (const piece of plain) {
      folded += piece;
      map.push(index);
    }
    index += char.length;
  }
  return { folded, map };
}

export function fold(text: string): string {
  return foldWithMap(text).folded;
}

/** Trecho do original que corresponde a [start, end) do texto dobrado. */
export function originalSlice(
  text: string,
  { map }: FoldedText,
  start: number,
  end: number,
): string {
  if (start >= end || start >= map.length) return '';
  const from = map[start] ?? 0;
  const lastIndex = map[Math.min(end, map.length) - 1] ?? from;
  const lastChar = text.codePointAt(lastIndex) ?? 0;
  return text.slice(from, lastIndex + (lastChar > 0xffff ? 2 : 1));
}

// Fim de frase: pontuação, quebra de linha (títulos não têm ponto) ou fim do texto.
const SENTENCE = /[^.!?\n]+(?:[.!?]+|(?=\n)|$)/g;

/** Frases do texto original, com início e fim (fim exclusivo). */
export function sentences(text: string): Array<{ start: number; end: number; text: string }> {
  const out: Array<{ start: number; end: number; text: string }> = [];
  for (const match of text.matchAll(SENTENCE)) {
    const raw = match[0];
    const lead = raw.length - raw.trimStart().length;
    const trimmed = raw.trim();
    if (trimmed.length < 3) continue;
    const start = (match.index ?? 0) + lead;
    out.push({ start, end: start + trimmed.length, text: trimmed });
  }
  return out;
}

/**
 * Frase do original que contém a posição `at`, cortada em até `max` caracteres em volta dela
 * (sempre um pedaço literal do original, em fronteira de palavra).
 */
export function sentenceAround(text: string, at: number, max = 300): string {
  const sentence = sentences(text).find((item) => at >= item.start && at < item.end);
  if (!sentence) return '';
  if (sentence.text.length <= max) return sentence.text;
  const offset = at - sentence.start;
  let from = Math.max(0, offset - Math.floor(max / 2));
  let to = Math.min(sentence.text.length, from + max);
  from = Math.max(0, to - max);
  const body = sentence.text;
  if (from > 0) {
    const space = body.indexOf(' ', from);
    if (space > 0 && space < offset) from = space + 1;
  }
  if (to < body.length) {
    const space = body.lastIndexOf(' ', to);
    if (space > offset) to = space;
  }
  return body.slice(from, to).trim();
}

const STOPWORDS = new Set([
  'que',
  'com',
  'para',
  'por',
  'dos',
  'das',
  'nos',
  'nas',
  'uma',
  'the',
  'and',
  'mais',
  'sua',
  'seu',
  'como',
  'pela',
  'pelo',
  'apos',
  'sobre',
]);

/** Palavras de conteúdo (3+ letras, sem as comuns), para comparar títulos. */
export function contentTokens(text: string): Set<string> {
  return new Set(
    fold(text)
      .split(/[^a-z0-9$]+/)
      .filter((token) => token.length >= 3 && !STOPWORDS.has(token)),
  );
}

export function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const token of a) if (b.has(token)) shared += 1;
  return shared / (a.size + b.size - shared);
}

/** Dia brasileiro (dd/mm/aaaa) de uma data parcial `aaaa[-mm[-dd]]`. */
export function brazilianPartialDate(date: string): string {
  const [year, month, day] = date.split('-');
  if (day && month) return `${day}/${month}/${year}`;
  if (month) return `${month}/${year}`;
  return year ?? date;
}
