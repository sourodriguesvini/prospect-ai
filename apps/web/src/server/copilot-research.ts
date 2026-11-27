import 'server-only';
import {
  ERROR_MESSAGES,
  isAppError,
  type RequestContext,
  type ResearchService,
} from '@prospector/application';
import { notFound, unstable_rethrow } from 'next/navigation';
import { cache } from 'react';
import { getServices } from './container';
import { userContext } from './context';
import type { StorageMode } from './env';

export type ResearchLoad<T> =
  { kind: 'ok'; data: T; storage: StorageMode } | { kind: 'unavailable'; message: string };

/**
 * Leitura da pesquisa extensa do Copiloto para as telas. Sem banco ou sem as tabelas vira aviso na
 * tela; id inexistente vira 404; outras falhas sobem para o error.tsx.
 */
export async function loadResearch<T>(
  read: (research: ResearchService, ctx: RequestContext) => Promise<T>,
): Promise<ResearchLoad<T>> {
  const { copilotResearch, storage } = getServices();
  if (!copilotResearch) {
    return { kind: 'unavailable', message: ERROR_MESSAGES.database_not_configured };
  }
  try {
    return { kind: 'ok', data: await read(copilotResearch, userContext()), storage };
  } catch (error) {
    unstable_rethrow(error);
    if (isAppError(error)) {
      if (error.code === 'unavailable') return { kind: 'unavailable', message: error.message };
      if (error.code === 'not_found' || error.code === 'validation') notFound();
    }
    throw error;
  }
}

/** A pesquisa memorizada por pedido (página e título leem uma vez só). */
export const researchDetail = cache((service: ResearchService, id: string) =>
  service.get(userContext(), id),
);

/** Pesquisas da conversa aberta, para a coluna do Copiloto. Falha vira lista vazia. */
export async function threadResearch(threadId: string | null) {
  const { copilotResearch } = getServices();
  if (!copilotResearch || !threadId) return [];
  try {
    return await copilotResearch.listForThread(userContext(), threadId);
  } catch (error) {
    unstable_rethrow(error);
    console.warn('[pesquisa] pesquisas da conversa indisponíveis', error);
    return [];
  }
}
