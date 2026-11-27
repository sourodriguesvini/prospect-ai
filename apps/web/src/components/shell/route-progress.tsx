'use client';

import { usePathname, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, type RefObject } from 'react';

/** Navegações mais rápidas que isso (tela já pré-carregada) não mostram a barra. */
const SHOW_AFTER_MS = 120;
/** Se a tela nunca chegar (erro de rede), a barra some sozinha. */
const GIVE_UP_AFTER_MS = 15_000;

type Phase = 'idle' | 'loading' | 'done';

type Timers = { show?: number; giveUp?: number; reset?: number };

function setPhase(bar: HTMLDivElement | null, phase: Phase) {
  if (bar) bar.dataset.phase = phase;
}

function clearTimers(timers: Timers) {
  window.clearTimeout(timers.show);
  window.clearTimeout(timers.giveUp);
  window.clearTimeout(timers.reset);
}

/**
 * Linha laranja fina no topo enquanto a próxima tela carrega. Começa no clique em um link
 * interno (ou quando a paleta/atalho navega) e termina quando o endereço muda. Decorativa: o
 * conteúdo novo é o que avisa que a tela trocou. Sem movimento quando o sistema pede menos
 * movimento (fica parada até a tela chegar).
 *
 * Imperativa de propósito (atributo no elemento, sem estado do React): o clique e a troca de
 * endereço acontecem fora do ciclo de renderização.
 */
export function useRouteProgress() {
  const barRef = useRef<HTMLDivElement>(null);
  const timers = useRef<Timers>({});
  const pending = useRef(false);

  const finish = useCallback(() => {
    if (!pending.current) return;
    pending.current = false;
    clearTimers(timers.current);
    const bar = barRef.current;
    if (bar?.dataset.phase !== 'loading') {
      setPhase(bar, 'idle');
      return;
    }
    setPhase(bar, 'done');
    timers.current.reset = window.setTimeout(() => setPhase(barRef.current, 'idle'), 400);
  }, []);

  const start = useCallback(() => {
    clearTimers(timers.current);
    pending.current = true;
    timers.current.show = window.setTimeout(
      () => setPhase(barRef.current, 'loading'),
      SHOW_AFTER_MS,
    );
    timers.current.giveUp = window.setTimeout(finish, GIVE_UP_AFTER_MS);
  }, [finish]);

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        return;
      }
      if (!(event.target instanceof Element)) return;
      const anchor = event.target.closest('a[href]');
      if (!(anchor instanceof HTMLAnchorElement)) return;
      if ((anchor.target && anchor.target !== '_self') || anchor.hasAttribute('download')) return;
      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search) {
        return;
      }
      start();
    };
    // Fase de captura: o <Link> do Next cancela o clique antes de chegar ao documento.
    document.addEventListener('click', onClick, true);
    const pendingTimers = timers.current;
    return () => {
      document.removeEventListener('click', onClick, true);
      clearTimers(pendingTimers);
    };
  }, [start]);

  return { barRef, start, finish };
}

/** Termina a barra quando o endereço (caminho ou busca) muda. */
export function RouteChangeWatcher({ onChange }: { onChange: () => void }) {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  useEffect(() => {
    onChange();
  }, [pathname, search, onChange]);
  return null;
}

export function RouteProgressBar({ barRef }: { barRef: RefObject<HTMLDivElement | null> }) {
  return (
    <div
      ref={barRef}
      aria-hidden="true"
      data-phase="idle"
      className="pointer-events-none fixed inset-x-0 top-0 z-[70] h-0.5 origin-left scale-x-0 bg-accent opacity-0 data-[phase=done]:scale-x-100 data-[phase=done]:opacity-0 data-[phase=done]:transition-[scale,opacity] data-[phase=done]:duration-300 data-[phase=loading]:scale-x-[0.85] data-[phase=loading]:opacity-100 data-[phase=loading]:transition-[scale] data-[phase=loading]:duration-[8s] data-[phase=loading]:ease-out"
    />
  );
}
