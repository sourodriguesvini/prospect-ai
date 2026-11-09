import { AppError, type TenancyRepository } from '@prospector/application';
import { Role } from '@prospector/contracts';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { toAppError } from './errors';
import type { RpcArgs, RpcName } from './rpc';
import { mapAuditRow, mapInvitationRow, mapMemberRow, mapOrganizationRow } from './tenancy-rows';

const CreatedInvitation = z.object({
  invitationId: z.string(),
  token: z.string(),
  expiresAt: z.string(),
});
const AcceptedInvitation = z.object({ orgId: z.string(), slug: z.string() });

const ORG_SELECT = 'role, organizations!inner(id, name, slug, is_demo)';

/**
 * Repositório de tenancy ligado à sessão do usuário: toda leitura passa pelo RLS e toda
 * escrita pelas RPCs com checagem de papel. Nunca use com a secret key.
 */
export function createSupabaseTenancyRepository(client: SupabaseClient): TenancyRepository {
  async function rpc<N extends RpcName>(fn: N, args: RpcArgs<N>): Promise<unknown> {
    const { data, error } = await client.rpc(fn, args);
    if (error) throw toAppError(error);
    return data;
  }

  return {
    async createOrganization(input) {
      const id = z
        .string()
        .parse(await rpc('create_organization', { p_name: input.name, p_slug: input.slug }));
      return { id, slug: input.slug };
    },

    async listMyOrganizations(userId) {
      const { data, error } = await client
        .from('memberships')
        .select(ORG_SELECT)
        .eq('user_id', userId);
      if (error) throw toAppError(error);
      return (data ?? [])
        .map(mapOrganizationRow)
        .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
    },

    async findMyOrganizationBySlug(userId, slug) {
      const { data, error } = await client
        .from('memberships')
        .select(ORG_SELECT)
        .eq('user_id', userId)
        .eq('organizations.slug', slug)
        .maybeSingle();
      if (error) throw toAppError(error);
      return data ? mapOrganizationRow(data) : null;
    },

    async getMemberRole(orgId, userId) {
      const { data, error } = await client
        .from('memberships')
        .select('role')
        .eq('org_id', orgId)
        .eq('user_id', userId)
        .maybeSingle();
      if (error) throw toAppError(error);
      return data ? Role.parse((data as { role: unknown }).role) : null;
    },

    async listMembers(orgId) {
      const { data, error } = await client
        .from('memberships')
        .select('user_id, role, created_at, profiles(email, full_name)')
        .eq('org_id', orgId)
        .order('created_at', { ascending: true });
      if (error) throw toAppError(error);
      return (data ?? []).map(mapMemberRow);
    },

    async listInvitations(orgId) {
      const { data, error } = await client
        .from('invitations')
        .select('id, email, role, status, expires_at, created_at')
        .eq('org_id', orgId)
        .eq('status', 'pending')
        .order('created_at', { ascending: false });
      if (error) throw toAppError(error);
      const now = new Date();
      return (data ?? []).map((row) => mapInvitationRow(row, now));
    },

    async createInvitation(input) {
      const parsed = CreatedInvitation.safeParse(
        await rpc('create_invitation', {
          p_org_id: input.orgId,
          p_email: input.email,
          p_role: input.role,
        }),
      );
      if (!parsed.success) throw new AppError('unexpected', 'unexpected', { cause: parsed.error });
      return parsed.data;
    },

    async acceptInvitation(token) {
      const parsed = AcceptedInvitation.safeParse(
        await rpc('accept_invitation', { p_token: token }),
      );
      if (!parsed.success) throw new AppError('unexpected', 'unexpected', { cause: parsed.error });
      return parsed.data;
    },

    async revokeInvitation(input) {
      await rpc('revoke_invitation', {
        p_org_id: input.orgId,
        p_invitation_id: input.invitationId,
      });
    },

    async changeMemberRole(input) {
      await rpc('change_member_role', {
        p_org_id: input.orgId,
        p_user_id: input.userId,
        p_role: input.role,
      });
    },

    async removeMember(input) {
      await rpc('remove_member', { p_org_id: input.orgId, p_user_id: input.userId });
    },

    async listAuditLog(orgId, limit) {
      const { data, error } = await client
        .from('audit_log')
        .select('id, actor_type, actor_id, action, entity_type, entity_id, diff, occurred_at')
        .eq('org_id', orgId)
        .order('occurred_at', { ascending: false })
        .limit(limit);
      if (error) throw toAppError(error);
      return (data ?? []).map(mapAuditRow);
    },
  };
}
