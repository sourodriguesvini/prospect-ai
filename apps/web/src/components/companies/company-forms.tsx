'use client';

import { COMPANY_LIFECYCLE_LABELS, CompanyLifecycle } from '@prospector/contracts';
import { Alert } from '@prospector/ui';
import { useEffect, useRef } from 'react';
import { CheckboxField, FormMessage, SelectField, TextField } from '@/components/forms/fields';
import { SubmitButton } from '@/components/forms/submit-button';
import { useActionForm, type FormAction } from '@/components/forms/use-action-form';
import { text } from '@/lib/form-data';

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

/**
 * CNPJ de uma empresa já cadastrada sem ele: consulta a Receita e confere o nome. Se o nome na
 * Receita for outro, a resposta mostra os nomes e a caixa de confirmação aparece; só com ela
 * marcada o CNPJ é gravado.
 */
export function CnpjLinkForm({ action }: { action: FormAction }) {
  const { state, values, formAction } = useActionForm(action, {});
  const field = { state, values };
  // Nome diferente na Receita não é erro de digitação: vira um aviso com os nomes, e a caixa de
  // confirmação aparece sem a marca de campo inválido.
  const mismatch = state.status === 'error' ? (state.fieldErrors?.confirmName?.[0] ?? null) : null;
  const confirmField = mismatch
    ? {
        state: {
          ...state,
          fieldErrors: Object.fromEntries(
            Object.entries(state.fieldErrors ?? {}).filter(([key]) => key !== 'confirmName'),
          ),
        },
        values,
      }
    : field;
  const asksConfirmation = Boolean(mismatch) || 'confirmName' in values;
  return (
    <form action={formAction} noValidate className="space-y-4">
      {mismatch ? (
        <NameMismatch key={state.at ?? 0} message={mismatch} />
      ) : (
        <FormMessage state={state} />
      )}
      <TextField
        name="cnpj"
        label="CNPJ da empresa"
        hint="Com ou sem pontuação. O Prospector consulta a Receita e confere se o nome é desta empresa. Ao vincular, razão social, cidade/UF, CNAE e porte do cadastro passam a ser os da Receita."
        required
        inputMode="text"
        maxLength={18}
        {...field}
      />
      {asksConfirmation ? (
        <>
          {/* A confirmação vale só para o CNPJ que foi conferido; outro CNPJ é conferido de novo. */}
          <input type="hidden" name="confirmedFor" value={text(values, 'cnpj')} />
          <CheckboxField
            name="confirmName"
            label="É a mesma empresa: vincular mesmo com o nome diferente na Receita"
            {...confirmField}
          />
        </>
      ) : null}
      <SubmitButton variant="secondary" pendingLabel="Consultando a Receita…">
        Consultar e vincular
      </SubmitButton>
    </form>
  );
}

/** Aviso de nome diferente na Receita: recebe o foco, como o resumo de erro (WCAG 3.3.1). */
function NameMismatch({ message }: { message: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return (
    <div
      ref={ref}
      tabIndex={-1}
      className="rounded-lg outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      <Alert tone="warning" role="alert" data-cnpj-name-mismatch>
        <p className="font-medium">Confira o nome antes de vincular</p>
        <p className="mt-1">{message}</p>
      </Alert>
    </div>
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
