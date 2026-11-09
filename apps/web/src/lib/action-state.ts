/** Resultado de uma Server Action consumido por `useActionState`. */
export type ActionState<T = undefined> =
  | { status: 'idle' }
  | { status: 'success'; message: string; data?: T }
  | {
      status: 'error';
      message: string;
      fieldErrors?: Record<string, string[]>;
      /** Valores não sensíveis devolvidos para repovoar o formulário (React 19 limpa campos após a ação). */
      values?: Record<string, string>;
      /** Presente só em erros inesperados, para o usuário informar ao suporte. */
      traceId?: string;
    };

export const IDLE: ActionState<never> = { status: 'idle' };

export function fieldErrorsOf(state: ActionState<unknown>, field: string): string[] | undefined {
  return state.status === 'error' ? state.fieldErrors?.[field] : undefined;
}

export function valueOf(state: ActionState<unknown>, field: string): string | undefined {
  return state.status === 'error' ? state.values?.[field] : undefined;
}

/** Extrai campos de texto do FormData para devolver ao formulário (nunca inclua senhas). */
export function pickValues(formData: FormData, fields: readonly string[]): Record<string, string> {
  const values: Record<string, string> = {};
  for (const field of fields) {
    const value = formData.get(field);
    if (typeof value === 'string') values[field] = value;
  }
  return values;
}
