import { z } from 'zod';
import { ChatMessage, GenerationUsage, ModelName } from './ai';
import { Uuid } from './common';
import { ToolCallRequest, ToolName, ToolStatus } from './tools';

/**
 * Conversas persistentes do Copiloto (IA-2, docs/14 M1). O servidor guarda as mensagens em
 * `copilot_messages` (somente inclusão) e monta o histórico enviado ao modelo a partir delas
 * (KI-032): o navegador manda só a pergunta nova e o id da conversa.
 */

export const COPILOT_TITLE_MAX = 120;

export const ThreadTitle = z
  .string()
  .trim()
  .min(1, { error: 'Dê um nome à conversa.' })
  .max(COPILOT_TITLE_MAX, { error: `Use até ${COPILOT_TITLE_MAX} caracteres.` });

export const CopilotThread = z.object({
  id: Uuid,
  title: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  archivedAt: z.string().nullable(),
  /** Data da última mensagem (ou da criação, sem mensagens). */
  lastActivityAt: z.string(),
  /** Mensagens do usuário e do Copiloto (resultados de ferramenta não contam). */
  messageCount: z.number().int().nonnegative(),
});
export type CopilotThread = z.infer<typeof CopilotThread>;

export const CopilotMessageRole = z.enum(['user', 'assistant', 'tool']);
export type CopilotMessageRole = z.infer<typeof CopilotMessageRole>;

/** complete; interrupted = resposta parcial (cancelada ou conexão caiu); failed = erro. */
export const CopilotMessageStatus = z.enum(['complete', 'interrupted', 'failed']);
export type CopilotMessageStatus = z.infer<typeof CopilotMessageStatus>;

export const CopilotStoredMessage = z.object({
  id: Uuid,
  threadId: Uuid,
  role: CopilotMessageRole,
  content: z.string(),
  status: CopilotMessageStatus,
  model: z.string().nullable(),
  promptVersion: z.string().nullable(),
  traceId: z.string(),
  toolCalls: z.array(ToolCallRequest).nullable(),
  toolCallId: z.string().nullable(),
  toolName: ToolName.nullable(),
  toolStatus: ToolStatus.nullable(),
  errorCode: z.string().nullable(),
  usage: GenerationUsage.nullable(),
  createdAt: z.string(),
});
export type CopilotStoredMessage = z.infer<typeof CopilotStoredMessage>;

/** Pedido da tela: a pergunta nova e, para continuar, o id da conversa. */
export const CopilotTurnRequest = z.object({
  schemaVersion: z.literal(2),
  /** null = conversa nova (o servidor cria e devolve o id no evento `thread`). */
  threadId: Uuid.nullable(),
  message: ChatMessage.shape.content,
  model: ModelName.optional(),
  think: z.boolean().default(false),
});
export type CopilotTurnRequest = z.infer<typeof CopilotTurnRequest>;
export type CopilotTurnRequestInput = z.input<typeof CopilotTurnRequest>;

export const RenameThreadInput = z.object({ threadId: Uuid, title: ThreadTitle });
export type RenameThreadInput = z.infer<typeof RenameThreadInput>;

/** Título automático: a primeira pergunta, numa linha, cortada no limite. */
export function threadTitleFrom(message: string): string {
  const line = message.replace(/\s+/g, ' ').trim();
  if (line.length <= 60) return line || 'Conversa sem título';
  const cut = line.slice(0, 59);
  const space = cut.lastIndexOf(' ');
  return `${(space > 30 ? cut.slice(0, space) : cut).trimEnd()}…`;
}
