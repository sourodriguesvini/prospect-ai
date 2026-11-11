import type { ModelCapability } from '@prospector/contracts';
import { describe, expect, it } from 'vitest';
import {
  AiError,
  createLimiter,
  createLocalAiGateway,
  DEFAULT_POLICY,
  estimateImageTokens,
  estimateMessageTokens,
  type GpuProbe,
  type ModelPolicy,
  type OllamaChatRequest,
  type OllamaClient,
} from '../src';
import { collect, DONE } from './support';

/**
 * Imagens no gateway (auditoria visual da investigação, ADR-0015): vão em base64 na mensagem do
 * usuário, exigem modelo com visão e contam no orçamento do contexto. Saída estruturada
 * (`format`) chega ao Ollama.
 */

const CAPS: Record<string, ModelCapability[]> = {
  'qwen3.5:4b': ['completion', 'vision', 'tools', 'thinking'],
  'nemotron-3-nano:4b': ['completion', 'tools', 'thinking'],
};

function client(requests: OllamaChatRequest[]): OllamaClient {
  return {
    baseUrl: 'http://127.0.0.1:11434',
    version: async () => '0.40.15',
    listModels: async () =>
      Object.keys(CAPS).map((name) => ({
        name,
        sizeBytes: 3_000_000_000,
        digest: `sha-${name}`,
        family: null,
        parameterSize: null,
        quantization: null,
      })),
    listRunning: async () => [],
    show: async (model) => ({ capabilities: CAPS[model] ?? null, modelInfo: {} }),
    chat: (request) => {
      requests.push(request);
      return (async function* () {
        yield { message: { content: '{"ok":true}' } };
        yield DONE;
      })();
    },
    unload: async () => undefined,
  };
}

const roomyGpu: GpuProbe = async () => ({
  name: 'GPU',
  totalMiB: 16_311,
  usedMiB: 811,
  freeMiB: 15_500,
});

function gateway(requests: OllamaChatRequest[], policy: ModelPolicy = DEFAULT_POLICY) {
  const limits = { maxConcurrent: 1, maxQueue: 2, vramReserveMiB: 3072 };
  return createLocalAiGateway({
    client: client(requests),
    policy,
    limiter: createLimiter(limits),
    limits,
    gpu: roomyGpu,
  });
}

const IMAGE = {
  base64: Buffer.from([0xff, 0xd8, 0xff]).toString('base64'),
  width: 1280,
  height: 1600,
};

describe('gateway com imagens e saída estruturada', () => {
  it('manda as imagens em base64 e o esquema ao Ollama, com o teto de tokens pedido', async () => {
    const requests: OllamaChatRequest[] = [];
    const schema = { type: 'object', properties: {}, additionalProperties: false };
    await collect(
      gateway(requests).chat('vision', {
        messages: [
          { role: 'system', content: 'Instruções.' },
          { role: 'user', content: 'Avalie.', images: [IMAGE] },
        ],
        think: false,
        format: schema,
        maxOutputTokens: 1500,
      }),
    );
    const [request] = requests;
    expect(request?.model).toBe('qwen3.5:4b');
    expect(request?.format).toEqual(schema);
    expect(request?.messages[1]).toEqual({
      role: 'user',
      content: 'Avalie.',
      images: [IMAGE.base64],
    });
    expect(request?.options.num_ctx).toBe(DEFAULT_POLICY.vision.numCtx);
    expect(request?.options.num_predict).toBeLessThanOrEqual(1500);
    expect(request?.keepAlive).toBe(DEFAULT_POLICY.vision.keepAlive);
  });

  it('imagem para modelo sem visão é recusada antes de chegar ao Ollama', async () => {
    const requests: OllamaChatRequest[] = [];
    const policy: ModelPolicy = {
      ...DEFAULT_POLICY,
      reasoning: { ...DEFAULT_POLICY.reasoning, models: ['nemotron-3-nano:4b'] },
    };
    const error = await collect(
      gateway(requests, policy).chat('reasoning', {
        messages: [{ role: 'user', content: 'Avalie.', images: [IMAGE] }],
        think: false,
      }),
    ).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AiError);
    expect((error as AiError).code).toBe('model_unsupported');
    expect(requests).toHaveLength(0);
  });

  it('a imagem conta no contexto (teto: um token a cada 28×28 px)', () => {
    expect(estimateImageTokens({ width: 1280, height: 1600 })).toBe(
      Math.ceil((1280 * 1600) / 784) + 16,
    );
    const plain = estimateMessageTokens({ role: 'user', content: 'Avalie.' });
    const withImage = estimateMessageTokens({ role: 'user', content: 'Avalie.', images: [IMAGE] });
    expect(withImage - plain).toBe(estimateImageTokens(IMAGE));
  });
});
