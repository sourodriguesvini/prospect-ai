'use client';

import type { CopilotThread } from '@prospector/contracts';
import { Button, Input, cn } from '@prospector/ui';
import { Archive, ArchiveRestore, Pencil, Plus } from 'lucide-react';
import Link from 'next/link';
import { useActionState, useEffect, useId, useRef, useState } from 'react';
import {
  renameThread,
  setThreadArchived,
  type ThreadActionState,
} from '@/app/(shell)/copiloto/actions';

const when = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'America/Sao_Paulo',
});

const INITIAL: ThreadActionState = { error: null, at: 0 };

/**
 * Conversas salvas do Copiloto (IA-2): abrir, renomear e arquivar. Arquivar não apaga; as
 * arquivadas ficam numa lista à parte e podem voltar.
 */
export function ThreadList({
  threads,
  archived,
  currentId,
}: {
  threads: readonly CopilotThread[];
  archived: readonly CopilotThread[];
  currentId: string | null;
}) {
  return (
    <div className="space-y-3">
      <Link
        href="/copiloto"
        className="inline-flex h-8 items-center gap-1.5 rounded-full bg-primary px-3 text-xs font-medium text-primary-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <Plus aria-hidden="true" className="size-3.5" />
        Nova conversa
      </Link>
      {threads.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nenhuma conversa salva ainda. A primeira pergunta cria uma.
        </p>
      ) : (
        <ul className="space-y-1" aria-label="Conversas salvas">
          {threads.map((thread) => (
            <ThreadItem key={thread.id} thread={thread} current={thread.id === currentId} />
          ))}
        </ul>
      )}
      {archived.length > 0 ? (
        <details className="text-sm">
          <summary className="cursor-pointer text-muted-foreground">
            Arquivadas ({archived.length})
          </summary>
          <ul className="mt-2 space-y-1">
            {archived.map((thread) => (
              <li key={thread.id} className="flex items-center justify-between gap-2 px-2 py-1">
                <Link
                  href={`/copiloto?conversa=${thread.id}`}
                  className="min-w-0 truncate text-muted-foreground underline-offset-2 hover:underline"
                >
                  {thread.title}
                </Link>
                <form action={setThreadArchived}>
                  <input type="hidden" name="threadId" value={thread.id} />
                  <input type="hidden" name="archived" value="0" />
                  <Button
                    type="submit"
                    variant="ghost"
                    size="sm"
                    aria-label={`Restaurar ${thread.title}`}
                  >
                    <ArchiveRestore aria-hidden="true" className="size-3.5" />
                  </Button>
                </form>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

function ThreadItem({ thread, current }: { thread: CopilotThread; current: boolean }) {
  const [editing, setEditing] = useState(false);
  const [state, action, pending] = useActionState(renameThread, INITIAL);
  const inputRef = useRef<HTMLInputElement>(null);
  const errorId = useId();
  const [seenAt, setSeenAt] = useState(0);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  // Resposta nova da ação: se renomeou sem erro, fecha o campo (ajuste durante a renderização,
  // sem efeito: https://react.dev/learn/you-might-not-need-an-effect).
  if (state.at !== seenAt) {
    setSeenAt(state.at);
    if (state.error === null && state.at !== 0) setEditing(false);
  }

  if (editing) {
    return (
      <li className="rounded-[var(--radius-tile)] bg-muted p-2">
        <form action={action} className="space-y-2">
          <input type="hidden" name="threadId" value={thread.id} />
          <label className="sr-only" htmlFor={`${errorId}-title`}>
            Nome da conversa
          </label>
          <Input
            id={`${errorId}-title`}
            ref={inputRef}
            name="title"
            defaultValue={thread.title}
            maxLength={120}
            required
            aria-invalid={state.error ? true : undefined}
            aria-describedby={state.error ? errorId : undefined}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setEditing(false);
            }}
            className="h-8 text-sm"
          />
          {state.error ? (
            <p id={errorId} role="alert" className="text-xs text-danger">
              {state.error}
            </p>
          ) : null}
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={pending}>
              Salvar
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(false)}>
              Cancelar
            </Button>
          </div>
        </form>
      </li>
    );
  }

  return (
    <li
      className={cn(
        'group flex items-center gap-1 rounded-[var(--radius-tile)] px-2 py-1.5',
        current ? 'bg-muted' : 'hover:bg-muted/60',
      )}
    >
      <Link
        href={`/copiloto?conversa=${thread.id}`}
        aria-current={current ? 'page' : undefined}
        className="min-w-0 flex-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <span className={cn('block truncate text-sm', current && 'font-medium')}>
          {thread.title}
        </span>
        <span className="block text-xs text-muted-foreground">
          {when.format(new Date(thread.lastActivityAt))} · {thread.messageCount}{' '}
          {thread.messageCount === 1 ? 'mensagem' : 'mensagens'}
        </span>
      </Link>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => setEditing(true)}
        aria-label={`Renomear ${thread.title}`}
      >
        <Pencil aria-hidden="true" className="size-3.5" />
      </Button>
      <form action={setThreadArchived}>
        <input type="hidden" name="threadId" value={thread.id} />
        <input type="hidden" name="archived" value="1" />
        <input type="hidden" name="current" value={current ? '1' : '0'} />
        <Button type="submit" variant="ghost" size="sm" aria-label={`Arquivar ${thread.title}`}>
          <Archive aria-hidden="true" className="size-3.5" />
        </Button>
      </form>
    </li>
  );
}
