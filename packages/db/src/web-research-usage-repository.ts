import type { WebResearchUsageStore } from '@prospector/application';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { toAppError } from './errors';

interface Result {
  data: unknown;
  error: { message?: string | null; code?: string | null } | null;
}

async function run(query: PromiseLike<Result>): Promise<unknown> {
  const { data, error } = await query;
  if (error) throw toAppError(error);
  return data;
}

/** integer chega como número; por segurança aceita texto numérico. */
const UnitsRow = z.object({
  units_used: z.union([z.number(), z.string().regex(/^\d+$/).transform(Number)]),
});

/**
 * Consumo de créditos da pesquisa na internet (migração 20261110190000, ADR-0012). Só inclusão:
 * o banco recusa alteração e exclusão. Nada da consulta é gravado (minimização, LGPD).
 */
export function createSupabaseWebResearchUsage(client: SupabaseClient): WebResearchUsageStore {
  return {
    async creditsUsed(provider, period) {
      const data = await run(
        client
          .from('provider_usage_monthly')
          .select('units_used')
          .eq('provider', provider)
          .eq('period', period)
          .maybeSingle(),
      );
      return data === null ? 0 : UnitsRow.parse(data).units_used;
    },

    async record(entry) {
      await run(
        client.from('provider_usage').insert({
          provider: entry.provider,
          operation: entry.operation,
          units: entry.units,
          period: entry.period,
          outcome: entry.outcome,
          trace_id: entry.traceId,
          occurred_at: entry.occurredAt,
        }),
      );
    },
  };
}
