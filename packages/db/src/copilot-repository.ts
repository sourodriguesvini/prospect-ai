import type {
  AiTelemetryRepository,
  AiUsageSummary,
  CopilotRepository,
} from '@prospector/application';
import {
  CopilotMessageRole,
  CopilotMessageStatus,
  GenerationUsage,
  ToolCallRequest,
  ToolStatus,
  type CopilotStoredMessage,
  type CopilotThread,
} from '@prospector/contracts';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { toAppError } from './errors';
import { AUDIT_HEADER, encodeAuditHeader } from './strategy-repository';

const THREAD_SELECT =
  'id, title, created_at, updated_at, archived_at, last_activity_at, message_count';
const MESSAGE_SELECT =
  'id, thread_id, seq, role, content, status, model, prompt_version, trace_id, tool_calls, tool_call_id, tool_name, tool_status, error_code, usage, created_at';

/** bigint/numeric chegam como número ou texto, conforme o tamanho. */
const Numeric = z.union([
  z.number(),
  z
    .string()
    .regex(/^-?\d+(\.\d+)?$/)
    .transform(Number),
]);

const ThreadRow = z.object({
  id: z.string(),
  title: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
  archived_at: z.string().nullable(),
  last_activity_at: z.string().optional(),
  message_count: Numeric.optional(),
});

const MessageRow = z.object({
  id: z.string(),
  thread_id: z.string(),
  role: CopilotMessageRole,
  content: z.string(),
  status: CopilotMessageStatus,
  model: z.string().nullable(),
  prompt_version: z.string().nullable(),
  trace_id: z.string(),
  tool_calls: z.array(ToolCallRequest).nullable(),
  tool_call_id: z.string().nullable(),
  tool_name: z.string().nullable(),
  tool_status: ToolStatus.nullable(),
  error_code: z.string().nullable(),
  usage: GenerationUsage.nullable().catch(null),
  created_at: z.string(),
});

function mapThread(raw: unknown): CopilotThread {
  const row = ThreadRow.parse(raw);
  return {
    id: row.id,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at,
    lastActivityAt: row.last_activity_at ?? row.created_at,
    messageCount: row.message_count ?? 0,
  };
}

function mapMessage(raw: unknown): CopilotStoredMessage {
  const row = MessageRow.parse(raw);
  return {
    id: row.id,
    threadId: row.thread_id,
    role: row.role,
    content: row.content,
    status: row.status,
    model: row.model,
    promptVersion: row.prompt_version,
    traceId: row.trace_id,
    toolCalls: row.tool_calls,
    toolCallId: row.tool_call_id,
    toolName: row.tool_name,
    toolStatus: row.tool_status,
    errorCode: row.error_code,
    usage: row.usage,
    createdAt: row.created_at,
  };
}

interface Result {
  data: unknown;
  error: { message?: string | null; code?: string | null } | null;
}

async function run(query: PromiseLike<Result>): Promise<unknown> {
  const { data, error } = await query;
  if (error) throw toAppError(error);
  return data;
}

/**
 * Conversas e telemetria do Copiloto via PostgREST (migração 20261110150000). Criar, renomear e
 * arquivar mandam o registro de auditoria no cabeçalho (ADR-0010); mensagens e telemetria são
 * só inclusão (o banco recusa alteração e exclusão).
 */
export function createSupabaseCopilotRepository(
  client: SupabaseClient,
): CopilotRepository & AiTelemetryRepository {
  return {
    async createThread(title, audit) {
      const row = await run(
        client
          .from('copilot_threads')
          .insert({ title })
          .setHeader(AUDIT_HEADER, encodeAuditHeader('copilot_threads', audit))
          .select('id, title, created_at, updated_at, archived_at')
          .single(),
      );
      return mapThread(row);
    },

    async renameThread(id, title, audit) {
      const rows = (await run(
        client
          .from('copilot_threads')
          .update({ title })
          .eq('id', id)
          .setHeader(AUDIT_HEADER, encodeAuditHeader('copilot_threads', audit))
          .select('id'),
      )) as unknown[] | null;
      return (rows ?? []).length > 0;
    },

    async setArchived(id, archived, audit) {
      const rows = (await run(
        client
          .from('copilot_threads')
          .update({ archived_at: archived ? new Date().toISOString() : null })
          .eq('id', id)
          .setHeader(AUDIT_HEADER, encodeAuditHeader('copilot_threads', audit))
          .select('id'),
      )) as unknown[] | null;
      return (rows ?? []).length > 0;
    },

    async getThread(id) {
      const row = await run(
        client.from('copilot_thread_summaries').select(THREAD_SELECT).eq('id', id).maybeSingle(),
      );
      return row ? mapThread(row) : null;
    },

    async listThreads({ archived, limit }) {
      let query = client.from('copilot_thread_summaries').select(THREAD_SELECT);
      query = archived ? query.not('archived_at', 'is', null) : query.is('archived_at', null);
      const rows = (await run(
        query.order('last_activity_at', { ascending: false }).limit(limit),
      )) as unknown[] | null;
      return (rows ?? []).map(mapThread);
    },

    async listMessages(threadId, limit) {
      const rows = (await run(
        client
          .from('copilot_messages')
          .select(MESSAGE_SELECT)
          .eq('thread_id', threadId)
          .order('seq', { ascending: false })
          .limit(limit),
      )) as unknown[] | null;
      return (rows ?? []).map(mapMessage).reverse();
    },

    async appendMessage(message) {
      const row = await run(
        client
          .from('copilot_messages')
          .insert({
            thread_id: message.threadId,
            role: message.role,
            content: message.content,
            status: message.status,
            model: message.model,
            prompt_version: message.promptVersion,
            trace_id: message.traceId,
            tool_calls: message.toolCalls,
            tool_call_id: message.toolCallId,
            tool_name: message.toolName,
            tool_status: message.toolStatus,
            error_code: message.errorCode,
            usage: message.usage,
          })
          .select(MESSAGE_SELECT)
          .single(),
      );
      return mapMessage(row);
    },

    async recordLlmCall(call) {
      await run(
        client.from('llm_calls').insert({
          task: call.task,
          provider: call.provider,
          model: call.model,
          prompt_version: call.promptVersion,
          trace_id: call.traceId,
          thread_id: call.threadId,
          job_id: call.jobId,
          status: call.status,
          error_code: call.errorCode,
          done_reason: call.doneReason,
          input_tokens: call.inputTokens,
          output_tokens: call.outputTokens,
          total_ms: call.totalMs === null ? null : Math.round(call.totalMs * 10) / 10,
          load_ms: call.loadMs === null ? null : Math.round(call.loadMs * 10) / 10,
        }),
      );
    },

    async recordToolCall(call) {
      await run(
        client.from('tool_calls').insert({
          trace_id: call.traceId,
          thread_id: call.threadId,
          job_id: call.jobId,
          tool: call.tool,
          input_redacted: call.inputRedacted,
          output_summary: call.outputSummary,
          status: call.status,
          error_code: call.errorCode,
          duration_ms: call.durationMs,
        }),
      );
    },

    async usageSince(since): Promise<AiUsageSummary> {
      const from = since.toISOString();
      const [llm, tools] = await Promise.all([
        run(
          client
            .from('llm_calls')
            .select('model, status, output_tokens, total_ms')
            .gte('created_at', from)
            .limit(5000),
        ),
        run(client.from('tool_calls').select('status').gte('created_at', from).limit(5000)),
      ]);
      const calls = z
        .array(
          z.object({
            model: z.string(),
            status: z.string(),
            output_tokens: Numeric.nullable(),
            total_ms: Numeric.nullable(),
          }),
        )
        .parse(llm ?? []);
      const used = z.array(z.object({ status: z.string() })).parse(tools ?? []);
      const byModel = new Map<string, { generations: number; outputTokens: number }>();
      for (const call of calls) {
        const entry = byModel.get(call.model) ?? { generations: 0, outputTokens: 0 };
        entry.generations += 1;
        entry.outputTokens += call.output_tokens ?? 0;
        byModel.set(call.model, entry);
      }
      return {
        since: from,
        generations: calls.length,
        failed: calls.filter((call) => call.status === 'error').length,
        cancelled: calls.filter((call) => call.status === 'cancelled').length,
        outputTokens: calls.reduce((sum, call) => sum + (call.output_tokens ?? 0), 0),
        totalMs: calls.reduce((sum, call) => sum + (call.total_ms ?? 0), 0),
        byModel: [...byModel.entries()]
          .map(([model, entry]) => ({ model, ...entry }))
          .sort((a, b) => b.generations - a.generations),
        toolCalls: used.length,
        toolErrors: used.filter((call) => call.status !== 'ok').length,
      };
    },
  };
}
