import { cn } from '@prospector/ui';
import Link from 'next/link';

/**
 * Alternância em forma de pílulas feita de links (filtro ou período na URL). Cada opção é um
 * endereço próprio, então usa `aria-current` em vez do padrão de abas com teclado: Tab e Enter
 * bastam, e voltar no navegador volta o filtro.
 */
export function SegmentedLinks({
  label,
  options,
}: {
  /** Nome da navegação para leitores de tela. */
  label: string;
  options: readonly { href: string; label: string; current: boolean; count?: number }[];
}) {
  return (
    <nav aria-label={label}>
      {/* rounded-3xl em vez de full: numa linha parece pílula; quebrando em duas no celular,
          vira um retângulo arredondado em vez de uma bolha. */}
      <ul className="flex flex-wrap gap-1 rounded-3xl bg-muted p-1 sm:inline-flex">
        {options.map((option) => (
          <li key={option.href}>
            <Link
              href={option.href}
              scroll={false}
              aria-current={option.current ? 'page' : undefined}
              className={cn(
                'inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring sm:px-4',
                option.current
                  ? 'bg-surface font-medium text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {option.label}
              {option.count !== undefined ? (
                <span className="tabular-nums text-muted-foreground">
                  <span className="sr-only">(</span>
                  {option.count}
                  <span className="sr-only">)</span>
                </span>
              ) : null}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
