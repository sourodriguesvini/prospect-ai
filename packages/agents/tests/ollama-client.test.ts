import { describe, expect, it } from 'vitest';
import { AiError, assertLoopback, createOllamaClient } from '../src';
import { readNdjson } from '../src/ollama/ndjson';
import { collect, DONE, fakeFetch, json, ndjson, streamOf, TAGS } from './support';

describe('readNdjson', () => {
  it('junta linhas partidas entre pedaços e ignora linhas vazias', async () => {
    const parts = ['{"a":1}\n{"b"', ':2}\n\n', '{"c":3}'];
    expect(await collect(readNdjson(streamOf(parts)))).toEqual([{ a: 1 }, { b: 2 }, { c: 3 }]);
  });

  it('lança em linha que não é JSON', async () => {
    await expect(collect(readNdjson(streamOf(['{"a":1}\nnão é json\n'])))).rejects.toThrow();
  });
});

describe('assertLoopback', () => {
  it.each(['http://127.0.0.1:11434', 'http://localhost:11434', 'http://[::1]:11434'])(
    'aceita %s',
    (url) => {
      expect(() => assertLoopback(url)).not.toThrow();
    },
  );

  it.each(['http://192.168.0.10:11434', 'https://ollama.com', 'file:///c:/x', 'http://0.0.0.0:1'])(
    'recusa %s',
    (url) => {
      expect(() => assertLoopback(url)).toThrow(/este computador/);
    },
  );
});

describe('createOllamaClient', () => {
  const base = 'http://127.0.0.1:11434';

  it('lista modelos instalados e carregados no formato do contrato', async () => {
    const { fetch } = fakeFetch({
      'GET /api/tags': () => json(TAGS),
      'GET /api/ps': () =>
        json({
          models: [
            {
              name: 'qwen3.5:4b',
              size: 4_000_000_000,
              size_vram: 4_000_000_000,
              expires_at: '2026-11-09T15:00:00-03:00',
              context_length: 8192,
            },
          ],
        }),
    });
    const client = createOllamaClient({ baseUrl: base, fetch });
    expect(await client.listModels()).toEqual([
      {
        name: 'qwen3.5:4b',
        sizeBytes: 3_300_000_000,
        digest: null,
        family: 'qwen35',
        parameterSize: '4.7B',
        quantization: 'Q4_K_M',
      },
      {
        name: 'nemotron-3-nano:4b',
        sizeBytes: 2_800_000_000,
        digest: null,
        family: null,
        parameterSize: null,
        quantization: null,
      },
    ]);
    expect(await client.listRunning()).toEqual([
      {
        name: 'qwen3.5:4b',
        sizeBytes: 4_000_000_000,
        vramBytes: 4_000_000_000,
        expiresAt: '2026-11-09T15:00:00-03:00',
        contextLength: 8192,
      },
    ]);
  });

  it('lê capacidades e metadados do /api/show sem carregar o modelo', async () => {
    const { fetch, calls } = fakeFetch({
      'POST /api/show': () =>
        json({
          license: 'Apache 2.0…',
          capabilities: ['completion', 'vision'],
          model_info: { 'general.architecture': 'qwen35', 'qwen35.context_length': 262_144 },
        }),
    });
    const client = createOllamaClient({ baseUrl: base, fetch });
    expect(await client.show('qwen3.5:4b')).toEqual({
      capabilities: ['completion', 'vision'],
      modelInfo: { 'general.architecture': 'qwen35', 'qwen35.context_length': 262_144 },
    });
    expect(calls[0]).toEqual({ key: 'POST /api/show', body: { model: 'qwen3.5:4b' } });
  });

  it('/api/show de Ollama antigo (sem capacidades) devolve null, e 404 vira model_not_installed', async () => {
    const { fetch } = fakeFetch({
      'POST /api/show': (_url, init) =>
        String(init?.body).includes('sumiu')
          ? json({ error: "model 'sumiu:1b' not found" }, 404)
          : json({ modelfile: 'FROM x' }),
    });
    const client = createOllamaClient({ baseUrl: base, fetch });
    expect(await client.show('antigo:1b')).toEqual({ capabilities: null, modelInfo: {} });
    await expect(client.show('sumiu:1b')).rejects.toMatchObject({ code: 'model_not_installed' });
  });

  it('Ollama fechado vira runtime_unavailable', async () => {
    const refused = (async () => {
      throw new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } });
    }) as typeof fetch;
    const client = createOllamaClient({ baseUrl: base, fetch: refused });
    const error = await client.version().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AiError);
    expect((error as AiError).code).toBe('runtime_unavailable');
    expect((error as AiError).detail).toContain('ECONNREFUSED');
  });

  it('Ollama travado estoura o tempo das chamadas curtas como runtime_unavailable', async () => {
    const hanging = ((_: unknown, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
      })) as typeof fetch;
    const client = createOllamaClient({ baseUrl: base, fetch: hanging, requestTimeoutMs: 20 });
    await expect(client.listModels()).rejects.toMatchObject({ code: 'runtime_unavailable' });
  });

  it('resposta fora do formato vira provider_error', async () => {
    const { fetch } = fakeFetch({ 'GET /api/tags': () => json({ modelos: [] }) });
    const client = createOllamaClient({ baseUrl: base, fetch });
    await expect(client.listModels()).rejects.toMatchObject({ code: 'provider_error' });
  });

  it('recusa redirecionamentos: a conversa nunca segue para outro endereço', async () => {
    const seen: Array<RequestInit['redirect']> = [];
    const fetchSpy = (async (_input: string | URL | Request, init?: RequestInit) => {
      seen.push(init?.redirect);
      return json({ version: '0.40.15' });
    }) as typeof fetch;
    await createOllamaClient({ baseUrl: base, fetch: fetchSpy }).version();
    expect(seen).toEqual(['error']);
  });

  it('envia o pedido de chat em streaming com think, keep_alive e opções', async () => {
    const { fetch, calls } = fakeFetch({
      'POST /api/chat': () =>
        new Response(streamOf(ndjson([{ message: { content: 'Olá' }, done: false }, DONE])), {
          status: 200,
        }),
    });
    const client = createOllamaClient({ baseUrl: base, fetch });
    const chunks = await collect(
      client.chat(
        {
          model: 'qwen3.5:4b',
          messages: [{ role: 'user', content: 'oi' }],
          think: false,
          keepAlive: '5m',
          options: { num_ctx: 8192, temperature: 0.4, num_predict: 1024 },
        },
        new AbortController().signal,
      ),
    );
    expect(chunks.map((chunk) => chunk.message?.content)).toEqual(['Olá', '']);
    expect(calls[0]?.body).toEqual({
      model: 'qwen3.5:4b',
      messages: [{ role: 'user', content: 'oi' }],
      stream: true,
      think: false,
      keep_alive: '5m',
      options: { num_ctx: 8192, temperature: 0.4, num_predict: 1024 },
    });
  });

  it('modelo ausente (404) vira model_not_installed; erro no meio do stream vira provider_error', async () => {
    const missing = fakeFetch({
      'POST /api/chat': () => json({ error: "model 'x:1b' not found" }, 404),
    });
    const request = {
      model: 'x:1b',
      messages: [],
      think: false,
      keepAlive: '5m',
      options: { num_ctx: 2048, temperature: 0, num_predict: 1024 },
    };
    await expect(
      collect(
        createOllamaClient({ baseUrl: base, fetch: missing.fetch }).chat(
          request,
          new AbortController().signal,
        ),
      ),
    ).rejects.toMatchObject({ code: 'model_not_installed' });

    const broken = fakeFetch({
      'POST /api/chat': () =>
        new Response(streamOf(ndjson([{ message: { content: 'a' } }, { error: 'CUDA error' }]))),
    });
    await expect(
      collect(
        createOllamaClient({ baseUrl: base, fetch: broken.fetch }).chat(
          request,
          new AbortController().signal,
        ),
      ),
    ).rejects.toMatchObject({ code: 'provider_error', detail: 'CUDA error' });
  });

  it('descarrega com keep_alive 0', async () => {
    const { fetch, calls } = fakeFetch({ 'POST /api/generate': () => json({ done: true }) });
    await createOllamaClient({ baseUrl: base, fetch }).unload('qwen3.5:4b');
    expect(calls[0]?.body).toEqual({ model: 'qwen3.5:4b', keep_alive: 0, stream: false });
  });
});
