import type { PendingAudit } from '@prospector/application';
import { describe, expect, it } from 'vitest';
import { createServerSupabaseClient, createSupabaseEmailRepository } from '../../src';
import { AUDIT_HEADER } from '../../src/strategy-repository';

/**
 * Adaptador do e-mail (ADR-0016) contra respostas do PostgREST simuladas (sem Supabase real):
 * rotas, RPCs da senha, auditoria e mapeamento. O comportamento do banco (Vault, travas e
 * verificação desfeita) está em tests/db/email.test.ts. Dados ILUSTRATIVOS.
 */

const URL_BASE = 'http://supabase.local.test';
const AT = '2026-11-25T12:00:00.123456+00:00';
const MAILBOX_ID = '11111111-1111-4111-8111-111111111111';
const IDENTITY_ID = '22222222-2222-4222-8222-222222222222';
const CHECK_ID = '33333333-3333-4333-8333-333333333333';
const SECRET = 'senha-de-teste-que-nao-pode-vazar';

interface Captured {
  url: URL;
  method: string;
  body: unknown;
  headers: Headers;
}

const AUDIT: PendingAudit = {
  actorType: 'user',
  actorLabel: null,
  traceId: '55555555-5555-4555-8555-555555555555',
  action: 'email.mailbox.password_set',
  entityType: 'mailbox',
  entityId: MAILBOX_ID,
  diff: { passwordChanged: true },
  withVersion: false,
};

function stub(respond: (req: Captured) => Response) {
  const calls: Captured[] = [];
  const fetchStub: typeof fetch = async (input, init) => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const req: Captured = {
      url: new URL(href),
      method: init?.method ?? 'GET',
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : null,
      headers: new Headers(init?.headers),
    };
    calls.push(req);
    return respond(req);
  };
  const client = createServerSupabaseClient(URL_BASE, 'chave-de-teste-nao-real', {
    fetch: fetchStub,
  });
  return { repo: createSupabaseEmailRepository(client), calls };
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const path = (req: Captured) => req.url.pathname.replace('/rest/v1/', '');

const sentAudit = (req: Captured | undefined) => {
  const value = req?.headers.get(AUDIT_HEADER);
  return value ? Buffer.from(value, 'base64').toString('utf8') : null;
};

const MAILBOX_ROW = {
  id: MAILBOX_ID,
  address: 'fala@estudio.exemplo.com.br',
  display_name: 'Pessoa Exemplo',
  smtp_host: 'smtp.hostinger.com',
  smtp_port: 465,
  imap_host: 'imap.hostinger.com',
  imap_port: 993,
  username: 'fala@estudio.exemplo.com.br',
  password_set_at: AT,
  daily_limit: 20,
  status: 'unverified',
  verified_at: null,
  created_at: AT,
  updated_at: AT,
};

const IDENTITY_ROW = {
  id: IDENTITY_ID,
  version: 2,
  sender_name: 'Pessoa Exemplo',
  role: 'Diretora de arte',
  studio: 'Estúdio Exemplo',
  location: null,
  website: 'https://estudio.exemplo.com.br',
  whatsapp: null,
  email: 'fala@estudio.exemplo.com.br',
  banner_url: null,
  banner_alt: null,
  socials: [
    {
      network: 'linkedin',
      url: 'https://linkedin.com/company/estudio-exemplo',
      iconUrl: 'https://estudio.exemplo.com.br/icones/linkedin.png',
    },
  ],
  accent: '#fa4e3e',
  created_at: AT,
};

describe('createSupabaseEmailRepository', () => {
  it('a caixa é lida sem a referência do cofre; "tem senha" vem da data da senha', async () => {
    const { repo, calls } = stub(() => json(200, MAILBOX_ROW));
    const mailbox = await repo.getMailbox();
    expect(mailbox).toMatchObject({ id: MAILBOX_ID, hasPassword: true, passwordSetAt: AT });
    expect(calls[0]?.url.searchParams.get('select')).not.toContain('secret');
  });

  it('a senha vai só pela RPC, com auditoria que não a carrega', async () => {
    const { repo, calls } = stub(() => json(200, null));
    await repo.setMailboxPassword(MAILBOX_ID, SECRET, AUDIT);
    expect(path(calls[0]!)).toBe('rpc/set_mailbox_password');
    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.body).toEqual({ p_mailbox_id: MAILBOX_ID, p_password: SECRET });
    const header = sentAudit(calls[0]);
    expect(header).toContain('"table":"mailboxes"');
    expect(header).not.toContain(SECRET);
  });

  it('lê a senha pela RPC e trata ausência como null', async () => {
    let answer: unknown = SECRET;
    const { repo, calls } = stub(() => json(200, answer));
    await expect(repo.readMailboxPassword(MAILBOX_ID)).resolves.toBe(SECRET);
    expect(path(calls[0]!)).toBe('rpc/mailbox_password');
    expect(sentAudit(calls[0])).toBeNull();
    answer = null;
    await expect(repo.readMailboxPassword(MAILBOX_ID)).resolves.toBeNull();
  });

  it('identidade: colunas em snake_case com auditoria e mapeamento de volta', async () => {
    const { repo, calls } = stub(() => json(201, IDENTITY_ROW));
    const version = await repo.addIdentityVersion(
      {
        senderName: 'Pessoa Exemplo',
        role: 'Diretora de arte',
        studio: 'Estúdio Exemplo',
        location: null,
        website: 'https://estudio.exemplo.com.br',
        whatsapp: null,
        email: 'fala@estudio.exemplo.com.br',
        bannerUrl: null,
        bannerAlt: null,
        socials: IDENTITY_ROW.socials as never,
        accent: '#fa4e3e',
      },
      {
        ...AUDIT,
        action: 'email.identity.versioned',
        entityType: 'sender_identity',
        withVersion: true,
      },
    );
    expect(path(calls[0]!)).toBe('sender_identities');
    expect(calls[0]?.body).toMatchObject({ sender_name: 'Pessoa Exemplo', banner_url: null });
    expect(sentAudit(calls[0])).toContain('"table":"sender_identities"');
    expect(version).toMatchObject({ version: 2, content: { location: null, accent: '#fa4e3e' } });
    expect(version.content.socials[0]?.network).toBe('linkedin');
  });

  it('conferência: inclusão sem auditoria e a mais recente por data', async () => {
    const row = {
      id: CHECK_ID,
      mailbox_id: MAILBOX_ID,
      smtp: 'ok',
      imap: 'ok',
      spf: 'ok',
      dkim: 'ok',
      dmarc: 'monitoring',
      details: { domain: 'estudio.exemplo.com.br', connection: 'x' },
      checked_at: AT,
    };
    const { repo, calls } = stub((req) => json(req.method === 'POST' ? 201 : 200, row));
    await repo.addCheck({
      mailboxId: MAILBOX_ID,
      smtp: 'ok',
      imap: 'ok',
      spf: 'ok',
      dkim: 'ok',
      dmarc: 'monitoring',
      details: { domain: 'estudio.exemplo.com.br', connection: 'x' },
      traceId: AUDIT.traceId,
      checkedAt: AT,
    });
    expect(calls[0]?.body).toMatchObject({ mailbox_id: MAILBOX_ID, trace_id: AUDIT.traceId });
    const latest = await repo.latestCheck(MAILBOX_ID);
    expect(latest).toMatchObject({ id: CHECK_ID, dmarc: 'monitoring' });
    expect(calls[1]?.url.searchParams.get('mailbox_id')).toBe(`eq.${MAILBOX_ID}`);
  });

  it('atualizar caixa que não existe é "não encontrado"', async () => {
    const { repo } = stub(() => json(200, null));
    await expect(repo.setMailboxStatus(MAILBOX_ID, 'unverified', AUDIT)).rejects.toMatchObject({
      code: 'not_found',
    });
  });

  it('status condicional: filtra pela data lida e avisa quando a caixa mudou', async () => {
    let answer: unknown = { ...MAILBOX_ROW, status: 'verified', verified_at: AT };
    const { repo, calls } = stub(() => json(200, answer));
    const updated = await repo.setMailboxStatus(MAILBOX_ID, 'verified', AUDIT, {
      expectedUpdatedAt: AT,
    });
    expect(updated.status).toBe('verified');
    expect(calls[0]?.method).toBe('PATCH');
    expect(calls[0]?.url.searchParams.get('id')).toBe(`eq.${MAILBOX_ID}`);
    expect(calls[0]?.url.searchParams.get('updated_at')).toBe(`eq.${AT}`);

    answer = null;
    await expect(
      repo.setMailboxStatus(MAILBOX_ID, 'verified', AUDIT, { expectedUpdatedAt: AT }),
    ).rejects.toMatchObject({ code: 'conflict', reason: 'concurrent_change' });
  });
});
