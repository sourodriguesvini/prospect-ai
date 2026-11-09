'use client';

import { CheckboxField, FormMessage, TextField } from '@/components/forms/fields';
import { SubmitButton } from '@/components/forms/submit-button';
import { useActionForm, type FormAction } from '@/components/forms/use-action-form';

/** Um botão de mudança de status (ativar, arquivar…), com o erro logo abaixo. */
export function StatusButton({
  action,
  label,
  variant = 'secondary',
}: {
  action: FormAction;
  label: string;
  variant?: 'primary' | 'secondary' | 'destructive';
}) {
  const { state, formAction } = useActionForm(action, {});
  return (
    <form action={formAction} className="space-y-3">
      <SubmitButton variant={variant} pendingLabel="Aplicando…">
        {label}
      </SubmitButton>
      {state.status === 'error' ? <FormMessage state={state} /> : null}
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
        hint="Depois dessa data, as abordagens ficam bloqueadas até uma nova aprovação (máximo de 24 meses)."
        min={minReviewDueOn}
        max={maxReviewDueOn}
        className="max-w-xs"
        {...field}
      />
      <CheckboxField
        name="confirmed"
        label={`Revisei a LIA v${version} e assumo esta avaliação.`}
        hint="O texto sugerido pelo sistema não substitui validação jurídica."
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
