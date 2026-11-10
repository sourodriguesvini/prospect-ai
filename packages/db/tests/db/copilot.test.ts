import type { PendingAudit } from '@prospector/application';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { encodeAuditHeader } from '../../src/strategy-repository';
import { createTestDb, expectDbError, type Queryable, type TestDb } from '../support/test-db';

/**
 * IA-2 — conversas do Copiloto e telemetria (migração 20261110150000). Conversas são auditadas
 * na mesma transação (ADR-0010); mensagens, `llm_calls` e `tool_calls` são só inclusão.
 */

const TRACE = '3e2d1c0b-9a8f-4e7d-8c6b-5a4f3e2d1c0b';

const pending = (overrides: Partial<PendingAudit> = {}): PendingAudit => ({
  actorType: 'user',
  actorLabel: null,
  traceId: TRACE,
  action: 'copilot.thread.create',
  entityType: 'copilot_thread',
  entityId: null,
  diff: {},
  withVersion: false,
  ...overrides,
});

const viaApi = (q: Queryable, header?: string) =>
  q.query("select set_config('request.headers', $1, true)", [
    JSON.stringify({
      'content-type': 'application/json',
      ...(header === undefined ? {} : { 'x-prospector-audit': header }),
    }),
  ]);

describe('IA-2 — conversas do Copiloto no banco', () => {
  let db: TestDb;
  const asServer = <T>(fn: (q: Queryable) => Promise<T>) => db.asRole('service_role', fn);

  const createThread = (title = 'Quais ofertas eu tenho?') =>
    asServer(async (q) => {
      await viaApi(q, encodeAuditHeader('copilot_threads', pending()));
      const rows = await q.query<{ id: string }>(
        'insert into public.copilot_threads (title) values ($1) returning id',
        [title],
      );
      return rows[0]!.id;
    });

  const addMessage = (threadId: string, role: 'user' | 'assistant' | 'tool', extra = {}) =>
    asServer((q) =>
      q.query<{ id: string; seq: string }>(
        `insert into public.copilot_messages
           (thread_id, role, content, trace_id, tool_name, tool_status, tool_call_id)
         values ($1, $2, $3, $4, $5, $6, $7) returning id, seq`,
        [
          threadId,
          role,
          `${role} diz algo`,
          TRACE,
          ...Object.values({
            tool_name: role === 'tool' ? 'list_offers' : null,
            tool_status: role === 'tool' ? 'ok' : null,
            tool_call_id: role === 'tool' ? 'c1' : null,
            ...extra,
          }),
        ],
      ),
    );

  const auditActions = (entityId: string) =>
    db.query<{ action: string; entity_type: string; trace_id: string }>(
      'select action, entity_type, trace_id from public.audit_log where entity_id = $1 order by id',
      [entityId],
    );

  beforeAll(async () => {
    db = await createTestDb();
  });

  afterAll(async () => {
    await db.close();
  });

  it('criar, renomear e arquivar gravam a auditoria no mesmo pedido', async () => {
    const id = await createThread();
    await asServer(async (q) => {
      await viaApi(
        q,
        encodeAuditHeader(
          'copilot_threads',
          pending({ action: 'copilot.thread.rename', entityId: id }),
        ),
      );
      await q.query("update public.copilot_threads set title = 'Ofertas' where id = $1", [id]);
    });
    await asServer(async (q) => {
      await viaApi(
        q,
        encodeAuditHeader(
          'copilot_threads',
          pending({ action: 'copilot.thread.archive', entityId: id }),
        ),
      );
      await q.query('update public.copilot_threads set archived_at = now() where id = $1', [id]);
    });
    expect(await auditActions(id)).toEqual([
      { action: 'copilot.thread.create', entity_type: 'copilot_thread', trace_id: TRACE },
      { action: 'copilot.thread.rename', entity_type: 'copilot_thread', trace_id: TRACE },
      { action: 'copilot.thread.archive', entity_type: 'copilot_thread', trace_id: TRACE },
    ]);
  });

  it('pelo PostgREST, criar conversa sem o registro de auditoria é recusado', async () => {
    await expectDbError(
      asServer(async (q) => {
        await viaApi(q);
        return q.query("insert into public.copilot_threads (title) values ('sem auditoria')");
      }),
      { message: 'audit_missing' },
    );
  });

  it('título vazio ou longo demais é recusado', async () => {
    for (const title of ['   ', 'x'.repeat(121)]) {
      await expectDbError(createThread(title), { code: '23514' });
    }
  });

  it('mensagens: só inclusão, em ordem, e a lista conta perguntas e respostas', async () => {
    const id = await createThread();
    await addMessage(id, 'user');
    await addMessage(id, 'tool');
    const [answer] = await addMessage(id, 'assistant');

    // Duas camadas: o servidor do app nem tem o privilégio, e o trigger barra até o dono.
    await expectDbError(
      asServer((q) =>
        q.query("update public.copilot_messages set content = 'reescrito' where id = $1", [
          answer!.id,
        ]),
      ),
      { code: '42501', message: /permission denied/ },
    );
    await expectDbError(
      db.query("update public.copilot_messages set content = 'reescrito' where id = $1", [
        answer!.id,
      ]),
      { message: 'append_only' },
    );
    await expectDbError(
      db.query('delete from public.copilot_messages where id = $1', [answer!.id]),
      { message: 'append_only' },
    );

    const [summary] = await asServer((q) =>
      q.query<{ message_count: string }>(
        'select message_count from public.copilot_thread_summaries where id = $1',
        [id],
      ),
    );
    expect(Number(summary!.message_count)).toBe(2);
    const roles = await asServer((q) =>
      q.query<{ role: string }>(
        'select role from public.copilot_messages where thread_id = $1 order by seq',
        [id],
      ),
    );
    expect(roles.map((row) => row.role)).toEqual(['user', 'tool', 'assistant']);
  });

  it('resultado de ferramenta precisa de nome e status; pergunta não pode ter', async () => {
    const id = await createThread();
    await expectDbError(addMessage(id, 'tool', { tool_name: null }), { code: '23514' });
    await expectDbError(addMessage(id, 'user', { tool_name: 'list_offers', tool_status: 'ok' }), {
      code: '23514',
    });
    await expectDbError(addMessage(id, 'tool', { tool_name: 'Apagar Tudo' }), { code: '23514' });
  });

  it('telemetria: llm_calls e tool_calls só inclusão, com limites', async () => {
    const [llm] = await asServer((q) =>
      q.query<{ id: string; cost_usd: string }>(
        `insert into public.llm_calls (task, model, trace_id, status, output_tokens, total_ms)
         values ('copilot', 'qwen3.5:4b', $1, 'ok', 20, 900.5) returning id, cost_usd`,
        [TRACE],
      ),
    );
    expect(Number(llm!.cost_usd)).toBe(0);
    await expectDbError(
      asServer((q) => q.query('update public.llm_calls set model = $1', ['outro'])),
      { code: '42501', message: /permission denied/ },
    );
    await expectDbError(db.query('update public.llm_calls set model = $1', ['outro']), {
      message: 'append_only',
    });

    await asServer((q) =>
      q.query(
        `insert into public.tool_calls (trace_id, tool, input_redacted, status, duration_ms)
         values ($1, 'list_offers', '{"status":"active"}', 'ok', 12)`,
        [TRACE],
      ),
    );
    await expectDbError(
      asServer((q) =>
        q.query(
          `insert into public.tool_calls (trace_id, tool, input_redacted, status, duration_ms)
           values ($1, 'list_offers', $2, 'ok', 1)`,
          [TRACE, JSON.stringify({ texto: 'x'.repeat(5000) })],
        ),
      ),
      { code: '23514' },
    );
    await expectDbError(db.query('delete from public.tool_calls'), { message: 'append_only' });
    await expectDbError(db.query('truncate public.tool_calls'), { message: 'append_only' });
  });

  it('a API pública não lê conversas nem telemetria', async () => {
    for (const role of ['anon', 'authenticated'] as const) {
      for (const table of [
        'copilot_threads',
        'copilot_messages',
        'copilot_thread_summaries',
        'llm_calls',
        'tool_calls',
      ]) {
        await expectDbError(
          db.asRole(role, (q) => q.query(`select * from public.${table}`)),
          { code: '42501' },
        );
      }
    }
  });
});
