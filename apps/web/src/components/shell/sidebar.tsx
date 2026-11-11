'use client';

import { cn } from '@prospector/ui';
import { PanelLeftClose, PanelLeftOpen, Radar, Search, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import { activeHref, NAV_GROUPS, navLabel, showsChildren, type NavItem } from '@/lib/navigation';
import { useSidebarTooltip } from './sidebar-tooltip';
import { SystemStatus } from './system-status';

export const SIDEBAR_ID = 'menu-lateral';

const focusRing =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring';
/** Texto que some (sem sair do nome acessível) quando o menu está recolhido. */
const fade =
  'transition-opacity duration-200 ease-out md:group-data-[collapsed=true]/sidebar:opacity-0';

/** Elementos que recebem foco pelo Tab dentro da gaveta (para prender o foco nela). */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Tecla de atalho ao lado do texto; some em telas de toque, onde não há teclado. Faz parte do
 * nome acessível (o nome precisa conter o texto visível, WCAG 2.5.3).
 */
function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd
      className={cn(
        'shrink-0 rounded-md border bg-surface px-1.5 py-0.5 font-sans text-[0.6875rem] leading-none text-muted-foreground pointer-coarse:hidden',
        fade,
      )}
    >
      {children}
    </kbd>
  );
}

function shortcutHint(item: NavItem): string {
  return item.shortcut ? ` · G ${item.shortcut.toUpperCase()}` : '';
}

function SidebarLink({
  item,
  active,
  inSection,
  nested = false,
  onNavigate,
}: {
  item: NavItem;
  active: boolean;
  /** Pai de um subitem ativo: destaque leve, sem a pílula. */
  inSection: boolean;
  nested?: boolean;
  onNavigate: () => void;
}) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? 'page' : undefined}
      data-tip={`${navLabel(item)}${shortcutHint(item)}`}
      className={cn(
        'group/item flex items-center gap-1 overflow-hidden rounded-full pr-3 text-sm whitespace-nowrap transition-[background-color,color] duration-150',
        nested ? 'h-8' : 'h-9',
        'pointer-coarse:h-10',
        focusRing,
        active
          ? 'bg-primary font-medium text-primary-foreground'
          : inSection
            ? 'font-medium text-foreground hover:bg-muted'
            : 'text-muted-foreground hover:bg-muted hover:text-foreground',
      )}
    >
      <span className="grid w-9 shrink-0 place-items-center self-stretch">
        <Icon
          aria-hidden="true"
          className={cn(
            'transition-transform duration-200 ease-out motion-safe:group-hover/item:scale-110',
            nested ? 'size-4' : 'size-[18px]',
          )}
        />
      </span>
      <span className={cn('min-w-0 flex-1 truncate', fade)}>{item.label}</span>
      {item.plannedSlice ? (
        <>
          <span
            aria-hidden="true"
            className={cn(
              'shrink-0 rounded-full px-1.5 py-px text-[0.6875rem]',
              active ? 'bg-primary-foreground/15' : 'bg-muted',
              fade,
            )}
          >
            em breve
          </span>
          <span className="sr-only"> (em breve)</span>
        </>
      ) : null}
    </Link>
  );
}

/**
 * Menu lateral único (todos os menus à esquerda). Desktop: painel fixo que recolhe para só
 * ícones (com dica e nome acessível) e guarda a escolha em cookie. Celular: o mesmo painel vira
 * gaveta, aberta pelo botão do topo, com o foco preso enquanto aberta.
 */
export function Sidebar({
  collapsed,
  drawerOpen,
  onToggleCollapsed,
  onCloseDrawer,
  onOpenPalette,
  closeButtonRef,
  theme,
}: {
  collapsed: boolean;
  drawerOpen: boolean;
  onToggleCollapsed: () => void;
  onCloseDrawer: (options?: { focus?: 'menu' | 'content' }) => void;
  onOpenPalette: () => void;
  closeButtonRef: RefObject<HTMLButtonElement | null>;
  theme: ReactNode;
}) {
  const pathname = usePathname();
  const current = activeHref(pathname);
  const tooltip = useSidebarTooltip(collapsed);

  // Escolher um item fecha a gaveta e leva o foco ao conteúdo (no desktop não há gaveta).
  const onNavigate = () => {
    tooltip.hide();
    if (drawerOpen) onCloseDrawer({ focus: 'content' });
  };

  // O item da tela atual fica à vista, mesmo quando o menu rola (tela baixa ou recolhido).
  const navRef = useRef<HTMLElement>(null);
  useEffect(() => {
    // Rola só o menu (scrollIntoView também rolaria a página).
    const nav = navRef.current;
    const item = nav?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!nav || !item) return;
    const area = nav.getBoundingClientRect();
    const box = item.getBoundingClientRect();
    if (box.top < area.top) nav.scrollTop -= area.top - box.top + 8;
    else if (box.bottom > area.bottom) nav.scrollTop += box.bottom - area.bottom + 8;
  }, [current, collapsed]);

  const trapFocus = (event: KeyboardEvent<HTMLElement>) => {
    if (!drawerOpen || event.key !== 'Tab') return;
    const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
      (element) => element.getClientRects().length > 0,
    );
    const first = items[0];
    const last = items.at(-1);
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <>
      {/* div com papel explícito: complementar no desktop, diálogo enquanto é gaveta aberta. */}
      <div
        id={SIDEBAR_ID}
        aria-label="Menu lateral"
        role={drawerOpen ? 'dialog' : 'complementary'}
        aria-modal={drawerOpen ? true : undefined}
        data-collapsed={collapsed ? 'true' : 'false'}
        data-open={drawerOpen ? 'true' : 'false'}
        onKeyDown={trapFocus}
        {...tooltip.handlers}
        className={cn(
          'group/sidebar flex flex-col overflow-hidden bg-surface',
          // Celular: gaveta fora da tela até abrir. Ao abrir, fica visível na hora (para receber o
          // foco); ao fechar, só some depois de deslizar para fora.
          'invisible fixed inset-y-2 left-2 z-50 w-72 max-w-[calc(100vw-3rem)] -translate-x-[calc(100%+1rem)] rounded-[var(--radius-panel)] shadow-[var(--shadow-float)] transition-[translate,visibility] duration-300 ease-[var(--ease-out-soft)]',
          'data-[open=true]:visible data-[open=true]:translate-x-0 data-[open=true]:transition-[translate]',
          // Desktop: painel fixo na lateral, que recolhe para só ícones.
          'md:visible md:sticky md:inset-auto md:top-7 md:z-auto md:h-[calc(100dvh-3.5rem)] md:w-64 md:max-w-none md:shrink-0 md:translate-x-0 md:self-start md:shadow-[var(--shadow-panel)] md:transition-[width] md:duration-300',
          'md:data-[collapsed=true]:w-15',
        )}
      >
        <div className="flex h-14 shrink-0 items-center gap-2 px-3">
          <Link
            href="/"
            onClick={onNavigate}
            data-tip="Prospector · Início"
            className={cn(
              'flex min-w-0 items-center gap-2.5 overflow-hidden rounded-full pr-2 text-base font-semibold tracking-tight whitespace-nowrap text-foreground',
              focusRing,
            )}
          >
            <span
              aria-hidden="true"
              className="grid size-9 shrink-0 place-items-center rounded-full bg-[image:var(--tile-accent)] text-white"
            >
              <Radar className="size-4" strokeWidth={2.25} />
            </span>
            <span className={fade}>Prospector</span>
          </Link>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={() => onCloseDrawer({ focus: 'menu' })}
            aria-label="Fechar menu"
            className={cn(
              'ml-auto grid size-9 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground md:hidden',
              focusRing,
            )}
          >
            <X aria-hidden="true" className="size-[18px]" />
          </button>
        </div>

        <div className="shrink-0 px-3 pb-2">
          <button
            type="button"
            onClick={onOpenPalette}
            aria-keyshortcuts="Control+K"
            aria-haspopup="dialog"
            data-tip="Buscar ou ir para · Ctrl K"
            className={cn(
              'flex h-9 w-full items-center gap-1 overflow-hidden rounded-full bg-muted pr-2 text-sm whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground',
              focusRing,
            )}
          >
            <span className="grid size-9 shrink-0 place-items-center">
              <Search aria-hidden="true" className="size-4" />
            </span>
            <span className={cn('min-w-0 flex-1 truncate text-left', fade)}>
              Buscar ou ir para…
            </span>
            <Kbd>Ctrl K</Kbd>
          </button>
        </div>

        <nav
          ref={navRef}
          aria-label="Principal"
          className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain px-3 pb-3 scroll-shadow [scrollbar-width:thin]"
        >
          {NAV_GROUPS.map((group) => (
            <div key={group.id} className="pt-1.5">
              <p
                id={`menu-grupo-${group.id}`}
                className="relative flex h-6 items-center px-3 text-[0.6875rem] font-medium tracking-[0.08em] whitespace-nowrap text-muted-foreground uppercase"
              >
                <span className={fade}>{group.label}</span>
                <span
                  aria-hidden="true"
                  className="absolute inset-x-2 top-1/2 h-px bg-border opacity-0 transition-opacity duration-200 md:group-data-[collapsed=true]/sidebar:opacity-100"
                />
              </p>
              <ul aria-labelledby={`menu-grupo-${group.id}`} className="space-y-0.5">
                {group.items.map((item) => {
                  const open = showsChildren(pathname, item);
                  return (
                    <li key={item.href}>
                      <SidebarLink
                        item={item}
                        active={current === item.href}
                        inSection={open && current !== item.href}
                        onNavigate={onNavigate}
                      />
                      {open ? (
                        <ul
                          aria-label={`Seções de ${item.label}`}
                          className="relative mt-0.5 space-y-0.5 pl-6 transition-[padding] duration-300 before:absolute before:top-1 before:bottom-1 before:left-5 before:w-px before:bg-border motion-safe:animate-float-in md:group-data-[collapsed=true]/sidebar:rounded-[1.25rem] md:group-data-[collapsed=true]/sidebar:bg-muted md:group-data-[collapsed=true]/sidebar:py-0.5 md:group-data-[collapsed=true]/sidebar:pl-0.5 md:group-data-[collapsed=true]/sidebar:before:hidden"
                        >
                          {item.children.map((child) => (
                            <li key={child.href}>
                              <SidebarLink
                                item={child}
                                nested
                                active={current === child.href}
                                inSection={false}
                                onNavigate={onNavigate}
                              />
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        <div className="shrink-0 space-y-1.5 border-t px-3 pt-1.5 pb-3">
          <SystemStatus />
          {/* Recolher e tema na mesma linha; recolhido, o tema fica em pé e o botão embaixo. */}
          <div className="flex items-center gap-2 md:group-data-[collapsed=true]/sidebar:flex-col-reverse">
            <span className="flex-1 pl-3 text-xs text-muted-foreground md:hidden">Tema</span>
            <button
              type="button"
              onClick={() => {
                tooltip.hide();
                onToggleCollapsed();
              }}
              aria-expanded={!collapsed}
              aria-controls={SIDEBAR_ID}
              aria-keyshortcuts="Control+B"
              data-tip={collapsed ? 'Expandir menu · Ctrl B' : 'Recolher menu · Ctrl B'}
              data-tip-always=""
              className={cn(
                'hidden h-9 min-w-0 flex-1 items-center gap-1 overflow-hidden rounded-full pr-3 text-sm whitespace-nowrap text-muted-foreground transition-colors hover:bg-muted hover:text-foreground md:flex md:group-data-[collapsed=true]/sidebar:w-9 md:group-data-[collapsed=true]/sidebar:flex-none',
                focusRing,
              )}
            >
              <span className="grid size-9 shrink-0 place-items-center">
                {collapsed ? (
                  <PanelLeftOpen aria-hidden="true" className="size-[18px]" />
                ) : (
                  <PanelLeftClose aria-hidden="true" className="size-[18px]" />
                )}
              </span>
              <span className={cn('min-w-0 truncate', fade)}>
                {collapsed ? 'Expandir' : 'Recolher'}
                <span className="sr-only"> menu</span>
              </span>
            </button>
            {theme}
          </div>
        </div>
      </div>
      {tooltip.element}
    </>
  );
}
