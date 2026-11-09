import { RecordAuditInput, type AuditLogEntry } from '@prospector/contracts';
import { auditActor, type RequestContext } from '../context';
import { parseInput } from '../errors';
import type { AuditRepository } from '../ports/audit-repository';

export const AUDIT_PAGE_SIZE = 100;

export interface AuditService {
  /** Registra uma ação com o ator e o traceId do contexto. */
  record(ctx: RequestContext, input: RecordAuditInput): Promise<void>;
  /** Entradas mais recentes primeiro. */
  listRecent(ctx: RequestContext, limit?: number): Promise<AuditLogEntry[]>;
}

export function createAuditService(repo: AuditRepository): AuditService {
  return {
    async record(ctx, raw) {
      const input = parseInput(RecordAuditInput, raw);
      await repo.append({ ...auditActor(ctx.actor), ...input, traceId: ctx.traceId });
    },

    async listRecent(_ctx, limit = AUDIT_PAGE_SIZE) {
      return repo.listRecent(Math.min(Math.max(1, Math.trunc(limit)), AUDIT_PAGE_SIZE));
    },
  };
}
