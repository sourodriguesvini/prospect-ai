import {
  MODEL_CAPABILITY_LABELS,
  type AiRuntimeLimits,
  type AiRuntimeStatus,
  type AiTask,
  type CopilotEvent,
  type LocalModel,
  type ToolCallRequest,
  type ToolSpec,
} from '@prospector/contracts';
import {
  decideAdmission,
  estimateModelMiB,
  insufficientVramError,
  UNMEASURED_VRAM_NOTICE,
} from './admission';
import { droppedNotice, estimateTokens, fitToContext, type BudgetMessage } from './context-budget';
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
import type {
  OllamaChatChunk,
  OllamaChatMessage,
  OllamaChunkToolCall,
  OllamaClient,
  OllamaModelInfo,
} from './ollama/client';
import { neutralizeControlTokens } from './sanitize';

/** Mesma forma que o orçamento de contexto e o cliente do Ollama usam. */
export type GatewayMessage = BudgetMessage;

type CopilotStart = Extract<CopilotEvent, { type: 'start' }>;

/**
 * Eventos do gateway: os do contrato `CopilotEvent`, menos o que só o Copiloto conhece (versão do
 * prompt e trace no `start`, conversa e ferramentas) e o `error`, que o gateway lança como
 * `AiError`. Derivado do contrato para que uma mudança nos eventos da tela apareça aqui na
 * compilação. `tool_calls` é interno: os pedidos de ferramenta da geração, antes do `done`.
 */
export type GatewayEvent =
  | Exclude<
      CopilotEvent,
      | { type: 'start' }
      | { type: 'error' }
      | { type: 'thread' }
      | { type: 'tool_call' }
      | { type: 'tool_result' }
    >
  | Pick<CopilotStart, 'type' | 'model'>
  | { type: 'tool_calls'; calls: ToolCallRequest[] };

export interface ChatInput {
  messages: GatewayMessage[];
  /** Modelo pedido pela tela; precisa estar instalado e ter as capacidades da tarefa. */
  model?: string;
  think: boolean;
  /**
   * Ferramentas oferecidas ao modelo (IA-2). Se o modelo escolhido não usa ferramentas, o gateway
   * avisa e segue sem elas.
   */
  tools?: readonly ToolSpec[];
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
   * leitura da GPU, carrega e devolve um aviso explícito. Sem espaço, lança `insufficient_vram`.
   * Se só couber com a memória dos modelos ociosos do Ollama, devolve quais tirar: quem chama
   * mostra a fase "liberando memória" (KI-067) e chama `freeVram`.
   */
  async function admit(
    model: OllamaModelInfo,
    details: ModelDetails,
    numCtx: number,
  ): Promise<Admission> {
    const [running, snapshot] = await Promise.all([client.listRunning().catch(() => null), gpu()]);
    const loaded = running?.find((entry) => sameModel(entry.name, model.name));
    if (loaded && (loaded.contextLength === null || loaded.contextLength === numCtx)) {
      return { notices: [] };
    }
    if (!snapshot) return { notices: [UNMEASURED_VRAM_NOTICE] };
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
    if (neededMiB + reserveMiB <= snapshot.freeMiB || idle.length === 0) return { notices: [] };
    return { notices: [], free: { idle: idle.map((entry) => entry.name), neededMiB, reserveMiB } };
  }

  /** Só cabe tirando os ociosos da memória: tira e confere com a leitura nova da GPU. */
  async function freeVram(
    model: OllamaModelInfo,
    plan: NonNullable<Admission['free']>,
  ): Promise<string[]> {
    for (const name of plan.idle) await unloadAndWait(name);
    const after = await gpu();
    if (after) {
      const recheck = decideAdmission({
        neededMiB: plan.neededMiB,
        gpu: after,
        reclaimableMiB: 0,
        reserveMiB: plan.reserveMiB,
      });
      if (!recheck.admitted) throw insufficientVramError(model.name, recheck);
    }
    const names = plan.idle.join(', ');
    return [
      plan.idle.length === 1
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
        wants: [
          ...(input.think ? (['thinking'] as const) : []),
          ...(input.tools?.length ? (['tools'] as const) : []),
        ],
        requested: input.model,
      });
      if (choice.kind !== 'ok') throw choiceError(choice, input.model, taskPolicy);
      const model = choice.model;
      const info = installed.find((entry) => entry.name === model);
      if (!info) throw new AiError('model_not_installed');
      const modelDetails = details.get(model) ?? UNKNOWN_DETAILS;

      const notices: string[] = [];
      const tools =
        input.tools?.length && !choice.lacking.includes('tools') ? [...input.tools] : [];
      if (input.tools?.length && tools.length === 0) {
        notices.push(
          `O modelo ${model} não usa ferramentas, segundo o Ollama: a resposta vem sem consultar os dados do Prospector.`,
        );
      }
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
      // As definições das ferramentas também ocupam o contexto: sem contá-las, o Ollama cortaria
      // o começo do pedido (as instruções) em silêncio.
      const toolDefinitions = tools.map((tool) => ({
        type: 'function' as const,
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
        },
      }));
      const reservedTokens = toolDefinitions.length
        ? estimateTokens(JSON.stringify(toolDefinitions))
        : 0;
      const plan = fitToContext(sanitized, {
        numCtx,
        maxOutputTokens: think ? taskPolicy.maxOutputTokensThinking : taskPolicy.maxOutputTokens,
        reservedTokens,
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
        const admission = await admit(info, modelDetails, numCtx);
        if (admission.free) {
          yield { type: 'phase', phase: 'freeing_vram' };
          notices.unshift(...(await freeVram(info, admission.free)));
        } else {
          notices.unshift(...admission.notices);
        }
        loadedNow = true;
        yield { type: 'start', model };
        for (const message of notices) yield { type: 'notice', message };

        deadline(taskPolicy.totalTimeoutMs);
        const startedAt = performance.now();
        let idle = deadline(taskPolicy.firstTokenTimeoutMs);

        /**
         * Uma geração no Ollama. Com o raciocínio ligado, para de ler (e fecha a conexão) quando
         * o raciocínio passa de `thinkingBudget` tokens sem a resposta ter começado (KI-066).
         */
        async function* generate(
          withThinking: boolean,
          numPredict: number,
          thinkingBudget: number,
        ): AsyncGenerator<GatewayEvent, Generation> {
          const phase = new AbortController();
          const forward = () => phase.abort(controller.signal.reason);
          if (controller.signal.aborted) forward();
          else controller.signal.addEventListener('abort', forward, { once: true });
          const result: Generation = {
            last: null,
            answered: false,
            thoughtTokens: 0,
            cut: false,
            toolCalls: [],
          };
          try {
            const stream = client.chat(
              {
                model,
                messages: plan.messages.map(toOllamaMessage),
                tools: toolDefinitions,
                think: withThinking,
                keepAlive: taskPolicy.keepAlive,
                options: {
                  num_ctx: numCtx,
                  temperature: taskPolicy.temperature,
                  num_predict: numPredict,
                },
              },
              phase.signal,
            );
            for await (const chunk of stream) {
              clear(idle);
              idle = deadline(taskPolicy.idleTimeoutMs);
              const thinking = chunk.message?.thinking;
              const content = chunk.message?.content;
              if (thinking) {
                // O Ollama manda um token por pedaço: a contagem de pedaços estima os tokens.
                result.thoughtTokens += 1;
                yield { type: 'thinking', text: thinking };
                if (!result.answered && result.thoughtTokens >= thinkingBudget) {
                  result.cut = true;
                  break;
                }
              }
              if (content) {
                result.answered = true;
                yield { type: 'delta', text: content };
              }
              const requested = chunk.message?.tool_calls;
              if (requested?.length) {
                result.answered = true;
                for (const call of requested) {
                  if (result.toolCalls.length >= MAX_TOOL_CALLS_PER_GENERATION) break;
                  result.toolCalls.push(normalizeToolCall(call, result.toolCalls.length));
                }
              }
              if (chunk.done) result.last = chunk;
            }
          } finally {
            controller.signal.removeEventListener('abort', forward);
            // Saiu antes do fim (corte do raciocínio): fecha a geração no Ollama.
            if (!phase.signal.aborted) phase.abort(new AiError('cancelled'));
          }
          return result;
        }

        const thinkingBudget = think
          ? Math.max(MIN_THINKING_TOKENS, plan.numPredict - taskPolicy.answerReserveTokens)
          : Number.POSITIVE_INFINITY;
        const first = yield* generate(think, plan.numPredict, thinkingBudget);
        let last = first.last;
        let toolCalls = first.toolCalls;
        let usage: GatewayEventUsage | null = last ? usageOf(last) : null;
        const exhausted = first.cut || (last?.done_reason === 'length' && !first.answered);
        if (think && !first.answered && exhausted) {
          // O raciocínio esgotou o espaço da resposta: pede a resposta sem raciocínio, em vez de
          // devolver resposta vazia (KI-066). As métricas somam as duas gerações.
          yield { type: 'notice', message: THINKING_EXHAUSTED_NOTICE };
          const retry = fitToContext(sanitized, {
            numCtx,
            maxOutputTokens: taskPolicy.maxOutputTokens,
            reservedTokens,
          });
          clear(idle);
          idle = deadline(taskPolicy.firstTokenTimeoutMs);
          const second = yield* generate(false, retry.numPredict, Number.POSITIVE_INFINITY);
          last = second.last;
          toolCalls = second.toolCalls;
          usage = null;
          if (last) {
            const answer = usageOf(last);
            usage = {
              ...answer,
              outputTokens: first.thoughtTokens + (answer.outputTokens ?? 0),
              totalMs: Math.round(performance.now() - startedAt),
              loadMs: null,
            };
          }
        }
        if (!last || !usage) {
          throw new AiError('provider_error', { detail: 'stream terminou sem done' });
        }
        if (toolCalls.length > 0) yield { type: 'tool_calls', calls: toolCalls };
        yield {
          type: 'done',
          model,
          doneReason: last.done_reason ?? null,
          usage,
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
    const first = wanted[0] ?? '';
    return new AiError('model_not_installed', {
      message:
        wanted.length === 1
          ? `O modelo ${first} não está instalado. Instale com "ollama pull ${first}" ou escolha outro modelo instalado em Modelo.`
          : `Nenhum destes modelos está instalado: ${wanted.join(', ')}. Instale com "ollama pull ${first}".`,
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

/** Resultado da admissão: avisos ou os modelos ociosos a tirar da placa antes de carregar. */
interface Admission {
  notices: string[];
  free?: { idle: string[]; neededMiB: number; reserveMiB: number };
}

/** O que uma geração deixou para o gateway decidir se precisa pedir a resposta de novo. */
interface Generation {
  last: OllamaChatChunk | null;
  /** A resposta começou (algum texto fora do raciocínio). */
  answered: boolean;
  thoughtTokens: number;
  /** O gateway cortou o raciocínio por passar do orçamento. */
  cut: boolean;
  /** Ferramentas pedidas pelo modelo nesta geração. */
  toolCalls: ToolCallRequest[];
}

/** Limite de ferramentas por geração: um modelo em laço não dispara dezenas de consultas. */
export const MAX_TOOL_CALLS_PER_GENERATION = 6;

/**
 * Pedido do Ollama no formato do contrato. Argumentos em texto viram objeto (JSON inválido vira
 * objeto vazio e a validação da ferramenta responde ao modelo); id ausente ganha um sequencial.
 */
function normalizeToolCall(call: OllamaChunkToolCall, index: number): ToolCallRequest {
  let args: Record<string, unknown> = {};
  const raw = call.function.arguments;
  if (typeof raw === 'string') {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        args = parsed as Record<string, unknown>;
      }
    } catch {
      args = {};
    }
  } else if (raw) {
    args = raw;
  }
  const id = call.id && call.id.length <= 80 ? call.id : `call_${index + 1}`;
  return { id, name: call.function.name.slice(0, 64), arguments: args };
}

/** Mensagem do gateway no formato do `/api/chat`. */
function toOllamaMessage(message: GatewayMessage): OllamaChatMessage {
  switch (message.role) {
    case 'tool':
      return {
        role: 'tool',
        content: message.content,
        tool_name: message.toolName ?? 'tool',
        ...(message.toolCallId ? { tool_call_id: message.toolCallId } : {}),
      };
    case 'assistant':
      return message.toolCalls?.length
        ? {
            role: 'assistant',
            content: message.content,
            tool_calls: message.toolCalls.map((call) => ({
              id: call.id,
              function: { name: call.name, arguments: call.arguments },
            })),
          }
        : { role: 'assistant', content: message.content };
    default:
      return { role: message.role, content: message.content };
  }
}

/** Abaixo disso o raciocínio nem começa direito; o corte usa ao menos este orçamento. */
const MIN_THINKING_TOKENS = 512;

export const THINKING_EXHAUSTED_NOTICE =
  'O raciocínio passou do limite antes de a resposta começar; a resposta abaixo foi escrita sem continuar o raciocínio.';

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
