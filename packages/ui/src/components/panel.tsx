import type { ComponentProps, ReactNode } from 'react';
import { cn } from '../lib/cn';

/** Painel branco muito arredondado sobre a moldura cinza: a unidade de layout das telas. */
export function Panel({ className, ...props }: ComponentProps<'section'>) {
  return (
    <section
      className={cn(
        'rounded-[var(--radius-panel)] bg-surface p-5 shadow-[var(--shadow-panel)] sm:p-6',
        className,
      )}
      {...props}
    />
  );
}

/** Cabeçalho de painel: título à esquerda, ações à direita. */
export function PanelHeader({
  title,
  titleId,
  description,
  actions,
  className,
}: {
  title: ReactNode;
  titleId?: string;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('mb-5 flex flex-wrap items-start justify-between gap-3', className)}>
      <div className="space-y-1">
        <h2 id={titleId} className="text-balance text-lg">
          {title}
        </h2>
        {description ? (
          <p className="text-pretty text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}

/** Poço cinza dentro de um painel (cartões menores, cabeçalho de tabela). */
export function Well({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('rounded-[var(--radius-tile)] bg-muted p-4', className)} {...props} />;
}
