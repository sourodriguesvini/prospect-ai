import { AuditActorFields, RecordAuditInput, type AuditDiff } from '@prospector/contracts';
import { auditActor, type RequestContext } from '../context';
import { AppError, parseInput } from '../errors';
import type { PendingAudit } from '../ports/audit-repository';

export interface AuditFields {
  action: string;
  entityType: string;
  /** Omitido = id da linha gravada (cabeçalho ou versão nova). */
  entityId?: string;
  diff?: AuditDiff;
  /** O número da versão gravada entra no diff (atribuído pela persistência). */
  withVersion?: boolean;
}

/**
 * Registro de auditoria de uma escrita, com ator e traceId do contexto (KI-041, ADR-0010). Ator e
 * traceId fora dos limites do `audit_log` são defeito de quem montou o contexto, não dado
 * digitado: erro inesperado, igual na memória e no banco. O diff nunca leva conteúdo (KI-015).
 */
export function pendingAudit(ctx: RequestContext, fields: AuditFields): PendingAudit {
  const input = parseInput(RecordAuditInput, {
    action: fields.action,
    entityType: fields.entityType,
    entityId: fields.entityId ?? null,
    diff: fields.diff ?? {},
  });
  const actor = AuditActorFields.safeParse({ ...auditActor(ctx.actor), traceId: ctx.traceId });
  if (!actor.success) throw new AppError('unexpected', 'unexpected');
  return {
    ...actor.data,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    diff: input.diff,
    withVersion: fields.withVersion ?? false,
  };
}
