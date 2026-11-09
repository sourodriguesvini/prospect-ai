import { AppError } from '@prospector/application';
import { describe, expect, it } from 'vitest';
import {
  createServerSupabaseClient,
  createSupabaseAuditRepository,
  createSupabaseDatabaseHealth,
} from '../../src';

/**
 * Testa os adaptadores contra respostas HTTP do PostgREST simuladas (sem Supabase real):
 * URL, método, cabeçalhos e corpo de cada chamada, e o tratamento das respostas de erro.
 * O comportamento do banco em si (privilégios, append-only) está em tests/db.
 */

const URL_BASE = 'http://supabase.local.test';
const KEY = 'chave-de-teste-nao-real';
const TRACE = '0b7c6d3e-4f2a-4b8c-9d1e-2f3a4b5c6d7e';

interface Captured {
  url: URL;
  method: string;
  headers: Headers;
  body: string | null;
  signal: AbortSignal | null;
}

function stub(respond: (req: Captured) => Response | Promise<Response>) {
  const calls: Captured[] = [];
  const fetchStub: typeof fetch = async (input, init) => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const req: Captured = {
      url: new URL(href),
      method: init?.method ?? 'GET',
      headers: new Headers(init?.headers),
      body: typeof init?.body === 'string' ? init.body : null,
      signal: init?.signal ?? null,
    };
    calls.push(req);
    return respond(req);
  };
  const client = createServerSupabaseClient(URL_BASE, KEY, { fetch: fetchStub });
  return { client, calls };
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const ROW = {
  id: 7,
  actor_type: 'user',
  actor_label: null,
  action: 'system.health.checked',
  entity_type: 'system',
  entity_id: null,
  diff: {},
  trace_id: TRACE,
  occurred_at: '2026-11-09T12:00:00+00:00',
};

describe('createSupabaseAuditRepository', () => {
  it('append: POST em audit_log com colunas em snake_case e a secret key', async () => {
    const { client, calls } = stub(() => new Response(null, { status: 201 }));
    await createSupabaseAuditRepository(client).append({
      actorType: 'agent',
      actorLabel: 'investigador@v1',
      action: 'research.company.investigated',
      entityType: 'company',
      entityId: 'c-1',
      diff: { fontes: 3 },
      traceId: TRACE,
    });
    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call?.method).toBe('POST');
    expect(call?.url.pathname).toBe('/rest/v1/audit_log');
    expect(call?.headers.get('apikey')).toBe(KEY);
    expect(JSON.parse(call?.body ?? 'null')).toEqual({
      actor_type: 'agent',
      actor_label: 'investigador@v1',
      action: 'research.company.investigated',
      entity_type: 'company',
      entity_id: 'c-1',
      diff: { fontes: 3 },
      trace_id: TRACE,
    });
  });

  it('listRecent: mais recentes primeiro, com limite, e converte as linhas', async () => {
    const { client, calls } = stub(() => json(200, [ROW]));
    const entries = await createSupabaseAuditRepository(client).listRecent(25);
    const params = calls[0]?.url.searchParams;
    expect(params?.get('order')).toBe('occurred_at.desc,id.desc');
    expect(params?.get('limit')).toBe('25');
    expect(params?.get('select')).toContain('trace_id');
    expect(entries).toEqual([
      expect.objectContaining({ id: 7, actorType: 'user', traceId: TRACE }),
    ]);
  });

  it('erro do PostgREST vira AppError sem a mensagem interna', async () => {
    const { client } = stub(() =>
      json(403, { code: '42501', message: 'permission denied for table audit_log' }),
    );
    const failure = await createSupabaseAuditRepository(client)
      .listRecent(5)
      .catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(AppError);
    expect((failure as AppError).message).not.toContain('permission');
  });
});

describe('createSupabaseDatabaseHealth', () => {
  it('ok quando a leitura funciona', async () => {
    const { client } = stub(() => json(200, []));
    expect(await createSupabaseDatabaseHealth(client).check()).toBe('ok');
  });

  it('schema_missing quando a tabela não existe', async () => {
    const { client } = stub(() =>
      json(404, { code: 'PGRST205', message: "Could not find the table 'public.audit_log'" }),
    );
    expect(await createSupabaseDatabaseHealth(client).check()).toBe('schema_missing');
  });

  it('unreachable quando a chave é recusada', async () => {
    const { client } = stub(() => json(401, { message: 'Invalid API key' }));
    expect(await createSupabaseDatabaseHealth(client).check()).toBe('unreachable');
  });

  it('unreachable quando a rede falha', async () => {
    const { client } = stub(() => {
      throw new TypeError('fetch failed');
    });
    expect(await createSupabaseDatabaseHealth(client).check()).toBe('unreachable');
  });

  it('unreachable quando o banco não responde dentro do tempo limite', async () => {
    // Como o fetch real: só termina quando o sinal de cancelamento dispara.
    const { client } = stub(
      ({ signal }) =>
        new Promise<Response>((_resolve, reject) => {
          signal?.addEventListener('abort', () => reject(signal.reason as Error));
        }),
    );
    const result = await Promise.race([
      createSupabaseDatabaseHealth(client, 50).check(),
      new Promise((resolve) => setTimeout(() => resolve('travou'), 1000)),
    ]);
    expect(result).toBe('unreachable');
  });
});
