'use client';

import { FormMessage } from '@/components/forms/form-message';
import { SubmitButton } from '@/components/forms/submit-button';
import { useActionForm, type FormAction } from '@/components/forms/use-action-form';

/**
 * "Investigar de novo" na lista de acompanhamento (ADR-0017: reinvestigação só com o clique da
 * pessoa). Põe a investigação na fila e leva ao dossiê, onde ela acompanha o andamento. O nome da
 * empresa vai no nome acessível: a lista tem um botão destes por linha.
 */
export function ReinvestigateButton({
  action,
  companyName,
}: {
  action: FormAction;
  companyName: string;
}) {
  const { state, formAction } = useActionForm(action, {});
  return (
    <form action={formAction} className="space-y-2">
      <SubmitButton variant="secondary" size="sm" pendingLabel="Pondo na fila…">
        Investigar de novo<span className="sr-only">: {companyName}</span>
      </SubmitButton>
      {state.status === 'error' ? <FormMessage state={state} /> : null}
    </form>
  );
}
