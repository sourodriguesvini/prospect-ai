/**
 * Nomes de empresas comparáveis sem depender do modelo: minúsculas, sem acento, sem pontuação e
 * sem a forma jurídica (Ltda, ME, S.A.…). Comparação conservadora: nomes parecidos de cidades
 * diferentes continuam sendo empresas diferentes (quem decide é a deduplicação, com a cidade).
 */

const LEGAL_FORMS = new Set([
  'ltda',
  'limitada',
  'me',
  'epp',
  'eireli',
  'mei',
  'sa',
  's/a',
  'ss',
  'cia',
  'sociedade',
  'simples',
  'unipessoal',
  'eli',
  'slu',
]);

const STOPWORDS = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'a', 'o', 'em', 'the', 'and']);

/**
 * Palavras de segmento que, sozinhas, não identificam uma empresa ("Clínica", "Grupo"…). É também
 * a lista com que foi gravada a `name_key` das empresas antes do KI-147: não mude esta lista sem
 * recalcular essas chaves (ver `companyNameCore` com `legacy`).
 */
const GENERIC_WORDS = new Set([
  'clinica',
  'clinicas',
  'centro',
  'grupo',
  'instituto',
  'hospital',
  'empresa',
  'servicos',
  'consultoria',
  'comercio',
  'industria',
  'loja',
  'medica',
  'medico',
  'saude',
  'odontologia',
  'odonto',
  'brasil',
  'sp',
  'rede',
  'unidade',
  'oficial',
  'site',
]);

/**
 * Palavras de segmento a mais só para juntar a mesma empresa (deduplicação) e conferir o
 * endereço do site (KI-147): "Pet Shop Casa do Produtor" × "Casa do Produtor". Ficam fora de
 * `distinctiveTokens`, que também decide se um nome aparece numa fonte (`nameFoundIn`): lá, tirar
 * "pet" deixaria "Pet Shop Amigo" ser achado em "Clínica Amigo Fiel".
 */
const SEGMENT_WORDS = new Set([
  ...GENERIC_WORDS,
  'pet',
  'pets',
  'petshop',
  'shop',
  'store',
  'veterinaria',
  'veterinario',
  'veterinarios',
  'vet',
  'clinic',
]);

export function stripAccents(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** Nome sem acento, pontuação nem forma jurídica, em minúsculas. */
export function normalizeCompanyName(name: string): string {
  const words = stripAccents(name)
    .toLowerCase()
    .replace(/&/g, ' e ')
    .replace(/\bs\s*\/\s*a\b/g, ' sa ')
    .replace(/\bs\.\s*a\.?/g, ' sa ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
  while (words.length > 1 && LEGAL_FORMS.has(words[words.length - 1] ?? '')) words.pop();
  return words.join(' ');
}

/** Palavras que distinguem a empresa (sem artigos nem palavras genéricas de segmento). */
export function distinctiveTokens(name: string): string[] {
  return tokensWithout(name, GENERIC_WORDS);
}

/** Como `distinctiveTokens`, tirando também as palavras de segmento do ramo (KI-147). */
function coreTokens(name: string): string[] {
  return tokensWithout(name, SEGMENT_WORDS);
}

function tokensWithout(name: string, segment: ReadonlySet<string>): string[] {
  return normalizeCompanyName(name)
    .split(' ')
    .filter((word) => word.length >= 3 && !STOPWORDS.has(word) && !segment.has(word));
}

/** Mesmo nome depois de normalizado. */
export function sameCompanyName(a: string, b: string): boolean {
  const left = normalizeCompanyName(a);
  return left.length >= 3 && left === normalizeCompanyName(b);
}

/** Separadores que sobram depois de tirar a pontuação ("Clínica X l Ribeirão Preto", com L no lugar de "|"). */
const LOOSE_SEPARATORS = new Set(['l', 'i']);

/**
 * Nome sem a cidade ou a UF no fim, como em perfis de rede social e títulos de página
 * ("Clínica Quali Saúde l Ribeirão Preto" → "clinica quali saude"). Só tira o lugar informado
 * (a cidade e a UF da própria empresa), e o separador solto só junto com ele.
 */
export function nameWithoutPlace(
  name: string,
  places: readonly (string | null | undefined)[],
): string {
  const words = normalizeCompanyName(name).split(' ').filter(Boolean);
  const sequences = places
    .filter((place): place is string => Boolean(place))
    .map((place) => normalizeCity(place).split(' ').filter(Boolean))
    .filter((sequence) => sequence.length > 0 && sequence.join('').length >= 2);
  let changed = true;
  while (changed) {
    changed = false;
    for (const sequence of sequences) {
      const start = words.length - sequence.length;
      if (start < 1 || !sequence.every((word, index) => words[start + index] === word)) continue;
      words.splice(start);
      while (words.length > 1 && LOOSE_SEPARATORS.has(words[words.length - 1] ?? '')) words.pop();
      changed = true;
      break;
    }
  }
  return words.join(' ');
}

/**
 * Chave de busca do nome entre as empresas já encontradas: sem o lugar no fim e sem as palavras
 * de segmento do começo e do fim ("Clínica Quali Saúde l Ribeirão Preto" e "Quali Saúde" →
 * "quali saude"; "Bem Locão Pet Shop" → "bem locao"). Só serve para achar candidatas; quem
 * decide se é a mesma é `sameCompanyNameAt`. `legacy: true` refaz a chave como era gravada antes
 * do KI-147 (lista de segmento antiga, sem tirar nada do fim), para a busca ainda achar as
 * empresas já salvas.
 */
export function companyNameCore(
  name: string,
  places: readonly (string | null | undefined)[],
  options: { legacy?: boolean } = {},
): string {
  const segment = options.legacy ? GENERIC_WORDS : SEGMENT_WORDS;
  const words = nameWithoutPlace(name, places).split(' ').filter(Boolean);
  while (words.length > 1 && isFiller(words[0] ?? '', segment)) words.shift();
  if (!options.legacy) {
    while (words.length > 1 && TRAILING_SEGMENT_WORDS.has(words[words.length - 1] ?? '')) {
      words.pop();
    }
  }
  return words.join(' ');
}

function isFiller(word: string, segment: ReadonlySet<string> = SEGMENT_WORDS): boolean {
  return segment.has(word) || STOPWORDS.has(word);
}

/**
 * Palavras de segmento que aparecem a mais no FIM do nome ("Bem Locão Pet Shop", "Hospital
 * Veterinário Municipal - Serviços"). Lista mais curta que `GENERIC_WORDS` de propósito: "Vida
 * Saúde" e "Quali Saúde" têm a palavra de segmento como parte do nome (KI-147).
 */
const TRAILING_SEGMENT_WORDS = new Set([
  'pet',
  'pets',
  'petshop',
  'shop',
  'store',
  'servicos',
  'oficial',
  'site',
]);

/**
 * Mesmo nome, admitindo duas diferenças comuns entre o site e um perfil ou diretório: a cidade ou
 * a UF da empresa no fim e palavras de segmento a mais no começo ou no fim de um dos lados
 * ("Quali Saúde" × "Clínica Quali Saúde l Ribeirão Preto"; "Bem Locão" × "Bem Locão Pet Shop").
 * Continuam separadas "Clínica Vida" × "Clínica Vida Plena" (palavra que distingue a mais),
 * "Hospital São Lucas" × "Clínica São Lucas" (segmentos diferentes nos dois lados) e nomes que,
 * sem o lugar, ficam só com palavras de segmento ("Clínica Ribeirão Preto" × "Clínica SP").
 */
export function sameCompanyNameAt(
  a: string,
  b: string,
  places: readonly (string | null | undefined)[],
): boolean {
  if (sameCompanyName(a, b)) return true;
  const left = nameWithoutPlace(a, places);
  const right = nameWithoutPlace(b, places);
  if (coreTokens(left).length === 0 || coreTokens(right).length === 0) return false;
  if (left === right) return true;
  const [shorter, longer] = left.length <= right.length ? [left, right] : [right, left];
  // Uma palavra curta sozinha ("Vida") é comum demais para juntar só pelo nome.
  if (!shorter.includes(' ') && shorter.length < 6) return false;
  // Só palavras de segmento a mais, de um lado só: no começo ("Pet Shop Casa do Produtor" ×
  // "Casa do Produtor") ou, da lista curta, no fim ("Bem Locão Pet Shop" × "Bem Locão") (KI-147).
  if (longer.endsWith(` ${shorter}`)) {
    return wordsOf(longer.slice(0, longer.length - shorter.length)).every((word) => isFiller(word));
  }
  if (longer.startsWith(`${shorter} `)) {
    return wordsOf(longer.slice(shorter.length)).every((word) => TRAILING_SEGMENT_WORDS.has(word));
  }
  return false;
}

function wordsOf(text: string): string[] {
  return text.trim().split(' ').filter(Boolean);
}

/**
 * O nome combina com o endereço do site? (`Clínica Vida Plena` × `vidaplena.com.br`). Usado para
 * conferir quando o modelo diz que um resultado é o site oficial de uma empresa.
 */
export function nameMatchesHost(name: string, host: string): boolean {
  const label = (
    host
      .toLowerCase()
      .replace(/^www\./, '')
      .split('.')[0] ?? ''
  ).replace(/-/g, '');
  if (label.length < 3) return false;
  // Sem as palavras do ramo: "shop" não faz de paranashop.com.br o site do "Pet Shop X".
  const tokens = coreTokens(name);
  if (tokens.some((token) => token.length >= 4 && label.includes(token))) return true;
  const joined = normalizeCompanyName(name).replace(/ /g, '');
  if (joined.length >= 4 && (label.includes(joined) || joined.includes(label))) return true;
  // Siglas: "Hospital São Lucas de Ribeirão" × "hslr.com.br".
  const initials = normalizeCompanyName(name)
    .split(' ')
    .filter((word) => !STOPWORDS.has(word))
    .map((word) => word[0])
    .join('');
  return initials.length >= 3 && label === initials;
}

/** O texto (título ou página) cita a empresa pelo nome? */
export function nameFoundIn(name: string, text: string): boolean {
  const haystack = ` ${normalizeCompanyName(text)} `;
  const full = normalizeCompanyName(name);
  if (full.length >= 4 && haystack.includes(` ${full} `)) return true;
  const tokens = distinctiveTokens(name);
  if (tokens.length === 0) return false;
  const found = tokens.filter((token) => haystack.includes(` ${token} `)).length;
  return found === tokens.length || (tokens.length >= 3 && found >= tokens.length - 1);
}

/** Cidade comparável (sem acento, minúsculas). */
export function normalizeCity(city: string): string {
  return stripAccents(city)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}
