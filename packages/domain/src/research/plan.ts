import type { ResearchCriteria, ResearchQuery, UF } from '@prospector/contracts';
import { fold } from '../commercial/text';
import { UF_INFO, ufInfo } from './regions';

/**
 * Plano da pesquisa extensa (Parte 6.4): consultas por profissão e região, em voltas — primeiro a
 * capital de cada estado (na ordem de prioridade), depois as outras cidades grandes, depois as
 * variações do termo. Nunca pelo nome de uma pessoa (revisão de conformidade, R5).
 */

/** Resultados novos esperados por consulta (média observada é menor que os 10 que voltam). */
export const EXPECTED_NEW_PER_QUERY = 3;
/** Folga sobre o necessário: muita consulta volta repetida ou de diretório sem nome. */
const PLAN_SLACK = 1.6;
const MIN_QUERIES = 6;
export const MAX_PLANNED_QUERIES = 400;

/** Créditos (consultas básicas da Tavily) para a quantidade pedida, dentro do teto. */
export function creditCapFor(requestedCount: number, monthlyCreditsLeft: number | null): number {
  const wanted = Math.max(
    MIN_QUERIES,
    Math.ceil((requestedCount / EXPECTED_NEW_PER_QUERY) * PLAN_SLACK),
  );
  const cap = Math.min(300, wanted);
  return monthlyCreditsLeft === null ? cap : Math.max(1, Math.min(cap, monthlyCreditsLeft));
}

/** Estados na ordem do plano: prioridade, depois os pedidos (ou o Brasil por população). */
export function orderedUfs(criteria: Pick<ResearchCriteria, 'ufs' | 'priorityUfs'>): UF[] {
  const base: UF[] = criteria.ufs.length > 0 ? criteria.ufs : UF_INFO.map((info) => info.uf);
  const allowed = new Set<UF>(base);
  const priority = criteria.priorityUfs.filter(
    (uf) => allowed.has(uf) || criteria.ufs.length === 0,
  );
  const rest = base.filter((uf) => !priority.includes(uf));
  return [...new Set([...priority, ...rest])];
}

interface Slot {
  readonly uf: UF | null;
  readonly city: string | null;
  readonly term: string;
}

/** As três voltas (capitais, outras cidades, outros termos) para um grupo de estados. */
function rounds(ufs: readonly UF[], main: string, otherTerms: readonly string[]): Slot[] {
  const out: Slot[] = [];
  for (const uf of ufs) out.push({ uf, city: ufInfo(uf)?.capital ?? null, term: main });
  for (const uf of ufs) {
    for (const city of ufInfo(uf)?.cities ?? []) out.push({ uf, city, term: main });
  }
  for (const term of otherTerms) {
    for (const uf of ufs) out.push({ uf, city: ufInfo(uf)?.capital ?? null, term });
  }
  return out;
}

/**
 * Ordem das consultas: os estados priorizados primeiro, inteiros (capital, outras cidades, outros
 * termos); depois os demais em voltas — capitais, outras cidades, outros termos.
 */
function slots(criteria: ResearchCriteria): Slot[] {
  const ufs = orderedUfs(criteria);
  const [mainTerm, ...otherTerms] = criteria.terms;
  if (criteria.cities.length > 0) {
    const out: Slot[] = [];
    for (const city of criteria.cities) {
      const uf = ufs.find((candidate) => {
        const info = ufInfo(candidate);
        return info?.capital === city || info?.cities.includes(city);
      });
      for (const term of criteria.terms) out.push({ uf: uf ?? null, city, term });
    }
    return out;
  }
  const main = mainTerm ?? criteria.profession;
  const priority = new Set<UF>(criteria.priorityUfs);
  const first = ufs.filter((uf) => priority.has(uf));
  const rest = ufs.filter((uf) => !priority.has(uf));
  return [...rounds(first, main, otherTerms), ...rounds(rest, main, otherTerms)];
}

function queryText(slot: Slot): string {
  const place = [slot.city, slot.uf].filter(Boolean).join(' ');
  return `${slot.term} ${place}`.replace(/\s+/g, ' ').trim().slice(0, 300);
}

/** Plano inicial: tantas consultas quanto o teto de créditos permite, na ordem das voltas. */
export function planResearch(criteria: ResearchCriteria, creditCap: number): ResearchQuery[] {
  const limit = Math.min(MAX_PLANNED_QUERIES, Math.max(1, creditCap));
  const seen = new Set<string>();
  const queries: ResearchQuery[] = [];
  for (const slot of slots(criteria)) {
    const query = queryText(slot);
    const key = fold(query);
    if (seen.has(key)) continue;
    seen.add(key);
    queries.push({
      index: queries.length,
      query,
      uf: slot.uf,
      city: slot.city,
      status: 'pending',
      results: 0,
      added: 0,
    });
    if (queries.length >= limit) break;
  }
  return queries;
}

/**
 * Plano depois de uma mudança (Parte 6.3): o que já rodou fica (com os resultados); as consultas
 * pendentes são refeitas na ordem nova, sem repetir uma já feita. Índices continuam únicos.
 */
export function replanResearch(
  current: readonly ResearchQuery[],
  criteria: ResearchCriteria,
  creditCap: number,
): ResearchQuery[] {
  const kept = current.filter((query) => query.status !== 'pending');
  const used = new Set(kept.map((query) => fold(query.query)));
  const allowed = criteria.ufs.length > 0 ? new Set<UF>(criteria.ufs) : null;
  const room = Math.max(0, Math.min(MAX_PLANNED_QUERIES, creditCap) - kept.length);
  let nextIndex = current.reduce((max, query) => Math.max(max, query.index), -1) + 1;
  const fresh: ResearchQuery[] = [];
  for (const planned of planResearch(criteria, MAX_PLANNED_QUERIES)) {
    if (fresh.length >= room) break;
    if (used.has(fold(planned.query))) continue;
    if (allowed && planned.uf && !allowed.has(planned.uf)) continue;
    used.add(fold(planned.query));
    fresh.push({ ...planned, index: nextIndex });
    nextIndex += 1;
  }
  return [...kept, ...fresh];
}

/** Próximo lote: as primeiras consultas pendentes, na ordem do plano. */
export function nextBatch(queries: readonly ResearchQuery[], size: number): ResearchQuery[] {
  return queries.filter((query) => query.status === 'pending').slice(0, Math.max(0, size));
}
