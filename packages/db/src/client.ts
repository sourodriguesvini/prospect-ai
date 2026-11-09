import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export interface ServerClientOptions {
  /** Substitui o fetch global (testes do adaptador). */
  fetch?: typeof fetch;
}

/**
 * Cliente do servidor com a secret key: ignora RLS e nunca guarda sessão. Só o composition
 * root do app (`apps/web/src/server/container.ts`, módulo server-only) o cria (ADR-0007).
 */
export function createServerSupabaseClient(
  url: string,
  secretKey: string,
  options: ServerClientOptions = {},
): SupabaseClient {
  return createClient(url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    ...(options.fetch ? { global: { fetch: options.fetch } } : {}),
  });
}
