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
  // M2 — Empresas e evidências
  'prospect.company.created': 'Empresa cadastrada',
  'prospect.company.lifecycle_changed': 'Etapa da empresa alterada',
  'prospect.company.registry_refreshed': 'Cadastro da Receita consultado de novo',
  'prospect.company.web_search_recorded': 'Resultados da busca na internet registrados',
  'prospect.company.web_page_recorded': 'Página da internet registrada',
  'prospect.evidence.recorded': 'Evidências registradas',
  'prospect.company.discovery_recorded': 'Achados da Descoberta registrados',
  // F4 — Descoberta
  'discovery.run.created': 'Pesquisa da Descoberta criada',
  'discovery.run.prepared': 'Pesquisa preparada pelo Copiloto',
  'discovery.run.confirmed': 'Pesquisa confirmada',
  'discovery.run.cancelled': 'Pesquisa cancelada',
  'discovery.run.scheduled': 'Pesquisa de monitoramento agendada',
  'discovery.prospect.status_changed': 'Empresa encontrada salva ou ignorada',
  'discovery.prospect.company_linked': 'Empresa encontrada ligada a Empresas',
  'discovery.prospect.investigated': 'Empresa encontrada enviada para investigação',
  'discovery.monitor.created': 'Monitoramento criado',
  'discovery.monitor.updated': 'Monitoramento alterado',
  'discovery.monitor.status_changed': 'Monitoramento pausado, retomado ou arquivado',
  // Relacionamento (ADR-0014)
  'relationship.opportunity.opened': 'Oportunidade aberta',
  'relationship.opportunity.stage_changed': 'Etapa da oportunidade alterada',
  'relationship.opportunity.updated': 'Detalhes da oportunidade alterados',
  'relationship.approach.generated': 'Estratégia de abordagem gerada pela IA local',
  'relationship.approach.discarded': 'Estratégia de abordagem descartada',
  'relationship.message.generated': 'Rascunho de mensagem gerado pela IA local',
  'relationship.message.regenerated': 'Rascunho reescrito pela IA local',
  'relationship.message.written': 'Rascunho de mensagem escrito por você',
  'relationship.message.edited': 'Rascunho de mensagem editado',
  'relationship.message.discarded': 'Mensagem descartada',
  'relationship.message.approved': 'Mensagem aprovada para uso',
  'relationship.approval.revoked': 'Aprovação revogada',
  'relationship.contact.recorded': 'Contato feito registrado',
  'relationship.reply.recorded': 'Resposta da empresa registrada',
  'relationship.reply.analyzed': 'Resposta interpretada pela IA local',
  'relationship.note.recorded': 'Nota de contato registrada',
  'relationship.task.created': 'Follow-up marcado',
  'relationship.task.completed': 'Follow-up concluído',
  'relationship.task.cancelled': 'Follow-up cancelado',
  'relationship.task.rescheduled': 'Follow-up remarcado',
  'relationship.suppression.created': 'Empresa na lista de supressão (não contatar)',
  'relationship.suppression.lifted': 'Supressão retirada',
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
