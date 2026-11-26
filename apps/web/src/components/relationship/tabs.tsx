'use client';

import { cn } from '@prospector/ui';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { relationshipRoutes } from '@/lib/relationship-routes';

const TABS = [
  { href: relationshipRoutes.approaches, label: 'Para enviar' },
  { href: relationshipRoutes.conversations, label: 'Em andamento' },
  { href: relationshipRoutes.pipeline, label: 'Funil' },
  { href: relationshipRoutes.approvals, label: 'Aprovações' },
] as const;

/**
 * Abas de Conversas (o antigo Relacionamento). São links (cada aba é uma página, com endereço
 * próprio), então usam `aria-current` em vez do padrão de abas com teclado: Tab e Enter bastam.
 * Aprovações saiu do menu lateral e virou a última aba, no mesmo endereço de antes.
 */
export function RelationshipTabs() {
  const pathname = usePathname();
  return (
    <nav aria-label="Partes de Conversas">
      <ul className="flex flex-wrap gap-1 rounded-2xl bg-muted p-1 sm:inline-flex sm:rounded-full">
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
