import type { CopilotEvent, CopilotRequest } from '@prospector/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Rota do Copiloto sem Next e sem Ollama: o Copiloto e os fatos do sistema são trocados por
 * versões falsas na raiz de composição. Cobre as recusas, o streaming e o cancelamento (KI-040).
 */
type Reply = (
  request: CopilotRequest,
  options: { traceId: string; signal?: AbortSignal; systemFacts: readonly string[] },
) => AsyncGenerator<CopilotEvent>;

const reply = vi.fn<Reply>();
vi.mock('@/server/container', () => ({
  getLocalAi: () => ({ copilot: { promptId: 'copilot/v1', reply } }),
}));
vi.mock('@/server/copilot-context', () => ({
  copilotSystemFacts: () => Promise.resolve(['Hoje é segunda-feira.']),
}));

const { POST } = await import('./route');

const ORIGIN = 'http://127.0.0.1:3000';
const ask = { schemaVersion: 1, messages: [{ role: 'user', content: 'oi' }] };
const START: CopilotEvent = {
  type: 'start',
  model: 'qwen3.5:4b',
  promptVersion: 'copilot/v1',
  traceId: 't',
};

function post(
  body: unknown,
  options?: { headers?: Record<string, string | null>; signal?: AbortSignal },
): Request {
  const headers = new Headers({
    host: '127.0.0.1:3000',
    origin: ORIGIN,
    'sec-fetch-site': 'same-origin',
    'content-type': 'application/json',
  });
  for (const [name, value] of Object.entries(options?.headers ?? {})) {
    if (value === null) headers.delete(name);
    else headers.set(name, value);
  }
  return new Request(`${ORIGIN}/api/copiloto`, {
    method: 'POST',
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
    signal: options?.signal,
  });
}

async function lines(response: Response): Promise<unknown[]> {
  return (await response.text())
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as unknown);
}

beforeEach(() => {
  reply.mockReset();
});

describe('POST /api/copiloto: recusas', () => {
  it('sem Origin: recusa (só a própria página usa o Copiloto)', async () => {
    const response = await POST(post(ask, { headers: { origin: null, 'sec-fetch-site': null } }));
    expect(response.status).toBe(403);
    expect(reply).not.toHaveBeenCalled();
  });

  it('de outro site: recusa', async () => {
    const crossSite = post(ask, {
      headers: { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' },
    });
    expect((await POST(crossSite)).status).toBe(403);
    const otherPort = post(ask, { headers: { origin: 'http://127.0.0.1:4000' } });
    expect((await POST(otherPort)).status).toBe(403);
  });

  it('exige JSON, limita o tamanho em bytes e valida o contrato', async () => {
    expect((await POST(post('oi', { headers: { 'content-type': 'text/plain' } }))).status).toBe(
      415,
    );
    const huge = { ...ask, messages: [{ role: 'user', content: 'é'.repeat(140_000) }] };
    expect((await POST(post(huge))).status).toBe(413);
    expect((await POST(post('{não é json'))).status).toBe(400);
    const invalid = await POST(post({ schemaVersion: 1, messages: [] }));
    expect(invalid.status).toBe(400);
    expect(reply).not.toHaveBeenCalled();
  });
});

describe('POST /api/copiloto: streaming', () => {
  it('envia um evento por linha e troca evento fora do contrato por erro', async () => {
    reply.mockImplementation(async function* () {
      yield START;
      yield { type: 'delta', text: 'Olá' };
      yield { type: 'html', text: '<b>' } as unknown as CopilotEvent;
    });
    const response = await POST(post(ask));
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/x-ndjson');
    expect(response.headers.get('x-trace-id')).toMatch(/^[0-9a-f-]{36}$/);
    expect(await lines(response)).toEqual([
      START,
      { type: 'delta', text: 'Olá' },
      { type: 'error', code: 'provider_error', message: expect.stringContaining('Ollama') },
    ]);
    const [request, options] = reply.mock.calls[0] ?? [];
    expect(request).toMatchObject({ schemaVersion: 1, think: false });
    expect(options?.systemFacts).toEqual(['Hoje é segunda-feira.']);
  });

  it('a conexão fechada no meio da resposta interrompe a geração', async () => {
    let finished = false;
    let seenSignal: AbortSignal | undefined;
    reply.mockImplementation(async function* (_request, options) {
      seenSignal = options.signal;
      try {
        yield START;
        // Simula o modelo escrevendo até o sinal do pedido abortar.
        await new Promise((resolve) =>
          options.signal?.addEventListener('abort', resolve, { once: true }),
        );
        yield { type: 'error', code: 'cancelled', message: 'Resposta interrompida.' };
      } finally {
        finished = true;
      }
    });
    const controller = new AbortController();
    const response = await POST(post(ask, { signal: controller.signal }));
    const reader = response.body!.getReader();
    const first = new TextDecoder().decode((await reader.read()).value);
    expect(JSON.parse(first)).toEqual(START);

    controller.abort(); // o navegador fechou a aba
    await reader.cancel();
    expect(seenSignal?.aborted).toBe(true);
    expect(finished).toBe(true);
  });

  it('cancelar a leitura encerra o gerador mesmo sem o sinal abortar', async () => {
    let finished = false;
    reply.mockImplementation(async function* () {
      try {
        yield START;
        for (;;) yield { type: 'delta', text: 'bla ' };
      } finally {
        finished = true;
      }
    });
    const response = await POST(post(ask));
    const reader = response.body!.getReader();
    await reader.read();
    await reader.cancel();
    expect(finished).toBe(true);
  });
});
