'use client';

import { SOCIAL_NETWORK_LABELS, SocialNetwork } from '@prospector/contracts';
import { Button } from '@prospector/ui';
import { useId } from 'react';
import { FormMessage, SelectField, TextField } from '@/components/forms/fields';
import { PendingAnnouncement } from '@/components/forms/pending-announcement';
import { SubmitButton } from '@/components/forms/submit-button';
import { useActionForm, type FormAction } from '@/components/forms/use-action-form';
import type { FormValues } from '@/lib/form-data';
import { SOCIAL_ROWS } from '@/lib/email-forms';

/**
 * Formulários de Configuração › E-mail (ADR-0016, fatia E3). A senha tem formulário próprio,
 * campo do tipo senha e nunca é reexibida.
 */

interface FormProps {
  action: FormAction;
  initial: FormValues;
}

const NETWORK_OPTIONS = [
  { value: '', label: 'Nenhuma' },
  ...SocialNetwork.options.map((network) => ({
    value: network,
    label: SOCIAL_NETWORK_LABELS[network],
  })),
];

export function IdentityForm({ action, initial }: FormProps) {
  const { state, values, formAction } = useActionForm(action, initial);
  const field = { state, values };
  return (
    <form action={formAction} noValidate className="space-y-5">
      <FormMessage state={state} />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField name="senderName" label="Nome" required maxLength={80} {...field} />
        <TextField
          name="role"
          label="Cargo"
          hint="Aparece abaixo do nome na assinatura."
          required
          maxLength={80}
          {...field}
        />
        <TextField name="studio" label="Estúdio" required maxLength={80} {...field} />
        <TextField
          name="location"
          label="Cidade"
          hint="Opcional. Ex.: Florianópolis, SC."
          maxLength={80}
          {...field}
        />
        <TextField
          name="email"
          label="E-mail na assinatura"
          type="email"
          inputMode="email"
          required
          maxLength={254}
          {...field}
        />
        <TextField
          name="whatsapp"
          label="WhatsApp"
          hint="Opcional. Como deve aparecer, ex.: (48) 99999-0000."
          inputMode="tel"
          maxLength={40}
          {...field}
        />
        <TextField
          name="website"
          label="Site"
          hint="Opcional. Endereço https://."
          inputMode="url"
          maxLength={300}
          {...field}
        />
        <TextField
          name="accent"
          label="Cor de destaque"
          hint="Código da cor com #, como #fa4e3e. Vai nos links e detalhes do e-mail."
          maxLength={7}
          {...field}
        />
        <TextField
          name="bannerUrl"
          label="Imagem da assinatura (faixa)"
          hint="Opcional. Endereço https:// de uma imagem já publicada no seu site. Alguns leitores de e-mail só a mostram depois que a pessoa permite."
          inputMode="url"
          maxLength={300}
          {...field}
        />
        <TextField
          name="bannerAlt"
          label="Descrição da imagem"
          hint="Obrigatória com a imagem: é o que aparece quando ela não carrega."
          maxLength={160}
          {...field}
        />
      </div>

      <fieldset className="space-y-3">
        <legend className="text-sm font-semibold">Redes sociais (até {SOCIAL_ROWS})</legend>
        <p className="text-sm text-muted-foreground">
          Cada rede precisa do link do perfil e do endereço https:// do ícone (imagem pequena já
          publicada). Deixe a linha em branco para não usar.
        </p>
        {Array.from({ length: SOCIAL_ROWS }, (_, index) => (
          // Cada linha é um grupo: o leitor de tela anuncia "Rede 2" antes de "Link do perfil".
          <fieldset key={index} className="grid gap-3 sm:grid-cols-[10rem_1fr_1fr]">
            <legend className="sr-only">Rede {index + 1}</legend>
            <SelectField
              name={`socials.${index}.network`}
              label={`Rede ${index + 1}`}
              options={NETWORK_OPTIONS}
              {...field}
            />
            <TextField
              name={`socials.${index}.url`}
              label="Link do perfil"
              inputMode="url"
              maxLength={300}
              {...field}
            />
            <TextField
              name={`socials.${index}.iconUrl`}
              label="Endereço do ícone (https://)"
              inputMode="url"
              maxLength={300}
              {...field}
            />
          </fieldset>
        ))}
      </fieldset>
      <SubmitButton>Salvar identidade</SubmitButton>
    </form>
  );
}

export function MailboxForm({ action, initial }: FormProps) {
  const { state, values, formAction } = useActionForm(action, initial);
  const field = { state, values };
  return (
    <form action={formAction} noValidate className="space-y-5">
      <FormMessage state={state} />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          name="address"
          label="Endereço que envia"
          hint="Do mesmo domínio do usuário abaixo. Um apelido da conta, como contato@, também vale."
          type="email"
          inputMode="email"
          required
          maxLength={254}
          {...field}
        />
        <TextField
          name="displayName"
          label="Nome do remetente"
          hint="Como aparece na caixa de entrada de quem recebe."
          required
          maxLength={80}
          {...field}
        />
        <TextField
          name="smtpHost"
          label="Servidor de envio (SMTP)"
          required
          maxLength={253}
          {...field}
        />
        <SelectField
          name="smtpPort"
          label="Porta SMTP"
          hint="465 (SSL) é o padrão da Hostinger; 587 usa STARTTLS."
          options={[
            { value: '465', label: '465 (SSL)' },
            { value: '587', label: '587 (STARTTLS)' },
          ]}
          {...field}
        />
        <TextField
          name="imapHost"
          label="Servidor de entrada (IMAP)"
          required
          maxLength={253}
          {...field}
        />
        <SelectField
          name="imapPort"
          label="Porta IMAP"
          options={[{ value: '993', label: '993 (SSL)' }]}
          {...field}
        />
        <TextField
          name="username"
          label="Usuário"
          hint="Na Hostinger, é o próprio endereço de e-mail."
          required
          maxLength={254}
          {...field}
        />
        <TextField
          name="dailyLimit"
          label="Limite de envios por dia"
          hint="De 1 a 50. Começar baixo protege a reputação do domínio."
          inputMode="numeric"
          required
          maxLength={2}
          {...field}
        />
      </div>
      <SubmitButton>Salvar caixa</SubmitButton>
    </form>
  );
}

export function PasswordForm({
  action,
  hasPassword,
}: {
  action: FormAction;
  hasPassword: boolean;
}) {
  const { state, formAction } = useActionForm(action, {});
  return (
    <form action={formAction} noValidate className="space-y-4">
      <FormMessage state={state} />
      <TextField
        name="password"
        label={hasPassword ? 'Nova senha da caixa' : 'Senha da caixa'}
        hint="A mesma do webmail. Fica guardada criptografada e o app nunca a mostra de volta."
        type="password"
        autoComplete="off"
        required
        maxLength={256}
        state={state}
        values={{}}
      />
      <SubmitButton pendingLabel="Gravando…">
        {hasPassword ? 'Trocar senha' : 'Gravar senha'}
      </SubmitButton>
    </form>
  );
}

/** Botão que dispara uma ação sem campos (testar conexão, enviar teste). */
export function ActionButtonForm({
  action,
  label,
  pendingLabel,
  pendingAnnouncement,
  blockedReason,
  hint,
  variant,
}: {
  action: FormAction;
  label: string;
  pendingLabel: string;
  /** Lido pelo leitor de tela durante a espera (a troca do rótulo do botão não é lida). */
  pendingAnnouncement: string;
  /**
   * Se preenchido, o botão fica indisponível e o motivo aparece ao lado. O botão continua
   * focável (`aria-disabled`), para quem navega por teclado encontrar o motivo.
   */
  blockedReason?: string | null;
  /** Explicação que vale mesmo com o botão disponível. */
  hint?: string | null;
  variant?: 'primary' | 'secondary';
}) {
  const { state, formAction } = useActionForm(action, {});
  const noteId = useId();
  const note = blockedReason ?? hint ?? null;
  return (
    <form action={formAction} className="space-y-3">
      <FormMessage state={state} />
      <PendingAnnouncement text={pendingAnnouncement} />
      <div className="flex flex-wrap items-center gap-3">
        {blockedReason ? (
          <Button
            type="button"
            variant={variant}
            aria-disabled="true"
            aria-describedby={noteId}
            className="cursor-not-allowed opacity-60"
          >
            {label}
          </Button>
        ) : (
          <SubmitButton
            pendingLabel={pendingLabel}
            variant={variant}
            aria-describedby={note ? noteId : undefined}
          >
            {label}
          </SubmitButton>
        )}
        {note ? (
          <span id={noteId} className="text-pretty text-sm text-muted-foreground">
            {note}
          </span>
        ) : null}
      </div>
    </form>
  );
}
