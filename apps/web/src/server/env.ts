import 'server-only';
import { z } from 'zod';

const ServerEnv = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(20),
  NEXT_PUBLIC_SITE_URL: z.url(),
});
export type ServerEnv = z.infer<typeof ServerEnv>;

let cached: ServerEnv | undefined;

/**
 * Variáveis de ambiente validadas. A falha cita só os nomes ausentes, nunca valores.
 * A secret key do Supabase não é lida aqui: a aplicação web age sempre como o usuário.
 */
export function serverEnv(): ServerEnv {
  if (cached) return cached;
  const parsed = ServerEnv.safeParse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
  });
  if (!parsed.success) {
    const names = parsed.error.issues.map((issue) => issue.path.join('.')).join(', ');
    throw new Error(
      `Variáveis de ambiente ausentes ou inválidas: ${names}. Veja docs/runbooks/ambiente-local.md.`,
    );
  }
  cached = parsed.data;
  return cached;
}
