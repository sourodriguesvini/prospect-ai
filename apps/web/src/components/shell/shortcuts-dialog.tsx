'use client';

import { Checkbox, Label } from '@prospector/ui';
import { X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { flattenNav } from '@/lib/navigation';

const SINGLE_KEY_STORAGE = 'prospector.atalhos-de-uma-tecla';

/**
 * Atalhos de uma tecla ("g" e depois outra, "?") podem ser desligados (WCAG 2.1.4): quem usa
 * comando de voz ou tem tremor pode disparar sem querer. Preferência deste navegador.
 */
export function singleKeyShortcutsEnabled(): boolean {
  try {
    return window.localStorage.getItem(SINGLE_KEY_STORAGE) !== 'off';
  } catch {
    return true;
  }
}

function saveSingleKeyShortcuts(enabled: boolean) {
  try {
    if (enabled) window.localStorage.removeItem(SINGLE_KEY_STORAGE);
    else window.localStorage.setItem(SINGLE_KEY_STORAGE, 'off');
  } catch {
    // Armazenamento bloqueado: a escolha vale só até recarregar.
  }
}

function Keys({ keys }: { keys: readonly string[] }) {
  return (
    <span className="flex shrink-0 items-center gap-1">
      {keys.map((key, index) => (
        <kbd
          key={`${key}-${index}`}
          className="min-w-6 rounded-md border bg-surface px-1.5 py-1 text-center font-sans text-xs leading-none text-foreground"
        >
          {key}
        </kbd>
      ))}
    </span>
  );
}

const GENERAL: readonly { keys: readonly string[]; label: string }[] = [
  { keys: ['Ctrl', 'K'], label: 'Buscar ou ir para (paleta de comandos)' },
  { keys: ['Ctrl', 'B'], label: 'Recolher ou expandir o menu lateral' },
  { keys: ['?'], label: 'Mostrar esta lista' },
  { keys: ['Esc'], label: 'Fechar paleta, lista, menu ou dica' },
];

/** Lista de atalhos de teclado, com a opção de desligar os de uma tecla. */
export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [singleKey, setSingleKey] = useState(singleKeyShortcutsEnabled);
  const screens = flattenNav().filter((item) => item.shortcut);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="atalhos-titulo"
      onClose={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) dialogRef.current?.close();
      }}
      className="m-auto w-[min(34rem,calc(100vw-2rem))] max-w-none rounded-[var(--radius-panel)] bg-surface p-0 text-foreground shadow-[var(--shadow-float)] backdrop:bg-overlay motion-safe:animate-float-in motion-safe:backdrop:animate-fade-in"
    >
      <div className="space-y-5 p-5 sm:p-6">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <h2 id="atalhos-titulo" className="text-lg">
              Atalhos de teclado
            </h2>
            <p className="text-sm text-muted-foreground">
              No Mac, use ⌘ no lugar de Ctrl. Os atalhos de uma tecla não funcionam enquanto você
              digita num campo.
            </p>
          </div>
          <button
            type="button"
            autoFocus
            onClick={() => dialogRef.current?.close()}
            aria-label="Fechar"
            className="grid size-9 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <X aria-hidden="true" className="size-4" />
          </button>
        </div>

        <section aria-labelledby="atalhos-gerais" className="space-y-2">
          <h3 id="atalhos-gerais" className="text-sm font-semibold">
            Gerais
          </h3>
          <ul className="divide-y rounded-[var(--radius-tile)] bg-muted px-4">
            {GENERAL.map((item) => (
              <li
                key={item.label}
                className="flex items-center justify-between gap-4 py-2.5 text-sm"
              >
                <span>{item.label}</span>
                <Keys keys={item.keys} />
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="atalhos-telas" className="space-y-2">
          <h3 id="atalhos-telas" className="text-sm font-semibold">
            Ir para (aperte G e depois a letra)
          </h3>
          <ul className="divide-y rounded-[var(--radius-tile)] bg-muted px-4">
            {screens.map((item) => (
              <li
                key={item.href}
                className="flex items-center justify-between gap-4 py-2.5 text-sm"
              >
                <span>{item.label}</span>
                <Keys keys={['G', (item.shortcut ?? '').toUpperCase()]} />
              </li>
            ))}
          </ul>
        </section>

        <div className="flex items-start gap-3">
          <Checkbox
            id="atalhos-uma-tecla"
            checked={singleKey}
            aria-describedby="atalhos-uma-tecla-ajuda"
            onChange={(event) => {
              setSingleKey(event.target.checked);
              saveSingleKeyShortcuts(event.target.checked);
            }}
            className="mt-0.5"
          />
          <div className="space-y-0.5">
            <Label htmlFor="atalhos-uma-tecla">Atalhos de uma tecla (G e ?)</Label>
            <p id="atalhos-uma-tecla-ajuda" className="text-xs text-muted-foreground">
              Desligue se você usa comando de voz ou costuma apertar teclas sem querer. Ctrl+K e
              Ctrl+B continuam valendo.
            </p>
          </div>
        </div>
      </div>
    </dialog>
  );
}
