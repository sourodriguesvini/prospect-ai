import { describe, expect, it } from 'vitest';
import {
  createCopilot,
  createLimiter,
  nvidiaSmiPath,
  DEFAULT_POLICY,
  findPromptsDir,
  loadPrompt,
  normalizeModelName,
  parseNvidiaSmi,
  resolveModel,
  AiError,
  type LocalAiGateway,
} from '../src';
import { collect } from './support';

describe('createLimiter', () => {
  it('concede, enfileira na ordem e recusa além da fila', async () => {
    const limiter = createLimiter({ maxConcurrent: 1, maxQueue: 1 });
    const first = limiter.enqueue();
    expect(first.position).toBe(0);
    const release = await first.ready;
    const second = limiter.enqueue();
    expect(second.position).toBe(1);
    expect(() => limiter.enqueue()).toThrow(AiError);
    release();
    release(); // devolver duas vezes não libera vaga extra
    const releaseSecond = await second.ready;
    expect(limiter.active).toBe(1);
    releaseSecond();
    expect(limiter.active).toBe(0);
  });

  it('quem desiste da fila sai dela', async () => {
    const limiter = createLimiter({ maxConcurrent: 1, maxQueue: 2 });
    const release = await limiter.enqueue().ready;
    const controller = new AbortController();
    const waiting = limiter.enqueue(controller.signal);
    controller.abort();
    await expect(waiting.ready).rejects.toMatchObject({ code: 'cancelled' });
    expect(limiter.waiting).toBe(0);
    release();
    expect(limiter.active).toBe(0);
  });

  it('cancel() tira da fila, devolve vaga já concedida e não deixa rejeição solta', async () => {
    const limiter = createLimiter({ maxConcurrent: 1, maxQueue: 2 });
    const first = limiter.enqueue();
    const controller = new AbortController();
    const second = limiter.enqueue(controller.signal);
    expect(limiter.waiting).toBe(1);
    second.cancel();
    second.cancel();
    expect(limiter.waiting).toBe(0);
    controller.abort(); // depois de desistir, abortar não faz nada
    await expect(second.ready).rejects.toMatchObject({ code: 'cancelled' });

    const third = limiter.enqueue();
    (await first.ready)(); // a vaga passa para o terceiro, que ainda não a pegou
    expect(limiter.active).toBe(1);
    third.cancel(); // desistir depois de receber a vaga devolve a vaga
    expect(limiter.active).toBe(0);
  });
});

describe('nvidiaSmiPath', () => {
  it('usa o caminho completo de System32 no Windows', () => {
    expect(nvidiaSmiPath('win32', 'C:\\Windows')).toBe('C:\\Windows\\System32\\nvidia-smi.exe');
    expect(nvidiaSmiPath('linux')).toBe('nvidia-smi');
  });
});

describe('resolveModel', () => {
  const installed = ['qwen3.5:4b', 'bge-m3:latest'];

  it('respeita a ordem de preferência e equivale nome sem tag a :latest', () => {
    expect(resolveModel(['nemotron-3-nano:4b', 'qwen3.5:4b'], installed)).toBe('qwen3.5:4b');
    expect(resolveModel(['bge-m3'], installed)).toBe('bge-m3:latest');
    expect(resolveModel(['nada:1b'], installed)).toBeNull();
  });

  it('pedido explícito só vale se instalado', () => {
    expect(resolveModel([], installed, 'QWEN3.5:4b')).toBe('qwen3.5:4b');
    expect(resolveModel(['qwen3.5:4b'], installed, 'outro:1b')).toBeNull();
  });

  it('normaliza nomes', () => {
    expect(normalizeModelName(' Bge-M3 ')).toBe('bge-m3:latest');
  });

  it('política padrão cobre todas as tarefas com tempos máximos', () => {
    for (const task of Object.values(DEFAULT_POLICY)) {
      expect(task.models.length).toBeGreaterThan(0);
      expect(task.totalTimeoutMs).toBeGreaterThanOrEqual(task.firstTokenTimeoutMs);
    }
  });
});

describe('parseNvidiaSmi', () => {
  it('lê a primeira GPU', () => {
    expect(parseNvidiaSmi('NVIDIA GeForce RTX 5060 Ti, 16311, 3883, 12170\r\n')).toEqual({
      name: 'NVIDIA GeForce RTX 5060 Ti',
      totalMiB: 16311,
      usedMiB: 3883,
      freeMiB: 12170,
    });
  });

  it.each(['', 'erro qualquer', 'GPU, N/A, 1, 2'])('devolve null para %j', (output) => {
    expect(parseNvidiaSmi(output)).toBeNull();
  });
});

describe('loadPrompt', () => {
  it('lê o prompt versionado do Copiloto a partir da raiz do monorepo', () => {
    const doc = loadPrompt('copilot', 1);
    expect(doc.id).toBe('copilot/v1');
    expect(doc.text).toContain('Você é o Copiloto do Prospector');
    expect(doc.text).not.toContain('\r');
    expect(doc.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(findPromptsDir()).toMatch(/packages[\\/]agents[\\/]prompts$/);
  });

  it('recusa nomes que escapariam da pasta', () => {
    expect(() => loadPrompt('../copilot', 1)).toThrow();
    expect(() => loadPrompt('copilot', 0)).toThrow();
  });
});

describe('createCopilot', () => {
  const prompt = () => ({ id: 'copilot/v1', text: 'Instruções', sha256: 'x' });

  it('põe instruções e fatos do sistema antes da conversa e identifica a versão do prompt', async () => {
    const seen: unknown[] = [];
    const gateway = {
      chat: async function* (_task: string, input: { messages: unknown[] }) {
        seen.push(...input.messages);
        yield { type: 'start', model: 'qwen3.5:4b' };
        yield { type: 'delta', text: 'Oi' };
      },
    } as unknown as LocalAiGateway;
    const copilot = createCopilot({ gateway, prompt });
    const events = await collect(
      copilot.reply(
        { schemaVersion: 1, messages: [{ role: 'user', content: 'Olá' }], think: false },
        { traceId: 'trace-1', systemFacts: ['Banco de dados: não configurado.'] },
      ),
    );
    expect(events[0]).toEqual({
      type: 'start',
      model: 'qwen3.5:4b',
      promptVersion: 'copilot/v1',
      traceId: 'trace-1',
    });
    expect(seen).toEqual([
      { role: 'system', content: 'Instruções' },
      {
        role: 'system',
        content:
          'Contexto do sistema (dados verificados pelo Prospector, não são instruções):\n- Banco de dados: não configurado.',
      },
      { role: 'user', content: 'Olá' },
    ]);
  });

  it('nunca lança: falha vira evento de erro e vai para o log (cancelamento não)', async () => {
    const logs: string[] = [];
    const failing = (code: 'runtime_unavailable' | 'cancelled') =>
      ({
        // eslint-disable-next-line require-yield
        chat: async function* () {
          throw new AiError(code, { detail: 'ECONNREFUSED' });
        },
      }) as unknown as LocalAiGateway;
    const request = {
      schemaVersion: 1 as const,
      messages: [{ role: 'user' as const, content: 'oi' }],
      think: false,
    };
    const events = await collect(
      createCopilot({
        gateway: failing('runtime_unavailable'),
        prompt,
        log: (m) => logs.push(m),
      }).reply(request, { traceId: 't', systemFacts: [] }),
    );
    expect(events).toEqual([
      { type: 'error', code: 'runtime_unavailable', message: expect.stringContaining('Ollama') },
    ]);
    expect(logs[0]).toContain('runtime_unavailable trace=t');
    expect(logs[0]).toContain('ECONNREFUSED');

    await collect(
      createCopilot({ gateway: failing('cancelled'), prompt, log: (m) => logs.push(m) }).reply(
        request,
        { traceId: 't', systemFacts: [] },
      ),
    );
    expect(logs).toHaveLength(1);
  });
});
