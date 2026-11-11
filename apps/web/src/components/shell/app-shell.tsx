'use client';

import { cn } from '@prospector/ui';
import { Menu, Radar, Search } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from 'react';
import { setTheme } from '@/app/actions';
import type { CommandAction } from '@/lib/commands';
import { shortcutTargets } from '@/lib/navigation';
import { sidebarCookie } from '@/lib/sidebar';
import { CommandPalette } from './command-palette';
import { RouteChangeWatcher, RouteProgressBar, useRouteProgress } from './route-progress';
import { ShortcutsDialog, singleKeyShortcutsEnabled } from './shortcuts-dialog';
import { Sidebar, SIDEBAR_ID } from './sidebar';
import { DESKTOP_QUERY } from './sidebar-tooltip';

/** Depois do "g", a segunda tecla do atalho vale por este tempo. */
const SEQUENCE_MS = 1200;

const focusRing =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring';

/** Campo de texto, seleção ou área editável: atalhos de uma tecla não valem ali. */
function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return target.closest('input, textarea, select, [role="combobox"]') !== null;
}

/**
 * Moldura do app (design system, docs/07 §5): menu lateral único à esquerda, fixo e recolhível
 * (no celular, gaveta), paleta de comandos, atalhos de teclado e a linha de progresso entre
 * telas. O estado recolhido chega do servidor (cookie), para a página não piscar ao carregar.
 */
export function AppShell({
  initialCollapsed,
  theme,
  children,
}: {
  initialCollapsed: boolean;
  /** Troca de tema (componente de servidor, lê o cookie do tema). */
  theme: ReactNode;
  children: ReactNode;
}) {
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [, startTransition] = useTransition();
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const { barRef, start: startProgress, finish: finishProgress } = useRouteProgress();

  const toggleCollapsed = useCallback(() => {
    const next = !collapsed;
    setCollapsed(next);
    document.cookie = sidebarCookie(next ? 'collapsed' : 'expanded');
  }, [collapsed]);

  const mainRef = useRef<HTMLElement>(null);
  /** Quem recebe o foco quando a paleta fecha (aberta pela gaveta, o botão dela some). */
  const paletteReturn = useRef<HTMLElement | null>(null);

  /**
   * Fecha a gaveta e põe o foco num lugar visível: no botão do menu (Esc, X, clique fora,
   * Ctrl+B) ou no conteúdo (escolheu uma tela). O `inert` sai no mesmo render, então o foco vai
   * no quadro seguinte.
   */
  const closeDrawer = useCallback((options?: { focus?: 'menu' | 'content' }) => {
    setDrawerOpen(false);
    const target = options?.focus;
    if (!target) return;
    window.requestAnimationFrame(() => {
      (target === 'menu' ? menuButtonRef.current : mainRef.current)?.focus({ preventScroll: true });
    });
  }, []);

  const navigate = useCallback(
    (href: string) => {
      if (href !== `${window.location.pathname}${window.location.search}`) startProgress();
      setDrawerOpen(false);
      router.push(href);
    },
    [router, startProgress],
  );

  const runCommand = useCallback(
    (action: CommandAction) => {
      switch (action.kind) {
        case 'navigate':
          navigate(action.href);
          return;
        case 'toggle-sidebar':
          toggleCollapsed();
          return;
        case 'shortcuts':
          setShortcutsOpen(true);
          return;
        case 'theme': {
          const form = new FormData();
          form.set('theme', action.theme);
          startTransition(async () => {
            await setTheme(form);
          });
          return;
        }
      }
    },
    [navigate, toggleCollapsed],
  );

  // Gaveta aberta: foco no botão de fechar, Esc fecha, a página atrás não rola.
  useEffect(() => {
    if (!drawerOpen) return;
    closeButtonRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      closeDrawer({ focus: 'menu' });
    };
    const desktop = window.matchMedia(DESKTOP_QUERY);
    const onResize = (event: MediaQueryListEvent) => {
      if (event.matches) setDrawerOpen(false);
    };
    const root = document.documentElement;
    const overflow = root.style.overflow;
    root.style.overflow = 'hidden';
    document.addEventListener('keydown', onKey);
    desktop.addEventListener('change', onResize);
    return () => {
      root.style.overflow = overflow;
      document.removeEventListener('keydown', onKey);
      desktop.removeEventListener('change', onResize);
    };
  }, [closeDrawer, drawerOpen]);

  // Atalhos globais: Ctrl+K, Ctrl+B e, se ligados, "?" e "g + letra".
  useEffect(() => {
    const targets = shortcutTargets();
    let sequenceAt = 0;
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat) return;
      const key = event.key.toLowerCase();
      const modifier = event.ctrlKey || event.metaKey;
      if (modifier && !event.altKey && !event.shiftKey && key === 'k') {
        // Aberta, a própria paleta fecha com Ctrl+K (e devolve o foco).
        if (paletteOpen) return;
        event.preventDefault();
        if (shortcutsOpen) return;
        setDrawerOpen(false);
        setPaletteOpen(true);
        return;
      }
      if (modifier && !event.altKey && !event.shiftKey && key === 'b') {
        if (paletteOpen || shortcutsOpen) return;
        event.preventDefault();
        if (window.matchMedia(DESKTOP_QUERY).matches) toggleCollapsed();
        else if (drawerOpen) closeDrawer({ focus: 'menu' });
        else setDrawerOpen(true);
        return;
      }
      if (modifier || event.altKey) return;
      if (paletteOpen || shortcutsOpen || drawerOpen || isTyping(event.target)) return;
      // Diálogo aberto por uma tela (confirmação, por exemplo): os atalhos não agem por baixo.
      if (document.querySelector('dialog[open]')) return;
      if (!singleKeyShortcutsEnabled()) return;
      if (event.key === '?') {
        event.preventDefault();
        setShortcutsOpen(true);
        return;
      }
      if (sequenceAt && Date.now() - sequenceAt < SEQUENCE_MS) {
        sequenceAt = 0;
        const target = targets.get(key);
        if (target) {
          event.preventDefault();
          navigate(target.href);
        }
        return;
      }
      sequenceAt = key === 'g' ? Date.now() : 0;
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [closeDrawer, drawerOpen, navigate, paletteOpen, shortcutsOpen, toggleCollapsed]);

  return (
    <>
      <RouteProgressBar barRef={barRef} />
      <Suspense fallback={null}>
        <RouteChangeWatcher onChange={finishProgress} />
      </Suspense>
      <div className="min-h-dvh p-2 sm:p-3">
        <div className="flex min-h-[calc(100dvh-1rem)] flex-col gap-4 rounded-[2rem] bg-background p-3 sm:min-h-[calc(100dvh-1.5rem)] sm:p-4 md:flex-row">
          {/* Topo do celular fixo ao rolar: o botão do menu fica sempre à mão. */}
          <header
            inert={drawerOpen}
            className="sticky top-2 z-30 -m-1 flex items-center gap-2 rounded-full bg-background/85 p-1 backdrop-blur-md md:hidden"
          >
            <button
              ref={menuButtonRef}
              type="button"
              onClick={() => setDrawerOpen(true)}
              aria-label="Abrir menu"
              aria-expanded={drawerOpen}
              aria-controls={SIDEBAR_ID}
              aria-haspopup="dialog"
              className={cn(
                'grid size-10 shrink-0 place-items-center rounded-full bg-surface text-foreground transition-colors hover:bg-muted',
                focusRing,
              )}
            >
              <Menu aria-hidden="true" className="size-[18px]" />
            </button>
            <Link
              href="/"
              className={cn(
                'inline-flex h-10 min-w-0 items-center gap-2 rounded-full bg-surface p-1 pr-4 text-base font-semibold tracking-tight text-foreground',
                focusRing,
              )}
            >
              <span
                aria-hidden="true"
                className="grid size-8 shrink-0 place-items-center rounded-full bg-[image:var(--tile-accent)] text-white"
              >
                <Radar className="size-4" strokeWidth={2.25} />
              </span>
              Prospector
            </Link>
            <button
              type="button"
              onClick={() => setPaletteOpen(true)}
              aria-label="Buscar ou ir para"
              aria-haspopup="dialog"
              className={cn(
                'ml-auto grid size-10 shrink-0 place-items-center rounded-full bg-surface text-muted-foreground transition-colors hover:text-foreground',
                focusRing,
              )}
            >
              <Search aria-hidden="true" className="size-[18px]" />
            </button>
          </header>

          {/* Fundo escurecido da gaveta (celular): clique fora fecha. */}
          <div
            aria-hidden="true"
            onClick={() => closeDrawer({ focus: 'menu' })}
            data-open={drawerOpen ? 'true' : 'false'}
            className="invisible fixed inset-0 z-40 bg-overlay opacity-0 transition-[opacity,visibility] duration-300 data-[open=true]:visible data-[open=true]:opacity-100 md:hidden"
          />

          <Sidebar
            collapsed={collapsed}
            drawerOpen={drawerOpen}
            onToggleCollapsed={toggleCollapsed}
            onCloseDrawer={closeDrawer}
            onOpenPalette={() => {
              if (drawerOpen) paletteReturn.current = menuButtonRef.current;
              setDrawerOpen(false);
              setPaletteOpen(true);
            }}
            closeButtonRef={closeButtonRef}
            theme={theme}
          />

          <main
            ref={mainRef}
            id="conteudo"
            tabIndex={-1}
            inert={drawerOpen}
            className="min-w-0 flex-1 outline-none"
          >
            {children}
          </main>
        </div>
      </div>
      {paletteOpen ? (
        <CommandPalette
          collapsed={collapsed}
          // Só montada depois de um clique ou atalho, então já roda no navegador.
          collapsible={window.matchMedia(DESKTOP_QUERY).matches}
          onClose={() => {
            setPaletteOpen(false);
            const target = paletteReturn.current;
            paletteReturn.current = null;
            if (target) window.requestAnimationFrame(() => target.focus());
          }}
          onRun={runCommand}
        />
      ) : null}
      {shortcutsOpen ? <ShortcutsDialog onClose={() => setShortcutsOpen(false)} /> : null}
    </>
  );
}
