'use client';

import { Button } from '@prospector/ui';
import Link from 'next/link';
import { useActionState } from 'react';
import { confirmEmailLink } from '@/app/(auth)/actions';
import { FormStatus } from '@/components/form-status';
import { IDLE, type ActionState } from '@/lib/action-state';

export function ConfirmEmailForm({
  tokenHash,
  type,
  code,
  next,
}: {
  tokenHash: string | undefined;
  type: string | undefined;
  code: string | undefined;
  next: string;
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(confirmEmailLink, IDLE);
  return (
    <form action={action} className="space-y-5">
      {tokenHash ? <input type="hidden" name="token_hash" value={tokenHash} /> : null}
      {type ? <input type="hidden" name="type" value={type} /> : null}
      {code ? <input type="hidden" name="code" value={code} /> : null}
      <input type="hidden" name="next" value={next} />
      <FormStatus state={state} />
      {state.status === 'error' ? (
        <p className="text-sm">
          <Link href="/entrar" className="underline underline-offset-4">
            Ir para a tela de entrada
          </Link>
        </p>
      ) : (
        <Button type="submit" className="w-full" disabled={pending}>
          {pending ? 'Confirmando…' : 'Confirmar e entrar'}
        </Button>
      )}
    </form>
  );
}
