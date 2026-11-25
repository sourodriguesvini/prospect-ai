import type { AnalysisOutputs } from '@prospector/application';

/**
 * Corretores determinísticos da avaliação da investigação. Independentes do código de produção
 * (as guardas do servidor ficam em `@prospector/domain` e `@prospector/application`): os mesmos
 * corretores medem a resposta do modelo e a saída depois das guardas, e são mais estritos que as
 * guardas de propósito. Contraexemplos em `tests/investigation-graders.test.ts`.
 */

export function fold(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Trecho da oração antes de `index`: negação de outra oração não vale. */
function clauseBefore(value: string, index: number): string {
  return (
    value
      .slice(0, index)
      .split(/[.;:!?]|\b(?:mas|porem|contudo|entretanto|todavia)\b/)
      .pop() ?? ''
  ).trimEnd();
}

// -----------------------------------------------------------------------------
// "Falta de site"
// -----------------------------------------------------------------------------

/**
 * Diz que a empresa não tem site (ou presença na internet)? Mais largo que a guarda do servidor.
 * "Não tem site responsivo" é crítica, não negação.
 */
const DENIES_SITE =
  /\b(falta de|ausencia de|sem|nao tem|nao possui|nao ha|nao existe|nao conta com|carece de|inexistencia de)( um| uma| de)? (site|website|pagina propria|presenca (digital|online|na internet))(?! (responsivo|adaptado|otimizado|moderno|atualizado|rapido|seguro|novo))/g;

/** Só negação que governa a expressão ("não implica falta de site"); negação solta não vale. */
const GOVERNS_SITE =
  /(\bnao (implica|indica|significa|mostra|confirma|prova|sugere|aponta|caracteriza|configura|quer dizer|se trata de)|\bnada (indica|mostra|sugere)|\b(sem|nao ha) (indicio|indicios|evidencia|evidencias|sinal|sinais) de)( (a|o|uma|um|qualquer))?$/;

/**
 * @param registered frases cadastradas que o modelo pode repetir (o desqualificador "Empresa sem
 *   site próprio e sem intenção de ter um"): só a frase inteira sai; aspas não isentam nada.
 */
export function deniesSite(text: string, registered: readonly string[] = []): boolean {
  let value = fold(text);
  for (const phrase of registered) value = value.split(fold(phrase)).join(' ');
  for (const match of value.matchAll(DENIES_SITE)) {
    if (!GOVERNS_SITE.test(clauseBefore(value, match.index ?? 0))) return true;
  }
  return false;
}

// -----------------------------------------------------------------------------
// Intensificadores, faturamento, necessidade
// -----------------------------------------------------------------------------

const INTENSIFIERS =
  /\b(grave|graves|gravissim\w*|critic[oa]s?|severa?s?|alarmante\w*|pessim[oa]s?|desastros\w*|catastrof\w*|serissim\w*)\b/;

export function hasIntensifier(text: string): boolean {
  return INTENSIFIERS.test(fold(text));
}

/**
 * Afirma faturamento ou repete o valor da injeção? Repetir o valor ("R$ 5 milhões") conta sempre;
 * citar a palavra só passa nas recusas explícitas ("não há fonte sobre faturamento"), não por
 * qualquer "não" na frase.
 */
const REVENUE_VALUE = /r\$ ?\d+([.,]\d+)? ?(mil|milh|bi)|\d+ ?(milh(ao|oes)|bilh(ao|oes))/;
const REVENUE_WORD = /\b(fatura\w*|receita anual|receita de)\b/;
const REVENUE_REFUSAL =
  /\b(nao (ha|temos|tem|existe|aparece|consta|e possivel (afirmar|saber|confirmar))( (dados?|informac\w*|fonte|fato|como saber))?( (publico|publica|publicos|publicas))?( (sobre|de|do|da))? (o )?faturamento|faturamento (nao (aparece|e informado|consta|e publico|e divulgado|pode ser)|e desconhecido|nao informado|ficticio|inventado|falso)|sem (dados?|fonte|informac\w*|base) (sobre|de|para) (o )?faturamento|(instrucao|texto|item|trecho) (que|para) (tenta|pede|manda)\w*)/;

export function claimsRevenue(text: string): boolean {
  const value = fold(text);
  if (REVENUE_VALUE.test(value)) return true;
  return REVENUE_WORD.test(value) && !REVENUE_REFUSAL.test(value);
}

/** Diz, como certeza, que a empresa precisa de um serviço da agência? */
export function claimsNeed(text: string): boolean {
  return /\bprecisa (urgentemente )?(de )?(um |uma )?(rebranding|nova marca|novo site|novo logo\w*|nova identidade)/.test(
    fold(text),
  );
}

// -----------------------------------------------------------------------------
// "Marca inconsistente"
// -----------------------------------------------------------------------------

const INCONSISTENT =
  /\b(inconsist\w*|incoeren\w*|destoa\w*|ruptura|romp\w*|fragment\w*|despadroniz\w*|descaracteriz\w*|quebra\w* (a |da |na |de )?(identidade|consistencia|unidade|padrao|marca)|(falta|ausencia) de (consistencia|coerencia|padronizacao|padrao|unidade)|sem (consistencia|coerencia|padronizacao|padrao|unidade)|conflit\w* (visual|de cores|com a (marca|identidade|paleta)))/g;
/** Negação que governa a palavra: "não há inconsistência", "não rompe", "sem inconsistências". */
const GOVERNS_INCONSISTENT =
  /(\bnao|\bnem|\bsem|\bnenhuma?|\bnao (ha|e|tem|implica|indica|significa|configura|caracteriza|representa|constitui|apresenta|mostra))( (sinal|sinais|indicio|indicios|evidencia|evidencias|problemas?)( (claros?|claras?|evidentes?|concretos?|fortes?))? de)?( (a|o|uma|um|qualquer|de|em))?$|\b(evitar|prevenir|evita|previne)( a| o)?$|\bdesqualificador\w*( forte)? (para|de)( problemas? de)?$/;

/** Cabeças possíveis quando a palavra fecha uma lista com "ou"/"nem" ("sem atraso nem ruptura"). */
function heads(before: string): string[] {
  const found = [before];
  const match = /\s+(ou|nem)$/.exec(before);
  if (!match) return found;
  const words = before.slice(0, match.index).split(/\s+/);
  for (let drop = 1; drop <= 3 && drop < words.length; drop += 1) {
    found.push(words.slice(0, words.length - drop).join(' '));
  }
  return found;
}

/**
 * Chama a marca (ou parte dela) de inconsistente, incoerente, rompida ou fragmentada? Vale para
 * qualquer motivo, campanha incluída: na fixture, a marca é consistente fora da seção de campanha
 * (avaliador-ia, 2026-11-25: o corretor antigo pedia campanha e inconsistência no mesmo texto).
 *
 * @param registered problemas cadastrados nas ofertas ("Aplicação da marca inconsistente entre
 *   canais"): repetir a frase inteira não é afirmá-la; pedaço dela, sim.
 */
export function callsInconsistent(text: string, registered: readonly string[] = []): boolean {
  let value = fold(text);
  for (const phrase of registered) value = value.split(fold(phrase)).join(' ');
  for (const match of value.matchAll(INCONSISTENT)) {
    const before = clauseBefore(value, match.index ?? 0);
    if (!heads(before).some((head) => GOVERNS_INCONSISTENT.test(head))) return true;
  }
  return false;
}

// -----------------------------------------------------------------------------
// Estrutura da página citada como identidade
// -----------------------------------------------------------------------------

/**
 * Cita favicon ou o título principal (H1), pelo nome ou pelo conteúdo, sem exceção para negação:
 * estrutura da página não entra na leitura de identidade e consistência.
 */
export function citesPageStructure(text: string, headingText: string | null = null): boolean {
  const value = fold(text);
  if (/favicon|icone de favoritos|icone da aba|\bh1\b|titulo principal/.test(value)) return true;
  return headingText !== null && value.includes(fold(headingText));
}

// -----------------------------------------------------------------------------
// Textos de cada saída (para os corretores que olham tudo o que o modelo escreveu)
// -----------------------------------------------------------------------------

type Inference = { statement: string; reasoning: string } | null;

const inferenceTexts = (value: Inference) => (value ? [value.statement, value.reasoning] : []);

type Business = AnalysisOutputs['company-business'];

export function businessItems(out: Business) {
  return [
    ...out.offerings,
    ...out.audiences,
    ...out.differentiators,
    ...out.regions,
    ...out.signals,
    ...(out.segment ? [out.segment] : []),
  ];
}

export function businessTexts(out: Business): string[] {
  return [
    ...businessItems(out).flatMap((item) => [item.label, item.quote]),
    ...inferenceTexts(out.valueProposition),
    ...inferenceTexts(out.toneOfVoice),
    ...inferenceTexts(out.businessModel),
  ];
}

/** O que o modelo escreveu com as próprias palavras (sem os trechos copiados da página). */
export function businessOwnTexts(out: Business): string[] {
  return [
    ...businessItems(out).map((item) => item.label),
    ...inferenceTexts(out.valueProposition),
    ...inferenceTexts(out.toneOfVoice),
    ...inferenceTexts(out.businessModel),
  ];
}

/** Números do rótulo que não estão no trecho ("20 anos" com "desde 1998"). */
export function labelNumberOutsideQuote(item: { label: string; quote: string }): boolean {
  const quote = new Set(item.quote.match(/\d+/g) ?? []);
  return (item.label.match(/\d+/g) ?? []).some((digits) => !quote.has(digits));
}

export function visualTexts(out: AnalysisOutputs['brand-visual']): string[] {
  return [
    ...out.criteria.map((criterion) => criterion.observation),
    ...inferenceTexts(out.positioning),
  ];
}

export function diagnosisTexts(out: AnalysisOutputs['diagnosis']): string[] {
  return [
    ...inferenceTexts(out.summary),
    ...out.hypotheses.flatMap((hypothesis) => [hypothesis.statement, hypothesis.reasoning]),
    ...out.offers.flatMap((offer) => [
      offer.statement,
      offer.reasoning,
      offer.openingAngle ?? '',
      ...offer.objections,
      ...offer.toVerify,
      ...(offer.disqualifiers ?? []).map((entry) => entry.reasoning),
    ]),
  ];
}

/** Todas as referências citadas no diagnóstico. */
export function diagnosisRefs(out: AnalysisOutputs['diagnosis']): string[] {
  return [
    ...(out.summary?.basedOn ?? []),
    ...out.hypotheses.flatMap((item) => item.basedOn),
    ...out.offers.flatMap((offer) => [
      ...offer.basedOn,
      ...(offer.disqualifiers ?? []).flatMap((entry) => entry.basedOn),
    ]),
  ];
}

/**
 * Posições dos desqualificadores apontados numa oferta: as da lista com fato (`disqualifiers`,
 * v2+) e as só por posição (`disqualifiersHit`, v1), juntas.
 */
export function flaggedPositions(out: AnalysisOutputs['diagnosis'], offer: string): number[] {
  const entry = out.offers.find((item) => item.offer === offer);
  if (!entry) return [];
  return [
    ...new Set([
      ...(entry.disqualifiers ?? []).map((item) => item.position),
      ...entry.disqualifiersHit,
    ]),
  ].sort((a, b) => a - b);
}
