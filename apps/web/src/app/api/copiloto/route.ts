import { AI_ERROR_MESSAGES, CopilotEvent, CopilotRequest } from '@prospector/contracts';
import { isSameOriginRequest } from '@/lib/host';
import { getLocalAi } from '@/server/container';
import { copilotSystemFacts } from '@/server/copilot-context';

/** Pedido do Copiloto: no máximo ~24 mensagens de 8.000 caracteres, com folga. */
const MAX_BODY_BYTES = 256 * 1024;

function problem(status: number, message: string): Response {
  return Response.json({ error: message }, { status, headers: { 'cache-control': 'no-store' } });
}

/**
 * Conversa com o Copiloto (IA local, ADR-0008). Responde em streaming NDJSON: um
 * `CopilotEvent` por linha. Se o navegador fechar a conexão, a geração no Ollama é interrompida.
 */
export async function POST(request: Request): Promise<Response> {
  const headers = request.headers;
  if (
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

  const tooLong = () => problem(413, 'Conversa longa demais para um pedido.');
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
  const parsed = CopilotRequest.safeParse(body);
  if (!parsed.success) {
    return problem(400, parsed.error.issues[0]?.message ?? AI_ERROR_MESSAGES.invalid_request);
  }

  const traceId = crypto.randomUUID();
  const { copilot } = getLocalAi();
  const systemFacts = await copilotSystemFacts(new Date());
  const encoder = new TextEncoder();
  const events = copilot.reply(parsed.data, { traceId, signal: request.signal, systemFacts });

  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const next = await events.next();
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
      await events.return(undefined);
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'application/x-ndjson; charset=utf-8',
      'cache-control': 'no-store',
      'x-trace-id': traceId,
    },
  });
}
