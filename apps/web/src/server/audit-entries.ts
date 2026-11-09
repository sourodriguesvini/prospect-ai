import 'server-only';
import { ERROR_MESSAGES, isAppError } from '@prospector/application';
import type { AuditLogEntry } from '@prospector/contracts';
import { getServices } from './container';
import { userContext } from './context';

export type AuditLoad =
  { kind: 'ok'; entries: AuditLogEntry[] } | { kind: 'unavailable'; message: string };

/**
 * Entradas recentes da auditoria. Banco não configurado, fora do ar ou sem migrações vira
 * aviso na tela; qualquer outra falha sobe para o error.tsx.
 */
export async function loadRecentAudit(limit?: number): Promise<AuditLoad> {
  const { audit } = getServices();
  if (!audit) return { kind: 'unavailable', message: ERROR_MESSAGES.database_not_configured };
  try {
    return { kind: 'ok', entries: await audit.listRecent(userContext(), limit) };
  } catch (error) {
    if (isAppError(error) && error.code === 'unavailable') {
      return { kind: 'unavailable', message: error.message };
    }
    throw error;
  }
}
