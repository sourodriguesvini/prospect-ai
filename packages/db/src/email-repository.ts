import { AppError, type EmailSettingsRepository, type PendingAudit } from '@prospector/application';
import {
  Mailbox,
  MailboxCheck,
  MailboxCheckDetails,
  SenderIdentityVersion,
  type MailboxSettingsInput,
  type SenderIdentityContent,
} from '@prospector/contracts';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { toAppError } from './errors';
import { AUDIT_HEADER, encodeAuditHeader, type AuditedTable } from './strategy-repository';

/**
 * E-mail via PostgREST (migração 20261125120000, ADR-0016). O banco garante o essencial:
 * identidade versionada e imutável, uma caixa só, senha no Vault (RPCs `set_mailbox_password` e
 * `mailbox_password`, só para o servidor) e conferência que perde a validade quando a conexão ou a
 * senha mudam (trigger). A senha nunca é selecionada junto com a caixa nem vai para a auditoria.
 */

interface Result {
  data: unknown;
  error: { message?: string | null; code?: string | null } | null;
}

async function run(query: PromiseLike<Result>): Promise<unknown> {
  const { data, error } = await query;
  if (error) throw toAppError(error);
  return data;
}

interface WithHeader<T> {
  setHeader(name: string, value: string): T;
}

function audited<T extends WithHeader<T>>(query: T, table: AuditedTable, audit: PendingAudit): T {
  return query.setHeader(AUDIT_HEADER, encodeAuditHeader(table, audit));
}

// --- Identidade ---------------------------------------------------------------------------

const IDENTITY_SELECT =
  'id, version, sender_name, role, studio, location, website, whatsapp, email, banner_url, banner_alt, socials, accent, created_at';

const IdentityRow = z.object({
  id: z.string(),
  version: z.number().int(),
  sender_name: z.string(),
  role: z.string(),
  studio: z.string(),
  location: z.string().nullable(),
  website: z.string().nullable(),
  whatsapp: z.string().nullable(),
  email: z.string(),
  banner_url: z.string().nullable(),
  banner_alt: z.string().nullable(),
  socials: z.unknown(),
  accent: z.string(),
  created_at: z.string(),
});

function identityColumns(content: SenderIdentityContent) {
  return {
    sender_name: content.senderName,
    role: content.role,
    studio: content.studio,
    location: content.location,
    website: content.website,
    whatsapp: content.whatsapp,
    email: content.email,
    banner_url: content.bannerUrl,
    banner_alt: content.bannerAlt,
    socials: content.socials.map((social) => ({
      network: social.network,
      url: social.url,
      iconUrl: social.iconUrl,
    })),
    accent: content.accent,
  };
}

function mapIdentity(raw: unknown): SenderIdentityVersion {
  const row = IdentityRow.parse(raw);
  return SenderIdentityVersion.parse({
    id: row.id,
    version: row.version,
    createdAt: row.created_at,
    content: {
      senderName: row.sender_name,
      role: row.role,
      studio: row.studio,
      location: row.location ?? '',
      website: row.website ?? '',
      whatsapp: row.whatsapp ?? '',
      email: row.email,
      bannerUrl: row.banner_url ?? '',
      bannerAlt: row.banner_alt ?? '',
      socials: row.socials,
      accent: row.accent,
    },
  });
}

// --- Caixa --------------------------------------------------------------------------------

/** Sem `secret_id`: a tela só precisa saber se há senha (e desde quando). */
const MAILBOX_SELECT =
  'id, address, display_name, smtp_host, smtp_port, imap_host, imap_port, username, password_set_at, daily_limit, status, verified_at, created_at, updated_at';

const MailboxRow = z.object({
  id: z.string(),
  address: z.string(),
  display_name: z.string(),
  smtp_host: z.string(),
  smtp_port: z.number().int(),
  imap_host: z.string(),
  imap_port: z.number().int(),
  username: z.string(),
  password_set_at: z.string().nullable(),
  daily_limit: z.number().int(),
  status: z.string(),
  verified_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

function mailboxColumns(input: MailboxSettingsInput) {
  return {
    address: input.address,
    display_name: input.displayName,
    smtp_host: input.smtpHost,
    smtp_port: input.smtpPort,
    imap_host: input.imapHost,
    imap_port: input.imapPort,
    username: input.username,
    daily_limit: input.dailyLimit,
  };
}

function mapMailbox(raw: unknown): Mailbox {
  const row = MailboxRow.parse(raw);
  return Mailbox.parse({
    id: row.id,
    address: row.address,
    displayName: row.display_name,
    smtpHost: row.smtp_host,
    smtpPort: row.smtp_port,
    imapHost: row.imap_host,
    imapPort: row.imap_port,
    username: row.username,
    hasPassword: row.password_set_at !== null,
    passwordSetAt: row.password_set_at,
    dailyLimit: row.daily_limit,
    status: row.status,
    verifiedAt: row.verified_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

// --- Conferências -------------------------------------------------------------------------

const CHECK_SELECT = 'id, mailbox_id, smtp, imap, spf, dkim, dmarc, details, checked_at';

const CheckRow = z.object({
  id: z.string(),
  mailbox_id: z.string(),
  smtp: z.string(),
  imap: z.string(),
  spf: z.string(),
  dkim: z.string(),
  dmarc: z.string(),
  details: z.unknown(),
  checked_at: z.string(),
});

function mapCheck(raw: unknown): MailboxCheck {
  const row = CheckRow.parse(raw);
  return MailboxCheck.parse({
    id: row.id,
    mailboxId: row.mailbox_id,
    smtp: row.smtp,
    imap: row.imap,
    spf: row.spf,
    dkim: row.dkim,
    dmarc: row.dmarc,
    details: row.details,
    checkedAt: row.checked_at,
  });
}

export function createSupabaseEmailRepository(client: SupabaseClient): EmailSettingsRepository {
  return {
    async listIdentityVersions() {
      const data = (await run(
        client
          .from('sender_identities')
          .select(IDENTITY_SELECT)
          .order('version', { ascending: false })
          .limit(20),
      )) as unknown[] | null;
      return (data ?? []).map(mapIdentity);
    },

    async addIdentityVersion(content, audit) {
      return mapIdentity(
        await run(
          audited(
            client
              .from('sender_identities')
              .insert(identityColumns(content))
              .select(IDENTITY_SELECT)
              .single(),
            'sender_identities',
            audit,
          ),
        ),
      );
    },

    async getMailbox() {
      const data = await run(client.from('mailboxes').select(MAILBOX_SELECT).maybeSingle());
      return data ? mapMailbox(data) : null;
    },

    async createMailbox(input, audit) {
      return mapMailbox(
        await run(
          audited(
            client.from('mailboxes').insert(mailboxColumns(input)).select(MAILBOX_SELECT).single(),
            'mailboxes',
            audit,
          ),
        ),
      );
    },

    async updateMailbox(id, input, audit) {
      const data = await run(
        audited(
          client
            .from('mailboxes')
            .update(mailboxColumns(input))
            .eq('id', id)
            .select(MAILBOX_SELECT)
            .maybeSingle(),
          'mailboxes',
          audit,
        ),
      );
      if (!data) throw new AppError('not_found', 'not_found');
      return mapMailbox(data);
    },

    async setMailboxStatus(id, status, audit, options) {
      let query = client
        .from('mailboxes')
        .update({
          status,
          verified_at: status === 'verified' ? new Date().toISOString() : null,
        })
        .eq('id', id);
      // Condicional: nenhuma linha muda se a caixa mudou desde a leitura (servidor, senha…).
      if (options?.expectedUpdatedAt) query = query.eq('updated_at', options.expectedUpdatedAt);
      const data = await run(
        audited(query.select(MAILBOX_SELECT).maybeSingle(), 'mailboxes', audit),
      );
      if (!data) {
        throw options?.expectedUpdatedAt
          ? new AppError('conflict', 'concurrent_change')
          : new AppError('not_found', 'not_found');
      }
      return mapMailbox(data);
    },

    async setMailboxPassword(id, password, audit) {
      await run(
        audited(
          client.rpc('set_mailbox_password', { p_mailbox_id: id, p_password: password }),
          'mailboxes',
          audit,
        ),
      );
    },

    async readMailboxPassword(id) {
      const data = await run(client.rpc('mailbox_password', { p_mailbox_id: id }));
      return typeof data === 'string' && data.length > 0 ? data : null;
    },

    async addCheck(check) {
      return mapCheck(
        await run(
          client
            .from('mailbox_checks')
            .insert({
              mailbox_id: check.mailboxId,
              smtp: check.smtp,
              imap: check.imap,
              spf: check.spf,
              dkim: check.dkim,
              dmarc: check.dmarc,
              details: MailboxCheckDetails.parse(check.details),
              trace_id: check.traceId,
              checked_at: check.checkedAt,
            })
            .select(CHECK_SELECT)
            .single(),
        ),
      );
    },

    async latestCheck(mailboxId) {
      const data = await run(
        client
          .from('mailbox_checks')
          .select(CHECK_SELECT)
          .eq('mailbox_id', mailboxId)
          .order('checked_at', { ascending: false })
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
      );
      return data ? mapCheck(data) : null;
    },
  };
}
