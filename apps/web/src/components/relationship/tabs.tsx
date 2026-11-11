'use client';

import { cn } from '@prospector/ui';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { relationshipRoutes } from '@/lib/relationship-routes';

const TABS = [
  { href: relationshipRoutes.approaches, label: 'Abordagens' },
  { href: relationshipRoutes.conversations, label: 'Conversas' },
  { href: relationshipRoutes.pipeline, label: 'Pipeline' },
] as const;

/**
 * Abas do Relacionamento. São links (cada aba é uma página, com endereço próprio), então usam
 * `aria-current` em vez do padrão de abas com teclado: Tab e Enter bastam.
 */
export function RelationshipTabs() {
  const pathname = usePathname();
  return (
    <nav aria-label="Partes do Relacionamento">
      <ul className="flex flex-wrap gap-1 rounded-full bg-muted p-1 sm:inline-flex">
        {TABS.map((tab) => {
          const active = pathname === tab.href;
          return (
            <li key={tab.href}>
              <Link
                href={tab.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'inline-flex h-9 items-center rounded-full px-3 text-sm sm:px-4 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
                  active
                    ? 'bg-surface font-medium text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
