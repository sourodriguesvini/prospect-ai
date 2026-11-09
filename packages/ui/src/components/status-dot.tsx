import type { ReactNode } from 'react';
import { cn } from '../lib/cn';

const DOT = {
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
  neutral: 'bg-muted-foreground',
  accent: 'bg-accent',
} as const;

export type StatusTone = keyof typeof DOT;

/** Estado com ponto colorido e texto (o texto carrega o significado; a cor só reforça). */
export function StatusDot({
  tone,
  children,
  className,
}: {
  tone: StatusTone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <span aria-hidden="true" className={cn('size-1.5 shrink-0 rounded-full', DOT[tone])} />
      {children}
    </span>
  );
}
