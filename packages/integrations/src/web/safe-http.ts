import { request as httpRequest, type IncomingHttpHeaders } from 'node:http';
import { request as httpsRequest } from 'node:https';
import type { LookupFunction } from 'node:net';
import type { Readable } from 'node:stream';
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib';
import { USER_AGENT } from '../http';
import { checkUrl, resolvePublicTarget, systemResolver, type Resolver } from './ssrf';

/**
 * Cliente HTTP do leitor de páginas (ADR-0012). Diferente do `getJson` (hosts fixos dos
 * provedores), aqui a URL vem de fora, então cada salto passa por `checkUrl` e pelo DNS conferido,
 * e a conexão usa o endereço conferido. Só GET; corpo limitado em bytes já descomprimidos;
 * tempo-limite por pedido; User-Agent genérico.
 */

export interface TransportRequest {
  url: URL;
  /** Endereço conferido; a conexão vai para ele, nunca para uma nova resolução do nome. */
  address: string;
  family: 4 | 6;
  headers: Record<string, string>;
  maxBytes: number;
  signal: AbortSignal;
}

export interface TransportResponse {
  status: number;
  headers: Record<string, string>;
  body: Uint8Array;
  /** O corpo passou do limite e foi cortado. */
  truncated: boolean;
}

/** Faz UM pedido, sem seguir redirecionamentos. Lança em erro de rede ou tempo esgotado. */
export type Transport = (request: TransportRequest) => Promise<TransportResponse>;

export interface SafeFetchOptions {
  resolver?: Resolver;
  transport?: Transport;
  maxBytes: number;
  timeoutMs: number;
  maxRedirects?: number;
  accept?: string;
  signal?: AbortSignal;
  /** Chamado antes de seguir cada redirecionamento (ex.: conferir o robots.txt do destino). */
  beforeRedirect?: (url: URL) => Promise<SafeFetchFailure | null>;
}

export type SafeFetchFailure =
  | 'blocked_address'
  | 'too_many_redirects'
  | 'too_large'
  | 'unavailable'
  | 'robots_disallowed'
  | 'restricted_site';

export type SafeFetchResult =
  | { ok: true; url: URL; response: TransportResponse; redirects: number }
  | { ok: false; failure: SafeFetchFailure };

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

function flatHeaders(headers: IncomingHttpHeaders): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    out[name.toLowerCase()] = Array.isArray(value) ? value.join(', ') : value;
  }
  return out;
}

/** Transporte real: `node:http(s)` com o endereço fixado pelo `lookup`. */
export const nodeTransport: Transport = (req) =>
  new Promise<TransportResponse>((resolve, reject) => {
    const pinned: LookupFunction = (_hostname, options, callback) => {
      if (options && typeof options === 'object' && options.all) {
        callback(null, [{ address: req.address, family: req.family }]);
      } else {
        callback(null, req.address, req.family);
      }
    };
    const send = req.url.protocol === 'https:' ? httpsRequest : httpRequest;
    const outgoing = send(
      req.url,
      {
        method: 'GET',
        headers: req.headers,
        lookup: pinned,
        signal: req.signal,
        // Sem agente compartilhado: cada pedido conecta no endereço conferido.
        agent: false,
      },
      (incoming) => {
        const headers = flatHeaders(incoming.headers);
        const declared = Number(headers['content-length']);
        if (Number.isFinite(declared) && declared > req.maxBytes * 4) {
          incoming.destroy();
          resolve({
            status: incoming.statusCode ?? 0,
            headers,
            body: new Uint8Array(),
            truncated: true,
          });
          return;
        }
        const encoding = (headers['content-encoding'] ?? '').trim().toLowerCase();
        let stream: Readable = incoming;
        if (encoding === 'gzip' || encoding === 'x-gzip') stream = incoming.pipe(createGunzip());
        else if (encoding === 'deflate') stream = incoming.pipe(createInflate());
        else if (encoding === 'br') stream = incoming.pipe(createBrotliDecompress());
        const chunks: Buffer[] = [];
        let size = 0;
        let truncated = false;
        const finish = () =>
          resolve({
            status: incoming.statusCode ?? 0,
            headers,
            body: new Uint8Array(Buffer.concat(chunks)),
            truncated,
          });
        stream.on('data', (chunk: Buffer) => {
          if (truncated) return;
          const room = req.maxBytes - size;
          if (chunk.length >= room) {
            chunks.push(chunk.subarray(0, room));
            size = req.maxBytes;
            truncated = true;
            incoming.destroy();
            stream.destroy();
            finish();
            return;
          }
          chunks.push(chunk);
          size += chunk.length;
        });
        stream.on('end', () => {
          if (!truncated) finish();
        });
        stream.on('error', (error) => {
          if (!truncated) reject(error);
        });
      },
    );
    outgoing.on('error', reject);
    outgoing.end();
  });

/**
 * GET seguro: confere a URL e o DNS em cada salto e segue até `maxRedirects` redirecionamentos.
 * Respostas que não são redirecionamento voltam como estão (o chamador interpreta o status).
 */
export async function safeFetch(
  raw: string | URL,
  options: SafeFetchOptions,
): Promise<SafeFetchResult> {
  const resolver = options.resolver ?? systemResolver;
  const transport = options.transport ?? nodeTransport;
  const maxRedirects = options.maxRedirects ?? 5;
  const timeout = AbortSignal.timeout(options.timeoutMs);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;

  let current = raw.toString();
  for (let redirects = 0; ; redirects += 1) {
    const checked = checkUrl(current);
    if (!checked.ok) return { ok: false, failure: 'blocked_address' };
    const url = checked.url;
    url.hash = '';
    const target = await resolvePublicTarget(url, resolver);
    if (!target.ok) return { ok: false, failure: target.reason };

    let response: TransportResponse;
    try {
      response = await transport({
        url,
        address: target.address,
        family: target.family,
        headers: {
          'user-agent': USER_AGENT,
          accept: options.accept ?? 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.1',
          'accept-language': 'pt-BR,pt;q=0.9,en;q=0.5',
          'accept-encoding': 'gzip, deflate, br',
        },
        maxBytes: options.maxBytes,
        signal,
      });
    } catch (error) {
      if (options.signal?.aborted) throw error;
      return { ok: false, failure: 'unavailable' };
    }

    const location = response.headers.location;
    if (REDIRECT_STATUSES.has(response.status) && location) {
      if (redirects >= maxRedirects) return { ok: false, failure: 'too_many_redirects' };
      let next: URL;
      try {
        next = new URL(location, url);
      } catch {
        return { ok: false, failure: 'unavailable' };
      }
      const nextCheck = checkUrl(next);
      if (!nextCheck.ok) return { ok: false, failure: 'blocked_address' };
      if (options.beforeRedirect) {
        const refusal = await options.beforeRedirect(nextCheck.url);
        if (refusal) return { ok: false, failure: refusal };
      }
      current = nextCheck.url.toString();
      continue;
    }
    if (response.truncated && response.body.length === 0)
      return { ok: false, failure: 'too_large' };
    return { ok: true, url, response, redirects };
  }
}
