import {
  AuditLogEntry,
  Invitation,
  InvitableRole,
  InvitationStatus,
  Member,
  OrganizationSummary,
  Role,
} from '@prospector/contracts';
import { z } from 'zod';

/**
 * Formatos das linhas devolvidas pelo PostgREST (snake_case) e conversão para os contratos.
 * Validar aqui evita que uma mudança de esquema chegue silenciosamente à UI.
 */

const OrgEmbed = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  is_demo: z.boolean(),
});

const MembershipWithOrgRow = z.object({
  role: Role,
  // Relação muitos-para-um: o PostgREST devolve objeto; tolera array por segurança.
  organizations: z.union([
    OrgEmbed,
    z
      .array(OrgEmbed)
      .length(1)
      .transform((a) => a[0]!),
  ]),
});

export function mapOrganizationRow(raw: unknown): OrganizationSummary {
  const row = MembershipWithOrgRow.parse(raw);
  return OrganizationSummary.parse({
    id: row.organizations.id,
    name: row.organizations.name,
    slug: row.organizations.slug,
    isDemo: row.organizations.is_demo,
    role: row.role,
  });
}

const ProfileEmbed = z.object({ email: z.string().nullable(), full_name: z.string().nullable() });

const MemberRow = z.object({
  user_id: z.string(),
  role: Role,
  created_at: z.string(),
  profiles: z
    .union([
      ProfileEmbed,
      z
        .array(ProfileEmbed)
        .max(1)
        .transform((a) => a[0] ?? null),
    ])
    .nullable(),
});

export function mapMemberRow(raw: unknown): Member {
  const row = MemberRow.parse(raw);
  return Member.parse({
    userId: row.user_id,
    email: row.profiles?.email ?? null,
    fullName: row.profiles?.full_name ?? null,
    role: row.role,
    joinedAt: row.created_at,
  });
}

const InvitationRow = z.object({
  id: z.string(),
  email: z.string(),
  role: InvitableRole,
  status: InvitationStatus,
  expires_at: z.string(),
  created_at: z.string(),
});

/** Convite pendente cujo prazo passou é exibido como expirado. */
export function mapInvitationRow(raw: unknown, now: Date = new Date()): Invitation {
  const row = InvitationRow.parse(raw);
  const expired = row.status === 'pending' && new Date(row.expires_at).getTime() <= now.getTime();
  return Invitation.parse({
    id: row.id,
    email: row.email,
    role: row.role,
    status: expired ? 'expired' : row.status,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  });
}

const AuditRow = z.object({
  id: z.union([z.number(), z.string()]).transform((v) => Number(v)),
  actor_type: z.string(),
  actor_id: z.string().nullable(),
  action: z.string(),
  entity_type: z.string(),
  entity_id: z.string().nullable(),
  diff: z.record(z.string(), z.unknown()).nullable(),
  occurred_at: z.string(),
});

export function mapAuditRow(raw: unknown): AuditLogEntry {
  const row = AuditRow.parse(raw);
  return AuditLogEntry.parse({
    id: row.id,
    actorType: row.actor_type,
    actorId: row.actor_id,
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id,
    diff: row.diff,
    occurredAt: row.occurred_at,
  });
}
