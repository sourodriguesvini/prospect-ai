import { ROLE_LABELS, type AuditLogEntry, type Role } from '@prospector/contracts';

const ACTION_LABELS: Record<string, string> = {
  'organizations.insert': 'Organização criada',
  'organizations.update': 'Organização alterada',
  'memberships.insert': 'Membro adicionado',
  'memberships.update': 'Papel alterado',
  'memberships.delete': 'Membro removido',
  'invitations.insert': 'Convite criado',
  'invitations.update': 'Convite atualizado',
  'invitations.delete': 'Convite excluído',
};

const INVITATION_STATUS_LABELS: Record<string, string> = {
  pending: 'pendente',
  accepted: 'aceito',
  revoked: 'revogado',
  expired: 'expirado',
};

const FIELD_LABELS: Record<string, string> = {
  name: 'nome',
  slug: 'endereço',
  settings: 'configurações',
};

/** Quem é quem: id de usuário → nome ou e-mail, a partir da lista de membros atual. */
export type PeopleIndex = ReadonlyMap<string, string>;

export interface AuditDescription {
  label: string;
  detail: string;
}

function isRole(value: unknown): value is Role {
  return typeof value === 'string' && value in ROLE_LABELS;
}

function roleLabel(value: unknown): string {
  return isRole(value) ? ROLE_LABELS[value] : String(value ?? '—');
}

function change(diff: Record<string, unknown>, key: string): { from: unknown; to: unknown } | null {
  const value = diff[key];
  if (value && typeof value === 'object' && 'to' in value)
    return value as { from: unknown; to: unknown };
  return null;
}

export function describeActor(entry: AuditLogEntry, people: PeopleIndex): string {
  if (entry.actorType === 'system') return 'Sistema';
  if (entry.actorType === 'agent') return 'Agente';
  if (!entry.actorId) return 'Desconhecido';
  return people.get(entry.actorId) ?? 'Ex-membro';
}

export function describeAuditEntry(entry: AuditLogEntry, people: PeopleIndex): AuditDescription {
  const label = ACTION_LABELS[entry.action] ?? entry.action;
  const diff = entry.diff ?? {};
  const person = entry.entityId ? (people.get(entry.entityId) ?? 'ex-membro') : '—';

  switch (entry.action) {
    case 'memberships.insert':
    case 'memberships.delete':
      return { label, detail: `${person} · ${roleLabel(diff.role)}` };
    case 'memberships.update': {
      const role = change(diff, 'role');
      return {
        label,
        detail: role ? `${person}: ${roleLabel(role.from)} → ${roleLabel(role.to)}` : person,
      };
    }
    case 'invitations.insert':
    case 'invitations.delete':
      return { label, detail: `${String(diff.email ?? '—')} · ${roleLabel(diff.role)}` };
    case 'invitations.update': {
      const status = change(diff, 'status');
      if (!status) return { label, detail: '' };
      const from = INVITATION_STATUS_LABELS[String(status.from)] ?? String(status.from);
      const to = INVITATION_STATUS_LABELS[String(status.to)] ?? String(status.to);
      return { label, detail: `${from} → ${to}` };
    }
    case 'organizations.insert':
      return { label, detail: String(diff.name ?? '') };
    case 'organizations.update': {
      const fields = Object.keys(diff).map((key) => FIELD_LABELS[key] ?? key);
      return { label, detail: fields.length > 0 ? `Campos: ${fields.join(', ')}` : '' };
    }
    default:
      return { label, detail: '' };
  }
}
