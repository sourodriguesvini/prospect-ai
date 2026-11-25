import {
  MAILBOX_CONNECTION_FIELDS,
  MAILBOX_CREDENTIAL_FIELDS,
  type PendingAudit,
} from '@prospector/application';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { encodeAuditHeader, type AuditedTable } from '../../src/strategy-repository';
import { createTestDb, expectDbError, type Queryable, type TestDb } from '../support/test-db';

/**
 * ADR-0016, fatia E3 (migração 20261125120000): identidade do remetente versionada, uma caixa de
 * e-mail com a senha no Vault (só por RPC), verificação desfeita quando a conexão muda e
 * conferências só de inclusão. Nada aqui envia e-mail.
 */

const TRACE = '6a1f0e2d-3c4b-4a59-8e7d-1c2b3a4f5e6d';
const PASSWORD = 'senha-de-teste-123';

const audit = (overrides: Partial<PendingAudit> = {}): PendingAudit => ({
  actorType: 'user',
  actorLabel: null,
  traceId: TRACE,
  action: 'email.mailbox.saved',
  entityType: 'mailbox',
  entityId: null,
  diff: {},
  withVersion: false,
  ...overrides,
});

/** Simula um pedido do PostgREST com o registro de auditoria (ou sem ele). */
const viaApi = (q: Queryable, table?: AuditedTable, entry: PendingAudit = audit()) =>
  q.query("select set_config('request.headers', $1, true)", [
    JSON.stringify({
      'content-type': 'application/json',
      ...(table ? { 'x-prospector-audit': encodeAuditHeader(table, entry) } : {}),
    }),
  ]);

const insertIdentity = (q: Queryable, senderName = 'Pessoa Exemplo') =>
  q.query<{ id: string; version: number }>(
    `insert into public.sender_identities (sender_name, role, studio, email, website, socials)
     values ($1, 'Designer de produto', 'Estúdio Exemplo', 'fala@estudio.exemplo.com.br',
             'https://estudio.exemplo.com.br/', '[]'::jsonb)
     returning id, version`,
    [senderName],
  );

const insertMailbox = (q: Queryable, address = 'fala@estudio.exemplo.com.br') =>
  q.query<{ id: string }>(
    `insert into public.mailboxes (address, display_name, smtp_host, smtp_port, imap_host, imap_port, username)
     values ($1, 'Pessoa Exemplo', 'smtp.hostinger.com', 465, 'imap.hostinger.com', 993, $1)
     returning id`,
    [address],
  );

type MailboxRow = {
  status: string;
  verified_at: string | null;
  secret_id: string | null;
  password_set_at: string | null;
};

describe('E3 — identidade e caixa de e-mail no banco', () => {
  let db: TestDb;
  let mailboxId: string;
  const asServer = <T>(fn: (q: Queryable) => Promise<T>) => db.asRole('service_role', fn);
  const mailbox = async () =>
    (
      await db.query<MailboxRow>(
        'select status, verified_at, secret_id, password_set_at from public.mailboxes where id = $1',
        [mailboxId],
      )
    )[0]!;
  const markVerified = () =>
    asServer((q) =>
      q.query(
        "update public.mailboxes set status = 'verified', verified_at = now() where id = $1",
        [mailboxId],
      ),
    );

  beforeAll(async () => {
    db = await createTestDb();
    const [row] = await asServer((q) => insertMailbox(q));
    mailboxId = row!.id;
  });

  afterAll(async () => {
    await db?.close();
  });

  it('identidade: o banco numera as versões e não deixa alterar nem apagar', async () => {
    const [first] = await asServer((q) => insertIdentity(q));
    const [second] = await asServer((q) => insertIdentity(q, 'Pessoa Exemplo 2'));
    expect(second!.version).toBe(first!.version + 1);
    await expectDbError(
      db.query("update public.sender_identities set role = 'x' where id = $1", [first!.id]),
      { message: 'version_immutable' },
    );
    await expectDbError(
      db.query('delete from public.sender_identities where id = $1', [first!.id]),
      { message: 'version_immutable' },
    );
  });

  it('identidade: recusa endereço que não é https e cor fora do formato', async () => {
    await expectDbError(
      asServer((q) =>
        q.query(
          `insert into public.sender_identities (sender_name, role, studio, email, website)
           values ('A', 'B', 'C', 'a@b.com.br', 'http://inseguro.com.br')`,
        ),
      ),
      { code: '23514' },
    );
    await expectDbError(
      asServer((q) =>
        q.query(
          `insert into public.sender_identities (sender_name, role, studio, email, accent)
           values ('A', 'B', 'C', 'a@b.com.br', 'red')`,
        ),
      ),
      { code: '23514' },
    );
  });

  it('uma caixa só, endereço em minúsculas e portas conhecidas', async () => {
    await expectDbError(
      asServer((q) => insertMailbox(q, 'outra@estudio.exemplo.com.br')),
      { code: '23505' },
    );
    await expectDbError(
      asServer((q) =>
        q.query('update public.mailboxes set smtp_port = 25 where id = $1', [mailboxId]),
      ),
      { code: '23514' },
    );
    await expectDbError(
      asServer((q) =>
        q.query("update public.mailboxes set address = 'Fala@X.com.br' where id = $1", [mailboxId]),
      ),
      { code: '23514' },
    );
    // O remetente fica no domínio do usuário (o login não prova outro endereço); apelido vale.
    await expectDbError(
      asServer((q) =>
        q.query("update public.mailboxes set address = 'terceiro@outro.com.br' where id = $1", [
          mailboxId,
        ]),
      ),
      { code: '23514' },
    );
    await asServer((q) =>
      q.query("update public.mailboxes set address = 'oi@estudio.exemplo.com.br' where id = $1", [
        mailboxId,
      ]),
    );
    await asServer((q) =>
      q.query("update public.mailboxes set address = 'fala@estudio.exemplo.com.br' where id = $1", [
        mailboxId,
      ]),
    );
  });

  it('a senha vai para o Vault pela RPC e volta só por ela', async () => {
    await asServer((q) =>
      q.query('select public.set_mailbox_password($1, $2)', [mailboxId, PASSWORD]),
    );
    const row = await mailbox();
    expect(row.secret_id).not.toBeNull();
    expect(row.password_set_at).not.toBeNull();
    const [stored] = await db.query<{ json: string }>(
      'select to_jsonb(m)::text as json from public.mailboxes m where id = $1',
      [mailboxId],
    );
    expect(stored!.json).not.toContain(PASSWORD);

    const [read] = await asServer((q) =>
      q.query<{ password: string }>('select public.mailbox_password($1) as password', [mailboxId]),
    );
    expect(read!.password).toBe(PASSWORD);

    // Trocar a senha atualiza o mesmo segredo.
    await asServer((q) =>
      q.query('select public.set_mailbox_password($1, $2)', [mailboxId, 'nova-senha']),
    );
    const [again] = await asServer((q) =>
      q.query<{ password: string }>('select public.mailbox_password($1) as password', [mailboxId]),
    );
    expect(again!.password).toBe('nova-senha');
    expect((await mailbox()).secret_id).toBe(row.secret_id);
    const [count] = await db.query<{ n: number }>('select count(*)::int as n from vault.secrets');
    expect(count!.n).toBe(1);
  });

  it('senha vazia ou caixa inexistente são recusadas', async () => {
    await expectDbError(
      asServer((q) => q.query('select public.set_mailbox_password($1, $2)', [mailboxId, ''])),
      { message: 'invalid_input' },
    );
    await expectDbError(
      asServer((q) =>
        q.query('select public.set_mailbox_password($1, $2)', [
          '00000000-0000-4000-8000-000000000000',
          'x',
        ]),
      ),
      { message: 'not_found' },
    );
  });

  it('o servidor não grava secret_id direto; a API pública não executa as RPCs', async () => {
    await expectDbError(
      asServer((q) =>
        q.query(
          'update public.mailboxes set secret_id = null, password_set_at = null where id = $1',
          [mailboxId],
        ),
      ),
      { code: '42501' },
    );
    // Nem na inclusão: secret_id, status e verified_at não entram pelo servidor.
    await expectDbError(
      asServer((q) =>
        q.query(
          `insert into public.mailboxes (address, display_name, smtp_host, smtp_port, imap_host,
             imap_port, username, secret_id, password_set_at, status, verified_at)
           values ('a@b.com.br', 'A', 'smtp.b.com.br', 465, 'imap.b.com.br', 993, 'a@b.com.br',
             gen_random_uuid(), now(), 'verified', now())`,
        ),
      ),
      { code: '42501' },
    );
    for (const role of ['anon', 'authenticated'] as const) {
      await expectDbError(
        db.asRole(role, (q) => q.query('select public.mailbox_password($1)', [mailboxId])),
        { code: '42501' },
      );
      await expectDbError(
        db.asRole(role, (q) =>
          q.query('select public.set_mailbox_password($1, $2)', [mailboxId, 'x']),
        ),
        { code: '42501' },
      );
    }
  });

  it('mudar servidor, usuário ou senha desfaz a verificação; mudar o nome não', async () => {
    await markVerified();
    await asServer((q) =>
      q.query("update public.mailboxes set display_name = 'Outro nome' where id = $1", [mailboxId]),
    );
    expect((await mailbox()).status).toBe('verified');

    const before = await mailbox();
    await asServer((q) =>
      q.query("update public.mailboxes set smtp_host = 'smtp.exemplo.com.br' where id = $1", [
        mailboxId,
      ]),
    );
    let row = await mailbox();
    expect(row.status).toBe('unverified');
    expect(row.verified_at).toBeNull();
    // A senha era do servidor anterior: deixa de valer e não é entregue ao novo.
    expect(row.secret_id).toBeNull();
    expect(row.password_set_at).toBeNull();
    const [none] = await asServer((q) =>
      q.query<{ password: string | null }>('select public.mailbox_password($1) as password', [
        mailboxId,
      ]),
    );
    expect(none!.password).toBeNull();

    // Digitada de novo, reaproveita o mesmo segredo do Vault (pelo nome).
    await asServer((q) =>
      q.query('select public.set_mailbox_password($1, $2)', [mailboxId, 'redigitada']),
    );
    expect((await mailbox()).secret_id).toBe(before.secret_id);
    const [count] = await db.query<{ n: number }>('select count(*)::int as n from vault.secrets');
    expect(count!.n).toBe(1);

    await markVerified();
    // Mudar só a porta mantém a senha (mesmo servidor), mas desfaz a verificação.
    await asServer((q) =>
      q.query('update public.mailboxes set smtp_port = 587 where id = $1', [mailboxId]),
    );
    row = await mailbox();
    expect(row.status).toBe('unverified');
    expect(row.secret_id).not.toBeNull();

    await markVerified();
    await asServer((q) =>
      q.query('select public.set_mailbox_password($1, $2)', [mailboxId, 'troca']),
    );
    row = await mailbox();
    expect(row.status).toBe('unverified');
    expect(row.verified_at).toBeNull();
  });

  /**
   * Coluna de cada campo da conexão (listas do serviço, `MAILBOX_*_FIELDS`) e um valor novo válido
   * a partir do atual. `null`: só há um valor aceito (porta IMAP), então o teste lê o gatilho.
   */
  const CONNECTION_COLUMNS: Record<
    (typeof MAILBOX_CONNECTION_FIELDS)[number],
    { column: string; next: ((current: unknown) => string | number) | null }
  > = {
    address: {
      column: 'address',
      next: (v) =>
        v === 'contato@estudio.exemplo.com.br'
          ? 'fala@estudio.exemplo.com.br'
          : 'contato@estudio.exemplo.com.br',
    },
    smtpHost: { column: 'smtp_host', next: (v) => `x.${String(v)}` },
    smtpPort: { column: 'smtp_port', next: (v) => (v === 587 ? 465 : 587) },
    imapHost: { column: 'imap_host', next: (v) => `x.${String(v)}` },
    imapPort: { column: 'imap_port', next: null },
    username: {
      column: 'username',
      next: (v) =>
        v === 'contato@estudio.exemplo.com.br'
          ? 'fala@estudio.exemplo.com.br'
          : 'contato@estudio.exemplo.com.br',
    },
  };

  it('o gatilho segue as listas do serviço: conexão desfaz a conferência, credencial a senha', async () => {
    const [fn] = await db.query<{ def: string }>(
      "select pg_get_functiondef('app.mailbox_reset_verification'::regproc) as def",
    );
    const credential = new Set<string>(MAILBOX_CREDENTIAL_FIELDS);
    for (const field of MAILBOX_CONNECTION_FIELDS) {
      const { column, next } = CONNECTION_COLUMNS[field];
      expect(fn!.def, field).toContain(`new.${column} is distinct from old.${column}`);
      if (!next) continue;
      const [original] = await db.query<{ v: unknown }>(
        `select ${column} as v from public.mailboxes where id = $1`,
        [mailboxId],
      );
      await asServer((q) =>
        q.query('select public.set_mailbox_password($1, $2)', [mailboxId, PASSWORD]),
      );
      await markVerified();
      await asServer((q) =>
        q.query(`update public.mailboxes set ${column} = $2 where id = $1`, [
          mailboxId,
          next(original!.v),
        ]),
      );
      const after = await mailbox();
      expect(after.status, field).toBe('unverified');
      expect(after.verified_at, field).toBeNull();
      if (credential.has(field)) expect(after.password_set_at, field).toBeNull();
      else expect(after.password_set_at, field).not.toBeNull();
      await asServer((q) =>
        q.query(`update public.mailboxes set ${column} = $2 where id = $1`, [
          mailboxId,
          original!.v,
        ]),
      );
    }
    // Deixa a caixa com senha, como os testes seguintes esperam.
    await asServer((q) =>
      q.query('select public.set_mailbox_password($1, $2)', [mailboxId, PASSWORD]),
    );
  });

  it('a senha só sai do segredo com o nome da própria caixa', async () => {
    const [own] = await db.query<{ secret_id: string }>(
      'select secret_id from public.mailboxes where id = $1',
      [mailboxId],
    );
    const [other] = await db.query<{ id: string }>(
      "select vault.create_secret('OUTRO-SEGREDO', 'outro_segredo') as id",
    );
    await db.query('update public.mailboxes set secret_id = $2 where id = $1', [
      mailboxId,
      other!.id,
    ]);
    const [read] = await asServer((q) =>
      q.query<{ password: string | null }>('select public.mailbox_password($1) as password', [
        mailboxId,
      ]),
    );
    expect(read!.password).toBeNull();
    await db.query('update public.mailboxes set secret_id = $2 where id = $1', [
      mailboxId,
      own!.secret_id,
    ]);
    await db.query("delete from vault.secrets where name = 'outro_segredo'");
  });

  it('caixa pausada continua pausada ao trocar a senha', async () => {
    await asServer((q) =>
      q.query("update public.mailboxes set status = 'paused' where id = $1", [mailboxId]),
    );
    await asServer((q) =>
      q.query('select public.set_mailbox_password($1, $2)', [mailboxId, 'troca-2']),
    );
    expect((await mailbox()).status).toBe('paused');
    await asServer((q) =>
      q.query("update public.mailboxes set status = 'unverified' where id = $1", [mailboxId]),
    );
  });

  it('verificada exige senha e data; a caixa não é apagada', async () => {
    await expectDbError(
      asServer((q) =>
        q.query(
          "update public.mailboxes set status = 'verified', verified_at = null where id = $1",
          [mailboxId],
        ),
      ),
      { code: '23514' },
    );
    await expectDbError(db.query('delete from public.mailboxes where id = $1', [mailboxId]), {
      message: 'append_only',
    });
  });

  it('conferências: só inclusão e sem valores fora da lista', async () => {
    const [check] = await asServer((q) =>
      q.query<{ id: string }>(
        `insert into public.mailbox_checks (mailbox_id, smtp, imap, spf, dkim, dmarc, details, trace_id, checked_at)
         values ($1, 'ok', 'ok', 'ok', 'ok', 'monitoring', '{"spfRecord":"v=spf1 ~all"}', $2, now())
         returning id`,
        [mailboxId, TRACE],
      ),
    );
    await expectDbError(
      db.query("update public.mailbox_checks set smtp = 'auth_failed' where id = $1", [check!.id]),
      { message: 'append_only' },
    );
    await expectDbError(
      asServer((q) =>
        q.query(
          `insert into public.mailbox_checks (mailbox_id, smtp, imap, spf, dkim, dmarc, trace_id, checked_at)
           values ($1, 'talvez', 'ok', 'ok', 'ok', 'monitoring', $2, now())`,
          [mailboxId, TRACE],
        ),
      ),
      { code: '23514' },
    );
  });

  it('pela API, escrita sem auditoria é recusada e com auditoria fica registrada', async () => {
    await expectDbError(
      asServer(async (q) => {
        await viaApi(q);
        await insertIdentity(q, 'Sem auditoria');
      }),
      { message: 'audit_missing' },
    );
    await asServer(async (q) => {
      await viaApi(
        q,
        'mailboxes',
        audit({ action: 'email.mailbox.password_set', diff: { passwordChanged: true } }),
      );
      await q.query('select public.set_mailbox_password($1, $2)', [mailboxId, 'com-auditoria']);
    });
    const [entry] = await db.query<{ action: string; diff: unknown }>(
      `select action, diff from public.audit_log
       where action = 'email.mailbox.password_set' order by id desc limit 1`,
    );
    expect(entry?.action).toBe('email.mailbox.password_set');
    expect(JSON.stringify(entry?.diff)).not.toContain('com-auditoria');
  });
});
