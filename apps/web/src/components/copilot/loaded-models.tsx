'use client';

import type { LoadedModel } from '@prospector/contracts';
import { Button, Well } from '@prospector/ui';
import { useActionState, useEffect, useRef } from 'react';
import { useFormStatus } from 'react-dom';
import { unloadModel, type UnloadState } from '@/app/(shell)/copiloto/actions';
import { describeExpiry, formatGigabytes } from '@/lib/copilot';

const INITIAL: UnloadState = { error: null, unloaded: null };

/**
 * "Na memória agora": modelos carregados no Ollama e o botão para liberar a memória. A mensagem
 * de resultado fica nesta seção (o botão some junto com o modelo) e o foco volta ao título.
 */
export function LoadedModels({
  models,
  now,
  headingId,
}: {
  models: readonly LoadedModel[];
  /** ISO 8601 do momento da leitura no servidor, para "sai da memória em…". */
  now: string;
  headingId: string;
}) {
  const [state, action] = useActionState(unloadModel, INITIAL);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const at = new Date(now);

  useEffect(() => {
    if (state.unloaded) headingRef.current?.focus();
  }, [state]);

  return (
    <section aria-labelledby={headingId} className="space-y-2">
      <h3
        id={headingId}
        ref={headingRef}
        tabIndex={-1}
        className="text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        Na memória agora
      </h3>
      {/* Sempre montado (vazio fica só para leitor de tela): região viva precisa existir antes. */}
      <p role="status" className={state.unloaded ? 'text-xs text-muted-foreground' : 'sr-only'}>
        {state.unloaded ? `${state.unloaded} saiu da memória.` : ''}
      </p>
      {state.error ? (
        <p role="alert" className="text-xs text-danger">
          {state.error}
        </p>
      ) : null}
      {models.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nenhum modelo carregado. O primeiro pedido carrega o modelo em alguns segundos.
        </p>
      ) : (
        <ul className="space-y-2">
          {models.map((model) => {
            const expiry = describeExpiry(model.expiresAt, at);
            return (
              <li key={model.name}>
                <Well className="flex items-start justify-between gap-3 p-3">
                  <div className="min-w-0 space-y-0.5">
                    <p className="truncate text-sm font-medium" title={model.name}>
                      {model.name}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {formatGigabytes(model.vramBytes)} na GPU
                      {model.vramBytes < model.sizeBytes
                        ? ` · ${formatGigabytes(model.sizeBytes - model.vramBytes)} na RAM`
                        : ''}
                    </p>
                    {expiry ? <p className="text-xs text-muted-foreground">{expiry}</p> : null}
                  </div>
                  <form action={action}>
                    <input type="hidden" name="model" value={model.name} />
                    <FreeMemoryButton model={model.name} />
                  </form>
                </Well>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function FreeMemoryButton({ model }: { model: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="secondary" size="sm" disabled={pending} className="shrink-0">
      {pending ? 'Liberando…' : 'Liberar memória'}
      <span className="sr-only"> ocupada por {model}</span>
    </Button>
  );
}
