'use client';

import { Button, cn } from '@prospector/ui';
import { ChevronDown } from 'lucide-react';
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';

// Mesmo ponto do `lg:` do Tailwind: a partir dele a coluna fica sempre aberta ao lado.
const DESKTOP_QUERY = '(min-width: 64rem)';

/**
 * Tela do Copiloto com a coluna das conversas salvas e da IA local (diretriz 2026-11-26, Parte 6.1).
 * No computador a coluna fica sempre aberta à esquerda, com rolagem própria. Em tela estreita fica
 * atrás de um botão acima da conversa e, aberta, cobre a conversa em vez de espremê-la: a página não
 * rola, a conversa coberta sai do alcance do teclado e do leitor de tela (`inert`), Esc fecha e
 * devolve o foco ao botão, e escolher uma conversa fecha a gaveta.
 */
export function CopilotLayout({ side, children }: { side: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const toggleRef = useRef<HTMLButtonElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    toggleRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      event.preventDefault();
      close();
    };
    const desktop = window.matchMedia(DESKTOP_QUERY);
    const onResize = (event: MediaQueryListEvent) => {
      if (event.matches) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    desktop.addEventListener('change', onResize);
    return () => {
      document.removeEventListener('keydown', onKey);
      desktop.removeEventListener('change', onResize);
    };
  }, [close, open]);

  return (
    <div className="relative flex min-h-0 flex-1 flex-col gap-4 lg:flex-row">
      <div className="flex min-w-0 shrink-0 flex-col gap-3 lg:min-h-0 lg:w-[min(24rem,33%)] lg:shrink">
        <Button
          ref={toggleRef}
          variant="secondary"
          size="sm"
          className="self-start lg:hidden"
          aria-expanded={open}
          aria-controls={id}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? 'Voltar à conversa' : 'Conversas salvas e IA local'}
          <ChevronDown
            aria-hidden="true"
            className={cn('size-4 transition-transform', open && 'rotate-180')}
          />
        </Button>
        <div
          id={id}
          role="region"
          aria-label="Conversas salvas e IA local"
          // Escolher uma conversa (ou "Nova conversa") leva a ela: a gaveta fecha junto.
          onClick={(event) => {
            if (event.target instanceof Element && event.target.closest('a[href]')) {
              setOpen(false);
            }
          }}
          className={cn(
            'flex-col gap-4 overflow-y-auto overscroll-contain lg:static lg:flex lg:min-h-0 lg:flex-1',
            open
              ? 'flex max-lg:absolute max-lg:inset-x-0 max-lg:bottom-0 max-lg:top-11 max-lg:z-20 max-lg:bg-background'
              : 'hidden',
          )}
        >
          {side}
        </div>
      </div>
      <div inert={open} className="flex min-h-0 min-w-0 flex-1 flex-col">
        {children}
      </div>
    </div>
  );
}
