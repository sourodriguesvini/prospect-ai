import { Panel, PanelHeader } from '@prospector/ui';
import { ArrowUpRight, ScrollText } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = { title: 'Configuração' };

const PLANNED = [
  { label: 'Ofertas, rubricas, ICP, voz da agência e cases', slice: 'F2' },
  { label: 'Integrações', slice: 'F4' },
  { label: 'Conformidade (LIA, supressão, titulares, retenção)', slice: 'F2' },
  { label: 'Uso e orçamento', slice: 'F13' },
  { label: 'Agentes (modelos, versões de prompt, avaliações)', slice: 'F5' },
];

export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-4xl tracking-[-0.03em]">Configuração</h1>
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel aria-labelledby="disponivel">
          <PanelHeader titleId="disponivel" title="Disponível" />
          <Link
            href="/configuracoes/auditoria"
            className="group flex items-center gap-4 rounded-[var(--radius-tile)] bg-muted p-4 transition-colors hover:bg-border focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <span
              aria-hidden="true"
              className="grid size-10 shrink-0 place-items-center rounded-full bg-surface"
            >
              <ScrollText className="size-4" />
            </span>
            <span className="flex-1">
              <span className="block font-medium">Auditoria</span>
              <span className="block text-sm text-muted-foreground">
                Registro imutável do que você, os agentes e o sistema fizeram.
              </span>
            </span>
            <ArrowUpRight aria-hidden="true" className="size-4 text-muted-foreground" />
          </Link>
        </Panel>
        <Panel aria-labelledby="em-breve">
          <PanelHeader titleId="em-breve" title="Em breve" />
          <ul className="divide-y">
            {PLANNED.map((item) => (
              <li key={item.label} className="flex items-center justify-between gap-4 py-3 text-sm">
                <span>{item.label}</span>
                <span className="min-w-10 shrink-0 rounded-full bg-muted px-2.5 py-0.5 text-center text-xs text-muted-foreground">
                  {item.slice}
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </div>
  );
}
