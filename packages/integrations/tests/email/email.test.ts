import { AppError, type MailServerConfig } from '@prospector/application';
import { describe, expect, it } from 'vitest';
import {
  clientName,
  imapOutcome,
  isTlsFailure,
  resolveMailServer,
  smtpOutcome,
} from '../../src/email/connection';
import { createDnsTxtLookup } from '../../src/email/dns';
import { createImapReader, type ImapClient } from '../../src/email/imap';
import { createSmtpTransport, type SmtpClient } from '../../src/email/smtp';
import { PUBLIC_IP, fakeResolver } from '../web/net-fakes';

/** Adaptadores de e-mail (ADR-0016) com rede falsa: nenhum teste conecta, consulta DNS ou envia. */

const SECRET = 'senha-de-teste-que-nao-pode-vazar';
const SMTP: MailServerConfig = {
  host: 'smtp.exemplo.com.br',
  port: 465,
  username: 'fala@estudio.exemplo.com.br',
  password: SECRET,
};
const IMAP: MailServerConfig = { ...SMTP, host: 'imap.exemplo.com.br', port: 993 };

const resolver = fakeResolver({
  'smtp.exemplo.com.br': [PUBLIC_IP],
  'imap.exemplo.com.br': [PUBLIC_IP],
  'interno.exemplo.com.br': ['10.0.0.8'],
  'misto.exemplo.com.br': [PUBLIC_IP, '127.0.0.1'],
});

const coded = (code: string, extra: Record<string, unknown> = {}) =>
  Object.assign(new Error('falha simulada'), { code, ...extra });

function fakeSmtp(behavior: { verify?: () => Promise<unknown>; send?: () => Promise<unknown> }) {
  const created: Record<string, unknown>[] = [];
  const sent: Record<string, unknown>[] = [];
  let closed = 0;
  const createClient = (options: Record<string, unknown>): SmtpClient => {
    created.push(options);
    return {
      verify: behavior.verify ?? (async () => true),
      async sendMail(mail) {
        sent.push(mail);
        return ((await behavior.send?.()) ?? { messageId: '<id@exemplo.com.br>' }) as {
          messageId?: unknown;
        };
      },
      close: () => {
        closed += 1;
      },
    };
  };
  return { created, sent, closed: () => closed, createClient };
}

describe('servidor da caixa', () => {
  it('resolve só para endereço público e mantém o nome para o TLS', async () => {
    await expect(resolveMailServer('SMTP.exemplo.com.br.', resolver)).resolves.toEqual({
      ok: true,
      address: PUBLIC_IP,
      servername: 'smtp.exemplo.com.br',
    });
    for (const host of [
      'interno.exemplo.com.br',
      'misto.exemplo.com.br',
      'localhost',
      '10.0.0.1',
    ]) {
      await expect(resolveMailServer(host, resolver)).resolves.toEqual({
        ok: false,
        outcome: 'unreachable',
      });
    }
    await expect(resolveMailServer('nao-existe.exemplo.com.br', resolver)).resolves.toMatchObject({
      ok: false,
    });
  });

  it('anuncia o domínio da caixa, nunca o nome do computador', () => {
    expect(clientName(SMTP)).toBe('estudio.exemplo.com.br');
    expect(clientName({ ...SMTP, username: 'usuario' })).toBe('localhost');
  });

  it('classifica os erros sem levar a mensagem do servidor', () => {
    expect(smtpOutcome(coded('EAUTH', { responseCode: 535 }))).toBe('auth_failed');
    expect(smtpOutcome(coded('ETLS'))).toBe('tls_failed');
    expect(smtpOutcome(coded('ESOCKET', { originalCode: 'CERT_HAS_EXPIRED' }))).toBe('tls_failed');
    expect(smtpOutcome(coded('ESOCKET', { originalCode: 'ECONNREFUSED' }))).toBe('unreachable');
    expect(smtpOutcome(coded('ETIMEDOUT'))).toBe('unreachable');
    expect(smtpOutcome('texto solto')).toBe('unreachable');
    expect(imapOutcome({ authenticationFailed: true })).toBe('auth_failed');
    expect(imapOutcome({ serverResponseCode: 'AUTHENTICATIONFAILED' })).toBe('auth_failed');
    expect(imapOutcome(coded('ERR_TLS_CERT_ALTNAME_INVALID'))).toBe('tls_failed');
    expect(imapOutcome(coded('CONNECT_TIMEOUT'))).toBe('unreachable');
    expect(isTlsFailure('ERR_SSL_WRONG_VERSION_NUMBER')).toBe(true);
  });
});

describe('SMTP', () => {
  it('conecta no IP conferido, TLS com o nome do host, sem log, e fecha', async () => {
    const fake = fakeSmtp({});
    const transport = createSmtpTransport({ resolver, createClient: fake.createClient });
    await expect(transport.verify(SMTP)).resolves.toBe('ok');
    expect(fake.created[0]).toMatchObject({
      host: PUBLIC_IP,
      port: 465,
      secure: true,
      requireTLS: false,
      servername: 'smtp.exemplo.com.br',
      tls: { servername: 'smtp.exemplo.com.br', minVersion: 'TLSv1.2', rejectUnauthorized: true },
      name: 'estudio.exemplo.com.br',
      logger: false,
      debug: false,
      disableFileAccess: true,
      disableUrlAccess: true,
    });
    expect(fake.closed()).toBe(1);

    await transport.verify({ ...SMTP, port: 587 });
    expect(fake.created[1]).toMatchObject({ port: 587, secure: false, requireTLS: true });
  });

  it('não conecta em servidor interno e devolve o resultado do login', async () => {
    const fake = fakeSmtp({
      verify: async () => {
        throw coded('EAUTH');
      },
    });
    const transport = createSmtpTransport({ resolver, createClient: fake.createClient });
    await expect(transport.verify({ ...SMTP, host: 'interno.exemplo.com.br' })).resolves.toBe(
      'unreachable',
    );
    expect(fake.created).toHaveLength(0);
    await expect(transport.verify(SMTP)).resolves.toBe('auth_failed');
    expect(fake.closed()).toBe(1);
  });

  it('envia o que recebeu e, na recusa, lança erro sem detalhe do servidor', async () => {
    const ok = fakeSmtp({});
    const transport = createSmtpTransport({ resolver, createClient: ok.createClient });
    const mail = {
      from: { name: 'Pessoa Exemplo', address: SMTP.username },
      to: SMTP.username,
      subject: 'Teste',
      html: '<p>Oi</p>',
      text: 'Oi',
      headers: { 'X-Prospector': 'teste' },
    };
    await expect(transport.send(SMTP, mail)).resolves.toEqual({ messageId: '<id@exemplo.com.br>' });
    expect(ok.sent[0]).toMatchObject({ to: SMTP.username, subject: 'Teste', text: 'Oi' });

    const refused = fakeSmtp({
      send: async () => {
        throw coded('EENVELOPE', { response: `550 recusado ${SECRET}` });
      },
    });
    const failing = createSmtpTransport({ resolver, createClient: refused.createClient });
    const error = await failing.send(SMTP, mail).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({ code: 'unavailable', reason: 'email_send_failed' });
    expect(String((error as Error).message)).not.toContain(SECRET);
    expect((error as Error).cause).toBeUndefined();
    expect(refused.closed()).toBe(1);
  });
});

describe('IMAP', () => {
  function fakeImap(connect: () => Promise<void>) {
    const created: Record<string, unknown>[] = [];
    let listeners = 0;
    const createClient = (options: Record<string, unknown>): ImapClient => {
      created.push(options);
      return {
        connect,
        close: () => {
          throw new Error('já fechado');
        },
        on: () => {
          listeners += 1;
        },
      };
    };
    return { created, listeners: () => listeners, createClient };
  }

  it('só confere o login, com TLS e o nome do app no ID', async () => {
    const fake = fakeImap(async () => undefined);
    const reader = createImapReader({ resolver, createClient: fake.createClient });
    await expect(reader.verify(IMAP)).resolves.toBe('ok');
    expect(fake.created[0]).toMatchObject({
      host: PUBLIC_IP,
      port: 993,
      secure: true,
      servername: 'imap.exemplo.com.br',
      verifyOnly: true,
      logger: false,
      clientInfo: { name: 'Prospector', version: '1' },
    });
    expect(fake.listeners()).toBe(1);
  });

  it('senha recusada e servidor interno', async () => {
    const refused = fakeImap(async () => {
      throw Object.assign(new Error('falha simulada'), { authenticationFailed: true });
    });
    const reader = createImapReader({ resolver, createClient: refused.createClient });
    await expect(reader.verify(IMAP)).resolves.toBe('auth_failed');
    await expect(reader.verify({ ...IMAP, host: 'misto.exemplo.com.br' })).resolves.toBe(
      'unreachable',
    );
    expect(refused.created).toHaveLength(1);
  });
});

describe('DNS (TXT)', () => {
  it('junta os pedaços de cada registro e separa ausência de falha', async () => {
    const lookup = createDnsTxtLookup({
      resolver: {
        async resolveTxt(name) {
          if (name === 'estudio.exemplo.com.br') {
            return [['v=spf1 include:_spf.mail.', 'hostinger.com ~all'], ['google-site=abc']];
          }
          if (name === '_dmarc.estudio.exemplo.com.br') throw coded('ENODATA');
          if (name === 'a._domainkey.estudio.exemplo.com.br') throw coded('ENOTFOUND');
          throw coded('ETIMEOUT');
        },
      },
    });
    await expect(lookup.txt('estudio.exemplo.com.br')).resolves.toEqual({
      status: 'found',
      records: ['v=spf1 include:_spf.mail.hostinger.com ~all', 'google-site=abc'],
    });
    await expect(lookup.txt('_dmarc.estudio.exemplo.com.br')).resolves.toEqual({
      status: 'missing',
      records: [],
    });
    await expect(lookup.txt('a._domainkey.estudio.exemplo.com.br')).resolves.toMatchObject({
      status: 'missing',
    });
    await expect(lookup.txt('outro.exemplo.com.br')).resolves.toMatchObject({ status: 'error' });
    await expect(lookup.txt('nome inválido')).resolves.toMatchObject({ status: 'error' });
  });
});
