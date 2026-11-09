'use client';

import { Alert } from '@prospector/ui';
import { useEffect, useRef } from 'react';
import type { FormState } from '@/lib/form-state';

/**
 * Resultado do envio. Cada resposta remonta a mensagem (`key` = `at`), então repetir o mesmo erro
 * ainda é anunciado; em erro, o foco vai para o resumo, que diz o que corrigir (WCAG 3.3.1).
 */
export function FormMessage({ state }: { state: FormState }) {
  if (state.status === 'idle') return null;
  return <Message key={state.at ?? 0} state={state} />;
}

function Message({ state }: { state: FormState }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (state.status === 'error') ref.current?.focus();
  }, [state.status]);

  if (state.status === 'saved') {
    return (
      <Alert tone="success" role="status">
        {state.message ?? 'Salvo.'}
      </Alert>
    );
  }
  if (state.status === 'unchanged') {
    return (
      <Alert tone="info" role="status" data-form-result="unchanged">
        {state.message}
      </Alert>
    );
  }
  const formErrors = state.fieldErrors?._form;
  return (
    <div
      ref={ref}
      tabIndex={-1}
      className="rounded-lg outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      <Alert tone="danger">
        <p className="font-medium">{state.message}</p>
        {formErrors && formErrors.length > 0 ? (
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {formErrors.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        ) : null}
      </Alert>
    </div>
  );
}
