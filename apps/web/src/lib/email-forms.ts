import type { Mailbox, SenderIdentityContent } from '@prospector/contracts';
import { requiredInt, text, type FormValues } from './form-data';

/**
 * Formulários do e-mail (ADR-0016): campos (texto) ↔ entradas dos contratos. Os nomes dos campos
 * são os caminhos do contrato, para os erros caírem no campo certo. A senha tem formulário próprio
 * e nunca volta para a tela.
 */

export const EMAIL_SETTINGS_HREF = '/configuracoes/email';

/** Linhas de rede social no formulário (o contrato aceita até 5). */
export const SOCIAL_ROWS = 5;

/** Ponto de partida da caixa: a da Hostinger (decisão do usuário, 2026-11-25). */
export const HOSTINGER_PRESET = {
  smtpHost: 'smtp.hostinger.com',
  smtpPort: '465',
  imapHost: 'imap.hostinger.com',
  imapPort: '993',
  dailyLimit: '20',
} as const;

const socialField = (index: number, key: 'network' | 'url' | 'iconUrl') =>
  `socials.${index}.${key}`;

/**
 * Identidade a partir do formulário. Linhas de rede em branco ficam de fora; `rows` diz de qual
 * linha veio cada rede, para o erro voltar à linha certa (`remapSocialErrors`).
 */
export function identityInput(v: FormValues): { input: Record<string, unknown>; rows: number[] } {
  const socials: Record<string, string>[] = [];
  const rows: number[] = [];
  for (let index = 0; index < SOCIAL_ROWS; index += 1) {
    const network = text(v, socialField(index, 'network')).trim();
    const url = text(v, socialField(index, 'url')).trim();
    const iconUrl = text(v, socialField(index, 'iconUrl')).trim();
    if (!network && !url && !iconUrl) continue;
    socials.push({ network, url, iconUrl });
    rows.push(index);
  }
  return {
    input: {
      senderName: text(v, 'senderName'),
      role: text(v, 'role'),
      studio: text(v, 'studio'),
      location: text(v, 'location'),
      website: text(v, 'website'),
      whatsapp: text(v, 'whatsapp'),
      email: text(v, 'email'),
      bannerUrl: text(v, 'bannerUrl'),
      bannerAlt: text(v, 'bannerAlt'),
      socials,
      accent: text(v, 'accent') || '#fa4e3e',
    },
    rows,
  };
}

/** `socials.1.url` do contrato → `socials.<linha do formulário>.url`. */
export function remapSocialErrors(
  fieldErrors: Record<string, string[]>,
  rows: readonly number[],
): Record<string, string[]> {
  const remapped: Record<string, string[]> = {};
  for (const [key, messages] of Object.entries(fieldErrors)) {
    const match = /^socials\.(\d+)(\..*)?$/.exec(key);
    const row = match ? rows[Number(match[1])] : undefined;
    const target = match && row !== undefined ? `socials.${row}${match[2] ?? ''}` : key;
    remapped[target] = [...(remapped[target] ?? []), ...messages];
  }
  return remapped;
}

export function identityValues(content: SenderIdentityContent | null): FormValues {
  const values: FormValues = {
    senderName: content?.senderName ?? '',
    role: content?.role ?? '',
    studio: content?.studio ?? '',
    location: content?.location ?? '',
    website: content?.website ?? '',
    whatsapp: content?.whatsapp ?? '',
    email: content?.email ?? '',
    bannerUrl: content?.bannerUrl ?? '',
    bannerAlt: content?.bannerAlt ?? '',
    accent: content?.accent ?? '#fa4e3e',
  };
  content?.socials.forEach((social, index) => {
    values[socialField(index, 'network')] = social.network;
    values[socialField(index, 'url')] = social.url;
    values[socialField(index, 'iconUrl')] = social.iconUrl;
  });
  return values;
}

export function mailboxInput(v: FormValues) {
  return {
    address: text(v, 'address'),
    displayName: text(v, 'displayName'),
    smtpHost: text(v, 'smtpHost'),
    smtpPort: requiredInt(text(v, 'smtpPort')),
    imapHost: text(v, 'imapHost'),
    imapPort: requiredInt(text(v, 'imapPort')),
    username: text(v, 'username'),
    dailyLimit: requiredInt(text(v, 'dailyLimit')),
  };
}

export function mailboxValues(mailbox: Mailbox | null): FormValues {
  if (!mailbox) return { address: '', displayName: '', username: '', ...HOSTINGER_PRESET };
  return {
    address: mailbox.address,
    displayName: mailbox.displayName,
    smtpHost: mailbox.smtpHost,
    smtpPort: String(mailbox.smtpPort),
    imapHost: mailbox.imapHost,
    imapPort: String(mailbox.imapPort),
    username: mailbox.username,
    dailyLimit: String(mailbox.dailyLimit),
  };
}
