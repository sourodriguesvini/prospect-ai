import type { CopilotStoredMessage, CopilotThread } from '@prospector/contracts';
import { systemClock, type Clock } from '../clock';
import { AppError } from '../errors';
import type { AuditRepository, PendingAudit } from '../ports/audit-repository';
import type {
  AiTelemetryRepository,
  CopilotRepository,
  NewLlmCall,
  NewToolCall,
} from '../ports/copilot-repository';

interface ThreadRow {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}

const clone = <T>(value: T): T => structuredClone(value);

/**
 * Conversas e telemetria do Copiloto em memória: mesmo comportamento observável do banco
 * (mensagens e telemetria só inclusão, auditoria gravada junto com criar, renomear e arquivar).
 */
export function createMemoryCopilotRepository(options: {
  audit: AuditRepository;
  clock?: Clock;
  newId?: () => string;
}): CopilotRepository &
  AiTelemetryRepository & { llmCalls(): NewLlmCall[]; toolCalls(): NewToolCall[] } {
  const clock = options.clock ?? systemClock;
  const newId = options.newId ?? (() => crypto.randomUUID());
  const now = () => clock.now().toISOString();
  const threads = new Map<string, ThreadRow>();
  const messages: CopilotStoredMessage[] = [];
  const llm: Array<NewLlmCall & { createdAt: string }> = [];
  const tools: Array<NewToolCall & { createdAt: string }> = [];

  async function audited(audit: PendingAudit, id: string): Promise<void> {
    await options.audit.append({
      actorType: audit.actorType,
      actorLabel: audit.actorLabel,
      action: audit.action,
      entityType: audit.entityType,
      entityId: audit.entityId ?? id,
      diff: { ...audit.diff },
      traceId: audit.traceId,
    });
  }

  function view(row: ThreadRow): CopilotThread {
    const own = messages.filter((message) => message.threadId === row.id);
    const last = own.at(-1);
    return {
      ...row,
      lastActivityAt: last ? last.createdAt : row.createdAt,
      messageCount: own.filter((message) => message.role !== 'tool').length,
    };
  }

  return {
    async createThread(title, audit) {
      const at = now();
      const row: ThreadRow = { id: newId(), title, createdAt: at, updatedAt: at, archivedAt: null };
      threads.set(row.id, row);
      await audited(audit, row.id);
      return view(row);
    },

    async renameThread(id, title, audit) {
      const row = threads.get(id);
      if (!row) return false;
      row.title = title;
      row.updatedAt = now();
      await audited(audit, id);
      return true;
    },

    async setArchived(id, archived, audit) {
      const row = threads.get(id);
      if (!row) return false;
      row.archivedAt = archived ? now() : null;
      row.updatedAt = now();
      await audited(audit, id);
      return true;
    },

    async getThread(id) {
      const row = threads.get(id);
      return row ? view(clone(row)) : null;
    },

    async listThreads({ archived, limit }) {
      return [...threads.values()]
        .filter((row) => (row.archivedAt !== null) === archived)
        .map(view)
        .sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt))
        .slice(0, limit)
        .map(clone);
    },

    async listMessages(threadId, limit) {
      return messages
        .filter((message) => message.threadId === threadId)
        .slice(-limit)
        .map(clone);
    },

    async appendMessage(message) {
      if (!threads.has(message.threadId)) throw new AppError('not_found', 'not_found');
      const stored: CopilotStoredMessage = { ...clone(message), id: newId(), createdAt: now() };
      messages.push(stored);
      return clone(stored);
    },

    async recordLlmCall(call) {
      llm.push({ ...clone(call), createdAt: now() });
    },

    async recordToolCall(call) {
      tools.push({ ...clone(call), createdAt: now() });
    },

    async usageSince(since) {
      const from = since.toISOString();
      const calls = llm.filter((call) => call.createdAt >= from);
      const used = tools.filter((call) => call.createdAt >= from);
      const byModel = new Map<string, { generations: number; outputTokens: number }>();
      for (const call of calls) {
        const entry = byModel.get(call.model) ?? { generations: 0, outputTokens: 0 };
        entry.generations += 1;
        entry.outputTokens += call.outputTokens ?? 0;
        byModel.set(call.model, entry);
      }
      return {
        since: from,
        generations: calls.length,
        failed: calls.filter((call) => call.status === 'error').length,
        cancelled: calls.filter((call) => call.status === 'cancelled').length,
        outputTokens: calls.reduce((sum, call) => sum + (call.outputTokens ?? 0), 0),
        totalMs: calls.reduce((sum, call) => sum + (call.totalMs ?? 0), 0),
        byModel: [...byModel.entries()]
          .map(([model, entry]) => ({ model, ...entry }))
          .sort((a, b) => b.generations - a.generations),
        toolCalls: used.length,
        toolErrors: used.filter((call) => call.status !== 'ok').length,
      };
    },

    llmCalls: () => llm.map(clone),
    toolCalls: () => tools.map(clone),
  };
}
