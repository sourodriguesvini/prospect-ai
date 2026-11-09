/**
 * Opções dos cookies de sessão do Supabase. O app não tem cliente Supabase no navegador, então
 * o JavaScript da página nunca precisa ler os tokens: httpOnly limita o estrago de um XSS.
 * Usado pelo proxy e pelo cliente de servidor (os dois gravam a sessão renovada).
 */
export const SESSION_COOKIE_OPTIONS = {
  path: '/',
  sameSite: 'lax',
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
} as const;
