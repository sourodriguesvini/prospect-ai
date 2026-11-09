'use client';

import { cn } from '@prospector/ui';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

function useActive(href: string, exact: boolean): boolean {
  const pathname = usePathname();
  return exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
}

const focus = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring';

/** Item da navegação em pílula: o ativo vira pílula de tinta (preta no claro). */
export function NavPill({
  href,
  exact = false,
  children,
}: {
  href: string;
  exact?: boolean;
  children: ReactNode;
}) {
  const active = useActive(href, exact);
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'inline-flex h-10 items-center whitespace-nowrap rounded-full px-4 text-sm transition-colors',
        focus,
        active
          ? 'bg-primary font-medium text-primary-foreground'
          : 'text-muted-foreground hover:bg-muted hover:text-foreground',
      )}
    >
      {children}
    </Link>
  );
}

/** Botão redondo do trilho lateral: só ícone, com nome acessível e dica ao passar o mouse. */
export function NavIcon({
  href,
  label,
  children,
}: {
  href: string;
  label: string;
  children: ReactNode;
}) {
  const active = useActive(href, false);
  return (
    <Link
      href={href}
      aria-label={label}
      title={label}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'grid size-10 place-items-center rounded-full transition-colors',
        focus,
        active
          ? 'bg-primary text-primary-foreground'
          : 'text-muted-foreground hover:bg-muted hover:text-foreground',
      )}
    >
      {children}
    </Link>
  );
}
