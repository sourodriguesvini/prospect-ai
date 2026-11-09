import type { FormValues } from './form-data';

/** Resultado de uma Server Action de formulário (serializável para o cliente). */
export interface FormState {
  /** `unchanged`: o envio deu certo, mas nada mudou (nenhuma versão nova). */
  status: 'idle' | 'error' | 'saved' | 'unchanged';
  /** Mensagem geral (erro ou confirmação). */
  message?: string;
  /** Marca de cada resposta: a mesma mensagem duas vezes ainda é anunciada e recebe o foco. */
  at?: number;
  /** Erros por campo; a chave é o caminho do contrato (ex.: `criteria.0.weight`); `_form` é geral. */
  fieldErrors?: Record<string, string[]>;
  /** O que a pessoa enviou, para reexibir depois de um erro. */
  values?: FormValues;
}

export const IDLE: FormState = { status: 'idle' };

/**
 * Erros do campo e de tudo abaixo dele. Em listas, indica o item (ex.: `problems.2` →
 * "Item 3: …"), que corresponde à linha preenchida no formulário.
 */
export function errorsFor(state: FormState, field: string): string[] | undefined {
  if (!state.fieldErrors) return undefined;
  const found: string[] = [];
  for (const [key, messages] of Object.entries(state.fieldErrors)) {
    if (key === field) {
      found.push(...messages);
    } else if (key.startsWith(`${field}.`)) {
      const index = /^(\d+)/.exec(key.slice(field.length + 1))?.[1];
      found.push(
        ...messages.map((m) => (index === undefined ? m : `Item ${Number(index) + 1}: ${m}`)),
      );
    }
  }
  return found.length > 0 ? [...new Set(found)] : undefined;
}
