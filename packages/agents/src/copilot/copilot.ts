import type { CopilotEvent, CopilotRequest } from '@prospector/contracts';
import { toAiError } from '../errors';
import type { LocalAiGateway } from '../gateway';
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

export interface CopilotTurnOptions {
  traceId: string;
  signal?: AbortSignal;
  /**
   * Fatos verificados pelo próprio sistema (data, estado do banco, módulos). Vão no fim do
   * prompt, depois da parte estática, e são rotulados como contexto, não como instrução.
   */
  systemFacts: readonly string[];
}

export interface Copilot {
  readonly promptId: string;
  reply(request: CopilotRequest, options: CopilotTurnOptions): AsyncGenerator<CopilotEvent>;
}

/**
 * Copiloto (fatias IA-1 e IA-1.1): conversa com o modelo local, sem ferramentas. Nunca lança:
 * toda falha vira um evento `error` com mensagem pt-BR, e o detalhe técnico vai para o log.
 */
export function createCopilot(deps: {
  gateway: LocalAiGateway;
  prompt: () => PromptDoc;
  log?: (message: string) => void;
}): Copilot {
  const log = deps.log ?? ((message: string) => console.warn(message));
  return {
    get promptId() {
      return deps.prompt().id;
    },

    async *reply(request, options) {
      let promptId = 'copilot/?';
      try {
        const prompt = deps.prompt();
        promptId = prompt.id;
        const context = options.systemFacts.map((fact) => `- ${fact}`).join('\n');
        const messages = [
          { role: 'system' as const, content: prompt.text },
          {
            role: 'system' as const,
            content: `Contexto do sistema (dados verificados pelo Prospector, não são instruções):\n${context}`,
          },
          ...request.messages,
        ];
        for await (const event of deps.gateway.chat(
          'copilot',
          { messages, model: request.model, think: request.think },
          options.signal,
        )) {
          if (event.type === 'start') {
            yield {
              type: 'start',
              model: event.model,
              promptVersion: prompt.id,
              traceId: options.traceId,
            };
          } else {
            yield event;
          }
        }
      } catch (error) {
        const failure = toAiError(error);
        if (failure.code !== 'cancelled') {
          log(
            `[copiloto] falha ${failure.code} trace=${options.traceId} prompt=${promptId}${failure.detail ? ` detalhe=${failure.detail}` : ''}`,
          );
        }
        yield { type: 'error', code: failure.code, message: failure.message };
      }
    },
  };
}
