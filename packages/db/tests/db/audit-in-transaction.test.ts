import type { PendingAudit } from '@prospector/application';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { encodeAuditHeader, type AuditedTable } from '../../src/strategy-repository';
import { createTestDb, expectDbError, type Queryable, type TestDb } from '../support/test-db';

/**
 * KI-041 — o registro de auditoria chega no cabeçalho `x-prospector-audit` do mesmo pedido e o
 * trigger `app.audit_write` o grava na mesma transação da escrita. O PostgREST põe os cabeçalhos
 * em `request.headers`; aqui o teste faz o mesmo com `set_config` dentro da transação.
 * A codificação é a do adaptador (`encodeAuditHeader`), para os dois lados não divergirem.
 */

const TRACE = '6f1c1b1e-2a4b-4c55-9d1e-7f2b8c9d0e1f';

const pending = (overrides: Partial<PendingAudit> = {}): PendingAudit => ({
  actorType: 'user',
  actorLabel: null,
  traceId: TRACE,
  action: 'strategy.offer.versioned',
  entityType: 'offer',
  entityId: null,
  diff: {},
  withVersion: false,
  ...overrides,
});

/** Simula um pedido do PostgREST: com o registro de auditoria ou só com outros cabeçalhos. */
const viaApi = (q: Queryable, header?: string) =>
  q.query("select set_config('request.headers', $1, true)", [
    JSON.stringify({
      'content-type': 'application/json',
      ...(header === undefined ? {} : { 'x-prospector-audit': header }),
    }),
  ]);

const withAudit = (
  q: Queryable,
  table: AuditedTable,
  audit: PendingAudit,
  covers: AuditedTable[] = [],
) => viaApi(q, encodeAuditHeader(table, audit, covers));

const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64');

const versionColumns = {
  name: 'Identidade visual',
  description: '',
  problems: [],
  need_signals: [],
  disqualifiers: [],
  deliverables: [],
  value_props: [],
  price_min_cents: null,
  price_max_cents: null,
};

const createOffer = async (q: Queryable) => {
  const rows = await q.query<{ id: string }>('select public.create_offer($1::jsonb) as id', [
    JSON.stringify(versionColumns),
  ]);
  return rows[0]!.id;
};

const insertOfferVersion = (q: Queryable, offerId: string) =>
  q.query<{ version: number }>(
    `insert into public.offer_versions (offer_id, name) values ($1, 'Identidade visual v2')
     returning version`,
    [offerId],
  );

describe('KI-041 — auditoria na mesma transação da escrita', () => {
  let db: TestDb;
  const asServer = <T>(fn: (q: Queryable) => Promise<T>) => db.asRole('service_role', fn);

  const auditRows = (entityId: string) =>
    db.query<{
      action: string;
      actor_type: string;
      actor_label: string | null;
      entity_type: string;
      entity_id: string;
      diff: Record<string, unknown>;
      trace_id: string;
    }>(
      `select action, actor_type, actor_label, entity_type, entity_id, diff, trace_id
       from public.audit_log where entity_id = $1 order by id`,
      [entityId],
    );

  const versionCount = async (offerId: string) =>
    Number(
      (
        await db.query<{ n: string }>(
          'select count(*) as n from public.offer_versions where offer_id = $1',
          [offerId],
        )
      )[0]!.n,
    );

  beforeAll(async () => {
    db = await createTestDb();
  });

  afterAll(async () => {
    await db.close();
  });

  it('SQL direto (sem PostgREST) grava sem auditoria por este caminho', async () => {
    const offerId = await asServer((q) => createOffer(q));
    expect(await auditRows(offerId)).toEqual([]);
    expect(await versionCount(offerId)).toBe(1);
  });

  it('RPC que grava cabeçalho e versão registra uma vez, com o id do cabeçalho', async () => {
    const offerId = await asServer(async (q) => {
      await withAudit(
        q,
        'offers',
        pending({ action: 'strategy.offer.created', diff: { version: 1 } }),
        ['offer_versions'],
      );
      return createOffer(q);
    });
    expect(await auditRows(offerId)).toEqual([
      {
        action: 'strategy.offer.created',
        actor_type: 'user',
        actor_label: null,
        entity_type: 'offer',
        entity_id: offerId,
        diff: { version: 1 },
        trace_id: TRACE,
      },
    ]);
  });

  it('versão nova registra com o número atribuído pelo banco', async () => {
    const offerId = await asServer((q) => createOffer(q));
    const [row] = await asServer(async (q) => {
      await withAudit(
        q,
        'offer_versions',
        pending({ entityId: offerId, diff: { previousVersion: 1 }, withVersion: true }),
      );
      return insertOfferVersion(q, offerId);
    });
    expect(row!.version).toBe(2);
    const [entry] = await auditRows(offerId);
    expect(entry).toMatchObject({
      action: 'strategy.offer.versioned',
      entity_id: offerId,
      diff: { previousVersion: 1, version: 2 },
    });
  });

  it('se a auditoria falhar, a escrita é desfeita (ou os dois ficam, ou nenhum)', async () => {
    const offerId = await asServer((q) => createOffer(q));
    await expectDbError(
      asServer(async (q) => {
        // Ação fora do formato: o check do audit_log recusa dentro da mesma transação, e o
        // erro sai como `audit_invalid` (defeito do servidor, não erro de digitação).
        await withAudit(
          q,
          'offer_versions',
          pending({ action: 'Ação Inválida', entityId: offerId }),
        );
        return insertOfferVersion(q, offerId);
      }),
      { message: 'audit_invalid', code: 'P0001' },
    );
    expect(await versionCount(offerId)).toBe(1);
    expect(await auditRows(offerId)).toEqual([]);
  });

  it('pelo PostgREST, escrita sem o registro de auditoria é recusada', async () => {
    const offerId = await asServer((q) => createOffer(q));
    await expectDbError(
      asServer(async (q) => {
        await viaApi(q);
        return insertOfferVersion(q, offerId);
      }),
      { message: 'audit_missing' },
    );
    expect(await versionCount(offerId)).toBe(1);
  });

  it('registro malformado é recusado', async () => {
    const offerId = await asServer((q) => createOffer(q));
    for (const header of [
      'isto-nao-e-base64!!',
      Buffer.from('[1,2]').toString('base64'),
      b64({ table: 'offer_versions', diff: 'texto' }),
      // Sem `table`, ou com outra tabela (fora de `covers`): antes passava sem registro.
      b64({}),
      b64({ ...pending(), table: 7 }),
      encodeAuditHeader('offers', pending({ entityId: offerId })),
      b64({ ...pending({ entityId: offerId }), table: 'offers', covers: 'offer_versions' }),
      // Ator e traceId fora dos limites do audit_log.
      b64({ ...pending({ traceId: 'abc' }), table: 'offer_versions' }),
      b64({ ...pending({ actorLabel: '' }), table: 'offer_versions' }),
      b64({ ...pending({ actorType: 'admin' as 'user' }), table: 'offer_versions' }),
    ]) {
      await expectDbError(
        asServer(async (q) => {
          await viaApi(q, header);
          return insertOfferVersion(q, offerId);
        }),
        { message: 'audit_invalid' },
      );
    }
    expect(await versionCount(offerId)).toBe(1);
  });

  it('RPC que grava duas tabelas sem declarar a segunda em covers é recusada inteira', async () => {
    const before = Number(
      (await db.query<{ n: string }>('select count(*) as n from public.offers'))[0]!.n,
    );
    await expectDbError(
      asServer(async (q) => {
        await withAudit(q, 'offers', pending({ action: 'strategy.offer.created' }));
        return createOffer(q);
      }),
      { message: 'audit_invalid' },
    );
    const after = Number(
      (await db.query<{ n: string }>('select count(*) as n from public.offers'))[0]!.n,
    );
    expect(after).toBe(before);
  });

  it('troca de status e decisão da LIA registram no mesmo pedido', async () => {
    const offerId = await asServer((q) => createOffer(q));
    await asServer(async (q) => {
      await withAudit(
        q,
        'offers',
        pending({
          action: 'strategy.offer.status_changed',
          entityId: offerId,
          diff: { from: 'draft', to: 'archived' },
        }),
      );
      await q.query("update public.offers set status = 'archived' where id = $1", [offerId]);
    });
    expect((await auditRows(offerId)).map((r) => [r.action, r.diff])).toEqual([
      ['strategy.offer.status_changed', { from: 'draft', to: 'archived' }],
    ]);

    const [lia] = await asServer((q) =>
      q.query<{ id: string; version: number }>(
        `insert into public.legal_basis_assessments (
           purpose, legitimate_interest, necessity, data_categories, data_sources,
           expectations, risks, safeguards, conclusion)
         values ('p', 'i', 'n', '{name}', '{company_website}', 'e', 'r', 's', 'c')
         returning id, version`,
      ),
    );
    const due = '2099-01-01';
    await expectDbError(
      asServer(async (q) => {
        await withAudit(
          q,
          'legal_basis_assessments',
          pending({
            action: 'compliance.lia.approved',
            entityType: 'legal_basis_assessment',
            entityId: lia!.id,
            diff: { reviewDueOn: due },
            withVersion: true,
          }),
        );
        await q.query(
          `update public.legal_basis_assessments
             set approved_at = now(), review_due_on = $2 where id = $1`,
          [lia!.id, due],
        );
      }),
      { message: 'review_date_out_of_range' },
    );
    // A decisão recusada pelo banco não deixa registro.
    expect(await auditRows(lia!.id)).toEqual([]);

    await asServer(async (q) => {
      await withAudit(
        q,
        'legal_basis_assessments',
        pending({
          action: 'compliance.lia.approved',
          entityType: 'legal_basis_assessment',
          entityId: lia!.id,
          diff: { reviewDueOn: 'em 1 ano' },
          withVersion: true,
        }),
      );
      await q.query(
        `update public.legal_basis_assessments
           set approved_at = now(),
               review_due_on = ((now() at time zone 'America/Sao_Paulo')::date + 365)
         where id = $1`,
        [lia!.id],
      );
    });
    expect((await auditRows(lia!.id)).map((r) => [r.action, r.diff])).toEqual([
      ['compliance.lia.approved', { reviewDueOn: 'em 1 ano', version: lia!.version }],
    ]);
  });
});
