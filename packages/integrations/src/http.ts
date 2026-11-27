/**
 * HTTP mínimo para os adaptadores: `fetch` nativo, tempo-limite, User-Agent genérico (sem dado do
 * usuário) e classificação do resultado. Endereços são fixos em cada adaptador: nada vindo do
 * usuário vira host ou caminho livre (SSRF).
 */

export type Fetch = typeof fetch;

export const USER_AGENT = 'Prospector/0.1 (ferramenta interna; uso local)';

export type HttpOutcome =
  | { kind: 'ok'; body: unknown }
  | { kind: 'not_found' }
  | { kind: 'rate_limited' }
  | { kind: 'unavailable'; detail: string }
  | { kind: 'invalid_response'; detail: string };

export interface GetJsonOptions {
  fetch: Fetch;
  timeoutMs: number;
  signal?: AbortSignal;
  /** Códigos tratados como "não existe" (a Minha Receita responde 400 para CNPJ inexistente). */
  notFoundStatuses?: readonly number[];
  /** Teto do corpo da resposta; acima disso a resposta é recusada. */
  maxBytes?: number;
}

/** Um registro de CNPJ tem poucos KB; 256 KB protege o processo de um provedor defeituoso. */
export const DEFAULT_MAX_BYTES = 256 * 1024;

/** Lê o corpo até `maxBytes`; null se passar do teto. */
async function readCapped(response: Response, maxBytes: number): Promise<string | null> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) return null;
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

export async function getJson(url: string, options: GetJsonOptions): Promise<HttpOutcome> {
  const timeout = AbortSignal.timeout(options.timeoutMs);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  let response: Response;
  try {
    response = await options.fetch(url, {
      method: 'GET',
      headers: { accept: 'application/json', 'user-agent': USER_AGENT },
      redirect: 'error',
      signal,
    });
  } catch (error) {
    // Cancelamento de quem pediu sobe como está; tempo esgotado e rede viram "fora do ar".
    if (options.signal?.aborted) throw error;
    return { kind: 'unavailable', detail: error instanceof Error ? error.name : 'fetch_failed' };
  }
  if ((options.notFoundStatuses ?? [404]).includes(response.status)) return { kind: 'not_found' };
  if (response.status === 429) return { kind: 'rate_limited' };
  if (!response.ok) return { kind: 'unavailable', detail: `http_${response.status}` };
  const type = response.headers.get('content-type') ?? '';
  if (!/\bjson\b/i.test(type)) {
    await response.body?.cancel();
    return { kind: 'invalid_response', detail: 'content_type' };
  }
  try {
    const raw = await readCapped(response, options.maxBytes ?? DEFAULT_MAX_BYTES);
    if (raw === null) return { kind: 'invalid_response', detail: 'too_large' };
    return { kind: 'ok', body: JSON.parse(raw) as unknown };
  } catch (error) {
    if (options.signal?.aborted) throw error;
    return { kind: 'invalid_response', detail: 'json' };
  }
}
