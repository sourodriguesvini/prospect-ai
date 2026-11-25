import type { DatabaseHealth } from '@prospector/application';
import type { SupabaseClient } from '@supabase/supabase-js';
import { isMissingRelation } from './sql-errors';

const DEFAULT_TIMEOUT_MS = 3000;
const DEFAULT_RETRY_DELAY_MS = 1500;

/** O que a checagem lembra entre chamadas: se as tabelas já responderam alguma vez. */
export interface DatabaseHealthMemory {
  seenTables: boolean;
}

/**
 * Lê uma linha de `audit_log` com tempo limite: confirma rede, credencial e migrações de uma
 * vez, sem travar a página quando o banco não responde.
 *
 * "Tabela não existe" também aparece por alguns segundos quando o Supabase reinicia: o PostgREST
 * responde antes de carregar o esquema (KI-155). Por isso, antes de dizer "migrações pendentes" a
 * leitura é repetida uma vez, e se as tabelas já foram vistas o banco está subindo
 * ("inacessível"). `memory` guarda isso: o app passa um objeto que vive no processo, porque os
 * serviços são recriados a cada requisição.
 */
export function createSupabaseDatabaseHealth(
  client: SupabaseClient,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  retryDelayMs = DEFAULT_RETRY_DELAY_MS,
  memory: DatabaseHealthMemory = { seenTables: false },
): DatabaseHealth {
  const read = async () => {
    const { error } = await client
      .from('audit_log')
      .select('id')
      .limit(1)
      .abortSignal(AbortSignal.timeout(timeoutMs));
    if (!error) return 'ok' as const;
    return isMissingRelation(error) ? ('schema_missing' as const) : ('unreachable' as const);
  };
  return {
    async check() {
      let status = await read();
      if (status === 'schema_missing') {
        if (memory.seenTables) return 'unreachable';
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
        status = await read();
      }
      if (status === 'ok') memory.seenTables = true;
      return status;
    },
  };
}
