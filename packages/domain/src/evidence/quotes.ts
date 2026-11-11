import {
  CLAIM_ISSUE_MESSAGES,
  type ClaimEvidenceInput,
  type ClaimIssue,
} from '@prospector/contracts';

/**
 * Conferência determinística do trecho citado (docs/08 §2.4, passo DET): o trecho precisa existir
 * no conteúdo guardado da fonte, comparado sem diferença de espaços, acentos, aspas tipográficas
 * nem maiúsculas. O juiz (o trecho sustenta a afirmação?) é outro passo, com modelo.
 */
export function normalizeForQuote(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/[–—]/g, '-')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export function quoteFoundIn(quote: string, content: string): boolean {
  const wanted = normalizeForQuote(quote);
  return wanted.length > 0 && normalizeForQuote(content).includes(wanted);
}

export interface QuoteCheck {
  readonly issues: readonly ClaimIssue[];
  /** Por evidência, na ordem: true/false quando há trecho e conteúdo; null quando não há. */
  readonly verified: readonly (boolean | null)[];
}

/**
 * Confere cada trecho contra o conteúdo da fonte (`sources.excerpt_text`). Sem conteúdo guardado
 * (captura de tela, página ainda não normalizada) o trecho fica sem conferência (`null`) e o juiz
 * decide depois; com conteúdo, trecho que não aparece impede a gravação.
 */
export function checkQuotes(
  evidence: readonly Pick<ClaimEvidenceInput, 'sourceId' | 'quote'>[],
  contents: ReadonlyMap<string, string | null>,
): QuoteCheck {
  const issues: ClaimIssue[] = [];
  const verified = evidence.map((item, index) => {
    const content = contents.get(item.sourceId) ?? null;
    if (item.quote === null || content === null) return null;
    const found = quoteFoundIn(item.quote, content);
    if (!found) {
      issues.push({
        code: 'evidence_quote_not_found',
        field: `evidence.${index}.quote`,
        message: CLAIM_ISSUE_MESSAGES.evidence_quote_not_found,
      });
    }
    return found;
  });
  return { issues, verified };
}
