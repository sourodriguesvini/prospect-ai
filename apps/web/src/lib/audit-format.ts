import type { AuditLogEntry } from '@prospector/contracts';

/**
 * Rótulos em pt-BR das ações auditadas (`dominio.entidade.verbo`). Ação sem rótulo aparece
 * crua: melhor mostrar o código do que esconder o registro. Cada fatia acrescenta as suas.
 */
const ACTION_LABELS: Record<string, string> = {};

export interface AuditDescription {
  label: string;
  detail: string;
}

/** Há um único usuário (ADR-0007): ele é "Você"; agentes e o sistema aparecem pelo nome. */
export function describeActor(entry: AuditLogEntry): string {
  switch (entry.actorType) {
    case 'user':
      return 'Você';
    case 'agent':
      return entry.actorLabel ? `Agente ${entry.actorLabel}` : 'Agente';
    case 'system':
      return entry.actorLabel ? `Sistema (${entry.actorLabel})` : 'Sistema';
  }
}

export function describeAuditEntry(entry: AuditLogEntry): AuditDescription {
  const label = ACTION_LABELS[entry.action] ?? entry.action;
  const detail = entry.entityId ? `${entry.entityType} · ${entry.entityId}` : entry.entityType;
  return { label, detail };
}
