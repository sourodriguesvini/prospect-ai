import type { Mailbox, MailboxCheck, SenderIdentityVersion } from '@prospector/contracts';
import { systemClock, type Clock } from '../clock';
import { AppError } from '../errors';
import type { AuditRepository, PendingAudit } from '../ports/audit-repository';
import {
  MAILBOX_CONNECTION_FIELDS,
  MAILBOX_CREDENTIAL_FIELDS,
  type EmailSettingsRepository,
} from '../ports/email';

const clone = <T>(value: T): T => structuredClone(value);

/**
 * E-mail em memória (migração 20261125120000): identidade versionada e imutável, uma caixa só,
 * senha guardada à parte (o banco a guarda no Vault) e conferência que deixa de valer quando a
 * conexão ou a senha mudam. Uma linha de auditoria por escrita, sem a senha.
 */
export function createMemoryEmailRepository(options: {
  audit: AuditRepository;
  clock?: Clock;
  newId?: () => string;
}): EmailSettingsRepository {
  const clock = options.clock ?? systemClock;
  const newId = options.newId ?? (() => crypto.randomUUID());
  const now = () => clock.now().toISOString();

  const identities: SenderIdentityVersion[] = [];
  let mailbox: Mailbox | null = null;
  const passwords = new Map<string, string>();
  const checks: MailboxCheck[] = [];

  async function audited(audit: PendingAudit, id: string, version?: number): Promise<void> {
    await options.audit.append({
      actorType: audit.actorType,
      actorLabel: audit.actorLabel,
      action: audit.action,
      entityType: audit.entityType,
      entityId: audit.entityId ?? id,
      diff: {
        ...audit.diff,
        ...(audit.withVersion && version !== undefined ? { version } : {}),
      },
      traceId: audit.traceId,
    });
  }

  function current(id: string): Mailbox {
    if (!mailbox || mailbox.id !== id) throw new AppError('not_found', 'not_found');
    return mailbox;
  }

  function unverified(box: Mailbox): Pick<Mailbox, 'status' | 'verifiedAt'> {
    return { status: box.status === 'paused' ? 'paused' : 'unverified', verifiedAt: null };
  }

  return {
    async listIdentityVersions() {
      return clone([...identities].reverse());
    },

    async addIdentityVersion(content, audit) {
      const version: SenderIdentityVersion = {
        id: newId(),
        version: identities.length + 1,
        content: clone(content),
        createdAt: now(),
      };
      identities.push(version);
      await audited(audit, version.id, version.version);
      return clone(version);
    },

    async getMailbox() {
      return mailbox ? clone(mailbox) : null;
    },

    async createMailbox(input, audit) {
      if (mailbox) throw new AppError('conflict', 'concurrent_change');
      const at = now();
      mailbox = {
        id: newId(),
        ...input,
        hasPassword: false,
        passwordSetAt: null,
        status: 'unverified',
        verifiedAt: null,
        createdAt: at,
        updatedAt: at,
      };
      await audited(audit, mailbox.id);
      return clone(mailbox);
    },

    async updateMailbox(id, input, audit) {
      const box = current(id);
      // Igual a `app.mailbox_reset_verification`: senha desligada se mudou servidor ou usuário.
      const dropPassword =
        box.hasPassword && MAILBOX_CREDENTIAL_FIELDS.some((field) => box[field] !== input[field]);
      if (dropPassword) passwords.delete(id);
      const reset =
        box.status === 'verified' &&
        (dropPassword || MAILBOX_CONNECTION_FIELDS.some((field) => box[field] !== input[field]));
      mailbox = {
        ...box,
        ...input,
        ...(reset ? unverified(box) : {}),
        ...(dropPassword ? { hasPassword: false, passwordSetAt: null } : {}),
        updatedAt: now(),
      };
      await audited(audit, id);
      return clone(mailbox);
    },

    async setMailboxStatus(id, status, audit, options) {
      const box = current(id);
      if (options?.expectedUpdatedAt && box.updatedAt !== options.expectedUpdatedAt) {
        throw new AppError('conflict', 'concurrent_change');
      }
      if (status === 'verified' && !box.hasPassword) {
        throw new AppError('conflict', 'mailbox_password_missing');
      }
      mailbox = {
        ...box,
        status,
        verifiedAt: status === 'verified' ? now() : null,
        updatedAt: now(),
      };
      await audited(audit, id);
      return clone(mailbox);
    },

    async setMailboxPassword(id, password, audit) {
      const box = current(id);
      if (password.length < 1 || password.length > 256) {
        throw new AppError('validation', 'invalid_input');
      }
      passwords.set(id, password);
      const at = now();
      mailbox = { ...box, hasPassword: true, passwordSetAt: at, ...unverified(box), updatedAt: at };
      await audited(audit, id);
    },

    async readMailboxPassword(id) {
      return passwords.get(id) ?? null;
    },

    async addCheck(check) {
      current(check.mailboxId);
      const row: MailboxCheck = {
        id: newId(),
        mailboxId: check.mailboxId,
        smtp: check.smtp,
        imap: check.imap,
        spf: check.spf,
        dkim: check.dkim,
        dmarc: check.dmarc,
        details: clone(check.details),
        checkedAt: check.checkedAt,
      };
      checks.push(row);
      return clone(row);
    },

    async latestCheck(mailboxId) {
      for (let index = checks.length - 1; index >= 0; index -= 1) {
        const row = checks[index];
        if (row && row.mailboxId === mailboxId) return clone(row);
      }
      return null;
    },
  };
}
