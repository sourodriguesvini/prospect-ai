import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { tablePrivileges } from '../support/catalog';
import { createTestDb, expectDbError, type Queryable, type TestDb } from '../support/test-db';

const insertEntry = (q: Queryable, overrides: Record<string, unknown> = {}) => {
  const entry = {
    actor_type: 'user',
    actor_label: null,
    action: 'system.health.checked',
    entity_type: 'system',
    entity_id: null,
    diff: { ok: true },
    trace_id: randomUUID(),
    ...overrides,
  };
  return q.query<{ id: string }>(
    `insert into public.audit_log (actor_type, actor_label, action, entity_type, entity_id, diff, trace_id)
     values ($1, $2, $3, $4, $5, $6::jsonb, $7) returning id`,
    [
      entry.actor_type,
      entry.actor_label,
      entry.action,
      entry.entity_type,
      entry.entity_id,
      JSON.stringify(entry.diff),
      entry.trace_id,
    ],
  );
};

describe('audit_log', () => {
  let db: TestDb;
  beforeAll(async () => {
    db = await createTestDb();
  });
  afterAll(async () => {
    await db.close();
  });

  it('o servidor (service_role) inclui e lê entradas com ator e traceId', async () => {
    const traceId = randomUUID();
    await db.asRole('service_role', (q) =>
      insertEntry(q, {
        actor_type: 'agent',
        actor_label: 'investigador@v1',
        action: 'research.company.investigated',
        entity_type: 'company',
        entity_id: 'empresa-1',
        trace_id: traceId,
      }),
    );
    const rows = await db.asRole('service_role', (q) =>
      q.query<{ actor_type: string; actor_label: string; action: string }>(
        'select actor_type, actor_label, action from public.audit_log where trace_id = $1',
        [traceId],
      ),
    );
    expect(rows).toEqual([
      {
        actor_type: 'agent',
        actor_label: 'investigador@v1',
        action: 'research.company.investigated',
      },
    ]);
  });

  it('o servidor só tem leitura e inclusão', async () => {
    expect(await tablePrivileges(db, 'service_role', 'audit_log')).toEqual(['SELECT', 'INSERT']);
  });

  it('update, delete e truncate falham para todos, inclusive o dono do banco', async () => {
    await db.asRole('service_role', (q) => insertEntry(q));
    await expectDbError(
      db.asRole('service_role', (q) => q.query("update public.audit_log set action = 'a.b'")),
      { code: '42501' },
    );
    await expectDbError(
      db.asRole('service_role', (q) => q.query('delete from public.audit_log')),
      { code: '42501' },
    );
    await expectDbError(db.query("update public.audit_log set action = 'a.b'"), {
      message: 'audit_log_append_only',
    });
    await expectDbError(db.query('delete from public.audit_log'), {
      message: 'audit_log_append_only',
    });
    await expectDbError(db.query('truncate public.audit_log'), {
      message: 'audit_log_append_only',
    });
  });

  it('a API pública (anon/authenticated) não lê nem inclui', async () => {
    for (const role of ['anon', 'authenticated'] as const) {
      await expectDbError(
        db.asRole(role, (q) => q.query('select id from public.audit_log')),
        { code: '42501' },
      );
      await expectDbError(
        db.asRole(role, (q) => insertEntry(q)),
        { code: '42501' },
      );
    }
  });

  it('recusa ator desconhecido, ação fora da convenção e diff grande demais', async () => {
    await expectDbError(
      db.asRole('service_role', (q) => insertEntry(q, { actor_type: 'admin' })),
      { code: '23514' },
    );
    for (const action of ['forjado', 'Approvals.Grant', 'a..b', 'a.b.c.d.e']) {
      await expectDbError(
        db.asRole('service_role', (q) => insertEntry(q, { action })),
        { code: '23514' },
      );
    }
    await expectDbError(
      db.asRole('service_role', (q) => insertEntry(q, { diff: { blob: 'x'.repeat(70_000) } })),
      { code: '23514' },
    );
  });
});
