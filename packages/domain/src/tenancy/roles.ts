import type { Role } from '@prospector/contracts';

/**
 * Regras de papéis da organização. Puras (sem IO).
 * O banco aplica as mesmas regras nas funções `public.create_invitation`,
 * `public.change_member_role` e `public.remove_member` (defesa em profundidade).
 */

const RANK: Record<Role, number> = { owner: 4, admin: 3, operator: 2, viewer: 1 };

export function roleRank(role: Role): number {
  return RANK[role];
}

export function hasAtLeast(role: Role, minimum: Role): boolean {
  return RANK[role] >= RANK[minimum];
}

/** Convidar, alterar papel e remover membros: admin ou owner. */
export function canManageMembers(role: Role): boolean {
  return hasAtLeast(role, 'admin');
}

/** Ver o registro de auditoria: admin ou owner. */
export function canViewAuditLog(role: Role): boolean {
  return hasAtLeast(role, 'admin');
}

export type MemberChangeDenial = 'not_admin' | 'self_change' | 'owner_only';
export type MemberChangeCheck = { ok: true } | { ok: false; reason: MemberChangeDenial };

const OK: MemberChangeCheck = { ok: true };
const deny = (reason: MemberChangeDenial): MemberChangeCheck => ({ ok: false, reason });

export function checkInvitation(actorRole: Role, invitedRole: Role): MemberChangeCheck {
  if (!canManageMembers(actorRole)) return deny('not_admin');
  if (invitedRole === 'owner') return deny('owner_only');
  return OK;
}

export interface RoleChangeRequest {
  actorRole: Role;
  isSelf: boolean;
  targetRole: Role;
  newRole: Role;
}

/**
 * Ninguém altera o próprio papel (evita perder o último owner por engano);
 * só owner concede ou retira o papel de owner.
 */
export function checkRoleChange(req: RoleChangeRequest): MemberChangeCheck {
  if (!canManageMembers(req.actorRole)) return deny('not_admin');
  if (req.isSelf) return deny('self_change');
  if ((req.targetRole === 'owner' || req.newRole === 'owner') && req.actorRole !== 'owner') {
    return deny('owner_only');
  }
  return OK;
}

export interface MemberRemovalRequest {
  actorRole: Role;
  isSelf: boolean;
  targetRole: Role;
}

export function checkMemberRemoval(req: MemberRemovalRequest): MemberChangeCheck {
  if (!canManageMembers(req.actorRole)) return deny('not_admin');
  if (req.isSelf) return deny('self_change');
  if (req.targetRole === 'owner' && req.actorRole !== 'owner') return deny('owner_only');
  return OK;
}
