import { describe, expect, it } from 'vitest';
import {
  createServerSupabaseClient,
  createSupabaseCopilotRepository,
  createSupabaseIntelligenceRepository,
  createSupabaseMonitoringRepository,
} from '../../src';

/**
 * Leituras do Monitoramento e da Inteligência (ADR-0017) contra respostas HTTP do PostgREST
 * simuladas: tabela, filtros, teto de linhas e mapeamento. Só leitura: nenhum pedido pode gravar.
 * Dados SINTÉTICOS.
 */

const URL_BASE = 'http://supabase.local.test';
const COMPANY_A = '2f1e0d9c-8b7a-4c6d-9e5f-4a3b2c1d0e9f';
const COMPANY_B = '3a2b1c0d-9e8f-4a7b-8c6d-5e4f3a2b1c0d';

interface Captured {
  url: URL;
  method: string;
  headers: Headers;
}

function stub(respond: (req: Captured) => Response) {
  const calls: Captured[] = [];
  const fetchStub: typeof fetch = async (input, init) => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const req: Captured = {
      url: new URL(href),
      method: init?.method ?? 'GET',
      headers: new Headers(init?.headers),
    };
    calls.push(req);
    return respond(req);
  };
  const client = createServerSupabaseClient(URL_BASE, 'chave-de-teste-nao-real', {
    fetch: fetchStub,
  });
  return {
    monitoring: createSupabaseMonitoringRepository(client),
    intelligence: createSupabaseIntelligenceRepository(client),
    telemetry: createSupabaseCopilotRepository(client),
    calls,
  };
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

const change = (kind: string) => ({ kind, text: 'Texto do sistema.', claimIds: [] });

describe('createSupabaseMonitoringRepository', () => {
  it('lê investigações concluídas com comparação e pula as sem mudança', async () => {
    const { monitoring, calls } = stub(() =>
      json(200, [
        {
          id: '7d6c5b4a-3e2f-4a1b-8c9d-0e1f2a3b4c5d',
          company_id: COMPANY_A,
          finished_at: '2026-11-24T12:00:00.123456+00:00',
          is_demo: false,
          changes: [change('offering_added'), change('temporarily_unavailable')],
          companies: {
            display_name: 'Empresa Sintética A',
            is_demo: false,
            lifecycle: 'qualified',
          },
        },
        {
          id: '8e7d6c5b-4f3a-4b2c-9d0e-1f2a3b4c5d6e',
          company_id: COMPANY_B,
          finished_at: '2026-11-23T12:00:00+00:00',
          is_demo: false,
          changes: [],
          companies: { display_name: 'Empresa Sintética B', is_demo: true, lifecycle: 'archived' },
        },
        {
          id: '9f8e7d6c-5a4b-4c3d-8e2f-3a4b5c6d7e8f',
          company_id: COMPANY_B,
          finished_at: '2026-11-22T12:00:00+00:00',
          is_demo: false,
          changes: [change('site_changed')],
          companies: [
            { display_name: 'Empresa Sintética B', is_demo: true, lifecycle: 'archived' },
          ],
        },
      ]),
    );
    const rows = await monitoring.recentChanges(10);

    const call = calls[0]!;
    expect(call.method).toBe('GET');
    expect(call.url.pathname).toBe('/rest/v1/company_investigations');
    expect(call.url.searchParams.get('status')).toBe('in.(succeeded,partial)');
    expect(call.url.searchParams.get('previous_id')).toBe('not.is.null');
    expect(call.url.searchParams.get('order')).toBe('finished_at.desc,id.asc');
    expect(call.url.searchParams.get('select')).toContain(
      'companies(display_name,is_demo,lifecycle)',
    );
    expect(rows).toEqual([
      {
        investigationId: '7d6c5b4a-3e2f-4a1b-8c9d-0e1f2a3b4c5d',
        companyId: COMPANY_A,
        companyName: 'Empresa Sintética A',
        isDemo: false,
        companyArchived: false,
        finishedAt: '2026-11-24T12:00:00.123Z',
        changes: [change('offering_added'), change('temporarily_unavailable')],
      },
      {
        investigationId: '9f8e7d6c-5a4b-4c3d-8e2f-3a4b5c6d7e8f',
        companyId: COMPANY_B,
        companyName: 'Empresa Sintética B',
        isDemo: true,
        companyArchived: true,
        finishedAt: '2026-11-22T12:00:00.000Z',
        changes: [change('site_changed')],
      },
    ]);
  });

  it('respeita o limite pedido', async () => {
    const row = (id: string) => ({
      id,
      company_id: COMPANY_A,
      finished_at: '2026-11-24T12:00:00+00:00',
      is_demo: false,
      changes: [change('new_signal')],
      companies: { display_name: 'Empresa Sintética A', is_demo: false, lifecycle: 'candidate' },
    });
    const { monitoring } = stub(() =>
      json(200, [
        row('7d6c5b4a-3e2f-4a1b-8c9d-0e1f2a3b4c5d'),
        row('8e7d6c5b-4f3a-4b2c-9d0e-1f2a3b4c5d6e'),
      ]),
    );
    expect(await monitoring.recentChanges(1)).toHaveLength(1);
  });

  it('empresa arquivada vem marcada, mas não ocupa vaga no limite', async () => {
    const row = (id: string, companyId: string, lifecycle: string) => ({
      id,
      company_id: companyId,
      finished_at: '2026-11-24T12:00:00+00:00',
      is_demo: false,
      changes: [change('new_signal')],
      companies: { display_name: 'Empresa Sintética', is_demo: false, lifecycle },
    });
    const { monitoring } = stub(() =>
      json(200, [
        row('7d6c5b4a-3e2f-4a1b-8c9d-0e1f2a3b4c5d', COMPANY_B, 'archived'),
        row('8e7d6c5b-4f3a-4b2c-9d0e-1f2a3b4c5d6e', COMPANY_A, 'candidate'),
        row('9f8e7d6c-5a4b-4c3d-8e2f-3a4b5c6d7e8f', COMPANY_A, 'candidate'),
      ]),
    );
    const rows = await monitoring.recentChanges(1);
    expect(rows.map((item) => [item.companyId, item.companyArchived])).toEqual([
      [COMPANY_B, true],
      [COMPANY_A, false],
    ]);
  });
});

describe('createSupabaseIntelligenceRepository', () => {
  it('funil do período: contagem exata nas tabelas de uma linha por empresa, distintas nas demais', async () => {
    const since = '2026-11-01T03:00:00.000Z';
    const { intelligence, calls } = stub((req) => {
      if (req.method === 'HEAD') {
        const demo = req.url.searchParams.get('is_demo') === 'eq.true';
        return new Response(null, {
          status: 200,
          headers: { 'content-range': demo ? '*/1' : '*/7' },
        });
      }
      if (req.url.pathname.endsWith('/interactions')) {
        return json(200, [
          { company_id: COMPANY_A, is_demo: false },
          { company_id: COMPANY_A, is_demo: false },
          { company_id: COMPANY_B, is_demo: true },
        ]);
      }
      return json(200, [{ company_id: COMPANY_A, is_demo: false }]);
    });
    const funnel = await intelligence.funnel(since);

    expect(funnel.found).toEqual({ count: 7, demo: 1, capped: false });
    expect(funnel.saved).toEqual({ count: 7, demo: 1, capped: false });
    expect(funnel.investigated).toEqual({ count: 1, demo: 0, capped: false });
    expect(funnel.contacted).toEqual({ count: 2, demo: 1, capped: false });
    expect(funnel.won).toEqual({ count: 1, demo: 0, capped: false });

    expect(calls.every((call) => call.method === 'GET' || call.method === 'HEAD')).toBe(true);
    const prospects = calls.find((call) => call.url.pathname.endsWith('/discovery_prospects'));
    expect(prospects?.url.searchParams.get('first_seen_at')).toBe(`gte.${since}`);
    const investigated = calls.find((call) =>
      call.url.pathname.endsWith('/company_investigations'),
    );
    expect(investigated?.url.searchParams.get('status')).toBe('in.(succeeded,partial)');
    expect(investigated?.url.searchParams.getAll('finished_at')).toContain(`gte.${since}`);
    expect(investigated?.url.searchParams.get('limit')).toBe('1000');
    const outbound = calls.find((call) => call.url.searchParams.get('direction') === 'eq.outbound');
    expect(outbound?.url.searchParams.getAll('occurred_at')).toContain(`gte.${since}`);
    const won = calls.find((call) => call.url.pathname.endsWith('/opportunities'));
    expect(won?.url.searchParams.get('stage')).toBe('eq.won');
  });

  it('desde o início: sem filtro de data; teto de linhas marca a etapa', async () => {
    const many = Array.from({ length: 1000 }, (_, index) => ({
      company_id: `00000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}`,
      is_demo: false,
    }));
    const { intelligence, calls } = stub((req) =>
      req.method === 'HEAD'
        ? new Response(null, { status: 200, headers: { 'content-range': '*/0' } })
        : json(200, req.url.pathname.endsWith('/approach_plans') ? many : []),
    );
    const funnel = await intelligence.funnel(null);
    expect(funnel.approached).toEqual({ count: 1000, demo: 0, capped: true });
    expect(funnel.replied).toEqual({ count: 0, demo: 0, capped: false });
    const plans = calls.find((call) => call.url.pathname.endsWith('/approach_plans'));
    expect(plans?.url.searchParams.get('created_at')).toBe('not.is.null');
  });

  it('gasto em dinheiro: soma as linhas com custo da IA e dos provedores', async () => {
    const { intelligence, calls } = stub((req) =>
      req.url.pathname.endsWith('/llm_calls')
        ? json(200, [{ cost_usd: 0.0125 }, { cost_usd: '0.000001' }])
        : json(200, [{ cost_usd: 0.5 }]),
    );
    expect(await intelligence.moneySpent('2026-11-01T03:00:00.000Z')).toEqual({
      usdMicros: 512_501,
      capped: false,
    });
    const usage = calls.find((call) => call.url.pathname.endsWith('/provider_usage'));
    expect(usage?.url.searchParams.get('occurred_at')).toBe('gte.2026-11-01T03:00:00.000Z');
    expect(usage?.url.searchParams.get('cost_usd')).toBe('gt.0');
  });

  it('resposta sem contagem falha em vez de virar zero', async () => {
    const { intelligence } = stub((req) =>
      req.method === 'HEAD' ? new Response(null, { status: 200 }) : json(200, []),
    );
    await expect(intelligence.funnel(null)).rejects.toMatchObject({ name: 'AppError' });
  });

  it('erro do banco vira AppError, sem detalhe interno', async () => {
    const { intelligence } = stub(() =>
      json(500, { message: 'relation "x" does not exist', code: '42P01' }),
    );
    await expect(intelligence.moneySpent('2026-11-01T03:00:00.000Z')).rejects.toMatchObject({
      name: 'AppError',
    });
  });
});

describe('uso da IA local no mês (createSupabaseCopilotRepository.usageSince)', () => {
  it('soma por modelo e marca o teto de 1.000 linhas', async () => {
    const llm = Array.from({ length: 1000 }, (_, index) => ({
      model: index % 4 === 0 ? 'modelo-b' : 'modelo-a',
      status: index === 0 ? 'error' : 'ok',
      output_tokens: 10,
      total_ms: '100',
    }));
    const { telemetry, calls } = stub((req) =>
      json(200, req.url.pathname.endsWith('/llm_calls') ? llm : [{ status: 'ok' }]),
    );
    const usage = await telemetry.usageSince(new Date('2026-11-01T03:00:00.000Z'));
    expect(usage).toMatchObject({
      generations: 1000,
      failed: 1,
      outputTokens: 10_000,
      totalMs: 100_000,
      toolCalls: 1,
      capped: true,
    });
    expect(usage.byModel.map((row) => [row.model, row.generations])).toEqual([
      ['modelo-a', 750],
      ['modelo-b', 250],
    ]);
    const read = calls.find((call) => call.url.pathname.endsWith('/llm_calls'));
    expect(read?.url.searchParams.get('limit')).toBe('1000');
    expect(read?.url.searchParams.get('created_at')).toBe('gte.2026-11-01T03:00:00.000Z');
  });

  it('abaixo do teto não marca nada', async () => {
    const { telemetry } = stub(() => json(200, []));
    const usage = await telemetry.usageSince(new Date('2026-11-01T03:00:00.000Z'));
    expect(usage).toMatchObject({ generations: 0, toolCalls: 0, capped: false });
  });
});
