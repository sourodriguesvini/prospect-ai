import {
  COPILOT_HISTORY_LIMIT,
  type GenerationUsage,
  type LocalModel,
} from '@prospector/contracts';
import { describe, expect, it } from 'vitest';
import {
  HISTORY_CHAR_BUDGET,
  applyEvent,
  buildHistory,
  chatModelOptions,
  describeCapabilities,
  createEventDecoder,
  describeExpiry,
  describeUsage,
  historyIsTrimmed,
  httpFailure,
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

describe('buildHistory', () => {
  it('ignora falas vazias (ex.: resposta que falhou antes do primeiro token)', () => {
    const history = buildHistory([
      turn('user', 'Oi'),
      turn('assistant', ''),
      turn('user', 'Tem alguém aí?'),
    ]);
    expect(history).toEqual([
      { role: 'user', content: 'Oi' },
      { role: 'user', content: 'Tem alguém aí?' },
    ]);
  });

  it('respeita o limite de mensagens do contrato', () => {
    const turns = Array.from({ length: COPILOT_HISTORY_LIMIT + 10 }, (_, index) =>
      turn(index % 2 === 0 ? 'user' : 'assistant', `mensagem ${index}`),
    );
    turns.push(turn('user', 'última'));
    const history = buildHistory(turns);
    expect(history).toHaveLength(COPILOT_HISTORY_LIMIT);
    expect(history.at(-1)).toEqual({ role: 'user', content: 'última' });
  });

  it('corta pelo orçamento de caracteres, mas sempre mantém a última pergunta', () => {
    const long = 'a'.repeat(Math.floor(HISTORY_CHAR_BUDGET * 0.45));
    const older = turn('user', `antiga ${long}`);
    const history = buildHistory([
      older,
      turn('user', long),
      turn('assistant', long),
      turn('user', 'e agora?'),
    ]);
    expect(history.map((message) => message.content)).toEqual([long, long, 'e agora?']);

    const huge = buildHistory([turn('user', 'c'.repeat(HISTORY_CHAR_BUDGET * 2))]);
    expect(huge).toHaveLength(1);
  });

  it('encurta resposta longa demais para o contrato', () => {
    const history = buildHistory([turn('assistant', 'b'.repeat(9000)), turn('user', 'ok')]);
    expect(history[0]?.content.length).toBeLessThanOrEqual(8000);
    expect(history[0]?.content.endsWith('[…]')).toBe(true);
  });
});

describe('historyIsTrimmed', () => {
  it('avisa só quando falas com conteúdo ficam fora do pedido', () => {
    expect(historyIsTrimmed([])).toBe(false);
    expect(historyIsTrimmed([turn('user', 'Oi'), turn('assistant', '')])).toBe(false);
    const many = Array.from({ length: COPILOT_HISTORY_LIMIT + 2 }, (_, index) =>
      turn(index % 2 ? 'assistant' : 'user', `fala ${index}`),
    );
    expect(historyIsTrimmed(many)).toBe(true);
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

  it('descreve as capacidades em português', () => {
    expect(describeCapabilities(model('qwen3.5:4b', ['completion', 'vision', 'thinking']))).toBe(
      'conversa · imagens · raciocínio',
    );
    expect(describeCapabilities(model('x:1b'))).toBeNull();
  });
});
