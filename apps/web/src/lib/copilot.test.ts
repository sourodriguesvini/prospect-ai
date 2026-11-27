import { formatMiBAsGB, type GenerationUsage, type LocalModel } from '@prospector/contracts';
import { describe, expect, it } from 'vitest';
import {
  applyEvent,
  chatModelOptions,
  describeCapabilities,
  createEventDecoder,
  describeExpiry,
  describeUsage,
  formatGigabytes,
  formatMebibytesAsGigabytes,
  httpFailure,
  modelsWithoutThinking,
  turnsFromMessages,
  type Turn,
} from './copilot';

const turn = (role: Turn['role'], content: string, id = crypto.randomUUID()): Turn => ({
  id,
  role,
  content,
});

describe('createEventDecoder', () => {
  it('junta linhas partidas entre pedaços', () => {
    const decoder = createEventDecoder();
    expect(decoder.push('{"type":"delta","te')).toEqual([]);
    expect(decoder.push('xt":"Olá"}\n{"type":"delta","text":"!"}\n')).toEqual([
      { type: 'delta', text: 'Olá' },
      { type: 'delta', text: '!' },
    ]);
    expect(decoder.flush()).toEqual([]);
  });

  it('entrega a última linha sem quebra no flush', () => {
    const decoder = createEventDecoder();
    decoder.push('{"type":"queued","position":2}');
    expect(decoder.flush()).toEqual([{ type: 'queued', position: 2 }]);
  });

  it('transforma linha inválida em erro visível', () => {
    const decoder = createEventDecoder();
    const [event] = decoder.push('isto não é json\n');
    expect(event).toMatchObject({ type: 'error', code: 'provider_error' });
    const [unknown] = decoder.push('{"type":"desconhecido"}\n');
    expect(unknown).toMatchObject({ type: 'error' });
  });
});

describe('applyEvent', () => {
  const usage: GenerationUsage = {
    inputTokens: 10,
    outputTokens: 20,
    totalMs: 1500,
    loadMs: 0,
    outputTokensPerSecond: 40,
  };

  it('acumula texto, raciocínio, avisos e métricas', () => {
    let current = turn('assistant', '');
    current = applyEvent(current, {
      type: 'start',
      model: 'qwen3.5:4b',
      promptVersion: 'copilot/v1',
      traceId: 't',
    });
    current = applyEvent(current, { type: 'notice', message: 'GPU cheia' });
    current = applyEvent(current, { type: 'thinking', text: 'pensando' });
    current = applyEvent(current, { type: 'delta', text: 'Olá' });
    current = applyEvent(current, { type: 'delta', text: ', tudo bem?' });
    current = applyEvent(current, {
      type: 'done',
      model: 'qwen3.5:4b',
      doneReason: 'stop',
      usage,
    });
    expect(current).toMatchObject({
      model: 'qwen3.5:4b',
      content: 'Olá, tudo bem?',
      thinking: 'pensando',
      notices: ['GPU cheia'],
      doneReason: 'stop',
      usage,
    });
  });

  it('registra o erro sem apagar o texto parcial', () => {
    const partial = applyEvent(turn('assistant', 'Começo'), {
      type: 'error',
      code: 'timeout',
      message: 'demorou',
    });
    expect(partial.content).toBe('Começo');
    expect(partial.error).toEqual({ code: 'timeout', message: 'demorou' });
  });
});

describe('turnsFromMessages', () => {
  const base = {
    threadId: '11111111-1111-4111-8111-111111111111',
    status: 'complete' as const,
    model: null,
    promptVersion: null,
    traceId: 't',
    toolCalls: null,
    toolCallId: null,
    toolName: null,
    toolStatus: null,
    errorCode: null,
    usage: null,
    createdAt: '2026-11-10T12:00:00Z',
  };
  const id = () => crypto.randomUUID();

  it('junta resultados de ferramenta à resposta seguinte, com o título atual', () => {
    const turns = turnsFromMessages(
      [
        { ...base, id: id(), role: 'user', content: 'Quais ofertas eu tenho?' },
        {
          ...base,
          id: id(),
          role: 'tool',
          content: '1 oferta: 1 ativa.',
          toolCallId: 'call_1',
          toolName: 'list_offers',
          toolStatus: 'ok',
        },
        {
          ...base,
          id: id(),
          role: 'assistant',
          content: 'Você tem 1 oferta.',
          model: 'qwen3.5:4b',
        },
      ],
      { list_offers: 'Consultando ofertas' },
    );
    expect(turns).toHaveLength(2);
    expect(turns[1]).toMatchObject({
      role: 'assistant',
      content: 'Você tem 1 oferta.',
      model: 'qwen3.5:4b',
      tools: [
        { id: 'call_1', title: 'Consultando ofertas', status: 'ok', summary: '1 oferta: 1 ativa.' },
      ],
    });
  });

  it('mostra resposta interrompida e falha com o motivo', () => {
    const turns = turnsFromMessages([
      { ...base, id: id(), role: 'user', content: 'oi' },
      { ...base, id: id(), role: 'assistant', content: 'Ol', status: 'interrupted' },
      { ...base, id: id(), role: 'user', content: 'oi?' },
      { ...base, id: id(), role: 'assistant', content: '', status: 'failed', errorCode: 'timeout' },
    ]);
    expect(turns[1]?.error).toEqual({ code: 'cancelled', message: 'Resposta interrompida.' });
    expect(turns[3]?.error?.code).toBe('timeout');
  });

  it('ferramenta sem título conhecido ganha um rótulo neutro', () => {
    const turns = turnsFromMessages([
      { ...base, id: id(), role: 'user', content: 'oi' },
      { ...base, id: id(), role: 'tool', content: 'x', toolName: 'old_tool', toolStatus: 'error' },
      { ...base, id: id(), role: 'assistant', content: 'ok' },
    ]);
    expect(turns[1]?.tools?.[0]).toMatchObject({ title: 'Consulta (old_tool)', status: 'error' });
  });
});

describe('applyEvent com ferramentas', () => {
  it('acompanha a consulta do pedido ao resultado', () => {
    let turn: Turn = { id: 'a', role: 'assistant', content: '' };
    turn = applyEvent(turn, {
      type: 'tool_call',
      id: 'c1',
      name: 'list_offers',
      title: 'Consultando ofertas',
    });
    expect(turn.tools?.[0]?.status).toBeUndefined();
    turn = applyEvent(turn, {
      type: 'tool_result',
      id: 'c1',
      name: 'list_offers',
      status: 'ok',
      summary: '2 ofertas.',
      links: [{ label: 'Branding', href: '/configuracoes/estrategia/ofertas/x' }],
    });
    expect(turn.tools?.[0]).toMatchObject({ status: 'ok', summary: '2 ofertas.' });
    expect(turn.tools?.[0]?.links).toHaveLength(1);
    expect(applyEvent(turn, { type: 'thread', threadId: 't', title: 'x', created: true })).toBe(
      turn,
    );
  });
});

describe('formatação', () => {
  it('descreve as métricas reais da geração', () => {
    expect(
      describeUsage('qwen3.5:4b', {
        inputTokens: 900,
        outputTokens: 312,
        totalMs: 7400,
        loadMs: 3900,
        outputTokensPerSecond: 98.4,
      }),
    ).toBe('qwen3.5:4b · 312 tokens · 98 tokens/s · 7,4 s (3,9 s carregando o modelo)');
    expect(
      describeUsage('m', {
        inputTokens: null,
        outputTokens: null,
        totalMs: 800,
        loadMs: 10,
        outputTokensPerSecond: null,
      }),
    ).toBe('m · 0,8 s');
  });

  it('descreve quando o modelo sai da memória', () => {
    const now = new Date('2026-11-09T12:00:00Z');
    expect(describeExpiry('2026-11-09T12:04:30Z', now)).toBe(
      'Sai da memória em 5 min se ficar ocioso',
    );
    expect(describeExpiry('2318-01-01T00:00:00Z', now)).toBe(
      'Fica na memória até ser descarregado',
    );
    expect(describeExpiry('2026-11-09T11:00:00Z', now)).toBe('Saindo da memória');
    expect(describeExpiry(null, now)).toBeNull();
  });

  it('mensagem de recusa da rota', () => {
    expect(httpFailure(403, 'Pedido recusado')).toEqual({
      code: 'provider_error',
      message: 'Pedido recusado',
    });
    expect(httpFailure(400, undefined)?.code).toBe('invalid_request');
  });

  const model = (name: string, capabilities: LocalModel['capabilities'] = null): LocalModel => ({
    name,
    sizeBytes: 1,
    family: null,
    parameterSize: null,
    quantization: null,
    capabilities,
    contextLength: null,
  });

  it('oferece ao Copiloto só modelos que conversam, segundo o Ollama', () => {
    expect(
      chatModelOptions(
        [
          model('qwen3.5:4b', ['completion', 'vision', 'tools', 'thinking']),
          model('meu-embed-sem-nome-obvio:1b', ['embedding']),
          model('nemotron-3-nano:4b', ['completion', 'tools', 'thinking']),
        ],
        ['completion'],
      ),
    ).toEqual(['nemotron-3-nano:4b', 'qwen3.5:4b']);
  });

  it('segue as capacidades que o servidor exige para a tarefa', () => {
    const installed = [
      model('qwen3.5:4b', ['completion', 'vision', 'tools', 'thinking']),
      model('so-texto:1b', ['completion']),
    ];
    expect(chatModelOptions(installed, ['completion', 'tools'])).toEqual(['qwen3.5:4b']);
  });

  it('sem capacidades lidas, tira os embeddings pelo nome', () => {
    expect(
      chatModelOptions(
        [model('qwen3.5:4b'), model('qwen3-embedding:0.6b'), model('bge-m3:latest')],
        ['completion'],
      ),
    ).toEqual(['qwen3.5:4b']);
  });

  it('marca só os modelos que o Ollama diz não terem raciocínio (KI-067)', () => {
    expect(
      modelsWithoutThinking([
        model('qwen3.5:4b', ['completion', 'thinking']),
        model('gemma-sem-raciocinio:4b', ['completion', 'vision']),
        model('desconhecido:1b'),
      ]),
    ).toEqual(['gemma-sem-raciocinio:4b']);
  });

  it('GB no mesmo formato das mensagens do servidor: uma casa, sem ",0" (KI-067)', () => {
    expect(formatMebibytesAsGigabytes(16_311)).toBe('15,9 GB');
    expect(formatMebibytesAsGigabytes(3072)).toBe('3 GB');
    expect(formatGigabytes(3_388_000_000)).toBe('3,2 GB');
    expect(formatGigabytes(2 * 1024 ** 3)).toBe('2 GB');
    expect(formatMebibytesAsGigabytes(6100)).toBe(formatMiBAsGB(6100));
  });

  it('a fase "liberando memória" não muda a fala', () => {
    const current = turn('assistant', 'x');
    expect(applyEvent(current, { type: 'phase', phase: 'freeing_vram' })).toBe(current);
  });

  it('descreve as capacidades em português', () => {
    expect(describeCapabilities(model('qwen3.5:4b', ['completion', 'vision', 'thinking']))).toBe(
      'conversa · imagens · raciocínio',
    );
    expect(describeCapabilities(model('x:1b'))).toBeNull();
  });
});
