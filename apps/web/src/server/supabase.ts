import 'server-only';
import { createServerClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { cache } from 'react';
import { SESSION_COOKIE_OPTIONS } from '@/lib/session-cookie';
import { serverEnv } from './env';

/**
 * Cliente Supabase da requisição atual, autenticado pelos cookies do usuário (publishable key
 * + JWT do usuário). Todo acesso a dados passa pelo RLS. Um cliente por requisição.
 */
export const getSupabase = cache(async (): Promise<SupabaseClient> => {
  const env = serverEnv();
  const cookieStore = await cookies();
  return createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookieOptions: SESSION_COOKIE_OPTIONS,
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet)
              cookieStore.set(name, value, options);
          } catch {
            // Server Components não podem gravar cookies; o proxy renova a sessão antes da renderização.
          }
        },
      },
    },
  );
});
