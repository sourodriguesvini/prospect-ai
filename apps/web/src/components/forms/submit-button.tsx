'use client';

import { Button, cn, type ButtonProps } from '@prospector/ui';
import { useFormStatus } from 'react-dom';

/**
 * Botão de envio que anuncia "Salvando…" e ignora novos cliques enquanto a ação roda. Usa
 * `aria-disabled` em vez de `disabled`: o foco continua no botão (com `disabled`, ele cairia no
 * início da página no meio do envio).
 */
export function SubmitButton({
  children,
  pendingLabel = 'Salvando…',
  className,
  ...props
}: Omit<ButtonProps, 'type'> & { pendingLabel?: string }) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      aria-disabled={pending || undefined}
      onClick={(event) => {
        if (pending) event.preventDefault();
      }}
      className={cn('aria-disabled:cursor-wait aria-disabled:opacity-60', className)}
      {...props}
    >
      {pending ? pendingLabel : children}
    </Button>
  );
}
