import 'server-only';
import {
  ERROR_MESSAGES,
  isAppError,
  type CompanyService,
  type RequestContext,
} from '@prospector/application';
import { revalidatePath } from 'next/cache';
import { notFound, redirect, unstable_rethrow } from 'next/navigation';
import { cache } from 'react';
import type { FormValues } from '@/lib/form-data';
import type { FormState } from '@/lib/form-state';
import { companyRoutes } from '@/lib/company-routes';
import { getServices } from './container';
import type { StorageMode } from './env';
import { userContext } from './context';

export type CompaniesLoad<T> =
  { kind: 'ok'; data: T; storage: StorageMode } | { kind: 'unavailable'; message: string };

/**
 * Leitura de empresas para as telas (M2). Banco não configurado ou fora do ar vira aviso na tela;
 * id inexistente vira 404; qualquer outra falha sobe para o error.tsx.
 */
export async function loadCompanies<T>(
  read: (companies: CompanyService, ctx: RequestContext) => Promise<T>,
): Promise<CompaniesLoad<T>> {
  const { companies, storage } = getServices();
  if (!companies) return { kind: 'unavailable', message: ERROR_MESSAGES.database_not_configured };
  try {
    return { kind: 'ok', data: await read(companies, userContext()), storage };
  } catch (error) {
    if (isAppError(error)) {
      if (error.code === 'unavailable') return { kind: 'unavailable', message: error.message };
      if (error.code === 'not_found') notFound();
    }
    throw error;
  }
}

/** Dossiê memorizado por pedido: a página e o `generateMetadata` leem o banco uma vez só. */
export const companyDossier = cache((companies: CompanyService, id: string) =>
  companies.dossier(userContext(), id),
);

/** Título da aba: o nome da empresa, ou o genérico se a leitura falhar (a página mostra o erro). */
export async function companyTitle(id: string, fallback: string): Promise<string> {
  const { companies } = getServices();
  if (!companies) return fallback;
  try {
    return (await companyDossier(companies, id)).company.displayName.trim() || fallback;
  } catch (error) {
    unstable_rethrow(error);
    return fallback;
  }
}

/**
 * Resultado de uma escrita em empresas: caminho para redirecionar, erro para mostrar no
 * formulário (falha da consulta de CNPJ, que não é exceção) ou nada ("Salvo.").
 */
export type CompanyOutcome = string | { error: string } | void;

function renameFields(
  fieldErrors: Record<string, string[]>,
  names: Record<string, string>,
): Record<string, string[]> {
  return Object.fromEntries(
    Object.entries(fieldErrors).map(([key, messages]) => [names[key] ?? key, messages]),
  );
}

/**
 * Executa uma Server Action de empresas: validação, conflito e indisponibilidade voltam para o
 * formulário com o que foi digitado; sucesso revalida as telas e redireciona, se houver caminho.
 */
export async function runCompanyAction(
  values: FormValues,
  write: (companies: CompanyService, ctx: RequestContext) => Promise<CompanyOutcome>,
  /** Campo do contrato → campo do formulário, quando a tela tem dois formulários com o mesmo dado. */
  fieldNames: Record<string, string> = {},
): Promise<FormState> {
  const { companies } = getServices();
  if (!companies) {
    return { status: 'error', message: ERROR_MESSAGES.database_not_configured, values };
  }
  let outcome: CompanyOutcome;
  try {
    outcome = await write(companies, userContext());
  } catch (error) {
    unstable_rethrow(error);
    if (isAppError(error) && error.code !== 'unexpected') {
      return {
        status: 'error',
        message: error.message,
        ...(error.fieldErrors ? { fieldErrors: renameFields(error.fieldErrors, fieldNames) } : {}),
        values,
        at: Date.now(),
      };
    }
    throw error;
  }
  if (outcome && typeof outcome === 'object') {
    return { status: 'error', message: outcome.error, values, at: Date.now() };
  }
  revalidatePath(companyRoutes.list, 'layout');
  revalidatePath('/');
  if (typeof outcome === 'string') redirect(outcome);
  return { status: 'saved', message: 'Salvo.', at: Date.now() };
}
