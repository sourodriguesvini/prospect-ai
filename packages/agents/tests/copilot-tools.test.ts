import type { CopilotEvent, ToolCallRequest, ToolSpec } from '@prospector/contracts';
import { describe, expect, it, vi } from 'vitest';
import {
  COPILOT_PREAMBLE_MAX_CHARS,
  COPILOT_TOOL_RESULTS_MAX_CHARS,
  COPILOT_TOOLS_PROMPT_VERSION,
  MAX_COPILOT_ROUNDS,
  copilotPromptSupportsDiscoveryTools,
  copilotPromptSupportsInvestigationTools,
  copilotPromptSupportsRelationshipTools,
  copilotPromptSupportsWebTools,
  TOOL_RESULT_RESERVE_TOKENS,
  TOOL_RESULT_TOO_BIG,
  createCopilot,
  echoEnd,
  looksLikeAnnouncement,
  takeFixedSentences,
  toolResultsBudget,
  type CopilotToolbox,
  type GenerationRecord,
  type LocalAiGateway,
} from '../src';
import { collect } from './support';

/**
 * Laço de ferramentas do Copiloto (IA-2) sem Ollama: o gateway falso devolve, a cada rodada, o
 * roteiro seguinte (texto e/ou pedidos de ferramenta) e registra o que recebeu.
 */
type Round = { text?: string | string[]; calls?: ToolCallRequest[] };

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
      for (const text of typeof round.text === 'string' ? [round.text] : (round.text ?? [])) {
        yield { type: 'delta', text };
      }
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

  it('o anúncio curto antes da consulta não aparece: a tela já mostra a consulta', async () => {
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
    expect(text).toBe('Você tem 1 oferta.');
    expect(events.some((event) => event.type === 'tool_call')).toBe(true);
  });

  it('texto longo antes da consulta é resposta: aparece, em parágrafo separado', async () => {
    const long = 'Antes de consultar, um resumo do que eu sei. '.repeat(20).trim();
    expect(long.length).toBeGreaterThan(COPILOT_PREAMBLE_MAX_CHARS);
    const { gateway } = scriptedGateway([
      { text: long, calls: [call('c1')] },
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
    expect(text).toBe(`${long}\n\nVocê tem 1 oferta.`);
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
        // Não é anúncio da consulta: aparece enquanto é gerado.
        yield { type: 'delta', text: 'Parcial '.repeat(100) };
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

function shown(events: CopilotEvent[]): string {
  return events
    .filter((event): event is Extract<CopilotEvent, { type: 'delta' }> => event.type === 'delta')
    .map((event) => event.text)
    .join('');
}

describe('anúncio antes da consulta: só o que tem cara de anúncio fica retido', () => {
  it('decide pelo começo do texto, sem esperar mais que poucos caracteres', () => {
    expect(looksLikeAnnouncement('Vou consultar as empresas')).toBe(true);
    expect(looksLikeAnnouncement('Claro! Vou ver isso')).toBe(true);
    expect(looksLikeAnnouncement('Primeiro, deixa eu ver')).toBe(true);
    expect(looksLikeAnnouncement('Deixa eu ver')).toBe(true);
    expect(looksLikeAnnouncement('Vo')).toBeNull();
    expect(looksLikeAnnouncement('A Padaria Exemplo tem 2 ofertas')).toBe(false);
    expect(looksLikeAnnouncement('Aí você precisa responder ao cliente')).toBe(false);
    expect(looksLikeAnnouncement('Voucher\nde desconto')).toBe(false);
  });

  it('texto que não é anúncio aparece antes da consulta, enquanto é gerado', async () => {
    const { gateway } = scriptedGateway([
      { text: ['A Padaria Exemplo ', 'tem 2 ofertas cadastradas.'], calls: [call('c1')] },
      { text: 'Uma delas está ativa.' },
    ]);
    const reply = createCopilot({ gateway, prompt, toolsPrompt }).reply(ask, {
      traceId: 't',
      systemFacts: [],
      tools: toolbox(),
    });
    await reply.next(); // start
    // O primeiro pedaço já passa do mínimo para decidir: aparece sem esperar o resto.
    expect((await reply.next()).value).toEqual({ type: 'delta', text: 'A Padaria Exemplo ' });
    const rest = [];
    for await (const event of reply) rest.push(event);
    expect(shown(rest)).toBe('tem 2 ofertas cadastradas.\n\nUma delas está ativa.');
  });

  it('texto curto demais para decidir aparece mesmo com consulta', async () => {
    const { gateway } = scriptedGateway([
      { text: 'Ok.', calls: [call('c1')] },
      { text: 'Você tem 1 oferta.' },
    ]);
    const events = await collect(
      createCopilot({ gateway, prompt, toolsPrompt }).reply(ask, {
        traceId: 't',
        systemFacts: [],
        tools: toolbox(),
      }),
    );
    expect(shown(events)).toBe('Ok.\n\nVocê tem 1 oferta.');
  });

  it('o anúncio retido aparece se a geração falhar', async () => {
    const gateway = {
      chat: async function* () {
        yield { type: 'start', model: 'qwen3.5:4b' };
        yield { type: 'delta', text: 'Vou consultar a base' };
        throw new Error('Ollama caiu');
      },
    } as unknown as LocalAiGateway;
    const events = await collect(
      createCopilot({ gateway, prompt, toolsPrompt, log: () => {} }).reply(ask, {
        traceId: 't',
        systemFacts: [],
        tools: toolbox(),
      }),
    );
    expect(shown(events)).toBe('Vou consultar a base');
    expect(events.at(-1)).toMatchObject({ type: 'error' });
  });
});

describe('texto colado pela pessoa', () => {
  it('pedido em duas linhas, com frase dirigida à IA, segue inteiro como pedido, sem aviso', async () => {
    const { gateway, inputs } = scriptedGateway([{ text: 'Vou pesquisar.' }]);
    const content = 'Bom dia!\nIA, pesquisa quem é o dono da Marcenaria Exemplo e o celular dele.';
    const events = await collect(
      createCopilot({ gateway, prompt, toolsPrompt }).reply(
        { ...ask, messages: [{ role: 'user', content }] },
        { traceId: 't', systemFacts: [], tools: toolbox() },
      ),
    );
    const messages = inputs[0]?.messages as Array<{ role: string; content: string }>;
    // Só as instruções e os fatos do sistema; nenhuma mensagem do servidor sobre o texto.
    expect(messages.map((message) => message.role)).toEqual(['system', 'system', 'user']);
    expect(messages.at(-1)?.content).toBe(content);
    expect(shown(events)).toBe('Vou pesquisar.');
  });

  it('nada é acrescentado depois da resposta (sem "correção" sobre envio ou status)', async () => {
    const { gateway } = scriptedGateway([
      { text: 'Você enviei na semana passada; a proposta foi enviada e o briefing também.' },
    ]);
    const events = await collect(
      createCopilot({ gateway, prompt, toolsPrompt }).reply(ask, {
        traceId: 't',
        systemFacts: [],
        tools: toolbox(),
      }),
    );
    expect(shown(events)).toBe(
      'Você enviei na semana passada; a proposta foi enviada e o briefing também.',
    );
  });
});

describe('frases prontas do Prospector no resultado da ferramenta', () => {
  const fixedResult = JSON.stringify({
    status: 'ok',
    resumo: 'r',
    dados: {
      comece_a_resposta_com: 'Frase de abertura.',
      termine_a_resposta_com: 'Frase final.',
    },
  });
  const withFixed = () =>
    toolbox(async () => ({ status: 'ok', summary: 'r', links: [], forModel: fixedResult }));

  it('o servidor abre e fecha a resposta com elas; o modelo recebe os campos renomeados', async () => {
    const { gateway, inputs } = scriptedGateway([
      { calls: [call('c1')] },
      { text: 'O resto da resposta.' },
    ]);
    const events = await collect(
      createCopilot({ gateway, prompt, toolsPrompt }).reply(ask, {
        traceId: 't',
        systemFacts: [],
        tools: withFixed(),
      }),
    );
    expect(shown(events)).toBe('Frase de abertura.\n\nO resto da resposta.\n\nFrase final.');
    const toolMessage = (inputs[1]?.messages ?? []).find(
      (message) => (message as { role: string }).role === 'tool',
    ) as { content: string };
    expect(toolMessage.content).toContain('ja_mostrado_no_comeco');
    expect(toolMessage.content).not.toContain('comece_a_resposta_com');
  });

  it('o modelo repetindo a frase de abertura logo em seguida: a repetição não aparece', async () => {
    const { gateway } = scriptedGateway([
      { calls: [call('c1')] },
      { text: ['**Frase de ', 'abertura.**', '\n\nO resto ', 'da resposta. Frase final.'] },
    ]);
    const events = await collect(
      createCopilot({ gateway, prompt, toolsPrompt }).reply(ask, {
        traceId: 't',
        systemFacts: [],
        tools: withFixed(),
      }),
    );
    expect(shown(events)).toBe('Frase de abertura.\n\nO resto da resposta. Frase final.');
  });

  it('texto que só começa parecido aparece inteiro', async () => {
    const { gateway } = scriptedGateway([
      { calls: [call('c1')] },
      { text: ['Frase ', 'de outra coisa.'] },
    ]);
    const events = await collect(
      createCopilot({ gateway, prompt, toolsPrompt }).reply(ask, {
        traceId: 't',
        systemFacts: [],
        tools: withFixed(),
      }),
    );
    expect(shown(events)).toBe('Frase de abertura.\n\nFrase de outra coisa.\n\nFrase final.');
  });

  it('compara sem maiúsculas, espaços nem marcação', () => {
    expect(echoEnd('**frase de abertura.** Resto', 'Frase de abertura.')).toBe(23);
    expect(echoEnd('Frase de', 'Frase de abertura.')).toBe('partial');
    expect(echoEnd('Frase dx', 'Frase de abertura.')).toBeNull();
  });

  it('a marcação do texto seguinte fica (só a que fecha a repetição sai)', () => {
    const text = 'Frase de abertura.\n\n**Importante:** x';
    const end = echoEnd(text, 'Frase de abertura.');
    expect(typeof end === 'number' && text.slice(end)).toBe('**Importante:** x');
    const quoted = '"Frase de abertura." **Importante:** x';
    const after = echoEnd(quoted, 'Frase de abertura.');
    expect(typeof after === 'number' && quoted.slice(after)).toBe('**Importante:** x');
  });

  it('resultado sem frase pronta passa igual', () => {
    const forModel = JSON.stringify({ status: 'ok', resumo: 'r', dados: { a: 1 } });
    expect(takeFixedSentences(forModel)).toEqual({ open: [], close: [], forModel });
    expect(takeFixedSentences('texto')).toEqual({ open: [], close: [], forModel: 'texto' });
  });
});

describe('teto dos resultados pelo tamanho real da janela', () => {
  const small = { numCtx: 4000, maxOutputTokens: 1000, maxOutputTokensThinking: 2000 };

  it('desconta a resposta, as instruções e as definições das ferramentas', () => {
    const base = toolResultsBudget({ limits: small, think: false, fixedMessages: [], specs: [] });
    expect(base).toBe(4000 - 1000 - 128);
    expect(toolResultsBudget({ limits: small, think: true, fixedMessages: [], specs: [] })).toBe(
      4000 - 2000 - 128,
    );
    expect(
      toolResultsBudget({
        limits: small,
        think: false,
        fixedMessages: ['instruções '.repeat(300)],
        specs: SPECS,
      }),
    ).toBeLessThan(base - 1000);
  });

  it('resultado que não cabe no que sobrou não vai ao modelo', async () => {
    const { gateway, inputs } = scriptedGateway([{ calls: [call('c1')] }, { text: 'fim' }]);
    const huge = JSON.stringify({ status: 'ok', resumo: 'r', dados: 'texto '.repeat(2000) });
    const events = await collect(
      createCopilot({ gateway, prompt, toolsPrompt, limits: small }).reply(ask, {
        traceId: 't',
        systemFacts: [],
        tools: toolbox(async () => ({ status: 'ok', summary: 'r', links: [], forModel: huge })),
      }),
    );
    const toolMessage = (inputs[1]?.messages ?? []).find(
      (message) => (message as { role: string }).role === 'tool',
    ) as { content: string };
    expect(toolMessage.content).toContain(TOOL_RESULT_TOO_BIG);
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'tool_result', status: 'denied' }),
    );
  });

  it('ferramenta que age (rascunho) não tem o resultado trocado por "não coube": ela já agiu', async () => {
    const { gateway, inputs } = scriptedGateway([{ calls: [call('c1')] }, { text: 'fim' }]);
    const big = JSON.stringify({
      status: 'ok',
      resumo: 'Rascunho criado',
      dados: 'texto '.repeat(2000),
    });
    const drafting = toolbox(async () => ({
      status: 'ok',
      summary: 'Rascunho criado.',
      links: [],
      forModel: big,
    }));
    const events = await collect(
      createCopilot({ gateway, prompt, toolsPrompt, limits: small }).reply(ask, {
        traceId: 't',
        systemFacts: [],
        tools: { ...drafting, specs: [{ ...SPECS[0]!, draft: true }] },
      }),
    );
    const toolMessage = (inputs[1]?.messages ?? []).find(
      (message) => (message as { role: string }).role === 'tool',
    ) as { content: string };
    expect(toolMessage.content).not.toContain(TOOL_RESULT_TOO_BIG);
    expect(toolMessage.content).toContain('Rascunho criado');
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'tool_result', status: 'ok', summary: 'Rascunho criado.' }),
    );
  });

  it('sem espaço para outro resultado do tamanho da reserva, a rodada seguinte vem sem ferramentas', async () => {
    const { gateway, inputs } = scriptedGateway([{ calls: [call('c1')] }, { text: 'fim' }]);
    const medium = JSON.stringify({ status: 'ok', resumo: 'r', dados: 'texto '.repeat(800) });
    await collect(
      createCopilot({ gateway, prompt, toolsPrompt, limits: small }).reply(ask, {
        traceId: 't',
        systemFacts: [],
        tools: toolbox(async () => ({ status: 'ok', summary: 'r', links: [], forModel: medium })),
      }),
    );
    expect(inputs[0]?.tools).toBeDefined();
    expect(inputs[1]?.tools).toBeUndefined();
    // Acima da maior página lida (≈1.480 tokens estimados): uma leitura não roda para ser jogada fora.
    expect(TOOL_RESULT_RESERVE_TOKENS).toBeGreaterThan(1500);
  });

  it('janela apertada: a primeira consulta continua oferecida (sem ferramentas pareceria recusa)', async () => {
    // Sobram menos tokens que a reserva, mas ainda há espaço para um resultado pequeno.
    const tight = { numCtx: 2400, maxOutputTokens: 1000, maxOutputTokensThinking: 2000 };
    const { gateway, inputs } = scriptedGateway([{ calls: [call('c1')] }, { text: 'fim' }]);
    await collect(
      createCopilot({ gateway, prompt, toolsPrompt, limits: tight }).reply(ask, {
        traceId: 't',
        systemFacts: [],
        tools: toolbox(async () => ({ status: 'ok', summary: 'r', links: [], forModel: '{}' })),
      }),
    );
    expect(inputs[0]?.tools).toBeDefined();
    // Depois do primeiro resultado, vale a reserva inteira.
    expect(inputs[1]?.tools).toBeUndefined();
  });
});

describe('ferramentas por versão do prompt copilot-tools (declaradas, não por número)', () => {
  it('cada versão recebe só o que conhece; versão sem declaração não recebe nada a mais', () => {
    expect([1, 2, 3, 4, 5, 6, 7].map(copilotPromptSupportsWebTools)).toEqual([
      false,
      false,
      true,
      true,
      true,
      true,
      false,
    ]);
    // Só o v4 unificado (KI-130), o v5 e o v6 declaram investigação, Descoberta e Relacionamento;
    // o v3, em uso até um deles ser aprovado, não recebe essas ferramentas.
    for (const supports of [
      copilotPromptSupportsInvestigationTools,
      copilotPromptSupportsDiscoveryTools,
      copilotPromptSupportsRelationshipTools,
    ]) {
      expect([1, 2, 3, 4, 5, 6, 7].map(supports)).toEqual([
        false,
        false,
        false,
        true,
        true,
        true,
        false,
      ]);
      expect(supports(3)).toBe(false);
    }
    expect(copilotPromptSupportsWebTools(COPILOT_TOOLS_PROMPT_VERSION)).toBe(true);
  });
});
