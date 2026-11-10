import { NextResponse, type NextRequest } from 'next/server';
import { isLocalRequest, isSameOriginRequest } from '@/lib/host';

/** Métodos que só leem: não precisam vir de uma página do app. */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function buildCsp(nonce: string): string {
  const isDev = process.env.NODE_ENV === 'development';
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ''}`,
    // Estilos inline ficam permitidos (injeção de CSS pelo framework); scripts não.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}

/**
 * Executa antes de cada página: recusa hosts que não sejam este computador (sem login, é a
 * proteção contra DNS rebinding — ADR-0007), recusa escrita que não venha de uma página do
 * próprio app (Server Actions e rotas POST, KI-064) e aplica CSP com nonce.
 */
export function proxy(request: NextRequest) {
  const host = request.headers.get('host');
  if (!isLocalRequest(host, request.headers.get('x-forwarded-host'))) {
    return refuse('Host não permitido: o Prospector só atende este computador.');
  }
  if (
    !SAFE_METHODS.has(request.method) &&
    !isSameOriginRequest({
      host,
      origin: request.headers.get('origin'),
      secFetchSite: request.headers.get('sec-fetch-site'),
    })
  ) {
    return refuse('Origem não permitida: só as páginas do próprio Prospector podem gravar.');
  }

  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const csp = buildCsp(nonce);
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('Content-Security-Policy', csp);
  return response;
}

function refuse(message: string) {
  return new NextResponse(message, {
    status: 403,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
}

// Todo HTML e toda Server Action passam por aqui; arquivos estáticos (código público do
// próprio app, sem dados) ficam de fora.
export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?)$).*)',
  ],
};
