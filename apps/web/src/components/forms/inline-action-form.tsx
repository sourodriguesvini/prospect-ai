'use client';

import { cn } from '@prospector/ui';
import { useActionState, type ReactNode } from 'react';
import { IDLE, type ActionState } from '@/lib/action-state';

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;

/**
 * Formulário de ação de linha (alterar papel, remover, revogar). O grupo tem nome acessível
 * sem criar um landmark por linha; sucesso e erro aparecem no lugar e são anunciados.
 */
export function InlineActionForm({
  action,
  className,
  children,
  label,
}: {
  action: Action;
  className?: string;
  children: ReactNode;
  /** Nome acessível do grupo (ex.: "Alterar papel de Ana"). */
  label: string;
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(action, IDLE);
  return (
    <form action={formAction} className={cn('space-y-1', className)}>
      <fieldset aria-label={label} disabled={pending} className="flex flex-wrap items-center gap-2">
        {children}
      </fieldset>
      <p role="status" className="text-xs text-muted-foreground empty:hidden">
        {state.status === 'success' ? state.message : ''}
      </p>
      {state.status === 'error' ? (
        <p role="alert" className="text-xs text-danger">
          {state.message}
          {state.traceId ? ` (código ${state.traceId})` : null}
        </p>
      ) : null}
    </form>
  );
}
