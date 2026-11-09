import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';
import { cn } from '../lib/cn';

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
  {
    variants: {
      variant: {
        neutral: 'bg-muted text-foreground',
        outline: 'border border-border text-muted-foreground',
        accent: 'bg-accent-soft text-accent-foreground',
        success: 'bg-success-soft text-success',
        warning: 'bg-warning-soft text-warning',
        danger: 'bg-danger-soft text-danger',
      },
    },
    defaultVariants: { variant: 'neutral' },
  },
);

export interface BadgeProps extends ComponentProps<'span'>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

/**
 * Selo obrigatório para qualquer dado de demonstração (`is_demo = true`).
 * Regra do projeto: dado fictício nunca aparece sem este selo.
 */
export function DemoBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border border-warning px-1.5 py-0.5 text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-foreground',
        className,
      )}
      title="Dados de demonstração: não representam empresas ou pessoas reais"
    >
      Demo<span className="sr-only"> — dados de demonstração, não reais</span>
    </span>
  );
}
