import {
  COPILOT_HISTORY_LIMIT,
  RenameThreadInput,
  Uuid,
  threadTitleFrom,
  type AiErrorCode,
  type ChatMessage,
  type CopilotTurnRequest,
  type CopilotMessageStatus,
  type CopilotStoredMessage,
  type CopilotThread,
  type GenerationUsage,
  type ToolCallRequest,
  type ToolStatus,
} from '@prospector/contracts';
import type { RequestContext } from '../context';
import { AppError, parseInput } from '../errors';
import type {
  AiTelemetryRepository,
  AiUsageSummary,
  CopilotRepository,
} from '../ports/copilot-repository';
import { pendingAudit } from './pending-audit';

/** Mensagens lidas para montar o histórico (o corte fino por tokens fica no gateway). */
const HISTORY_READ = 60;
const MESSAGE_MAX_CHARS = 8000;
const THREAD_PAGE = 50;

export interface CopilotConversation {
  thread: CopilotThread;
  messages: CopilotStoredMessage[];
}

export interface OpenedTurn {
  thread: CopilotThread;
  created: boolean;
  /** Histórico para o modelo, terminando na pergunta nova. */
  history: ChatMessage[];
}

export interface AnswerToSave {
  threadId: string;
  content: string;
  status: CopilotMessageStatus;
  model: string | null;
  promptVersion: string | null;
  toolCalls: ToolCallRequest[];
  errorCode: AiErrorCode | null;
  usage: GenerationUsage | null;
}

export interface ToolResultToSave {
  threadId: string;
  call: ToolCallRequest;
  status: ToolStatus;
  summary: string;
}

export interface GenerationToRecord {
  threadId: string | null;
  model: string;
  promptVersion: string | null;
  status: 'ok' | 'error' | 'cancelled';
  errorCode: string | null;
  doneReason: string | null;
  usage: GenerationUsage | null;
}

/**
 * Conversas do Copiloto (IA-2): o servidor guarda cada pergunta, resultado de ferramenta e
 * resposta, e monta o histórico enviado ao modelo a partir do banco (KI-032), não do navegador.
 */
export interface CopilotService {
  listThreads(ctx: RequestContext, options?: { archived?: boolean }): Promise<CopilotThread[]>;
  /** null quando a conversa não existe (id inválido também). */
  conversation(ctx: RequestContext, threadId: string): Promise<CopilotConversation | null>;
  /** Cria a conversa se preciso, grava a pergunta e devolve o histórico para o modelo. */
  openTurn(ctx: RequestContext, request: CopilotTurnRequest): Promise<OpenedTurn>;
  saveToolResult(ctx: RequestContext, result: ToolResultToSave): Promise<void>;
  saveAnswer(ctx: RequestContext, answer: AnswerToSave): Promise<void>;
  rename(ctx: RequestContext, raw: unknown): Promise<void>;
  setArchived(ctx: RequestContext, threadId: string, archived: boolean): Promise<void>;
  recordGeneration(ctx: RequestContext, generation: GenerationToRecord): Promise<void>;
  usageSince(ctx: RequestContext, since: Date): Promise<AiUsageSummary>;
}

function clip(text: string): string {
  return text.length > MESSAGE_MAX_CHARS ? `${text.slice(0, MESSAGE_MAX_CHARS - 4)} […]` : text;
}

/** Falas da conversa que voltam ao modelo: perguntas e respostas com texto (sem ferramentas). */
export function historyFromMessages(messages: readonly CopilotStoredMessage[]): ChatMessage[] {
  const usable = messages
    .filter((message) => message.role !== 'tool' && message.content.trim().length > 0)
    .map((message) => ({
      role: message.role as 'user' | 'assistant',
      content: clip(message.content.trim()),
    }));
  const recent = usable.slice(-COPILOT_HISTORY_LIMIT);
  while (recent.length > 1 && recent[0]?.role !== 'user') recent.shift();
  return recent;
}

export function createCopilotService(deps: {
  repo: CopilotRepository;
  telemetry: AiTelemetryRepository;
}): CopilotService {
  const { repo, telemetry } = deps;

  async function requireThread(threadId: string): Promise<CopilotThread> {
    const thread = await repo.getThread(threadId);
    if (!thread) throw new AppError('not_found', 'not_found');
    return thread;
  }

  return {
    async listThreads(_ctx, options = {}) {
      return repo.listThreads({ archived: options.archived ?? false, limit: THREAD_PAGE });
    },

    async conversation(_ctx, threadId) {
      if (!Uuid.safeParse(threadId).success) return null;
      const thread = await repo.getThread(threadId);
      if (!thread) return null;
      return { thread, messages: await repo.listMessages(threadId, 200) };
    },

    async openTurn(ctx, request) {
      let thread: CopilotThread;
      let created = false;
      if (request.threadId) {
        thread = await requireThread(request.threadId);
        if (thread.archivedAt !== null) {
          // Continuar uma conversa arquivada a traz de volta para a lista.
          await repo.setArchived(
            thread.id,
            false,
            pendingAudit(ctx, {
              action: 'copilot.thread.unarchive',
              entityType: 'copilot_thread',
              entityId: thread.id,
            }),
          );
        }
      } else {
        thread = await repo.createThread(
          threadTitleFrom(request.message),
          pendingAudit(ctx, { action: 'copilot.thread.create', entityType: 'copilot_thread' }),
        );
        created = true;
      }
      const previous = created ? [] : await repo.listMessages(thread.id, HISTORY_READ);
      await repo.appendMessage({
        threadId: thread.id,
        role: 'user',
        content: request.message,
        status: 'complete',
        model: null,
        promptVersion: null,
        traceId: ctx.traceId,
        toolCalls: null,
        toolCallId: null,
        toolName: null,
        toolStatus: null,
        errorCode: null,
        usage: null,
      });
      const history = historyFromMessages(previous);
      history.push({ role: 'user', content: request.message });
      return { thread, created, history: history.slice(-COPILOT_HISTORY_LIMIT) };
    },

    async saveToolResult(ctx, result) {
      await repo.appendMessage({
        threadId: result.threadId,
        role: 'tool',
        content: result.summary.slice(0, 500),
        status: 'complete',
        model: null,
        promptVersion: null,
        traceId: ctx.traceId,
        toolCalls: null,
        toolCallId: result.call.id,
        toolName: result.call.name,
        toolStatus: result.status,
        errorCode: null,
        usage: null,
      });
    },

    async saveAnswer(ctx, answer) {
      await repo.appendMessage({
        threadId: answer.threadId,
        role: 'assistant',
        content: answer.content.slice(0, 32000),
        status: answer.status,
        model: answer.model,
        promptVersion: answer.promptVersion,
        traceId: ctx.traceId,
        toolCalls: answer.toolCalls.length > 0 ? answer.toolCalls : null,
        toolCallId: null,
        toolName: null,
        toolStatus: null,
        errorCode: answer.errorCode,
        usage: answer.usage,
      });
    },

    async rename(ctx, raw) {
      const input = parseInput(RenameThreadInput, raw);
      const changed = await repo.renameThread(
        input.threadId,
        input.title,
        pendingAudit(ctx, {
          action: 'copilot.thread.rename',
          entityType: 'copilot_thread',
          entityId: input.threadId,
        }),
      );
      if (!changed) throw new AppError('not_found', 'not_found');
    },

    async setArchived(ctx, threadId, archived) {
      const id = parseInput(Uuid, threadId);
      const changed = await repo.setArchived(
        id,
        archived,
        pendingAudit(ctx, {
          action: archived ? 'copilot.thread.archive' : 'copilot.thread.unarchive',
          entityType: 'copilot_thread',
          entityId: id,
        }),
      );
      if (!changed) throw new AppError('not_found', 'not_found');
    },

    async recordGeneration(ctx, generation) {
      await telemetry.recordLlmCall({
        task: 'copilot',
        provider: 'ollama',
        model: generation.model.slice(0, 120) || 'desconhecido',
        promptVersion: generation.promptVersion,
        traceId: ctx.traceId,
        threadId: generation.threadId,
        jobId: null,
        status: generation.status,
        errorCode: generation.errorCode,
        doneReason: generation.doneReason?.slice(0, 40) ?? null,
        inputTokens: generation.usage?.inputTokens ?? null,
        outputTokens: generation.usage?.outputTokens ?? null,
        totalMs: generation.usage?.totalMs ?? null,
        loadMs: generation.usage?.loadMs ?? null,
      });
    },

    async usageSince(_ctx, since) {
      return telemetry.usageSince(since);
    },
  };
}
