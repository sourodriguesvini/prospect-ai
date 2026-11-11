import type { AiErrorCode } from '@prospector/contracts';
import { DEFAULT_VRAM_RESERVE_MIB } from './admission';
import {
  COPILOT_PROMPT_VERSION,
  COPILOT_TOOLS_PROMPT_VERSION,
  createCopilot,
  type Copilot,
} from './copilot/copilot';
import { AiError } from './errors';
import { createLocalAiGateway, type LocalAiGateway } from './gateway';
import { createNvidiaSmiProbe, type GpuProbe } from './gpu';
import { createLimiter } from './limiter';
import { DEFAULT_POLICY, type ModelPolicy } from './model-policy';
import { createOllamaClient } from './ollama/client';
import { loadPrompt } from './prompts';

/** Configuração da IA local lida pela raiz de composição (variáveis não secretas). */
export interface LocalAiConfig {
  /** Endereço do Ollama; precisa ser deste computador. */
  baseUrl: string;
  /** Sobrescreve a lista de modelos do Copiloto (ordem de preferência). */
  copilotModels?: string[];
  keepAlive?: string;
  numCtx?: number;
  maxConcurrent: number;
  maxQueue: number;
  /** VRAM deixada livre para os outros programas; padrão 3 GB (`DEFAULT_VRAM_RESERVE_MIB`). */
  vramReserveMiB?: number;
}

export interface LocalAiRuntime {
  gateway: LocalAiGateway;
  copilot: Copilot;
  policy: ModelPolicy;
}

export function createLocalAiRuntime(
  config: LocalAiConfig,
  overrides?: { fetch?: typeof fetch; gpu?: GpuProbe },
): LocalAiRuntime {
  const policy = applyConfig(DEFAULT_POLICY, config);
  const limits = {
    maxConcurrent: config.maxConcurrent,
    maxQueue: config.maxQueue,
    vramReserveMiB: config.vramReserveMiB ?? DEFAULT_VRAM_RESERVE_MIB,
  };
  const gateway = createLocalAiGateway({
    client: createOllamaClient({ baseUrl: config.baseUrl, fetch: overrides?.fetch }),
    policy,
    limiter: createLimiter(limits),
    limits,
    gpu: overrides?.gpu ?? createNvidiaSmiProbe(),
  });
  return {
    gateway,
    policy,
    copilot: createCopilot({
      gateway,
      prompt: () => loadPrompt('copilot', COPILOT_PROMPT_VERSION),
      toolsPrompt: () => loadPrompt('copilot-tools', COPILOT_TOOLS_PROMPT_VERSION),
    }),
  };
}

/**
 * IA local que não pôde ser montada (ex.: variável `AI_*` inválida): o estado diz o motivo e o
 * Copiloto responde com um erro claro, em vez de a página ou a rota caírem com erro 500.
 */
export function createUnavailableLocalAi(
  code: AiErrorCode,
  message: string,
): Pick<LocalAiRuntime, 'gateway' | 'copilot'> {
  const failure = () => new AiError(code, { message });
  return {
    gateway: {
      status: () =>
        Promise.resolve({ state: 'offline', provider: 'ollama', code, message, gpu: null }),
      // eslint-disable-next-line require-yield -- falha na primeira leitura, como o gerador real
      async *chat() {
        throw failure();
      },
      unload: () => Promise.reject(failure()),
    },
    copilot: {
      promptId: `copilot/v${COPILOT_PROMPT_VERSION}`,
      async *reply() {
        yield { type: 'error', code, message };
      },
    },
  };
}

function applyConfig(base: ModelPolicy, config: LocalAiConfig): ModelPolicy {
  const tune = <T extends ModelPolicy[keyof ModelPolicy]>(task: T): T => ({
    ...task,
    ...(config.keepAlive ? { keepAlive: config.keepAlive } : {}),
    ...(config.numCtx ? { numCtx: config.numCtx } : {}),
  });
  return {
    copilot: {
      ...tune(base.copilot),
      ...(config.copilotModels?.length ? { models: config.copilotModels } : {}),
    },
    reasoning: tune(base.reasoning),
    vision: tune(base.vision),
    embedding: { ...base.embedding, ...(config.keepAlive ? { keepAlive: config.keepAlive } : {}) },
  };
}
