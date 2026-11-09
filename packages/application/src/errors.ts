import { z } from 'zod';

export type AppErrorCode =
  'validation' | 'unauthenticated' | 'forbidden' | 'not_found' | 'conflict' | 'unexpected';

/**
 * Chaves estáveis de motivo. O banco usa as mesmas chaves como mensagem das exceções
 * (`raise exception 'last_owner'`), e o repositório as converte em AppError.
 */
export const ERROR_MESSAGES = {
  not_authenticated: 'Sua sessão expirou. Entre novamente.',
  invalid_input: 'Revise os campos destacados.',
  forbidden: 'Você não tem permissão para esta ação.',
  not_admin: 'Apenas administradores e proprietários podem gerenciar a equipe.',
  owner_only: 'Somente um proprietário pode conceder ou alterar o papel de proprietário.',
  self_change: 'Você não pode alterar o próprio papel nem se remover por aqui.',
  last_owner: 'A organização precisa manter ao menos um proprietário.',
  not_found: 'Não encontrado ou sem acesso.',
  member_not_found: 'Membro não encontrado nesta organização.',
  slug_taken: 'Este endereço já está em uso. Escolha outro.',
  already_member: 'Esta pessoa já faz parte da organização.',
  invitation_pending:
    'Já existe um convite pendente para este e-mail. Revogue o convite atual em “Convites pendentes” para criar outro.',
  invitation_invalid: 'Convite inválido, revogado ou já utilizado.',
  invitation_expired: 'Este convite expirou. Peça um novo convite.',
  invitation_email_mismatch:
    'Este convite foi enviado para outro e-mail. Entre com a conta convidada.',
  email_not_confirmed: 'Confirme seu e-mail antes de aceitar o convite.',
  unexpected: 'Algo deu errado. Tente novamente; se persistir, informe o código de rastreio.',
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
