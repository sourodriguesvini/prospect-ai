import type { LoginOutcome, MailServerConfig } from '@prospector/application';
import { checkUrl, resolvePublicTarget, type Resolver } from '../web/ssrf';

/**
 * Conexão com o servidor da caixa (ADR-0016, fatia E3). Regras comuns ao SMTP e ao IMAP:
 * - o host passa pela mesma proteção do leitor de páginas (ADR-0012): nome interno ou DNS que
 *   aponte, mesmo em parte, para endereço interno é recusado antes de qualquer conexão;
 * - a conexão usa o IP conferido (DNS fixado) e o TLS confere o certificado pelo nome do host;
 * - TLS 1.2 no mínimo; nada de log da biblioteca (o protocolo carrega a senha);
 * - erros viram um `LoginOutcome`, sem mensagem do servidor nem detalhe interno.
 */

export const MAIL_CONNECT_TIMEOUT_MS = 15_000;
export const MAIL_SOCKET_TIMEOUT_MS = 30_000;

export type MailTarget =
  { ok: true; address: string; servername: string } | { ok: false; outcome: LoginOutcome };

export async function resolveMailServer(host: string, resolver: Resolver): Promise<MailTarget> {
  const servername = host.trim().toLowerCase().replace(/\.$/, '');
  const checked = checkUrl(`https://${servername}/`);
  if (!checked.ok) return { ok: false, outcome: 'unreachable' };
  const target = await resolvePublicTarget(checked.url, resolver);
  if (!target.ok) return { ok: false, outcome: 'unreachable' };
  return { ok: true, address: target.address, servername };
}

/** Nome que o cliente anuncia no EHLO: o domínio da caixa (nunca o nome deste computador). */
export function clientName(config: MailServerConfig): string {
  const at = config.username.lastIndexOf('@');
  const domain = at >= 0 ? config.username.slice(at + 1).toLowerCase() : '';
  return /^[a-z0-9.-]{1,253}$/.test(domain) && domain.includes('.') ? domain : 'localhost';
}

/** Códigos do Node e do OpenSSL que indicam certificado ou negociação TLS recusados. */
const TLS_CODES = new Set([
  'CERT_HAS_EXPIRED',
  'CERT_NOT_YET_VALID',
  'CERT_REVOKED',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_GET_ISSUER_CERT',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'EPROTO',
  'ETLS',
]);

export function isTlsFailure(code: unknown): boolean {
  if (typeof code !== 'string') return false;
  return TLS_CODES.has(code) || code.startsWith('ERR_TLS_') || code.startsWith('ERR_SSL_');
}

interface ErrorFields {
  code?: unknown;
  originalCode?: unknown;
  responseCode?: unknown;
  authenticationFailed?: unknown;
  serverResponseCode?: unknown;
  cause?: unknown;
}

function fields(error: unknown): ErrorFields {
  return typeof error === 'object' && error !== null ? (error as ErrorFields) : {};
}

/** Erro do nodemailer (SMTP) → resultado do login. */
export function smtpOutcome(error: unknown): LoginOutcome {
  const { code, originalCode, responseCode, cause } = fields(error);
  if (code === 'EAUTH' || code === 'ENOAUTH' || responseCode === 535) return 'auth_failed';
  if (isTlsFailure(code) || isTlsFailure(originalCode) || isTlsFailure(fields(cause).code)) {
    return 'tls_failed';
  }
  return 'unreachable';
}

/** Erro do ImapFlow (IMAP) → resultado do login. */
export function imapOutcome(error: unknown): LoginOutcome {
  const { code, authenticationFailed, serverResponseCode, cause } = fields(error);
  if (authenticationFailed === true || serverResponseCode === 'AUTHENTICATIONFAILED') {
    return 'auth_failed';
  }
  if (isTlsFailure(code) || isTlsFailure(fields(cause).code)) return 'tls_failed';
  return 'unreachable';
}
