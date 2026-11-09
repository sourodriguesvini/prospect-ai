import type { AiRuntimeStatus, AiTask, GenerationUsage } from '@prospector/contracts';
import { AiError, toAiError } from './errors';
import type { GpuProbe } from './gpu';
import type { Limiter, LimiterTicket } from './limiter';
import { resolveModel, type ModelPolicy } from './model-policy';
import type { OllamaChatChunk, OllamaClient } from './ollama/client';
import { neutralizeControlTokens } from './sanitize';

export interface GatewayMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export type GatewayEvent =
  | { type: 'queued'; position: number }
  | { type: 'start'; model: string }
  | { type: 'notice'; message: string }
  | { type: 'thinking'; text: string }
  | { type: 'delta'; text: string }
  | { type: 'done'; model: string; doneReason: string | null; usage: GenerationUsage };

export interface ChatInput {
  messages: GatewayMessage[];
  /** Modelo pedido pela tela; precisa estar instalado. */
  model?: string;
  think: boolean;
}

/**
 * Único ponto de chamada a modelos de linguagem (CLAUDE.md, ADR-0003 e ADR-0008): escolhe o
 * modelo por tarefa, limita a concorrência, aplica tempos máximos e traduz falhas.
 */
export interface LocalAiGateway {
  status(): Promise<AiRuntimeStatus>;
  chat(task: AiTask, input: ChatInput, signal?: AbortSignal): AsyncGenerator<GatewayEvent>;
  /** Tira o modelo da memória (GPU/RAM) agora. */
  unload(model: string): Promise<void>;
}

const MiB = 1024 * 1024;

export function createLocalAiGateway(deps: {
  client: OllamaClient;
  policy: ModelPolicy;
  limiter: Limiter;
  limits: { maxConcurrent: number; maxQueue: number };
  gpu: GpuProbe;
}): LocalAiGateway {
  const { client, policy, limiter, gpu } = deps;

  async function installedNames(): Promise<string[]> {
    return (await client.listModels()).map((model) => model.name);
  }

  /** Aviso honesto quando o modelo não cabe na VRAM livre: o Ollama joga parte na CPU. */
  async function memoryNotice(model: string): Promise<string | null> {
    const [running, installed, snapshot] = await Promise.all([
      client.listRunning().catch(() => []),
      client.listModels().catch(() => []),
      gpu(),
    ]);
    if (!snapshot || running.some((entry) => entry.name === model)) return null;
    const size = installed.find((entry) => entry.name === model)?.sizeBytes;
    if (!size) return null;
    // Pesos + contexto: o tamanho em disco subestima um pouco o uso real.
    const neededMiB = (size / MiB) * 1.15;
    if (neededMiB <= snapshot.freeMiB) return null;
    const gb = (mib: number) => (mib / 1024).toFixed(1).replace('.', ',');
    return `O modelo ${model} precisa de cerca de ${gb(neededMiB)} GB e a GPU tem ${gb(snapshot.freeMiB)} GB livres agora. Parte dele vai rodar na CPU e a resposta fica mais lenta.`;
  }

  return {
    async status() {
      const snapshot = await gpu();
      let version: string;
      try {
        version = await client.version();
      } catch (error) {
        return {
          state: 'offline',
          provider: 'ollama',
          message: toAiError(error).message,
          gpu: snapshot,
        };
      }
      const [installed, loaded] = await Promise.all([client.listModels(), client.listRunning()]);
      const names = installed.map((model) => model.name);
      return {
        state: 'online',
        provider: 'ollama',
        version,
        installed,
        loaded,
        routing: (Object.keys(policy) as AiTask[]).map((task) => ({
          task,
          preferred: policy[task].models,
          resolved: resolveModel(policy[task].models, names),
        })),
        gpu: snapshot,
        limits: deps.limits,
      };
    },

    async *chat(task, input, signal) {
      const taskPolicy = policy[task];
      const model = resolveModel(taskPolicy.models, await installedNames(), input.model);
      if (!model) {
        const wanted = input.model ? [input.model] : taskPolicy.models;
        throw new AiError('model_not_installed', {
          message: `Nenhum destes modelos está instalado: ${wanted.join(', ')}. Instale com "ollama pull ${wanted[0] ?? ''}".`,
        });
      }

      const controller = new AbortController();
      const abortFromCaller = () => controller.abort(new AiError('cancelled'));
      signal?.addEventListener('abort', abortFromCaller, { once: true });
      const timers = new Set<ReturnType<typeof setTimeout>>();
      const deadline = (ms: number) => {
        const timer = setTimeout(() => controller.abort(new AiError('timeout')), ms);
        timers.add(timer);
        return timer;
      };
      const clear = (timer: ReturnType<typeof setTimeout>) => {
        clearTimeout(timer);
        timers.delete(timer);
      };
      // Texto do usuário e respostas anteriores não podem carregar marcas de papel do modelo.
      const messages = input.messages.map((message) =>
        message.role === 'system'
          ? message
          : { ...message, content: neutralizeControlTokens(message.content) },
      );

      // A fila fica dentro do `try`: se quem consome desistir enquanto espera (`return()` no
      // gerador), o `finally` tira o pedido da fila em vez de deixar a vaga presa.
      let ticket: LimiterTicket | null = null;
      let release: (() => void) | null = null;
      try {
        ticket = limiter.enqueue(signal);
        if (ticket.position > 0) yield { type: 'queued', position: ticket.position };
        release = await ticket.ready;

        if (signal?.aborted) throw new AiError('cancelled');
        const notice = await memoryNotice(model);
        yield { type: 'start', model };
        if (notice) yield { type: 'notice', message: notice };

        deadline(taskPolicy.totalTimeoutMs);
        let idle = deadline(taskPolicy.firstTokenTimeoutMs);
        let last: OllamaChatChunk | null = null;
        const stream = client.chat(
          {
            model,
            messages,
            think: input.think,
            keepAlive: taskPolicy.keepAlive,
            options: {
              num_ctx: taskPolicy.numCtx,
              temperature: taskPolicy.temperature,
              num_predict: input.think
                ? taskPolicy.maxOutputTokensThinking
                : taskPolicy.maxOutputTokens,
            },
          },
          controller.signal,
        );
        for await (const chunk of stream) {
          clear(idle);
          idle = deadline(taskPolicy.idleTimeoutMs);
          const thinking = chunk.message?.thinking;
          const content = chunk.message?.content;
          if (thinking) yield { type: 'thinking', text: thinking };
          if (content) yield { type: 'delta', text: content };
          if (chunk.done) last = chunk;
        }
        if (!last) throw new AiError('provider_error', { detail: 'stream terminou sem done' });
        yield {
          type: 'done',
          model,
          doneReason: last.done_reason ?? null,
          usage: usageOf(last),
        };
      } catch (error) {
        const reason: unknown = controller.signal.aborted ? controller.signal.reason : undefined;
        throw reason instanceof AiError ? reason : toAiError(error);
      } finally {
        for (const timer of timers) clearTimeout(timer);
        signal?.removeEventListener('abort', abortFromCaller);
        if (!controller.signal.aborted) controller.abort(new AiError('cancelled'));
        if (release) release();
        else ticket?.cancel();
      }
    },

    async unload(model) {
      await client.unload(model);
      // O Ollama responde antes de liberar a memória; espera o modelo sair da lista de
      // carregados para a próxima leitura da GPU já mostrar a VRAM devolvida.
      const deadline = Date.now() + UNLOAD_WAIT_MS;
      while (Date.now() < deadline) {
        const running = await client.listRunning().catch(() => []);
        if (!running.some((entry) => entry.name === model)) break;
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      gpu.invalidate?.();
    },
  };
}

const NS_PER_MS = 1_000_000;
const UNLOAD_WAIT_MS = 3000;

function usageOf(chunk: OllamaChatChunk): GenerationUsage {
  const evalSeconds = chunk.eval_duration ? chunk.eval_duration / 1e9 : null;
  return {
    inputTokens: chunk.prompt_eval_count ?? null,
    outputTokens: chunk.eval_count ?? null,
    totalMs: chunk.total_duration !== undefined ? chunk.total_duration / NS_PER_MS : null,
    loadMs: chunk.load_duration !== undefined ? chunk.load_duration / NS_PER_MS : null,
    outputTokensPerSecond:
      evalSeconds && chunk.eval_count !== undefined
        ? Math.round((chunk.eval_count / evalSeconds) * 10) / 10
        : null,
  };
}
