import {
  MODEL_CAPABILITY_LABELS,
  type AiRuntimeLimits,
  type AiRuntimeStatus,
  type AiTask,
  type CopilotEvent,
  type LocalModel,
} from '@prospector/contracts';
import {
  decideAdmission,
  estimateModelMiB,
  insufficientVramError,
  UNMEASURED_VRAM_NOTICE,
} from './admission';
import { droppedNotice, fitToContext, type BudgetMessage } from './context-budget';
import { AiError, toAiError } from './errors';
import type { GpuProbe } from './gpu';
import type { Limiter, LimiterTicket } from './limiter';
import {
  createModelCatalog,
  UNKNOWN_DETAILS,
  type ModelCatalog,
  type ModelDetails,
} from './model-catalog';
import {
  chooseModel,
  normalizeModelName,
  type ModelChoice,
  type ModelPolicy,
  type TaskPolicy,
} from './model-policy';
import type { OllamaChatChunk, OllamaClient, OllamaModelInfo } from './ollama/client';
import { neutralizeControlTokens } from './sanitize';

/** Mesma forma que o orçamento de contexto e o cliente do Ollama usam. */
export type GatewayMessage = BudgetMessage;

type CopilotStart = Extract<CopilotEvent, { type: 'start' }>;

/**
 * Eventos do gateway: os do contrato `CopilotEvent`, menos o que só o Copiloto conhece (versão do
 * prompt e trace no `start`) e o `error`, que o gateway lança como `AiError`. Derivado do contrato
 * para que uma mudança nos eventos da tela apareça aqui na compilação.
 */
export type GatewayEvent =
  | Exclude<CopilotEvent, { type: 'start' } | { type: 'error' }>
  | Pick<CopilotStart, 'type' | 'model'>;

export interface ChatInput {
  messages: GatewayMessage[];
  /** Modelo pedido pela tela; precisa estar instalado e ter as capacidades da tarefa. */
  model?: string;
  think: boolean;
}

/** Mesmos limites que o estado mostra na tela (contrato `AiRuntimeLimits`). */
export type GatewayLimits = AiRuntimeLimits;

/**
 * Único ponto de chamada a modelos de linguagem (CLAUDE.md, ADR-0003 e ADR-0008): escolhe o
 * modelo por tarefa e capacidade, confere a memória de vídeo antes de carregar, corta o histórico
 * para caber no contexto, limita a concorrência, aplica tempos máximos e traduz falhas.
 */
export interface LocalAiGateway {
  status(): Promise<AiRuntimeStatus>;
  chat(task: AiTask, input: ChatInput, signal?: AbortSignal): AsyncGenerator<GatewayEvent>;
  /**
   * Tira o modelo da memória (GPU/RAM) agora. `true` só quando a lista de carregados do Ollama
   * confirmou a saída; `false` quando o modelo ainda aparece ou a lista não pôde ser lida.
   */
  unload(model: string): Promise<boolean>;
}

const MiB = 1024 * 1024;

export function createLocalAiGateway(deps: {
  client: OllamaClient;
  policy: ModelPolicy;
  limiter: Limiter;
  limits: GatewayLimits;
  gpu: GpuProbe;
  /** Leitura do `/api/show` com cache; padrão: uma por gateway. */
  catalog?: ModelCatalog;
}): LocalAiGateway {
  const { client, policy, limiter, gpu } = deps;
  const catalog = deps.catalog ?? createModelCatalog(client);

  /** Detalhes só dos modelos que podem ser escolhidos (a lista da tarefa e o pedido). */
  async function describeCandidates(
    taskPolicy: TaskPolicy,
    installed: readonly OllamaModelInfo[],
    requested: string | undefined,
  ): Promise<Map<string, ModelDetails>> {
    const wanted = new Set(
      [...taskPolicy.models, ...(requested === undefined ? [] : [requested])].map(
        normalizeModelName,
      ),
    );
    const candidates = installed.filter((model) => wanted.has(normalizeModelName(model.name)));
    const details = await Promise.all(candidates.map((model) => catalog.details(model)));
    return new Map(
      candidates.map((model, index) => [model.name, details[index] ?? UNKNOWN_DETAILS]),
    );
  }

  const sameModel = (a: string, b: string) => normalizeModelName(a) === normalizeModelName(b);

  /**
   * Pede ao Ollama para descarregar e espera o modelo sair da lista de carregados. Devolve se a
   * saída foi confirmada (lista lida e sem o modelo).
   */
  async function unloadAndWait(model: string): Promise<boolean> {
    await client.unload(model);
    // O Ollama responde antes de liberar a memória; sem esperar, a próxima leitura da GPU ainda
    // mostraria a VRAM ocupada.
    const deadline = Date.now() + UNLOAD_WAIT_MS;
    let confirmed = false;
    while (Date.now() < deadline) {
      const running = await client.listRunning().catch(() => null);
      if (running && !running.some((entry) => sameModel(entry.name, model))) {
        confirmed = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    gpu.invalidate?.();
    return confirmed;
  }

  /**
   * Admissão por VRAM (IA-1.1). Modelo já carregado com o mesmo contexto não passa pela conta. Sem
   * leitura da GPU, carrega e devolve um aviso explícito. Se só couber com a memória dos modelos
   * ociosos do Ollama, descarrega esses modelos antes e confere de novo. Sem espaço, lança
   * `insufficient_vram`. Devolve avisos para a tela.
   */
  async function admit(
    model: OllamaModelInfo,
    details: ModelDetails,
    numCtx: number,
  ): Promise<string[]> {
    const [running, snapshot] = await Promise.all([client.listRunning().catch(() => null), gpu()]);
    const loaded = running?.find((entry) => sameModel(entry.name, model.name));
    if (loaded && (loaded.contextLength === null || loaded.contextLength === numCtx)) return [];
    if (!snapshot) return [UNMEASURED_VRAM_NOTICE];
    const neededMiB = estimateModelMiB({ sizeBytes: model.sizeBytes, kv: details.kv, numCtx });
    const reserveMiB = deps.limits.vramReserveMiB;
    // Sem a lista de carregados, não conta com memória a recuperar (estimativa para baixo).
    const idle = running ?? [];
    const decision = decideAdmission({
      neededMiB,
      gpu: snapshot,
      reclaimableMiB: idle.reduce((total, entry) => total + entry.vramBytes, 0) / MiB,
      reserveMiB,
    });
    if (!decision.admitted) throw insufficientVramError(model.name, decision);
    if (neededMiB + reserveMiB <= snapshot.freeMiB || idle.length === 0) return [];

    // Só cabe tirando os ociosos da memória: tira e confere com a leitura nova da GPU.
    for (const entry of idle) await unloadAndWait(entry.name);
    const after = await gpu();
    if (after) {
      const recheck = decideAdmission({ neededMiB, gpu: after, reclaimableMiB: 0, reserveMiB });
      if (!recheck.admitted) throw insufficientVramError(model.name, recheck);
    }
    const names = idle.map((entry) => entry.name).join(', ');
    return [
      idle.length === 1
        ? `Para caber na placa de vídeo, o modelo ${names} saiu da memória antes de carregar ${model.name}.`
        : `Para caber na placa de vídeo, os modelos ${names} saíram da memória antes de carregar ${model.name}.`,
    ];
  }

  return {
    async status() {
      const snapshot = await gpu();
      const offline = (error: unknown, message?: string): AiRuntimeStatus => {
        const failure = toAiError(error);
        return {
          state: 'offline',
          provider: 'ollama',
          code: failure.code,
          message: message ?? failure.message,
          gpu: snapshot,
        };
      };
      let version: string;
      try {
        version = await client.version();
      } catch (error) {
        // Fora do ar tem mensagem própria; qualquer outra falha aqui não é "ao gerar a resposta".
        return toAiError(error).code === 'runtime_unavailable'
          ? offline(error)
          : offline(
              error,
              'O Ollama respondeu com erro. Feche e abra o Ollama e clique em Atualizar.',
            );
      }
      let installed: OllamaModelInfo[];
      try {
        installed = await client.listModels();
      } catch (error) {
        return offline(
          error,
          'O Ollama respondeu, mas não informou os modelos instalados. Feche e abra o Ollama e clique em Atualizar.',
        );
      }
      // A lista de carregados e as capacidades são informação extra: se falharem, o estado
      // continua online e a tela diz o que não pôde ser lido, em vez de cair inteira.
      const [loaded, details] = await Promise.all([
        client.listRunning().catch(() => null),
        Promise.all(installed.map((model) => catalog.details(model))),
      ]);
      const models: LocalModel[] = installed.map((model, index) => ({
        name: model.name,
        sizeBytes: model.sizeBytes,
        family: model.family,
        parameterSize: model.parameterSize,
        quantization: model.quantization,
        capabilities: details[index]?.capabilities ?? null,
        contextLength: details[index]?.contextLength ?? null,
      }));
      return {
        state: 'online',
        provider: 'ollama',
        version,
        installed: models,
        loaded,
        routing: (Object.keys(policy) as AiTask[]).map((task) => {
          const choice = chooseModel({
            preferred: policy[task].models,
            installed: models,
            requires: policy[task].requires,
          });
          return {
            task,
            preferred: policy[task].models,
            requires: [...policy[task].requires],
            resolved: choice.kind === 'ok' ? choice.model : null,
          };
        }),
        gpu: snapshot,
        limits: deps.limits,
      };
    },

    async *chat(task, input, signal) {
      const taskPolicy = policy[task];
      const installed = await client.listModels();
      const details = await describeCandidates(taskPolicy, installed, input.model);
      const choice = chooseModel({
        preferred: taskPolicy.models,
        installed: installed.map((model) => ({
          name: model.name,
          capabilities: details.get(model.name)?.capabilities ?? null,
        })),
        requires: taskPolicy.requires,
        wants: input.think ? ['thinking'] : [],
        requested: input.model,
      });
      if (choice.kind !== 'ok') throw choiceError(choice, input.model, taskPolicy);
      const model = choice.model;
      const info = installed.find((entry) => entry.name === model);
      if (!info) throw new AiError('model_not_installed');
      const modelDetails = details.get(model) ?? UNKNOWN_DETAILS;

      const notices: string[] = [];
      const think = input.think && !choice.lacking.includes('thinking');
      if (input.think && !think) {
        notices.push(
          `O modelo ${model} não tem modo de raciocínio; a resposta vem sem "Pensar antes de responder".`,
        );
      }
      // Nunca pede mais contexto do que o modelo foi treinado para usar.
      const numCtx = Math.min(taskPolicy.numCtx, modelDetails.contextLength ?? taskPolicy.numCtx);
      // Texto do usuário e respostas anteriores não podem carregar marcas de papel do modelo.
      const sanitized = input.messages.map((message) =>
        message.role === 'system'
          ? message
          : { ...message, content: neutralizeControlTokens(message.content) },
      );
      const plan = fitToContext(sanitized, {
        numCtx,
        maxOutputTokens: think ? taskPolicy.maxOutputTokensThinking : taskPolicy.maxOutputTokens,
      });
      if (plan.dropped > 0) notices.push(droppedNotice(plan.dropped));

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

      // A fila fica dentro do `try`: se quem consome desistir enquanto espera (`return()` no
      // gerador), o `finally` tira o pedido da fila em vez de deixar a vaga presa.
      let ticket: LimiterTicket | null = null;
      let release: (() => void) | null = null;
      let loadedNow = false;
      try {
        ticket = limiter.enqueue(signal);
        let position = ticket.position;
        if (position > 0) {
          yield { type: 'queued', position };
          let queueTimer: ReturnType<typeof setTimeout> | undefined;
          const gaveUp = new Promise<never>((_resolve, reject) => {
            queueTimer = setTimeout(
              () => reject(queueTimeoutError(taskPolicy.queueTimeoutMs)),
              taskPolicy.queueTimeoutMs,
            );
          });
          gaveUp.catch(() => undefined);
          try {
            while (!release) {
              // Confere antes de esperar: a fila pode ter andado enquanto o evento era lido.
              const now = ticket.position;
              if (now > 0 && now !== position) {
                position = now;
                yield { type: 'queued', position };
                continue;
              }
              release = await Promise.race([ticket.ready, ticket.moved().then(() => null), gaveUp]);
            }
          } finally {
            clearTimeout(queueTimer);
          }
        } else {
          release = await ticket.ready;
        }

        if (signal?.aborted) throw new AiError('cancelled');
        notices.unshift(...(await admit(info, modelDetails, numCtx)));
        loadedNow = true;
        yield { type: 'start', model };
        for (const message of notices) yield { type: 'notice', message };

        deadline(taskPolicy.totalTimeoutMs);
        let idle = deadline(taskPolicy.firstTokenTimeoutMs);
        let last: OllamaChatChunk | null = null;
        const stream = client.chat(
          {
            model,
            messages: plan.messages,
            think,
            keepAlive: taskPolicy.keepAlive,
            options: {
              num_ctx: numCtx,
              temperature: taskPolicy.temperature,
              num_predict: plan.numPredict,
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
        // A memória da GPU mudou (modelo carregado): a próxima admissão lê de novo.
        if (loadedNow) gpu.invalidate?.();
      }
    },

    unload: unloadAndWait,
  };
}

function choiceError(
  choice: Exclude<ModelChoice, { kind: 'ok' }>,
  requested: string | undefined,
  taskPolicy: TaskPolicy,
): AiError {
  if (choice.kind === 'not_installed') {
    const wanted = requested ? [requested] : taskPolicy.models;
    return new AiError('model_not_installed', {
      message: `Nenhum destes modelos está instalado: ${wanted.join(', ')}. Instale com "ollama pull ${wanted[0] ?? ''}".`,
    });
  }
  const missing = choice.missing
    .map((capability) => MODEL_CAPABILITY_LABELS[capability])
    .join(', ');
  if (choice.model) {
    return new AiError('model_unsupported', {
      message: `O modelo ${choice.model} não tem suporte a ${missing}, segundo o Ollama. Escolha outro em Modelo ou deixe em Automático.`,
    });
  }
  const first = taskPolicy.models[0] ?? '';
  return new AiError('model_unsupported', {
    message: `Nenhum modelo instalado da lista (${taskPolicy.models.join(', ')}) tem suporte a ${missing}. Instale ${first} com "ollama pull ${first}".`,
  });
}

function queueTimeoutError(ms: number): AiError {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  return new AiError('busy', {
    message: `O pedido esperou mais de ${minutes} ${minutes === 1 ? 'minuto' : 'minutos'} na fila e foi cancelado. Tente de novo em instantes.`,
    detail: `fila: ${ms} ms`,
  });
}

const NS_PER_MS = 1_000_000;
const UNLOAD_WAIT_MS = 3000;

function usageOf(chunk: OllamaChatChunk): GatewayEventUsage {
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

type GatewayEventUsage = Extract<GatewayEvent, { type: 'done' }>['usage'];
