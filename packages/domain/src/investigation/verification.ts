/**
 * Verificação do que a IA propõe antes de virar claim (§11 da especificação do módulo). O modelo
 * local escreve rascunhos; o servidor descarta o que não pode ser sustentado por fonte pública:
 * faturamento, orçamento, conversão, insatisfação, intenção de contratar, "precisa de rebranding"
 * dito como certeza, decisões internas e resultados de campanha. Também tira repetições e
 * referências inventadas. Nada aqui recusa dados de pessoas (decisão do usuário, ADR-0012).
 */

export type ForbiddenCode =
  | 'revenue'
  | 'budget'
  | 'conversion'
  | 'dissatisfaction'
  | 'hiring_intent'
  | 'needs_service'
  | 'internal_decision'
  | 'campaign_results';

export const FORBIDDEN_REASONS: Record<ForbiddenCode, string> = {
  revenue: 'afirmava faturamento ou lucro, que não aparece em fonte pública',
  budget: 'afirmava orçamento ou verba da empresa',
  conversion: 'afirmava taxa de conversão ou perda de vendas',
  dissatisfaction: 'afirmava insatisfação da empresa ou de pessoas',
  hiring_intent: 'afirmava intenção de contratar',
  needs_service: 'dizia como certeza que a empresa precisa do serviço',
  internal_decision: 'afirmava decisão interna da empresa',
  campaign_results: 'afirmava resultado de campanhas',
};

function fold(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

const PATTERNS: readonly [ForbiddenCode, RegExp][] = [
  [
    'revenue',
    /\b(faturamento|fatura (cerca|mais|menos|ate|r\$)|receita (anual|mensal|bruta|liquida)|lucro|lucra|lucrativ|margem de lucro)/,
  ],
  [
    'budget',
    /\b(orcamento|verba)\b|\b(investe|gasta|investiu|gastou|destina)\b[^.]{0,40}(r\$|\bmil\b|milh)|\b(falta de (investimento|recursos|dinheiro)|(nao|pouco) (investe|investiu|investimento)|investe pouco|investiu pouco|sem (dinheiro|recursos financeiros)|(reduzir|cortar|corte de|reducao de) custos(?! (de|dos|das|para|com|na|no|nas|nos|em) \w))/,
  ],
  [
    'conversion',
    /\b(taxa de conversao|baixa conversao|converte (mal|pouco|bem)|perde(ndo)? (vendas|clientes|oportunidades|pacientes)|deixa de vender)/,
  ],
  ['dissatisfaction', /\b(insatisfeit|descontente|frustrad|infeliz com|nao gosta d|incomodad)/],
  [
    'hiring_intent',
    /\b(quer|pretende|planeja|deseja|esta (procurando|buscando)|procura|busca) (contratar|uma agencia|um designer|um novo site|uma nova marca)|\b(intencao|interesse) (de|em) contrat/,
  ],
  [
    'internal_decision',
    /\b(a diretoria|os socios|o dono|a dona|a gestao|a lideranca|o proprietario|a proprietaria) (decidiu|quer|pretende|planeja|esta)\b|\b(decidiu|decidiram) (mudar|trocar|investir|contratar|expandir)/,
  ],
  [
    'campaign_results',
    /\b(resultado|retorno|roi|desempenho) (das|de|da|dos) (campanha|anuncio|midia|marketing)|\b(engajamento|alcance|seguidores) (caiu|cairam|baix|despenc|diminu)/,
  ],
];

const NEEDS_SERVICE =
  /\b(precisa|necessita|deve fazer|tem que fazer)( urgentemente)?( de)?( um| uma)? (rebranding|nova marca|nova identidade|novo site|novo logo|novo logotipo|redesign|identidade visual|reformulacao)/;

/** Atenuações que transformam "precisa de" em hipótese explícita. */
const HEDGE =
  /\b(pode|poderia|podem|talvez|possivelmente|provavelmente|hipotese|se confirmad|a verificar|verificar se)\b/;

export interface ForbiddenHit {
  code: ForbiddenCode;
  reason: string;
}

/**
 * "Orçamento" no sentido de cotação ("Peça seu orçamento", "orçamento grátis", "Orçamento na
 * hora") é chamada do site, não verba da empresa.
 */
const QUOTE_REQUEST =
  /\b(peca|pecam|solicite|solicitem|pedir|solicitar|solicitacao de|pedido de|faca|facam|fazer|fazemos|receba|receber|envie|enviamos|enviar|elaboramos|elaborar|gere|gerar|simule|simular|calcule|calcular)( o| um| seu| sua| o seu| uma| seus)? (orcamento|cotacao)s?\b|\b(orcamento|cotacao)s? (gratis|gratuit\w*|sem compromisso|na hora|online|on-line|rapid\w*|imediat\w*|personalizad\w*|sob medida|(pelo|por|via) whatsapp|em ate|no mesmo dia|express\w*|sem custo)\b/g;

/**
 * Primeira afirmação proibida no texto, ou null. `allow` libera códigos onde o assunto é legítimo
 * (a objeção "Não temos orçamento agora" é o que a empresa pode dizer, não afirmação sobre ela).
 */
export function forbiddenAssertion(
  text: string,
  options: { allow?: readonly ForbiddenCode[] } = {},
): ForbiddenHit | null {
  const folded = fold(text);
  for (const [code, pattern] of PATTERNS) {
    if (options.allow?.includes(code)) continue;
    const subject = code === 'budget' ? folded.replace(QUOTE_REQUEST, ' ') : folded;
    if (pattern.test(subject)) return { code, reason: FORBIDDEN_REASONS[code] };
  }
  for (const sentence of folded.split(/(?<=[.!?;])\s+/)) {
    if (NEEDS_SERVICE.test(sentence) && !HEDGE.test(sentence)) {
      return { code: 'needs_service', reason: FORBIDDEN_REASONS.needs_service };
    }
  }
  return null;
}

/** Palavras que não fecham frase: afirmação que termina nelas foi interrompida pelo modelo. */
const DANGLING = new Set(
  'a o as os de da do das dos e em no na nos nas um uma por para com que ao aos sua seu suas seus pela pelo mas ou se como'.split(
    ' ',
  ),
);

/**
 * Afirmação interrompida no meio ("A marca pode estar sofrendo com a percepção de"), vista numa
 * investigação real em 2026-11-11. Texto encurtado pelo próprio sistema termina em "…" e não entra.
 */
export function incompleteStatement(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed === '' || /[.!?…:)"”]$/.test(trimmed)) return false;
  const last = fold(trimmed).split(/\s+/).pop() ?? '';
  return DANGLING.has(last.replace(/[^a-z]/g, ''));
}

// -----------------------------------------------------------------------------
// Repetições
// -----------------------------------------------------------------------------

const STOPWORDS = new Set(
  'a o as os de da do das dos e em no na nos nas um uma uns umas por para com que se sua seu suas seus como mais ao aos pela pelo pelas pelos é ser são foi tem há'
    .split(' ')
    .map(fold),
);

function tokens(text: string): Set<string> {
  return new Set(
    fold(text)
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((word) => word.length > 1 && !STOPWORDS.has(word)),
  );
}

/** Semelhança de Jaccard entre os conjuntos de palavras (0 a 1). */
export function statementSimilarity(a: string, b: string): number {
  const left = tokens(a);
  const right = tokens(b);
  if (left.size === 0 && right.size === 0) return 1;
  let common = 0;
  for (const word of left) if (right.has(word)) common += 1;
  return common / (left.size + right.size - common);
}

/** Mantém o primeiro de cada grupo de afirmações quase iguais (ordem preservada). */
export function dedupeByStatement<T>(
  items: readonly T[],
  textOf: (item: T) => string,
  threshold = 0.8,
): { kept: T[]; dropped: number } {
  const kept: T[] = [];
  let dropped = 0;
  for (const item of items) {
    const text = textOf(item);
    if (kept.some((other) => statementSimilarity(textOf(other), text) >= threshold)) {
      dropped += 1;
      continue;
    }
    kept.push(item);
  }
  return { kept, dropped };
}

// -----------------------------------------------------------------------------
// Referências e registro do que foi descartado
// -----------------------------------------------------------------------------

/** Liga referências curtas (`P1`, `K3`) ao que o sistema mostrou; as inventadas ficam de fora. */
export function resolveRefs<T>(
  refs: readonly string[],
  known: ReadonlyMap<string, T>,
): { resolved: T[]; unknown: string[] } {
  const resolved: T[] = [];
  const unknown: string[] = [];
  const seen = new Set<string>();
  for (const raw of refs) {
    const ref = raw.trim().toUpperCase();
    if (seen.has(ref)) continue;
    seen.add(ref);
    const value = known.get(ref);
    if (value === undefined) unknown.push(ref);
    else resolved.push(value);
  }
  return { resolved, unknown };
}

/**
 * O que a verificação fez com o que a IA escreveu: conclusões descartadas, textos ajustados
 * (intensificador tirado, frase contra a auditoria cortada) e itens que o servidor acrescentou
 * (sinal de vagas lido no site). Os motivos levam o trecho atingido (regra 8: o usuário vê o que
 * saiu e o que mudou).
 */
export interface VerificationLog {
  discarded: number;
  /** Textos da IA que o servidor mudou (sem descartar a conclusão). */
  altered?: number;
  /** Itens que o servidor acrescentou ao que a IA trouxe. */
  added?: number;
  reasons: string[];
}

export function emptyVerificationLog(): VerificationLog {
  return { discarded: 0, reasons: [] };
}

function pushReason(log: VerificationLog, reason: string): void {
  const text = reason.length > 160 ? `${reason.slice(0, 159)}…` : reason;
  if (!log.reasons.includes(text) && log.reasons.length < 10) log.reasons.push(text);
}

/** Conta um descarte; o motivo entra uma vez só (no máximo 10 motivos, 160 caracteres cada). */
export function recordDiscard(log: VerificationLog, reason: string, count = 1): void {
  if (count <= 0) return;
  log.discarded += count;
  pushReason(log, reason);
}

/** Conta um texto ajustado ou um item acrescentado pelo servidor (não é descarte). */
export function recordChange(
  log: VerificationLog,
  kind: 'altered' | 'added',
  reason: string,
): void {
  log[kind] = (log[kind] ?? 0) + 1;
  pushReason(log, reason);
}

/** Trecho curto entre aspas para o motivo ("…"), dentro do limite de 160 caracteres. */
export function excerpt(text: string, max = 70): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return `“${flat.length > max ? `${flat.slice(0, max - 1)}…` : flat}”`;
}
