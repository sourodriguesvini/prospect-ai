import type { AiTask, ModelCapability } from '@prospector/contracts';

/** Como uma tarefa usa os modelos locais (ADR-0008). */
export interface TaskPolicy {
  /** Ordem de preferência; vale o primeiro instalado que tenha as capacidades (fallback). */
  models: string[];
  /** Capacidades que o modelo precisa ter, lidas no `/api/show` do Ollama. */
  requires: readonly ModelCapability[];
  /** Janela de contexto pedida ao Ollama (`num_ctx`); maior = mais VRAM. */
  numCtx: number;
  temperature: number;
  /** Máximo de tokens gerados por resposta (`num_predict`); evita geração sem fim na GPU. */
  maxOutputTokens: number;
  /** Mesmo limite quando o raciocínio está ligado: o raciocínio também conta. */
  maxOutputTokensThinking: number;
  /** Quanto tempo o modelo fica na memória depois do último uso (`keep_alive`). */
  keepAlive: string;
  /** Inclui o carregamento do modelo do disco para a GPU. */
  firstTokenTimeoutMs: number;
  /** Silêncio máximo entre pedaços da resposta. */
  idleTimeoutMs: number;
  totalTimeoutMs: number;
  /** Tempo máximo esperando vaga na fila antes de desistir com `busy`. */
  queueTimeoutMs: number;
}

export type ModelPolicy = Record<AiTask, TaskPolicy>;

const BASE = {
  numCtx: 8192,
  temperature: 0.4,
  maxOutputTokens: 1024,
  maxOutputTokensThinking: 4096,
  keepAlive: '5m',
  firstTokenTimeoutMs: 120_000,
  idleTimeoutMs: 60_000,
  totalTimeoutMs: 300_000,
  queueTimeoutMs: 300_000,
} satisfies Omit<TaskPolicy, 'models' | 'requires'>;

/**
 * Padrão até existir `agent_configs` no banco (KI-031); a lista do Copiloto é sobrescrita por
 * `AI_COPILOT_MODELS`. Avaliação local de 2026-11-09, recalculada com os corretores corrigidos
 * (`evals/copilot/results/2026-11-09-15-40.regraded.json`, 8 casos sintéticos × 2): qwen3.5:4b
 * 69% e nemotron-3-nano:4b 56%, intervalos sobrepostos. O Nemotron leu a injeção como conteúdo,
 * trocou o nome do produto e o cartão declara suporte só a inglês; o qwen3.5:4b também tem
 * visão, então um único modelo carregado atende conversa e imagens. Por isso qwen3.5 primeiro,
 * Nemotron de reserva. Na IA-1.1 (`2026-11-09-17-30.regraded.json`, 13 casos × 3, prompt v1):
 * qwen3.5:4b 82% e nemotron-3-nano:4b 67%; o Nemotron orientou guardar CPF e endereço de casa
 * no caso de LGPD (KI-034), risco aceito até o prompt v3 (IA-1.2).
 * `vision` e `embedding` ainda não têm consumidor (chegam nas fatias IA-4 e IA-5).
 */
export const DEFAULT_POLICY: ModelPolicy = {
  copilot: { ...BASE, requires: ['completion'], models: ['qwen3.5:4b', 'nemotron-3-nano:4b'] },
  reasoning: {
    ...BASE,
    temperature: 0.2,
    requires: ['completion', 'thinking'],
    models: ['qwen3.5:4b', 'nemotron-3-nano:4b'],
  },
  vision: {
    ...BASE,
    temperature: 0.2,
    requires: ['completion', 'vision'],
    models: ['qwen3.5:4b', 'qwen3-vl:8b'],
  },
  embedding: {
    ...BASE,
    temperature: 0,
    requires: ['embedding'],
    models: ['qwen3-embedding:0.6b', 'bge-m3'],
  },
};

/** `bge-m3` e `bge-m3:latest` são o mesmo modelo no Ollama. */
export function normalizeModelName(name: string): string {
  const lower = name.trim().toLowerCase();
  return lower.includes(':') ? lower : `${lower}:latest`;
}

export interface CandidateModel {
  name: string;
  /** null = desconhecidas (o Ollama não informou): o modelo não é descartado por isso. */
  capabilities: readonly ModelCapability[] | null;
}

export type ModelChoice =
  /** `lacking`: capacidades desejáveis (não obrigatórias) que o modelo escolhido não tem. */
  | { kind: 'ok'; model: string; lacking: ModelCapability[] }
  | { kind: 'not_installed'; wanted: string[] }
  /** Instalado, mas sem a capacidade obrigatória. `model` é o pedido explícito, se houve. */
  | { kind: 'unsupported'; model: string | null; missing: ModelCapability[] };

/**
 * Escolha por capacidade (IA-1.1): entre os modelos instalados da lista de preferência, o primeiro
 * que tem as capacidades obrigatórias; entre esses, o primeiro que também tem as desejáveis (ex.:
 * `thinking` quando a pessoa pede raciocínio). Modelos fora da lista nunca são escolhidos
 * sozinhos: modelo novo exige licença e avaliação (doc 13 §6.3). Um modelo pedido pela tela
 * precisa estar instalado e ter as capacidades obrigatórias.
 */
export function chooseModel(input: {
  preferred: readonly string[];
  installed: readonly CandidateModel[];
  requires: readonly ModelCapability[];
  wants?: readonly ModelCapability[];
  requested?: string;
}): ModelChoice {
  const wants = input.wants ?? [];
  const byName = new Map(input.installed.map((model) => [normalizeModelName(model.name), model]));
  const missing = (model: CandidateModel, caps: readonly ModelCapability[]) =>
    model.capabilities === null ? [] : caps.filter((cap) => !model.capabilities?.includes(cap));

  if (input.requested !== undefined) {
    const model = byName.get(normalizeModelName(input.requested));
    if (!model) return { kind: 'not_installed', wanted: [input.requested] };
    const absent = missing(model, input.requires);
    if (absent.length > 0) return { kind: 'unsupported', model: model.name, missing: absent };
    return { kind: 'ok', model: model.name, lacking: missing(model, wants) };
  }

  const installed = input.preferred.flatMap((name) => {
    const model = byName.get(normalizeModelName(name));
    return model ? [model] : [];
  });
  const [head] = installed;
  if (!head) return { kind: 'not_installed', wanted: [...input.preferred] };
  const capable = installed.filter((model) => missing(model, input.requires).length === 0);
  const first = capable[0];
  if (!first) return { kind: 'unsupported', model: null, missing: missing(head, input.requires) };
  const best = capable.find((model) => missing(model, wants).length === 0) ?? first;
  return { kind: 'ok', model: best.name, lacking: missing(best, wants) };
}
