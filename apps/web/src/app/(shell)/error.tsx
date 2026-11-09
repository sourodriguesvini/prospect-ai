'use client';

import { Button } from '@prospector/ui';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';

/**
 * Falha inesperada dentro do app. Mantém a navegação lateral, tenta de novo buscando os dados
 * no servidor e mostra o digest para localizar o erro no log do terminal.
 */
export default function ShellError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <div role="alert" className="max-w-prose space-y-4">
      <h1 className="text-3xl">Não foi possível carregar esta página</h1>
      <p className="text-sm text-muted-foreground">
        Tente de novo. Se continuar, procure o código abaixo no terminal onde o app está rodando.
      </p>
      {error.digest ? (
        <p className="font-mono text-xs text-muted-foreground">Código: {error.digest}</p>
      ) : null}
      <div className="flex flex-wrap items-center gap-4">
        <Button
          variant="secondary"
          disabled={pending}
          onClick={() =>
            startTransition(() => {
              router.refresh();
              reset();
            })
          }
        >
          {pending ? 'Tentando…' : 'Tentar de novo'}
        </Button>
        <Link href="/" className="text-sm underline underline-offset-4">
          Voltar ao início
        </Link>
      </div>
    </div>
  );
}
