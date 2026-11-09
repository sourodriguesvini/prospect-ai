import { z } from 'zod';
import { AiError } from '../errors';
import { readNdjson } from './ndjson';

/**
 * Cliente HTTP mínimo da API local do Ollama (docs.ollama.com/api), sem SDK: `fetch` +
 * validação Zod das respostas. Só fala com o endereço local configurado (ver `assertLoopback`).
 */

const Details = z
  .object({
    family: z.string(),
    parameter_size: z.string(),
    quantization_level: z.string(),
  })
  .partial();

const TagsResponse = z.object({
  models: z.array(
    z.object({
      name: z.string(),
      size: z.number(),
      digest: z.string().optional(),
      details: Details.optional(),
    }),
  ),
});

const PsResponse = z.object({
  models: z.array(
    z.object({
      name: z.string(),
      size: z.number(),
      size_vram: z.number().optional(),
      expires_at: z.string().optional(),
      context_length: z.number().optional(),
    }),
  ),
});

const ShowResponse = z.object({
  capabilities: z.array(z.string()).optional(),
  model_info: z.record(z.string(), z.unknown()).optional(),
});

const ChatChunk = z.object({
  model: z.string().optional(),
  message: z.object({ content: z.string().optional(), thinking: z.string().optional() }).optional(),
  done: z.boolean().optional(),
  done_reason: z.string().optional(),
  total_duration: z.number().optional(),
  load_duration: z.number().optional(),
  prompt_eval_count: z.number().optional(),
  eval_count: z.number().optional(),
  eval_duration: z.number().optional(),
  error: z.string().optional(),
});
export type OllamaChatChunk = z.infer<typeof ChatChunk>;

export interface OllamaModelInfo {
  name: string;
  sizeBytes: number;
  /** Hash do arquivo do modelo: identifica a versão exata usada numa avaliação. */
  digest: string | null;
  family: string | null;
  parameterSize: string | null;
  quantization: string | null;
}

export interface OllamaRunningModel {
  name: string;
  sizeBytes: number;
  vramBytes: number;
  expiresAt: string | null;
  contextLength: number | null;
}

/** Parte do `/api/show` que o Prospector usa: capacidades e metadados da arquitetura. */
export interface OllamaModelShow {
  /** null quando o Ollama não informa (versões antigas). */
  capabilities: string[] | null;
  /** Chaves do GGUF (`general.architecture`, `<arch>.context_length`, `<arch>.block_count`…). */
  modelInfo: Record<string, unknown>;
}

export interface OllamaChatRequest {
  model: string;
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  think: boolean;
  keepAlive: string;
  /** `num_predict` limita os tokens gerados (raciocínio incluído). */
  options: { num_ctx: number; temperature: number; num_predict: number };
}

export interface OllamaClient {
  readonly baseUrl: string;
  version(): Promise<string>;
  listModels(): Promise<OllamaModelInfo[]>;
  listRunning(): Promise<OllamaRunningModel[]>;
  /** Capacidades e metadados de um modelo instalado (`/api/show`); não carrega o modelo. */
  show(model: string): Promise<OllamaModelShow>;
  /** Streaming: cada pedaço como o Ollama envia; o último tem `done: true` e as métricas. */
  chat(request: OllamaChatRequest, signal: AbortSignal): AsyncGenerator<OllamaChatChunk>;
  /** Descarrega o modelo da memória agora (`keep_alive: 0`). */
  unload(model: string): Promise<void>;
}

/** Endereço padrão do Ollama no Windows (app oficial). */
export const DEFAULT_OLLAMA_URL = 'http://127.0.0.1:11434';

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]']);

const NOT_LOOPBACK =
  'OLLAMA_BASE_URL precisa apontar para este computador (127.0.0.1, localhost ou [::1]).';

/**
 * O app só conversa com um Ollama deste computador: nada de conteúdo indo para outro host.
 * A mensagem não repete o valor configurado; ele vai só no `detail` (log do servidor).
 */
export function assertLoopback(baseUrl: string): URL {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch (error) {
    throw new AiError('invalid_config', {
      message: NOT_LOOPBACK,
      detail: 'URL inválida',
      cause: error,
    });
  }
  if (!['http:', 'https:'].includes(url.protocol) || !LOOPBACK.has(url.hostname)) {
    throw new AiError('invalid_config', {
      message: NOT_LOOPBACK,
      detail: `recebido ${url.protocol}//${url.host}`,
    });
  }
  return url;
}

export function createOllamaClient(options: {
  baseUrl: string;
  fetch?: typeof fetch;
  /** Tempo máximo das chamadas curtas (versão, listas, descarregar). */
  requestTimeoutMs?: number;
}): OllamaClient {
  const base = assertLoopback(options.baseUrl);
  const baseUrl = base.origin;
  const doFetch = options.fetch ?? fetch;
  const requestTimeoutMs = options.requestTimeoutMs ?? 3000;

  async function call(path: string, init: RequestInit, signal: AbortSignal): Promise<Response> {
    let response: Response;
    try {
      // `redirect: 'error'`: um Ollama local nunca redireciona; seguir um redirecionamento
      // mandaria a conversa para outro endereço.
      response = await doFetch(`${baseUrl}${path}`, { ...init, redirect: 'error', signal });
    } catch (error) {
      if (signal.aborted) throw signal.reason ?? new AiError('cancelled');
      throw new AiError('runtime_unavailable', { detail: describe(error), cause: error });
    }
    if (response.ok) return response;
    const body = await response.text().catch(() => '');
    const message = errorMessage(body);
    if (response.status === 404 && /model .*not found|not found/i.test(message)) {
      throw new AiError('model_not_installed', {
        detail: `HTTP 404: ${message}`.slice(0, 300),
      });
    }
    throw new AiError(response.status === 400 ? 'invalid_request' : 'provider_error', {
      detail: `HTTP ${response.status}: ${message}`.slice(0, 300),
    });
  }

  async function getJson<T>(path: string, schema: z.ZodType<T>): Promise<T> {
    const signal = AbortSignal.timeout(requestTimeoutMs);
    try {
      const response = await call(path, { method: 'GET' }, signal);
      return parse(schema, await response.json(), path);
    } catch (error) {
      throw timeoutOr(error, signal);
    }
  }

  return {
    baseUrl,

    async version() {
      return (await getJson('/api/version', z.object({ version: z.string() }))).version;
    },

    async listModels() {
      const { models } = await getJson('/api/tags', TagsResponse);
      return models.map((model) => ({
        name: model.name,
        sizeBytes: model.size,
        digest: model.digest ?? null,
        family: model.details?.family ?? null,
        parameterSize: model.details?.parameter_size ?? null,
        quantization: model.details?.quantization_level ?? null,
      }));
    },

    async listRunning() {
      const { models } = await getJson('/api/ps', PsResponse);
      return models.map((model) => ({
        name: model.name,
        sizeBytes: model.size,
        vramBytes: model.size_vram ?? 0,
        expiresAt: model.expires_at ?? null,
        contextLength: model.context_length ?? null,
      }));
    },

    async show(model) {
      const signal = AbortSignal.timeout(requestTimeoutMs);
      try {
        const response = await call(
          '/api/show',
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ model }),
          },
          signal,
        );
        const parsed = parse(ShowResponse, await response.json(), '/api/show');
        return { capabilities: parsed.capabilities ?? null, modelInfo: parsed.model_info ?? {} };
      } catch (error) {
        throw timeoutOr(error, signal);
      }
    },

    async *chat(request, signal) {
      const response = await call(
        '/api/chat',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            model: request.model,
            messages: request.messages,
            stream: true,
            think: request.think,
            keep_alive: request.keepAlive,
            options: request.options,
          }),
        },
        signal,
      );
      if (!response.body) throw new AiError('provider_error', { detail: 'resposta sem corpo' });
      try {
        for await (const raw of readNdjson(response.body)) {
          const chunk = parse(ChatChunk, raw, '/api/chat');
          if (chunk.error) {
            throw new AiError('provider_error', { detail: chunk.error.slice(0, 300) });
          }
          yield chunk;
        }
      } catch (error) {
        if (signal.aborted) throw signal.reason ?? new AiError('cancelled');
        throw error;
      }
    },

    async unload(model) {
      const signal = AbortSignal.timeout(requestTimeoutMs * 5);
      try {
        await call(
          '/api/generate',
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ model, keep_alive: 0, stream: false }),
          },
          signal,
        );
      } catch (error) {
        throw timeoutOr(error, signal);
      }
    },
  };
}

function parse<T>(schema: z.ZodType<T>, raw: unknown, path: string): T {
  const result = schema.safeParse(raw);
  if (result.success) return result.data;
  throw new AiError('provider_error', { detail: `resposta inesperada de ${path}` });
}

function errorMessage(body: string): string {
  try {
    const parsed = JSON.parse(body) as { error?: unknown };
    if (typeof parsed.error === 'string') return parsed.error;
  } catch {
    // corpo não-JSON: usa o texto
  }
  return body;
}

function describe(error: unknown): string {
  if (error instanceof Error) {
    const cause = (error as Error & { cause?: { code?: string } }).cause;
    return cause?.code ? `${error.message} (${cause.code})` : error.message;
  }
  return String(error);
}

/** Estouro do tempo das chamadas curtas: o Ollama está travado ou fora do ar. */
function timeoutOr(error: unknown, signal: AbortSignal): unknown {
  if (signal.aborted && !(error instanceof AiError && error.code !== 'cancelled')) {
    return new AiError('runtime_unavailable', { detail: 'tempo esgotado', cause: error });
  }
  return error;
}
