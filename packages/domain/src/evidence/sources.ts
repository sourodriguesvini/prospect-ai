import type { Source, SourceReliabilityTier } from '@prospector/contracts';

/**
 * Classificação e origem de fontes (docs/08 §2.2 e §2.5). A categoria de confiabilidade é
 * decidida pelo sistema a partir do tipo, do provedor e do endereço da fonte, nunca pelo modelo.
 */

type SourceLocation = Pick<Source, 'kind' | 'url' | 'provider'>;

/** Listas que a aplicação fornece: configuração e, em `ownedOrigins`, dados do sujeito do claim. */
export interface SourceClassificationContext {
  /** Provedores de registro oficial (ex.: base CNPJ da Receita). */
  readonly officialProviders: readonly string[];
  /**
   * Domínios e perfis do sujeito do claim (a empresa investigada): `clinica.example.test` (vale
   * para subdomínios) ou `instagram.com/clinica` (prefixo de caminho). Muda de claim para claim.
   */
  readonly ownedOrigins: readonly string[];
  /** Domínios de imprensa reconhecida. */
  readonly pressHosts: readonly string[];
  /** Domínios de agregadores e diretórios. */
  readonly aggregatorHosts: readonly string[];
}

function normalizeName(value: string): string {
  return value.trim().toLowerCase();
}

interface Location {
  readonly host: string;
  readonly path: string;
}

/** Prefixos que não mudam o dono do endereço: `www.` e versões móveis. */
const HOST_ALIAS_PREFIX = /^(www|m|mobile)\./;

/**
 * Endereço comparável: host em minúsculas e punycode (como o `URL` devolve), sem ponto final nem
 * `www.`/`m.`/`mobile.`; caminho em minúsculas sem barra final. Null se não for URL.
 */
function parseLocation(url: string): Location | null {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase().replace(/\.$/, '').replace(HOST_ALIAS_PREFIX, '');
    const path = parsed.pathname.toLowerCase().replace(/\/+$/, '');
    return host ? { host, path } : null;
  } catch {
    return null;
  }
}

/** Entrada de lista (`Café.test`, `https://www.exemplo.test/perfil/`) no mesmo formato. */
function parseEntry(entry: string): Location | null {
  const trimmed = entry.trim();
  if (!trimmed) return null;
  return parseLocation(/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`);
}

/** Entrada só com domínio vale para os subdomínios; com caminho, é prefixo de caminho. */
function matchesEntry(location: Location, rawEntry: string): boolean {
  const entry = parseEntry(rawEntry);
  if (!entry) return false;
  if (entry.path === '') {
    return location.host === entry.host || location.host.endsWith(`.${entry.host}`);
  }
  return (
    location.host === entry.host &&
    (location.path === entry.path || location.path.startsWith(`${entry.path}/`))
  );
}

function matchesAny(location: Location, entries: readonly string[]) {
  return entries.some((entry) => matchesEntry(location, entry));
}

/**
 * Categoria de confiabilidade (proposta F3a, docs/08 §2.5):
 * - anotação do usuário → `user_reported`;
 * - registro de API → `official_registry` se o provedor é oficial, senão `aggregator`;
 * - demais pelo endereço: própria empresa, imprensa, agregador ou `unknown`;
 * - resultado de busca é cópia indireta: nunca passa de `aggregator`.
 */
export function classifySourceReliability(
  source: SourceLocation,
  context: SourceClassificationContext,
): SourceReliabilityTier {
  if (source.kind === 'user_note') return 'user_reported';
  if (source.kind === 'api_record') {
    const provider = source.provider ? normalizeName(source.provider) : null;
    const official = context.officialProviders.map(normalizeName);
    return provider !== null && official.includes(provider) ? 'official_registry' : 'aggregator';
  }
  const location = source.url ? parseLocation(source.url) : null;
  let tier: SourceReliabilityTier = 'unknown';
  if (location) {
    if (matchesAny(location, context.ownedOrigins)) tier = 'company_owned';
    else if (matchesAny(location, context.pressHosts)) tier = 'recognized_press';
    else if (matchesAny(location, context.aggregatorHosts)) tier = 'aggregator';
  }
  if (source.kind === 'search_result' && tier !== 'unknown') return 'aggregator';
  return tier;
}

/**
 * Origem da fonte, para decidir se duas fontes são independentes (proposta F3a): registro de API
 * pelo provedor; o resto pelo domínio (sem `www.`), então páginas do mesmo site e perfis da mesma
 * rede social contam como uma origem só. Sem endereço, pelo provedor ou pelo tipo.
 */
export function sourceOrigin(source: SourceLocation): string {
  if (source.kind === 'api_record' && source.provider) {
    return `provider:${normalizeName(source.provider)}`;
  }
  const location = source.url ? parseLocation(source.url) : null;
  if (location) return `host:${location.host}`;
  if (source.provider) return `provider:${normalizeName(source.provider)}`;
  return `kind:${source.kind}`;
}

/** Origem única de tudo o que a própria empresa publica (site, subdomínios, perfis): mesmo autor. */
export const SUBJECT_OWNED_ORIGIN = 'owned:subject';

/** Origem de uma evidência, já considerando a categoria que a fonte tem para o sujeito do claim. */
export function evidenceOrigin(source: SourceLocation, tier: SourceReliabilityTier): string {
  return tier === 'company_owned' ? SUBJECT_OWNED_ORIGIN : sourceOrigin(source);
}
