import { z } from 'zod';
import { Email, Uuid } from './common';

/**
 * Contratos do e-mail (ADR-0016, fatia E3): identidade de quem assina, caixa de envio e resultado
 * da conferência (login SMTP/IMAP, SPF, DKIM, DMARC). A senha só entra por `MailboxPasswordInput`
 * e nunca sai: nenhum contrato de leitura a carrega. Mensagens em pt-BR (chegam aos formulários).
 */

const REQUIRED = 'Campo obrigatório.';

function maxChars(max: number) {
  return { error: `Use no máximo ${max} caracteres.` };
}

function text(max: number) {
  return z.string({ error: REQUIRED }).trim().min(1, { error: REQUIRED }).max(max, maxChars(max));
}

/** Texto opcional: vazio vira null. */
function optionalText(max: number) {
  return z
    .string()
    .trim()
    .max(max, maxChars(max))
    .transform((value) => value || null)
    .nullable()
    .default(null);
}

/**
 * Nome de host público: com ponto, sem IP literal e fora dos nomes só locais. O app roda só neste
 * computador (ADR-0007) e não conecta a destinos privados.
 */
export function isPublicHostname(host: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, '');
  if (!h.includes('.') || h.length > 253) return false;
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(h)) return false;
  if (/^[\d.]+$/.test(h)) return false;
  const localSuffixes = ['localhost', 'local', 'internal', 'lan', 'home.arpa', 'test', 'invalid'];
  return !localSuffixes.some((suffix) => h === suffix || h.endsWith(`.${suffix}`));
}

const HttpsUrl = z
  .string()
  .trim()
  .max(300, maxChars(300))
  .refine(
    (value) => {
      if (!/^https:\/\/[^\s"'<>`]+$/i.test(value)) return false;
      try {
        const url = new URL(value);
        return (
          url.protocol === 'https:' &&
          !url.username &&
          !url.password &&
          isPublicHostname(url.hostname)
        );
      } catch {
        return false;
      }
    },
    { error: 'Use um endereço https:// público.' },
  );

const OptionalHttpsUrl = z
  .union([z.literal(''), HttpsUrl])
  .transform((value) => value || null)
  .nullable()
  .default(null);

const Hostname = z
  .string({ error: REQUIRED })
  .trim()
  .toLowerCase()
  .min(1, { error: REQUIRED })
  .refine(isPublicHostname, {
    error: 'Use o nome do servidor (ex.: smtp.hostinger.com), sem IP nem nome local.',
  })
  .transform((host) => host.replace(/\.$/, ''));

// -----------------------------------------------------------------------------
// Identidade de quem assina
// -----------------------------------------------------------------------------

export const SocialNetwork = z.enum(['instagram', 'linkedin', 'github', 'behance', 'dribbble'], {
  error: 'Rede inválida.',
});
export type SocialNetwork = z.infer<typeof SocialNetwork>;

export const SOCIAL_NETWORK_LABELS: Record<SocialNetwork, string> = {
  instagram: 'Instagram',
  linkedin: 'LinkedIn',
  github: 'GitHub',
  behance: 'Behance',
  dribbble: 'Dribbble',
};

export const SenderSocialLink = z.object({
  network: SocialNetwork,
  url: HttpsUrl,
  iconUrl: HttpsUrl,
});
export type SenderSocialLink = z.infer<typeof SenderSocialLink>;

export const SenderIdentityContent = z
  .object({
    senderName: text(80),
    role: text(80),
    studio: text(80),
    location: optionalText(80),
    website: OptionalHttpsUrl,
    whatsapp: optionalText(40),
    email: Email,
    bannerUrl: OptionalHttpsUrl,
    bannerAlt: optionalText(160),
    socials: z.array(SenderSocialLink).max(5, { error: 'No máximo 5 redes.' }).default([]),
    accent: z
      .string()
      .trim()
      .regex(/^#[0-9a-fA-F]{6}$/, { error: 'Use uma cor em hex, como #fa4e3e.' })
      .default('#fa4e3e'),
  })
  .superRefine((value, ctx) => {
    if (value.bannerUrl && !value.bannerAlt) {
      ctx.addIssue({
        code: 'custom',
        path: ['bannerAlt'],
        message: 'Descreva a imagem da faixa (texto alternativo).',
      });
    }
    if (!value.bannerUrl && value.bannerAlt) {
      ctx.addIssue({
        code: 'custom',
        path: ['bannerUrl'],
        message: 'Informe o endereço da imagem ou apague a descrição.',
      });
    }
  });
export type SenderIdentityContent = z.infer<typeof SenderIdentityContent>;
export type SenderIdentityContentInput = z.input<typeof SenderIdentityContent>;

export const SenderIdentityVersion = z.object({
  id: Uuid,
  version: z.number().int().min(1),
  content: SenderIdentityContent,
  createdAt: z.string(),
});
export type SenderIdentityVersion = z.infer<typeof SenderIdentityVersion>;

// -----------------------------------------------------------------------------
// Caixa de e-mail
// -----------------------------------------------------------------------------

export const MailboxStatus = z.enum(['unverified', 'verified', 'paused']);
export type MailboxStatus = z.infer<typeof MailboxStatus>;

export const MAILBOX_STATUS_LABELS: Record<MailboxStatus, string> = {
  unverified: 'Não conferida',
  verified: 'Conferida',
  paused: 'Pausada',
};

export const SmtpPort = z.union([z.literal(465), z.literal(587)], {
  error: 'Use a porta 465 (SSL) ou 587 (STARTTLS).',
});
export const ImapPort = z.literal(993, { error: 'Use a porta 993 (IMAP com SSL).' });

/** Domínio de um endereço de e-mail (minúsculo); vazio se não houver `@`. */
export function emailDomainOf(value: string): string {
  const at = value.lastIndexOf('@');
  return at >= 0
    ? value
        .slice(at + 1)
        .trim()
        .toLowerCase()
    : '';
}

/**
 * Endereço que se prova com o login: o usuário, quando é um e-mail (Hostinger, Google, Microsoft);
 * senão, o endereço que envia. É para ele que vai o e-mail de teste.
 */
export function authenticatedAddress(mailbox: { address: string; username: string }): string {
  const username = mailbox.username.trim().toLowerCase();
  return Email.safeParse(username).success ? username : mailbox.address;
}

export const MailboxSettingsInput = z
  .object({
    address: Email,
    displayName: text(80),
    smtpHost: Hostname,
    smtpPort: SmtpPort,
    imapHost: Hostname,
    imapPort: ImapPort,
    username: text(254),
    dailyLimit: z
      .number({ error: 'Informe um número de 1 a 50.' })
      .int({ error: 'Use número inteiro.' })
      .min(1, { error: 'Use um valor de 1 a 50.' })
      .max(50, {
        error:
          'Use um valor de 1 a 50. Ficar bem abaixo do limite do provedor protege a reputação do domínio.',
      }),
  })
  .superRefine((input, ctx) => {
    // O login prova o usuário, não o endereço digitado: o remetente fica no domínio da conta
    // (um apelido, como fala@, continua valendo).
    const loginDomain = emailDomainOf(input.username);
    if (loginDomain && emailDomainOf(input.address) !== loginDomain) {
      ctx.addIssue({
        code: 'custom',
        path: ['address'],
        message: `Use um endereço do mesmo domínio do usuário da caixa (…@${loginDomain}).`,
      });
    }
  });
export type MailboxSettingsInput = z.infer<typeof MailboxSettingsInput>;

/** Sem trim: espaço pode fazer parte da senha. Nunca volta em resposta, log ou trace. */
export const MailboxPasswordInput = z.object({
  password: z
    .string({ error: REQUIRED })
    .min(1, { error: REQUIRED })
    .max(256, { error: 'Use no máximo 256 caracteres.' }),
});
export type MailboxPasswordInput = z.infer<typeof MailboxPasswordInput>;

export const Mailbox = z.object({
  id: Uuid,
  address: z.string(),
  displayName: z.string(),
  smtpHost: z.string(),
  smtpPort: SmtpPort,
  imapHost: z.string(),
  imapPort: ImapPort,
  username: z.string(),
  hasPassword: z.boolean(),
  passwordSetAt: z.string().nullable(),
  dailyLimit: z.number().int(),
  status: MailboxStatus,
  verifiedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Mailbox = z.infer<typeof Mailbox>;

// -----------------------------------------------------------------------------
// Conferência da caixa
// -----------------------------------------------------------------------------

export const ConnectionOutcome = z.enum([
  'ok',
  'auth_failed',
  'unreachable',
  'tls_failed',
  'not_tested',
]);
export type ConnectionOutcome = z.infer<typeof ConnectionOutcome>;

export const SpfStatus = z.enum([
  'ok',
  'missing',
  'multiple',
  'permissive',
  'without_provider',
  'unknown',
]);
export type SpfStatus = z.infer<typeof SpfStatus>;

export const DkimStatus = z.enum(['ok', 'missing', 'unknown']);
export type DkimStatus = z.infer<typeof DkimStatus>;

export const DmarcStatus = z.enum(['enforced', 'monitoring', 'missing', 'unknown']);
export type DmarcStatus = z.infer<typeof DmarcStatus>;

/** Só registros públicos do DNS e seletores; nada de senha nem conteúdo de e-mail. */
export const MailboxCheckDetails = z.object({
  domain: z.string().max(253).optional(),
  spfRecord: z.string().max(512).nullable().optional(),
  dmarcRecord: z.string().max(512).nullable().optional(),
  dkimSelectors: z.array(z.string().max(63)).max(10).optional(),
  /**
   * Endereço, servidores, portas, usuário e data da senha conferidos. A conferência só vale
   * enquanto a caixa tiver exatamente essa conexão (trocar servidor ou senha pede outra).
   */
  connection: z.string().max(1200).optional(),
});
export type MailboxCheckDetails = z.infer<typeof MailboxCheckDetails>;

export const MailboxCheck = z.object({
  id: Uuid,
  mailboxId: Uuid,
  smtp: ConnectionOutcome,
  imap: ConnectionOutcome,
  spf: SpfStatus,
  dkim: DkimStatus,
  dmarc: DmarcStatus,
  details: MailboxCheckDetails,
  checkedAt: z.string(),
});
export type MailboxCheck = z.infer<typeof MailboxCheck>;
