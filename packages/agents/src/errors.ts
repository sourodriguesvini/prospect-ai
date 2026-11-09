import { AI_ERROR_MESSAGES, type AiErrorCode } from '@prospector/contracts';

/**
 * Falha da IA local com motivo estável. `message` é o texto pt-BR mostrado ao usuário;
 * `detail` é técnico (status HTTP, erro do Ollama) e vai só para o log do servidor.
 */
export class AiError extends Error {
  readonly code: AiErrorCode;
  readonly detail: string | undefined;

  constructor(code: AiErrorCode, options?: { message?: string; detail?: string; cause?: unknown }) {
    super(
      options?.message ?? AI_ERROR_MESSAGES[code],
      options?.cause === undefined ? undefined : { cause: options.cause },
    );
    this.name = 'AiError';
    this.code = code;
    this.detail = options?.detail;
  }
}

export function isAiError(error: unknown): error is AiError {
  return error instanceof AiError;
}

/** Qualquer erro vira AiError; o que não foi classificado é `provider_error`. */
export function toAiError(error: unknown): AiError {
  if (isAiError(error)) return error;
  const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return new AiError('provider_error', { detail, cause: error });
}
