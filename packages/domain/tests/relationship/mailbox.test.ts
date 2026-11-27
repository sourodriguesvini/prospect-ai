import { describe, expect, it } from 'vitest';

import {
  MAIL_PROVIDERS,
  assessDkim,
  assessDmarc,
  assessSpf,
  dkimSelectorsFor,
  emailDomain,
  mailboxCheckIssues,
  mailboxCheckPasses,
  providerForHost,
  type DnsTxtResult,
} from '../../src';

const found = (...records: string[]): DnsTxtResult => ({ status: 'found', records });
const missing: DnsTxtResult = { status: 'missing', records: [] };
const failed: DnsTxtResult = { status: 'error', records: [] };
const hostinger = MAIL_PROVIDERS.hostinger;
// Formato real de uma chave publicada pela Hostinger (encurtada; não é segredo, é DNS público).
const DKIM_KEY = `v=DKIM1;k=rsa;p=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAs${'A'.repeat(40)}IDAQAB`;

describe('provedor e seletores', () => {
  it('reconhece a Hostinger pelo servidor SMTP', () => {
    expect(providerForHost('smtp.hostinger.com')).toBe(hostinger);
    expect(providerForHost('smtp.exemplo.com.br')).toBeNull();
    expect(dkimSelectorsFor('smtp.hostinger.com').slice(0, 3)).toEqual([
      'hostingermail-a',
      'hostingermail-b',
      'hostingermail-c',
    ]);
    expect(dkimSelectorsFor('smtp.exemplo.com.br')).not.toContain('hostingermail-a');
    expect(emailDomain('Fala@Estudio.Exemplo.com.br')).toBe('estudio.exemplo.com.br');
  });
});

describe('assessSpf', () => {
  it('aceita o SPF que autoriza o provedor', () => {
    expect(assessSpf(found('v=spf1 include:_spf.mail.hostinger.com ~all'), hostinger)).toEqual({
      status: 'ok',
      record: 'v=spf1 include:_spf.mail.hostinger.com ~all',
    });
  });

  it('aponta ausência, duplicidade, "+all"/"?all" e provedor fora', () => {
    expect(assessSpf(found('google-site-verification=abc'), hostinger).status).toBe('missing');
    expect(assessSpf(missing, hostinger).status).toBe('missing');
    expect(assessSpf(found('v=spf1 -all', 'v=spf1 ~all'), hostinger).status).toBe('multiple');
    expect(assessSpf(found('v=spf1 include:_spf.mail.hostinger.com +all'), hostinger).status).toBe(
      'permissive',
    );
    expect(assessSpf(found('v=spf1 ?all'), null).status).toBe('permissive');
    expect(assessSpf(found('v=spf1 include:_spf.google.com ~all'), hostinger).status).toBe(
      'without_provider',
    );
    expect(assessSpf(found('v=spf1 include:_spf.google.com ~all'), null).status).toBe('ok');
    expect(assessSpf(failed, hostinger).status).toBe('unknown');
  });
});

describe('assessDmarc', () => {
  it('lê a política p=', () => {
    expect(assessDmarc(found('v=DMARC1; p=none')).status).toBe('monitoring');
    expect(assessDmarc(found('v=DMARC1; p=quarantine; rua=mailto:a@b.com.br')).status).toBe(
      'enforced',
    );
    expect(assessDmarc(found('v=DMARC1;p=reject')).status).toBe('enforced');
  });

  it('sem registro, registro duplicado ou sem política é ausência; DNS falho é desconhecido', () => {
    expect(assessDmarc(missing).status).toBe('missing');
    expect(assessDmarc(found('v=DMARC1; p=none', 'v=DMARC1; p=reject')).status).toBe('missing');
    expect(assessDmarc(found('v=DMARC1; rua=mailto:a@b.com.br')).status).toBe('missing');
    expect(assessDmarc(failed).status).toBe('unknown');
  });
});

describe('assessDkim', () => {
  it('basta um seletor com chave publicada; chave vazia (revogada) não conta', () => {
    expect(
      assessDkim([
        { selector: 'hostingermail-a', result: found(DKIM_KEY) },
        { selector: 'hostingermail-b', result: found('v=DKIM1;p=') },
        { selector: 'default', result: missing },
      ]),
    ).toEqual({ status: 'ok', selectors: ['hostingermail-a'] });
    expect(
      assessDkim([
        { selector: 'hostingermail-b', result: found('v=DKIM1;p=') },
        { selector: 'default', result: missing },
      ]).status,
    ).toBe('missing');
    expect(assessDkim([{ selector: 'default', result: failed }]).status).toBe('unknown');
  });
});

describe('mailboxCheckIssues', () => {
  const context = {
    domain: 'estudio.exemplo.com.br',
    smtpHost: 'smtp.hostinger.com',
    imapHost: 'imap.hostinger.com',
    provider: hostinger,
    dkimSelectors: dkimSelectorsFor('smtp.hostinger.com'),
  };

  it('tudo certo com DMARC só monitorando: passa, com aviso', () => {
    const issues = mailboxCheckIssues(
      { smtp: 'ok', imap: 'ok', spf: 'ok', dkim: 'ok', dmarc: 'monitoring' },
      context,
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ item: 'dmarc', severity: 'warning' });
    expect(mailboxCheckPasses(issues)).toBe(true);
  });

  it('senha recusada, IMAP fora, sem DKIM e sem DMARC bloqueiam, com o que fazer', () => {
    const issues = mailboxCheckIssues(
      {
        smtp: 'auth_failed',
        imap: 'unreachable',
        spf: 'missing',
        dkim: 'missing',
        dmarc: 'missing',
      },
      context,
    );
    expect(issues.map((issue) => [issue.item, issue.severity])).toEqual([
      ['smtp', 'blocking'],
      ['imap', 'blocking'],
      ['spf', 'blocking'],
      ['dkim', 'blocking'],
      ['dmarc', 'blocking'],
    ]);
    expect(issues[0]?.message).toContain('painel da Hostinger');
    expect(issues[2]?.message).toContain('include:_spf.mail.hostinger.com');
    expect(issues[3]?.message).toContain('hostingermail-a');
    expect(mailboxCheckPasses(issues)).toBe(false);
  });

  it('sem senha gravada, o login fica "não testado" e bloqueia', () => {
    const issues = mailboxCheckIssues(
      { smtp: 'not_tested', imap: 'not_tested', spf: 'ok', dkim: 'ok', dmarc: 'enforced' },
      context,
    );
    expect(issues.every((issue) => issue.severity === 'blocking')).toBe(true);
    expect(issues[0]?.message).toContain('grave a senha');
  });
});
