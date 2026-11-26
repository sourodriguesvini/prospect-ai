import { Panel, PanelHeader, Well } from '@prospector/ui';
import { ArrowUpRight } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import {
  DatabaseStatusValue,
  DemoDataValue,
  safeguards,
} from '@/components/system/database-status';
import { SETTINGS_SECTIONS } from '@/lib/navigation';

export const metadata: Metadata = { title: 'Configurações' };

export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-4xl tracking-[-0.03em]">Configurações</h1>
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel aria-labelledby="disponivel">
          <PanelHeader titleId="disponivel" title="Ajustes" />
          <ul className="space-y-3">
            {SETTINGS_SECTIONS.map((item) => {
              const Icon = item.icon;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className="group flex items-center gap-4 rounded-[var(--radius-tile)] bg-muted p-4 transition-colors hover:bg-border focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  >
                    <span
                      aria-hidden="true"
                      className="grid size-10 shrink-0 place-items-center rounded-full bg-surface"
                    >
                      <Icon className="size-4" />
                    </span>
                    <span className="flex-1">
                      <span className="block font-medium">{item.label}</span>
                      <span className="block text-sm text-muted-foreground">{item.detail}</span>
                    </span>
                    <ArrowUpRight aria-hidden="true" className="size-4 text-muted-foreground" />
                  </Link>
                </li>
              );
            })}
          </ul>
        </Panel>
        <Panel aria-labelledby="sistema">
          <PanelHeader
            titleId="sistema"
            title="Sistema"
            description="Banco de dados e proteções desta instalação."
          />
          <Suspense
            fallback={
              <p role="status" className="text-2xl tracking-[-0.03em] text-muted-foreground">
                Verificando…
              </p>
            }
          >
            <DatabaseStatusValue />
          </Suspense>
          <Well className="@container mt-5 p-3">
            {/* Subgrade: rótulo, valor e nota ficam na mesma linha em todos os cartões. */}
            <ul className="grid grid-cols-1 gap-y-2 @md:grid-cols-3 @md:gap-x-2 @md:gap-y-0">
              {safeguards(
                <Suspense fallback={<span role="status">Contando…</span>}>
                  <DemoDataValue />
                </Suspense>,
              ).map((item) => (
                <li
                  key={item.label}
                  className="row-span-3 grid grid-rows-subgrid gap-y-1 rounded-xl bg-surface p-2.5"
                >
                  <p className="text-xs text-muted-foreground">{item.label}</p>
                  <p className="text-sm font-medium">{item.value}</p>
                  <p className="text-xs text-muted-foreground">{item.note}</p>
                </li>
              ))}
            </ul>
          </Well>
        </Panel>
      </div>
    </div>
  );
}
