import { AppError } from './errors';

export type Actor =
  | { type: 'user'; userId: string }
  | { type: 'agent'; agentRunId: string; onBehalfOfUserId: string }
  | { type: 'system'; component: string };

/**
 * Contexto de toda chamada de serviço. Serviços nunca leem sessão, cookies ou variáveis
 * globais: tudo o que define "quem" e "em nome de quem" chega aqui.
 */
export interface RequestContext {
  actor: Actor;
  traceId: string;
}

/** Usuário humano por trás da chamada (direto ou por um agente agindo em nome dele). */
export function requireUserId(ctx: RequestContext): string {
  if (ctx.actor.type === 'user') return ctx.actor.userId;
  if (ctx.actor.type === 'agent') return ctx.actor.onBehalfOfUserId;
  throw new AppError('unauthenticated', 'not_authenticated');
}
