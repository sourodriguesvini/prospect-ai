import type { ComponentProps } from 'react';
import { cn } from '../lib/cn';

const fieldBase =
  'w-full rounded-full border border-input bg-surface px-4 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50 aria-[invalid=true]:border-danger';

export function Input({ className, ...props }: ComponentProps<'input'>) {
  return <input className={cn(fieldBase, 'h-10', className)} {...props} />;
}

/** Select nativo: acessível por teclado e leitor de tela sem JavaScript extra. */
export function NativeSelect({ className, ...props }: ComponentProps<'select'>) {
  return <select className={cn(fieldBase, 'h-10 pr-8', className)} {...props} />;
}

export function Label({ className, ...props }: ComponentProps<'label'>) {
  return <label className={cn('text-sm font-medium text-foreground', className)} {...props} />;
}

export function FieldError({
  id,
  messages,
}: {
  id: string;
  messages: readonly string[] | undefined;
}) {
  if (!messages || messages.length === 0) return null;
  return (
    <p id={id} className="text-sm text-danger">
      {messages.join(' ')}
    </p>
  );
}
