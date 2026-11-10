import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { LOCAL_AI_ENV_FORMATS, LocalAiConfigError, localAiEnv } = await import('./env');
const { getLocalAi } = await import('./container');

const AI_VARS = [
  'OLLAMA_BASE_URL',
  'AI_COPILOT_MODELS',
  'AI_KEEP_ALIVE',
  'AI_NUM_CTX',
  'AI_MAX_CONCURRENCY',
  'AI_MAX_QUEUE',
  'AI_VRAM_RESERVE_MIB',
];
const LOCAL_AI_KEY = '__prospectorLocalAi';

beforeEach(() => {
  for (const name of AI_VARS) vi.stubEnv(name, undefined);
  delete (globalThis as Record<string, unknown>)[LOCAL_AI_KEY];
});

afterEach(() => {
  vi.unstubAllEnvs();
  delete (globalThis as Record<string, unknown>)[LOCAL_AI_KEY];
});

describe('localAiEnv', () => {
  it('sem variáveis usa os padrões', () => {
    expect(localAiEnv()).toEqual({
      baseUrl: undefined,
      copilotModels: undefined,
      keepAlive: undefined,
      numCtx: undefined,
      maxConcurrent: 1,
      maxQueue: 3,
      vramReserveMiB: undefined,
    });
  });

  it('lê e valida os valores', () => {
    vi.stubEnv('AI_COPILOT_MODELS', ' qwen3.5:4b , nemotron-3-nano:4b ');
    vi.stubEnv('AI_NUM_CTX', '16384');
    vi.stubEnv('AI_VRAM_RESERVE_MIB', '0');
    vi.stubEnv('AI_KEEP_ALIVE', '10m');
    expect(localAiEnv()).toMatchObject({
      copilotModels: ['qwen3.5:4b', 'nemotron-3-nano:4b'],
      numCtx: 16_384,
      vramReserveMiB: 0,
      keepAlive: '10m',
    });
  });

  it('valor inválido lança com os nomes das variáveis, sem os valores', () => {
    vi.stubEnv('AI_NUM_CTX', 'muito');
    vi.stubEnv('AI_VRAM_RESERVE_MIB', '-5');
    let error: unknown;
    try {
      localAiEnv();
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(LocalAiConfigError);
    expect((error as InstanceType<typeof LocalAiConfigError>).variables).toEqual([
      'AI_NUM_CTX',
      'AI_VRAM_RESERVE_MIB',
    ]);
    expect((error as Error).message).not.toContain('muito');
  });
});

describe('getLocalAi com configuração inválida', () => {
  it('não lança: o estado fica offline com invalid_config e o Copiloto responde com o motivo', async () => {
    vi.stubEnv('AI_MAX_CONCURRENCY', '99');
    const ai = getLocalAi();
    const status = await ai.status();
    expect(status).toMatchObject({ state: 'offline', code: 'invalid_config' });
    if (status.state === 'offline') {
      // Diz o formato esperado (KI-067), nunca o valor recebido.
      expect(status.message).toContain(
        'a variável AI_MAX_CONCURRENCY (número inteiro de 1 a 4) está inválida',
      );
      expect(status.message).toContain('reinicie o app');
      expect(status.message).not.toContain('99');
    }
    const events = [];
    for await (const event of ai.copilot.reply(
      { schemaVersion: 1, think: false, messages: [{ role: 'user', content: 'oi' }] },
      { traceId: 't', systemFacts: [] },
    )) {
      events.push(event);
    }
    expect(events).toEqual([
      {
        type: 'error',
        code: 'invalid_config',
        message: expect.stringContaining('AI_MAX_CONCURRENCY'),
      },
    ]);
    await expect(ai.unload('qwen3.5:4b')).rejects.toMatchObject({ code: 'invalid_config' });
  });

  it('com várias variáveis inválidas, lista o formato de cada uma', async () => {
    vi.stubEnv('AI_KEEP_ALIVE', 'sempre');
    vi.stubEnv('AI_NUM_CTX', 'muito');
    const status = await getLocalAi().status();
    expect(status).toMatchObject({ state: 'offline', code: 'invalid_config' });
    if (status.state === 'offline') {
      expect(status.message).toContain(
        'as variáveis AI_KEEP_ALIVE (0 ou um número seguido de ms, s, m ou h, como 5m); AI_NUM_CTX (número inteiro de 2048 a 262144) estão inválidas',
      );
      expect(status.message).not.toContain('sempre');
      expect(status.message).not.toContain('muito');
    }
  });

  it('todas as variáveis da IA local têm formato descrito', () => {
    expect(Object.keys(LOCAL_AI_ENV_FORMATS).sort()).toEqual([...AI_VARS].sort());
  });

  it('OLLAMA_BASE_URL fora deste computador também vira invalid_config', async () => {
    vi.stubEnv('OLLAMA_BASE_URL', 'http://192.168.0.10:8080');
    const status = await getLocalAi().status();
    expect(status).toMatchObject({ state: 'offline', code: 'invalid_config' });
    if (status.state === 'offline') {
      expect(status.message).toContain('este computador');
      expect(status.message).not.toContain('192.168'); // o valor fica só no log do servidor
    }
  });

  it('corrigida a variável, a próxima leitura monta a IA local de verdade', async () => {
    vi.stubEnv('AI_NUM_CTX', 'muito');
    expect(await getLocalAi().status()).toMatchObject({ code: 'invalid_config' });
    vi.stubEnv('AI_NUM_CTX', '8192');
    vi.stubEnv('OLLAMA_BASE_URL', 'http://127.0.0.1:9'); // porta sem servidor
    expect(await getLocalAi().status()).toMatchObject({
      state: 'offline',
      code: 'runtime_unavailable',
    });
  });
});
