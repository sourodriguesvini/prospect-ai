import { z } from 'zod';

export type AppErrorCode = 'validation' | 'not_found' | 'conflict' | 'unavailable' | 'unexpected';

/**
 * Chaves estáveis de motivo. O banco usa as mesmas chaves como mensagem das exceções
 * (`raise exception '<chave>'`), e o repositório as converte em AppError.
 */
export const ERROR_MESSAGES = {
  invalid_input: 'Revise os campos destacados.',
  not_found: 'Não encontrado.',
  database_not_configured:
    'O banco de dados ainda não foi configurado. Siga docs/runbooks/ambiente-local.md.',
  database_unreachable:
    'Não foi possível acessar o banco de dados. Verifique a conexão e as credenciais em apps/web/.env.local.',
  database_schema_missing:
    'O banco está acessível, mas as migrações não foram aplicadas. Siga docs/runbooks/ambiente-local.md.',
  unexpected: 'Algo deu errado. Tente novamente; se persistir, anote o código de rastreio.',
} as const;

export type ErrorReason = keyof typeof ERROR_MESSAGES;

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly reason: ErrorReason;
  readonly fieldErrors: Record<string, string[]> | undefined;

  constructor(
    code: AppErrorCode,
    reason: ErrorReason,
    options?: { fieldErrors?: Record<string, string[]>; cause?: unknown },
  ) {
    super(
      ERROR_MESSAGES[reason],
      options?.cause === undefined ? undefined : { cause: options.cause },
    );
    this.name = 'AppError';
    this.code = code;
    this.reason = reason;
    this.fieldErrors = options?.fieldErrors;
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

/** Valida a entrada com o contrato e converte falhas em AppError('validation'). */
export function parseInput<S extends z.ZodType>(schema: S, raw: unknown): z.output<S> {
  const result = schema.safeParse(raw);
  if (result.success) return result.data;
  const flat = z.flattenError(result.error);
  const fieldErrors: Record<string, string[]> = {};
  for (const [key, messages] of Object.entries(
    flat.fieldErrors as Record<string, string[] | undefined>,
  )) {
    if (messages && messages.length > 0) fieldErrors[key] = messages;
  }
  if (flat.formErrors.length > 0) fieldErrors._form = flat.formErrors;
  throw new AppError('validation', 'invalid_input', { fieldErrors });
}
