'use client';

import { ROLE_LABELS, type InvitableRole } from '@prospector/contracts';
import { Alert, Button, Input, NativeSelect } from '@prospector/ui';
import { useActionState } from 'react';
import { inviteMember, type InvitationCreated } from '@/app/o/[slug]/configuracoes/equipe/actions';
import { CopyButton } from '@/components/copy-button';
import { describedBy, Field } from '@/components/field';
import { FormStatus } from '@/components/form-status';
import { fieldErrorsOf, IDLE, valueOf, type ActionState } from '@/lib/action-state';
import { formatDateTime } from '@/lib/format';
import { useFocusFirstInvalid } from '@/lib/use-focus-first-invalid';

export function InviteMemberForm({
  orgId,
  roles,
}: {
  orgId: string;
  roles: readonly InvitableRole[];
}) {
  const [state, action, pending] = useActionState<ActionState<InvitationCreated>, FormData>(
    inviteMember,
    IDLE,
  );
  const formRef = useFocusFirstInvalid(state);
  const emailErrors = fieldErrorsOf(state, 'email');
  const roleErrors = fieldErrorsOf(state, 'role');

  return (
    <div className="space-y-5">
      {state.status === 'success' && state.data ? (
        <Alert tone="success" className="space-y-3">
          <p>
            Convite criado para <strong>{state.data.email}</strong>. Envie este link à pessoa por um
            canal seu — ele aparece só agora e expira em {formatDateTime(state.data.expiresAt)}.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              id="invite-link"
              readOnly
              value={state.data.link}
              aria-label="Link do convite"
              className="h-8 flex-1 font-mono text-xs"
              onFocus={(event) => event.currentTarget.select()}
            />
            <CopyButton value={state.data.link} targetId="invite-link" label="Copiar link" />
          </div>
        </Alert>
      ) : (
        <FormStatus state={state} />
      )}
      <form
        ref={formRef}
        action={action}
        className="grid gap-4 sm:grid-cols-[1fr_12rem_auto] sm:items-start"
        noValidate
      >
        <input type="hidden" name="orgId" value={orgId} />
        <Field id="invite-email" label="E-mail" errors={emailErrors}>
          <Input
            id="invite-email"
            name="email"
            type="email"
            autoComplete="off"
            required
            defaultValue={valueOf(state, 'email')}
            {...describedBy('invite-email', emailErrors)}
          />
        </Field>
        <Field id="invite-role" label="Papel" errors={roleErrors}>
          <NativeSelect
            id="invite-role"
            name="role"
            defaultValue={valueOf(state, 'role') ?? 'operator'}
            {...describedBy('invite-role', roleErrors)}
          >
            {roles.map((role) => (
              <option key={role} value={role}>
                {ROLE_LABELS[role]}
              </option>
            ))}
          </NativeSelect>
        </Field>
        {/* Alinha com os campos (altura do rótulo), mesmo quando um erro aparece abaixo deles. */}
        <Button type="submit" disabled={pending} className="sm:mt-[1.625rem]">
          {pending ? 'Criando…' : 'Criar convite'}
        </Button>
      </form>
    </div>
  );
}
