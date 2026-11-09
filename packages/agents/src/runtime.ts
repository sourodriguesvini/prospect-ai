import { createCopilot, type Copilot } from './copilot/copilot';
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
  const limits = { maxConcurrent: config.maxConcurrent, maxQueue: config.maxQueue };
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
    copilot: createCopilot({ gateway, prompt: () => loadPrompt('copilot', 1) }),
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
