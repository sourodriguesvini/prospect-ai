import {
  AppError,
  type FunnelTallies,
  type IntelligenceRepository,
  type InvestigationChangeRow,
  type MonitoringRepository,
} from '@prospector/application';
import { InvestigationChange } from '@prospector/contracts';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { toAppError } from './errors';

/**
 * Leituras do Monitoramento e da Inteligência via PostgREST (ADR-0017). Só `select`: nada é
 * gravado nem auditado, e nenhuma tabela nova foi criada (as consultas usam as tabelas da
 * Descoberta, das investigações, do Relacionamento e da telemetria, já com RLS fechado e lidas
 * só pelo servidor com a secret key).
 */

interface Result {
  data: unknown;
  error: { message?: string | null; code?: string | null } | null;
  count?: number | null;
}

async function rows(query: PromiseLike<Result>): Promise<unknown[]> {
  const { data, error } = await query;
  if (error) throw toAppError(error);
  return (data as unknown[] | null) ?? [];
}

async function count(query: PromiseLike<Result>): Promise<number> {
  const { error, count: total } = await query;
  if (error) throw toAppError(error);
  // Sem contagem na resposta, zero seria inventado: melhor falhar e a tela dizer que não leu.
  if (total === null || total === undefined) {
    throw new AppError('unexpected', 'unexpected');
  }
  return total;
}

/**
 * Teto de linhas por leitura: o PostgREST do Supabase devolve no máximo 1.000 por padrão
 * (`max_rows`). Chegar nele marca a etapa como `capped` (o número real pode ser maior, KI-183).
 */
export const MONITORING_ROW_LIMIT = 1000;
/** Investigações lidas para achar as que têm mudança (a maioria pode não ter nenhuma). */
const RECENT_SCAN = 200;

/** timestamptz do PostgREST (`+00:00`, até microssegundos) → ISO 8601 em UTC. */
const Timestamp = z.string().transform((value, ctx) => {
  const time = Date.parse(value);
  if (Number.isNaN(time)) {
    ctx.addIssue({ code: 'custom', message: 'Data inválida.' });
    return z.NEVER;
  }
  return new Date(time).toISOString();
});

const Numeric = z.union([
  z.number(),
  z
    .string()
    .regex(/^-?\d+(\.\d+)?$/)
    .transform(Number),
]);

const ChangeRow = z.object({
  id: z.string(),
  company_id: z.string(),
  finished_at: Timestamp,
  is_demo: z.boolean(),
  changes: z.array(InvestigationChange).max(30),
  // Embutido pela chave estrangeira (muitos-para-um): um objeto, ou lista com um item.
  companies: z.union([
    z.object({ display_name: z.string(), is_demo: z.boolean(), lifecycle: z.string() }),
    z
      .array(z.object({ display_name: z.string(), is_demo: z.boolean(), lifecycle: z.string() }))
      .max(1),
  ]),
});

const CompanyStageRow = z.object({ company_id: z.string(), is_demo: z.boolean() });

type StageTally = FunnelTallies[keyof FunnelTallies];

type StageFilter =
  | { kind: 'eq'; column: string; value: string }
  | { kind: 'in'; column: string; values: readonly string[] };

/** Empresas distintas (e quantas são demonstração) a partir das linhas de uma etapa. */
function distinctTally(data: readonly z.infer<typeof CompanyStageRow>[]): StageTally {
  const companies = new Map<string, boolean>();
  for (const row of data) {
    companies.set(row.company_id, (companies.get(row.company_id) ?? false) || row.is_demo);
  }
  let demo = 0;
  for (const isDemo of companies.values()) if (isDemo) demo += 1;
  return { count: companies.size, demo, capped: data.length >= MONITORING_ROW_LIMIT };
}

export function createSupabaseMonitoringRepository(client: SupabaseClient): MonitoringRepository {
  return {
    async recentChanges(limit) {
      const data = await rows(
        client
          .from('company_investigations')
          .select(
            'id, company_id, finished_at, is_demo, changes, companies(display_name, is_demo, lifecycle)',
          )
          .in('status', ['succeeded', 'partial'])
          .not('previous_id', 'is', null)
          .not('finished_at', 'is', null)
          .order('finished_at', { ascending: false })
          .order('id', { ascending: true })
          .limit(RECENT_SCAN),
      );
      const result: InvestigationChangeRow[] = [];
      let kept = 0;
      for (const raw of z.array(ChangeRow).parse(data)) {
        if (raw.changes.length === 0) continue;
        const company = Array.isArray(raw.companies) ? raw.companies[0] : raw.companies;
        if (!company) continue;
        result.push({
          investigationId: raw.id,
          companyId: raw.company_id,
          companyName: company.display_name,
          isDemo: raw.is_demo || company.is_demo,
          companyArchived: company.lifecycle === 'archived',
          finishedAt: raw.finished_at,
          changes: raw.changes,
        });
        // As arquivadas não ocupam vaga: o serviço as tira do feed.
        if (company.lifecycle !== 'archived') kept += 1;
        if (kept >= Math.max(0, limit)) break;
      }
      return result;
    },
  };
}

export function createSupabaseIntelligenceRepository(
  client: SupabaseClient,
): IntelligenceRepository {
  /** Contagem exata de linhas (cada linha já é uma empresa distinta) e quantas são DEMO. */
  async function headCount(table: string, column: string, since: string | null) {
    const base = (demoOnly: boolean) => {
      let query = client.from(table).select('id', { count: 'exact', head: true });
      if (since !== null) query = query.gte(column, since);
      if (demoOnly) query = query.eq('is_demo', true);
      return query;
    };
    const [total, demo] = await Promise.all([count(base(false)), count(base(true))]);
    return { count: total, demo, capped: false } satisfies StageTally;
  }

  /**
   * Empresas distintas de uma tabela com `company_id` (várias linhas por empresa), pela data da
   * própria etapa (`column`), com filtros simples.
   */
  async function distinctCompanies(
    table: string,
    column: string,
    since: string | null,
    filters: readonly StageFilter[],
  ): Promise<StageTally> {
    let query = client.from(table).select('company_id, is_demo').not(column, 'is', null);
    for (const filter of filters) {
      query =
        filter.kind === 'eq'
          ? query.eq(filter.column, filter.value)
          : query.in(filter.column, [...filter.values]);
    }
    if (since !== null) query = query.gte(column, since);
    const data = await rows(query.order(column, { ascending: false }).limit(MONITORING_ROW_LIMIT));
    return distinctTally(z.array(CompanyStageRow).parse(data));
  }

  async function costSum(table: string, column: string, since: string) {
    const data = z
      .array(z.object({ cost_usd: Numeric }))
      .parse(
        await rows(
          client
            .from(table)
            .select('cost_usd')
            .gte(column, since)
            .gt('cost_usd', 0)
            .limit(MONITORING_ROW_LIMIT),
        ),
      );
    return {
      usdMicros: data.reduce((sum, row) => sum + Math.round(row.cost_usd * 1_000_000), 0),
      capped: data.length >= MONITORING_ROW_LIMIT,
    };
  }

  return {
    async funnel(since) {
      const [found, saved, investigated, approached, contacted, replied, won] = await Promise.all([
        headCount('discovery_prospects', 'first_seen_at', since),
        headCount('companies', 'created_at', since),
        distinctCompanies('company_investigations', 'finished_at', since, [
          { kind: 'in', column: 'status', values: ['succeeded', 'partial'] },
        ]),
        distinctCompanies('approach_plans', 'created_at', since, []),
        distinctCompanies('interactions', 'occurred_at', since, [
          { kind: 'eq', column: 'direction', value: 'outbound' },
        ]),
        distinctCompanies('interactions', 'occurred_at', since, [
          { kind: 'eq', column: 'direction', value: 'inbound' },
        ]),
        distinctCompanies('opportunities', 'closed_at', since, [
          { kind: 'eq', column: 'stage', value: 'won' },
        ]),
      ]);
      return {
        found,
        saved,
        investigated,
        approached,
        contacted,
        replied,
        won,
      } satisfies FunnelTallies;
    },

    async moneySpent(since) {
      // Só as linhas com custo: a IA local grava zero (ADR-0008) e a Tavily gratuita também.
      const [llm, providers] = await Promise.all([
        costSum('llm_calls', 'created_at', since),
        costSum('provider_usage', 'occurred_at', since),
      ]);
      return {
        usdMicros: llm.usdMicros + providers.usdMicros,
        capped: llm.capped || providers.capped,
      };
    },
  };
}
