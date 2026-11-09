import {
  AcceptInvitationInput,
  ChangeMemberRoleInput,
  CreateInvitationInput,
  CreateOrganizationInput,
  OrganizationSlug,
  RemoveMemberInput,
  RevokeInvitationInput,
  Uuid,
  type AuditLogEntry,
  type Invitation,
  type Member,
  type OrganizationSummary,
  type Role,
} from '@prospector/contracts';
import {
  canManageMembers,
  canViewAuditLog,
  checkInvitation,
  checkMemberRemoval,
  checkRoleChange,
  type MemberChangeCheck,
} from '@prospector/domain';
import { requireUserId, type RequestContext } from '../context';
import { AppError, parseInput } from '../errors';
import type { TenancyRepository } from '../ports/tenancy-repository';

const AUDIT_PAGE_SIZE = 100;

function assertAllowed(check: MemberChangeCheck): void {
  if (!check.ok) throw new AppError('forbidden', check.reason);
}

export interface TenancyService {
  createOrganization(ctx: RequestContext, raw: unknown): Promise<{ id: string; slug: string }>;
  listMyOrganizations(ctx: RequestContext): Promise<OrganizationSummary[]>;
  getOrganization(ctx: RequestContext, slug: string): Promise<OrganizationSummary>;
  listMembers(ctx: RequestContext, orgId: string): Promise<Member[]>;
  listInvitations(ctx: RequestContext, orgId: string): Promise<Invitation[]>;
  inviteMember(
    ctx: RequestContext,
    raw: unknown,
  ): Promise<{ invitationId: string; token: string; expiresAt: string }>;
  acceptInvitation(ctx: RequestContext, raw: unknown): Promise<{ orgId: string; slug: string }>;
  revokeInvitation(ctx: RequestContext, raw: unknown): Promise<void>;
  changeMemberRole(ctx: RequestContext, raw: unknown): Promise<void>;
  removeMember(ctx: RequestContext, raw: unknown): Promise<void>;
  listAuditLog(ctx: RequestContext, orgId: string): Promise<AuditLogEntry[]>;
}

/**
 * Casos de uso de organização e equipe. As regras de papel são checadas aqui para
 * falhar cedo com mensagens claras; o banco as reaplica (RLS e funções) como garantia.
 */
export function createTenancyService(repo: TenancyRepository): TenancyService {
  async function requireRole(
    ctx: RequestContext,
    orgId: string,
  ): Promise<{ userId: string; role: Role }> {
    const userId = requireUserId(ctx);
    const role = await repo.getMemberRole(parseInput(Uuid, orgId), userId);
    if (!role) throw new AppError('not_found', 'not_found');
    return { userId, role };
  }

  return {
    async createOrganization(ctx, raw) {
      requireUserId(ctx);
      return repo.createOrganization(parseInput(CreateOrganizationInput, raw));
    },

    async listMyOrganizations(ctx) {
      return repo.listMyOrganizations(requireUserId(ctx));
    },

    async getOrganization(ctx, slug) {
      const userId = requireUserId(ctx);
      const parsed = OrganizationSlug.safeParse(slug);
      if (!parsed.success) throw new AppError('not_found', 'not_found');
      const org = await repo.findMyOrganizationBySlug(userId, parsed.data);
      if (!org) throw new AppError('not_found', 'not_found');
      return org;
    },

    async listMembers(ctx, orgId) {
      await requireRole(ctx, orgId);
      return repo.listMembers(orgId);
    },

    async listInvitations(ctx, orgId) {
      const { role } = await requireRole(ctx, orgId);
      if (!canManageMembers(role)) throw new AppError('forbidden', 'not_admin');
      return repo.listInvitations(orgId);
    },

    async inviteMember(ctx, raw) {
      const input = parseInput(CreateInvitationInput, raw);
      const { role } = await requireRole(ctx, input.orgId);
      assertAllowed(checkInvitation(role, input.role));
      return repo.createInvitation(input);
    },

    async acceptInvitation(ctx, raw) {
      requireUserId(ctx);
      return repo.acceptInvitation(parseInput(AcceptInvitationInput, raw).token);
    },

    async revokeInvitation(ctx, raw) {
      const input = parseInput(RevokeInvitationInput, raw);
      const { role } = await requireRole(ctx, input.orgId);
      if (!canManageMembers(role)) throw new AppError('forbidden', 'not_admin');
      await repo.revokeInvitation(input);
    },

    async changeMemberRole(ctx, raw) {
      const input = parseInput(ChangeMemberRoleInput, raw);
      const { userId, role } = await requireRole(ctx, input.orgId);
      const targetRole = await repo.getMemberRole(input.orgId, input.userId);
      if (!targetRole) throw new AppError('not_found', 'member_not_found');
      assertAllowed(
        checkRoleChange({
          actorRole: role,
          isSelf: userId === input.userId,
          targetRole,
          newRole: input.role,
        }),
      );
      await repo.changeMemberRole(input);
    },

    async removeMember(ctx, raw) {
      const input = parseInput(RemoveMemberInput, raw);
      const { userId, role } = await requireRole(ctx, input.orgId);
      const targetRole = await repo.getMemberRole(input.orgId, input.userId);
      if (!targetRole) throw new AppError('not_found', 'member_not_found');
      assertAllowed(
        checkMemberRemoval({ actorRole: role, isSelf: userId === input.userId, targetRole }),
      );
      await repo.removeMember(input);
    },

    async listAuditLog(ctx, orgId) {
      const { role } = await requireRole(ctx, orgId);
      if (!canViewAuditLog(role)) throw new AppError('forbidden', 'forbidden');
      return repo.listAuditLog(orgId, AUDIT_PAGE_SIZE);
    },
  };
}
