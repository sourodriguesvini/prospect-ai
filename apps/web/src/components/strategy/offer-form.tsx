'use client';

import { Button } from '@prospector/ui';
import Link from 'next/link';
import { FormMessage, ListField, TextAreaField, TextField } from '@/components/forms/fields';
import { SubmitButton } from '@/components/forms/submit-button';
import { useActionForm, type FormAction } from '@/components/forms/use-action-form';
import type { FormValues } from '@/lib/form-data';

/** Conteúdo da oferta. Salvar uma oferta existente cria uma nova versão (a anterior fica igual). */
export function OfferForm({
  action,
  initial,
  submitLabel,
  cancelHref,
}: {
  action: FormAction;
  initial: FormValues;
  submitLabel: string;
  cancelHref: string;
}) {
  const { state, values, formAction } = useActionForm(action, initial);
  const field = { state, values };
  return (
    <form action={formAction} noValidate className="space-y-5">
      <FormMessage state={state} />
      <TextField name="name" label="Nome da oferta" required maxLength={120} {...field} />
      <TextAreaField
        name="description"
        label="Descrição"
        hint="Em uma ou duas frases, o que a agência entrega."
        {...field}
      />
      <div className="grid gap-5 md:grid-cols-2">
        <ListField
          name="problems"
          label="Problemas que resolve"
          example="Marca desatualizada em relação ao serviço"
          {...field}
        />
        <ListField
          name="needSignals"
          label="Sinais de necessidade"
          hint="O que, visto de fora, indica que a empresa precisa disso."
          {...field}
        />
        <ListField
          name="disqualifiers"
          label="Desqualificadores"
          hint="Quando NÃO vale abordar."
          {...field}
        />
        <ListField name="deliverables" label="Entregáveis" {...field} />
      </div>
      <ListField name="valueProps" label="Propostas de valor" rows={3} {...field} />
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Faixa de investimento (R$)</legend>
        <div className="grid gap-5 sm:grid-cols-2">
          <TextField
            name="priceMinCents"
            label="Mínimo"
            hint="Ex.: 15.000,00"
            inputMode="decimal"
            {...field}
          />
          <TextField
            name="priceMaxCents"
            label="Máximo"
            hint="Ex.: 40.000,00"
            inputMode="decimal"
            {...field}
          />
        </div>
      </fieldset>
      <div className="flex flex-wrap gap-2">
        <SubmitButton>{submitLabel}</SubmitButton>
        <Button asChild variant="ghost">
          <Link href={cancelHref}>Cancelar</Link>
        </Button>
      </div>
    </form>
  );
}
