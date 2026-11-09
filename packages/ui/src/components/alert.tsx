import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';
import { cn } from '../lib/cn';

const alertVariants = cva('rounded-[var(--radius-tile)] px-4 py-3 text-sm', {
  variants: {
    tone: {
      info: 'bg-muted text-foreground',
      success: 'bg-success-soft text-foreground',
      warning: 'bg-warning-soft text-foreground',
      danger: 'bg-danger-soft text-foreground',
    },
  },
  defaultVariants: { tone: 'info' },
});

export interface AlertProps extends ComponentProps<'div'>, VariantProps<typeof alertVariants> {}

/** Mensagem de estado. Erros e avisos são anunciados imediatamente; o resto, com educação. */
export function Alert({ className, tone, role, ...props }: AlertProps) {
  const defaultRole = tone === 'danger' || tone === 'warning' ? 'alert' : 'status';
  return (
    <div role={role ?? defaultRole} className={cn(alertVariants({ tone }), className)} {...props} />
  );
}
