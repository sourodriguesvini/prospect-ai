import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE_OPTIONS } from '@/lib/session-cookie';

/** Rotas que exigem sessão. */
const PROTECTED_PREFIXES = ['/app', '/o', '/convite'];
/** Rotas de quem ainda não entrou; com sessão, vão para /app. */
const GUEST_ONLY = ['/entrar', '/cadastro'];

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
    ...(isDev ? [] : ['upgrade-insecure-requests']),
  ].join('; ');
}

function isProtected(pathname: string): boolean {
  return PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

/**
 * Executa antes de cada página: aplica CSP com nonce, renova a sessão do Supabase (cookies)
 * e redireciona conforme a autenticação. A autorização fina fica no serviço e no RLS.
 */
export async function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const csp = buildCsp(nonce);
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', csp);

  let response = NextResponse.next({ request: { headers: requestHeaders } });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  let userId: string | null = null;

  if (url && key) {
    const supabase = createServerClient(url, key, {
      cookieOptions: SESSION_COOKIE_OPTIONS,
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
          requestHeaders.set('cookie', request.headers.get('cookie') ?? '');
          response = NextResponse.next({ request: { headers: requestHeaders } });
          for (const { name, value, options } of cookiesToSet)
            response.cookies.set(name, value, options);
          for (const [header, value] of Object.entries(headers))
            response.headers.set(header, value);
        },
      },
    });
    const { data } = await supabase.auth.getClaims();
    userId = typeof data?.claims.sub === 'string' ? data.claims.sub : null;
  }

  const { pathname, search } = request.nextUrl;
  let redirectTo: URL | null = null;
  if (!userId && isProtected(pathname)) {
    redirectTo = new URL('/entrar', request.url);
    redirectTo.searchParams.set('next', `${pathname}${search}`);
  } else if (userId && GUEST_ONLY.includes(pathname)) {
    redirectTo = new URL('/app', request.url);
  }

  if (redirectTo) {
    const redirect = NextResponse.redirect(redirectTo);
    for (const cookie of response.cookies.getAll()) redirect.cookies.set(cookie);
    redirect.headers.set('Content-Security-Policy', csp);
    return redirect;
  }

  response.headers.set('Content-Security-Policy', csp);
  return response;
}

// Roda também em prefetch: é o proxy que grava a sessão renovada (Server Components não
// conseguem), e todo HTML precisa sair com CSP.
export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?)$).*)',
  ],
};
