import { describe, expect, it } from 'vitest';
import {
  COPILOT_PROMPT_VERSION,
  createCopilot,
  createLimiter,
  nvidiaSmiPath,
  DEFAULT_POLICY,
  findPromptsDir,
  loadPrompt,
  normalizeModelName,
  parseNvidiaSmi,
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

describe('normalizeModelName', () => {
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

  /**
   * Versão de prompt usada numa avaliação não pode mudar (skill capacidade-ia): o sha de cada
   * uma fica fixado aqui e nos resultados em `evals/copilot/results`. Mudou o texto? Crie v<N+1>.
   */
  it.each([
    [1, '7b9071c2a216c7a9977230194965ea79d889fab6bef61fba554eb3bd2f795660'],
    [2, '732c5282714ab3fb33de0c528d2c9cf8d2e2dd4bb906a235a26b97918cadbd14'],
    [3, 'bc898da8aa8f5da96050cdec4055f0dd17c66629e3c7484d46a98b3809f00474'],
  ])('copilot/v%i não foi editado depois de avaliado', (version, sha256) => {
    expect(loadPrompt('copilot', version).sha256).toBe(sha256);
  });

  /** Descoberta (M3): sha dos resultados em `evals/discovery`. */
  it.each([
    [
      'discovery-interpreter',
      1,
      '1b53a1c07c115fafc75e6ae20503ea60145a579b5390c8a1f57a4ad97cf3b44b',
    ],
    ['discovery-extractor', 1, '306cf77b8496089317996b0a89a4ad79a02eda7f72fd069af52db0d8fe4054f6'],
    ['discovery-extractor', 2, 'c57fdde2337c8e8984d56990c7f68167b75766d14f77e4903e73f7f75b5e00b3'],
    // Rodadas de 2026-11-25 (KI-148, KI-151, KI-152): sha nos resultados de cada `evals/<agente>`.
    [
      'discovery-interpreter',
      2,
      '49d3f4f2486635f4648314b042f54f8ece1368cc777f6050481990d4d96190d6',
    ],
    [
      'discovery-interpreter',
      3,
      '516bb3a3e04d3a763abc4cfb8a232d909a71adf9eb477bc71c4b5a9689a2fe67',
    ],
    [
      'discovery-interpreter',
      4,
      '0550684ab5b4c396358ae2c193733c3f28ff878d0955be3768f3efd3cdcf7629',
    ],
    ['discovery-extractor', 4, '96d67df244fbd012cd664c33b384b6312002ca48af52dafb9599f1acfe0d5f2e'],
    ['copilot-tools', 4, '2034d532055446e8eb71ad1e55671d2063095b6549f9238cec5c64db75023465'],
    ['copilot-tools', 5, '7809be5ffc5d2b788b052d3e858e2180702ddb0a36bd19659009042cc52453e5'],
    ['copilot-tools', 6, '1ef841d6887647fae606f13d6d4d1d437d66b896d2fa01ef7a17c7580806d040'],
    ['company-business', 2, 'b4bfa8fee5a142ef71683daae46df2dc4aaed9384fbec55b65a26582d0f6e269'],
    ['company-business', 3, '05a018b1bdf52b352e41e2da6ea31a6246660a95bcbd5b93f8f7577470b1c4a0'],
    ['brand-visual', 2, '0baa70ae5541881d032f185b86f0f2f7ee8f868baae2ebbf6235b52e5efb11c5'],
    ['brand-visual', 3, 'a79b23e90c4dda42dbd9a4e555297ad361761423563ad5d7fb9c714e6c6ea4b5'],
    ['competitor-triage', 2, '6061ce97bad99d9e85c61844ade45826a0066ec9be481f722ebe9fb7592751ba'],
    ['competitor-triage', 3, 'fc5a9fd17e3b2613bfaafcd44654b0667fefe9817500c29de97bb233929644e3'],
    ['diagnosis', 2, 'c8f5c1f4ac6a037c6ee0288966bc447b3c2c1ec2088890d6216ca4823fe1de20'],
    ['diagnosis', 3, 'f227449a1aa594d31c522eee837b1906632575f8d2c3b060d43cd9732fb3835e'],
  ])('%s/v%i não foi editado depois de avaliado', (agent, version, sha256) => {
    expect(loadPrompt(agent, version).sha256).toBe(sha256);
  });

  it('a versão em uso pelo Copiloto existe', () => {
    expect(loadPrompt('copilot', COPILOT_PROMPT_VERSION).id).toBe(
      `copilot/v${COPILOT_PROMPT_VERSION}`,
    );
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
