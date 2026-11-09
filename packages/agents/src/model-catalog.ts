import { ModelCapability } from '@prospector/contracts';
import type { OllamaClient, OllamaModelInfo, OllamaModelShow } from './ollama/client';

/**
 * Quanto cada token de contexto ocupa no cache K/V do modelo, separado por tipo de camada.
 * Modelos novos misturam camadas: o Qwen 3.5 só tem atenção completa a cada 4 camadas (as
 * outras são recorrentes), o Nemotron-H tem poucas camadas de atenção entre camadas Mamba e o
 * Gemma usa janela deslizante na maioria delas. Somar tudo como atenção completa superestimaria
 * o cache várias vezes.
 */
export interface KvProfile {
  /** Bytes por token nas camadas de atenção completa (crescem com `num_ctx`). */
  fullBytesPerToken: number;
  /** Bytes por token nas camadas de janela deslizante (param de crescer em `slidingWindow`). */
  slidingBytesPerToken: number;
  slidingWindow: number;
}

/** O que o Prospector usa do `/api/show` de um modelo instalado. */
export interface ModelDetails {
  /** null = o Ollama não informou ou a leitura falhou (tratado como "não sei"). */
  capabilities: ModelCapability[] | null;
  /** Contexto máximo de treino, em tokens. */
  contextLength: number | null;
  /** null = a arquitetura não trouxe os campos necessários; a admissão usa uma reserva genérica. */
  kv: KvProfile | null;
}

export const UNKNOWN_DETAILS: ModelDetails = { capabilities: null, contextLength: null, kv: null };

/** O Ollama guarda o cache K/V em f16 por padrão (`OLLAMA_KV_CACHE_TYPE` vazio). */
const KV_BYTES_PER_ELEMENT = 2;

/**
 * Metadados vêm do arquivo GGUF, que pode ser de terceiros: só aceitamos inteiros positivos até
 * um teto plausível. Sem teto, um `block_count` adulterado travaria o laço abaixo (e o servidor).
 */
function boundedInt(value: unknown, max: number): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= max
    ? value
    : null;
}

const MAX_LAYERS = 1024;
const MAX_HEADS = 4096;
const MAX_HEAD_DIM = 16_384;
const MAX_EMBEDDING = 1_048_576;
/** 2^21 tokens: acima disso o valor não é de um modelo que roda neste computador. */
export const MAX_CONTEXT_LENGTH = 2_097_152;

/** Lê o perfil do cache K/V das chaves GGUF (`<arquitetura>.attention.*`). */
export function kvProfileOf(modelInfo: Record<string, unknown>): KvProfile | null {
  const arch = modelInfo['general.architecture'];
  if (typeof arch !== 'string' || !arch) return null;
  const get = (key: string): unknown => modelInfo[`${arch}.${key}`];

  const blocks = boundedInt(get('block_count'), MAX_LAYERS);
  const kvHeads = get('attention.head_count_kv');
  if (!blocks || (typeof kvHeads !== 'number' && !Array.isArray(kvHeads))) return null;

  const heads = boundedInt(get('attention.head_count'), MAX_HEADS);
  const embedding = boundedInt(get('embedding_length'), MAX_EMBEDDING);
  const headDim = heads && embedding ? embedding / heads : null;
  const keyLength = boundedInt(get('attention.key_length'), MAX_HEAD_DIM) ?? headDim;
  const valueLength = boundedInt(get('attention.value_length'), MAX_HEAD_DIM) ?? headDim;
  if (!keyLength || !valueLength) return null;
  const keyLengthSwa = boundedInt(get('attention.key_length_swa'), MAX_HEAD_DIM) ?? keyLength;
  const valueLengthSwa = boundedInt(get('attention.value_length_swa'), MAX_HEAD_DIM) ?? valueLength;

  // Qwen 3.5 / Qwen3-Next: atenção completa só nas camadas em que (i + 1) % intervalo === 0.
  const interval = boundedInt(get('full_attention_interval'), MAX_LAYERS);
  const window = boundedInt(get('attention.sliding_window'), MAX_CONTEXT_LENGTH);
  const pattern = get('attention.sliding_window_pattern');
  const isSliding = (layer: number): boolean => {
    if (!window) return false;
    if (Array.isArray(pattern)) return pattern[layer] === true;
    // Padrão como período (Gemma 3): a cada N camadas, uma é de atenção completa.
    const period = boundedInt(pattern, MAX_LAYERS);
    if (period) return (layer + 1) % period !== 0;
    return false; // janela sem padrão: conta como completa (estimativa para cima)
  };

  let full = 0;
  let sliding = 0;
  for (let layer = 0; layer < blocks; layer += 1) {
    if (interval && (layer + 1) % interval !== 0) continue;
    const raw: unknown = Array.isArray(kvHeads) ? kvHeads[layer] : kvHeads;
    const count = boundedInt(raw, MAX_HEADS) ?? 0;
    if (count === 0) continue; // camada sem atenção (Mamba, recorrente)
    if (isSliding(layer)) sliding += count * (keyLengthSwa + valueLengthSwa);
    else full += count * (keyLength + valueLength);
  }
  // Nenhuma camada com atenção: metadado estranho; melhor a estimativa genérica (para cima).
  if (full === 0 && sliding === 0) return null;
  return {
    fullBytesPerToken: full * KV_BYTES_PER_ELEMENT,
    slidingBytesPerToken: sliding * KV_BYTES_PER_ELEMENT,
    slidingWindow: window ?? 0,
  };
}

/** Bytes do cache K/V para `numCtx` tokens. */
export function kvCacheBytes(kv: KvProfile, numCtx: number): number {
  return (
    kv.fullBytesPerToken * numCtx + kv.slidingBytesPerToken * Math.min(numCtx, kv.slidingWindow)
  );
}

/** Interpreta a resposta do `/api/show`; capacidades desconhecidas pelo contrato são ignoradas. */
export function parseModelShow(show: OllamaModelShow): ModelDetails {
  const capabilities =
    show.capabilities === null
      ? null
      : show.capabilities.flatMap((value) => {
          const parsed = ModelCapability.safeParse(value);
          return parsed.success ? [parsed.data] : [];
        });
  const arch = show.modelInfo['general.architecture'];
  const contextLength =
    typeof arch === 'string'
      ? boundedInt(show.modelInfo[`${arch}.context_length`], MAX_CONTEXT_LENGTH)
      : null;
  return { capabilities, contextLength, kv: kvProfileOf(show.modelInfo) };
}

export interface ModelCatalog {
  /**
   * Capacidades, contexto e perfil do cache de um modelo instalado. Lido uma vez por arquivo de
   * modelo (nome + digest: um `ollama pull` novo troca o digest e invalida a leitura). Nunca
   * lança: se o Ollama não responder, devolve "não sei" e tenta de novo na próxima vez.
   */
  details(model: Pick<OllamaModelInfo, 'name' | 'digest'>): Promise<ModelDetails>;
}

export function createModelCatalog(client: Pick<OllamaClient, 'show'>): ModelCatalog {
  const cache = new Map<string, Promise<ModelDetails>>();
  return {
    details(model) {
      const key = `${model.name}@${model.digest ?? '?'}`;
      let hit = cache.get(key);
      if (!hit) {
        hit = client.show(model.name).then(parseModelShow, () => {
          cache.delete(key);
          return UNKNOWN_DETAILS;
        });
        cache.set(key, hit);
      }
      return hit;
    },
  };
}
