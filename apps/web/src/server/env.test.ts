import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { LOCAL_AI_ENV_FORMATS, LocalAiConfigError, investigationEnv, localAiEnv, jobWorkerEnabled } =
  await import('./env');
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

describe('trabalhador da fila (PROSPECTOR_JOB_WORKER)', () => {
  it('ligado por padrão; off desliga; valor estranho é erro', () => {
    vi.stubEnv('PROSPECTOR_JOB_WORKER', undefined);
    expect(jobWorkerEnabled()).toBe(true);
    vi.stubEnv('PROSPECTOR_JOB_WORKER', 'off');
    expect(jobWorkerEnabled()).toBe(false);
    vi.stubEnv('PROSPECTOR_JOB_WORKER', 'talvez');
    expect(() => jobWorkerEnabled()).toThrow('PROSPECTOR_JOB_WORKER');
  });
});

describe('investigationEnv (pasta das capturas, ADR-0015)', () => {
  let localAppData = '';
  beforeEach(() => {
    vi.stubEnv('PROSPECTOR_CAPTURES_DIR', undefined);
    vi.stubEnv('PROSPECTOR_DATA_DIR', undefined);
    vi.stubEnv('PROSPECTOR_BRAND_CAPTURE', undefined);
    vi.stubEnv('PROSPECTOR_STORAGE', undefined);
    // Registro da instalação numa pasta temporária: nunca o do computador de quem roda o teste.
    localAppData = mkdtempSync(join(tmpdir(), 'prospector-localappdata-'));
    vi.stubEnv('LOCALAPPDATA', localAppData);
  });
  afterEach(() => {
    rmSync(localAppData, { recursive: true, force: true });
  });

  function writePointer(content: unknown) {
    mkdirSync(join(localAppData, 'Prospector'), { recursive: true });
    writeFileSync(
      join(localAppData, 'Prospector', 'instalacao.json'),
      typeof content === 'string' ? content : JSON.stringify(content),
    );
  }

  it('sem pasta: captura ligada, imagens não guardadas', () => {
    expect(investigationEnv()).toEqual({
      capturesDir: null,
      captureEnabled: true,
      capturesDirProblem: null,
      capturesDirSource: null,
    });
  });

  it('aceita pasta absoluta fora do C:', () => {
    const dir = String.raw`D:\Prospector-dados\capturas`;
    vi.stubEnv('PROSPECTOR_CAPTURES_DIR', dir);
    vi.stubEnv('PROSPECTOR_BRAND_CAPTURE', 'off');
    expect(investigationEnv()).toEqual({
      capturesDir: dir,
      captureEnabled: false,
      capturesDirProblem: null,
      capturesDirSource: 'captures_dir',
    });
  });

  it('pasta de dados do programa: as capturas ficam em <dados>\\capturas', () => {
    // Barra no fim não duplica o separador.
    vi.stubEnv('PROSPECTOR_DATA_DIR', 'D:\\Prospector-dados\\');
    expect(investigationEnv()).toMatchObject({
      capturesDir: String.raw`D:\Prospector-dados\capturas`,
      capturesDirSource: 'data_dir',
    });
    // A pasta explícita das capturas vale mais que a pasta de dados.
    vi.stubEnv('PROSPECTOR_CAPTURES_DIR', String.raw`E:\imagens`);
    expect(investigationEnv()).toMatchObject({
      capturesDir: String.raw`E:\imagens`,
      capturesDirSource: 'captures_dir',
    });
  });

  it('sem variável: usa a pasta registrada pela instalação (mesmo banco do app instalado)', () => {
    writePointer({ raiz: String.raw`D:\Prospector`, dados: String.raw`D:\Prospector-dados` });
    expect(investigationEnv()).toMatchObject({
      capturesDir: String.raw`D:\Prospector-dados\capturas`,
      capturesDirSource: 'installation',
      capturesDirProblem: null,
    });
    // Dados só na memória não gravam imagens na pasta real.
    vi.stubEnv('PROSPECTOR_STORAGE', 'memory');
    expect(investigationEnv()).toMatchObject({ capturesDir: null, capturesDirSource: null });
  });

  it('registro da instalação inválido ou no disco C: é ignorado', () => {
    writePointer('não é json');
    expect(investigationEnv().capturesDir).toBeNull();
    writePointer({ dados: 42 });
    expect(investigationEnv().capturesDir).toBeNull();
    writePointer({ dados: String.raw`C:\Prospector-dados` });
    const settings = investigationEnv();
    expect(settings.capturesDir).toBeNull();
    expect(settings.capturesDirProblem).toContain('disco C:');
  });

  it('variável recusada não esconde a pasta seguinte; o motivo continua visível', () => {
    vi.stubEnv('PROSPECTOR_CAPTURES_DIR', String.raw`C:\imagens`);
    vi.stubEnv('PROSPECTOR_DATA_DIR', String.raw`D:\Prospector-dados`);
    const settings = investigationEnv();
    expect(settings.capturesDir).toBe(String.raw`D:\Prospector-dados\capturas`);
    expect(settings.capturesDirSource).toBe('data_dir');
    expect(settings.capturesDirProblem).toContain('PROSPECTOR_CAPTURES_DIR');
  });

  it.each([
    ['pasta-relativa', 'absoluto'],
    ['D:pasta-relativa', 'absoluto'],
    [String.raw`C:\Prospector\imagens`, 'disco C:'],
    [String.raw`\\servidor\imagens`, 'rede'],
    ['//servidor/imagens', 'rede'],
    [String.raw`D:\dados\..\..\Windows`, '..'],
    [String.raw`D:\OneDrive\imagens`, 'nuvem'],
    [String.raw`E:\Dropbox\Prospector`, 'nuvem'],
    [String.raw`G:\Meu Drive\imagens`, 'nuvem'],
  ])('recusa %s (%s), sem pôr o valor na mensagem', (value, reason) => {
    vi.stubEnv('PROSPECTOR_CAPTURES_DIR', value);
    const settings = investigationEnv();
    expect(settings.capturesDir).toBeNull();
    expect(settings.capturesDirProblem).toContain(reason);
    expect(settings.capturesDirProblem).not.toContain(value);
  });
});
