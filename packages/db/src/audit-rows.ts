import { ActorType, AuditDiff, AuditLogEntry } from '@prospector/contracts';
import { z } from 'zod';

/** Colunas lidas de `audit_log`; o formato é validado para uma mudança de esquema falhar alto. */
export const AUDIT_SELECT =
  'id, actor_type, actor_label, action, entity_type, entity_id, diff, trace_id, occurred_at';

const AuditRow = z.object({
  // bigint: o PostgREST devolve número; tolera texto para não perder precisão no futuro.
  id: z.union([z.number().int(), z.string().regex(/^\d+$/).transform(Number)]),
  actor_type: ActorType,
  actor_label: z.string().nullable(),
  action: z.string(),
  entity_type: z.string(),
  entity_id: z.string().nullable(),
  diff: AuditDiff,
  trace_id: z.string().nullable(),
  occurred_at: z.string(),
});

export function mapAuditRow(raw: unknown): AuditLogEntry {
  const row = AuditRow.parse(raw);
  return AuditLogEntry.parse({
    id: row.id,
    actorType: row.actor_type,
    actorLabel: row.actor_label,
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id,
    diff: row.diff,
    traceId: row.trace_id,
    occurredAt: row.occurred_at,
  });
}
