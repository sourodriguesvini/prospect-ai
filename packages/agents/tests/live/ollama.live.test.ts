import type { CopilotEvent } from '@prospector/contracts';
import { beforeAll, describe, expect, it } from 'vitest';
import { createOllamaClient, DEFAULT_OLLAMA_URL } from '../../src/ollama/client';
import { createLocalAiRuntime } from '../../src/runtime';

/**
 * Contra o Ollama REAL deste computador (`pnpm ai:live`). Não usa simulação: falha se o Ollama
 * estiver fechado ou se o modelo padrão do Copiloto não estiver instalado. Custo zero; usa a GPU
 * por alguns segundos e descarrega o modelo no fim.
 */
const baseUrl = process.env.OLLAMA_BASE_URL ?? DEFAULT_OLLAMA_URL;
const client = createOllamaClient({ baseUrl });
const runtime = createLocalAiRuntime({ baseUrl, maxConcurrent: 1, maxQueue: 3 });

async function collect(events: AsyncGenerator<CopilotEvent>): Promise<CopilotEvent[]> {
  const list: CopilotEvent[] = [];
  for await (const event of events) list.push(event);
  return list;
}

describe('Ollama real', () => {
  let model: string;

  beforeAll(async () => {
    const status = await runtime.gateway.status();
    if (status.state !== 'online') throw new Error(`Ollama fora do ar: ${status.message}`);
    const resolved = status.routing.find((route) => route.task === 'copilot')?.resolved;
    if (!resolved) throw new Error('Nenhum modelo do Copiloto instalado (veja a política).');
    model = resolved;
  });

  it('responde versão, lista de modelos e estado', async () => {
    expect(await client.version()).toMatch(/^\d+\.\d+/);
    const installed = await client.listModels();
    expect(installed.map((entry) => entry.name)).toContain(model);
    const status = await runtime.gateway.status();
    expect(status.state).toBe('online');
  });

  it('gera uma resposta real em português pelo Copiloto, com métricas', async () => {
    const events = await collect(
      runtime.copilot.reply(
        {
          schemaVersion: 1,
          think: false,
          messages: [
            { role: 'user', content: 'Diga em uma frase curta para que serve o Prospector.' },
          ],
        },
        {
          traceId: 'live-test',
          systemFacts: ['Hoje é segunda-feira, 9 de novembro de 2026 (horário de Brasília).'],
        },
      ),
    );
    const errors = events.filter((event) => event.type === 'error');
    expect(errors).toEqual([]);
    expect(events[0]).toMatchObject({ type: 'start', model, promptVersion: 'copilot/v1' });
    const text = events
      .filter((event) => event.type === 'delta')
      .map((event) => event.text)
      .join('');
    expect(text.trim().length).toBeGreaterThan(10);
    const done = events.at(-1);
    expect(done?.type).toBe('done');
    if (done?.type === 'done') {
      expect(done.usage.outputTokens).toBeGreaterThan(0);
      expect(done.usage.totalMs).toBeGreaterThan(0);
    }
    console.info(`[ai:live] ${model}: ${text.trim()}`);
  });

  it('modelo inexistente vira erro tratado, sem exceção', async () => {
    const events = await collect(
      runtime.copilot.reply(
        {
          schemaVersion: 1,
          think: false,
          model: 'modelo-que-nao-existe:1b',
          messages: [{ role: 'user', content: 'oi' }],
        },
        { traceId: 'live-test-404', systemFacts: [] },
      ),
    );
    expect(events).toEqual([
      expect.objectContaining({ type: 'error', code: 'model_not_installed' }),
    ]);
  });

  it('descarrega o modelo e libera a memória', async () => {
    await runtime.gateway.unload(model);
    const running = await client.listRunning();
    expect(running.map((entry) => entry.name)).not.toContain(model);
  });
});

describe('Ollama fora do ar', () => {
  it('endereço sem servidor vira estado offline com mensagem em pt-BR', async () => {
    const offline = createLocalAiRuntime({
      baseUrl: 'http://127.0.0.1:9',
      maxConcurrent: 1,
      maxQueue: 0,
    });
    const status = await offline.gateway.status();
    expect(status).toMatchObject({ state: 'offline' });
    const events = await collect(
      offline.copilot.reply(
        { schemaVersion: 1, think: false, messages: [{ role: 'user', content: 'oi' }] },
        { traceId: 'live-offline', systemFacts: [] },
      ),
    );
    expect(events).toEqual([
      expect.objectContaining({ type: 'error', code: 'runtime_unavailable' }),
    ]);
  });
});
