import { AppError } from '@prospector/application';
import type { CopilotEvent, CopilotRequest, ToolCallRequest } from '@prospector/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Rota do Copiloto sem Next, sem Ollama e sem banco: o Copiloto, o histórico e as ferramentas são
 * trocados por versões falsas na raiz de composição. Cobre as recusas, o streaming, o histórico
 * salvo (IA-2), as ferramentas e o cancelamento (KI-040).
 */
interface Toolbox {
  specs: readonly { name: string; title: string }[];
  execute(call: ToolCallRequest): Promise<{ status: string; summary: string; links: unknown[] }>;
}
type Reply = (
  request: CopilotRequest,
  options: {
    traceId: string;
    signal?: AbortSignal;
    systemFacts: readonly string[];
    tools?: Toolbox;
  },
) => AsyncGenerator<CopilotEvent>;

const THREAD = '11111111-1111-4111-8111-111111111111';
const reply = vi.fn<Reply>();
const history = {
  openTurn: vi.fn(),
  saveAnswer: vi.fn(),
  saveToolResult: vi.fn(),
  recordGeneration: vi.fn(),
};
const registry = { specs: vi.fn(), execute: vi.fn() };
let withDatabase = true;

vi.mock('@/server/container', () => ({
  getLocalAi: () => ({ copilot: { promptId: 'copilot/v3', reply } }),
  getServices: () =>
    withDatabase ? { copilot: history, tools: registry } : { copilot: null, tools: null },
}));
vi.mock('@/server/copilot-context', () => ({
  copilotSystemFacts: () => Promise.resolve(['Hoje é segunda-feira.']),
}));

const { POST } = await import('./route');

const ORIGIN = 'http://127.0.0.1:3000';
const ask = { schemaVersion: 2, threadId: null, message: 'oi' };
const START: CopilotEvent = {
  type: 'start',
  model: 'qwen3.5:4b',
  promptVersion: 'copilot-tools/v1',
  traceId: 't',
};
const THREAD_EVENT: CopilotEvent = {
  type: 'thread',
  threadId: THREAD,
  title: 'oi',
  created: true,
};
const USAGE = {
  inputTokens: 10,
  outputTokens: 5,
  totalMs: 100,
  loadMs: 0,
  outputTokensPerSecond: 50,
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
  withDatabase = true;
  reply.mockReset();
  for (const fn of Object.values(history)) fn.mockReset();
  history.openTurn.mockResolvedValue({
    thread: { id: THREAD, title: 'oi' },
    created: true,
    history: [
      { role: 'user', content: 'pergunta antiga' },
      { role: 'assistant', content: 'resposta antiga' },
      { role: 'user', content: 'oi' },
    ],
  });
  history.saveAnswer.mockResolvedValue(undefined);
  history.saveToolResult.mockResolvedValue(undefined);
  history.recordGeneration.mockResolvedValue(undefined);
  registry.specs.mockReturnValue([
    { name: 'list_offers', title: 'Consultando ofertas', description: 'x', parameters: {} },
  ]);
  registry.execute.mockReset();
});

describe('POST /api/copiloto: recusas', () => {
  it('sem Origin: recusa (só a própria página usa o Copiloto)', async () => {
    const response = await POST(post(ask, { headers: { origin: null, 'sec-fetch-site': null } }));
    expect(response.status).toBe(403);
    expect(reply).not.toHaveBeenCalled();
    expect(history.openTurn).not.toHaveBeenCalled();
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
    const huge = { ...ask, message: 'é'.repeat(40_000) };
    expect((await POST(post(huge))).status).toBe(413);
    expect((await POST(post('{não é json'))).status).toBe(400);
    // O formato antigo (histórico vindo do navegador) não é mais aceito (KI-032).
    const old = await POST(post({ schemaVersion: 1, messages: [{ role: 'user', content: 'oi' }] }));
    expect(old.status).toBe(400);
    expect((await POST(post({ ...ask, threadId: 'abc' }))).status).toBe(400);
    expect(reply).not.toHaveBeenCalled();
  });

  it('conversa inexistente: 404 sem chamar o modelo', async () => {
    history.openTurn.mockRejectedValue(new AppError('not_found', 'not_found'));
    const response = await POST(post({ ...ask, threadId: THREAD }));
    expect(response.status).toBe(404);
    expect(reply).not.toHaveBeenCalled();
  });
});

describe('POST /api/copiloto: streaming e histórico', () => {
  it('abre a conversa, manda o histórico do banco e salva a resposta completa', async () => {
    reply.mockImplementation(async function* () {
      yield START;
      yield { type: 'delta', text: 'Olá' };
      yield { type: 'done', model: 'qwen3.5:4b', doneReason: 'stop', usage: USAGE };
    });
    const response = await POST(post(ask));
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/x-ndjson');
    expect(response.headers.get('x-trace-id')).toMatch(/^[0-9a-f-]{36}$/);
    expect(response.headers.get('x-thread-id')).toBe(THREAD);
    const events = await lines(response);
    expect(events[0]).toEqual({ ...THREAD_EVENT, title: 'oi' });
    expect(events[1]).toEqual(START);

    const [request, options] = reply.mock.calls[0] ?? [];
    expect(request?.messages).toEqual([
      { role: 'user', content: 'pergunta antiga' },
      { role: 'assistant', content: 'resposta antiga' },
      { role: 'user', content: 'oi' },
    ]);
    expect(options?.systemFacts).toEqual(['Hoje é segunda-feira.']);
    expect(options?.tools?.specs.map((spec) => spec.name)).toEqual(['list_offers']);
    expect(history.saveAnswer).toHaveBeenCalledWith(
      expect.objectContaining({ traceId: options?.traceId }),
      expect.objectContaining({
        threadId: THREAD,
        content: 'Olá',
        status: 'complete',
        model: 'qwen3.5:4b',
        promptVersion: 'copilot-tools/v1',
        usage: USAGE,
      }),
    );
  });

  it('troca evento fora do contrato por erro e salva a resposta como falha', async () => {
    reply.mockImplementation(async function* () {
      yield START;
      yield { type: 'html', text: '<b>' } as unknown as CopilotEvent;
      yield { type: 'error', code: 'timeout', message: 'demorou' };
    });
    const events = await lines(await POST(post(ask)));
    expect(events[2]).toMatchObject({ type: 'error', code: 'provider_error' });
    expect(history.saveAnswer).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: 'failed', errorCode: 'timeout' }),
    );
  });

  it('executa a ferramenta pelo registro, salva o resultado e devolve links internos', async () => {
    registry.execute.mockResolvedValue({
      result: {
        status: 'ok',
        summary: '1 oferta: 1 ativa.',
        data: [],
        refs: [{ kind: 'offer', id: 'abc', label: 'Branding' }],
        errorCode: null,
      },
      forModel: '{"status":"ok"}',
    });
    let outcome: Awaited<ReturnType<Toolbox['execute']>> | undefined;
    reply.mockImplementation(async function* (_request, options) {
      yield START;
      outcome = await options.tools?.execute({ id: 'c1', name: 'list_offers', arguments: {} });
      yield { type: 'done', model: 'qwen3.5:4b', doneReason: 'stop', usage: USAGE };
    });
    await lines(await POST(post(ask)));
    expect(registry.execute).toHaveBeenCalledWith(
      expect.anything(),
      { id: 'c1', name: 'list_offers', arguments: {} },
      { threadId: THREAD },
    );
    expect(outcome).toMatchObject({
      status: 'ok',
      links: [{ label: 'Branding', href: '/configuracoes/estrategia/ofertas/abc' }],
      forModel: '{"status":"ok"}',
    });
    expect(history.saveToolResult).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ threadId: THREAD, status: 'ok', summary: '1 oferta: 1 ativa.' }),
    );
    expect(history.saveAnswer).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ toolCalls: [{ id: 'c1', name: 'list_offers', arguments: {} }] }),
    );
  });

  it('sem banco: avisa que nada é salvo e responde só à pergunta', async () => {
    withDatabase = false;
    reply.mockImplementation(async function* () {
      yield START;
    });
    const events = await lines(await POST(post(ask)));
    expect(events[0]).toMatchObject({ type: 'notice' });
    const [request, options] = reply.mock.calls[0] ?? [];
    expect(request?.messages).toEqual([{ role: 'user', content: 'oi' }]);
    expect(options?.tools).toBeUndefined();
  });

  it('a conexão fechada no meio da resposta interrompe a geração e salva o parcial', async () => {
    let finished = false;
    let seenSignal: AbortSignal | undefined;
    reply.mockImplementation(async function* (_request, options) {
      seenSignal = options.signal;
      try {
        yield START;
        yield { type: 'delta', text: 'Parcial' };
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
    const decoder = new TextDecoder();
    let seen = '';
    while (!seen.includes('Parcial')) seen += decoder.decode((await reader.read()).value);

    controller.abort(); // o navegador fechou a aba
    await reader.cancel();
    expect(seenSignal?.aborted).toBe(true);
    expect(finished).toBe(true);
    expect(history.saveAnswer).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ content: 'Parcial', status: 'interrupted' }),
    );
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
    const decoder = new TextDecoder();
    let seen = '';
    while (!seen.includes('"start"')) seen += decoder.decode((await reader.read()).value);
    await reader.cancel();
    expect(finished).toBe(true);
    expect(history.saveAnswer).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: 'interrupted' }),
    );
  });
});
