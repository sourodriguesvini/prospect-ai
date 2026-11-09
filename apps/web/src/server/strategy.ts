import 'server-only';
import {
  ERROR_MESSAGES,
  isAppError,
  type RequestContext,
  type StrategyService,
} from '@prospector/application';
import { revalidatePath } from 'next/cache';
import { notFound, redirect, unstable_rethrow } from 'next/navigation';
import type { FormValues } from '@/lib/form-data';
import type { FormState } from '@/lib/form-state';
import { getServices } from './container';
import type { StorageMode } from './env';
import { userContext } from './context';

export type StrategyLoad<T> =
  { kind: 'ok'; data: T; storage: StorageMode } | { kind: 'unavailable'; message: string };

/**
 * Leitura da estratégia para as telas. Banco não configurado ou fora do ar vira aviso na tela;
 * id inexistente vira 404; qualquer outra falha sobe para o error.tsx.
 */
export async function loadStrategy<T>(
  read: (strategy: StrategyService, ctx: RequestContext) => Promise<T>,
): Promise<StrategyLoad<T>> {
  const { strategy, storage } = getServices();
  if (!strategy) return { kind: 'unavailable', message: ERROR_MESSAGES.database_not_configured };
  try {
    return { kind: 'ok', data: await read(strategy, userContext()), storage };
  } catch (error) {
    if (isAppError(error)) {
      if (error.code === 'unavailable') return { kind: 'unavailable', message: error.message };
      if (error.code === 'not_found') notFound();
    }
    throw error;
  }
}

/** Resultado de uma escrita: caminho para redirecionar, mensagem para mostrar, ou nada ("Salvo."). */
export type ActionOutcome = string | { message: string; unchanged?: boolean } | void;

/** Salvar sem mudanças não cria versão: a tela diz isso em vez de "Salvo.". */
export const NOTHING_CHANGED = {
  message: 'Nenhuma alteração: a versão atual continua valendo e nenhuma nova foi criada.',
  unchanged: true,
} as const;

/**
 * Executa uma Server Action da estratégia: erros de validação, conflito e indisponibilidade
 * voltam para o formulário (com o que foi digitado); sucesso revalida as telas de configuração e,
 * se a ação devolver um caminho, redireciona para ele.
 */
export async function runStrategyAction(
  values: FormValues,
  write: (strategy: StrategyService, ctx: RequestContext) => Promise<ActionOutcome>,
): Promise<FormState> {
  const { strategy } = getServices();
  if (!strategy) {
    return { status: 'error', message: ERROR_MESSAGES.database_not_configured, values };
  }
  let outcome: ActionOutcome;
  try {
    outcome = await write(strategy, userContext());
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
  revalidatePath('/configuracoes', 'layout');
  revalidatePath('/abordagens');
  if (typeof outcome === 'string') redirect(outcome);
  return {
    status: outcome?.unchanged ? 'unchanged' : 'saved',
    message: outcome ? outcome.message : 'Salvo.',
    at: Date.now(),
  };
}
