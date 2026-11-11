import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, expectDbError, type Queryable, type TestDb } from '../support/test-db';

/**
 * D-AI-4 — consumo de APIs externas (migração 20261110190000, ADR-0012): só inclusão, só o
 * servidor do app, e a soma mensal que alimenta o orçamento de créditos da pesquisa na internet.
 */

const TRACE = '6a1f0e2d-3c4b-4a59-8e7d-1c2b3a4f5e6d';

const insert = (
  q: Queryable,
  values: Partial<{
    provider: string;
    operation: string;
    units: number;
    period: string;
    outcome: string;
    ref: string | null;
  }> = {},
) =>
  q.query<{ id: string }>(
    `insert into public.provider_usage (provider, operation, units, period, outcome, trace_id, ref, occurred_at)
     values ($1, $2, $3, $4, $5, $6, $7, now()) returning id`,
    [
      values.provider ?? 'tavily',
      values.operation ?? 'search',
      values.units ?? 1,
      values.period ?? '2026-11',
      values.outcome ?? 'ok',
      TRACE,
      values.ref ?? null,
    ],
  );

describe('D-AI-4 — provider_usage no banco', () => {
  let db: TestDb;
  const asServer = <T>(fn: (q: Queryable) => Promise<T>) => db.asRole('service_role', fn);

  beforeAll(async () => {
    db = await createTestDb();
  });

  afterAll(async () => {
    await db?.close();
  });

  it('o servidor grava e lê a soma do mês por provedor', async () => {
    await asServer(async (q) => {
      await insert(q, { units: 1 });
      await insert(q, { units: 1, outcome: 'unavailable' });
      await insert(q, { units: 0, outcome: 'rate_limited' });
      await insert(q, { units: 1, period: '2026-10' });
      await insert(q, { provider: 'opencnpj', operation: 'lookup', units: 1 });
    });
    const rows = await asServer((q) =>
      q.query<{ provider: string; period: string; units_used: number; calls: number }>(
        `select provider, period, units_used, calls from public.provider_usage_monthly
         where provider = 'tavily' order by period`,
      ),
    );
    expect(rows.map((row) => [row.period, Number(row.units_used), Number(row.calls)])).toEqual([
      ['2026-10', 1, 1],
      ['2026-11', 2, 3],
    ]);
  });

  it('só inclusão: nem o servidor nem o dono alteram ou apagam', async () => {
    const [row] = await asServer((q) => insert(q));
    await expectDbError(
      asServer((q) =>
        q.query('update public.provider_usage set units = 0 where id = $1', [row!.id]),
      ),
      { code: '42501', message: /permission denied/ },
    );
    await expectDbError(
      db.query('update public.provider_usage set units = 0 where id = $1', [row!.id]),
      {
        message: 'append_only',
      },
    );
    await expectDbError(db.query('delete from public.provider_usage where id = $1', [row!.id]), {
      message: 'append_only',
    });
    await expectDbError(db.query('truncate public.provider_usage'), { message: 'append_only' });
  });

  it('valores fora do formato são recusados', async () => {
    for (const values of [
      { provider: 'Tavily' },
      { provider: 'x' },
      { operation: 'busca web' },
      { units: -1 },
      { units: 1001 },
      { period: '2026-13' },
      { period: '2026-1' },
      { outcome: 'OK!' },
      { ref: '' },
      { ref: 'x'.repeat(201) },
    ]) {
      await expectDbError(
        asServer((q) => insert(q, values)),
        { code: '23514' },
      );
    }
  });

  it('a API pública (anon/authenticated) não lê nem grava', async () => {
    for (const role of ['anon', 'authenticated'] as const) {
      await expectDbError(
        db.asRole(role, (q) => q.query('select * from public.provider_usage')),
        { code: '42501' },
      );
      await expectDbError(
        db.asRole(role, (q) => q.query('select * from public.provider_usage_monthly')),
        { code: '42501' },
      );
      await expectDbError(
        db.asRole(role, (q) => insert(q)),
        { code: '42501' },
      );
    }
  });
});
