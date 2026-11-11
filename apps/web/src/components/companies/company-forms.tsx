'use client';

import { COMPANY_LIFECYCLE_LABELS, CompanyLifecycle } from '@prospector/contracts';
import { FormMessage, SelectField, TextField } from '@/components/forms/fields';
import { SubmitButton } from '@/components/forms/submit-button';
import { useActionForm, type FormAction } from '@/components/forms/use-action-form';

/** Cadastro pelo CNPJ: consulta a base aberta da Receita e grava os fatos com a fonte. */
export function CnpjImportForm({ action }: { action: FormAction }) {
  const { state, values, formAction } = useActionForm(action, {});
  const field = { state, values };
  return (
    <form action={formAction} noValidate className="space-y-5">
      <FormMessage state={state} />
      <div className="grid gap-5 md:grid-cols-2">
        <TextField
          name="importCnpj"
          label="CNPJ para consultar"
          hint="Com ou sem pontuação. Aceita o CNPJ com letras."
          required
          inputMode="text"
          maxLength={18}
          {...field}
        />
        <TextField
          name="importName"
          label="Como chamar a empresa"
          hint="Opcional. Vazio: usa o nome fantasia ou, sem ele, a razão social."
          maxLength={160}
          {...field}
        />
      </div>
      <SubmitButton pendingLabel="Consultando a Receita…">Consultar e cadastrar</SubmitButton>
    </form>
  );
}

/** Cadastro manual: nada é verificado; os dados ficam como informados. */
export function ManualCompanyForm({ action }: { action: FormAction }) {
  const { state, values, formAction } = useActionForm(action, {});
  const field = { state, values };
  return (
    <form action={formAction} noValidate className="space-y-5">
      <FormMessage state={state} />
      <TextField name="displayName" label="Nome da empresa" required maxLength={160} {...field} />
      <div className="grid gap-5 md:grid-cols-2">
        <TextField name="cnpj" label="CNPJ" hint="Opcional." maxLength={18} {...field} />
        <TextField
          name="primaryDomain"
          label="Site"
          hint="Opcional. Ex.: exemplo.com.br"
          maxLength={253}
          {...field}
        />
      </div>
      <div className="grid gap-5 md:grid-cols-[1fr_8rem]">
        <TextField name="city" label="Cidade" maxLength={80} {...field} />
        <TextField name="uf" label="UF" maxLength={2} autoCapitalize="characters" {...field} />
      </div>
      <SubmitButton variant="secondary" pendingLabel="Cadastrando…">
        Cadastrar à mão
      </SubmitButton>
    </form>
  );
}

const LIFECYCLE_OPTIONS = CompanyLifecycle.options.map((value) => ({
  value,
  label: COMPANY_LIFECYCLE_LABELS[value],
}));

/** Etapa da empresa no funil do Prospector. Só muda por decisão sua, nunca pela IA. */
export function LifecycleForm({ action, current }: { action: FormAction; current: string }) {
  const { state, values, formAction } = useActionForm(action, { lifecycle: current });
  return (
    <form action={formAction} noValidate className="space-y-4">
      <FormMessage state={state} />
      <SelectField
        name="lifecycle"
        label="Etapa"
        hint="Arquivada sai da lista e não recebe novas consultas."
        options={LIFECYCLE_OPTIONS}
        className="max-w-xs"
        state={state}
        values={values}
      />
      <SubmitButton variant="secondary" pendingLabel="Salvando…">
        Salvar etapa
      </SubmitButton>
    </form>
  );
}
