import 'server-only';
import {
  ERROR_MESSAGES,
  isAppError,
  type DiscoveryService,
  type RequestContext,
} from '@prospector/application';
import { revalidatePath } from 'next/cache';
import { notFound, redirect, unstable_rethrow } from 'next/navigation';
import { cache } from 'react';
import { companyRoutes } from '@/lib/company-routes';
import { discoveryRoutes } from '@/lib/discovery-routes';
import type { FormValues } from '@/lib/form-data';
import type { FormState } from '@/lib/form-state';
import { getServices, pokeDiscoveryWorker } from './container';
import type { StorageMode } from './env';
import { userContext } from './context';

export type DiscoveryLoad<T> =
  { kind: 'ok'; data: T; storage: StorageMode } | { kind: 'unavailable'; message: string };

const DISCOVERY_OFF =
  'A Descoberta está desligada nesta instalação (PROSPECTOR_DISCOVERY=off em apps/web/.env.local).';

function discoveryOrMessage(): { discovery: DiscoveryService; storage: StorageMode } | string {
  const { discovery, companies, storage } = getServices();
  if (discovery) return { discovery, storage };
  return companies ? DISCOVERY_OFF : ERROR_MESSAGES.database_not_configured;
}

/**
 * Leitura da Descoberta para as telas. Banco não configurado, sem as tabelas da Descoberta ou
 * fora do ar vira aviso na tela; id inexistente vira 404; outras falhas sobem para o error.tsx.
 */
export async function loadDiscovery<T>(
  read: (discovery: DiscoveryService, ctx: RequestContext) => Promise<T>,
): Promise<DiscoveryLoad<T>> {
  const found = discoveryOrMessage();
  if (typeof found === 'string') return { kind: 'unavailable', message: found };
  try {
    return { kind: 'ok', data: await read(found.discovery, userContext()), storage: found.storage };
  } catch (error) {
    if (isAppError(error)) {
      if (error.code === 'unavailable') return { kind: 'unavailable', message: error.message };
      if (error.code === 'not_found') notFound();
    }
    throw error;
  }
}

/** Detalhe da pesquisa memorizado por pedido (página e título leem uma vez só). */
export const discoveryRunDetail = cache((discovery: DiscoveryService, id: string) =>
  discovery.getRun(userContext(), id),
);

export const discoveryProspectDetail = cache((discovery: DiscoveryService, id: string) =>
  discovery.getProspect(userContext(), id),
);

/** Título da aba a partir de uma leitura; o genérico se ela falhar (a página mostra o erro). */
export async function discoveryTitle(
  read: (discovery: DiscoveryService) => Promise<string>,
  fallback: string,
): Promise<string> {
  const { discovery } = getServices();
  if (!discovery) return fallback;
  try {
    return (await read(discovery)).trim().slice(0, 80) || fallback;
  } catch (error) {
    unstable_rethrow(error);
    return fallback;
  }
}

/** Resultado de uma escrita: caminho para redirecionar ou nada ("Salvo."). */
export type DiscoveryOutcome = string | void;

/**
 * Executa uma Server Action da Descoberta: validação, conflito e indisponibilidade voltam para o
 * formulário com o que foi digitado; sucesso acorda o trabalhador da fila (pesquisa nova não
 * espera o intervalo ocioso), revalida as telas e redireciona, se houver caminho.
 */
export async function runDiscoveryAction(
  values: FormValues,
  write: (discovery: DiscoveryService, ctx: RequestContext) => Promise<DiscoveryOutcome>,
): Promise<FormState> {
  const found = discoveryOrMessage();
  if (typeof found === 'string') return { status: 'error', message: found, values };
  let outcome: DiscoveryOutcome;
  try {
    outcome = await write(found.discovery, userContext());
  } catch (error) {
    unstable_rethrow(error);
    if (isAppError(error) && error.code !== 'unexpected') {
      return {
        status: 'error',
        message: error.message,
        ...(error.fieldErrors ? { fieldErrors: error.fieldErrors } : {}),
        values,
        at: Date.now(),
      };
    }
    throw error;
  }
  pokeDiscoveryWorker();
  revalidatePath(discoveryRoutes.home, 'layout');
  revalidatePath(companyRoutes.list, 'layout');
  revalidatePath('/');
  if (typeof outcome === 'string') redirect(outcome);
  return { status: 'saved', message: 'Salvo.', at: Date.now() };
}
