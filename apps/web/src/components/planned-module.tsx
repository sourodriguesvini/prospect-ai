/** Estado honesto para módulos ainda não construídos: diz o que virá, sem dados simulados. */
export function PlannedModule({ title, description }: { title: string; description: string }) {
  return (
    <div className="space-y-6">
      <h1 className="text-4xl">{title}</h1>
      <div className="max-w-prose border-t pt-6">
        <p className="text-sm font-medium">Em breve.</p>
        <p className="mt-2 text-sm text-muted-foreground">{description}</p>
        <p className="mt-2 text-sm text-muted-foreground">
          Nada aqui é simulado: quando o módulo existir, mostrará apenas dados reais da sua
          organização ou dados marcados como demonstração.
        </p>
      </div>
    </div>
  );
}
