import type { DatabaseHealth } from '@prospector/application';
import type { SupabaseClient } from '@supabase/supabase-js';
import { isMissingRelation } from './sql-errors';

const DEFAULT_TIMEOUT_MS = 3000;

/**
 * Lê uma linha de `audit_log` com tempo limite: confirma rede, credencial e migrações de uma
 * vez, sem travar a página quando o banco não responde.
 */
export function createSupabaseDatabaseHealth(
  client: SupabaseClient,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): DatabaseHealth {
  return {
    async check() {
      const { error } = await client
        .from('audit_log')
        .select('id')
        .limit(1)
        .abortSignal(AbortSignal.timeout(timeoutMs));
      if (!error) return 'ok';
      return isMissingRelation(error) ? 'schema_missing' : 'unreachable';
    },
  };
}
