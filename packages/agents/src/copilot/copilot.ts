import type { CopilotEvent, CopilotRequest } from '@prospector/contracts';
import { toAiError } from '../errors';
import type { LocalAiGateway } from '../gateway';
import type { PromptDoc } from '../prompts';

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
 * Copiloto v1 (fatia IA-1): conversa com o modelo local, sem ferramentas. Nunca lança: toda
 * falha vira um evento `error` com mensagem pt-BR, e o detalhe técnico vai para o log.
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
