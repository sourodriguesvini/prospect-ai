'use client';

import { cn, DemoBadge } from '@prospector/ui';
import { CornerDownLeft, Search, X } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import {
  companyCommands,
  CompanySearchReply,
  CREATE_COMMANDS,
  filterCommands,
  interfaceCommands,
  screenCommands,
  searchInCompaniesCommand,
  type Command,
  type CommandAction,
  type CommandGroup,
  type CompanySearchHit,
} from '@/lib/commands';

const GROUP_ORDER: readonly CommandGroup[] = ['Telas', 'Empresas', 'Criar', 'Interface'];
/** Espera curta entre teclas antes de buscar empresas no servidor. */
const SEARCH_DELAY_MS = 180;

function Keys({ keys }: { keys: readonly string[] }) {
  if (keys.length === 0) return null;
  return (
    <span aria-hidden="true" className="flex shrink-0 items-center gap-1">
      {keys.map((key) => (
        <kbd
          key={key}
          className="min-w-5 rounded-md border bg-surface px-1.5 py-0.5 text-center font-sans text-[0.6875rem] leading-none text-muted-foreground"
        >
          {key}
        </kbd>
      ))}
    </span>
  );
}

/**
 * Paleta de comandos (Ctrl+K): ir a qualquer tela, achar uma empresa pelo nome ou CNPJ e rodar
 * ações da interface. Combobox com lista (WAI-ARIA APG): o foco fica no campo e as setas movem a
 * opção ativa. Diálogo nativo em modo modal: prende o foco, fecha com Esc ou clique fora e
 * devolve o foco a quem abriu.
 */
export function CommandPalette({
  collapsed,
  collapsible,
  onClose,
  onRun,
}: {
  collapsed: boolean;
  /** Falso no celular, onde o menu é gaveta e não recolhe. */
  collapsible: boolean;
  onClose: () => void;
  onRun: (action: CommandAction) => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [query, setQuery] = useState('');
  // A opção ativa é guardada pelo id: quando as empresas chegam do servidor no meio da lista, o
  // Enter continua abrindo o que estava destacado.
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [results, setResults] = useState<{
    query: string;
    hits: CompanySearchHit[];
    error: string | null;
  } | null>(null);
  const listId = useId();
  const optionId = (index: number) => `${listId}-opcao-${index}`;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  // Telas e ações filtram sem acento (filterCommands); o servidor recebe o texto como foi
  // digitado, porque o banco compara com os acentos do cadastro.
  const search = query.trim();
  useEffect(() => {
    if (search.length < 2) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/busca?q=${encodeURIComponent(search)}`, {
          signal: controller.signal,
          cache: 'no-store',
        });
        const body = CompanySearchReply.parse(await response.json());
        setResults({ query: search, hits: body.hits, error: body.error ?? null });
      } catch (error) {
        if (controller.signal.aborted) return;
        console.warn('[paleta] busca de empresas falhou', error);
        setResults({
          query: search,
          hits: [],
          error: 'Não foi possível buscar as empresas agora.',
        });
      }
    }, SEARCH_DELAY_MS);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [search]);

  const base = useMemo(
    () => [...screenCommands(), ...CREATE_COMMANDS, ...interfaceCommands(collapsed, collapsible)],
    [collapsed, collapsible],
  );
  const current = results && results.query === search ? results : null;
  const companies = useMemo(() => companyCommands(current?.hits ?? []), [current]);
  const items = useMemo(() => {
    const filtered = [...filterCommands(base, query), ...companies];
    // Nada achado: a próxima ação é buscar o texto na tela Empresas.
    if (filtered.length === 0 && search.length >= 2) return [searchInCompaniesCommand(search)];
    return GROUP_ORDER.flatMap((group) => filtered.filter((item) => item.group === group));
  }, [base, companies, query, search]);
  const positions = useMemo(() => new Map(items.map((item, i) => [item.id, i])), [items]);
  const keyed = activeKey === null ? -1 : (positions.get(activeKey) ?? -1);
  const activeIndex = items.length === 0 ? -1 : keyed >= 0 ? keyed : 0;
  const activeId = activeIndex >= 0 ? optionId(activeIndex) : undefined;

  useEffect(() => {
    if (activeId) document.getElementById(activeId)?.scrollIntoView({ block: 'nearest' });
  }, [activeId]);

  const run = (command: Command | undefined) => {
    if (!command) return;
    dialogRef.current?.close();
    onRun(command.action);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      dialogRef.current?.close();
      return;
    }
    if (items.length === 0) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveKey(items[(activeIndex + 1) % items.length]?.id ?? null);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveKey(items[(activeIndex - 1 + items.length) % items.length]?.id ?? null);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      run(items[activeIndex]);
    }
  };

  const searching = search.length >= 2 && current === null;
  const hasItems = items.length > 0;
  const error = current?.error ?? null;
  // Anúncio para leitor de tela (WCAG 4.1.3): quantos resultados, se ainda procura, ou o aviso.
  const announcement =
    query.trim() === ''
      ? ''
      : [
          hasItems
            ? `${items.length} ${items.length === 1 ? 'resultado' : 'resultados'}.`
            : 'Nada encontrado.',
          searching ? 'Procurando empresas…' : error,
        ]
          .filter(Boolean)
          .join(' ');

  return (
    <dialog
      ref={dialogRef}
      aria-label="Paleta de comandos"
      onClose={onClose}
      onClick={(event) => {
        // Clique no fundo escurecido (fora da caixa) fecha.
        if (event.target === event.currentTarget) dialogRef.current?.close();
      }}
      className="m-auto mt-[12vh] w-[min(38rem,calc(100vw-2rem))] max-w-none overflow-hidden rounded-[var(--radius-panel)] bg-surface p-0 text-foreground shadow-[var(--shadow-float)] backdrop:bg-overlay motion-safe:animate-float-in motion-safe:backdrop:animate-fade-in"
    >
      <div className="flex items-center gap-3 border-b px-4 has-[input:focus-visible]:bg-muted/40">
        <Search aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
        <input
          autoFocus
          role="combobox"
          aria-label="Buscar telas, empresas e ações"
          aria-expanded={hasItems}
          aria-controls={hasItems ? listId : undefined}
          aria-autocomplete="list"
          aria-activedescendant={activeId}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActiveKey(null);
          }}
          onKeyDown={onKeyDown}
          placeholder="Buscar telas, empresas e ações…"
          spellCheck={false}
          autoComplete="off"
          className="h-14 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground"
        />
        {/* Fechar: "Esc" com teclado; no toque, um X (sem teclado não há Esc). */}
        <button
          type="button"
          onClick={() => dialogRef.current?.close()}
          className="grid h-7 min-w-7 shrink-0 place-items-center rounded-md border px-1.5 font-sans text-[0.6875rem] leading-none text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring pointer-coarse:size-10 pointer-coarse:rounded-full pointer-coarse:border-0"
        >
          <span className="sr-only">Fechar </span>
          <span className="pointer-coarse:hidden">Esc</span>
          <X aria-hidden="true" className="hidden size-[18px] pointer-coarse:block" />
        </button>
      </div>

      {hasItems ? (
        <div
          id={listId}
          role="listbox"
          aria-label="Resultados"
          className="max-h-[min(26rem,60vh)] overflow-y-auto overscroll-contain p-2 [scrollbar-width:thin]"
        >
          {GROUP_ORDER.map((group) => {
            const groupItems = items.filter((item) => item.group === group);
            if (groupItems.length === 0) return null;
            return (
              <div key={group} role="group" aria-label={group} className="pb-1">
                <div
                  aria-hidden="true"
                  className="px-3 pt-2 pb-1 text-[0.6875rem] font-medium tracking-[0.08em] text-muted-foreground uppercase"
                >
                  {group}
                </div>
                {groupItems.map((item) => {
                  const itemIndex = positions.get(item.id) ?? 0;
                  const selected = itemIndex === activeIndex;
                  const Icon = item.icon;
                  return (
                    <div
                      key={item.id}
                      id={optionId(itemIndex)}
                      role="option"
                      aria-selected={selected}
                      data-command={item.id}
                      onMouseMove={() => {
                        if (!selected) setActiveKey(item.id);
                      }}
                      onClick={() => run(item)}
                      className={cn(
                        'flex cursor-pointer items-center gap-3 rounded-2xl px-3 py-2 text-sm transition-colors duration-100',
                        selected ? 'bg-primary text-primary-foreground' : 'text-foreground',
                      )}
                    >
                      <span
                        aria-hidden="true"
                        className={cn(
                          'grid size-8 shrink-0 place-items-center rounded-full',
                          selected ? 'bg-primary-foreground/15' : 'bg-muted',
                        )}
                      >
                        <Icon className="size-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className="truncate font-medium">{item.label}</span>
                          {item.demo ? (
                            <DemoBadge
                              className={cn(
                                'shrink-0',
                                // Na opção ativa (fundo de tinta) o selo herda a cor do texto.
                                selected && 'border-current text-primary-foreground',
                              )}
                            />
                          ) : null}
                        </span>
                        {item.hint ? (
                          <span
                            className={cn(
                              'block truncate text-xs',
                              selected ? 'text-primary-foreground/80' : 'text-muted-foreground',
                            )}
                          >
                            {item.hint}
                          </span>
                        ) : null}
                      </span>
                      {selected ? (
                        <CornerDownLeft aria-hidden="true" className="size-4 shrink-0" />
                      ) : (
                        <Keys keys={item.keys} />
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      ) : null}

      {!hasItems ? (
        <p className="px-5 py-6 text-center text-sm text-muted-foreground">
          {error ?? (searching ? 'Procurando…' : `Nada encontrado para “${query.trim()}”.`)}
        </p>
      ) : error ? (
        <p className="border-t px-5 py-2.5 text-xs text-muted-foreground">{error}</p>
      ) : null}
      <p role="status" className="sr-only">
        {announcement}
      </p>

      <div
        aria-hidden="true"
        className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t px-4 py-2.5 text-xs text-muted-foreground pointer-coarse:hidden"
      >
        <span>↑ ↓ para escolher</span>
        <span>Enter para abrir</span>
        <span>Esc para fechar</span>
        {searching ? <span className="ml-auto">Procurando empresas…</span> : null}
      </div>
    </dialog>
  );
}
