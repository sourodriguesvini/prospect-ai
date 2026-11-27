import type { MailboxReader } from '@prospector/application';
import { ImapFlow } from 'imapflow';
import { systemResolver, type Resolver } from '../web/ssrf';
import {
  MAIL_CONNECT_TIMEOUT_MS,
  MAIL_SOCKET_TIMEOUT_MS,
  imapOutcome,
  resolveMailServer,
} from './connection';

/** O que o adaptador usa de um cliente ImapFlow (para os testes trocarem a rede). */
export interface ImapClient {
  connect(): Promise<void>;
  close(): void;
  on(event: 'error', listener: (error: unknown) => void): unknown;
}

export type ImapClientFactory = (options: Record<string, unknown>) => ImapClient;

const imapFlowFactory: ImapClientFactory = (options) =>
  new ImapFlow(
    options as unknown as ConstructorParameters<typeof ImapFlow>[0],
  ) as unknown as ImapClient;

export interface ImapReaderOptions {
  resolver?: Resolver;
  /** Só para testes: troca o ImapFlow por um cliente falso. */
  createClient?: ImapClientFactory;
}

/**
 * Caixa de entrada por IMAP (TLS direto na 993). Nesta fatia só confere o login: conecta,
 * autentica e sai (`verifyOnly`), sem abrir pasta nem ler mensagem.
 */
export function createImapReader(options: ImapReaderOptions = {}): MailboxReader {
  const resolver = options.resolver ?? systemResolver;
  const createClient = options.createClient ?? imapFlowFactory;

  return {
    async verify(config) {
      const target = await resolveMailServer(config.host, resolver);
      if (!target.ok) return target.outcome;
      const client = createClient({
        host: target.address,
        port: config.port,
        secure: true,
        servername: target.servername,
        tls: { servername: target.servername, minVersion: 'TLSv1.2', rejectUnauthorized: true },
        auth: { user: config.username, pass: config.password },
        verifyOnly: true,
        disableAutoIdle: true,
        // O ID do IMAP sai com o nome do app, não com o da biblioteca nem o deste computador.
        clientInfo: { name: 'Prospector', version: '1' },
        logger: false,
        emitLogs: false,
        connectionTimeout: MAIL_CONNECT_TIMEOUT_MS,
        greetingTimeout: MAIL_CONNECT_TIMEOUT_MS,
        socketTimeout: MAIL_SOCKET_TIMEOUT_MS,
      });
      // Erro de socket depois do login vira evento; sem ouvinte, derrubaria o processo.
      client.on('error', () => undefined);
      try {
        await client.connect();
        return 'ok';
      } catch (error) {
        return imapOutcome(error);
      } finally {
        try {
          client.close();
        } catch {
          // Já fechado pelo `verifyOnly`.
        }
      }
    },
  };
}
