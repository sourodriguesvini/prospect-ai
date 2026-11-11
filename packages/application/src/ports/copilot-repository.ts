import type {
  AiTask,
  CopilotMessageRole,
  CopilotMessageStatus,
  CopilotStoredMessage,
  CopilotThread,
  GenerationUsage,
  ToolCallRequest,
  ToolStatus,
} from '@prospector/contracts';
import type { PendingAudit } from './audit-repository';

export interface NewCopilotMessage {
  threadId: string;
  role: CopilotMessageRole;
  content: string;
  status: CopilotMessageStatus;
  model: string | null;
  promptVersion: string | null;
  traceId: string;
  toolCalls: ToolCallRequest[] | null;
  toolCallId: string | null;
  toolName: string | null;
  toolStatus: ToolStatus | null;
  errorCode: string | null;
  usage: GenerationUsage | null;
}

/**
 * Conversas do Copiloto (IA-2). Criar, renomear e arquivar são auditados junto com a escrita
 * (ADR-0010). Mensagens são somente inclusão e não levam auditoria por linha: o próprio registro,
 * com trace_id, é a trilha (como `llm_calls` e `tool_calls`).
 * Erros: AppError('not_found') para conversa inexistente.
 */
export interface CopilotRepository {
  createThread(title: string, audit: PendingAudit): Promise<CopilotThread>;
  /** Devolve false quando a conversa não existe (nada é gravado nem auditado). */
  renameThread(id: string, title: string, audit: PendingAudit): Promise<boolean>;
  setArchived(id: string, archived: boolean, audit: PendingAudit): Promise<boolean>;
  getThread(id: string): Promise<CopilotThread | null>;
  /** Da atividade mais recente para a mais antiga. */
  listThreads(options: { archived: boolean; limit: number }): Promise<CopilotThread[]>;
  /** As `limit` mensagens mais recentes, em ordem de inclusão (mais antiga primeiro). */
  listMessages(threadId: string, limit: number): Promise<CopilotStoredMessage[]>;
  appendMessage(message: NewCopilotMessage): Promise<CopilotStoredMessage>;
}

export interface NewLlmCall {
  task: AiTask;
  provider: 'ollama';
  model: string;
  promptVersion: string | null;
  traceId: string;
  threadId: string | null;
  jobId: string | null;
  status: 'ok' | 'error' | 'cancelled';
  errorCode: string | null;
  doneReason: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  totalMs: number | null;
  loadMs: number | null;
}

export interface NewToolCall {
  traceId: string;
  threadId: string | null;
  jobId: string | null;
  tool: string;
  /** Argumentos já validados, sem texto livre longo (KI-015). */
  inputRedacted: Record<string, unknown>;
  outputSummary: string | null;
  status: ToolStatus;
  errorCode: string | null;
  durationMs: number;
}

/** Resumo de uso da IA local num período (métricas, M6). */
export interface AiUsageSummary {
  since: string;
  generations: number;
  failed: number;
  cancelled: number;
  outputTokens: number;
  totalMs: number;
  byModel: Array<{ model: string; generations: number; outputTokens: number }>;
  toolCalls: number;
  toolErrors: number;
}

/** Telemetria da IA local: só inclusão (migração 20261110150000). */
export interface AiTelemetryRepository {
  recordLlmCall(call: NewLlmCall): Promise<void>;
  recordToolCall(call: NewToolCall): Promise<void>;
  usageSince(since: Date): Promise<AiUsageSummary>;
}
