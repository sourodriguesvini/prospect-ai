import { AppError } from '@prospector/application';
import { describe, expect, it } from 'vitest';
import { createServerSupabaseClient } from '../../src';
import { createSupabaseWebResearchUsage } from '../../src/web-research-usage-repository';

/** Adaptador do consumo de créditos contra respostas do PostgREST simuladas (sem Supabase real). */

const URL_BASE = 'http://supabase.local.test';
const KEY = 'chave-de-teste-nao-real';
const TRACE = '6a1f0e2d-3c4b-4a59-8e7d-1c2b3a4f5e6d';

function stub(respond: () => Response) {
  const calls: Array<{ url: URL; method: string; body: string | null }> = [];
  const fetchStub: typeof fetch = async (input, init) => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    calls.push({
      url: new URL(href),
      method: init?.method ?? 'GET',
      body: typeof init?.body === 'string' ? init.body : null,
    });
    return respond();
  };
  const client = createServerSupabaseClient(URL_BASE, KEY, { fetch: fetchStub });
  return { usage: createSupabaseWebResearchUsage(client), calls };
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('createSupabaseWebResearchUsage', () => {
  it('creditsUsed lê a soma do mês na view e devolve 0 sem linhas', async () => {
    const used = stub(() => json(200, { units_used: 37 }));
    expect(await used.usage.creditsUsed('tavily', '2026-11')).toBe(37);
    const call = used.calls[0];
    expect(call?.url.pathname).toBe('/rest/v1/provider_usage_monthly');
    expect(call?.url.searchParams.get('provider')).toBe('eq.tavily');
    expect(call?.url.searchParams.get('period')).toBe('eq.2026-11');

    const none = stub(() => new Response(null, { status: 200 }));
    expect(await none.usage.creditsUsed('tavily', '2026-12')).toBe(0);
  });

  it('record grava só o necessário, sem a consulta', async () => {
    const { usage, calls } = stub(() => new Response(null, { status: 201 }));
    await usage.record({
      provider: 'tavily',
      operation: 'search',
      units: 1,
      period: '2026-11',
      outcome: 'ok',
      traceId: TRACE,
      occurredAt: '2026-11-10T15:00:00.000Z',
    });
    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.url.pathname).toBe('/rest/v1/provider_usage');
    expect(JSON.parse(calls[0]?.body ?? 'null')).toEqual({
      provider: 'tavily',
      operation: 'search',
      units: 1,
      period: '2026-11',
      outcome: 'ok',
      trace_id: TRACE,
      occurred_at: '2026-11-10T15:00:00.000Z',
    });
  });

  it('tabela ausente (migração não aplicada) vira AppError sem detalhe interno', async () => {
    const { usage } = stub(() =>
      json(404, {
        code: 'PGRST205',
        message: "Could not find the table 'public.provider_usage_monthly'",
      }),
    );
    const failure = await usage.creditsUsed('tavily', '2026-11').catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(AppError);
    expect((failure as AppError).message).not.toContain('provider_usage');
  });
});
