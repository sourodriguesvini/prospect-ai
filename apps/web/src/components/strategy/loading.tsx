import { Well } from '@prospector/ui';

/** Estado de carregamento das telas da Estratégia (anunciado a leitores de tela). */
export function Loading({ label = 'Carregando…' }: { label?: string }) {
  return (
    <Well role="status" className="py-10 text-center text-sm text-muted-foreground">
      {label}
    </Well>
  );
}
