import { isAppError, type OpenedTurn, type RequestContext } from '@prospector/application';
import {
  AI_ERROR_MESSAGES,
  CopilotEvent,
  CopilotTurnRequest,
  type AiErrorCode,
  type GenerationUsage,
  type ToolCallRequest,
} from '@prospector/contracts';
import { entityLinks } from '@/lib/entity-links';
import { isSameOriginRequest } from '@/lib/host';
import { getLocalAi, getServices } from '@/server/container';
import { copilotSystemFacts } from '@/server/copilot-context';

/** Pedido do Copiloto: só a pergunta nova (até 8.000 caracteres) e o id da conversa. */
const MAX_BODY_BYTES = 64 * 1024;

function problem(status: number, message: string): Response {
  return Response.json({ error: message }, { status, headers: { 'cache-control': 'no-store' } });
}

const NO_HISTORY_NOTICE =
  'O banco não está configurado: esta conversa não fica salva e cada pergunta é respondida sem as anteriores.';

/**
 * Conversa com o Copiloto (IA local, ADR-0008; IA-2). Recebe a pergunta e o id da conversa; o
 * histórico enviado ao modelo vem do banco (KI-032). Responde em streaming NDJSON: um
 * `CopilotEvent` por linha. Grava a pergunta antes de gerar e a resposta ao fim (completa,
 * interrompida ou com falha), mais a telemetria de cada geração e de cada ferramenta. Se o
 * navegador fechar a conexão, a geração no Ollama é interrompida e a resposta parcial fica salva
 * como interrompida.
 *
 * Só a própria página usa esta rota, e todo navegador atual manda `Origin` num POST feito por
 * `fetch`. Por isso o `Origin` é obrigatório aqui (decisão da IA-1.1): um pedido sem ele não veio
 * da página. Isso não protege contra programas deste computador, que podem forjar cabeçalhos e
 * já são confiáveis pelo ADR-0007; fecha a porta para clientes que não se identificam.
 */
export async function POST(request: Request): Promise<Response> {
  const headers = request.headers;
  if (
    headers.get('origin') === null ||
    !isSameOriginRequest({
      host: headers.get('host'),
      origin: headers.get('origin'),
      secFetchSite: headers.get('sec-fetch-site'),
    })
  ) {
    return problem(403, 'Pedido recusado: só a própria página do Prospector pode usar o Copiloto.');
  }
  if (!headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
    return problem(415, 'Envie o pedido como JSON.');
  }

  const tooLong = () => problem(413, 'Mensagem longa demais para um pedido.');
  const declared = Number(headers.get('content-length') ?? 0);
  if (declared > MAX_BODY_BYTES) return tooLong();
  const raw = await request.text();
  // Conta bytes, não caracteres: acentos e emojis ocupam mais de um byte.
  if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) return tooLong();
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return problem(400, AI_ERROR_MESSAGES.invalid_request);
  }
  const parsed = CopilotTurnRequest.safeParse(body);
  if (!parsed.success) {
    return problem(400, parsed.error.issues[0]?.message ?? AI_ERROR_MESSAGES.invalid_request);
  }
  const turnRequest = parsed.data;

  const traceId = crypto.randomUUID();
  const ctx: RequestContext = { actor: { type: 'user' }, traceId };
  const services = getServices();
  const history = services.copilot;

  let opened: OpenedTurn | null = null;
  if (history) {
    try {
      opened = await history.openTurn(ctx, turnRequest);
    } catch (error) {
      if (isAppError(error) && error.code === 'not_found') {
        return problem(404, 'Conversa não encontrada. Abra outra na lista ou comece uma nova.');
      }
      console.warn(`[copiloto] não foi possível abrir a conversa trace=${traceId}`, error);
      return problem(
        503,
        isAppError(error)
          ? `Não foi possível salvar a conversa: ${error.message}`
          : 'Não foi possível salvar a conversa agora. Tente de novo.',
      );
    }
  }
  const threadId = opened?.thread.id ?? null;

  const registry = history ? services.tools : null;
  const specs = registry?.specs() ?? [];
  const requestedCalls: ToolCallRequest[] = [];
  const toolbox = registry
    ? {
        specs,
        async execute(call: ToolCallRequest) {
          requestedCalls.push(call);
          const { result, forModel } = await registry.execute(ctx, call, { threadId });
          if (history && threadId) {
            await history
              .saveToolResult(ctx, {
                threadId,
                call,
                status: result.status,
                summary: result.summary,
              })
              .catch((error: unknown) =>
                console.warn(
                  `[copiloto] resultado de ferramenta não salvo trace=${traceId}`,
                  error,
                ),
              );
          }
          return {
            status: result.status,
            summary: result.summary,
            links: entityLinks(result.refs),
            forModel,
          };
        },
      }
    : undefined;

  const { copilot } = getLocalAi();
  const systemFacts = await copilotSystemFacts(new Date(), specs);
  const messages = opened?.history ?? [{ role: 'user' as const, content: turnRequest.message }];
  const encoder = new TextEncoder();

  async function* events(): AsyncGenerator<CopilotEvent> {
    let content = '';
    let model: string | null = null;
    let promptVersion: string | null = null;
    let usage: GenerationUsage | null = null;
    let errorCode: AiErrorCode | null = null;
    let finished = false;
    try {
      // Dentro do try: fechar a conexão já aqui ainda grava a resposta (vazia) como interrompida.
      if (opened) {
        yield {
          type: 'thread',
          threadId: opened.thread.id,
          title: opened.thread.title,
          created: opened.created,
        };
      } else {
        yield { type: 'notice', message: NO_HISTORY_NOTICE };
      }
      for await (const event of copilot.reply(
        { schemaVersion: 1, messages, model: turnRequest.model, think: turnRequest.think },
        {
          traceId,
          signal: request.signal,
          systemFacts,
          tools: toolbox,
          onGeneration(record) {
            if (!history) return;
            void history
              .recordGeneration(ctx, {
                threadId,
                model: record.model ?? turnRequest.model ?? 'desconhecido',
                promptVersion,
                status: record.status,
                errorCode: record.errorCode,
                doneReason: record.doneReason,
                usage: record.usage,
              })
              .catch((error: unknown) =>
                console.warn(`[copiloto] telemetria não salva trace=${traceId}`, error),
              );
          },
        },
      )) {
        if (event.type === 'start') {
          model = event.model;
          promptVersion = event.promptVersion;
        } else if (event.type === 'delta') {
          content += event.text;
        } else if (event.type === 'done') {
          model = event.model;
          usage = event.usage;
          finished = true;
        } else if (event.type === 'error') {
          errorCode = event.code;
        }
        yield event;
      }
    } finally {
      if (history && threadId) {
        const status =
          errorCode !== null && errorCode !== 'cancelled'
            ? 'failed'
            : finished
              ? 'complete'
              : 'interrupted';
        await history
          .saveAnswer(ctx, {
            threadId,
            content,
            status,
            model,
            promptVersion,
            toolCalls: requestedCalls,
            errorCode,
            usage,
          })
          .catch((error: unknown) =>
            console.warn(`[copiloto] resposta não salva trace=${traceId}`, error),
          );
      }
    }
  }

  const stream = events();
  const body$ = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const next = await stream.next();
      if (next.done) {
        controller.close();
        return;
      }
      // O contrato vale nos dois lados: o servidor só envia o que o navegador sabe ler.
      const checked = CopilotEvent.safeParse(next.value);
      const event: CopilotEvent = checked.success
        ? checked.data
        : { type: 'error', code: 'provider_error', message: AI_ERROR_MESSAGES.provider_error };
      try {
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      } catch {
        // O navegador já fechou a conexão; o `cancel` abaixo encerra a geração.
      }
    },
    async cancel() {
      await stream.return(undefined);
    },
  });

  return new Response(body$, {
    headers: {
      'content-type': 'application/x-ndjson; charset=utf-8',
      'cache-control': 'no-store',
      'x-trace-id': traceId,
      ...(threadId ? { 'x-thread-id': threadId } : {}),
    },
  });
}
