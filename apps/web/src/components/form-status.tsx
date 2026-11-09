import { Alert } from '@prospector/ui';
import type { ActionState } from '@/lib/action-state';

/** Mensagem geral do formulário (erros de campo aparecem junto de cada campo). */
export function FormStatus({ state }: { state: ActionState<unknown> }) {
  if (state.status === 'idle') return null;
  if (state.status === 'success') return <Alert tone="success">{state.message}</Alert>;
  return (
    <Alert tone="danger">
      {state.message}
      {state.traceId ? (
        <span className="mt-1 block text-xs text-muted-foreground">
          Código de rastreio: {state.traceId}
        </span>
      ) : null}
    </Alert>
  );
}
