import type { CopilotEvent, ToolCallRequest, ToolSpec } from '@prospector/contracts';
import { describe, expect, it, vi } from 'vitest';
import {
  COPILOT_TOOL_RESULTS_MAX_CHARS,
  MAX_COPILOT_ROUNDS,
  createCopilot,
  type CopilotToolbox,
  type GenerationRecord,
  type LocalAiGateway,
} from '../src';
import { collect } from './support';

/**
 * Laço de ferramentas do Copiloto (IA-2) sem Ollama: o gateway falso devolve, a cada rodada, o
 * roteiro seguinte (texto e/ou pedidos de ferramenta) e registra o que recebeu.
 */
type Round = { text?: string; calls?: ToolCallRequest[] };

const USAGE = {
  inputTokens: 100,
  outputTokens: 10,
  totalMs: 1000,
  loadMs: 0,
  outputTokensPerSecond: 10,
};

function scriptedGateway(rounds: Round[]) {
  const inputs: Array<{ messages: unknown[]; tools?: readonly ToolSpec[] }> = [];
  const gateway = {
    chat: async function* (
      _task: string,
      input: { messages: unknown[]; tools?: readonly ToolSpec[] },
    ) {
      // Cópia: o Copiloto acrescenta mensagens à mesma lista depois da rodada.
      inputs.push({ messages: [...input.messages], tools: input.tools });
      const round = rounds[inputs.length - 1] ?? { text: 'fim' };
      yield { type: 'start', model: 'qwen3.5:4b' };
      if (round.text) yield { type: 'delta', text: round.text };
      if (round.calls?.length) yield { type: 'tool_calls', calls: round.calls };
      yield { type: 'done', model: 'qwen3.5:4b', doneReason: 'stop', usage: USAGE };
    },
  } as unknown as LocalAiGateway;
  return { gateway, inputs };
}

const SPECS: ToolSpec[] = [
  {
    name: 'list_offers',
    title: 'Consultando ofertas',
    description: 'Lista as ofertas.',
    parameters: { type: 'object', properties: {} },
  },
];

function toolbox(execute?: CopilotToolbox['execute']): CopilotToolbox & {
  execute: ReturnType<typeof vi.fn>;
} {
  return {
    specs: SPECS,
    execute: vi.fn(
      execute ??
        (async () => ({
          status: 'ok' as const,
          summary: '1 oferta: 1 ativa.',
          links: [{ label: 'Branding', href: '/configuracoes/estrategia/ofertas/x' }],
          forModel: '{"status":"ok","resumo":"1 oferta"}',
        })),
    ),
  };
}

const prompt = () => ({ id: 'copilot/v3', text: 'Sem ferramentas', sha256: 'a' });
const toolsPrompt = () => ({ id: 'copilot-tools/v1', text: 'Com ferramentas', sha256: 'b' });
const ask = {
  schemaVersion: 1 as const,
  messages: [{ role: 'user' as const, content: 'Quais ofertas eu tenho?' }],
  think: false,
};
const call = (id: string, args: Record<string, unknown> = {}): ToolCallRequest => ({
  id,
  name: 'list_offers',
  arguments: args,
});

describe('Copiloto com ferramentas', () => {
  it('executa a consulta pedida, devolve o resultado ao modelo e só então responde', async () => {
    const { gateway, inputs } = scriptedGateway([
      { calls: [call('c1')] },
      { text: 'Você tem 1 oferta ativa.' },
    ]);
    const tools = toolbox();
    const generations: GenerationRecord[] = [];
    const events = await collect(
      createCopilot({ gateway, prompt, toolsPrompt }).reply(ask, {
        traceId: 't',
        systemFacts: [],
        tools,
        onGeneration: (record) => generations.push(record),
      }),
    );

    expect(events.map((event) => event.type)).toEqual([
      'start',
      'tool_call',
      'tool_result',
      'delta',
      'done',
    ]);
    expect(events[0]).toMatchObject({ promptVersion: 'copilot-tools/v1' });
    expect(events[1]).toEqual({
      type: 'tool_call',
      id: 'c1',
      name: 'list_offers',
      title: 'Consultando ofertas',
    });
    expect(events[2]).toMatchObject({
      type: 'tool_result',
      status: 'ok',
      links: [{ label: 'Branding' }],
    });
    expect(tools.execute).toHaveBeenCalledTimes(1);

    // A primeira rodada recebe as ferramentas e o prompt com ferramentas.
    expect(inputs[0]?.tools).toEqual(SPECS);
    expect(inputs[0]?.messages[0]).toEqual({ role: 'system', content: 'Com ferramentas' });
    // A segunda recebe o pedido do modelo e o resultado, nessa ordem.
    expect(inputs[1]?.messages.slice(-2)).toEqual([
      { role: 'assistant', content: '', toolCalls: [call('c1')] },
      {
        role: 'tool',
        content: '{"status":"ok","resumo":"1 oferta"}',
        toolName: 'list_offers',
        toolCallId: 'c1',
      },
    ]);
    // Telemetria: uma linha por geração; o "done" final soma as duas.
    expect(generations.map((g) => [g.round, g.status])).toEqual([
      [1, 'ok'],
      [2, 'ok'],
    ]);
    expect(events.at(-1)).toMatchObject({
      type: 'done',
      usage: { outputTokens: 20, totalMs: 2000 },
    });
  });

  it('sem o prompt com ferramentas, não oferece ferramentas (v3 diz que não há)', async () => {
    const { gateway, inputs } = scriptedGateway([{ text: 'Não consigo consultar.' }]);
    const tools = toolbox();
    const events = await collect(
      createCopilot({ gateway, prompt }).reply(ask, { traceId: 't', systemFacts: [], tools }),
    );
    expect(events[0]).toMatchObject({ promptVersion: 'copilot/v3' });
    expect(inputs[0]?.tools).toBeUndefined();
    expect(tools.execute).not.toHaveBeenCalled();
  });

  it('a mesma consulta duas vezes na pergunta reaproveita o resultado', async () => {
    const { gateway } = scriptedGateway([
      { calls: [call('c1', { status: 'active' })] },
      { calls: [call('c2', { status: 'active' })] },
      { text: 'Pronto.' },
    ]);
    const tools = toolbox();
    const events = await collect(
      createCopilot({ gateway, prompt, toolsPrompt }).reply(ask, {
        traceId: 't',
        systemFacts: [],
        tools,
      }),
    );
    expect(tools.execute).toHaveBeenCalledTimes(1);
    const results = events.filter((event) => event.type === 'tool_result');
    expect(results[1]).toMatchObject({
      status: 'ok',
      summary: expect.stringContaining('reaproveitado'),
    });
  });

  it('a última rodada é sem ferramentas: o modelo precisa responder', async () => {
    const asksForever = Array.from({ length: MAX_COPILOT_ROUNDS }, (_, index) => ({
      calls: [call(`c${index}`, { page: index })],
    }));
    const { gateway, inputs } = scriptedGateway(asksForever);
    const tools = toolbox();
    await collect(
      createCopilot({ gateway, prompt, toolsPrompt }).reply(ask, {
        traceId: 't',
        systemFacts: [],
        tools,
      }),
    );
    expect(inputs).toHaveLength(MAX_COPILOT_ROUNDS);
    expect(inputs.at(-1)?.tools).toBeUndefined();
    expect(tools.execute).toHaveBeenCalledTimes(MAX_COPILOT_ROUNDS - 1);
  });

  it('resultados que enchem o teto de texto: a rodada seguinte vem sem ferramentas', async () => {
    const asksForever = Array.from({ length: MAX_COPILOT_ROUNDS }, (_, index) => ({
      calls: [call(`c${index}`, { page: index })],
    }));
    const { gateway, inputs } = scriptedGateway(asksForever);
    const tools = toolbox(async () => ({
      status: 'ok' as const,
      summary: 'Página lida.',
      links: [],
      forModel: 'x'.repeat(COPILOT_TOOL_RESULTS_MAX_CHARS / 2),
    }));
    await collect(
      createCopilot({ gateway, prompt, toolsPrompt }).reply(ask, {
        traceId: 't',
        systemFacts: [],
        tools,
      }),
    );
    // Duas leituras grandes enchem o teto: a terceira geração precisa responder com o que tem.
    expect(tools.execute).toHaveBeenCalledTimes(2);
    expect(inputs).toHaveLength(3);
    expect(inputs.at(-1)?.tools).toBeUndefined();
  });

  it('quatro leituras grandes na mesma rodada: as que passam do teto não rodam', async () => {
    const { gateway, inputs } = scriptedGateway([
      { calls: [1, 2, 3, 4].map((page) => call(`c${page}`, { page })) },
      { text: 'Resumo com o que veio.' },
    ]);
    const tools = toolbox(async () => ({
      status: 'ok' as const,
      summary: 'Página lida.',
      links: [],
      forModel: 'x'.repeat(8_000),
    }));
    const events = await collect(
      createCopilot({ gateway, prompt, toolsPrompt }).reply(ask, {
        traceId: 't',
        systemFacts: [],
        tools,
      }),
    );
    // 8 mil + 8 mil ficam abaixo do teto e a terceira roda; com 24 mil, a quarta não roda.
    expect(tools.execute).toHaveBeenCalledTimes(3);
    const results = events.filter((event) => event.type === 'tool_result');
    expect(results).toHaveLength(4);
    expect(results[3]).toMatchObject({ status: 'denied' });
    expect(inputs).toHaveLength(2);
    expect(inputs.at(-1)?.tools).toBeUndefined();
  });

  it('ids repetidos entre rodadas viram ids únicos', async () => {
    const { gateway, inputs } = scriptedGateway([
      { calls: [call('call_0', { a: 1 })] },
      { calls: [call('call_0', { a: 2 })] },
      { text: 'ok' },
    ]);
    const events = await collect(
      createCopilot({ gateway, prompt, toolsPrompt }).reply(ask, {
        traceId: 't',
        systemFacts: [],
        tools: toolbox(),
      }),
    );
    const ids = events
      .filter(
        (event): event is Extract<CopilotEvent, { type: 'tool_call' }> =>
          event.type === 'tool_call',
      )
      .map((event) => event.id);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
    const toolMessages = (inputs[2]?.messages ?? []).filter(
      (message) => (message as { role: string }).role === 'tool',
    );
    expect(toolMessages.map((message) => (message as { toolCallId: string }).toolCallId)).toEqual(
      ids,
    );
  });

  it('texto antes da consulta e a resposta depois ficam em parágrafos separados', async () => {
    const { gateway } = scriptedGateway([
      { text: 'Vou consultar.', calls: [call('c1')] },
      { text: 'Você tem 1 oferta.' },
    ]);
    const events = await collect(
      createCopilot({ gateway, prompt, toolsPrompt }).reply(ask, {
        traceId: 't',
        systemFacts: [],
        tools: toolbox(),
      }),
    );
    const text = events
      .filter((event): event is Extract<CopilotEvent, { type: 'delta' }> => event.type === 'delta')
      .map((event) => event.text)
      .join('');
    expect(text).toBe('Vou consultar.\n\nVocê tem 1 oferta.');
  });

  it('o texto escrito antes da consulta não volta ao modelo na rodada seguinte', async () => {
    const { gateway, inputs } = scriptedGateway([
      { text: 'Vou consultar.', calls: [call('c1')] },
      { text: 'Você tem 1 oferta.' },
    ]);
    await collect(
      createCopilot({ gateway, prompt, toolsPrompt }).reply(ask, {
        traceId: 't',
        systemFacts: [],
        tools: toolbox(),
      }),
    );
    const assistantTurns = (inputs[1]?.messages ?? []).filter(
      (message) => (message as { role: string }).role === 'assistant',
    ) as Array<{ content: string; toolCalls?: unknown[] }>;
    const last = assistantTurns.at(-1);
    expect(last?.content).toBe('');
    expect(last?.toolCalls).toHaveLength(1);
  });

  it('fechar a resposta no meio da geração registra a rodada como cancelada', async () => {
    const gateway = {
      chat: async function* () {
        yield { type: 'start', model: 'qwen3.5:4b' };
        yield { type: 'delta', text: 'Parcial' };
        await new Promise(() => {}); // o modelo continua escrevendo
      },
    } as unknown as LocalAiGateway;
    const generations: GenerationRecord[] = [];
    const reply = createCopilot({ gateway, prompt, toolsPrompt }).reply(ask, {
      traceId: 't',
      systemFacts: [],
      tools: toolbox(),
      onGeneration: (record) => generations.push(record),
    });
    await reply.next(); // start
    await reply.next(); // delta
    await reply.return(undefined);
    expect(generations).toEqual([
      expect.objectContaining({ model: 'qwen3.5:4b', status: 'cancelled', errorCode: 'cancelled' }),
    ]);
  });

  it('telemetria que lança não derruba a resposta', async () => {
    const { gateway } = scriptedGateway([{ text: 'Oi' }]);
    const logs: string[] = [];
    const events = await collect(
      createCopilot({ gateway, prompt, log: (message) => logs.push(message) }).reply(ask, {
        traceId: 't',
        systemFacts: [],
        onGeneration: () => {
          throw new Error('banco fora');
        },
      }),
    );
    expect(events.at(-1)).toMatchObject({ type: 'done' });
    expect(logs[0]).toContain('telemetria falhou');
  });
});
