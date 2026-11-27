import { vi } from 'vitest';
import type { Transport, TransportRequest, TransportResponse } from '../../src/web/safe-http';
import type { Resolver } from '../../src/web/ssrf';

/** Rede falsa para os testes do leitor: DNS e transporte em memória, sem tocar a internet. */

export const PUBLIC_IP = '93.184.215.14';

export function fakeResolver(table: Record<string, string[]>): Resolver {
  return async (host) => {
    const answers = table[host];
    if (!answers) throw Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' });
    return answers;
  };
}

export function reply(
  status: number,
  body: string | Uint8Array = '',
  headers: Record<string, string> = {},
): (request: TransportRequest) => TransportResponse {
  return (request) => {
    const bytes = typeof body === 'string' ? new TextEncoder().encode(body) : body;
    const truncated = bytes.length > request.maxBytes;
    return {
      status,
      headers,
      body: truncated ? bytes.subarray(0, request.maxBytes) : bytes,
      truncated,
    };
  };
}

export const html = (body: string, headers: Record<string, string> = {}) =>
  reply(200, body, { 'content-type': 'text/html; charset=utf-8', ...headers });

export const redirect = (location: string, status = 302) => reply(status, '', { location });

type Route = (request: TransportRequest) => TransportResponse | Promise<TransportResponse>;

/** Transporte que responde por URL completa; o que não estiver na tabela vira 404. */
export function fakeTransport(routes: Record<string, Route>) {
  const calls: TransportRequest[] = [];
  const transport = vi.fn<Transport>(async (request) => {
    calls.push(request);
    const route = routes[request.url.toString()];
    return route ? route(request) : reply(404)(request);
  });
  return { transport, calls, urls: () => calls.map((call) => call.url.toString()) };
}
