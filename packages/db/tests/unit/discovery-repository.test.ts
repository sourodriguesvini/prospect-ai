import type { PendingAudit } from '@prospector/application';
import { describe, expect, it } from 'vitest';
import {
  createServerSupabaseClient,
  createSupabaseDiscoveryRepository,
  createSupabaseJobQueue,
} from '../../src';

/**
 * Adaptador da Descoberta e da fila contra respostas HTTP do PostgREST simuladas: caminho,
 * filtros, cabeçalho de auditoria e mapeamento. O comportamento do banco (triggers, funções da
 * fila, privilégios por coluna) está em tests/db/discovery. Dados SINTÉTICOS.
 */

const URL_BASE = 'http://supabase.local.test';
const TRACE = '0b7c6d3e-4f2a-4b8c-9d1e-2f3a4b5c6d7e';
const RUN_ID = '2f1e0d9c-8b7a-4c6d-9e5f-4a3b2c1d0e9f';
const PROSPECT_ID = '7a6b5c4d-3e2f-4a1b-8c9d-0e1f2a3b4c5d';

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
  return {
    repo: createSupabaseDiscoveryRepository(client),
    queue: createSupabaseJobQueue(client),
    calls,
  };
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const audit: PendingAudit = {
  actorType: 'user',
  actorLabel: null,
  traceId: TRACE,
  action: 'discovery.run.created',
  entityType: 'discovery_run',
  entityId: null,
  diff: {},
  withVersion: false,
};

function decodeAudit(call: Captured | undefined) {
  const header = call?.headers.get('x-prospector-audit');
  return header
    ? (JSON.parse(Buffer.from(header, 'base64').toString('utf8')) as Record<string, unknown>)
    : null;
}

const RUN_ROW = {
  id: RUN_ID,
  request: 'Clínicas em Ribeirão Preto',
  options: {},
  trigger: 'user',
  monitor_id: null,
  status: 'queued',
  stage: null,
  intent: null,
  plan: null,
  limits: { maxSearches: 6, maxPages: 6, maxProspects: 25 },
  progress: {},
  partial: false,
  failure_code: null,
  icp_id: null,
  icp_version_id: null,
  offer_id: null,
  scoring_model_version_id: null,
  prompt_ids: [],
  trace_id: TRACE,
  is_demo: false,
  created_at: '2026-11-11T12:00:00.123456+00:00',
  started_at: null,
  finished_at: null,
  cancel_requested_at: null,
};

const PROSPECT_ROW = {
  id: PROSPECT_ID,
  dedupe_key: 'domain:clinicavidaplena.test',
  name_key: 'clinica vida plena',
  display_name: 'Clínica Vida Plena',
  domain: 'clinicavidaplena.test',
  website_url: 'https://www.clinicavidaplena.test/',
  segment: 'Clínica médica',
  city: 'Ribeirão Preto',
  uf: 'SP',
  description: null,
  cnpj: '11222333000181',
  company_id: null,
  status: 'new',
  dismissed_reason: null,
  priority: 'high',
  priority_score: 78,
  confidence: 'high',
  assessment: null,
  site_verified: true,
  first_seen_at: '2026-11-11T12:00:00+00:00',
  last_seen_at: '2026-11-11T12:00:00+00:00',
  last_verified_at: null,
  first_run_id: RUN_ID,
  last_run_id: RUN_ID,
  is_demo: false,
  created_at: '2026-11-11T12:00:00+00:00',
  updated_at: '2026-11-11T12:00:00+00:00',
};

const JOB_ROW = {
  id: '5d4c3b2a-1f0e-4d9c-8b7a-6f5e4d3c2b1a',
  kind: 'discovery_run',
  status: 'running',
  idempotency_key: `discovery_run:${RUN_ID}`,
  payload: { runId: RUN_ID },
  attempts: 1,
  max_attempts: 3,
  run_after: '2026-11-11T12:00:00+00:00',
  lease_owner: 'app-1',
  lease_expires_at: '2026-11-11T12:02:00+00:00',
  cancel_requested_at: null,
  last_error_code: null,
  trace_id: TRACE,
  created_at: '2026-11-11T12:00:00+00:00',
  started_at: '2026-11-11T12:00:01+00:00',
  finished_at: null,
  updated_at: '2026-11-11T12:00:01+00:00',
};

describe('pesquisas', () => {
  it('cria com o registro de auditoria da tabela e progresso zerado', async () => {
    const { repo, calls } = stub(() => json(201, RUN_ROW));
    const run = await repo.createRun(
      {
        id: RUN_ID,
        request: RUN_ROW.request,
        options: {
          quantity: null,
          depth: null,
          uf: null,
          city: null,
          icpId: null,
          signals: [],
        },
        trigger: 'user',
        monitorId: null,
        status: 'queued',
        limits: { maxSearches: 6, maxPages: 6, maxProspects: 25 },
        icpId: null,
        traceId: TRACE,
        isDemo: false,
        createdAt: '2026-11-11T12:00:00.000Z',
        confirmedAt: '2026-11-11T12:00:00.000Z',
      },
      audit,
    );
    expect(run.createdAt).toBe('2026-11-11T12:00:00.123Z');
    expect(run.progress.searchesDone).toBe(0);
    const [call] = calls;
    expect(call?.method).toBe('POST');
    expect(call?.url.pathname).toBe('/rest/v1/discovery_runs');
    expect(decodeAudit(call)).toMatchObject({
      table: 'discovery_runs',
      action: 'discovery.run.created',
    });
    expect(JSON.parse(call?.body ?? '{}')).toMatchObject({
      confirmed_at: '2026-11-11T12:00:00.000Z',
      progress: { searchesDone: 0, creditsUsed: 0 },
    });
  });

  it('confirma só rascunho (filtro no banco) e diz quando não era', async () => {
    const { repo, calls } = stub(() => json(200, []));
    expect(await repo.confirmRun(RUN_ID, '2026-11-11T12:00:00Z', audit)).toBe(false);
    expect(calls[0]?.url.searchParams.get('status')).toBe('eq.draft');
    expect(decodeAudit(calls[0])?.table).toBe('discovery_runs');
  });

  it('cancelar o que já começou cai no pedido simples (sem encerrar quem está rodando)', async () => {
    let call = 0;
    const { repo, calls } = stub(() => {
      call += 1;
      return json(200, call === 1 ? [] : [{ id: RUN_ID }]);
    });
    expect(await repo.requestCancel(RUN_ID, '2026-11-11T12:00:00Z', true, audit)).toBe(true);
    expect(calls).toHaveLength(2);
    expect(JSON.parse(calls[0]?.body ?? '{}')).toMatchObject({ status: 'cancelled' });
    expect(JSON.parse(calls[1]?.body ?? '{}')).toEqual({
      cancel_requested_at: '2026-11-11T12:00:00Z',
    });
    expect(calls[1]?.url.searchParams.get('status')).toBe(
      'not.in.("completed","failed","cancelled")',
    );
  });

  it('progresso do trabalhador vai sem cabeçalho de auditoria', async () => {
    const { repo, calls } = stub(() => new Response(null, { status: 204 }));
    await repo.updateRun(RUN_ID, {
      stage: 'searching',
      progress: {
        searchesPlanned: 2,
        searchesDone: 1,
        creditsUsed: 1,
        pagesRead: 0,
        prospects: 0,
        newProspects: 0,
        signals: 0,
      },
    });
    expect(calls[0]?.method).toBe('PATCH');
    expect(calls[0]?.headers.get('x-prospector-audit')).toBeNull();
  });

  it('busca refeita atualiza; busca nova inclui (sem upsert na chave)', async () => {
    let call = 0;
    const { repo, calls } = stub((req) => {
      call += 1;
      return req.method === 'PATCH' ? json(200, []) : new Response(null, { status: 201 });
    });
    await repo.saveQuery({
      runId: RUN_ID,
      position: 0,
      query: {
        text: 'clínicas Ribeirão Preto',
        purpose: 'companies',
        signal: null,
        topic: 'general',
        timeRange: null,
      } as never,
      status: 'done',
      results: [],
      creditsCharged: 1,
      fetchedAt: '2026-11-11T12:00:00Z',
      failure: null,
      retentionUntil: '2027-11-11T12:00:00Z',
    });
    expect(call).toBe(2);
    expect(JSON.parse(calls[0]?.body ?? '{}')).not.toHaveProperty('run_id');
    expect(calls[1]?.method).toBe('POST');
    expect(JSON.parse(calls[1]?.body ?? '{}')).toMatchObject({ run_id: RUN_ID, position: 0 });
  });

  it('créditos do dia: as que ainda rodam contam o teto, as encerradas o gasto', async () => {
    const { repo, calls } = stub(() =>
      json(200, [
        { status: 'completed', limits: { maxSearches: 6 }, progress: { creditsUsed: 2 } },
        { status: 'queued', limits: { maxSearches: 4 }, progress: { creditsUsed: 0 } },
        { status: 'running', limits: { maxSearches: 3 }, progress: { creditsUsed: 5 } },
      ]),
    );
    expect(await repo.usageSince('2026-11-10T12:00:00Z', ['schedule', 'catch_up'])).toEqual({
      runs: 3,
      credits: 2 + 4 + 5,
    });
    expect(calls[0]?.url.searchParams.get('select')).toBe('status,limits,progress');
  });
});

describe('monitoramentos', () => {
  it('pegar o vencido só muda next_run_at se ainda estiver vencido e ativo', async () => {
    let rows: unknown[] = [{ id: RUN_ID }];
    const { repo, calls } = stub(() => json(200, rows));
    const at = '2026-11-11T12:00:00.000Z';
    const next = '2026-11-12T12:00:00.000Z';
    expect(await repo.claimMonitor(RUN_ID, at, next)).toBe(true);
    const req = calls[0]!;
    expect(req.method).toBe('PATCH');
    expect(req.url.searchParams.get('id')).toBe(`eq.${RUN_ID}`);
    expect(req.url.searchParams.get('status')).toBe('eq.active');
    expect(req.url.searchParams.get('next_run_at')).toBe(`lte.${at}`);
    expect(JSON.parse(req.body ?? '{}')).toEqual({ next_run_at: next });
    rows = [];
    expect(await repo.claimMonitor(RUN_ID, at, next)).toBe(false);
  });
});

describe('empresas encontradas', () => {
  it('chave repetida vira prospect_duplicate (não "alteração simultânea")', async () => {
    const { repo } = stub(() => json(409, { code: '23505', message: 'duplicate key value' }));
    await expect(
      repo.insertProspect({
        id: PROSPECT_ID,
        dedupeKey: PROSPECT_ROW.dedupe_key,
        nameKey: PROSPECT_ROW.name_key,
        displayName: PROSPECT_ROW.display_name,
        domain: PROSPECT_ROW.domain,
        websiteUrl: PROSPECT_ROW.website_url,
        segment: null,
        city: null,
        uf: null,
        description: null,
        cnpj: null,
        companyId: null,
        status: 'new',
        dismissedReason: null,
        priority: 'insufficient',
        priorityScore: null,
        confidence: 'low',
        assessment: null,
        siteVerified: false,
        firstSeenAt: '2026-11-11T12:00:00Z',
        lastSeenAt: '2026-11-11T12:00:00Z',
        lastVerifiedAt: null,
        firstRunId: RUN_ID,
        lastRunId: RUN_ID,
        isDemo: false,
      }),
    ).rejects.toMatchObject({ code: 'conflict', reason: 'prospect_duplicate' });
  });

  it('procura candidatas por chave, domínio, nome e raiz de CNPJ, sem repetir', async () => {
    const { repo, calls } = stub(() => json(200, [PROSPECT_ROW]));
    const found = await repo.findProspects({
      dedupeKeys: ['domain:clinicavidaplena.test'],
      domains: ['clinicavidaplena.test'],
      cnpjRoots: ['11222333', 'x;drop'],
      nameKeys: ['clinica vida plena'],
    });
    expect(found).toHaveLength(1);
    expect(found[0]?.nameKey).toBe('clinica vida plena');
    expect(calls).toHaveLength(4);
    const or = calls.map((call) => call.url.searchParams.get('or')).find(Boolean);
    expect(or).toBe('(cnpj.like.11222333*)');
  });

  it('decisão da pessoa leva auditoria da tabela e limpa o motivo fora de "ignorada"', async () => {
    const { repo, calls } = stub(() => json(200, [{ id: PROSPECT_ID }]));
    expect(
      await repo.setProspectStatus(
        PROSPECT_ID,
        { status: 'saved', dismissedReason: 'sobrou' },
        { ...audit, action: 'discovery.prospect.status_changed' },
      ),
    ).toBe(true);
    expect(JSON.parse(calls[0]?.body ?? '{}')).toEqual({ status: 'saved', dismissed_reason: null });
    expect(decodeAudit(calls[0])?.table).toBe('discovery_prospects');
  });

  it('sinais repetidos são ignorados pelo banco (impressão digital)', async () => {
    const { repo, calls } = stub(() => json(201, []));
    expect(
      await repo.insertSignals([
        {
          prospectId: PROSPECT_ID,
          runId: RUN_ID,
          sourceId: '1b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e',
          type: 'expansion',
          summary: 'Nova unidade.',
          quote: 'inaugura nova unidade na zona sul',
          eventDate: '2026-10',
          publishedAt: '2026-10-05',
          discoveredAt: '2026-11-11T12:00:00Z',
          verification: 'confirmed',
          confidence: 0.85,
          relevance: 'high',
          relatedService: 'brand_identity',
          rationale: '',
          recency: 'recent',
          fingerprint: 'a'.repeat(64),
          retentionUntil: '2027-11-11T12:00:00Z',
        },
      ]),
    ).toEqual([]);
    expect(calls[0]?.url.searchParams.get('on_conflict')).toBe('fingerprint');
    expect(calls[0]?.headers.get('prefer')).toContain('resolution=ignore-duplicates');
  });
});

describe('fila', () => {
  it('pega a tarefa pela função do banco e mapeia a linha', async () => {
    const { queue, calls } = stub(() => json(200, [JOB_ROW]));
    const job = await queue.claim('app-1', ['discovery_run'], 120);
    expect(job).toMatchObject({ kind: 'discovery_run', attempts: 1, payload: { runId: RUN_ID } });
    expect(calls[0]?.url.pathname).toBe('/rest/v1/rpc/claim_ai_job');
    expect(JSON.parse(calls[0]?.body ?? '{}')).toEqual({
      p_worker: 'app-1',
      p_kinds: ['discovery_run'],
      p_lease_seconds: 120,
    });
  });

  it('fila vazia devolve null; retentativa leva código e espera', async () => {
    const { queue, calls } = stub((req) =>
      req.url.pathname.endsWith('claim_ai_job') ? json(200, []) : json(200, true),
    );
    expect(await queue.claim('app-1', ['discovery_run'], 120)).toBeNull();
    expect(
      await queue.finish(JOB_ROW.id, 'app-1', {
        status: 'retry',
        errorCode: 'ai_busy',
        retryAfterSeconds: 30,
      }),
    ).toBe(true);
    expect(JSON.parse(calls[1]?.body ?? '{}')).toEqual({
      p_id: JOB_ROW.id,
      p_worker: 'app-1',
      p_status: 'retry',
      p_error_code: 'ai_busy',
      p_retry_after_seconds: 30,
    });
  });
});
