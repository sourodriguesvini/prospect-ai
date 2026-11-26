import { Button, DemoBadge, Panel, PanelHeader } from '@prospector/ui';
import Link from 'next/link';
import type { ReactNode } from 'react';

/**
 * Peças da tela Hoje: uma seção por tipo de pendência, cada linha com uma ação só. Seção vazia
 * não aparece (quem monta a página decide); "Ver todas" só quando há mais do que cabe.
 */
export function TodaySection({
  id,
  title,
  description,
  total,
  shown,
  more,
  children,
}: {
  id: string;
  title: string;
  description?: string;
  total: number;
  shown: number;
  /** Onde está a lista completa (`always`: o link aparece mesmo quando tudo coube). */
  more?: { href: string; label?: string; always?: boolean };
  children: ReactNode;
}) {
  return (
    <Panel aria-labelledby={id} data-today={id}>
      <PanelHeader
        titleId={id}
        title={
          <>
            {title}{' '}
            <span className="text-muted-foreground tabular-nums">
              <span className="sr-only">(</span>
              {total}
              <span className="sr-only">)</span>
            </span>
          </>
        }
        description={description}
        className="mb-2"
        actions={
          more && (more.always || total > shown) ? (
            <Button asChild variant="ghost" size="sm">
              <Link href={more.href}>{more.label ?? `Ver todas (${total})`}</Link>
            </Button>
          ) : null
        }
      />
      <ul className="divide-y">{children}</ul>
    </Panel>
  );
}

export function TodayRow({
  title,
  href,
  isDemo,
  meta,
  detail,
  action,
}: {
  title: string;
  href: string;
  isDemo?: boolean;
  meta?: ReactNode;
  detail?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3">
      <div className="min-w-0 flex-1 basis-60 space-y-0.5">
        <p className="flex flex-wrap items-center gap-2 font-medium break-words">
          <Link href={href} className="underline-offset-4 hover:underline focus-visible:underline">
            {title}
          </Link>
          {isDemo ? <DemoBadge /> : null}
        </p>
        {meta ? <p className="text-xs text-muted-foreground">{meta}</p> : null}
        {detail ? <p className="text-sm text-pretty text-muted-foreground">{detail}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </li>
  );
}

/**
 * Botão-link de uma linha (a ação principal dela). `context` (o nome da empresa) vai só para o
 * leitor de tela, para "Revisar" não ficar igual em todas as linhas.
 */
export function RowLink({
  href,
  context,
  children,
}: {
  href: string;
  context?: string;
  children: ReactNode;
}) {
  return (
    <Button asChild variant="secondary" size="sm">
      <Link href={href}>
        {children}
        {context ? <span className="sr-only">: {context}</span> : null}
      </Link>
    </Button>
  );
}
