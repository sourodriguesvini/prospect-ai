'use client';

import { UF } from '@prospector/contracts';
import { Button } from '@prospector/ui';
import Link from 'next/link';
import {
  CheckboxGroup,
  FormMessage,
  ListField,
  TextAreaField,
  TextField,
} from '@/components/forms/fields';
import { SubmitButton } from '@/components/forms/submit-button';
import { useActionForm, type FormAction } from '@/components/forms/use-action-form';
import type { FormValues } from '@/lib/form-data';
import { COMPANY_SIZE_LABELS } from '@/lib/strategy-labels';

const UF_OPTIONS = UF.options.map((uf) => ({ value: uf, label: uf }));
const SIZE_OPTIONS = Object.entries(COMPANY_SIZE_LABELS).map(([value, label]) => ({
  value,
  label,
}));

/** Filtros e exclusões do ICP. Salvar um ICP existente cria uma nova versão. */
export function IcpForm({
  action,
  initial,
  submitLabel,
  cancelHref,
}: {
  action: FormAction;
  initial: FormValues;
  submitLabel: string;
  cancelHref?: string;
}) {
  const { state, values, formAction } = useActionForm(action, initial);
  const field = { state, values };
  return (
    <form action={formAction} noValidate className="space-y-6">
      <FormMessage state={state} />
      <div className="grid gap-5 md:grid-cols-2">
        <TextField name="name" label="Nome do ICP" required maxLength={120} {...field} />
        <TextAreaField name="description" label="Descrição" rows={2} {...field} />
      </div>

      <fieldset className="space-y-5 rounded-[var(--radius-tile)] border p-4">
        <legend className="px-1 text-sm font-semibold">Quem entra</legend>
        <p className="text-xs text-muted-foreground">
          Para ativar, informe ao menos um CNAE, UF ou município.
        </p>
        <div className="grid gap-5 md:grid-cols-2">
          <ListField
            name="filters.cnaes"
            label="CNAEs (subclasse)"
            example="8630-5/04"
            {...field}
          />
          <ListField
            name="filters.municipalities"
            label="Municípios"
            example="Curitiba/PR"
            {...field}
          />
        </div>
        <CheckboxGroup
          name="filters.ufs"
          label="UFs"
          options={UF_OPTIONS}
          columns="grid-cols-[repeat(auto-fill,minmax(3.75rem,1fr))] gap-x-3"
          {...field}
        />
        <CheckboxGroup
          name="filters.sizes"
          label="Porte (Receita Federal)"
          hint="MEI fica fora: os dados do MEI são dados de pessoa física."
          options={SIZE_OPTIONS}
          columns="sm:grid-cols-3"
          {...field}
        />
        <div className="grid gap-5 sm:grid-cols-2">
          <TextField
            name="filters.minAgeYears"
            label="Idade mínima da empresa (anos)"
            inputMode="numeric"
            {...field}
          />
          <TextField
            name="filters.maxAgeYears"
            label="Idade máxima da empresa (anos)"
            inputMode="numeric"
            {...field}
          />
        </div>
      </fieldset>

      <fieldset className="space-y-5 rounded-[var(--radius-tile)] border p-4">
        <legend className="px-1 text-sm font-semibold">Quem fica de fora</legend>
        <div className="grid gap-5 md:grid-cols-2">
          <ListField name="exclusions.cnaes" label="CNAEs excluídos" {...field} />
          <ListField
            name="exclusions.municipalities"
            label="Municípios excluídos"
            example="Colombo/PR"
            {...field}
          />
          <ListField
            name="exclusions.cnpjRoots"
            label="Raízes de CNPJ excluídas"
            hint="Os 8 primeiros caracteres (clientes atuais, concorrentes)."
            {...field}
          />
          <ListField
            name="exclusions.domains"
            label="Domínios excluídos"
            example="empresa.com.br"
            {...field}
          />
        </div>
      </fieldset>

      <div className="flex flex-wrap gap-2">
        <SubmitButton>{submitLabel}</SubmitButton>
        {cancelHref ? (
          <Button asChild variant="ghost">
            <Link href={cancelHref}>Cancelar</Link>
          </Button>
        ) : null}
      </div>
    </form>
  );
}
