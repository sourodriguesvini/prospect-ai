'use client';

import { PASSWORD_MIN_LENGTH } from '@prospector/contracts';
import { Button, Input } from '@prospector/ui';
import { useActionState } from 'react';
import { signUp } from '@/app/(auth)/actions';
import { describedBy, Field } from '@/components/field';
import { FormStatus } from '@/components/form-status';
import { fieldErrorsOf, IDLE, valueOf, type ActionState } from '@/lib/action-state';
import { useFocusFirstInvalid } from '@/lib/use-focus-first-invalid';

export function SignUpForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(signUp, IDLE);
  const formRef = useFocusFirstInvalid(state);
  if (state.status === 'success') return <FormStatus state={state} />;

  const nameErrors = fieldErrorsOf(state, 'fullName');
  const emailErrors = fieldErrorsOf(state, 'email');
  const passwordErrors = fieldErrorsOf(state, 'password');
  const passwordHint = `Ao menos ${PASSWORD_MIN_LENGTH} caracteres. Uma frase longa é mais segura que símbolos.`;

  return (
    <form ref={formRef} action={action} className="space-y-5" noValidate>
      <input type="hidden" name="next" value={next} />
      <FormStatus state={state} />
      <Field id="fullName" label="Nome" errors={nameErrors}>
        <Input
          id="fullName"
          name="fullName"
          autoComplete="name"
          required
          defaultValue={valueOf(state, 'fullName')}
          {...describedBy('fullName', nameErrors)}
        />
      </Field>
      <Field id="email" label="E-mail de trabalho" errors={emailErrors}>
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
      <Field id="password" label="Senha" hint={passwordHint} errors={passwordErrors}>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={PASSWORD_MIN_LENGTH}
          required
          {...describedBy('password', passwordErrors, true)}
        />
      </Field>
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? 'Criando conta…' : 'Criar conta'}
      </Button>
    </form>
  );
}
