import type { AiTask } from '@prospector/contracts';

/** Como uma tarefa usa os modelos locais (ADR-0008). */
export interface TaskPolicy {
  /** Ordem de preferência; vale o primeiro instalado (fallback). */
  models: string[];
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
} satisfies Omit<TaskPolicy, 'models'>;

/**
 * Padrão até existir `agent_configs` no banco (KI-031); a lista do Copiloto é sobrescrita por
 * `AI_COPILOT_MODELS`. Avaliação local de 2026-11-09, recalculada com os corretores corrigidos
 * (`evals/copilot/results/2026-11-09-15-40.regraded.json`, 8 casos sintéticos × 2): qwen3.5:4b
 * 69% e nemotron-3-nano:4b 56%, intervalos sobrepostos. O Nemotron leu a injeção como conteúdo,
 * trocou o nome do produto e o cartão declara suporte só a inglês; o qwen3.5:4b também tem
 * visão, então um único modelo carregado atende conversa e imagens. Por isso qwen3.5 primeiro,
 * Nemotron de reserva. Nenhum atinge 75%: o prompt v2 vem na IA-1.1 (doc 13 §9).
 * `vision` e `embedding` ainda não têm consumidor (chegam nas fatias IA-4 e IA-5).
 */
export const DEFAULT_POLICY: ModelPolicy = {
  copilot: { ...BASE, models: ['qwen3.5:4b', 'nemotron-3-nano:4b'] },
  reasoning: { ...BASE, temperature: 0.2, models: ['qwen3.5:4b', 'nemotron-3-nano:4b'] },
  vision: { ...BASE, temperature: 0.2, models: ['qwen3.5:4b', 'qwen3-vl:8b'] },
  embedding: { ...BASE, temperature: 0, models: ['qwen3-embedding:0.6b', 'bge-m3'] },
};

/** `bge-m3` e `bge-m3:latest` são o mesmo modelo no Ollama. */
export function normalizeModelName(name: string): string {
  const lower = name.trim().toLowerCase();
  return lower.includes(':') ? lower : `${lower}:latest`;
}

/**
 * Modelo para a tarefa: o pedido explícito (se instalado) ou o primeiro instalado da lista.
 * Devolve o nome como o Ollama o conhece, ou null quando nada serve.
 */
export function resolveModel(
  preferred: readonly string[],
  installed: readonly string[],
  requested?: string,
): string | null {
  const byNormalized = new Map(installed.map((name) => [normalizeModelName(name), name]));
  if (requested !== undefined) return byNormalized.get(normalizeModelName(requested)) ?? null;
  for (const name of preferred) {
    const match = byNormalized.get(normalizeModelName(name));
    if (match) return match;
  }
  return null;
}
