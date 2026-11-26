/**
 * Medidas de naturalidade das mensagens (proposta de 26/11, Frente 2 — EXPERIMENTAL, não usado
 * pelo app). Não é lista de palavras proibidas nem corretor de aprovação: são sinais para comparar
 * versões de prompt e modelos lado a lado, junto com a leitura humana às cegas
 * (`blind-review.ts`). Nenhuma medida aqui substitui os corretores de fato e fonte (`cases.ts`):
 * uma versão mais natural que erra mais fatos não passa (docs/comunicacao-frente-2-experimental.md).
 *
 * A nota (0–100) é heurística e serve só para ordenar e comparar; o relatório guarda cada padrão
 * achado, com o trecho, para a pessoa conferir.
 */

export type NaturalnessPatternId =
  | 'formula_opening'
  | 'agency_jargon'
  | 'technical_terms'
  | 'not_only_but_also'
  | 'more_than_is'
  | 'unsolicited_diagnosis'
  | 'stacked_closing'
  | 'generic_praise'
  | 'artificial_urgency'
  | 'dash_series'
  | 'opening_defect'
  | 'label_leak';

interface PatternDef {
  id: NaturalnessPatternId;
  label: string;
  /** Sobre o texto comparável (sem acento, minúsculas), ou só em minúsculas com `accented`. */
  re: RegExp;
  accented?: boolean;
  /** Pontos tirados por ocorrência, até `max`. */
  weight: number;
  max: number;
}

const PATTERNS: readonly PatternDef[] = [
  {
    id: 'formula_opening',
    label: 'Abertura de formulário',
    re: /espero que (esta mensagem|este e-?mail|voce|esteja|tudo)|venho por meio|gostaria de me apresentar/g,
    weight: 15,
    max: 15,
  },
  {
    id: 'agency_jargon',
    label: 'Jargão de agência',
    re: /\b(alavanc\w*|potencializ\w*|agregar valor|solucoes|sinergia\w*|jornada|experiencia de marca|pontos? de contato|outro patamar)\b/g,
    weight: 10,
    max: 30,
  },
  {
    id: 'technical_terms',
    label: 'Termo técnico que a empresa não usa',
    re: /\b(contraste|acessibilidade|wcag|pixels?|grid|paleta|consistencia cromatica)\b/g,
    weight: 8,
    max: 24,
  },
  {
    id: 'not_only_but_also',
    label: '"Não apenas X, mas também Y"',
    re: /\bnao (apenas|so|somente)\b[^.!?]{1,80}\bmas( tambem)?\b/g,
    weight: 10,
    max: 20,
  },
  {
    id: 'more_than_is',
    label: '"Mais do que X, é Y"',
    // Lido com acento: sem ele, "é" vira o "e" de uma lista ("mais do que pão, e agora café").
    re: /\bmais do que\b[^.!?,]{1,50}, (?:é|são)(?=\s)/g,
    accented: true,
    weight: 8,
    max: 16,
  },
  {
    id: 'unsolicited_diagnosis',
    label: 'Diagnóstico não pedido (aponta defeito)',
    // "desafio" fica de fora (a pergunta consultiva usa); "sem problema" não é defeito.
    re: /\b(?<!sem )(problemas?|falhas?|erros?|inconsistenc\w+|deficien\w+|defasad\w+|desatualizad\w+|desalinhad\w+|viola(?:m|ndo|cao|coes)?|precisam? de|variac\w+ n[ao]s? (?:cor|cores|logo\w*|marca|identidade))\b/g,
    weight: 12,
    max: 24,
  },
  {
    id: 'stacked_closing',
    label: 'Fechamento em série',
    // "Atenciosamente" fica de fora: o Prospector acrescenta a despedida no tom formal.
    re: /fico a disposicao|aguardo (o )?(seu )?retorno|desde ja agradeco/g,
    weight: 0,
    max: 0,
  },
  {
    id: 'generic_praise',
    label: 'Elogio genérico',
    // "Parabéns pela nova unidade" fala de um fato; elogio genérico é o que não diz do quê.
    re: /\b(incrivel|impressionante|excelente trabalho|parabens pelo (?:trabalho|sucesso)|admiro muito|fantastic\w+|maravilhos\w+)\b/g,
    weight: 10,
    max: 20,
  },
  {
    id: 'artificial_urgency',
    label: 'Urgência artificial',
    re: /\b(nao perca|ultima chance|urgente|o quanto antes|imediatamente|agora mesmo)\b/g,
    weight: 15,
    max: 15,
  },
  {
    id: 'dash_series',
    label: 'Travessões em série',
    re: /—/g,
    weight: 0,
    max: 0,
  },
  {
    // Medido à parte (posição): defeito nas duas primeiras frases depois da saudação.
    id: 'opening_defect',
    label: 'Abre apontando defeito',
    re: /$^/g,
    weight: 0,
    max: 0,
  },
  {
    id: 'label_leak',
    label: 'Rótulo interno no texto',
    re: /\b(estrategia (?:consultiva|de networking|de oportunidade|de apresentacao)|ponto [1-7]\b|contexto:|oportunidade:|demanda explicita)/g,
    weight: 15,
    max: 30,
  },
];

const DEFECT =
  /\b(?<!sem )(problemas?|falhas?|erros?|inconsistenc\w+|deficien\w+|defasad\w+|desatualizad\w+|desalinhad\w+|tons? diferentes|abaixo do padrao|precisam? de|revisao de marca|variac\w+ n[ao]s? (?:cor|cores|logo\w*|marca|identidade)|(?:cores|logos?|logotipos?) diferentes)\b/;
const GREETING = /^(oi|ola|bom dia|boa tarde|boa noite)\b[^.!?\n]{0,20}[!.,]?\s*$/;

/** As duas primeiras frases depois da saudação (onde um defeito vira "abrir com defeito"). */
function openingSentences(body: string): string[] {
  const sentences = comparableText(body)
    .split(/(?<=[.!?])\s+|\n+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
  const start = sentences[0] && GREETING.test(sentences[0]) ? 1 : 0;
  return sentences.slice(start, start + 2);
}

export const NATURALNESS_PATTERN_LABELS: Record<NaturalnessPatternId, string> = Object.fromEntries(
  PATTERNS.map((pattern) => [pattern.id, pattern.label]),
) as Record<NaturalnessPatternId, string>;

export interface PatternHit {
  id: NaturalnessPatternId;
  /** Trechos achados, como aparecem no texto comparável. */
  matches: string[];
}

export interface NaturalnessReport {
  words: number;
  sentences: number;
  avgSentenceWords: number;
  longestSentenceWords: number;
  /** Desvio padrão do tamanho das frases (texto de modelo tende a frases do mesmo tamanho). */
  sentenceSpread: number;
  questions: number;
  endsWithQuestion: boolean;
  patterns: PatternHit[];
  /** 0–100, heurística: 100 menos os pontos de cada padrão e de tamanho. */
  score: number;
}

/** Sem acento e em minúsculas, como os corretores de `cases.ts`. */
export function comparableText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
}

/**
 * Corpo sem a despedida e a assinatura: tira do fim as linhas curtas (até 4 palavras) que não são
 * pergunta ("Abraço,", o nome da agência).
 */
function withoutClosing(body: string): string {
  const lines = body.trimEnd().split('\n');
  const closing = (line: string) => {
    const text = line.trim();
    return text === '' || (text.split(/\s+/).length <= 4 && !text.endsWith('?'));
  };
  while (lines.length > 1 && closing(lines.at(-1) ?? '')) lines.pop();
  return lines.join('\n');
}

export function naturalness(body: string): NaturalnessReport {
  const text = comparableText(body);
  const content = withoutClosing(body);
  const sentences = content
    .split(/(?<=[.!?])\s+|\n+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.split(/\s+/).filter(Boolean).length > 0);
  const lengths = sentences.map((sentence) => sentence.split(/\s+/).filter(Boolean).length);
  const words = body.split(/\s+/).filter(Boolean).length;
  const avg = lengths.length ? lengths.reduce((sum, value) => sum + value, 0) / lengths.length : 0;
  const spread = lengths.length
    ? Math.sqrt(lengths.reduce((sum, value) => sum + (value - avg) ** 2, 0) / lengths.length)
    : 0;
  const questions = (content.match(/\?/g) ?? []).length;
  const lastSentence = sentences.at(-1) ?? '';

  let penalty = 0;
  const patterns: PatternHit[] = [];
  const lower = body.toLowerCase();
  for (const pattern of PATTERNS) {
    const source = pattern.accented ? lower : text;
    const matches = [...source.matchAll(pattern.re)].map((match) => match[0]);
    if (pattern.id === 'stacked_closing') {
      if (matches.length >= 2) {
        patterns.push({ id: pattern.id, matches });
        penalty += 10;
      }
      continue;
    }
    if (pattern.id === 'opening_defect') {
      const opening = openingSentences(body).filter((sentence) => DEFECT.test(sentence));
      if (opening.length > 0) {
        patterns.push({ id: pattern.id, matches: opening });
        penalty += 12;
      }
      continue;
    }
    if (pattern.id === 'dash_series') {
      if (matches.length >= 2) {
        patterns.push({ id: pattern.id, matches });
        penalty += 5;
      }
      continue;
    }
    if (matches.length === 0) continue;
    patterns.push({ id: pattern.id, matches });
    penalty += Math.min(pattern.weight * matches.length, pattern.max);
  }
  if (words > 120) penalty += 10;
  if (avg > 25) penalty += 10;
  if (!lastSentence.endsWith('?')) penalty += 10;
  if (questions > 2) penalty += 5;

  const round = (value: number) => Math.round(value * 10) / 10;
  return {
    words,
    sentences: sentences.length,
    avgSentenceWords: round(avg),
    longestSentenceWords: lengths.length ? Math.max(...lengths) : 0,
    sentenceSpread: round(spread),
    questions,
    endsWithQuestion: lastSentence.endsWith('?'),
    patterns,
    score: Math.max(0, 100 - penalty),
  };
}

export interface NaturalnessSummary {
  messages: number;
  meanScore: number;
  medianWords: number;
  endsWithQuestion: number;
  /** Em quantas mensagens cada padrão apareceu (fração de 0 a 1). */
  patternRate: Partial<Record<NaturalnessPatternId, number>>;
}

export function summarizeNaturalness(reports: readonly NaturalnessReport[]): NaturalnessSummary {
  const total = reports.length;
  const words = reports.map((report) => report.words).sort((a, b) => a - b);
  const rate: Partial<Record<NaturalnessPatternId, number>> = {};
  for (const pattern of PATTERNS) {
    const count = reports.filter((report) =>
      report.patterns.some((hit) => hit.id === pattern.id),
    ).length;
    if (count > 0) rate[pattern.id] = Math.round((count / total) * 1000) / 1000;
  }
  return {
    messages: total,
    meanScore: total
      ? Math.round((reports.reduce((sum, report) => sum + report.score, 0) / total) * 10) / 10
      : 0,
    medianWords: total ? (words[Math.floor((total - 1) / 2)] ?? 0) : 0,
    endsWithQuestion: total
      ? Math.round((reports.filter((report) => report.endsWithQuestion).length / total) * 1000) /
        1000
      : 0,
    patternRate: rate,
  };
}
