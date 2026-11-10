import type { z } from 'zod';

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
  // F2 — estratégia e conformidade
  concurrent_change:
    'Outra alteração foi salva ao mesmo tempo. Recarregue a página e tente de novo.',
  invalid_status_change: 'Essa mudança de status não é permitida.',
  activation_blocked: 'Ainda não dá para ativar. Falta:',
  offer_active_incomplete:
    'Esta oferta está ativa e precisa continuar completa. Para tirar esses itens, volte-a para rascunho primeiro.',
  icp_active_incomplete:
    'Este ICP está ativo e precisa continuar com recorte. Para tirar todos os filtros, pause-o primeiro.',
  lia_decision_locked:
    'Esta versão da LIA já foi decidida. Recarregue a página para ver a situação atual.',
  lia_not_latest: 'Só a versão mais recente da LIA pode ser aprovada. Recarregue a página.',
  review_date_out_of_range:
    'A data de revisão precisa ser depois de hoje e em até 24 meses. Recarregue a página.',
  proof_asset_archived: 'Case arquivado não pode ser editado.',
  approach_blocked:
    'Abordagem bloqueada: conclua o checklist de prontidão (estratégia e conformidade).',
  discovery_blocked: 'Descoberta bloqueada: conclua o checklist de prontidão da estratégia.',
  // M2 — empresas e evidências
  company_duplicate: 'Essa empresa já está cadastrada (mesmo CNPJ ou domínio).',
  company_archived: 'Empresa arquivada não pode ser alterada. Reative-a primeiro.',
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

/** Problema de validação de um campo; `field` é o caminho com pontos (ex.: `criteria.0.weight`). */
export interface FieldIssue {
  field: string;
  message: string;
}

/** Agrupa problemas por campo; erros sem campo ficam em `_form`. */
export function groupFieldErrors(issues: readonly FieldIssue[]): Record<string, string[]> {
  const fieldErrors: Record<string, string[]> = {};
  for (const { field, message } of issues) {
    const key = field || '_form';
    const list = (fieldErrors[key] ??= []);
    if (!list.includes(message)) list.push(message);
  }
  return fieldErrors;
}

/** Valida a entrada com o contrato e converte falhas em AppError('validation'). */
export function parseInput<S extends z.ZodType>(schema: S, raw: unknown): z.output<S> {
  const result = schema.safeParse(raw);
  if (result.success) return result.data;
  const fieldErrors = groupFieldErrors(
    result.error.issues.map((issue) => ({
      field: issue.path.map(String).join('.'),
      message: issue.message,
    })),
  );
  throw new AppError('validation', 'invalid_input', { fieldErrors });
}

/** Lança AppError('validation') com os problemas das regras de domínio, se houver. */
export function assertNoIssues(
  issues: readonly FieldIssue[],
  reason: 'invalid_input' | 'activation_blocked' | 'icp_active_incomplete' = 'invalid_input',
): void {
  if (issues.length > 0) {
    throw new AppError('validation', reason, { fieldErrors: groupFieldErrors(issues) });
  }
}
