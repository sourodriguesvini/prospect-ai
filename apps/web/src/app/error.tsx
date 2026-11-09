'use client';

import { Button } from '@prospector/ui';

/** Falha inesperada ao renderizar. Mostra o digest para o suporte localizar o erro nos logs. */
export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main id="conteudo" className="mx-auto max-w-xl space-y-4 px-6 py-24">
      <h1 className="text-3xl">Algo deu errado</h1>
      <p className="text-muted-foreground">
        Não conseguimos carregar esta página. Tente de novo; se persistir, informe o código abaixo.
      </p>
      {error.digest ? (
        <p className="font-mono text-xs text-muted-foreground">Código: {error.digest}</p>
      ) : null}
      <Button onClick={reset} variant="secondary">
        Tentar de novo
      </Button>
    </main>
  );
}
