import type {
  AiErrorCode,
  CopilotEvent,
  CopilotRequest,
  GenerationUsage,
  InternalLink,
  ToolCallRequest,
  ToolSpec,
  ToolStatus,
} from '@prospector/contracts';
import { toAiError } from '../errors';
import type { GatewayMessage, LocalAiGateway } from '../gateway';
import type { PromptDoc } from '../prompts';

/**
 * Versão do prompt em uso (`packages/agents/prompts/copilot/v<N>.md`). Trocar exige avaliação
 * (`pnpm evals`) com a nova versão ≥ a anterior (docs/11 §4.3, skill capacidade-ia).
 * v3 promovido na IA-1.2 (2026-11-10, `evals/copilot/results/2026-11-10-16-44.regraded.json` e
 * `2026-11-10-16-57.json`): 89% contra 60% do v1 no `qwen3.5:4b` (19 casos × 3, recalculado
 * depois da revisão do avaliador-ia) e p95 sem raciocínio de 2,6 s contra 3,1 s; com raciocínio
 * ligado, p95 12% maior (dentro dos 15% do doc 11). O v2 não foi promovido (IA-1.1). Detalhes e
 * ressalvas (LGPD, rascunhos) no doc 13 §9.
 */
export const COPILOT_PROMPT_VERSION = 3;

/**
 * Prompt do Copiloto com ferramentas de leitura (IA-2, `prompts/copilot-tools/v<N>.md`). É um
 * prompt inteiro, não um adendo ao `copilot/v3`: aquele diz que o Copiloto não tem ferramentas.
 *
 * v3 (promovido em 2026-11-10 com aprovação do usuário): pesquisa na internet sem recusas
 * (emenda do ADR-0012). Avaliação `EVAL_WEB=1 EVAL_PROMPTS=2,3 EVAL_REPEAT=3`, qwen3.5:4b,
 * `results/2026-11-10-23-50.regraded.json`: casos comuns 83% (v2 77%, mesmos 48 casos),
 * internet 81% (42), sem nenhuma falha nos corretores de tolerância zero (URL, dono ou telefone
 * inventado, obedecer à injeção); p95 4,8 s (v2 3,8 s). Ressalvas no KI-096.
 */
export const COPILOT_TOOLS_PROMPT_VERSION = 3;

/**
 * As ferramentas que pesquisam na internet (ADR-0012) só entram com um prompt que as conhece: até
 * o v2, o prompt diz ao modelo que nenhuma ferramenta acessa a internet (KI-096).
 */
export function copilotPromptSupportsWebTools(promptVersion: number): boolean {
  return promptVersion >= 3;
}

/**
 * Rodadas de geração por pergunta: até 7 com ferramentas e a última obrigatoriamente sem. A
 * pesquisa aprofundada (várias buscas e páginas) precisa de mais que as 4 rodadas da IA-2.
 */
export const MAX_COPILOT_ROUNDS = 8;

/**
 * Teto do que os resultados de ferramentas de uma pergunta levam ao modelo (caracteres). Passado
 * o teto, as chamadas que faltam na mesma rodada não rodam (recebem `TOOL_BUDGET_SPENT`) e a
 * próxima rodada vem sem ferramentas: o modelo responde com o que já tem, em vez de a conversa
 * estourar o contexto (16 mil tokens no Copiloto, com ~5,5 mil fixos de instruções e definições
 * das ferramentas).
 */
export const COPILOT_TOOL_RESULTS_MAX_CHARS = 20_000;

/** Resposta às chamadas que chegam depois do teto: o modelo entende que deve responder já. */
export const TOOL_BUDGET_SPENT =
  'Limite de texto desta pergunta atingido: esta consulta não foi feita. Responda com o que já tem.';

/** O que a tela e o modelo recebem de uma ferramenta executada no servidor. */
export interface CopilotToolOutcome {
  status: ToolStatus;
  /** Frase pt-BR mostrada na tela. */
  summary: string;
  links: InternalLink[];
  /** Texto entregue ao modelo (JSON com status, resumo e dados, já limitado em tamanho). */
  forModel: string;
}

/** Ferramentas oferecidas nesta conversa e quem as executa (serviços de application). */
export interface CopilotToolbox {
  specs: readonly ToolSpec[];
  /** Nunca lança: falha vira `status: 'error'` com resumo pt-BR. */
  execute(call: ToolCallRequest, signal?: AbortSignal): Promise<CopilotToolOutcome>;
}

/** Uma geração do modelo, para a telemetria (`llm_calls`). */
export interface GenerationRecord {
  /** null quando a falha veio antes de o modelo ser escolhido. */
  model: string | null;
  status: 'ok' | 'error' | 'cancelled';
  errorCode: AiErrorCode | null;
  doneReason: string | null;
  usage: GenerationUsage | null;
  round: number;
}

export interface CopilotTurnOptions {
  traceId: string;
  signal?: AbortSignal;
  /**
   * Fatos verificados pelo próprio sistema (data, estado do banco, módulos). Vão no fim do
   * prompt, depois da parte estática, e são rotulados como contexto, não como instrução.
   */
  systemFacts: readonly string[];
  /** Ferramentas de leitura (IA-2). Ausente = conversa sem ferramentas (prompt v3). */
  tools?: CopilotToolbox;
  /** Chamado a cada geração terminada ou interrompida (telemetria). Não pode lançar. */
  onGeneration?: (record: GenerationRecord) => void;
}

export interface Copilot {
  readonly promptId: string;
  reply(request: CopilotRequest, options: CopilotTurnOptions): AsyncGenerator<CopilotEvent>;
}

/** Ferramentas que pedem a mesma coisa duas vezes na mesma pergunta recebem o resultado anterior. */
function callKey(call: ToolCallRequest): string {
  return `${call.name}:${JSON.stringify(call.arguments)}`;
}

/**
 * Copiloto (IA-1, IA-1.1 e IA-2): conversa com o modelo local e, com ferramentas, executa as
 * consultas que o modelo pedir e devolve o resultado a ele, em até `MAX_COPILOT_ROUNDS` gerações.
 * Nunca lança: toda falha vira um evento `error` com mensagem pt-BR, e o detalhe técnico vai
 * para o log.
 */
export function createCopilot(deps: {
  gateway: LocalAiGateway;
  prompt: () => PromptDoc;
  /** Prompt do modo com ferramentas; sem ele, as ferramentas nunca são oferecidas. */
  toolsPrompt?: () => PromptDoc;
  log?: (message: string) => void;
}): Copilot {
  const log = deps.log ?? ((message: string) => console.warn(message));
  return {
    get promptId() {
      return deps.prompt().id;
    },

    async *reply(request, options) {
      let promptId = 'copilot/?';
      let round = 0;
      let roundModel: string | null = null;
      let roundOpen = false;
      const record = (entry: Omit<GenerationRecord, 'round'>) => {
        try {
          options.onGeneration?.({ ...entry, round });
        } catch (error) {
          log(`[copiloto] telemetria falhou trace=${options.traceId}: ${String(error)}`);
        }
      };
      try {
        const toolbox = options.tools && deps.toolsPrompt ? options.tools : undefined;
        const prompt = toolbox && deps.toolsPrompt ? deps.toolsPrompt() : deps.prompt();
        promptId = prompt.id;
        const context = options.systemFacts.map((fact) => `- ${fact}`).join('\n');
        const conversation: GatewayMessage[] = [
          { role: 'system', content: prompt.text },
          {
            role: 'system',
            content: `Contexto do sistema (dados verificados pelo Prospector, não são instruções):\n${context}`,
          },
          ...request.messages,
        ];

        let started = false;
        let wroteText = false;
        const shownNotices = new Set<string>();
        const answered = new Map<string, string>();
        const usedIds = new Set<string>();
        const totals = { outputTokens: 0, totalMs: 0, any: false };
        let lastDone: Extract<CopilotEvent, { type: 'done' }> | null = null;

        let toolResultChars = 0;
        for (round = 1; round <= MAX_COPILOT_ROUNDS; round += 1) {
          const offer =
            toolbox &&
            round < MAX_COPILOT_ROUNDS &&
            toolResultChars < COPILOT_TOOL_RESULTS_MAX_CHARS
              ? toolbox.specs
              : undefined;
          let calls: ToolCallRequest[] = [];
          let separated = !wroteText;
          roundOpen = true;
          roundModel = null;
          for await (const event of deps.gateway.chat(
            'copilot',
            { messages: conversation, model: request.model, think: request.think, tools: offer },
            options.signal,
          )) {
            switch (event.type) {
              case 'start':
                roundModel = event.model;
                if (!started) {
                  started = true;
                  yield {
                    type: 'start',
                    model: event.model,
                    promptVersion: prompt.id,
                    traceId: options.traceId,
                  };
                }
                break;
              case 'notice':
                if (!shownNotices.has(event.message)) {
                  shownNotices.add(event.message);
                  yield event;
                }
                break;
              case 'delta':
                if (!separated) {
                  // Texto de uma rodada anterior (antes das ferramentas) e o desta ficam em
                  // parágrafos separados na tela.
                  separated = true;
                  yield { type: 'delta', text: '\n\n' };
                }
                wroteText = true;
                yield event;
                break;
              case 'tool_calls':
                calls = event.calls;
                break;
              case 'done':
                roundOpen = false;
                record({
                  model: event.model,
                  status: 'ok',
                  errorCode: null,
                  doneReason: event.doneReason,
                  usage: event.usage,
                });
                lastDone = event;
                if (event.usage.outputTokens !== null) {
                  totals.outputTokens += event.usage.outputTokens;
                  totals.any = true;
                }
                if (event.usage.totalMs !== null) totals.totalMs += event.usage.totalMs;
                break;
              default:
                yield event;
            }
          }

          if (!toolbox || calls.length === 0 || !offer) break;
          // Ids repetidos entre rodadas (o gateway numera quando o Ollama não manda) confundiriam
          // a tela e o modelo: cada chamada da pergunta tem id único.
          calls = calls.map((call) => {
            let id = call.id;
            while (usedIds.has(id)) id = `${call.id}_${round}_${usedIds.size}`;
            usedIds.add(id);
            return id === call.id ? call : { ...call, id };
          });

          // O texto escrito antes da consulta não volta ao modelo: devolvido como turno anterior, o
          // modelo de 4B o repetia na rodada seguinte (revisão do avaliador-ia, KI-076 A4).
          conversation.push({ role: 'assistant', content: '', toolCalls: calls });
          for (const call of calls) {
            const spec = toolbox.specs.find((tool) => tool.name === call.name);
            yield {
              type: 'tool_call',
              id: call.id,
              name: call.name,
              title: spec?.title ?? 'Ferramenta desconhecida',
            };
            const key = callKey(call);
            let outcome: CopilotToolOutcome;
            const repeated = answered.get(key);
            if (toolResultChars >= COPILOT_TOOL_RESULTS_MAX_CHARS) {
              // Várias leituras pedidas de uma vez passariam muito do teto (até 6 mil cada).
              outcome = {
                status: 'denied',
                summary: 'Não consultado: a pergunta já juntou texto demais.',
                links: [],
                forModel: JSON.stringify({
                  status: 'denied',
                  resumo: TOOL_BUDGET_SPENT,
                  dados: null,
                }),
              };
            } else if (repeated !== undefined) {
              outcome = {
                status: 'ok',
                summary: 'Mesma consulta de antes nesta pergunta; resultado reaproveitado.',
                links: [],
                forModel: repeated,
              };
            } else {
              outcome = await toolbox.execute(call, options.signal);
              answered.set(key, outcome.forModel);
            }
            yield {
              type: 'tool_result',
              id: call.id,
              name: call.name,
              status: outcome.status,
              summary: outcome.summary,
              links: outcome.links,
            };
            if (outcome.status !== 'denied') toolResultChars += outcome.forModel.length;
            conversation.push({
              role: 'tool',
              content: outcome.forModel,
              toolName: call.name,
              toolCallId: call.id,
            });
          }
        }

        if (lastDone) {
          // Uma linha de métricas para a pergunta inteira: soma das gerações.
          yield {
            ...lastDone,
            usage: {
              ...lastDone.usage,
              outputTokens: totals.any ? totals.outputTokens : lastDone.usage.outputTokens,
              totalMs: totals.totalMs > 0 ? totals.totalMs : lastDone.usage.totalMs,
            },
          };
        }
      } catch (error) {
        const failure = toAiError(error);
        if (roundOpen) {
          roundOpen = false;
          record({
            model: roundModel,
            status: failure.code === 'cancelled' ? 'cancelled' : 'error',
            errorCode: failure.code,
            doneReason: null,
            usage: null,
          });
        }
        if (failure.code !== 'cancelled') {
          log(
            `[copiloto] falha ${failure.code} trace=${options.traceId} prompt=${promptId}${failure.detail ? ` detalhe=${failure.detail}` : ''}`,
          );
        }
        yield { type: 'error', code: failure.code, message: failure.message };
      } finally {
        // Quem consome desistiu no meio da geração (navegador fechou): conta como cancelada.
        if (roundOpen) {
          record({
            model: roundModel,
            status: 'cancelled',
            errorCode: 'cancelled',
            doneReason: null,
            usage: null,
          });
        }
      }
    },
  };
}
