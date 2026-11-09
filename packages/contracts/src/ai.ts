import { z } from 'zod';

/**
 * Contratos da IA local (ADR-0008). O gateway em `@prospector/agents` escolhe o modelo por
 * tarefa; a interface e as rotas só conhecem estes formatos.
 */

/** Tipos de tarefa que pedem modelo. Cada um tem sua lista de modelos preferidos (fallback). */
export const AiTask = z.enum(['copilot', 'reasoning', 'vision', 'embedding']);
export type AiTask = z.infer<typeof AiTask>;

/** Motivos estáveis de falha da IA local, com mensagem em pt-BR em `AI_ERROR_MESSAGES`. */
export const AiErrorCode = z.enum([
  'runtime_unavailable',
  'model_not_installed',
  'busy',
  'timeout',
  'cancelled',
  'invalid_request',
  'provider_error',
]);
export type AiErrorCode = z.infer<typeof AiErrorCode>;

export const AI_ERROR_MESSAGES: Record<AiErrorCode, string> = {
  runtime_unavailable:
    'O Ollama não está respondendo neste computador. Abra o app do Ollama e tente de novo.',
  model_not_installed:
    'O modelo escolhido não está instalado no Ollama. Escolha outro em Modelo ou clique em Atualizar.',
  busy: 'A IA local está ocupada com outros pedidos. Espere alguns segundos e tente de novo.',
  timeout:
    'O modelo demorou demais e o pedido foi interrompido. Tente de novo; se repetir, desligue "Pensar antes de responder" ou escolha um modelo menor.',
  cancelled: 'Resposta interrompida.',
  invalid_request: 'O pedido não está no formato esperado.',
  provider_error:
    'O Ollama devolveu um erro ao gerar a resposta. Tente de novo; se repetir, feche e abra o Ollama.',
};

/**
 * Nome de modelo do Ollama (`familia:tag`, opcionalmente com namespace). Só caracteres seguros:
 * o nome vai para a API local e para a interface.
 */
export const ModelName = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[a-z0-9][a-z0-9._\-/]*(:[a-z0-9][a-z0-9._-]*)?$/i, {
    error: 'Nome de modelo inválido.',
  });

export const ChatMessage = z.object({
  role: z.enum(['user', 'assistant']),
  content: z
    .string()
    .trim()
    .min(1, { error: 'Mensagem vazia.' })
    .max(8000, { error: 'Mensagem longa demais (máximo de 8.000 caracteres).' }),
});
export type ChatMessage = z.infer<typeof ChatMessage>;

/** Mensagens mais antigas que isso ficam fora do pedido (a interface corta antes de enviar). */
export const COPILOT_HISTORY_LIMIT = 24;

export const CopilotRequest = z.object({
  schemaVersion: z.literal(1),
  messages: z
    .array(ChatMessage)
    .min(1)
    .max(COPILOT_HISTORY_LIMIT)
    .refine((messages) => messages.at(-1)?.role === 'user', {
      error: 'A última mensagem precisa ser do usuário.',
    }),
  /** Modelo escolhido na tela; sem ele, o gateway usa o primeiro instalado da política. */
  model: ModelName.optional(),
  /** Pede o raciocínio do modelo (mais lento). Desligado por padrão. */
  think: z.boolean().default(false),
});
export type CopilotRequest = z.infer<typeof CopilotRequest>;
export type CopilotRequestInput = z.input<typeof CopilotRequest>;

export const GenerationUsage = z.object({
  inputTokens: z.number().int().nonnegative().nullable(),
  outputTokens: z.number().int().nonnegative().nullable(),
  /** Tempo total no servidor de modelos, em milissegundos. */
  totalMs: z.number().nonnegative().nullable(),
  /** Parte do tempo gasta carregando o modelo na memória (0 se já estava carregado). */
  loadMs: z.number().nonnegative().nullable(),
  outputTokensPerSecond: z.number().nonnegative().nullable(),
});
export type GenerationUsage = z.infer<typeof GenerationUsage>;

/** Eventos enviados ao navegador, um JSON por linha (`application/x-ndjson`). */
export const CopilotEvent = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('start'),
    model: z.string(),
    promptVersion: z.string(),
    traceId: z.string(),
  }),
  /** Esperando vaga: a IA local atende um pedido por vez (ADR-0008). */
  z.object({ type: z.literal('queued'), position: z.number().int().positive() }),
  /** Aviso que não impede a resposta (ex.: modelo não cabe inteiro na GPU livre). */
  z.object({ type: z.literal('notice'), message: z.string() }),
  z.object({ type: z.literal('thinking'), text: z.string() }),
  z.object({ type: z.literal('delta'), text: z.string() }),
  z.object({
    type: z.literal('done'),
    model: z.string(),
    /** Motivo informado pelo Ollama (`stop`, `length`…); `length` = resposta cortada. */
    doneReason: z.string().nullable(),
    usage: GenerationUsage,
  }),
  z.object({ type: z.literal('error'), code: AiErrorCode, message: z.string() }),
]);
export type CopilotEvent = z.infer<typeof CopilotEvent>;

export const LocalModel = z.object({
  name: ModelName,
  sizeBytes: z.number().int().nonnegative(),
  family: z.string().nullable(),
  parameterSize: z.string().nullable(),
  quantization: z.string().nullable(),
});
export type LocalModel = z.infer<typeof LocalModel>;

export const LoadedModel = z.object({
  name: ModelName,
  sizeBytes: z.number().int().nonnegative(),
  vramBytes: z.number().int().nonnegative(),
  /** ISO 8601; quando o Ollama vai descarregar o modelo sozinho. */
  expiresAt: z.string().nullable(),
  contextLength: z.number().int().positive().nullable(),
});
export type LoadedModel = z.infer<typeof LoadedModel>;

/** Leitura da GPU pelo `nvidia-smi`; null quando não há GPU NVIDIA ou a leitura falhou. */
export const GpuSnapshot = z.object({
  name: z.string(),
  totalMiB: z.number().nonnegative(),
  usedMiB: z.number().nonnegative(),
  freeMiB: z.number().nonnegative(),
});
export type GpuSnapshot = z.infer<typeof GpuSnapshot>;

export const TaskRouting = z.object({
  task: AiTask,
  /** Ordem de preferência configurada. */
  preferred: z.array(ModelName),
  /** Primeiro modelo da lista que está instalado; null = tarefa indisponível. */
  resolved: ModelName.nullable(),
});
export type TaskRouting = z.infer<typeof TaskRouting>;

export const AiRuntimeStatus = z.discriminatedUnion('state', [
  z.object({
    state: z.literal('online'),
    provider: z.literal('ollama'),
    version: z.string(),
    installed: z.array(LocalModel),
    loaded: z.array(LoadedModel),
    routing: z.array(TaskRouting),
    gpu: GpuSnapshot.nullable(),
    limits: z.object({ maxConcurrent: z.number().int().positive(), maxQueue: z.number().int() }),
  }),
  z.object({
    state: z.literal('offline'),
    provider: z.literal('ollama'),
    message: z.string(),
    gpu: GpuSnapshot.nullable(),
  }),
]);
export type AiRuntimeStatus = z.infer<typeof AiRuntimeStatus>;
