'use client';

import { LiaDataCategory, LiaDataSource } from '@prospector/contracts';
import { Button } from '@prospector/ui';
import Link from 'next/link';
import {
  CheckboxField,
  CheckboxGroup,
  FormMessage,
  ListField,
  SelectField,
  TextAreaField,
  TextField,
} from '@/components/forms/fields';
import { SubmitButton } from '@/components/forms/submit-button';
import { useActionForm, type FormAction } from '@/components/forms/use-action-form';
import type { FormValues } from '@/lib/form-data';
import { LIA_CATEGORY_LABELS, LIA_SOURCE_LABELS } from '@/lib/strategy-labels';

interface FormProps {
  action: FormAction;
  initial: FormValues;
  submitLabel: string;
  cancelHref?: string;
}

function Actions({ submitLabel, cancelHref }: { submitLabel: string; cancelHref?: string }) {
  return (
    <div className="flex flex-wrap gap-2">
      <SubmitButton>{submitLabel}</SubmitButton>
      {cancelHref ? (
        <Button asChild variant="ghost">
          <Link href={cancelHref}>Cancelar</Link>
        </Button>
      ) : null}
    </div>
  );
}

/** Voz da agência: orienta a redação das mensagens (F10). */
export function VoiceForm({ action, initial, submitLabel, cancelHref }: FormProps) {
  const { state, values, formAction } = useActionForm(action, initial);
  const field = { state, values };
  return (
    <form action={formAction} noValidate className="space-y-5">
      <FormMessage state={state} />
      <TextAreaField
        name="summary"
        label="Resumo da voz"
        hint="Como a agência soa, em poucas frases."
        required
        {...field}
      />
      <div className="grid gap-5 md:grid-cols-2">
        <ListField
          name="principles"
          label="Princípios"
          example="Falar do negócio do cliente"
          {...field}
        />
        <ListField name="avoid" label="Evitar" example="Jargão de agência" {...field} />
      </div>
      <div className="grid gap-5 md:grid-cols-2">
        <TextAreaField
          name="goodExamples"
          label="Exemplos bons"
          hint='Separe exemplos com uma linha contendo só "---".'
          rows={6}
          {...field}
        />
        <TextAreaField
          name="badExamples"
          label="Exemplos ruins"
          hint='Separe exemplos com uma linha contendo só "---".'
          rows={6}
          {...field}
        />
      </div>
      <Actions submitLabel={submitLabel} cancelHref={cancelHref} />
    </form>
  );
}

/** Case da agência. Só case citável (com autorização registrada) pode ir para mensagens. */
export function ProofAssetForm({
  action,
  initial,
  submitLabel,
  cancelHref,
  offers,
}: FormProps & { offers: readonly { value: string; label: string }[] }) {
  const { state, values, formAction } = useActionForm(action, initial);
  const field = { state, values };
  return (
    <form action={formAction} noValidate className="space-y-5">
      <FormMessage state={state} />
      <div className="grid gap-5 md:grid-cols-2">
        <TextField name="title" label="Título" required maxLength={120} {...field} />
        <TextField name="segment" label="Segmento do cliente" maxLength={120} {...field} />
      </div>
      <SelectField
        name="offerId"
        label="Oferta relacionada"
        options={[{ value: '', label: 'Nenhuma (vale para todas)' }, ...offers]}
        {...field}
      />
      <TextAreaField name="summary" label="Resumo" required {...field} />
      <TextAreaField name="results" label="Resultados" {...field} />
      <div className="space-y-3 rounded-[var(--radius-tile)] border p-4">
        <CheckboxField
          name="publicOk"
          label="O cliente autorizou citar este case em mensagens"
          hint="Sem autorização registrada, o case fica só para uso interno."
          {...field}
        />
        <TextField
          name="consentRef"
          label="Onde está a autorização"
          hint='Ex.: "e-mail do cliente de 03/2026, pasta Contratos". Obrigatório para case citável.'
          maxLength={300}
          {...field}
        />
      </div>
      <Actions submitLabel={submitLabel} cancelHref={cancelHref} />
    </form>
  );
}

const CATEGORY_OPTIONS = LiaDataCategory.options.map((value) => ({
  value,
  label: LIA_CATEGORY_LABELS[value],
}));
const SOURCE_OPTIONS = LiaDataSource.options.map((value) => ({
  value,
  label: LIA_SOURCE_LABELS[value],
}));

/** LIA guiada (docs/12 §4): finalidade, necessidade, balanceamento e salvaguardas. */
export function LiaForm({ action, initial, submitLabel, cancelHref }: FormProps) {
  const { state, values, formAction } = useActionForm(action, initial);
  const field = { state, values };
  return (
    <form action={formAction} noValidate className="space-y-6">
      <FormMessage state={state} />
      <fieldset className="space-y-5">
        <legend className="text-base font-semibold">1. Finalidade e interesse legítimo</legend>
        <TextAreaField
          name="purpose"
          label="Finalidade"
          hint="Para que os dados pessoais serão usados."
          required
          {...field}
        />
        <TextAreaField
          name="legitimateInterest"
          label="Interesse legítimo"
          hint="Qual o interesse concreto da agência e por que ele é legítimo."
          required
          {...field}
        />
      </fieldset>
      <fieldset className="space-y-5">
        <legend className="text-base font-semibold">2. Necessidade e minimização</legend>
        <TextAreaField
          name="necessity"
          label="Necessidade"
          hint="Por que esses dados são necessários e quais alternativas menos intrusivas foram consideradas."
          required
          {...field}
        />
        <CheckboxGroup
          name="dataCategories"
          label="Dados pessoais tratados"
          hint="Lista fechada: sem CPF, sem dados sensíveis, sem contato pessoal."
          options={CATEGORY_OPTIONS}
          required
          {...field}
        />
        <CheckboxGroup
          name="dataSources"
          label="Origem dos dados"
          options={SOURCE_OPTIONS}
          required
          {...field}
        />
      </fieldset>
      <fieldset className="space-y-5">
        <legend className="text-base font-semibold">3. Balanceamento</legend>
        <TextAreaField
          name="expectations"
          label="Expectativa do titular"
          hint="A pessoa contatada esperaria esse uso dos dados dela?"
          required
          {...field}
        />
        <TextAreaField name="risks" label="Riscos e impactos para o titular" required {...field} />
      </fieldset>
      <fieldset className="space-y-5">
        <legend className="text-base font-semibold">4. Salvaguardas e conclusão</legend>
        <TextAreaField
          name="safeguards"
          label="Salvaguardas"
          hint="Transparência, opt-out, retenção, supressão, volume."
          required
          {...field}
        />
        <TextAreaField
          name="conclusion"
          label="Conclusão"
          hint="Escrita por você: o interesse legítimo prevalece sobre os direitos do titular, com essas salvaguardas? Por quê?"
          required
          {...field}
        />
      </fieldset>
      <Actions submitLabel={submitLabel} cancelHref={cancelHref} />
    </form>
  );
}

/** Identificação, canal do titular e texto de opt-out exigidos em toda primeira mensagem. */
export function ContactPolicyForm({ action, initial, submitLabel, cancelHref }: FormProps) {
  const { state, values, formAction } = useActionForm(action, initial);
  const field = { state, values };
  return (
    <form action={formAction} noValidate className="space-y-5">
      <FormMessage state={state} />
      <TextField
        name="agencyName"
        label="Nome da agência"
        hint="Como a agência se identifica nas mensagens."
        required
        maxLength={120}
        {...field}
      />
      <TextField
        name="privacyContact"
        label="Canal do titular"
        hint="E-mail ou endereço https onde a pessoa pede acesso, correção ou exclusão dos dados."
        required
        maxLength={200}
        {...field}
      />
      <TextAreaField
        name="optOutText"
        label="Texto de opt-out"
        hint="Vai em toda mensagem. Precisa dizer como deixar de receber, de forma simples."
        required
        {...field}
      />
      <Actions submitLabel={submitLabel} cancelHref={cancelHref} />
    </form>
  );
}
