import { Panel } from '@prospector/ui';

/** Estado honesto para módulos ainda não construídos: diz o que virá, sem dados simulados. */
export function PlannedModule({
  title,
  description,
  slice,
}: {
  title: string;
  description: string;
  slice: string;
}) {
  return (
    <div className="space-y-6">
      <h1 className="text-4xl tracking-[-0.03em]">{title}</h1>
      <Panel aria-label={`${title}: em breve`} className="grid gap-4 p-3 sm:p-3 lg:grid-cols-2">
        <div className="flex min-h-72 flex-col justify-between rounded-[var(--radius-tile)] bg-[image:var(--tile-dusk)] p-6 text-[var(--tile-ink)]">
          <p className="text-sm font-medium">Fatia {slice}</p>
          <p className="text-5xl tracking-[-0.04em] sm:text-6xl">Em breve.</p>
        </div>
        <div className="flex flex-col justify-end gap-3 p-3 sm:p-5">
          <p className="text-lg">{description}</p>
          <p className="text-sm text-muted-foreground">
            Nada aqui é simulado: quando o módulo existir, mostrará apenas dados reais ou dados
            marcados como demonstração.
          </p>
        </div>
      </Panel>
    </div>
  );
}
