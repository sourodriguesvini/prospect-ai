import {
  ToolCallRequest,
  type EntityRef,
  type ToolResult,
  type ToolSpec,
  type ToolStatus,
} from '@prospector/contracts';
import { z } from 'zod';
import type { RequestContext } from '../context';
import { ERROR_MESSAGES, isAppError } from '../errors';
import type { AiTelemetryRepository } from '../ports/copilot-repository';

/** O que o código de uma ferramenta devolve; o registro acrescenta status e limites. */
export interface ToolOutput {
  /** Uma frase pt-BR para a tela ("3 ofertas: 1 ativa, 2 em rascunho"). */
  summary: string;
  /** Dados para o modelo: nomes de campos em português, listas já limitadas. */
  data: unknown;
  refs?: EntityRef[];
  /**
   * Resumo gravado na telemetria (`tool_calls`, só inclusão), quando o da tela traz dado que não
   * deve ficar guardado (ex.: nome de empresa individual, que é o nome de uma pessoa).
   */
  telemetrySummary?: string;
}

/**
 * Ferramenta de leitura para modelos (IA-2). Só leitura nesta versão: nenhuma ferramenta escreve
 * no banco ou age fora do app (regra 2 do CLAUDE.md). Uma ferramenta de escrita, quando existir,
 * só poderá criar item de aprovação e precisará de outro tipo aqui.
 */
export interface ToolDefinition<S extends z.ZodType = z.ZodType> {
  name: string;
  /** Rótulo pt-BR curto para a tela ("Consultando ofertas"). */
  title: string;
  /** Para o modelo: quando usar, o que devolve. */
  description: string;
  input: S;
  kind: 'read';
  run(ctx: RequestContext, input: z.output<S>): Promise<ToolOutput>;
  /** Argumentos gravados na telemetria; sem isto, os argumentos cortados (`redact`). */
  telemetryInput?(input: z.output<S>): Record<string, unknown>;
}

/** Ajuda de tipo: o `run` recebe a entrada já validada pelo esquema da própria ferramenta. */
export function defineTool<S extends z.ZodType>(definition: ToolDefinition<S>): ToolDefinition {
  return definition as unknown as ToolDefinition;
}

export interface ToolExecution {
  result: ToolResult;
  /** Texto entregue ao modelo: JSON com status, resumo e dados, dentro do limite. */
  forModel: string;
}

export interface ToolRegistry {
  specs(): ToolSpec[];
  /** Nunca lança: ferramenta desconhecida, argumento inválido, erro e demora viram resultado. */
  execute(
    ctx: RequestContext,
    call: ToolCallRequest,
    options?: { threadId?: string | null; jobId?: string | null; signal?: AbortSignal },
  ): Promise<ToolExecution>;
}

/** Limite do texto devolvido ao modelo: cabe no contexto de 8 mil tokens com folga. */
export const TOOL_OUTPUT_MAX_CHARS = 6000;
const DEFAULT_TIMEOUT_MS = 15_000;
const REDACTED_MAX_CHARS = 3000;

/** Argumentos para a telemetria: textos longos cortados, nada acima de ~3 KB (KI-015). */
function redact(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') return value.length > 120 ? `${value.slice(0, 117)}...` : value;
  if (depth > 3) return '[...]';
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => redact(item, depth + 1));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .slice(0, 20)
        .map(([key, item]) => [key.slice(0, 60), redact(item, depth + 1)]),
    );
  }
  return value;
}

function redactedInput(value: unknown): Record<string, unknown> {
  const redacted = redact(value);
  const object =
    redacted && typeof redacted === 'object' && !Array.isArray(redacted)
      ? (redacted as Record<string, unknown>)
      : {};
  return JSON.stringify(object).length > REDACTED_MAX_CHARS ? { omitido: true } : object;
}

function forModel(status: ToolStatus, summary: string, data: unknown): string {
  const full = JSON.stringify({ status, resumo: summary, dados: data ?? null });
  if (full.length <= TOOL_OUTPUT_MAX_CHARS) return full;
  return `${full.slice(0, TOOL_OUTPUT_MAX_CHARS)}… (resultado cortado: peça um recorte menor)`;
}

function issuesText(error: z.ZodError): string {
  return error.issues
    .slice(0, 4)
    .map((issue) =>
      issue.path.length ? `${issue.path.join('.')}: ${issue.message}` : issue.message,
    )
    .join('; ');
}

class ToolTimeout extends Error {}

export function createToolRegistry(deps: {
  tools: readonly ToolDefinition[];
  /** null = sem telemetria (ex.: banco não configurado). */
  telemetry: AiTelemetryRepository | null;
  timeoutMs?: number;
  log?: (message: string) => void;
}): ToolRegistry {
  const log = deps.log ?? ((message: string) => console.warn(message));
  const byName = new Map(deps.tools.map((tool) => [tool.name, tool]));
  if (byName.size !== deps.tools.length) throw new Error('Ferramentas com nome repetido.');
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const specs: ToolSpec[] = deps.tools.map((tool) => {
    const { $schema: _schema, ...parameters } = z.toJSONSchema(tool.input, {
      io: 'input',
      unrepresentable: 'any',
    }) as Record<string, unknown>;
    return { name: tool.name, title: tool.title, description: tool.description, parameters };
  });

  return {
    specs: () => specs.map((spec) => structuredClone(spec)),

    async execute(ctx, rawCall, options = {}) {
      const started = Date.now();
      const call = ToolCallRequest.safeParse(rawCall);
      const name = call.success ? call.data.name : 'unknown_tool';
      const tool = call.success ? byName.get(call.data.name) : undefined;
      let status: ToolStatus = 'ok';
      let summary: string;
      let data: unknown = null;
      let refs: EntityRef[] = [];
      let errorCode: string | null = null;
      let input: unknown = call.success ? call.data.arguments : {};
      let telemetryInput: Record<string, unknown> | null = null;
      let telemetrySummary: string | null = null;

      if (!tool) {
        status = 'error';
        errorCode = 'unknown_tool';
        summary = `Ferramenta inexistente. Use só: ${[...byName.keys()].join(', ')}.`;
      } else {
        const parsed = tool.input.safeParse(input);
        if (!parsed.success) {
          status = 'error';
          errorCode = 'invalid_arguments';
          summary = `Argumentos inválidos: ${issuesText(parsed.error)}`.slice(0, 500);
        } else {
          input = parsed.data;
          telemetryInput = tool.telemetryInput ? tool.telemetryInput(parsed.data) : null;
          let timer: ReturnType<typeof setTimeout> | undefined;
          try {
            const output = await Promise.race([
              tool.run(ctx, parsed.data),
              new Promise<never>((_resolve, reject) => {
                timer = setTimeout(() => reject(new ToolTimeout()), timeoutMs);
              }),
            ]);
            summary = output.summary.slice(0, 500);
            telemetrySummary = output.telemetrySummary?.slice(0, 500) ?? null;
            data = output.data;
            refs = (output.refs ?? []).slice(0, 20);
          } catch (error) {
            status = 'error';
            if (error instanceof ToolTimeout) {
              errorCode = 'timeout';
              summary = 'A consulta demorou demais e foi interrompida.';
            } else if (isAppError(error)) {
              errorCode = error.reason;
              summary = ERROR_MESSAGES[error.reason];
            } else {
              errorCode = 'unexpected';
              summary = ERROR_MESSAGES.unexpected;
              log(`[ferramenta] ${name} falhou trace=${ctx.traceId}: ${String(error)}`);
            }
          } finally {
            clearTimeout(timer);
          }
        }
      }

      const durationMs = Math.max(0, Date.now() - started);
      if (deps.telemetry) {
        try {
          await deps.telemetry.recordToolCall({
            traceId: ctx.traceId,
            threadId: options.threadId ?? null,
            jobId: options.jobId ?? null,
            tool: /^[a-z][a-z0-9_]{1,63}$/.test(name) ? name : 'unknown_tool',
            inputRedacted: telemetryInput ?? redactedInput(input),
            outputSummary: telemetrySummary ?? summary.slice(0, 500),
            status,
            errorCode,
            durationMs,
          });
        } catch (error) {
          // Telemetria não pode derrubar a resposta; o problema vai para o log do servidor.
          log(`[ferramenta] telemetria falhou trace=${ctx.traceId}: ${String(error)}`);
        }
      }
      return {
        result: { status, summary, data, refs, errorCode },
        forModel: forModel(status, summary, data),
      };
    },
  };
}
