import type { AuditLogEntry } from '@prospector/contracts';

/**
 * Rótulos em pt-BR das ações auditadas (`dominio.entidade.verbo`). Ação sem rótulo aparece
 * crua: melhor mostrar o código do que esconder o registro. Cada fatia acrescenta as suas.
 */
const ACTION_LABELS: Record<string, string> = {
  // F2 — Estratégia e conformidade
  'strategy.offer.created': 'Oferta criada',
  'strategy.offer.versioned': 'Nova versão da oferta',
  'strategy.offer.status_changed': 'Status da oferta alterado',
  'strategy.rubric.versioned': 'Nova versão da rubrica',
  'strategy.scoring_model.versioned': 'Nova versão do modelo de score',
  'strategy.icp.created': 'ICP criado',
  'strategy.icp.versioned': 'Nova versão do ICP',
  'strategy.icp.status_changed': 'Status do ICP alterado',
  'strategy.voice_guide.versioned': 'Nova versão da voz da agência',
  'strategy.proof_asset.created': 'Case criado',
  'strategy.proof_asset.updated': 'Case alterado',
  'strategy.proof_asset.archived': 'Case arquivado',
  'compliance.lia.versioned': 'Nova versão da LIA',
  'compliance.lia.approved': 'LIA aprovada',
  'compliance.lia.revoked': 'LIA revogada',
  'compliance.contact_policy.versioned': 'Nova versão do opt-out',
};

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
