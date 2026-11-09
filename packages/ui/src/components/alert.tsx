import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';
import { cn } from '../lib/cn';

const alertVariants = cva('border-l-2 px-4 py-3 text-sm', {
  variants: {
    tone: {
      info: 'border-foreground/40 bg-muted text-foreground',
      success: 'border-success bg-success/10 text-foreground',
      warning: 'border-warning bg-warning/15 text-foreground',
      danger: 'border-danger bg-danger/10 text-foreground',
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
