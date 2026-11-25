import {
  IntelligencePeriod,
  TAVILY_FREE_MONTHLY_CREDITS,
  type AiUsageView,
  type IntelligenceOverview,
  type SearchUsageView,
} from '@prospector/contracts';
import { buildFunnel, FUNNEL_MIN_SAMPLE } from '@prospector/domain';
import {
  AGENCY_TIME_ZONE,
  calendarDate,
  calendarDayBounds,
  systemClock,
  type Clock,
} from '../clock';
import type { RequestContext } from '../context';
import type { AiTelemetryRepository } from '../ports/copilot-repository';
import type { IntelligenceRepository } from '../ports/monitoring';
import type { WebResearchService } from './web-research-service';

/**
 * Inteligência (D16 e F13, primeira fatia; ADR-0017): funil com tamanho de amostra e consumo do
 * mês civil no fuso da agência (IA local, créditos da Tavily e gasto em dinheiro). Só leitura.
 * O funil é a parte principal: se ele falhar, o erro sobe. Consumo e gasto são partes: falha numa
 * delas vira `null` e a tela diz que a leitura não veio, sem esconder o resto.
 */
export interface IntelligenceService {
  overview(ctx: RequestContext, options?: { period?: unknown }): Promise<IntelligenceOverview>;
}

export interface IntelligenceServiceDeps {
  repo: IntelligenceRepository;
  telemetry: Pick<AiTelemetryRepository, 'usageSince'>;
  /** null = pesquisa na internet indisponível nesta instalação. */
  research: Pick<WebResearchService, 'status'> | null;
  clock?: Clock;
  timeZone?: string;
}

/** Início do mês civil de `at` no fuso indicado. */
export function calendarMonthStart(at: Date, timeZone: string = AGENCY_TIME_ZONE): Date {
  const [year, month] = calendarDate(at, timeZone).split('-').map(Number) as [number, number];
  // Meio-dia UTC do dia 1 cai no próprio dia 1 em qualquer fuso de -11 h a +11 h.
  return calendarDayBounds(new Date(Date.UTC(year, month - 1, 1, 12)), timeZone).start;
}

async function settle<T>(work: () => Promise<T>): Promise<T | null> {
  try {
    return await work();
  } catch {
    return null;
  }
}

export function createIntelligenceService(deps: IntelligenceServiceDeps): IntelligenceService {
  const clock = deps.clock ?? systemClock;
  const timeZone = deps.timeZone ?? AGENCY_TIME_ZONE;

  async function searchPart(ctx: RequestContext): Promise<IntelligenceOverview['search']> {
    if (!deps.research) return { state: 'disabled', usage: null };
    const status = await settle(() => deps.research!.status(ctx));
    if (!status) return { state: 'enabled', usage: null };
    const usage: SearchUsageView | null = status.usage
      ? {
          period: status.usage.period,
          creditsUsed: status.usage.creditsUsed,
          creditsBudget: status.usage.creditsBudget,
          creditsRemaining: status.usage.creditsRemaining,
          freeQuota: TAVILY_FREE_MONTHLY_CREDITS,
        }
      : null;
    return { state: status.search, usage };
  }

  return {
    async overview(ctx, options = {}) {
      const parsed = IntelligencePeriod.safeParse(options.period);
      const period = parsed.success ? parsed.data : 'month';
      const now = clock.now();
      const monthStart = calendarMonthStart(now, timeZone).toISOString();
      const since = period === 'month' ? monthStart : null;

      const [tallies, ai, search, money] = await Promise.all([
        deps.repo.funnel(since),
        settle(() => deps.telemetry.usageSince(new Date(monthStart))),
        searchPart(ctx),
        settle(() => deps.repo.moneySpent(monthStart)),
      ]);
      const aiView: AiUsageView | null = ai
        ? {
            generations: ai.generations,
            failed: ai.failed,
            cancelled: ai.cancelled,
            outputTokens: ai.outputTokens,
            totalMs: ai.totalMs,
            byModel: [...ai.byModel]
              .sort((a, b) => b.generations - a.generations || a.model.localeCompare(b.model))
              .slice(0, 50),
            toolCalls: ai.toolCalls,
            toolErrors: ai.toolErrors,
            capped: ai.capped,
          }
        : null;

      return {
        period,
        since,
        monthStart,
        generatedAt: now.toISOString(),
        funnel: buildFunnel(tallies),
        minSample: FUNNEL_MIN_SAMPLE,
        ai: aiView,
        search,
        money: money
          ? { usdMicros: Math.max(0, Math.round(money.usdMicros)), capped: money.capped }
          : null,
      };
    },
  };
}
