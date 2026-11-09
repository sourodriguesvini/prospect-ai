import type { ActorType } from '@prospector/contracts';

/**
 * Quem está agindo. Há um único usuário (ADR-0007); agentes e processos do sistema se
 * identificam para que a auditoria mostre quem fez o quê.
 */
export type Actor =
  | { type: 'user' }
  | { type: 'agent'; agent: string; runId: string }
  | { type: 'system'; component: string };

/**
 * Contexto de toda chamada de serviço. Serviços nunca leem cookies, cabeçalhos ou variáveis
 * globais: ator e traceId chegam aqui.
 */
export interface RequestContext {
  actor: Actor;
  /** UUID gerado na borda (página, action, job); vai para `audit_log.trace_id` e para os logs. */
  traceId: string;
}

/** Ator como gravado na auditoria: tipo e rótulo (nome do agente ou componente). */
export function auditActor(actor: Actor): { actorType: ActorType; actorLabel: string | null } {
  switch (actor.type) {
    case 'user':
      return { actorType: 'user', actorLabel: null };
    case 'agent':
      return { actorType: 'agent', actorLabel: actor.agent };
    case 'system':
      return { actorType: 'system', actorLabel: actor.component };
  }
}
