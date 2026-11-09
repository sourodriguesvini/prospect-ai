import { useEffect, useRef } from 'react';
import type { ActionState } from './action-state';

/**
 * Depois de um envio com erro, leva o foco ao primeiro campo inválido do formulário, para
 * quem usa teclado ou leitor de tela não precisar procurar o problema.
 */
export function useFocusFirstInvalid(state: ActionState<unknown>) {
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.status !== 'error') return;
    ref.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [state]);
  return ref;
}
