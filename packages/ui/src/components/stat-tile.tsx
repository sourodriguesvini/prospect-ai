import { cva, type VariantProps } from 'class-variance-authority';
import type { ReactNode } from 'react';
import { cn } from '../lib/cn';

const tileVariants = cva(
  'relative flex min-h-36 flex-col justify-between gap-6 overflow-hidden rounded-[var(--radius-tile)] p-4',
  {
    variants: {
      tone: {
        /** Poço cinza: o padrão. */
        plain: 'bg-muted text-foreground',
        /** Destaque laranja (um por grupo, no máximo). */
        accent: 'bg-[image:var(--tile-accent)] text-[var(--tile-accent-foreground)]',
        /** Céu de fim de tarde, texto escuro. */
        dusk: 'bg-[image:var(--tile-dusk)] text-[var(--tile-ink)]',
        /** Areia, texto escuro. */
        sand: 'bg-[image:var(--tile-sand)] text-[var(--tile-ink)]',
        /** Grafite, texto claro. */
        graphite: 'bg-[image:var(--tile-graphite)] text-[var(--tile-paper)]',
      },
    },
    defaultVariants: { tone: 'plain' },
  },
);

const subtle = {
  plain: 'text-muted-foreground',
  accent: 'text-[var(--tile-accent-foreground)]',
  dusk: 'text-[var(--tile-ink)]',
  sand: 'text-[var(--tile-ink)]',
  graphite: 'text-[var(--tile-paper)]',
} as const;

export interface StatTileProps extends VariantProps<typeof tileVariants> {
  label: string;
  /** Valor real ou um traço; nunca número inventado. */
  value: ReactNode;
  /** Linha de rodapé (variação, fonte do dado ou "em breve"). */
  note?: ReactNode;
  icon?: ReactNode;
  className?: string;
}

/**
 * Cartão de métrica com número grande em grotesca leve. O ícone é decorativo: some quando o
 * conteúdo do cartão tem menos de 8rem, para o rótulo não empurrá-lo para fora (container query).
 */
export function StatTile({ label, value, note, icon, tone, className }: StatTileProps) {
  const toneKey = tone ?? 'plain';
  return (
    <div className={cn('@container', tileVariants({ tone }), className)}>
      <div className="flex items-start justify-between gap-3">
        {/* Com ícone, a primeira linha do rótulo fica centrada no círculo de 32px. */}
        <p
          className={cn(
            'min-w-0 text-balance break-words text-sm font-medium',
            icon ? '@min-[8rem]:pt-1.5' : null,
          )}
        >
          {label}
        </p>
        {icon ? (
          <span
            aria-hidden="true"
            className={cn(
              'hidden size-8 shrink-0 place-items-center rounded-full @min-[8rem]:grid',
              toneKey === 'plain' ? 'bg-surface' : 'bg-white/20',
            )}
          >
            {icon}
          </span>
        ) : null}
      </div>
      <div className="space-y-1.5">
        <p className="tabular text-4xl font-normal leading-none tracking-[-0.04em]">{value}</p>
        {note ? <p className={cn('text-xs', subtle[toneKey])}>{note}</p> : null}
      </div>
    </div>
  );
}
