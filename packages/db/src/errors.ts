import {
  AppError,
  ERROR_MESSAGES,
  type AppErrorCode,
  type ErrorReason,
} from '@prospector/application';
import { isMissingRelation } from './sql-errors';

/** Chaves levantadas por funções SQL (`raise exception '<chave>'`) → código de erro da aplicação. */
const REASON_TO_CODE: Partial<Record<ErrorReason, AppErrorCode>> = {
  invalid_input: 'validation',
  not_found: 'not_found',
  lia_decision_locked: 'conflict',
  lia_not_latest: 'conflict',
  review_date_out_of_range: 'validation',
};

interface DbErrorLike {
  message?: string | null;
  code?: string | null;
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
  if (isMissingRelation(error)) {
    return new AppError('unavailable', 'database_schema_missing', { cause: error });
  }
  switch (error.code ?? '') {
    // Sem código: falha de rede, tempo esgotado ou chave recusada pelo gateway.
    case '':
      return new AppError('unavailable', 'database_unreachable', { cause: error });
    case '23514':
    case '22023':
    case '22P02':
      return new AppError('validation', 'invalid_input', { cause: error });
    // Linha não encontrada, ou chave estrangeira cujo pai (oferta, ICP) não existe.
    case 'PGRST116':
    case '23503':
      return new AppError('not_found', 'not_found', { cause: error });
    // Unicidade de (pai, versão): duas versões salvas ao mesmo tempo.
    case '23505':
      return new AppError('conflict', 'concurrent_change', { cause: error });
    default:
      return new AppError('unexpected', 'unexpected', { cause: error });
  }
}
