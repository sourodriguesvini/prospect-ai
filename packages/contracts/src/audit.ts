import { z } from 'zod';

/** Quem fez a ação: o usuário (único, ADR-0007), um agente ou um processo do sistema. */
export const ActorType = z.enum(['user', 'agent', 'system']);
export type ActorType = z.infer<typeof ActorType>;

/**
 * Ação auditada no formato dominio.entidade.verbo (docs/contracts §2), de 2 a 4 partes em
 * minúsculas. Mesmo padrão do `check` em `audit_log.action`.
 */
export const AUDIT_ACTION_PATTERN = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){1,3}$/;
export const AuditAction = z.string().regex(AUDIT_ACTION_PATTERN, {
  error: 'Ação de auditoria fora do formato dominio.entidade.verbo.',
});

export const AuditDiff = z.record(z.string(), z.unknown());
export type AuditDiff = z.infer<typeof AuditDiff>;

/** O que um caso de uso informa ao registrar uma ação; ator e traceId vêm do contexto. */
export const RecordAuditInput = z.object({
  action: AuditAction,
  entityType: z.string().trim().min(1).max(60),
  entityId: z.string().max(200).nullable().default(null),
  diff: AuditDiff.default({}),
});
export type RecordAuditInput = z.input<typeof RecordAuditInput>;

export const AuditLogEntry = z.object({
  id: z.number().int(),
  actorType: ActorType,
  actorLabel: z.string().nullable(),
  action: z.string(),
  entityType: z.string(),
  entityId: z.string().nullable(),
  diff: AuditDiff,
  traceId: z.string().nullable(),
  occurredAt: z.string(),
});
export type AuditLogEntry = z.infer<typeof AuditLogEntry>;

/**
 * Estado do banco visto pelo app: sem credenciais, acessível, acessível mas sem as migrações
 * aplicadas, ou fora do ar (rede ou credencial recusada).
 */
export const DatabaseStatus = z.enum(['not_configured', 'ok', 'schema_missing', 'unreachable']);
export type DatabaseStatus = z.infer<typeof DatabaseStatus>;
