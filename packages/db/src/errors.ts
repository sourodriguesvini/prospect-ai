import {
  AppError,
  ERROR_MESSAGES,
  type AppErrorCode,
  type ErrorReason,
} from '@prospector/application';

/** Chaves levantadas pelas funções SQL (`raise exception '<chave>'`) → código de erro da aplicação. */
const REASON_TO_CODE: Partial<Record<ErrorReason, AppErrorCode>> = {
  not_authenticated: 'unauthenticated',
  not_found: 'not_found',
  member_not_found: 'not_found',
  invitation_invalid: 'not_found',
  not_admin: 'forbidden',
  owner_only: 'forbidden',
  self_change: 'forbidden',
  last_owner: 'forbidden',
  invitation_expired: 'forbidden',
  invitation_email_mismatch: 'forbidden',
  email_not_confirmed: 'forbidden',
  slug_taken: 'conflict',
  already_member: 'conflict',
  invitation_pending: 'conflict',
  invalid_input: 'validation',
};

interface DbErrorLike {
  message?: string;
  code?: string;
}

function isKnownReason(value: string): value is ErrorReason {
  return Object.hasOwn(ERROR_MESSAGES, value);
}

/** Converte erro do PostgREST/Postgres em AppError sem vazar detalhes internos para a UI. */
export function toAppError(error: DbErrorLike): AppError {
  const message = error.message ?? '';
  if (isKnownReason(message)) {
    const code = REASON_TO_CODE[message];
    if (code) return new AppError(code, message, { cause: error });
  }
  switch (error.code) {
    case '42501':
      return new AppError('forbidden', 'forbidden', { cause: error });
    case '23514':
    case '22023':
    case '22P02':
      return new AppError('validation', 'invalid_input', { cause: error });
    case '23505':
      return new AppError('conflict', 'unexpected', { cause: error });
    case 'PGRST116':
      return new AppError('not_found', 'not_found', { cause: error });
    default:
      return new AppError('unexpected', 'unexpected', { cause: error });
  }
}
