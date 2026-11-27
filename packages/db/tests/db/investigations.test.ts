import type { PendingAudit } from '@prospector/application';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { encodeAuditHeader } from '../../src/strategy-repository';
import { createTestDb, expectDbError, type Queryable, type TestDb } from '../support/test-db';

/**
 * Módulo 02 — investigações (migração 20261111150000, ADR-0015). Uma ativa por empresa; início,
 * cancelamento, retomada e conclusão auditados na mesma transação; progresso e batimento sem
 * auditoria; estados finais não voltam; conclusão marca a empresa como investigada. Dados
 * SINTÉTICOS.
 */

const TRACE = '6a5b4c3d-2e1f-4a0b-9c8d-7e6f5a4b3c2d';

const pending = (overrides: Partial<PendingAudit> = {}): PendingAudit => ({
  actorType: 'agent',
  actorLabel: 'investigator',
  traceId: TRACE,
  action: 'company.investigation.started',
  entityType: 'company_investigation',
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

let counter = 0;
function uuid(): string {
  counter += 1;
  return `00000000-0000-4000-9000-${String(counter).padStart(12, '0')}`;
}

describe('Módulo 02 — investigações no banco', () => {
  let db: TestDb;
  const asServer = <T>(fn: (q: Queryable) => Promise<T>) => db.asRole('service_role', fn);

  function createCompany(domain: string | null = null) {
    const id = uuid();
    return asServer(async (q) => {
      await viaApi(
        q,
        encodeAuditHeader(
          'companies',
          pending({ action: 'prospect.company.created', entityType: 'company' }),
          ['company_identifiers', 'sources', 'claims', 'claim_evidence'],
        ),
      );
      await q.query('select public.create_company($1, $2, $3, $4, $5)', [
        JSON.stringify({
          id,
          display_name: 'Ateliê Exemplo',
          primary_domain: domain,
          origin: 'manual',
        }),
        '[]',
        '[]',
        '[]',
        '[]',
      ]);
      return id;
    });
  }

  function start(companyId: string, header = true) {
    const id = uuid();
    return asServer(async (q) => {
      await viaApi(q, header ? encodeAuditHeader('company_investigations', pending()) : undefined);
      await q.query(
        `insert into public.company_investigations (id, company_id, trigger, pipeline_version, steps)
         values ($1, $2, 'user', 1, '[]')`,
        [id, companyId],
      );
      return id;
    });
  }

  function update(
    id: string,
    set: string,
    params: unknown[] = [],
    header?: string,
    covers = false,
  ) {
    return asServer(async (q) => {
      await viaApi(
        q,
        header === undefined
          ? undefined
          : encodeAuditHeader(
              'company_investigations',
              pending({ action: header, entityId: id }),
              covers ? ['companies'] : [],
            ),
      );
      return q.query(`update public.company_investigations set ${set} where id = $1 returning id`, [
        id,
        ...params,
      ]);
    });
  }

  const actions = (entityId: string) =>
    db
      .query<{ action: string }>(
        'select action from public.audit_log where entity_id = $1 order by id',
        [entityId],
      )
      .then((rows) => rows.map((row) => row.action));

  beforeAll(async () => {
    db = await createTestDb();
  });
  afterAll(async () => {
    await db.close();
  });

  it('início auditado; uma investigação ativa por empresa', async () => {
    const companyId = await createCompany();
    const id = await start(companyId);
    expect(await actions(id)).toEqual(['company.investigation.started']);
    await expectDbError(start(companyId), { code: '23505' });
    // Sem cabeçalho de auditoria o início é recusado.
    const other = await createCompany();
    await expectDbError(start(other, false), { message: 'audit_missing' });
  });

  it('progresso e batimento não exigem nem geram auditoria; conclusão audita e marca a empresa', async () => {
    const companyId = await createCompany();
    const id = await start(companyId);
    await update(
      id,
      `status = 'running', runner = 'web-1', heartbeat_at = now(), steps = '[{"key":"context"}]'`,
    );
    await update(id, `heartbeat_at = now(), usage = '{"searches":1}'`);
    expect(await actions(id)).toEqual(['company.investigation.started']);

    // Conclusão sem cabeçalho: recusada (não há conclusão sem trilha).
    await expectDbError(update(id, `status = 'succeeded', finished_at = now()`), {
      message: 'audit_missing',
    });
    await update(
      id,
      `status = 'succeeded', finished_at = '2026-11-11T12:00:00Z'`,
      [],
      'company.investigation.finished',
      true,
    );
    expect(await actions(id)).toEqual([
      'company.investigation.started',
      'company.investigation.finished',
    ]);
    const [company] = await db.query<{ last_investigated_at: Date | string }>(
      'select last_investigated_at from public.companies where id = $1',
      [companyId],
    );
    expect(new Date(company!.last_investigated_at).toISOString()).toBe('2026-11-11T12:00:00.000Z');
    // A empresa foi atualizada dentro do mesmo pedido, coberta pelo registro: sem linha própria.
    expect(await actions(companyId)).toEqual(['prospect.company.created']);

    // Estado final não volta.
    await expectDbError(update(id, `status = 'running'`), {
      message: 'investigation_not_resumable',
    });
    // O resultado de uma execução encerrada não é reescrito (nem com cabeçalho de auditoria).
    await expectDbError(update(id, `diagnosis = '{"summaryClaimId":null}'`), {
      message: 'investigation_finished',
    });
    await expectDbError(update(id, `steps = '[]'`, [], 'company.investigation.finished', true), {
      message: 'investigation_finished',
    });
    await expectDbError(update(id, `usage = '{"searches":9}'`), {
      message: 'investigation_finished',
    });
    // Outra pode começar depois.
    await expect(start(companyId)).resolves.toBeTypeOf('string');
  });

  it('cancelamento e retomada: só interrompida ou com falha volta para a fila', async () => {
    const companyId = await createCompany();
    const id = await start(companyId);
    await update(id, `cancel_requested_at = now()`, [], 'company.investigation.cancel_requested');
    await update(id, `status = 'running'`);
    // Processo encerrado: a recuperação marca como interrompida sem auditoria.
    await update(id, `status = 'interrupted', runner = null, heartbeat_at = null`);
    await update(
      id,
      `status = 'queued', cancel_requested_at = null`,
      [],
      'company.investigation.resumed',
    );
    expect(await actions(id)).toEqual([
      'company.investigation.started',
      'company.investigation.cancel_requested',
      'company.investigation.resumed',
    ]);
    await update(
      id,
      `status = 'cancelled', finished_at = now()`,
      [],
      'company.investigation.finished',
    );
    await expectDbError(update(id, `status = 'queued'`, [], 'company.investigation.resumed'), {
      message: 'investigation_not_resumable',
    });
  });

  it('o servidor não muda empresa, gatilho nem versão de uma investigação', async () => {
    const companyId = await createCompany();
    const id = await start(companyId);
    await expectDbError(update(id, `trigger = 'copilot'`), { code: '42501' });
    await expectDbError(update(id, `pipeline_version = 2`), { code: '42501' });
    await expectDbError(
      asServer((q) => q.query('delete from public.company_investigations where id = $1', [id])),
      { code: '42501' },
    );
  });

  it('resumo por empresa: status da última e recomendação da última com diagnóstico', async () => {
    const companyId = await createCompany();
    const offerId = uuid();
    const first = await start(companyId);
    await update(
      first,
      `status = 'succeeded', finished_at = now(), diagnosis = $2`,
      [
        JSON.stringify({
          recommendation: 'prepare_access',
          recommendedOfferId: offerId,
          offers: [{ offerId, offerName: 'Revisão de marca', priority: 64 }],
        }),
      ],
      'company.investigation.finished',
      true,
    );
    const second = await start(companyId);
    const [row] = await asServer((q) =>
      q.query('select * from public.company_investigation_summaries where company_id = $1', [
        companyId,
      ]),
    );
    expect(row).toMatchObject({
      investigation_id: second,
      status: 'queued',
      recommendation: 'prepare_access',
      recommended_offer_name: 'Revisão de marca',
      priority: 64,
    });
  });

  it('confirma o site: domínio e chave forte numa transação; domínio de outra empresa é recusado', async () => {
    const companyId = await createCompany();
    const header = encodeAuditHeader(
      'companies',
      pending({ action: 'company.site_confirmed', entityType: 'company', entityId: companyId }),
      ['company_identifiers'],
    );
    const confirm = (id: string, domain: string) =>
      asServer(async (q) => {
        await viaApi(q, header);
        const [result] = await q.query<{ ok: boolean }>(
          'select public.confirm_company_site($1, $2) as ok',
          [id, domain],
        );
        return result?.ok;
      });
    expect(await confirm(companyId, 'atelie-confirmado.test')).toBe(true);
    const [company] = await db.query<{ primary_domain: string }>(
      'select primary_domain from public.companies where id = $1',
      [companyId],
    );
    expect(company?.primary_domain).toBe('atelie-confirmado.test');
    const keys = await db.query(
      "select strength, verified from public.company_identifiers where company_id = $1 and kind = 'domain'",
      [companyId],
    );
    expect(keys).toEqual([{ strength: 'strong', verified: true }]);
    expect(await actions(companyId)).toContain('company.site_confirmed');

    const other = await createCompany();
    await expectDbError(confirm(other, 'atelie-confirmado.test'), { message: 'company_duplicate' });
    await expectDbError(confirm(other, 'não é domínio'), { message: 'invalid_input' });
    expect(await confirm(uuid(), 'sem-empresa.test')).toBe(false);
  });
});
