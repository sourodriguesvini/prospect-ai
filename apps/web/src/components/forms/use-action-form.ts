'use client';

import { useActionState } from 'react';
import type { FormValues } from '@/lib/form-data';
import { IDLE, type FormState } from '@/lib/form-state';

export type FormAction = (prev: FormState, formData: FormData) => Promise<FormState>;

/**
 * Estado de um formulário ligado a uma Server Action. Depois de um erro, os campos mostram o que
 * a pessoa digitou (o React limpa o formulário ao fim da ação e volta ao `defaultValue`).
 */
export function useActionForm(action: FormAction, initial: FormValues) {
  const [state, formAction] = useActionState(action, IDLE);
  const values = state.status === 'error' && state.values ? state.values : initial;
  return { state, values, formAction };
}
