import { readFileSync } from 'node:fs';
import { WebSearchRequest } from '@prospector/contracts';
import { describe, expect, it, vi } from 'vitest';
import { TAVILY_SEARCH_URL, createTavilySearch, parseTavilyResponse } from '../../src';

/** Chave falsa: o teste confere que ela não aparece em nenhum resultado. */
const KEY = 'tvly-chave-falsa-de-teste';

/** Fixture SINTÉTICO com a estrutura da resposta real (tests/fixtures/README.md). */
function fixture(): Record<string, unknown> {
  return JSON.parse(
    readFileSync(new URL('../fixtures/tavily-search.json', import.meta.url), 'utf8'),
  );
}

function respond(status: number, body?: unknown, headers: Record<string, string> = {}): Response {
  return new Response(
    body === undefined ? '' : typeof body === 'string' ? body : JSON.stringify(body),
    {
      status,
      headers: { 'content-type': 'application/json', ...headers },
    },
  );
}

function setup(handler: () => Response | Promise<Response>) {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return handler();
  });
  const search = createTavilySearch({
    apiKey: ` ${KEY} `,
    fetch: fetchImpl as unknown as typeof fetch,
  });
  return { search, calls };
}

const request = WebSearchRequest.parse({
  query: 'cerâmica exemplo interior paulista',
  maxResults: 5,
});

describe('createTavilySearch', () => {
  it('POST no host fixo, chave só no cabeçalho, busca basic sem resposta pronta', async () => {
    const { search, calls } = setup(() => respond(200, fixture()));
    const outcome = await search.search(request);
    expect(outcome.ok).toBe(true);
    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call?.url).toBe(TAVILY_SEARCH_URL);
    expect(call?.init?.method).toBe('POST');
    expect(call?.init?.redirect).toBe('error');
    const headers = call?.init?.headers as Record<string, string>;
    expect(headers.authorization).toBe(`Bearer ${KEY}`);
    const body = JSON.parse(String(call?.init?.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      query: 'cerâmica exemplo interior paulista',
      search_depth: 'basic',
      max_results: 5,
      topic: 'general',
      country: 'brazil',
      include_answer: false,
      include_raw_content: false,
      include_images: false,
      auto_parameters: false,
      include_usage: true,
    });
    expect(JSON.stringify(body)).not.toContain(KEY);
    expect(search.provider).toBe('tavily');
    expect(search.creditsPerSearch).toBe(1);
  });

  it('notícias sem país; domínios e período repassados', async () => {
    const { search, calls } = setup(() => respond(200, { results: [] }));
    await search.search(
      WebSearchRequest.parse({
        query: 'cerâmica exemplo',
        topic: 'news',
        timeRange: 'month',
        includeDomains: ['example.com'],
        excludeDomains: ['example.org'],
      }),
    );
    const body = JSON.parse(String(calls[0]?.init?.body)) as Record<string, unknown>;
    expect(body.country).toBeUndefined();
    expect(body).toMatchObject({
      topic: 'news',
      time_range: 'month',
      include_domains: ['example.com'],
      exclude_domains: ['example.org'],
    });
  });

  it('resposta vira resultados validados, cortados e sem dados pessoais', async () => {
    const data = fixture();
    const results = data.results as Array<Record<string, unknown>>;
    const last = results[3];
    if (last) last.content = 'texto longo '.repeat(400);
    const { search } = setup(() => respond(200, data));
    const outcome = await search.search(request);
    if (!outcome.ok) throw new Error('esperava sucesso');
    expect(outcome.creditsCharged).toBe(1);
    expect(outcome.results.map((result) => result.rank)).toEqual([1, 2, 4]);

    const [first, second, third] = outcome.results;
    expect(first?.snippet).toContain('[telefone omitido]');
    expect(first?.snippet).toContain('[e-mail omitido]');
    expect(first?.snippet).not.toMatch(/99876|contato@/);
    expect(first?.score).toBe(0.91);
    expect(first?.publishedAt).toBeNull();
    // Rede social aparece como resultado do buscador (quem recusa a leitura é o leitor de páginas).
    expect(second?.url).toBe('https://www.instagram.com/perfil.example/');
    expect(third?.title).toBe('noticias.example.org');
    expect(third?.snippet.length).toBeLessThanOrEqual(1200);
    expect(third?.snippet.endsWith('…')).toBe(true);
    expect(third?.score).toBe(1);
    expect(third?.publishedAt).toBe('2026-11-03');
    expect(JSON.stringify(outcome)).not.toContain(KEY);
  });

  it('crédito informado pela Tavily (usage) prevalece sobre o nominal', async () => {
    const { search } = setup(() => respond(200, { results: [], usage: { credits: 2 } }));
    const outcome = await search.search(request);
    expect(outcome).toEqual({ ok: true, results: [], creditsCharged: 2 });
  });

  it.each([
    [401, 'unauthorized', 0],
    [403, 'unauthorized', 0],
    [429, 'rate_limited', 0],
    [434, 'rate_limited', 0],
    [432, 'quota_exceeded', 0],
    [433, 'quota_exceeded', 0],
    [400, 'invalid_response', 0],
    [500, 'unavailable', 0],
    [502, 'unavailable', 0],
  ] as const)('HTTP %i → %s', async (status, failure, credits) => {
    const { search } = setup(() => respond(status, { detail: { error: `chave ${KEY} recusada` } }));
    const outcome = await search.search(request);
    expect(outcome).toMatchObject({ ok: false, failure, creditsCharged: credits });
    expect(JSON.stringify(outcome)).not.toContain(KEY);
  });

  it('429 respeita Retry-After (limitado a 1 h)', async () => {
    const curto = setup(() => respond(429, {}, { 'retry-after': '30' }));
    expect(await curto.search.search(request)).toMatchObject({ retryAfterSeconds: 30 });
    const longo = setup(() => respond(429, {}, { 'retry-after': '99999' }));
    expect(await longo.search.search(request)).toMatchObject({ retryAfterSeconds: 3600 });
  });

  it('corpo inválido conta o crédito (a Tavily já cobrou) e não inventa resultado', async () => {
    const naoJson = setup(() => respond(200, '<html>erro</html>'));
    expect(await naoJson.search.search(request)).toEqual({
      ok: false,
      failure: 'invalid_response',
      creditsCharged: 1,
      retryAfterSeconds: null,
    });
    const semResultados = setup(() => respond(200, { answer: 'texto' }));
    expect(await semResultados.search.search(request)).toMatchObject({
      ok: false,
      failure: 'invalid_response',
    });
  });

  it('erro de rede: DNS = nada cobrado; tempo esgotado = cobrado por precaução', async () => {
    const semDns = setup(() => {
      throw new TypeError('fetch failed', { cause: { code: 'ENOTFOUND' } });
    });
    expect(await semDns.search.search(request)).toMatchObject({
      ok: false,
      failure: 'unavailable',
      creditsCharged: 0,
    });
    const esgotado = setup(() => {
      throw new DOMException('tempo esgotado', 'TimeoutError');
    });
    expect(await esgotado.search.search(request)).toMatchObject({
      ok: false,
      failure: 'unavailable',
      creditsCharged: 1,
    });
  });

  it('cancelamento de quem chamou é repassado', async () => {
    const controller = new AbortController();
    controller.abort();
    const { search } = setup(() => {
      throw new DOMException('cancelado', 'AbortError');
    });
    await expect(search.search(request, { signal: controller.signal })).rejects.toThrow(
      'cancelado',
    );
  });
});

describe('parseTavilyResponse', () => {
  it('respeita a quantidade pedida e descarta itens fora do formato', () => {
    const parsed = parseTavilyResponse(
      {
        results: [
          { url: 'https://a.example.com/', title: 'A', content: 'a' },
          { title: 'sem url' },
          { url: 'https://b.example.com/', title: 'B', content: null },
          { url: 'https://c.example.com/', title: 'C', content: 'c' },
        ],
        usage: { credits: -1 },
      },
      2,
    );
    expect(parsed?.results.map((result) => result.url)).toEqual([
      'https://a.example.com/',
      'https://b.example.com/',
    ]);
    expect(parsed?.results[1]?.snippet).toBe('');
    expect(parsed?.credits).toBeNull();
    expect(parseTavilyResponse(null, 5)).toBeNull();
  });
});
