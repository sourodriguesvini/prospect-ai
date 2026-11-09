/** Corpo em streaming a partir de pedaços de texto (simula a rede entregando aos poucos). */
export function streamOf(chunks: string[], delayMs = 0): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let index = 0;
  return new ReadableStream({
    async pull(controller) {
      if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
      const chunk = chunks[index++];
      if (chunk === undefined) controller.close();
      else controller.enqueue(encoder.encode(chunk));
    },
  });
}

export function ndjson(objects: unknown[]): string[] {
  return objects.map((object) => `${JSON.stringify(object)}\n`);
}

type Handler = (url: URL, init: RequestInit | undefined) => Response | Promise<Response>;

/** fetch falso roteado por "MÉTODO /caminho"; registra as chamadas. */
export function fakeFetch(routes: Record<string, Handler>) {
  const calls: Array<{ key: string; body: unknown }> = [];
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input.toString());
    const key = `${init?.method ?? 'GET'} ${url.pathname}`;
    calls.push({ key, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (init?.signal?.aborted) throw init.signal.reason;
    const handler = routes[key];
    if (!handler) return new Response('{"error":"rota desconhecida"}', { status: 500 });
    return handler(url, init);
  }) as typeof fetch;
  return { fetch: impl, calls };
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export const TAGS = {
  models: [
    {
      name: 'qwen3.5:4b',
      size: 3_300_000_000,
      details: { family: 'qwen35', parameter_size: '4.7B', quantization_level: 'Q4_K_M' },
    },
    { name: 'nemotron-3-nano:4b', size: 2_800_000_000, details: {} },
  ],
};

export const DONE = {
  model: 'qwen3.5:4b',
  message: { role: 'assistant', content: '' },
  done: true,
  done_reason: 'stop',
  total_duration: 2_000_000_000,
  load_duration: 500_000_000,
  prompt_eval_count: 120,
  eval_count: 40,
  eval_duration: 1_000_000_000,
};

export async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of iterable) out.push(item);
  return out;
}
