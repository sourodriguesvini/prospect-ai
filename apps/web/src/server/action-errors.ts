import 'server-only';
import { ERROR_MESSAGES, isAppError, type ErrorReason } from '@prospector/application';
import type { ActionState } from '@/lib/action-state';

/** Motivos que pertencem a um campo do formulário: a mensagem aparece junto dele. */
const REASON_FIELD: Partial<Record<ErrorReason, string>> = {
  slug_taken: 'slug',
  invitation_pending: 'email',
};

function causeCode(error: unknown): string | undefined {
  if (!(error instanceof Error) || typeof error.cause !== 'object' || error.cause === null) {
    return undefined;
  }
  const code = (error.cause as { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}

/**
 * Converte qualquer falha de caso de uso em estado de formulário. Erros esperados viram a
 * mensagem em pt-BR do motivo; inesperados são registrados (só nome e código, sem dados
 * pessoais nem mensagens do banco) com traceId, que também é mostrado ao usuário.
 */
export function toErrorState(
  error: unknown,
  traceId: string,
): Extract<ActionState<never>, { status: 'error' }> {
  if (isAppError(error) && error.reason !== 'unexpected') {
    const field = REASON_FIELD[error.reason];
    const fieldErrors = field
      ? { ...error.fieldErrors, [field]: [error.message] }
      : error.fieldErrors;
    return fieldErrors
      ? { status: 'error', message: error.message, fieldErrors }
      : { status: 'error', message: error.message };
  }
  const name = error instanceof Error ? error.name : typeof error;
  console.error(
    JSON.stringify({
      level: 'error',
      event: 'action.unexpected',
      traceId,
      error: name,
      code: causeCode(error),
    }),
  );
  return { status: 'error', message: ERROR_MESSAGES.unexpected, traceId };
}
