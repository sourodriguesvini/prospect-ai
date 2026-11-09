import { z } from 'zod';

/** Papéis em ordem decrescente de poder. Fonte única para UI, aplicação e testes. */
export const ROLES = ['owner', 'admin', 'operator', 'viewer'] as const;
export const Role = z.enum(ROLES);
export type Role = z.infer<typeof Role>;

/** Convites nunca concedem `owner`: a propriedade só é transferida por um owner. */
export const INVITABLE_ROLES = ['admin', 'operator', 'viewer'] as const;
export const InvitableRole = z.enum(INVITABLE_ROLES);
export type InvitableRole = z.infer<typeof InvitableRole>;

export const ROLE_LABELS: Record<Role, string> = {
  owner: 'Proprietário',
  admin: 'Administrador',
  operator: 'Operador',
  viewer: 'Leitor',
};

export const OrganizationName = z
  .string()
  .trim()
  .min(2, { error: 'O nome precisa ter ao menos 2 caracteres.' })
  .max(120, { error: 'O nome pode ter no máximo 120 caracteres.' });

/** Mesmo padrão do `check` em `organizations.slug`. */
export const ORG_SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,46}[a-z0-9])$/;
export const OrganizationSlug = z.string().trim().toLowerCase().regex(ORG_SLUG_PATTERN, {
  error: 'Use de 3 a 48 caracteres: letras minúsculas, números e hífens (sem hífen nas pontas).',
});

export const Email = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email({ error: 'Informe um e-mail válido.' }));

export const Uuid = z.uuid({ error: 'Identificador inválido.' });

/** Token de convite: 64 caracteres hexadecimais (o banco guarda apenas o SHA-256). */
export const InvitationToken = z.string().regex(/^[a-f0-9]{64}$/, { error: 'Convite inválido.' });

export const CreateOrganizationInput = z.object({
  name: OrganizationName,
  slug: OrganizationSlug,
});
export type CreateOrganizationInput = z.infer<typeof CreateOrganizationInput>;

export const CreateInvitationInput = z.object({
  orgId: Uuid,
  email: Email,
  role: InvitableRole,
});
export type CreateInvitationInput = z.infer<typeof CreateInvitationInput>;

export const AcceptInvitationInput = z.object({ token: InvitationToken });
export type AcceptInvitationInput = z.infer<typeof AcceptInvitationInput>;

export const RevokeInvitationInput = z.object({ orgId: Uuid, invitationId: Uuid });
export type RevokeInvitationInput = z.infer<typeof RevokeInvitationInput>;

export const ChangeMemberRoleInput = z.object({ orgId: Uuid, userId: Uuid, role: Role });
export type ChangeMemberRoleInput = z.infer<typeof ChangeMemberRoleInput>;

export const RemoveMemberInput = z.object({ orgId: Uuid, userId: Uuid });
export type RemoveMemberInput = z.infer<typeof RemoveMemberInput>;

// ---- Leituras (linhas devolvidas pelo banco, validadas na borda) ----

export const OrganizationSummary = z.object({
  id: Uuid,
  name: z.string(),
  slug: z.string(),
  isDemo: z.boolean(),
  role: Role,
});
export type OrganizationSummary = z.infer<typeof OrganizationSummary>;

export const Member = z.object({
  userId: Uuid,
  email: z.string().nullable(),
  fullName: z.string().nullable(),
  role: Role,
  joinedAt: z.string(),
});
export type Member = z.infer<typeof Member>;

export const InvitationStatus = z.enum(['pending', 'accepted', 'revoked', 'expired']);
export type InvitationStatus = z.infer<typeof InvitationStatus>;

export const Invitation = z.object({
  id: Uuid,
  email: z.string(),
  role: InvitableRole,
  status: InvitationStatus,
  expiresAt: z.string(),
  createdAt: z.string(),
});
export type Invitation = z.infer<typeof Invitation>;

export const ActorType = z.enum(['user', 'agent', 'system']);

export const AuditLogEntry = z.object({
  id: z.number().int(),
  actorType: ActorType,
  actorId: z.string().nullable(),
  action: z.string(),
  entityType: z.string(),
  entityId: z.string().nullable(),
  diff: z.record(z.string(), z.unknown()).nullable(),
  occurredAt: z.string(),
});
export type AuditLogEntry = z.infer<typeof AuditLogEntry>;
