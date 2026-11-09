import type { AuditLogEntry } from '@prospector/contracts';
import { systemClock, type Clock } from '../clock';
import type { AuditRepository } from '../ports/audit-repository';

/** Trilha de auditoria em memória (somente inclusão), para testes e o modo local sem banco. */
export function createMemoryAuditRepository(options: { clock?: Clock } = {}): AuditRepository & {
  entries(): AuditLogEntry[];
} {
  const clock = options.clock ?? systemClock;
  const log: AuditLogEntry[] = [];
  return {
    async append(entry) {
      log.push({
        id: log.length + 1,
        actorType: entry.actorType,
        actorLabel: entry.actorLabel,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId,
        diff: structuredClone(entry.diff),
        traceId: entry.traceId,
        occurredAt: clock.now().toISOString(),
      });
    },
    async listRecent(limit) {
      return [...log]
        .reverse()
        .slice(0, limit)
        .map((e) => structuredClone(e));
    },
    entries: () => log.map((e) => structuredClone(e)),
  };
}
