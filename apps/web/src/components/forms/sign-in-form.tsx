'use client';

import { Button, Input } from '@prospector/ui';
import { useActionState } from 'react';
import { signIn } from '@/app/(auth)/actions';
import { describedBy, Field } from '@/components/field';
import { FormStatus } from '@/components/form-status';
import { fieldErrorsOf, IDLE, valueOf, type ActionState } from '@/lib/action-state';
import { useFocusFirstInvalid } from '@/lib/use-focus-first-invalid';

export function SignInForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(signIn, IDLE);
  const formRef = useFocusFirstInvalid(state);
  const emailErrors = fieldErrorsOf(state, 'email');
  const passwordErrors = fieldErrorsOf(state, 'password');

  return (
    <form ref={formRef} action={action} className="space-y-5" noValidate>
      <input type="hidden" name="next" value={next} />
      <FormStatus state={state} />
      <Field id="email" label="E-mail" errors={emailErrors}>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          defaultValue={valueOf(state, 'email')}
          {...describedBy('email', emailErrors)}
        />
      </Field>
      <Field id="password" label="Senha" errors={passwordErrors}>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          {...describedBy('password', passwordErrors)}
        />
      </Field>
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? 'Entrando…' : 'Entrar'}
      </Button>
    </form>
  );
}
