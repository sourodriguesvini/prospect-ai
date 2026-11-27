import type {
  CompanyChangeItem,
  DiscoveryNoveltyItem,
  InvestigationChange,
  MonitoringFeedFilter,
  MonitoringFeedItem,
} from '@prospector/contracts';

/**
 * Feed único de novidades do Monitoramento (ADR-0017): mudanças entre duas investigações da mesma
 * empresa e empresas novas achadas pelas buscas recorrentes da Descoberta. Os textos das mudanças
 * já vêm do sistema (`detectChanges`); aqui só se separa o que não é mudança (fora do ar nesta
 * coleta), se descarta o vazio e se ordena.
 */

export interface InvestigationChangeRecord {
  investigationId: string;
  companyId: string;
  companyName: string;
  isDemo: boolean;
  finishedAt: string;
  changes: readonly InvestigationChange[];
}

export interface MonitorNoveltyRecord {
  runId: string;
  monitorId: string;
  monitorName: string;
  finishedAt: string;
  newCompanies: number;
  isDemo: boolean;
}

export function changeItem(record: InvestigationChangeRecord): CompanyChangeItem | null {
  const changes = record.changes.filter((change) => change.kind !== 'temporarily_unavailable');
  const unavailable = record.changes.filter((change) => change.kind === 'temporarily_unavailable');
  if (changes.length === 0 && unavailable.length === 0) return null;
  return {
    kind: 'company_change',
    investigationId: record.investigationId,
    companyId: record.companyId,
    companyName: record.companyName,
    isDemo: record.isDemo,
    occurredAt: record.finishedAt,
    changes,
    unavailable,
  };
}

export function noveltyItem(record: MonitorNoveltyRecord): DiscoveryNoveltyItem | null {
  if (record.newCompanies < 1) return null;
  return {
    kind: 'discovery_novelty',
    runId: record.runId,
    monitorId: record.monitorId,
    monitorName: record.monitorName,
    occurredAt: record.finishedAt,
    newCompanies: record.newCompanies,
    isDemo: record.isDemo,
  };
}

function itemKey(item: MonitoringFeedItem): string {
  return item.kind === 'company_change' ? item.investigationId : item.runId;
}

/** Mais recentes primeiro; empate pelo id, para a ordem não pular entre leituras. */
export function buildMonitoringFeed(input: {
  changes: readonly InvestigationChangeRecord[];
  novelties: readonly MonitorNoveltyRecord[];
  limit: number;
}): MonitoringFeedItem[] {
  const items: MonitoringFeedItem[] = [
    ...input.changes.map(changeItem),
    ...input.novelties.map(noveltyItem),
  ].filter((item): item is MonitoringFeedItem => item !== null);
  items.sort(
    (a, b) => b.occurredAt.localeCompare(a.occurredAt) || itemKey(a).localeCompare(itemKey(b)),
  );
  return items.slice(0, Math.max(0, input.limit));
}

export function filterMonitoringFeed(
  items: readonly MonitoringFeedItem[],
  filter: MonitoringFeedFilter,
): MonitoringFeedItem[] {
  if (filter === 'companies') return items.filter((item) => item.kind === 'company_change');
  if (filter === 'discovery') return items.filter((item) => item.kind === 'discovery_novelty');
  return [...items];
}
