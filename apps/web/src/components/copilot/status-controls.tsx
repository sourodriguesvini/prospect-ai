'use client';

import { Button } from '@prospector/ui';
import { RotateCw } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';

/** Lê de novo o estado do Ollama e da GPU (útil depois de abrir o Ollama ou baixar um modelo). */
export function RefreshStatusButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="secondary"
      size="sm"
      onClick={() => startTransition(() => router.refresh())}
      disabled={pending}
    >
      <RotateCw aria-hidden="true" className="size-3.5" />
      {pending ? 'Atualizando…' : 'Atualizar'}
    </Button>
  );
}
