import { normalizeCity, normalizeCompanyName, sameCompanyNameAt } from './names';

/**
 * Deduplicação determinística das empresas encontradas (F4, KI-086). Ordem de força:
 * 1. raiz do CNPJ (mesma empresa, inclusive filiais);
 * 2. site oficial (domínio registrável);
 * 3. nome + cidade (ou mesma UF quando um dos lados não tem cidade), só quando um dos lados não
 *    tem site: dois sites diferentes são duas empresas, mesmo com o mesmo nome. O nome é comparado
 *    sem a cidade ou a UF no fim e admite palavras de segmento a mais no começo de um lado
 *    ("Quali Saúde" × "Clínica Quali Saúde l Ribeirão Preto", achado da pesquisa real, KI-117).
 * Nomes só parecidos nunca juntam sozinhos: "Clínica Vida" e "Clínica Vida Plena" ficam
 * separadas até um site ou CNPJ em comum provar que são a mesma.
 */

export interface DedupeCandidate {
  name: string;
  /** Chave do site oficial (`siteKey`), quando o resultado é o site da própria empresa. */
  siteKey: string | null;
  city: string | null;
  uf: string | null;
  cnpj: string | null;
}

export interface DedupeTarget extends DedupeCandidate {
  id: string;
}

export function nameKeyOf(name: string): string {
  return normalizeCompanyName(name);
}

/** Chave única gravada no banco: o site quando há; senão nome, cidade e UF. */
export function prospectDedupeKey(candidate: DedupeCandidate): string {
  if (candidate.siteKey) return `domain:${candidate.siteKey}`;
  const city = candidate.city ? normalizeCity(candidate.city) : '';
  return `name:${nameKeyOf(candidate.name)}|${city}|${candidate.uf ?? ''}`.slice(0, 300);
}

function cnpjRoot(cnpj: string | null): string | null {
  return cnpj && cnpj.length === 14 ? cnpj.slice(0, 8) : null;
}

function locationCompatible(a: DedupeCandidate, b: DedupeCandidate): boolean {
  const cityA = a.city ? normalizeCity(a.city) : null;
  const cityB = b.city ? normalizeCity(b.city) : null;
  if (cityA && cityB) return cityA === cityB && (!a.uf || !b.uf || a.uf === b.uf);
  // Um lado sem cidade: só junta com a mesma UF dos dois lados.
  return Boolean(a.uf && b.uf && a.uf === b.uf);
}

export type MatchReason = 'cnpj' | 'site' | 'name_location';

/** A primeira empresa já conhecida que é a mesma do candidato, com o motivo; null = nova. */
export function findSameCompany<T extends DedupeTarget>(
  candidate: DedupeCandidate,
  known: readonly T[],
): { target: T; reason: MatchReason } | null {
  const root = cnpjRoot(candidate.cnpj);
  if (root) {
    const byCnpj = known.find((item) => cnpjRoot(item.cnpj) === root);
    if (byCnpj) return { target: byCnpj, reason: 'cnpj' };
  }
  if (candidate.siteKey) {
    const bySite = known.find((item) => item.siteKey === candidate.siteKey);
    if (bySite) return { target: bySite, reason: 'site' };
  }
  const byName = known.find(
    (item) =>
      sameCompanyNameAt(item.name, candidate.name, [
        item.city,
        candidate.city,
        item.uf,
        candidate.uf,
      ]) &&
      locationCompatible(item, candidate) &&
      // Dois sites diferentes = duas empresas.
      !(item.siteKey && candidate.siteKey && item.siteKey !== candidate.siteKey) &&
      // Dois CNPJs diferentes = duas empresas.
      !(cnpjRoot(item.cnpj) && root && cnpjRoot(item.cnpj) !== root),
  );
  return byName ? { target: byName, reason: 'name_location' } : null;
}
