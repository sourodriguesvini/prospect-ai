import { z } from 'zod';
import { Uuid } from './common';

/**
 * Fila persistente de tarefas (ADR-0011, D-AI-5): tarefas longas (pesquisa da Descoberta) rodam
 * num worker deste computador enquanto o app está aberto. O estado de negócio fica nas tabelas
 * do módulo (ex.: `discovery_runs`); aqui fica só o estado de execução: tentativa, prazo do
 * worker, cancelamento e erro.
 */

const IsoDateTime = z.iso.datetime({ offset: true, error: 'Data e hora inválidas (ISO 8601).' });

export const AiJobKind = z.enum(['discovery_run', 'copilot_research']);
export type AiJobKind = z.infer<typeof AiJobKind>;

/**
 * queued = esperando worker (ou nova tentativa em `runAfter`); running = um worker tem o prazo
 * (`leaseExpiresAt`); os três últimos são finais.
 */
export const AiJobStatus = z.enum(['queued', 'running', 'succeeded', 'failed', 'cancelled']);
export type AiJobStatus = z.infer<typeof AiJobStatus>;

export const AI_JOB_FINAL_STATUSES: readonly AiJobStatus[] = ['succeeded', 'failed', 'cancelled'];

/** Payload da tarefa `copilot_research` (gatilho `app.enqueue_copilot_research`): um lote. */
export const CopilotResearchJobPayload = z.object({
  researchId: Uuid,
  version: z.number().int().min(1),
  batch: z.number().int().min(0),
});
export type CopilotResearchJobPayload = z.infer<typeof CopilotResearchJobPayload>;

/** Código estável de erro de uma tarefa (mesmo formato do `check` no banco). */
export const AiJobErrorCode = z.string().regex(/^[a-z][a-z0-9_]{1,59}$/);

export const AiJob = z.object({
  id: Uuid,
  kind: AiJobKind,
  status: AiJobStatus,
  /** Mesma chave = mesma tarefa: pedir de novo devolve a existente (sem duplicar). */
  idempotencyKey: z.string().min(1).max(200),
  payload: z.record(z.string(), z.unknown()),
  attempts: z.number().int().min(0),
  maxAttempts: z.number().int().min(1).max(10),
  runAfter: IsoDateTime,
  leaseOwner: z.string().max(120).nullable(),
  leaseExpiresAt: IsoDateTime.nullable(),
  cancelRequestedAt: IsoDateTime.nullable(),
  lastErrorCode: AiJobErrorCode.nullable(),
  traceId: Uuid,
  createdAt: IsoDateTime,
  startedAt: IsoDateTime.nullable(),
  finishedAt: IsoDateTime.nullable(),
});
export type AiJob = z.infer<typeof AiJob>;
