import type { GpuSnapshot } from '@prospector/contracts';
import { AiError } from './errors';
import { kvCacheBytes, type KvProfile } from './model-catalog';

/**
 * Admissão por memória de vídeo (doc 13 §6.2 e §6.3, ADR-0008): antes de carregar um modelo que
 * ainda não está na memória, o gateway confere se ele cabe na VRAM sem invadir a reserva deixada
 * para o Windows e os programas de trabalho (Figma, navegadores). Se não couber, recusa; o
 * Prospector nunca encerra processos de outros programas para abrir espaço.
 */

/** Reserva padrão: 3 GB para o resto do computador (`AI_VRAM_RESERVE_MIB` muda). */
export const DEFAULT_VRAM_RESERVE_MIB = 3072;

/**
 * Calibração de 2026-11-09 (RTX 5060 Ti, Ollama 0.40.15, `num_ctx` 8192), medida pelo aumento da
 * memória usada no `nvidia-smi` ao carregar cada modelo: qwen3.5:4b ocupou 3.888 MiB (arquivo de
 * 3.170 MiB) e nemotron-3-nano:4b 2.873 MiB (arquivo de 2.706 MiB). A fórmula
 * arquivo × 1,05 + cache K/V + 512 MiB estima 4.097 e 3.481 MiB: sempre um pouco acima do real.
 */
const WEIGHTS_FACTOR = 1.05;
/** Contexto CUDA, buffers de cálculo e projetor de imagem. */
const RUNTIME_OVERHEAD_MIB = 512;
/** Sem metadados da arquitetura: 128 KiB por token (o de um modelo 8B denso em f16). */
const FALLBACK_KV_BYTES_PER_TOKEN = 128 * 1024;

const MiB = 1024 * 1024;

/** Memória de vídeo estimada para carregar o modelo com `numCtx` tokens de contexto. */
export function estimateModelMiB(input: {
  sizeBytes: number;
  kv: KvProfile | null;
  numCtx: number;
}): number {
  const kvBytes = input.kv
    ? kvCacheBytes(input.kv, input.numCtx)
    : FALLBACK_KV_BYTES_PER_TOKEN * input.numCtx;
  return Math.ceil((input.sizeBytes * WEIGHTS_FACTOR + kvBytes) / MiB + RUNTIME_OVERHEAD_MIB);
}

export type AdmissionDecision =
  | { admitted: true; neededMiB: number; availableMiB: number }
  /** `too_big`: nem com a GPU vazia caberia com a reserva; `no_room`: falta espaço agora. */
  | {
      admitted: false;
      reason: 'too_big' | 'no_room';
      neededMiB: number;
      availableMiB: number;
      reserveMiB: number;
      totalMiB: number;
    };

/**
 * Decide se o modelo cabe. `reclaimableMiB` é a VRAM de modelos do Ollama já carregados e ociosos
 * (o limitador garante que o Prospector não está gerando com eles). Quando a decisão depende
 * dessa memória, o gateway os descarrega antes de carregar o novo e confere de novo: não conta
 * com o Ollama fazer isso sozinho, que só acontece com `OLLAMA_MAX_LOADED_MODELS=1`.
 */
export function decideAdmission(input: {
  neededMiB: number;
  gpu: GpuSnapshot;
  reclaimableMiB: number;
  reserveMiB: number;
}): AdmissionDecision {
  const availableMiB = Math.max(0, Math.floor(input.gpu.freeMiB + input.reclaimableMiB));
  if (input.neededMiB + input.reserveMiB <= availableMiB) {
    return { admitted: true, neededMiB: input.neededMiB, availableMiB };
  }
  return {
    admitted: false,
    reason: input.neededMiB + input.reserveMiB > input.gpu.totalMiB ? 'too_big' : 'no_room',
    neededMiB: input.neededMiB,
    availableMiB,
    reserveMiB: input.reserveMiB,
    totalMiB: input.gpu.totalMiB,
  };
}

/** "3,9" (GB com uma casa, vírgula decimal), a partir de MiB. */
export function gigabytes(mib: number): string {
  return (mib / 1024).toFixed(1).replace('.', ',');
}

/**
 * Erro mostrado na conversa: diz quanto falta e o que a pessoa pode fazer. Modelo que nunca cabe
 * nesta placa vira `model_too_large` (repetir não adianta); falta de espaço agora, `insufficient_vram`.
 */
export function insufficientVramError(
  model: string,
  decision: Extract<AdmissionDecision, { admitted: false }>,
): AiError {
  const needed = gigabytes(decision.neededMiB);
  const reserve = gigabytes(decision.reserveMiB);
  const message =
    decision.reason === 'too_big'
      ? `O modelo ${model} precisa de cerca de ${needed} GB de memória de vídeo e não cabe nesta placa (${gigabytes(decision.totalMiB)} GB) sem invadir os ${reserve} GB reservados para os outros programas. Escolha um modelo menor em Modelo (os tamanhos aparecem em Instalados, no painel IA local).`
      : `O modelo ${model} precisa de cerca de ${needed} GB de memória de vídeo, mas a placa tem ${gigabytes(decision.availableMiB)} GB disponíveis e ${reserve} GB ficam reservados para os outros programas. Feche o que estiver usando a GPU (Figma, Premiere ou After Effects, navegador com muitas abas, jogos) ou escolha um modelo menor, e tente de novo. O Prospector não fecha programas por conta própria.`;
  return new AiError(decision.reason === 'too_big' ? 'model_too_large' : 'insufficient_vram', {
    message,
    detail: `precisa ${decision.neededMiB} MiB + reserva ${decision.reserveMiB} MiB; disponível ${decision.availableMiB} MiB de ${decision.totalMiB} MiB`,
  });
}

/** Aviso quando não dá para medir a GPU (sem NVIDIA ou `nvidia-smi` sem resposta). */
export const UNMEASURED_VRAM_NOTICE =
  'Não foi possível medir a memória de vídeo (o Prospector lê a placa pelo nvidia-smi, que só existe em placas NVIDIA). O modelo vai ser carregado sem conferir a reserva para os outros programas.';
