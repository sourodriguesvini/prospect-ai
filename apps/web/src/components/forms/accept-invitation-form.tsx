'use client';

import { Button } from '@prospector/ui';
import { useActionState } from 'react';
import { acceptInvitation } from '@/app/convite/[token]/actions';
import { FormStatus } from '@/components/form-status';
import { IDLE, type ActionState } from '@/lib/action-state';

export function AcceptInvitationForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(acceptInvitation, IDLE);
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="token" value={token} />
      <FormStatus state={state} />
      <Button type="submit" disabled={pending}>
        {pending ? 'Aceitando…' : 'Aceitar convite'}
      </Button>
    </form>
  );
}
