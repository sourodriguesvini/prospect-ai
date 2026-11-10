'use client';

import { Button } from '@prospector/ui';
import { useEffect, useId, useRef, useState } from 'react';
import { CheckboxField, FormMessage, TextField } from '@/components/forms/fields';
import { SubmitButton } from '@/components/forms/submit-button';
import { useActionForm, type FormAction } from '@/components/forms/use-action-form';

/**
 * Um botão de mudança de status (ativar, arquivar…), com o erro logo abaixo. Com `confirm`
 * (ações que não se desfazem), o primeiro clique só mostra a pergunta e o botão de confirmar fica
 * com a cor de perigo; Cancelar ou Esc fecham a pergunta e devolvem o foco ao botão (KI-050).
 */
export function StatusButton({
  action,
  label,
  variant = 'secondary',
  confirm,
  pendingLabel = 'Aplicando…',
}: {
  action: FormAction;
  label: string;
  variant?: 'primary' | 'secondary' | 'destructive';
  confirm?: string;
  pendingLabel?: string;
}) {
  const { state, formAction } = useActionForm(action, {});
  const [asking, setAsking] = useState(false);
  // Quando a pergunta abriu: o erro de uma tentativa anterior não reaparece ao abrir de novo.
  const [askedAt, setAskedAt] = useState(0);
  const questionId = useId();
  const questionRef = useRef<HTMLParagraphElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);

  useEffect(() => {
    if (asking) {
      questionRef.current?.focus();
    } else if (returnFocus.current) {
      returnFocus.current = false;
      triggerRef.current?.focus();
    }
  }, [asking]);

  function open() {
    setAskedAt(Date.now());
    setAsking(true);
  }

  function cancel() {
    returnFocus.current = true;
    setAsking(false);
  }

  if (confirm && !asking) {
    return (
      <Button ref={triggerRef} variant={variant} onClick={open}>
        {label}
      </Button>
    );
  }
  const showError = state.status === 'error' && (!confirm || (state.at ?? 0) > askedAt);
  return (
    <form
      action={formAction}
      className="space-y-3"
      onKeyDown={
        confirm
          ? (event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                cancel();
              }
            }
          : undefined
      }
    >
      {confirm ? (
        <p
          id={questionId}
          ref={questionRef}
          tabIndex={-1}
          className="rounded-sm text-sm font-medium outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          {confirm}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <SubmitButton
          variant={confirm ? 'destructive' : variant}
          pendingLabel={pendingLabel}
          aria-describedby={confirm ? questionId : undefined}
        >
          {confirm ? `Sim, ${label.charAt(0).toLowerCase()}${label.slice(1)}` : label}
        </SubmitButton>
        {confirm ? (
          <Button variant="ghost" onClick={cancel}>
            Cancelar
          </Button>
        ) : null}
      </div>
      {showError ? <FormMessage state={state} /> : null}
    </form>
  );
}

/** Aprovar a versão mais recente da LIA: data da próxima revisão e confirmação explícita. */
export function ApproveLiaForm({
  action,
  version,
  suggestedReviewDueOn,
  minReviewDueOn,
  maxReviewDueOn,
}: {
  action: FormAction;
  version: number;
  suggestedReviewDueOn: string;
  minReviewDueOn: string;
  maxReviewDueOn: string;
}) {
  const { state, values, formAction } = useActionForm(action, {
    reviewDueOn: suggestedReviewDueOn,
  });
  const field = { state, values };
  return (
    <form action={formAction} noValidate className="space-y-4">
      <FormMessage state={state} />
      <TextField
        name="reviewDueOn"
        type="date"
        label="Próxima revisão"
        hint="Depois dessa data, as abordagens ficam bloqueadas até uma nova aprovação. Padrão: 12 meses. Sem parecer jurídico, não passe disso; o sistema aceita no máximo 24 meses."
        min={minReviewDueOn}
        max={maxReviewDueOn}
        className="max-w-xs"
        {...field}
      />
      <CheckboxField
        name="confirmed"
        label={`Revisei a LIA v${version} e assumo esta avaliação.`}
        hint="O texto padrão do sistema não substitui validação jurídica."
        {...field}
      />
      <SubmitButton pendingLabel="Aprovando…">Aprovar LIA v{version}</SubmitButton>
    </form>
  );
}

/** Revogar a LIA em vigor bloqueia as abordagens na hora. */
export function RevokeLiaForm({ action, version }: { action: FormAction; version: number }) {
  const { state, values, formAction } = useActionForm(action, {});
  return (
    <form action={formAction} noValidate className="space-y-4">
      <FormMessage state={state} />
      <CheckboxField
        name="confirmed"
        label="Entendo que, sem LIA em vigor, todas as ações de abordagem ficam bloqueadas."
        state={state}
        values={values}
      />
      <SubmitButton variant="destructive" pendingLabel="Revogando…">
        Revogar LIA v{version}
      </SubmitButton>
    </form>
  );
}
