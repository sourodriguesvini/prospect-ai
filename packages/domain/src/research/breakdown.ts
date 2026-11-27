import {
  RESEARCH_AUDIENCE_LABELS,
  RESEARCH_SEGMENT_LABELS,
  type ResearchAudienceRole,
  type ResearchEntityKind,
  type ResearchLocationBasis,
  type ResearchSegment,
  type UF,
} from '@prospector/contracts';
import { regionOf, type UfInfo } from './regions';

/**
 * Como os achados da pesquisa extensa se distribuem (diretriz 2026-11-26, Parte 8, Caso 2):
 * quantidade real, distribuição por região e estado, segmentação e papel para o perfil. Conta só o
 * que está gravado; quem pediu opt-out fica fora. Nenhuma contagem é estimada.
 */

export type ResearchRegion = UfInfo['region'];
const REGIONS: readonly ResearchRegion[] = ['Norte', 'Nordeste', 'Centro-Oeste', 'Sudeste', 'Sul'];

export interface BreakdownItem {
  readonly kind: ResearchEntityKind;
  readonly uf: UF | null;
  readonly segment: ResearchSegment;
  readonly audienceRole: ResearchAudienceRole;
  readonly locationBasis: ResearchLocationBasis;
  readonly optedOut: boolean;
}

export interface RegionCount {
  /** null = sem estado conferido. */
  readonly region: ResearchRegion | null;
  readonly label: string;
  readonly count: number;
  /** Estados da região, do que tem mais achados ao que tem menos. */
  readonly ufs: ReadonlyArray<{ readonly uf: UF; readonly count: number }>;
}

export interface ResearchBreakdown {
  readonly total: number;
  readonly people: number;
  readonly organizations: number;
  readonly regions: readonly RegionCount[];
  /** Achados cujo estado veio só da região da busca (o trecho não diz): conferir. */
  readonly locationFromQueryOnly: number;
  readonly segments: ReadonlyArray<{
    readonly segment: ResearchSegment;
    readonly label: string;
    readonly count: number;
  }>;
  readonly roles: ReadonlyArray<{
    readonly role: ResearchAudienceRole;
    readonly label: string;
    readonly count: number;
  }>;
}

function counted<K extends string>(keys: readonly K[]): Map<K, number> {
  const map = new Map<K, number>();
  for (const key of keys) map.set(key, (map.get(key) ?? 0) + 1);
  return map;
}

function byCount<T extends { count: number }>(a: T, b: T): number {
  return b.count - a.count;
}

export function researchBreakdown(all: readonly BreakdownItem[]): ResearchBreakdown {
  const items = all.filter((item) => !item.optedOut);
  const regions: RegionCount[] = [];
  for (const region of [...REGIONS, null] as const) {
    const inRegion = items.filter((item) => regionOf(item.uf) === region);
    if (inRegion.length === 0) continue;
    const ufs = [...counted(inRegion.flatMap((item) => (item.uf ? [item.uf] : [])))]
      .map(([uf, count]) => ({ uf, count }))
      .sort((a, b) => byCount(a, b) || a.uf.localeCompare(b.uf));
    regions.push({
      region,
      label: region ?? 'Sem estado conferido',
      count: inRegion.length,
      ufs,
    });
  }
  const segments = [...counted(items.map((item) => item.segment))]
    .map(([segment, count]) => ({ segment, label: RESEARCH_SEGMENT_LABELS[segment], count }))
    .sort(byCount);
  const roles = [...counted(items.map((item) => item.audienceRole))]
    .map(([role, count]) => ({ role, label: RESEARCH_AUDIENCE_LABELS[role], count }))
    .sort(byCount);
  return {
    total: items.length,
    people: items.filter((item) => item.kind === 'person').length,
    organizations: items.filter((item) => item.kind === 'organization').length,
    // Regiões com achado na ordem fixa (Norte → Sul) e "sem estado" por último.
    regions,
    locationFromQueryOnly: items.filter((item) => item.locationBasis === 'query').length,
    segments,
    roles,
  };
}

/**
 * Regiões do Brasil que a pesquisa não alcançou (para a tela dizer onde não achou nada). Com
 * estados no pedido (`scopeUfs`), só as regiões deles: numa pesquisa "só no Paraná", o Norte não
 * entra como lugar sem achado.
 */
export function regionsWithout(
  breakdown: ResearchBreakdown,
  scopeUfs: readonly UF[] = [],
): ResearchRegion[] {
  const found = new Set(breakdown.regions.map((item) => item.region));
  const scoped = new Set(scopeUfs.map((uf) => regionOf(uf)).filter(Boolean));
  return REGIONS.filter(
    (region) => !found.has(region) && (scoped.size === 0 || scoped.has(region)),
  );
}
