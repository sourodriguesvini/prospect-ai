'use client';

import { suggestSlug } from '@prospector/domain';
import { Button, Input } from '@prospector/ui';
import { useActionState, useState } from 'react';
import { createOrganization } from '@/app/app/actions';
import { describedBy, Field } from '@/components/field';
import { FormStatus } from '@/components/form-status';
import { fieldErrorsOf, IDLE, valueOf, type ActionState } from '@/lib/action-state';
import { useFocusFirstInvalid } from '@/lib/use-focus-first-invalid';

export function CreateOrganizationForm() {
  const [state, action, pending] = useActionState<ActionState, FormData>(createOrganization, IDLE);
  const [slug, setSlug] = useState(valueOf(state, 'slug') ?? '');
  const [slugEdited, setSlugEdited] = useState(false);
  const formRef = useFocusFirstInvalid(state);
  const nameErrors = fieldErrorsOf(state, 'name');
  const slugErrors = fieldErrorsOf(state, 'slug');

  return (
    <form ref={formRef} action={action} className="space-y-5" noValidate>
      <FormStatus state={state} />
      <Field id="name" label="Nome da organização" errors={nameErrors}>
        <Input
          id="name"
          name="name"
          required
          maxLength={120}
          defaultValue={valueOf(state, 'name')}
          onChange={(event) => {
            if (!slugEdited) setSlug(suggestSlug(event.target.value));
          }}
          {...describedBy('name', nameErrors)}
        />
      </Field>
      <Field
        id="slug"
        label="Endereço na web"
        hint={`Fica em /o/${slug || 'endereco'}. Letras minúsculas, números e hífens.`}
        errors={slugErrors}
      >
        <Input
          id="slug"
          name="slug"
          required
          maxLength={48}
          value={slug}
          onChange={(event) => {
            setSlugEdited(true);
            setSlug(event.target.value);
          }}
          {...describedBy('slug', slugErrors, true)}
        />
      </Field>
      <Button type="submit" disabled={pending}>
        {pending ? 'Criando…' : 'Criar organização'}
      </Button>
    </form>
  );
}
