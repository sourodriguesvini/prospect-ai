import type { AuditRepository } from '@prospector/application';
import type { SupabaseClient } from '@supabase/supabase-js';
import { AUDIT_SELECT, mapAuditRow } from './audit-rows';
import { toAppError } from './errors';

/** Trilha de auditoria via PostgREST. O banco só concede select e insert (append-only). */
export function createSupabaseAuditRepository(client: SupabaseClient): AuditRepository {
  return {
    async append(entry) {
      const { error } = await client.from('audit_log').insert({
        actor_type: entry.actorType,
        actor_label: entry.actorLabel,
        action: entry.action,
        entity_type: entry.entityType,
        entity_id: entry.entityId,
        diff: entry.diff,
        trace_id: entry.traceId,
      });
      if (error) throw toAppError(error);
    },

    async listRecent(limit) {
      const { data, error } = await client
        .from('audit_log')
        .select(AUDIT_SELECT)
        .order('occurred_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(limit);
      if (error) throw toAppError(error);
      return (data ?? []).map(mapAuditRow);
    },
  };
}
