import type {
  ConnectionOutcome,
  DkimStatus,
  DmarcStatus,
  Mailbox,
  MailboxCheck,
  MailboxCheckDetails,
  MailboxSettingsInput,
  SenderIdentityContent,
  SenderIdentityVersion,
  SpfStatus,
} from '@prospector/contracts';
import type { DnsTxtResult } from '@prospector/domain';
import type { PendingAudit } from './audit-repository';

/**
 * Portas do e-mail (ADR-0016, fatia E3). A senha entra só em `MailServerConfig`, no momento de
 * conectar, e nenhum adaptador a registra (log, trace, erro). Nada aqui envia e-mail a terceiros:
 * nesta fatia o único envio é o teste para a própria caixa.
 */

export interface MailServerConfig {
  host: string;
  port: number;
  username: string;
  password: string;
}

/** Resultado de um login: sem "não testado" (isso é decisão do serviço, sem senha). */
export type LoginOutcome = Exclude<ConnectionOutcome, 'not_tested'>;

export interface OutgoingMail {
  from: { name: string; address: string };
  to: string;
  subject: string;
  html: string;
  text: string;
  headers?: Readonly<Record<string, string>>;
}

/** Servidor de envio (SMTP). */
export interface MailTransport {
  verify(config: MailServerConfig): Promise<LoginOutcome>;
  /** Lança `AppError('unavailable', 'email_send_failed')` se o servidor recusar. */
  send(config: MailServerConfig, mail: OutgoingMail): Promise<{ messageId: string }>;
}

/** Caixa de entrada (IMAP). Nesta fatia só confere o login; a leitura das respostas é a E5. */
export interface MailboxReader {
  verify(config: MailServerConfig): Promise<LoginOutcome>;
}

/** Consulta TXT no DNS público (SPF, DMARC, DKIM). */
export interface DnsTxtLookup {
  txt(name: string): Promise<DnsTxtResult>;
}

export interface NewMailboxCheck {
  mailboxId: string;
  smtp: ConnectionOutcome;
  imap: ConnectionOutcome;
  spf: SpfStatus;
  dkim: DkimStatus;
  dmarc: DmarcStatus;
  details: MailboxCheckDetails;
  traceId: string;
  checkedAt: string;
}

/**
 * Campos da caixa cuja mudança desfaz a conferência (`app.mailbox_reset_verification`), e os que
 * também desligam a senha: ela vale para o servidor e o usuário em que foi digitada (a senha nunca
 * vai para um servidor novo sem ser digitada de novo). Um teste confere a lista contra o trigger.
 */
export const MAILBOX_CONNECTION_FIELDS = [
  'address',
  'smtpHost',
  'smtpPort',
  'imapHost',
  'imapPort',
  'username',
] as const satisfies readonly (keyof MailboxSettingsInput)[];

export const MAILBOX_CREDENTIAL_FIELDS = [
  'smtpHost',
  'imapHost',
  'username',
] as const satisfies readonly (typeof MAILBOX_CONNECTION_FIELDS)[number][];

/** Identidade, caixa e conferências (migração 20261125120000). */
export interface EmailSettingsRepository {
  /** Mais recente primeiro. */
  listIdentityVersions(): Promise<SenderIdentityVersion[]>;
  addIdentityVersion(
    content: SenderIdentityContent,
    audit: PendingAudit,
  ): Promise<SenderIdentityVersion>;
  getMailbox(): Promise<Mailbox | null>;
  createMailbox(input: MailboxSettingsInput, audit: PendingAudit): Promise<Mailbox>;
  updateMailbox(id: string, input: MailboxSettingsInput, audit: PendingAudit): Promise<Mailbox>;
  /**
   * Com `expectedUpdatedAt`, só muda se a caixa não mudou desde então; senão lança
   * `conflict/concurrent_change` (a conferência era de outra conexão).
   */
  setMailboxStatus(
    id: string,
    status: 'verified' | 'unverified',
    audit: PendingAudit,
    options?: { expectedUpdatedAt?: string },
  ): Promise<Mailbox>;
  /** Grava ou troca a senha (no banco, no Vault); a conferência anterior deixa de valer. */
  setMailboxPassword(id: string, password: string, audit: PendingAudit): Promise<void>;
  /** Só para conectar; nunca para mostrar. */
  readMailboxPassword(id: string): Promise<string | null>;
  addCheck(check: NewMailboxCheck): Promise<MailboxCheck>;
  latestCheck(mailboxId: string): Promise<MailboxCheck | null>;
}
