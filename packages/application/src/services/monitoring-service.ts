import {
  ACTIVE_INVESTIGATION_STATUSES,
  type CompanyInvestigationSummary,
  type DiscoveryMonitor,
  type MonitoringDiscoveryState,
  type MonitoringOverview,
  type WatchItem,
} from '@prospector/contracts';
import {
  buildMonitoringFeed,
  compareWatchItems,
  watchCadence,
  watchStatus,
  type MonitorNoveltyRecord,
} from '@prospector/domain';
import type { InvestigationChangeRow } from '../ports/monitoring';
import { systemClock, type Clock } from '../clock';
import type { RequestContext } from '../context';
import type { MonitoringRepository } from '../ports/monitoring';
import type { CompanyService } from './company-service';
import type { DiscoveryService } from './discovery-service';
import type { InvestigationService } from './investigation-service';

/**
 * Monitoramento de empresas já conhecidas (D15, ADR-0017). Monta a lista de acompanhamento a
 * partir das empresas e da última investigação de cada uma, e o feed único de novidades (mudanças
 * entre investigações e empresas novas das buscas recorrentes). Só leitura: investigar de novo é
 * o `InvestigationService.start`, sempre por clique da pessoa.
 */
export interface MonitoringService {
  overview(ctx: RequestContext): Promise<MonitoringOverview>;
}

export interface MonitoringServiceDeps {
  repo: MonitoringRepository;
  companies: Pick<CompanyService, 'list'>;
  investigations: Pick<InvestigationService, 'summaries'>;
  /** null = Descoberta desligada: o feed traz só as mudanças das empresas. */
  discovery: Pick<DiscoveryService, 'listMonitors' | 'listRuns'> | null;
  clock?: Clock;
}

/** Teto da leitura de empresas (o mesmo da lista de Empresas). */
export const MONITORING_COMPANY_LIMIT = 200;
export const MONITORING_FEED_LIMIT = 60;
/** Buscas recorrentes lidas e execuções por busca: o feed mostra as mais recentes. */
const MONITORS_LIMIT = 20;
const RUNS_PER_MONITOR = 10;

const MONITOR_STATUS_ORDER: Record<DiscoveryMonitor['status'], number> = {
  active: 0,
  paused: 1,
  archived: 2,
};

/**
 * Quais buscas recorrentes entram no teto: ativas e pausadas antes das arquivadas, e dentro de cada
 * grupo as que rodaram por último (as que nunca rodaram vão para o fim). Assim uma busca ativa
 * antiga não perde a vaga para arquivadas recentes.
 */
export function compareMonitorsForFeed(a: DiscoveryMonitor, b: DiscoveryMonitor): number {
  const byStatus = MONITOR_STATUS_ORDER[a.status] - MONITOR_STATUS_ORDER[b.status];
  if (byStatus !== 0) return byStatus;
  if (a.lastRunAt !== b.lastRunAt) {
    if (a.lastRunAt === null) return 1;
    if (b.lastRunAt === null) return -1;
    return b.lastRunAt.localeCompare(a.lastRunAt);
  }
  return a.id.localeCompare(b.id);
}

const FINISHED = new Set<CompanyInvestigationSummary['status']>(['succeeded', 'partial']);

/**
 * Data da última investigação concluída. A da própria investigação vale mais que
 * `companies.last_investigated_at`, que também muda quando o CNPJ é consultado ou vinculado; esta
 * só entra quando a última investigação ainda roda ou falhou (KI-180).
 */
function lastFinishedAt(
  summary: CompanyInvestigationSummary | undefined,
  fallback: string | null,
): string | null {
  if (summary && FINISHED.has(summary.status) && summary.finishedAt) return summary.finishedAt;
  return fallback;
}

export function createMonitoringService(deps: MonitoringServiceDeps): MonitoringService {
  const clock = deps.clock ?? systemClock;

  async function novelties(
    ctx: RequestContext,
  ): Promise<{ state: MonitoringDiscoveryState; records: MonitorNoveltyRecord[] }> {
    const discovery = deps.discovery;
    if (!discovery) return { state: 'off', records: [] };
    try {
      const monitors: DiscoveryMonitor[] = [
        ...(await discovery.listMonitors(ctx, { includeArchived: true })),
      ]
        .sort(compareMonitorsForFeed)
        .slice(0, MONITORS_LIMIT);
      const runs = await Promise.all(
        monitors.map((monitor) =>
          discovery.listRuns(ctx, { monitorId: monitor.id, limit: RUNS_PER_MONITOR }),
        ),
      );
      const records = monitors.flatMap((monitor, index) =>
        (runs[index] ?? [])
          .filter(
            (run) =>
              run.monitorId === monitor.id &&
              run.status === 'completed' &&
              run.progress.newProspects > 0,
          )
          .map((run) => ({
            runId: run.id,
            monitorId: monitor.id,
            monitorName: monitor.name,
            finishedAt: run.finishedAt ?? run.createdAt,
            newCompanies: run.progress.newProspects,
            isDemo: run.isDemo || monitor.isDemo,
          })),
      );
      return { state: 'included', records };
    } catch {
      // A Descoberta é uma parte do feed: se a leitura dela falhar, as mudanças das empresas
      // continuam e a tela avisa que as buscas recorrentes ficaram de fora desta vez.
      return { state: 'unavailable', records: [] };
    }
  }

  /** As mudanças são uma parte do feed: se a leitura falhar, a lista de acompanhamento continua. */
  async function recentChanges(): Promise<{
    state: MonitoringOverview['companyChanges'];
    rows: InvestigationChangeRow[];
  }> {
    try {
      // Um a mais que o teto: diz se há novidades fora da tela sem ler o resto.
      return {
        state: 'included',
        rows: await deps.repo.recentChanges(MONITORING_FEED_LIMIT + 1),
      };
    } catch {
      return { state: 'unavailable', rows: [] };
    }
  }

  return {
    async overview(ctx) {
      const now = clock.now();
      const companies = await deps.companies.list(ctx, {
        includeArchived: false,
        limit: MONITORING_COMPANY_LIMIT,
      });
      const [summaries, changes, found] = await Promise.all([
        companies.length > 0
          ? deps.investigations.summaries(
              ctx,
              companies.map((company) => company.id),
            )
          : Promise.resolve([]),
        recentChanges(),
        novelties(ctx),
      ]);
      const byCompany = new Map(summaries.map((summary) => [summary.companyId, summary]));

      const watchlist: WatchItem[] = [];
      let excludedDiscarded = 0;
      let notInvestigated = 0;
      for (const company of companies) {
        const summary = byCompany.get(company.id);
        const recommendation = summary?.recommendation ?? null;
        const lastInvestigatedAt = lastFinishedAt(summary, company.lastInvestigatedAt);
        if (!lastInvestigatedAt || !recommendation) {
          notInvestigated += 1;
          continue;
        }
        const cadence = watchCadence(recommendation);
        if (!cadence) {
          excludedDiscarded += 1;
          continue;
        }
        const running = summary ? ACTIVE_INVESTIGATION_STATUSES.includes(summary.status) : false;
        const status = watchStatus({
          lastInvestigatedAt,
          cadence,
          running,
          now,
        });
        watchlist.push({
          companyId: company.id,
          companyName: company.displayName,
          isDemo: company.isDemo,
          recommendation,
          priority: summary?.priority ?? null,
          cadence,
          lastInvestigatedAt,
          ...status,
        });
      }
      watchlist.sort(compareWatchItems);

      const candidates =
        changes.rows.filter((row) => !row.companyArchived).length + found.records.length;
      return {
        generatedAt: now.toISOString(),
        feed: buildMonitoringFeed({
          changes: changes.rows.filter((row) => !row.companyArchived),
          novelties: found.records,
          limit: MONITORING_FEED_LIMIT,
        }),
        watchlist,
        excludedDiscarded,
        notInvestigated,
        truncated: companies.length >= MONITORING_COMPANY_LIMIT,
        discovery: found.state,
        companyChanges: changes.state,
        feedTruncated: candidates > MONITORING_FEED_LIMIT,
      };
    },
  };
}
