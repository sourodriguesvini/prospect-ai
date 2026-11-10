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

/**
 * Registro de auditoria de uma escrita (KI-041). A persistência grava a escrita e este registro
 * juntos — no banco, na mesma transação: ou os dois ficam, ou nenhum. Escrita que não muda nada
 * (atualização que não encontra a linha) não gera registro. Regras no ADR-0010.
 */
export interface PendingAudit extends NewAuditEntry {
  /** Acrescenta ao diff o número da versão atribuído pela persistência (`version`). */
  withVersion: boolean;
}

/** Trilha de auditoria somente de inclusão (implementada em packages/db). */
export interface AuditRepository {
  append(entry: NewAuditEntry): Promise<void>;
  listRecent(limit: number): Promise<AuditLogEntry[]>;
}
