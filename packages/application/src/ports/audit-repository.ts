import type { ActorType, AuditDiff, AuditLogEntry } from '@prospector/contracts';

export interface NewAuditEntry {
  actorType: ActorType;
  actorLabel: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  diff: AuditDiff;
  traceId: string;
}

/** Trilha de auditoria somente de inclusão (implementada em packages/db). */
export interface AuditRepository {
  append(entry: NewAuditEntry): Promise<void>;
  listRecent(limit: number): Promise<AuditLogEntry[]>;
}
