import type { PendingAudit } from '@prospector/application';
import { describe, expect, it } from 'vitest';
import { createServerSupabaseClient, createSupabaseInvestigationRepository } from '../../src';

/**
 * Adaptador das investigações (Módulo 02) contra respostas HTTP do PostgREST simuladas: caminho,
 * filtros, cabeçalho de auditoria, colunas do patch e mapeamento. O comportamento do banco está em
 * tests/db/investigations. Dados SINTÉTICOS.
 */

const URL_BASE = 'http://supabase.local.test';
const TRACE = '0b7c6d3e-4f2a-4b8c-9d1e-2f3a4b5c6d7e';
const COMPANY_ID = '2f1e0d9c-8b7a-4c6d-9e5f-4a3b2c1d0e9f';
const INVESTIGATION_ID = '7d6c5b4a-3e2f-4a1b-8c9d-0e1f2a3b4c5d';

interface Captured {
  url: URL;
  method: string;
  headers: Headers;
  body: string | null;
}

function stub(respond: (req: Captured) => Response) {
  const calls: Captured[] = [];
  const fetchStub: typeof fetch = async (input, init) => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const req: Captured = {
      url: new URL(href),
      method: init?.method ?? 'GET',
      headers: new Headers(init?.headers),
      body: typeof init?.body === 'string' ? init.body : null,
    };
    calls.push(req);
    return respond(req);
  };
  const client = createServerSupabaseClient(URL_BASE, 'chave-de-teste-nao-real', {
    fetch: fetchStub,
  });
  return { repo: createSupabaseInvestigationRepository(client), calls };
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const ROW = {
  id: INVESTIGATION_ID,
  company_id: COMPANY_ID,
  status: 'queued',
  trigger: 'user',
  pipeline_version: 1,
  steps: [],
  usage: { searches: 2 },
  models: [],
  diagnosis: null,
  snapshot: null,
  changes: [],
  previous_id: null,
  job_id: null,
  issue: null,
  cancel_requested_at: null,
  started_at: null,
  finished_at: null,
  is_demo: false,
  created_at: '2026-11-11T12:00:00.123456+00:00',
  updated_at: '2026-11-11T12:00:00+00:00',
};

const audit: PendingAudit = {
  actorType: 'user',
  actorLabel: null,
  traceId: TRACE,
  action: 'company.investigation.started',
  entityType: 'company_investigation',
  entityId: INVESTIGATION_ID,
  diff: { trigger: 'user' },
  withVersion: false,
};

function decodeAudit(call: Captured | undefined) {
  const header = call?.headers.get('x-prospector-audit');
  return header
    ? (JSON.parse(Buffer.from(header, 'base64').toString('utf8')) as Record<string, unknown>)
    : null;
}

describe('createSupabaseInvestigationRepository', () => {
  it('create: insere com auditoria e mapeia a linha (consumo vazio completado)', async () => {
    const { repo, calls } = stub(() => json(201, ROW));
    const created = await repo.create(
      {
        id: INVESTIGATION_ID,
        companyId: COMPANY_ID,
        trigger: 'user',
        pipelineVersion: 1,
        steps: [],
        previousId: null,
        isDemo: false,
      },
      audit,
    );
    expect(created).toMatchObject({
      id: INVESTIGATION_ID,
      status: 'queued',
      usage: { searches: 2, pagesRead: 0, modelCalls: 0 },
      createdAt: '2026-11-11T12:00:00.123Z',
    });
    const [insert] = calls;
    expect(insert?.method).toBe('POST');
    expect(insert?.url.pathname).toBe('/rest/v1/company_investigations');
    expect(JSON.parse(insert?.body ?? '{}')).toMatchObject({
      company_id: COMPANY_ID,
      trigger: 'user',
      pipeline_version: 1,
    });
    expect(decodeAudit(insert)).toMatchObject({
      table: 'company_investigations',
      action: 'company.investigation.started',
    });
  });

  it('create: segunda ativa da mesma empresa vira investigation_running', async () => {
    const { repo } = stub(() =>
      json(409, {
        code: '23505',
        message:
          'duplicate key value violates unique constraint "company_investigations_active_key"',
      }),
    );
    await expect(
      repo.create(
        {
          id: INVESTIGATION_ID,
          companyId: COMPANY_ID,
          trigger: 'user',
          pipelineVersion: 1,
          steps: [],
          previousId: null,
          isDemo: false,
        },
        audit,
      ),
    ).rejects.toMatchObject({ code: 'conflict', reason: 'investigation_running' });
  });

  it('update: só as colunas do patch, sem auditoria; retomada limpa o pedido de cancelamento', async () => {
    const { repo, calls } = stub(() => json(200, [{ ...ROW, status: 'running' }]));
    await repo.update(INVESTIGATION_ID, {
      status: 'running',
      heartbeatAt: '2026-11-11T12:00:01.000Z',
    });
    expect(JSON.parse(calls[0]?.body ?? '{}')).toEqual({
      status: 'running',
      heartbeat_at: '2026-11-11T12:00:01.000Z',
    });
    expect(calls[0]?.headers.get('x-prospector-audit')).toBeNull();
    expect(calls[0]?.url.searchParams.get('id')).toBe(`eq.${INVESTIGATION_ID}`);

    await repo.updateAudited(
      INVESTIGATION_ID,
      { status: 'queued', runner: null },
      { ...audit, action: 'company.investigation.resumed' },
    );
    expect(JSON.parse(calls[1]?.body ?? '{}')).toEqual({
      status: 'queued',
      runner: null,
      cancel_requested_at: null,
    });
    expect(decodeAudit(calls[1])).toMatchObject({
      table: 'company_investigations',
      covers: ['companies'],
      action: 'company.investigation.resumed',
    });
  });

  it('updateAudited: estado final que não volta vira conflito próprio', async () => {
    const { repo } = stub(() =>
      json(400, { code: '55000', message: 'investigation_not_resumable' }),
    );
    await expect(
      repo.updateAudited(INVESTIGATION_ID, { status: 'queued' }, audit),
    ).rejects.toMatchObject({ code: 'conflict', reason: 'investigation_not_resumable' });
  });

  it('requestCancel: só ativas e ainda sem pedido; auditado', async () => {
    const { repo, calls } = stub(() => json(200, [{ id: INVESTIGATION_ID }]));
    expect(await repo.requestCancel(INVESTIGATION_ID, '2026-11-11T12:00:00.000Z', audit)).toBe(
      true,
    );
    const params = calls[0]?.url.searchParams;
    expect(params?.get('status')).toBe('in.(queued,running)');
    expect(params?.get('cancel_requested_at')).toBe('is.null');
    expect(decodeAudit(calls[0])).toMatchObject({ table: 'company_investigations' });
  });

  it('touch: batimento das ativas; devolve as com pedido de cancelamento', async () => {
    const { repo, calls } = stub(() =>
      json(200, [
        { id: INVESTIGATION_ID, cancel_requested_at: '2026-11-11T12:00:00+00:00' },
        { id: COMPANY_ID, cancel_requested_at: null },
      ]),
    );
    expect(
      await repo.touch([INVESTIGATION_ID, COMPANY_ID], 'web-1', '2026-11-11T12:00:15.000Z'),
    ).toEqual([INVESTIGATION_ID]);
    expect(JSON.parse(calls[0]?.body ?? '{}')).toEqual({
      runner: 'web-1',
      heartbeat_at: '2026-11-11T12:00:15.000Z',
    });
    expect(calls[0]?.headers.get('x-prospector-audit')).toBeNull();
    expect(await repo.touch([], 'web-1', '2026-11-11T12:00:15.000Z')).toEqual([]);
    expect(calls).toHaveLength(1);
  });

  it('interruptStale: batimento parado, ou sem batimento e sem atualização recente', async () => {
    const { repo, calls } = stub(() => json(200, [{ id: INVESTIGATION_ID }]));
    expect(await repo.interruptStale('2026-11-11T11:58:00.000Z', '2026-11-11T12:00:00.000Z')).toBe(
      1,
    );
    const params = calls[0]?.url.searchParams;
    expect(params?.get('or')).toBe(
      '(heartbeat_at.lt.2026-11-11T11:58:00.000Z,and(heartbeat_at.is.null,updated_at.lt.2026-11-11T11:58:00.000Z))',
    );
    expect(JSON.parse(calls[0]?.body ?? '{}')).toEqual({
      status: 'interrupted',
      runner: null,
      heartbeat_at: null,
    });
  });

  it('summaries: lê a view por empresa', async () => {
    const { repo, calls } = stub(() =>
      json(200, [
        {
          company_id: COMPANY_ID,
          investigation_id: INVESTIGATION_ID,
          status: 'succeeded',
          finished_at: '2026-11-11T12:10:00+00:00',
          updated_at: '2026-11-11T12:10:00+00:00',
          recommendation: 'prepare_access',
          recommended_offer_name: 'Revisão de marca',
          priority: 64,
        },
      ]),
    );
    expect(await repo.summaries([COMPANY_ID, COMPANY_ID])).toEqual([
      {
        companyId: COMPANY_ID,
        investigationId: INVESTIGATION_ID,
        status: 'succeeded',
        finishedAt: '2026-11-11T12:10:00.000Z',
        updatedAt: '2026-11-11T12:10:00.000Z',
        recommendation: 'prepare_access',
        recommendedOfferName: 'Revisão de marca',
        priority: 64,
      },
    ]);
    expect(calls[0]?.url.pathname).toBe('/rest/v1/company_investigation_summaries');
    expect(calls[0]?.url.searchParams.get('company_id')).toBe(`in.(${COMPANY_ID})`);
  });

  it('confirmSite: RPC auditada em companies cobrindo a chave; empresa inexistente = null', async () => {
    const { repo, calls } = stub((req) =>
      req.url.pathname.endsWith('/rpc/confirm_company_site') ? json(200, false) : json(200, null),
    );
    expect(
      await repo.confirmSite(COMPANY_ID, 'atelie.test', {
        ...audit,
        action: 'company.site_confirmed',
        entityType: 'company',
        entityId: COMPANY_ID,
      }),
    ).toBeNull();
    expect(JSON.parse(calls[0]?.body ?? '{}')).toEqual({
      p_company_id: COMPANY_ID,
      p_domain: 'atelie.test',
    });
    expect(decodeAudit(calls[0])).toMatchObject({
      table: 'companies',
      covers: ['company_identifiers'],
      action: 'company.site_confirmed',
    });
  });
});
