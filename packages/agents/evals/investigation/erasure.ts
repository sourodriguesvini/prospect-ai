import type { AnalysisOutputs } from '@prospector/application';
import {
  businessItems,
  claimsNeed,
  claimsRevenue,
  deniesSite,
  diagnosisTexts,
  fold,
} from './graders';

/**
 * Corretores do que as guardas apagam por engano (revisão independente das guardas,
 * 2026-11-25). Comparam a resposta crua com a saída depois das guardas: só contam itens que os
 * corretores da avaliação não acusam (sem faturamento, sem "precisa de", sem negar o site lido),
 * para que o descarte legítimo não entre como engano. Independentes do código de produção.
 */

export interface Preservation {
  name: string;
  kept: boolean;
}

/** "Orçamento" no sentido de cotação (chamada do site), não de verba. */
const QUOTE_SENSE =
  /\b(pec[ao]|solicite|pedir|solicitar|faca|receba|envie|fazemos)( o| um| seu| sua| o seu| uma)? orcamento|\borcamento (gratis|gratuito|sem compromisso|na hora|online|rapido|pelo whatsapp|personalizado)/;
/** Inconsistência de dado (não de marca). */
const DATA_INCONSISTENCY =
  /\b(inconsisten\w*|diverge\w*|diferente\w*|conflit\w*)\b.*\b(horario|preco|endereco|telefone|contato|e-?mail|dados|cadastro|funcionamento)|\b(horario|preco|endereco|telefone|contato|e-?mail|dados|cadastro|funcionamento)\w*\b.*\binconsisten\w*/;

/** Frase cortada pelo modelo ("Pode haver um posicionamento de"): descartá-la não é engano. */
const INTERRUPTED =
  /\b(a|o|as|os|de|da|do|das|dos|e|em|no|na|nos|nas|um|uma|por|para|com|que|ao|pela|pelo|como|ou)\s*$/;

/**
 * Item que nenhum corretor acusa. Afirmação cortada é problema; raciocínio cortado só quando não
 * tem nenhuma frase completa antes do corte (o servidor guarda as completas).
 */
const clean = (statement: string, registered: readonly string[], support = '') => {
  const supportFolded = fold(support);
  const supportCut = INTERRUPTED.test(supportFolded) && !/[.!?]/.test(supportFolded);
  const text = `${statement} ${support}`;
  return (
    !INTERRUPTED.test(fold(statement)) &&
    !supportCut &&
    !claimsRevenue(text) &&
    !claimsNeed(text) &&
    !deniesSite(text, registered)
  );
};

function sentences(texts: readonly string[]): string[] {
  return texts.flatMap((text) => text.split(/(?<=[.!?])\s+/)).filter((text) => text.trim());
}

/** A frase continua na saída (inteira ou quase: o servidor pode tirar só o intensificador). */
function survives(sentence: string, after: readonly string[]): boolean {
  const words = fold(sentence)
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 3);
  if (words.length === 0) return true;
  const pool = fold(after.join(' '));
  return words.filter((word) => pool.includes(word)).length / words.length >= 0.8;
}

export function preservation(
  agent: keyof AnalysisOutputs,
  raw: unknown,
  guarded: unknown,
  registered: readonly string[] = [],
): Preservation[] {
  if (!raw || !guarded) return [];
  const found: Preservation[] = [];
  switch (agent) {
    case 'company-business': {
      const before = raw as AnalysisOutputs['company-business'];
      const after = guarded as AnalysisOutputs['company-business'];
      const labels = new Set(businessItems(after).map((item) => fold(item.label)));
      for (const item of businessItems(before)) {
        const text = `${item.label} ${item.quote}`;
        if (!clean(text, registered)) continue;
        if (QUOTE_SENSE.test(fold(text))) {
          found.push({ name: 'cotação preservada', kept: labels.has(fold(item.label)) });
        }
      }
      for (const [field, name] of [
        ['valueProposition', 'proposta de valor preservada'],
        ['toneOfVoice', 'tom de voz preservado'],
        ['businessModel', 'modelo de negócio preservado'],
      ] as const) {
        const value = before[field];
        if (!value || !clean(value.statement, registered, value.reasoning)) continue;
        found.push({ name, kept: after[field] !== null });
      }
      break;
    }
    case 'brand-visual': {
      const before = raw as AnalysisOutputs['brand-visual'];
      const after = guarded as AnalysisOutputs['brand-visual'];
      for (const criterion of before.criteria) {
        if (!clean(criterion.observation, registered)) continue;
        found.push({
          name: QUOTE_SENSE.test(fold(criterion.observation))
            ? 'cotação preservada'
            : 'achado visual preservado',
          kept: after.criteria.some((item) => item.criterion === criterion.criterion),
        });
      }
      break;
    }
    case 'competitor-triage': {
      const before = raw as AnalysisOutputs['competitor-triage'];
      const after = guarded as AnalysisOutputs['competitor-triage'];
      for (const candidate of before.candidates) {
        if (
          candidate.kind === 'unrelated' ||
          claimsRevenue(candidate.reason) ||
          claimsNeed(candidate.reason)
        )
          continue;
        const kept = after.candidates.find((item) => item.ref === candidate.ref);
        found.push({
          name: 'concorrente real preservado',
          kept: kept !== undefined && kept.kind === candidate.kind,
        });
      }
      break;
    }
    case 'diagnosis': {
      const before = raw as AnalysisOutputs['diagnosis'];
      const after = guarded as AnalysisOutputs['diagnosis'];
      const afterTexts = diagnosisTexts(after);
      for (const sentence of sentences(diagnosisTexts(before))) {
        if (!clean(sentence, registered)) continue;
        const folded = fold(sentence);
        if (DATA_INCONSISTENCY.test(folded)) {
          found.push({
            name: 'inconsistência de dado preservada',
            kept: survives(sentence, afterTexts),
          });
        } else if (QUOTE_SENSE.test(folded)) {
          found.push({ name: 'cotação preservada', kept: survives(sentence, afterTexts) });
        }
      }
      for (const offer of before.offers) {
        if (!clean(offer.statement, registered, offer.reasoning)) continue;
        found.push({
          name: 'leitura de oferta sem problema preservada',
          kept: after.offers.some((item) => item.offer === offer.offer),
        });
      }
      for (const hypothesis of before.hypotheses) {
        if (!clean(hypothesis.statement, registered, hypothesis.reasoning)) continue;
        found.push({
          name: 'hipótese sem problema preservada',
          kept: after.hypotheses.some(
            (item) => item.statement.length > 0 && survives(hypothesis.statement, [item.statement]),
          ),
        });
      }
      break;
    }
  }
  return found;
}
