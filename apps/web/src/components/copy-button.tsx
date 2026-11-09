'use client';

import { Button } from '@prospector/ui';
import { useState } from 'react';

type CopyState = 'idle' | 'copied' | 'manual';

/**
 * Copia um valor para a área de transferência. Se o navegador negar o acesso, seleciona o
 * campo de origem (`targetId`) e orienta a copiar pelo teclado.
 */
export function CopyButton({
  value,
  targetId,
  label = 'Copiar',
}: {
  value: string;
  targetId?: string;
  label?: string;
}) {
  const [state, setState] = useState<CopyState>('idle');
  return (
    <>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setState('copied');
            setTimeout(() => setState('idle'), 2500);
          } catch {
            const target = targetId ? document.getElementById(targetId) : null;
            if (target instanceof HTMLInputElement) {
              target.focus();
              target.select();
            }
            setState('manual');
          }
        }}
      >
        {state === 'copied' ? 'Copiado' : label}
      </Button>
      <span role="status" className={state === 'manual' ? 'basis-full text-xs' : 'sr-only'}>
        {state === 'copied' ? 'Link copiado para a área de transferência.' : null}
        {state === 'manual'
          ? 'Não foi possível copiar automaticamente. O link está selecionado: copie com Ctrl+C (ou Cmd+C).'
          : null}
      </span>
    </>
  );
}
