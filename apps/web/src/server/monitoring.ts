import 'server-only';
import { ERROR_MESSAGES, isAppError } from '@prospector/application';
import type {
  IntelligenceOverview,
  IntelligencePeriod,
  MonitoringOverview,
} from '@prospector/contracts';
import { cache } from 'react';
import { getServices } from './container';
import type { StorageMode } from './env';
import { userContext } from './context';

/**
 * Leituras do Monitoramento e da Inteligência para as telas (ADR-0017). Banco não configurado ou
 * fora do ar vira aviso na tela; qualquer outra falha sobe para o error.tsx.
 */
export type OverviewLoad<T> =
  { kind: 'ok'; data: T; storage: StorageMode } | { kind: 'unavailable'; message: string };

async function load<S, T>(
  service: S | null,
  storage: StorageMode,
  read: (service: S) => Promise<T>,
): Promise<OverviewLoad<T>> {
  if (!service) return { kind: 'unavailable', message: ERROR_MESSAGES.database_not_configured };
  try {
    return { kind: 'ok', data: await read(service), storage };
  } catch (error) {
    if (isAppError(error) && error.code === 'unavailable') {
      return { kind: 'unavailable', message: error.message };
    }
    throw error;
  }
}

export async function loadMonitoring(): Promise<OverviewLoad<MonitoringOverview>> {
  const { monitoring, storage } = getServices();
  return load(monitoring, storage, (service) => service.overview(userContext()));
}

/** Memorizada por pedido: a mesma tela pode ler o resumo mais de uma vez. */
export const loadIntelligence = cache(
  async (period: IntelligencePeriod): Promise<OverviewLoad<IntelligenceOverview>> => {
    const { intelligence, storage } = getServices();
    return load(intelligence, storage, (service) => service.overview(userContext(), { period }));
  },
);
