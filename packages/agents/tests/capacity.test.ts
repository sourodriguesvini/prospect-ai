import { describe, expect, it, vi } from 'vitest';
import {
  AiError,
  chooseModel,
  createModelCatalog,
  decideAdmission,
  DEFAULT_POLICY,
  estimateModelMiB,
  estimateTokens,
  fitToContext,
  insufficientVramError,
  kvCacheBytes,
  kvProfileOf,
  MIN_OUTPUT_TOKENS,
  parseModelShow,
  type OllamaModelShow,
} from '../src';

/**
 * Metadados copiados do `/api/show` do Ollama 0.40.15 deste computador em 2026-11-09 (só as
 * chaves usadas). Fixture: se o Ollama mudar o formato, estes testes não percebem sozinhos.
 */
const QWEN35_INFO = {
  'general.architecture': 'qwen35',
  'qwen35.attention.head_count': 16,
  'qwen35.attention.head_count_kv': 4,
  'qwen35.attention.key_length': 256,
  'qwen35.attention.value_length': 256,
  'qwen35.block_count': 32,
  'qwen35.context_length': 262_144,
  'qwen35.embedding_length': 2560,
  'qwen35.full_attention_interval': 4,
};
const NEMOTRON_H_INFO = {
  'general.architecture': 'nemotron_h',
  'nemotron_h.attention.head_count': 40,
  'nemotron_h.attention.head_count_kv': Array.from({ length: 42 }, (_, layer) =>
    [12, 17, 24, 32].includes(layer) ? 8 : 0,
  ),
  'nemotron_h.attention.key_length': 128,
  'nemotron_h.attention.value_length': 128,
  'nemotron_h.block_count': 42,
  'nemotron_h.context_length': 262_144,
  'nemotron_h.embedding_length': 3136,
};
const GEMMA4_INFO = {
  'general.architecture': 'gemma4',
  'gemma4.attention.head_count': 8,
  'gemma4.attention.head_count_kv': 2,
  'gemma4.attention.key_length': 512,
  'gemma4.attention.value_length': 512,
  'gemma4.attention.key_length_swa': 256,
  'gemma4.attention.value_length_swa': 256,
  'gemma4.attention.sliding_window': 512,
  'gemma4.attention.sliding_window_pattern': Array.from(
    { length: 42 },
    (_, layer) => (layer + 1) % 6 !== 0,
  ),
  'gemma4.block_count': 42,
  'gemma4.context_length': 65_536,
  'gemma4.embedding_length': 2560,
};

const MiB = 1024 * 1024;

describe('parseModelShow / kvProfileOf', () => {
  it('lê capacidades e contexto, descartando capacidades que o contrato não conhece', () => {
    const show: OllamaModelShow = {
      capabilities: ['completion', 'vision', 'tools', 'thinking', 'hologram'],
      modelInfo: QWEN35_INFO,
    };
    expect(parseModelShow(show)).toMatchObject({
      capabilities: ['completion', 'vision', 'tools', 'thinking'],
      contextLength: 262_144,
    });
    expect(parseModelShow({ capabilities: null, modelInfo: {} })).toEqual({
      capabilities: null,
      contextLength: null,
      kv: null,
    });
  });

  it('Qwen 3.5: só 1 em cada 4 camadas guarda cache (256 MiB em 8.192 tokens)', () => {
    const kv = kvProfileOf(QWEN35_INFO);
    expect(kv).toEqual({
      fullBytesPerToken: 8 * 4 * 512 * 2,
      slidingBytesPerToken: 0,
      slidingWindow: 0,
    });
    expect(kvCacheBytes(kv!, 8192) / MiB).toBe(256);
  });

  it('Nemotron-H: só as camadas com cabeças K/V contam (128 MiB em 8.192 tokens)', () => {
    const kv = kvProfileOf(NEMOTRON_H_INFO);
    expect(kvCacheBytes(kv!, 8192) / MiB).toBe(128);
  });

  it('Gemma com janela deslizante: as camadas de janela param de crescer', () => {
    const kv = kvProfileOf(GEMMA4_INFO)!;
    expect(kv.fullBytesPerToken).toBe(7 * 2 * 1024 * 2);
    expect(kv.slidingBytesPerToken).toBe(35 * 2 * 512 * 2);
    expect(kvCacheBytes(kv, 16_384) - kvCacheBytes(kv, 8192)).toBe(kv.fullBytesPerToken * 8192);
  });

  it('sem os campos da arquitetura devolve null (a admissão usa a reserva genérica)', () => {
    expect(kvProfileOf({ 'general.architecture': 'x', 'x.block_count': 10 })).toBeNull();
    expect(kvProfileOf({})).toBeNull();
  });

  it('metadado adulterado (GGUF de terceiros) não trava nem zera a estimativa', () => {
    const started = performance.now();
    expect(kvProfileOf({ ...QWEN35_INFO, 'qwen35.block_count': 1e15 })).toBeNull();
    expect(kvProfileOf({ ...QWEN35_INFO, 'qwen35.block_count': 32.5 })).toBeNull();
    expect(performance.now() - started).toBeLessThan(50);
    // Intervalo maior que o número de camadas: nenhuma camada com atenção → estimativa genérica.
    expect(kvProfileOf({ ...QWEN35_INFO, 'qwen35.full_attention_interval': 1000 })).toBeNull();
    expect(
      parseModelShow({
        capabilities: [],
        modelInfo: { ...QWEN35_INFO, 'qwen35.context_length': 2 ** 40 },
      }).contextLength,
    ).toBeNull();
  });
});

describe('createModelCatalog', () => {
  it('lê o /api/show uma vez por arquivo de modelo e de novo quando o digest muda', async () => {
    const show = vi.fn(async () => ({ capabilities: ['completion'], modelInfo: QWEN35_INFO }));
    const catalog = createModelCatalog({ show });
    await catalog.details({ name: 'qwen3.5:4b', digest: 'a' });
    await catalog.details({ name: 'qwen3.5:4b', digest: 'a' });
    expect(show).toHaveBeenCalledTimes(1);
    await catalog.details({ name: 'qwen3.5:4b', digest: 'b' });
    expect(show).toHaveBeenCalledTimes(2);
  });

  it('falha vira "não sei" e não fica guardada', async () => {
    const show = vi
      .fn<(model: string) => Promise<OllamaModelShow>>()
      .mockRejectedValueOnce(new AiError('provider_error'))
      .mockResolvedValue({ capabilities: ['embedding'], modelInfo: {} });
    const catalog = createModelCatalog({ show });
    expect((await catalog.details({ name: 'bge-m3', digest: 'x' })).capabilities).toBeNull();
    expect((await catalog.details({ name: 'bge-m3', digest: 'x' })).capabilities).toEqual([
      'embedding',
    ]);
  });
});

describe('estimateModelMiB', () => {
  it('fica um pouco acima do medido no nvidia-smi em 2026-11-09', () => {
    const qwen = estimateModelMiB({
      sizeBytes: 3_324_173_934,
      kv: kvProfileOf(QWEN35_INFO),
      numCtx: 8192,
    });
    const nemotron = estimateModelMiB({
      sizeBytes: 2_837_597_147,
      kv: kvProfileOf(NEMOTRON_H_INFO),
      numCtx: 8192,
    });
    expect(qwen).toBeGreaterThanOrEqual(3888); // medido
    expect(qwen).toBeLessThan(3888 * 1.15);
    expect(nemotron).toBeGreaterThanOrEqual(2873); // medido
    expect(nemotron).toBeLessThan(2873 * 1.25);
  });

  it('mais contexto pede mais memória; sem metadados usa a reserva genérica', () => {
    const base = { sizeBytes: 3_000_000_000, kv: kvProfileOf(QWEN35_INFO) };
    expect(estimateModelMiB({ ...base, numCtx: 32_768 })).toBeGreaterThan(
      estimateModelMiB({ ...base, numCtx: 8192 }),
    );
    expect(estimateModelMiB({ ...base, kv: null, numCtx: 8192 })).toBeGreaterThan(
      estimateModelMiB({ ...base, numCtx: 8192 }),
    );
  });
});

describe('decideAdmission', () => {
  const gpu = { name: 'RTX', totalMiB: 16_311, usedMiB: 4_800, freeMiB: 11_511 };

  it('admite quando sobra a reserva inteira', () => {
    expect(
      decideAdmission({ neededMiB: 4_100, gpu, reclaimableMiB: 0, reserveMiB: 3072 }),
    ).toMatchObject({ admitted: true });
  });

  it('recusa quando a reserva não é suficiente, mesmo com memória livre para o modelo', () => {
    const busy = { ...gpu, usedMiB: 9_311, freeMiB: 7_000 };
    const decision = decideAdmission({
      neededMiB: 4_100,
      gpu: busy,
      reclaimableMiB: 0,
      reserveMiB: 3072,
    });
    expect(decision).toMatchObject({ admitted: false, reason: 'no_room', availableMiB: 7_000 });
    // Sem reserva o mesmo modelo caberia: é a reserva que barra.
    expect(
      decideAdmission({ neededMiB: 4_100, gpu: busy, reclaimableMiB: 0, reserveMiB: 0 }),
    ).toMatchObject({ admitted: true });
  });

  it('conta a memória de modelos do Ollama que serão trocados', () => {
    const busy = { ...gpu, freeMiB: 5_000 };
    expect(
      decideAdmission({ neededMiB: 4_100, gpu: busy, reclaimableMiB: 3_100, reserveMiB: 3072 }),
    ).toMatchObject({ admitted: true, availableMiB: 8_100 });
  });

  it('modelo maior que a placa com a reserva é "too_big"', () => {
    const decision = decideAdmission({
      neededMiB: 14_000,
      gpu,
      reclaimableMiB: 0,
      reserveMiB: 3072,
    });
    expect(decision).toMatchObject({ admitted: false, reason: 'too_big' });
    if (decision.admitted) throw new Error('esperava recusa');
    // Repetir não adianta: o código é outro, para a tela não oferecer "Tentar de novo".
    const error = insufficientVramError('modelo-grande:30b', decision);
    expect(error.code).toBe('model_too_large');
    expect(error.message).toMatch(/Escolha um modelo menor/);
  });

  it('a mensagem de recusa diz quanto falta e o que fazer, em pt-BR', () => {
    const decision = decideAdmission({
      neededMiB: 4_096,
      gpu: { ...gpu, freeMiB: 6_144 },
      reclaimableMiB: 0,
      reserveMiB: 3072,
    });
    if (decision.admitted) throw new Error('esperava recusa');
    const error = insufficientVramError('qwen3.5:4b', decision);
    expect(error.code).toBe('insufficient_vram');
    expect(error.message).toContain('cerca de 4 GB');
    expect(error.message).toContain('a placa tem 6 GB livres e 3 GB ficam reservados');
    expect(error.message).toMatch(/Feche o que estiver usando a GPU/);
  });

  it('a recusa usa os mesmos "livres" do painel e mostra os ociosos à parte (KI-067)', () => {
    const decision = decideAdmission({
      neededMiB: 6_000,
      gpu: { ...gpu, freeMiB: 3_994 },
      reclaimableMiB: 2_048,
      reserveMiB: 3072,
    });
    if (decision.admitted) throw new Error('esperava recusa');
    const error = insufficientVramError('qwen3.5:4b', decision);
    expect(error.message).toContain('cerca de 5,9 GB');
    expect(error.message).toContain(
      'a placa tem 3,9 GB livres (mais 2 GB de modelos ociosos, que o Prospector tiraria da memória)',
    );
    expect(error.message).not.toMatch(/\d,0 GB/);
  });
});

describe('chooseModel', () => {
  const qwen = {
    name: 'qwen3.5:4b',
    capabilities: ['completion', 'vision', 'tools', 'thinking'] as const,
  };
  const nemotron = {
    name: 'nemotron-3-nano:4b',
    capabilities: ['completion', 'tools', 'thinking'] as const,
  };
  const embed = { name: 'bge-m3:latest', capabilities: ['embedding'] as const };
  const plain = { name: 'velho:1b', capabilities: ['completion'] as const };
  const unknown = { name: 'misterio:2b', capabilities: null };

  it('mantém a ordem de preferência e a reserva', () => {
    const installed = [nemotron, qwen];
    expect(
      chooseModel({
        preferred: ['qwen3.5:4b', 'nemotron-3-nano:4b'],
        installed,
        requires: ['completion'],
      }),
    ).toEqual({ kind: 'ok', model: 'qwen3.5:4b', lacking: [] });
    expect(
      chooseModel({
        preferred: ['qwen3.5:4b', 'nemotron-3-nano:4b'],
        installed: [nemotron],
        requires: ['completion'],
      }),
    ).toEqual({ kind: 'ok', model: 'nemotron-3-nano:4b', lacking: [] });
  });

  it('pula o preferido que não tem a capacidade exigida', () => {
    expect(
      chooseModel({
        preferred: ['qwen3.5:4b', 'bge-m3'],
        installed: [qwen, embed],
        requires: ['embedding'],
      }),
    ).toEqual({ kind: 'ok', model: 'bge-m3:latest', lacking: [] });
    expect(
      chooseModel({
        preferred: ['nemotron-3-nano:4b', 'qwen3.5:4b'],
        installed: [qwen, nemotron],
        requires: ['vision'],
      }),
    ).toMatchObject({ model: 'qwen3.5:4b' });
  });

  it('nunca escolhe sozinho um modelo fora da lista, mesmo capaz', () => {
    expect(
      chooseModel({ preferred: ['qwen3.5:4b'], installed: [plain], requires: ['completion'] }),
    ).toEqual({ kind: 'not_installed', wanted: ['qwen3.5:4b'] });
  });

  it('instalados da lista sem a capacidade viram "unsupported"', () => {
    expect(
      chooseModel({ preferred: ['bge-m3'], installed: [embed], requires: ['completion'] }),
    ).toEqual({ kind: 'unsupported', model: null, missing: ['completion'] });
  });

  it('prefere quem tem a capacidade desejável e diz o que falta quando ninguém tem', () => {
    expect(
      chooseModel({
        preferred: ['velho:1b', 'qwen3.5:4b'],
        installed: [plain, qwen],
        requires: ['completion'],
        wants: ['thinking'],
      }),
    ).toEqual({ kind: 'ok', model: 'qwen3.5:4b', lacking: [] });
    expect(
      chooseModel({
        preferred: ['velho:1b'],
        installed: [plain],
        requires: ['completion'],
        wants: ['thinking'],
      }),
    ).toEqual({ kind: 'ok', model: 'velho:1b', lacking: ['thinking'] });
  });

  it('pedido explícito: precisa estar instalado e ter a capacidade', () => {
    const installed = [qwen, embed];
    expect(
      chooseModel({ preferred: [], installed, requires: ['completion'], requested: 'QWEN3.5:4b' }),
    ).toMatchObject({ kind: 'ok', model: 'qwen3.5:4b' });
    expect(
      chooseModel({ preferred: [], installed, requires: ['completion'], requested: 'bge-m3' }),
    ).toEqual({ kind: 'unsupported', model: 'bge-m3:latest', missing: ['completion'] });
    expect(
      chooseModel({ preferred: [], installed, requires: ['completion'], requested: 'outro:1b' }),
    ).toEqual({ kind: 'not_installed', wanted: ['outro:1b'] });
  });

  it('capacidades desconhecidas não descartam o modelo', () => {
    expect(
      chooseModel({ preferred: ['misterio:2b'], installed: [unknown], requires: ['completion'] }),
    ).toEqual({ kind: 'ok', model: 'misterio:2b', lacking: [] });
  });

  it('a política padrão exige capacidades coerentes com cada tarefa', () => {
    expect(DEFAULT_POLICY.copilot.requires).toEqual(['completion']);
    expect(DEFAULT_POLICY.vision.requires).toContain('vision');
    expect(DEFAULT_POLICY.embedding.requires).toEqual(['embedding']);
  });
});

describe('fitToContext', () => {
  const system = { role: 'system' as const, content: 'regras '.repeat(300) }; // ~700 tokens
  const turn = (role: 'user' | 'assistant', chars: number, tag: string) => ({
    role,
    content: `${tag} ${'x'.repeat(chars)}`,
  });

  it('pedido curto passa inteiro, com o limite de resposta da política', () => {
    const messages = [system, turn('user', 10, 'u1')];
    const plan = fitToContext(messages, { numCtx: 8192, maxOutputTokens: 1024 });
    expect(plan).toMatchObject({ messages, dropped: 0, numPredict: 1024 });
  });

  it('corta as falas mais antigas para caber em num_ctx menos a resposta', () => {
    const history = [
      turn('user', 6000, 'u1'),
      turn('assistant', 6000, 'a1'),
      turn('user', 6000, 'u2'),
      turn('assistant', 3000, 'a2'),
      turn('user', 300, 'u3'),
    ];
    const plan = fitToContext([system, ...history], { numCtx: 8192, maxOutputTokens: 1024 });
    expect(plan.messages[0]).toBe(system);
    expect(plan.messages.at(-1)?.content.startsWith('u3')).toBe(true);
    expect(plan.dropped).toBeGreaterThan(0);
    expect(plan.messages[1]?.role).toBe('user'); // nunca começa por uma resposta solta
    expect(plan.estimatedPromptTokens + plan.numPredict).toBeLessThanOrEqual(8192);
    const total = plan.messages.reduce((sum, message) => sum + estimateTokens(message.content), 0);
    expect(total).toBe(plan.estimatedPromptTokens);
  });

  it('com raciocínio (resposta maior) cabe menos histórico', () => {
    const history = [
      turn('user', 6000, 'u1'),
      turn('assistant', 6000, 'a1'),
      turn('user', 300, 'u2'),
    ];
    const plain = fitToContext([system, ...history], { numCtx: 8192, maxOutputTokens: 1024 });
    const thinking = fitToContext([system, ...history], { numCtx: 8192, maxOutputTokens: 4096 });
    expect(plain.dropped).toBe(0);
    expect(thinking.dropped).toBe(2);
  });

  it('dígitos e escrita fora do latim contam como teto, não como prosa', () => {
    expect(estimateTokens('a'.repeat(300))).toBe(108);
    expect(estimateTokens('ação é útil')).toBe(12); // acentos contam como prosa
    expect(estimateTokens('1'.repeat(300))).toBe(308);
    expect(estimateTokens('漢'.repeat(100))).toBe(308);
    // 8.000 dígitos (o máximo de uma mensagem) não cabem em 8192 junto com a resposta: o pedido
    // é recusado em vez de o Ollama descartar as instruções do começo do prompt.
    expect(() =>
      fitToContext([system, { role: 'user', content: '7'.repeat(8000) }], {
        numCtx: 8192,
        maxOutputTokens: 1024,
      }),
    ).toThrow(/passou do limite/);
  });

  it('mensagem enorme encolhe a resposta; se nem o mínimo couber, recusa com mensagem clara', () => {
    const big = fitToContext([system, turn('user', 8000, 'u1')], {
      numCtx: 4096,
      maxOutputTokens: 4096,
    });
    expect(big.numPredict).toBeLessThan(4096);
    expect(big.numPredict).toBeGreaterThanOrEqual(MIN_OUTPUT_TOKENS);
    expect(() =>
      fitToContext([system, turn('user', 8000, 'u1')], { numCtx: 3000, maxOutputTokens: 1024 }),
    ).toThrow(/passou do limite/);
  });
});
