import {
  AppError,
  type MailServerConfig,
  type MailTransport,
  type OutgoingMail,
} from '@prospector/application';
import { createTransport } from 'nodemailer';
import { systemResolver, type Resolver } from '../web/ssrf';
import {
  MAIL_CONNECT_TIMEOUT_MS,
  MAIL_SOCKET_TIMEOUT_MS,
  clientName,
  resolveMailServer,
  smtpOutcome,
} from './connection';

/** O que o adaptador usa de um transporte do nodemailer (para os testes trocarem a rede). */
export interface SmtpClient {
  verify(): Promise<unknown>;
  sendMail(mail: Record<string, unknown>): Promise<{ messageId?: unknown }>;
  close(): void;
}

export type SmtpClientFactory = (options: Record<string, unknown>) => SmtpClient;

const nodemailerFactory: SmtpClientFactory = (options) =>
  createTransport(options) as unknown as SmtpClient;

export interface SmtpTransportOptions {
  resolver?: Resolver;
  /** Só para testes: troca o nodemailer por um cliente falso. */
  createClient?: SmtpClientFactory;
}

/**
 * Envio pela caixa do usuário (SMTP com TLS direto na 465 ou STARTTLS obrigatório na 587).
 * Nenhum log do protocolo; anexos por arquivo ou URL desligados.
 */
export function createSmtpTransport(options: SmtpTransportOptions = {}): MailTransport {
  const resolver = options.resolver ?? systemResolver;
  const createClient = options.createClient ?? nodemailerFactory;

  async function open(
    config: MailServerConfig,
  ): Promise<{ ok: true; client: SmtpClient } | { ok: false; outcome: 'unreachable' }> {
    const target = await resolveMailServer(config.host, resolver);
    if (!target.ok) return { ok: false, outcome: 'unreachable' };
    const secure = config.port === 465;
    const client = createClient({
      host: target.address,
      port: config.port,
      secure,
      requireTLS: !secure,
      servername: target.servername,
      tls: { servername: target.servername, minVersion: 'TLSv1.2', rejectUnauthorized: true },
      auth: { user: config.username, pass: config.password },
      name: clientName(config),
      connectionTimeout: MAIL_CONNECT_TIMEOUT_MS,
      greetingTimeout: MAIL_CONNECT_TIMEOUT_MS,
      socketTimeout: MAIL_SOCKET_TIMEOUT_MS,
      logger: false,
      debug: false,
      transactionLog: false,
      disableFileAccess: true,
      disableUrlAccess: true,
    });
    return { ok: true, client };
  }

  return {
    async verify(config) {
      const opened = await open(config);
      if (!opened.ok) return opened.outcome;
      try {
        await opened.client.verify();
        return 'ok';
      } catch (error) {
        return smtpOutcome(error);
      } finally {
        opened.client.close();
      }
    },

    async send(config, mail: OutgoingMail) {
      const opened = await open(config);
      if (!opened.ok) throw new AppError('unavailable', 'email_send_failed');
      try {
        const info = await opened.client.sendMail({
          from: { name: mail.from.name, address: mail.from.address },
          to: mail.to,
          subject: mail.subject,
          html: mail.html,
          text: mail.text,
          headers: { ...mail.headers },
          disableFileAccess: true,
          disableUrlAccess: true,
        });
        const messageId = typeof info.messageId === 'string' ? info.messageId : '';
        if (!messageId) throw new AppError('unavailable', 'email_send_failed');
        return { messageId };
      } catch (error) {
        // Sem `cause`: o erro do servidor pode repetir endereço ou parte da conversa SMTP.
        if (error instanceof AppError) throw error;
        throw new AppError('unavailable', 'email_send_failed');
      } finally {
        opened.client.close();
      }
    },
  };
}
