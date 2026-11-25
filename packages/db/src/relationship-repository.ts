import {
  AppError,
  type PendingAudit,
  type RelationshipRepository,
  type TaskPatch,
} from '@prospector/application';
import { AiReviewRecord } from '@prospector/contracts';
import type { SupabaseClient } from '@supabase/supabase-js';
import { toAppError } from './errors';
import {
  interactionColumns,
  mapApproval,
  mapInteraction,
  mapMessage,
  mapOpportunity,
  mapPlan,
  mapStageChange,
  mapSummary,
  mapSuppression,
  mapTask,
  messageColumns,
  opportunityColumns,
  opportunityPatchColumns,
  planColumns,
  taskColumns,
} from './relationship-rows';
import { AUDIT_HEADER, encodeAuditHeader, type AuditedTable } from './strategy-repository';

interface Result {
  data: unknown;
  error: { message?: string | null; code?: string | null } | null;
}

async function run(query: PromiseLike<Result>): Promise<unknown> {
  const { data, error } = await query;
  if (error) throw toAppError(error);
  return data;
}

async function rows(query: PromiseLike<Result>): Promise<unknown[]> {
  return ((await run(query)) as unknown[] | null) ?? [];
}

const INTERACTION_COVERS: AuditedTable[] = [
  'opportunities',
  'opportunity_stage_changes',
  'suppression_entries',
  'tasks',
];

/** Valor de filtro `or` do PostgREST entre aspas (domínio tem pontos). */
const quoted = (value: string) => `"${value.replace(/["\\]/g, '')}"`;

/**
 * Relacionamento via PostgREST (ADR-0014). Operações de várias tabelas passam por RPCs atômicas
 * (`open_opportunity`, `change_opportunity_stage`, `approve_message`, `record_interaction`,
 * `suppress_company`); a auditoria vai no cabeçalho, registrada na tabela principal e cobrindo as
 * demais (ADR-0010). O banco confere de novo aprovação, versão, hash e supressão.
 */
export function createSupabaseRelationshipRepository(
  client: SupabaseClient,
): RelationshipRepository {
  const header = (table: AuditedTable, audit: PendingAudit, covers: AuditedTable[] = []) =>
    encodeAuditHeader(table, audit, covers);

  async function opportunityById(id: string) {
    const data = await run(client.from('opportunities').select('*').eq('id', id).maybeSingle());
    return data ? mapOpportunity(data) : null;
  }

  async function messageById(id: string) {
    const data = await run(client.from('outbound_messages').select('*').eq('id', id).maybeSingle());
    return data ? mapMessage(data) : null;
  }

  async function approvalById(id: string) {
    const data = await run(client.from('approvals').select('*').eq('id', id).maybeSingle());
    return data ? mapApproval(data) : null;
  }

  async function interactionById(id: string) {
    const data = await run(client.from('interactions').select('*').eq('id', id).maybeSingle());
    return data ? mapInteraction(data) : null;
  }

  async function taskById(id: string) {
    const data = await run(client.from('tasks').select('*').eq('id', id).maybeSingle());
    return data ? mapTask(data) : null;
  }

  async function suppressionById(id: string) {
    const data = await run(
      client.from('suppression_entries').select('*').eq('id', id).maybeSingle(),
    );
    return data ? mapSuppression(data) : null;
  }

  /** Atualização condicional: nenhuma linha = não existe ou já mudou de situação. */
  async function conditional<T>(
    data: unknown,
    exists: () => Promise<unknown>,
    map: (raw: unknown) => T,
  ): Promise<T> {
    if (data) return map(data);
    if (await exists()) throw new AppError('conflict', 'invalid_status_change');
    throw new AppError('not_found', 'not_found');
  }

  function required<T>(value: T | null): T {
    if (!value) throw new AppError('not_found', 'not_found');
    return value;
  }

  return {
    async listOpportunities(filter) {
      let query = client
        .from('opportunity_summaries')
        .select('*')
        .order('updated_at', { ascending: false })
        .limit(filter.limit ?? 500);
      if (!filter.includeClosed) query = query.is('closed_at', null);
      if (filter.companyId) query = query.eq('company_id', filter.companyId);
      if (filter.stages?.length) query = query.in('stage', [...filter.stages]);
      const summaries = (await rows(query)).map(mapSummary);
      return summaries.sort((a, b) =>
        (b.lastInteractionAt ?? b.updatedAt).localeCompare(a.lastInteractionAt ?? a.updatedAt),
      );
    },

    async getOpportunitySummary(id) {
      const data = await run(
        client.from('opportunity_summaries').select('*').eq('id', id).maybeSingle(),
      );
      return data ? mapSummary(data) : null;
    },

    getOpportunity: opportunityById,

    async openOpportunityFor(companyId) {
      const data = await run(
        client
          .from('opportunities')
          .select('*')
          .eq('company_id', companyId)
          .is('closed_at', null)
          .maybeSingle(),
      );
      return data ? mapOpportunity(data) : null;
    },

    async listStageChanges(opportunityId) {
      return (
        await rows(
          client
            .from('opportunity_stage_changes')
            .select('*')
            .eq('opportunity_id', opportunityId)
            .order('created_at'),
        )
      ).map(mapStageChange);
    },

    async listPlans(opportunityId) {
      return (
        await rows(
          client
            .from('approach_plans')
            .select('*')
            .eq('opportunity_id', opportunityId)
            .order('version', { ascending: false }),
        )
      ).map(mapPlan);
    },

    async listMessages(filter) {
      let query = client
        .from(filter.latestOnly ? 'current_outbound_messages' : 'outbound_messages')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(filter.limit ?? 500);
      if (filter.opportunityId) query = query.eq('opportunity_id', filter.opportunityId);
      if (filter.status) query = query.eq('status', filter.status);
      return (await rows(query)).map(mapMessage);
    },

    getMessage: messageById,

    async latestVersionOf(threadId) {
      const data = await run(
        client
          .from('current_outbound_messages')
          .select('*')
          .eq('thread_id', threadId)
          .maybeSingle(),
      );
      return data ? mapMessage(data) : null;
    },

    async messageReviews(messageIds) {
      const reviews = new Map<string, AiReviewRecord>();
      const ids = [...new Set(messageIds)];
      if (ids.length === 0) return reviews;
      // Só a chave `aiReview` do registro de inclusão (tipos e contagens; nunca o texto).
      const data = await rows(
        client
          .from('audit_log')
          .select('entity_id, ai_review:diff->aiReview')
          .eq('entity_type', 'outbound_message')
          .in('entity_id', ids)
          .not('diff->aiReview', 'is', null),
      );
      for (const raw of data) {
        const row = raw as { entity_id?: unknown; ai_review?: unknown };
        const review = AiReviewRecord.safeParse(row.ai_review);
        if (typeof row.entity_id === 'string' && review.success) {
          reviews.set(row.entity_id, review.data);
        }
      }
      return reviews;
    },

    async listApprovals(filter) {
      let query = client
        .from('approvals')
        .select('*')
        .order('decided_at', { ascending: false })
        .limit(filter.limit ?? 500);
      if (filter.opportunityId) query = query.eq('opportunity_id', filter.opportunityId);
      return (await rows(query)).map(mapApproval);
    },

    getApproval: approvalById,

    async listInteractions(filter) {
      let query = client
        .from('interactions')
        .select('*')
        .order('occurred_at', { ascending: false })
        .limit(filter.limit ?? 500);
      if (filter.opportunityId) query = query.eq('opportunity_id', filter.opportunityId);
      return (await rows(query)).map(mapInteraction);
    },

    getInteraction: interactionById,

    async listTasks(filter) {
      let query = client
        .from('tasks')
        .select('*')
        .order('due_at')
        .limit(filter.limit ?? 500);
      if (filter.opportunityId) query = query.eq('opportunity_id', filter.opportunityId);
      if (filter.status) query = query.eq('status', filter.status);
      return (await rows(query)).map(mapTask);
    },

    getTask: taskById,

    async activeSuppressions(company) {
      const conditions = [`company_id.eq.${quoted(company.id)}`];
      if (company.cnpjRoot) conditions.push(`cnpj_root.eq.${quoted(company.cnpjRoot)}`);
      if (company.primaryDomain) conditions.push(`domain.eq.${quoted(company.primaryDomain)}`);
      return (
        await rows(
          client
            .from('suppression_entries')
            .select('*')
            .is('lifted_at', null)
            .or(conditions.join(','))
            .order('created_at', { ascending: false }),
        )
      ).map(mapSuppression);
    },

    async listSuppressions(companyId) {
      return (
        await rows(
          client
            .from('suppression_entries')
            .select('*')
            .eq('company_id', companyId)
            .order('created_at', { ascending: false }),
        )
      ).map(mapSuppression);
    },

    getSuppression: suppressionById,

    async openOpportunity(row, audit) {
      const id = await run(
        client
          .rpc('open_opportunity', { p_opportunity: opportunityColumns(row) })
          .setHeader(AUDIT_HEADER, header('opportunities', audit, ['opportunity_stage_changes'])),
      );
      return required(await opportunityById(String(id)));
    },

    async changeStage(id, move, audit) {
      await run(
        client
          .rpc('change_opportunity_stage', {
            p_id: id,
            p_from: move.from,
            p_to: move.to,
            p_note: move.note,
          })
          .setHeader(AUDIT_HEADER, header('opportunities', audit, ['opportunity_stage_changes'])),
      );
      return required(await opportunityById(id));
    },

    async updateOpportunity(id, patch, audit) {
      const data = await run(
        client
          .from('opportunities')
          .update(opportunityPatchColumns(patch))
          .eq('id', id)
          .select('*')
          .maybeSingle()
          .setHeader(AUDIT_HEADER, header('opportunities', audit)),
      );
      if (!data) throw new AppError('not_found', 'not_found');
      return mapOpportunity(data);
    },

    async insertPlan(plan, audit) {
      const data = await run(
        client
          .from('approach_plans')
          .insert(planColumns(plan))
          .select('*')
          .single()
          .setHeader(AUDIT_HEADER, header('approach_plans', audit)),
      );
      return mapPlan(data);
    },

    async decidePlan(id, status, audit) {
      const data = await run(
        client
          .from('approach_plans')
          .update({ status, decided_at: new Date().toISOString() })
          .eq('id', id)
          .eq('status', 'draft')
          .select('*')
          .maybeSingle()
          .setHeader(AUDIT_HEADER, header('approach_plans', audit)),
      );
      return conditional(
        data,
        () => run(client.from('approach_plans').select('id').eq('id', id).maybeSingle()),
        mapPlan,
      );
    },

    async insertMessage(message, audit) {
      const data = await run(
        client
          .from('outbound_messages')
          .insert(messageColumns(message))
          .select('*')
          .single()
          .setHeader(AUDIT_HEADER, header('outbound_messages', audit)),
      );
      return mapMessage(data);
    },

    async discardMessage(id, audit) {
      const data = await run(
        client
          .from('outbound_messages')
          .update({ status: 'discarded', decided_at: new Date().toISOString() })
          .eq('id', id)
          .eq('status', 'draft')
          .select('*')
          .maybeSingle()
          .setHeader(AUDIT_HEADER, header('outbound_messages', audit)),
      );
      return conditional(data, () => messageById(id), mapMessage);
    },

    async approveMessage(approval, audit) {
      const id = await run(
        client
          .rpc('approve_message', {
            p_approval: {
              id: approval.id,
              entity_id: approval.messageId,
              opportunity_id: approval.opportunityId,
              payload_hash: approval.payloadHash,
              channel: approval.channel,
              clearance: approval.clearance,
              expires_at: approval.expiresAt,
            },
          })
          .setHeader(AUDIT_HEADER, header('approvals', audit, ['outbound_messages'])),
      );
      return required(await approvalById(String(id)));
    },

    async revokeApproval(id, reason, audit) {
      const data = await run(
        client
          .from('approvals')
          .update({
            status: 'revoked',
            revoked_at: new Date().toISOString(),
            revoke_reason: reason,
          })
          .eq('id', id)
          .eq('status', 'approved')
          .select('*')
          .maybeSingle()
          .setHeader(AUDIT_HEADER, header('approvals', audit)),
      );
      return conditional(data, () => approvalById(id), mapApproval);
    },

    async recordInteraction(row, stage, suppression, audit) {
      const id = await run(
        client
          .rpc('record_interaction', {
            p_interaction: interactionColumns(row),
            p_stage: stage ? { from: stage.from, to: stage.to, note: stage.note } : null,
            p_suppression: suppression
              ? { reason: suppression.reason, source: suppression.source }
              : null,
          })
          .setHeader(AUDIT_HEADER, header('interactions', audit, INTERACTION_COVERS)),
      );
      return required(await interactionById(String(id)));
    },

    async saveAnalysis(id, record, audit) {
      const data = await run(
        client
          .from('interactions')
          .update({
            analysis: record.analysis,
            analysis_prompt_id: record.promptId,
            analysis_model: record.model,
            analyzed_at: new Date().toISOString(),
          })
          .eq('id', id)
          .select('*')
          .maybeSingle()
          .setHeader(AUDIT_HEADER, header('interactions', audit)),
      );
      if (!data) throw new AppError('not_found', 'not_found');
      return mapInteraction(data);
    },

    async insertTask(task, audit) {
      const data = await run(
        client
          .from('tasks')
          .insert(taskColumns(task))
          .select('*')
          .single()
          .setHeader(AUDIT_HEADER, header('tasks', audit)),
      );
      return mapTask(data);
    },

    async updateTask(id, patch: TaskPatch, audit) {
      const at = new Date().toISOString();
      const values =
        'dueAt' in patch
          ? { due_at: patch.dueAt }
          : patch.status === 'done'
            ? { status: 'done', completed_at: at }
            : { status: 'cancelled', completed_at: at, cancel_reason: patch.cancelReason };
      const data = await run(
        client
          .from('tasks')
          .update(values)
          .eq('id', id)
          .eq('status', 'open')
          .select('*')
          .maybeSingle()
          .setHeader(AUDIT_HEADER, header('tasks', audit)),
      );
      return conditional(data, () => taskById(id), mapTask);
    },

    async suppress(companyId, entry, audit) {
      const id = await run(
        client
          .rpc('suppress_company', {
            p_entry: {
              company_id: companyId,
              reason: entry.reason,
              source: entry.source,
              interaction_id: entry.interactionId ?? null,
            },
          })
          .setHeader(AUDIT_HEADER, header('suppression_entries', audit, ['tasks'])),
      );
      return required(await suppressionById(String(id)));
    },

    async liftSuppression(id, reason, audit) {
      const data = await run(
        client
          .from('suppression_entries')
          .update({ lifted_at: new Date().toISOString(), lift_reason: reason })
          .eq('id', id)
          .is('lifted_at', null)
          .select('*')
          .maybeSingle()
          .setHeader(AUDIT_HEADER, header('suppression_entries', audit)),
      );
      return conditional(data, () => suppressionById(id), mapSuppression);
    },
  };
}
