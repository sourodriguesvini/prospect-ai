import type { CompanyLanguage, LanguageAddress, LanguageFormality } from '@prospector/contracts';
import { fold } from './text';

/**
 * Linguagem pública da empresa (diretriz 2026-11-26, Parte 5.2), medida por regra sobre trechos
 * LITERAIS que a própria empresa publicou (site e perfis próprios, guardados no ledger). Mede
 * formalidade, tratamento e palavras recorrentes; não resume nem interpreta a voz da empresa.
 * Pouco texto = sem medida (null): a mensagem segue o tom pedido.
 */

const MIN_SAMPLES = 2;
const MIN_CHARS = 160;
const MAX_TERMS = 6;
/** A diferença mínima entre marcas informais e formais para dizer que o texto pende para um lado. */
const LEAN = 2;

const INFORMAL_MARKERS: readonly RegExp[] = [
  /\bvoces?\b/g,
  /\bvc\b/g,
  /\ba gente\b/g,
  /\bpra\b/g,
  /\bta\b/g,
  /\bbora\b/g,
  /\bgalera\b/g,
  /\bdemais\b/g,
  /\bsuper\b/g,
  /\bvem\b/g,
  /\bconfira\b/g,
  /!/g,
];

const FORMAL_MARKERS: readonly RegExp[] = [
  /\bprezad[oa]s?\b/g,
  /\bsenhor(?:a|es|as)?\b/g,
  /\bvossa\b/g,
  /\bexcelencia\b/g,
  /\bcomprometid[oa]s?\b/g,
  /\bcomprometimento\b/g,
  /\bsolucoes\b/g,
  /\bcolaboradores\b/g,
  /\binstitucional\b/g,
  /\bmissao\b/g,
  /\bvalores\b/g,
  /\ba empresa\b/g,
  /\bnossa empresa\b/g,
];

const SECOND_PERSON = /\b(?:voces?|vc|seu|sua|seus|suas)\b/g;
const THIRD_PERSON =
  /\b(?:nossos clientes|nossas clientes|os clientes|o cliente|a empresa|nossa empresa)\b/g;

/** Palavras comuns que não dizem nada sobre como a empresa escreve. */
const STOPWORDS = new Set(
  [
    'sobre',
    'quando',
    'tambem',
    'todos',
    'todas',
    'nossa',
    'nosso',
    'nossos',
    'nossas',
    'voces',
    'vocês',
    'mais',
    'muito',
    'muitos',
    'muitas',
    'entre',
    'desde',
    'ainda',
    'sempre',
    'porque',
    'pelos',
    'pelas',
    'outro',
    'outra',
    'outros',
    'outras',
    'mesmo',
    'mesma',
    'podem',
    'pode',
    'fazer',
    'temos',
    'estao',
    'nosso',
    'aqui',
    'onde',
    'cada',
    'esses',
    'essas',
    'estes',
    'estas',
    'dessa',
    'desse',
    'nesta',
    'neste',
    'nessa',
    'nesse',
    'depois',
    'antes',
    'agora',
    'saiba',
    'clique',
    'acesse',
    'veja',
    'empresa',
    'empresas',
    'cliente',
    'clientes',
    'contato',
    'whatsapp',
    'instagram',
    'facebook',
    'linkedin',
    'direitos',
    'reservados',
    'politica',
    'privacidade',
    'termos',
  ].map(fold),
);

const WORD = /\p{L}[\p{L}-]{4,}/gu;

function count(text: string, markers: readonly RegExp[]): number {
  return markers.reduce((sum, marker) => sum + (text.match(marker)?.length ?? 0), 0);
}

function formalityOf(folded: string): LanguageFormality {
  const informal = count(folded, INFORMAL_MARKERS);
  const formal = count(folded, FORMAL_MARKERS);
  if (informal >= formal + LEAN) return 'informal';
  if (formal >= informal + LEAN) return 'formal';
  return 'neutral';
}

function addressOf(folded: string): LanguageAddress {
  const second = folded.match(SECOND_PERSON)?.length ?? 0;
  const third = folded.match(THIRD_PERSON)?.length ?? 0;
  if (second >= 2 && second >= third) return 'second_person';
  if (third >= 1 && second < 2) return 'third_person';
  return 'unknown';
}

/**
 * Palavras que aparecem em pelo menos dois trechos (recorrência, não frequência dentro de um texto),
 * na forma escrita pela empresa (com acento), sem as palavras do nome da empresa.
 */
function recurringTerms(samples: readonly string[], companyName: string): string[] {
  const nameWords = new Set((companyName.match(WORD) ?? []).map((word) => fold(word)));
  const seen = new Map<string, { shown: string; samples: number; total: number }>();
  for (const sample of samples) {
    const inThis = new Set<string>();
    for (const word of sample.match(WORD) ?? []) {
      const key = fold(word);
      if (STOPWORDS.has(key) || nameWords.has(key) || /\d/.test(key)) continue;
      const entry = seen.get(key) ?? { shown: word.toLowerCase(), samples: 0, total: 0 };
      entry.total += 1;
      if (!inThis.has(key)) {
        entry.samples += 1;
        inThis.add(key);
      }
      seen.set(key, entry);
    }
  }
  return [...seen.values()]
    .filter((entry) => entry.samples >= 2)
    .sort((a, b) => b.samples - a.samples || b.total - a.total || a.shown.localeCompare(b.shown))
    .slice(0, MAX_TERMS)
    .map((entry) => entry.shown.slice(0, 40));
}

export function measureCompanyLanguage(
  samples: readonly string[],
  companyName: string,
): CompanyLanguage | null {
  const texts = [...new Set(samples.map((text) => text.trim()).filter((text) => text.length >= 3))];
  const chars = texts.reduce((sum, text) => sum + text.length, 0);
  if (texts.length < MIN_SAMPLES || chars < MIN_CHARS) return null;
  const folded = fold(texts.join('\n'));
  return {
    formality: formalityOf(folded),
    address: addressOf(folded),
    terms: recurringTerms(texts, companyName),
    samples: texts.length,
  };
}
