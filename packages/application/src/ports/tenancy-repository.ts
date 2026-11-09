import type {
  AuditLogEntry,
  ChangeMemberRoleInput,
  CreateInvitationInput,
  CreateOrganizationInput,
  Invitation,
  Member,
  OrganizationSummary,
  RemoveMemberInput,
  RevokeInvitationInput,
  Role,
} from '@prospector/contracts';

/**
 * Porta de dados de tenancy. A implementação é ligada à sessão do usuário
 * (RLS no banco) — ver `@prospector/db`. Erros de regra chegam como AppError.
 */
export interface TenancyRepository {
  createOrganization(input: CreateOrganizationInput): Promise<{ id: string; slug: string }>;
  listMyOrganizations(userId: string): Promise<OrganizationSummary[]>;
  findMyOrganizationBySlug(userId: string, slug: string): Promise<OrganizationSummary | null>;
  getMemberRole(orgId: string, userId: string): Promise<Role | null>;
  listMembers(orgId: string): Promise<Member[]>;
  listInvitations(orgId: string): Promise<Invitation[]>;
  createInvitation(
    input: CreateInvitationInput,
  ): Promise<{ invitationId: string; token: string; expiresAt: string }>;
  acceptInvitation(token: string): Promise<{ orgId: string; slug: string }>;
  revokeInvitation(input: RevokeInvitationInput): Promise<void>;
  changeMemberRole(input: ChangeMemberRoleInput): Promise<void>;
  removeMember(input: RemoveMemberInput): Promise<void>;
  listAuditLog(orgId: string, limit: number): Promise<AuditLogEntry[]>;
}
