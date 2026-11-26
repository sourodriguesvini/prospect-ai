'use client';

import type { OpportunityStage } from '@prospector/contracts';
import { useId } from 'react';
import {
  CheckboxField,
  FormMessage,
  SelectField,
  TextAreaField,
  TextField,
} from '@/components/forms/fields';
import { PendingAnnouncement } from '@/components/forms/pending-announcement';
import { SubmitButton } from '@/components/forms/submit-button';
import { useActionForm, type FormAction } from '@/components/forms/use-action-form';
import {
  ANY_CHANNEL_OPTIONS,
  FIRST_MESSAGE_KIND_OPTIONS,
  MESSAGE_KIND_OPTIONS,
  PRIORITY_OPTIONS,
  STAGE_OPTIONS,
  SUPPRESSION_REASON_OPTIONS,
  TASK_KIND_OPTIONS,
  TONE_OPTIONS,
  channelOptions,
} from '@/lib/relationship-labels';

/**
 * Formulários do Relacionamento (ADR-0014). Cada um chama uma Server Action de
 * `app/(shell)/relacionamento/actions.ts`; nenhum envia mensagem. Os que usam a IA local avisam
 * que a geração leva alguns segundos e que nada é gravado se ela falhar.
 */

type Option = { value: string; label: string };

const AI_PENDING = 'Gerando com a IA local… (pode levar até 1 minuto)';

export function PrepareApproachForm({
  action,
  offers,
  defaultOfferId,
}: {
  action: FormAction;
  offers: readonly Option[];
  defaultOfferId: string | null;
}) {
  const { state, values, formAction } = useActionForm(action, {
    offerId: defaultOfferId ?? offers[0]?.value ?? '',
    kind: 'initial_email',
    tone: 'consultative',
  });
  const field = { state, values, idScope: useId() };
  return (
    <form action={formAction} noValidate className="@container space-y-4">
      <FormMessage state={state} />
      <SelectField name="offerId" label="Oferta" options={offers} required {...field} />
      <div className="grid gap-4 @md:grid-cols-2">
        <SelectField
          name="kind"
          label="Primeira mensagem"
          options={FIRST_MESSAGE_KIND_OPTIONS}
          {...field}
        />
        <SelectField name="tone" label="Tom" options={TONE_OPTIONS} {...field} />
      </div>
      <TextAreaField
        name="instruction"
        label="Pedido para a IA (opcional)"
        hint='Ex.: "cite a nova unidade em Campinas", "mais curto". Vale só para este texto.'
        rows={2}
        {...field}
      />
      <SubmitButton pendingLabel={AI_PENDING}>Preparar mensagem</SubmitButton>
      <PendingAnnouncement text={AI_PENDING} />
      <p className="text-xs text-muted-foreground">
        A IA usa só o dossiê da empresa, a oferta, a voz da agência e os cases autorizados. O
        resultado é um rascunho: nada é enviado.
      </p>
    </form>
  );
}

export function OpenOpportunityForm({
  action,
  offers,
  defaultOfferId,
}: {
  action: FormAction;
  offers: readonly Option[];
  defaultOfferId: string | null;
}) {
  const { state, values, formAction } = useActionForm(action, {
    offerId: defaultOfferId ?? '',
  });
  const field = { state, values, idScope: useId() };
  return (
    <form action={formAction} noValidate className="space-y-3">
      <FormMessage state={state} />
      <SelectField
        name="offerId"
        label="Oferta (opcional)"
        options={[{ value: '', label: 'Definir depois' }, ...offers]}
        {...field}
      />
      <SubmitButton variant="secondary" pendingLabel="Abrindo…">
        Escrever sem a IA
      </SubmitButton>
    </form>
  );
}

export function StageForm({ action, current }: { action: FormAction; current: OpportunityStage }) {
  const { state, values, formAction } = useActionForm(action, { toStage: current });
  const field = { state, values, idScope: useId() };
  return (
    <form action={formAction} noValidate className="space-y-3">
      <FormMessage state={state} />
      <input type="hidden" name="fromStage" value={current} />
      <SelectField name="toStage" label="Mover para" options={STAGE_OPTIONS} {...field} />
      <TextField
        name="note"
        label="Observação"
        hint="Obrigatória ao marcar como perdida (o motivo). Fica no histórico."
        maxLength={300}
        {...field}
      />
      <SubmitButton size="sm" pendingLabel="Movendo…">
        Mudar etapa
      </SubmitButton>
    </form>
  );
}

export function OpportunityDetailsForm({
  action,
  offers,
  initial,
  closed,
}: {
  action: FormAction;
  offers: readonly Option[];
  initial: Record<string, string>;
  closed: boolean;
}) {
  const { state, values, formAction } = useActionForm(action, initial);
  const field = { state, values, idScope: useId() };
  return (
    <form action={formAction} noValidate className="@container space-y-4">
      <FormMessage state={state} />
      <div className="grid gap-4 @md:grid-cols-2">
        <SelectField
          name="offerId"
          label="Oferta"
          options={[{ value: '', label: 'Não definida' }, ...offers]}
          {...field}
        />
        <SelectField name="priority" label="Prioridade" options={PRIORITY_OPTIONS} {...field} />
      </div>
      <div className="grid gap-4 @md:grid-cols-2">
        <TextField
          name="valueEstimateCents"
          label="Valor estimado (R$)"
          hint="Só com base real: orçamento citado, proposta enviada. Nunca chute."
          inputMode="decimal"
          {...field}
        />
        <TextField
          name="valueBasis"
          label="De onde vem o valor"
          hint='Ex.: "orçamento citado na reunião de 10/11".'
          maxLength={300}
          {...field}
        />
      </div>
      <div className="grid gap-4 @md:grid-cols-2">
        <TextField name="nextAction" label="Próximo passo" maxLength={300} {...field} />
        <TextField name="nextActionDueAt" label="Até quando" type="date" {...field} />
      </div>
      {closed ? (
        <TextField name="lostReason" label="Motivo da perda" maxLength={300} {...field} />
      ) : null}
      <SubmitButton size="sm">Salvar detalhes</SubmitButton>
    </form>
  );
}

export function EditMessageForm({
  action,
  hasSubject,
  subject,
  body,
}: {
  action: FormAction;
  hasSubject: boolean;
  subject: string;
  body: string;
}) {
  const { state, values, formAction } = useActionForm(action, { subject, body });
  const field = { state, values, idScope: useId() };
  return (
    <form action={formAction} noValidate className="space-y-3">
      <FormMessage state={state} />
      {hasSubject ? <TextField name="subject" label="Assunto" maxLength={200} {...field} /> : null}
      <TextAreaField name="body" label="Texto" rows={10} required {...field} />
      <p className="text-xs text-muted-foreground">
        Salvar cria uma nova versão em rascunho. Uma aprovação anterior deixa de valer.
      </p>
      <SubmitButton size="sm">Salvar nova versão</SubmitButton>
    </form>
  );
}

export function RegenerateForm({ action, tone }: { action: FormAction; tone: string }) {
  const { state, values, formAction } = useActionForm(action, { tone });
  const field = { state, values, idScope: useId() };
  return (
    <form action={formAction} noValidate className="space-y-3">
      <FormMessage state={state} />
      <SelectField name="tone" label="Tom" options={TONE_OPTIONS} className="max-w-xs" {...field} />
      <TextAreaField
        name="instruction"
        label="O que mudar"
        hint='Ex.: "mais curto", "tire a pergunta final". Gera uma nova versão; a atual fica no histórico.'
        rows={2}
        {...field}
      />
      <SubmitButton size="sm" variant="secondary" pendingLabel={AI_PENDING}>
        Reescrever com a IA
      </SubmitButton>
      <PendingAnnouncement text={AI_PENDING} />
    </form>
  );
}

/** Estado do contato que a tela recebe do serviço (`OpportunityDetail.contact`). */
export interface ContactStateView {
  firstContact: boolean;
  awaitingFirstReply: boolean;
  whatsappOptIn: boolean;
}

/** O que o sistema acrescenta ao salvar, conforme o estado do contato (o rodapé obrigatório). */
function FooterHint({ contact }: { contact: ContactStateView }) {
  if (contact.firstContact) {
    return (
      <p className="text-xs text-muted-foreground">
        Primeiro contato: o texto precisa dizer quem é a agência. A frase de opt-out e o canal do
        titular da política de contato entram no fim ao salvar, se faltarem.
      </p>
    );
  }
  if (contact.awaitingFirstReply) {
    return (
      <p className="text-xs text-muted-foreground">
        A empresa ainda não respondeu: a frase de opt-out da política entra no fim ao salvar, se
        faltar.
      </p>
    );
  }
  return null;
}

export function NewMessageForm({
  action,
  contact,
  replyTo,
}: {
  action: FormAction;
  contact: ContactStateView;
  /** Respostas recebidas que a mensagem pode responder. */
  replyTo: readonly Option[];
}) {
  const { state, values, formAction } = useActionForm(action, {
    kind: contact.firstContact ? 'initial_email' : 'follow_up',
    tone: 'consultative',
    channel: 'email',
    replyToInteractionId: '',
  });
  const field = { state, values, idScope: useId() };
  return (
    <form action={formAction} noValidate className="@container space-y-4">
      <FormMessage state={state} />
      <div className="grid gap-4 @xl:grid-cols-3">
        <SelectField name="kind" label="Tipo" options={MESSAGE_KIND_OPTIONS} {...field} />
        <SelectField name="tone" label="Tom" options={TONE_OPTIONS} {...field} />
        <SelectField name="channel" label="Canal" options={channelOptions(contact)} {...field} />
      </div>
      {replyTo.length > 0 ? (
        <SelectField
          name="replyToInteractionId"
          label="Responde a"
          options={[{ value: '', label: 'Nenhuma resposta recebida' }, ...replyTo]}
          {...field}
        />
      ) : null}
      <TextAreaField name="instruction" label="Pedido para a IA (opcional)" rows={2} {...field} />
      <FooterHint contact={contact} />
      <SubmitButton size="sm" pendingLabel={AI_PENDING}>
        Escrever com a IA
      </SubmitButton>
      <PendingAnnouncement text={AI_PENDING} />
    </form>
  );
}

export function WriteMessageForm({
  action,
  contact,
}: {
  action: FormAction;
  contact: ContactStateView;
}) {
  const { state, values, formAction } = useActionForm(action, {
    kind: contact.firstContact ? 'initial_email' : 'follow_up',
    channel: 'email',
  });
  const field = { state, values, idScope: useId() };
  return (
    <form action={formAction} noValidate className="@container space-y-4">
      <FormMessage state={state} />
      <div className="grid gap-4 @md:grid-cols-2">
        <SelectField name="kind" label="Tipo" options={MESSAGE_KIND_OPTIONS} {...field} />
        <SelectField name="channel" label="Canal" options={channelOptions(contact)} {...field} />
      </div>
      <TextField name="subject" label="Assunto (e-mail)" maxLength={200} {...field} />
      <TextAreaField name="body" label="Texto" rows={8} required {...field} />
      <FooterHint contact={contact} />
      <SubmitButton size="sm" variant="secondary">
        Salvar rascunho
      </SubmitButton>
    </form>
  );
}

export function ApproveForm({
  action,
  channelPhrase,
}: {
  action: FormAction;
  /** O canal numa frase ("por e-mail"). */
  channelPhrase: string;
}) {
  const { state, values, formAction } = useActionForm(action, {});
  const field = { state, values, idScope: useId() };
  return (
    <form action={formAction} noValidate className="space-y-3">
      <FormMessage state={state} />
      <CheckboxField
        name="confirm"
        label={`Revisei este texto e aprovo o uso dele, exatamente como está, ${channelPhrase}.`}
        hint="A aprovação vale 72 horas, só para esta versão e para um contato. O Prospector não envia: você envia e registra o contato."
        {...field}
      />
      <SubmitButton size="sm" pendingLabel="Aprovando…">
        Aprovar para uso
      </SubmitButton>
    </form>
  );
}

export function ReasonForm({
  action,
  label,
  hint,
  submitLabel,
  minLength,
  destructive,
}: {
  action: FormAction;
  label: string;
  hint?: string;
  submitLabel: string;
  minLength?: number;
  destructive?: boolean;
}) {
  const { state, values, formAction } = useActionForm(action, {});
  const field = { state, values, idScope: useId() };
  return (
    <form action={formAction} noValidate className="space-y-3">
      <FormMessage state={state} />
      <TextField
        name="reason"
        label={label}
        hint={hint}
        minLength={minLength}
        maxLength={300}
        required
        {...field}
      />
      <SubmitButton size="sm" variant={destructive ? 'destructive' : 'secondary'}>
        {submitLabel}
      </SubmitButton>
    </form>
  );
}

export function RecordOutboundForm({
  action,
  now,
  offerMoveToContacted,
}: {
  action: FormAction;
  now: string;
  offerMoveToContacted: boolean;
}) {
  const { state, values, formAction } = useActionForm(action, {
    occurredAt: now,
    ...(offerMoveToContacted ? { moveToContacted: 'on' } : {}),
  });
  const field = { state, values, idScope: useId() };
  return (
    <form action={formAction} noValidate className="@container space-y-3">
      <FormMessage state={state} />
      <div className="grid gap-4 @md:grid-cols-2">
        <TextField
          name="occurredAt"
          label="Quando você enviou"
          type="datetime-local"
          required
          {...field}
        />
        <TextField
          name="counterpartRole"
          label="Para quem (função ou área)"
          hint="Ex.: sócia, marketing. Sem nome de pessoa."
          maxLength={120}
          {...field}
        />
      </div>
      {offerMoveToContacted ? (
        <CheckboxField
          name="moveToContacted"
          label="Mover a oportunidade para Contatada"
          {...field}
        />
      ) : null}
      <SubmitButton size="sm">Registrar contato feito</SubmitButton>
    </form>
  );
}

export function RecordInboundForm({
  action,
  now,
  offerMoveToConversation,
}: {
  action: FormAction;
  now: string;
  offerMoveToConversation: boolean;
}) {
  const { state, values, formAction } = useActionForm(action, {
    channel: 'email',
    occurredAt: now,
    ...(offerMoveToConversation ? { moveToInConversation: 'on' } : {}),
  });
  const field = { state, values, idScope: useId() };
  return (
    <form action={formAction} noValidate className="@container space-y-4">
      <FormMessage state={state} />
      <div className="grid gap-4 @md:grid-cols-2">
        <SelectField name="channel" label="Canal" options={ANY_CHANNEL_OPTIONS} {...field} />
        <TextField
          name="occurredAt"
          label="Quando chegou"
          type="datetime-local"
          required
          {...field}
        />
      </div>
      <TextAreaField
        name="body"
        label="O que a empresa respondeu"
        hint="Cole só o texto da resposta, sem assinatura, telefone ou e-mail. Fica guardado por 12 meses."
        rows={6}
        required
        {...field}
      />
      <TextField
        name="counterpartRole"
        label="Quem respondeu (função ou área)"
        hint="Sem nome de pessoa."
        maxLength={120}
        {...field}
      />
      {offerMoveToConversation ? (
        <CheckboxField
          name="moveToInConversation"
          label="Mover a oportunidade para Em conversa"
          {...field}
        />
      ) : null}
      <SubmitButton size="sm">Registrar resposta</SubmitButton>
      <p className="text-xs text-muted-foreground">
        Pedido para parar o contato é reconhecido na hora: a empresa entra na lista de supressão.
      </p>
    </form>
  );
}

export function NoteForm({ action, now }: { action: FormAction; now: string }) {
  const { state, values, formAction } = useActionForm(action, {
    channel: 'phone',
    occurredAt: now,
  });
  const field = { state, values, idScope: useId() };
  return (
    <form action={formAction} noValidate className="@container space-y-4">
      <FormMessage state={state} />
      <div className="grid gap-4 @md:grid-cols-2">
        <SelectField name="channel" label="Canal" options={ANY_CHANNEL_OPTIONS} {...field} />
        <TextField name="occurredAt" label="Quando" type="datetime-local" required {...field} />
      </div>
      <TextAreaField
        name="summary"
        label="Resumo"
        hint='Ex.: "Liguei; pediram para retomar em janeiro". Sem dados pessoais.'
        rows={3}
        required
        {...field}
      />
      <SubmitButton size="sm" variant="secondary">
        Registrar nota
      </SubmitButton>
    </form>
  );
}

export function TaskForm({
  action,
  defaultDue,
  defaultTitle,
  suggested,
}: {
  action: FormAction;
  defaultDue: string;
  defaultTitle?: string;
  /** Veio de uma sugestão (interpretação da resposta): fica registrado na origem. */
  suggested?: boolean;
}) {
  const { state, values, formAction } = useActionForm(action, {
    kind: 'follow_up',
    title: defaultTitle ?? '',
    dueAt: defaultDue,
  });
  const field = { state, values, idScope: useId() };
  return (
    <form action={formAction} noValidate className="@container space-y-4">
      <FormMessage state={state} />
      {suggested ? <input type="hidden" name="origin" value="suggested" /> : null}
      <div className="grid gap-4 @lg:grid-cols-3">
        <SelectField name="kind" label="Tipo" options={TASK_KIND_OPTIONS} {...field} />
        <TextField
          name="title"
          label="O que fazer"
          required
          maxLength={200}
          className="@lg:col-span-2"
          {...field}
        />
      </div>
      <div className="grid gap-4 @lg:grid-cols-3">
        <TextField name="dueAt" label="Data" type="date" required {...field} />
        <TextField
          name="notes"
          label="Notas (opcional)"
          maxLength={1000}
          className="@lg:col-span-2"
          {...field}
        />
      </div>
      <SubmitButton size="sm">Marcar follow-up</SubmitButton>
    </form>
  );
}

export function RescheduleForm({ action, dueAt }: { action: FormAction; dueAt: string }) {
  const { state, values, formAction } = useActionForm(action, { dueAt });
  const field = { state, values, idScope: useId() };
  return (
    <form action={formAction} noValidate className="flex flex-wrap items-end gap-2">
      <TextField
        name="dueAt"
        label="Nova data"
        type="date"
        required
        {...field}
        className="max-w-[11rem]"
      />
      <SubmitButton size="sm" variant="secondary">
        Remarcar
      </SubmitButton>
      <div className="basis-full">
        <FormMessage state={state} />
      </div>
    </form>
  );
}

export function SuppressForm({ action }: { action: FormAction }) {
  const { state, values, formAction } = useActionForm(action, { reason: 'manual' });
  const field = { state, values, idScope: useId() };
  return (
    <form action={formAction} noValidate className="space-y-3">
      <FormMessage state={state} />
      <SelectField name="reason" label="Motivo" options={SUPPRESSION_REASON_OPTIONS} {...field} />
      <SubmitButton size="sm" variant="destructive" pendingLabel="Aplicando…">
        Não contatar mais esta empresa
      </SubmitButton>
      <p className="text-xs text-muted-foreground">
        Vale também para empresas com a mesma raiz de CNPJ ou o mesmo domínio. Cancela os follow-ups
        abertos.
      </p>
    </form>
  );
}
