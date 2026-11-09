import 'server-only';
import { z } from 'zod';

const DatabaseEnv = z.object({
  SUPABASE_URL: z.url({ protocol: /^https?$/ }),
  SUPABASE_SECRET_KEY: z.string().min(20),
});

export interface DatabaseCredentials {
  url: string;
  secretKey: string;
}

function readVar(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

/**
 * Onde o app guarda os dados: no Supabase (padrão) ou só na memória do servidor
 * (`PROSPECTOR_STORAGE=memory`), para testar telas sem banco (ADR-0009). Na memória os dados
 * somem ao reiniciar e a interface avisa isso em todas as telas que gravam.
 */
export type StorageMode = 'supabase' | 'memory';

export function storageMode(): StorageMode {
  const value = readVar('PROSPECTOR_STORAGE');
  if (value === undefined || value === 'supabase') return 'supabase';
  if (value === 'memory') return 'memory';
  throw new Error('PROSPECTOR_STORAGE inválida: use "memory" ou deixe vazia.');
}

/** Alguma variável do banco definida (sem ler nem validar o valor). */
export function databaseEnvPresent(): boolean {
  return readVar('SUPABASE_URL') !== undefined || readVar('SUPABASE_SECRET_KEY') !== undefined;
}

/**
 * Credenciais do banco (só servidor, nunca `NEXT_PUBLIC_*`). Sem nenhuma das duas variáveis,
 * devolve null e o app mostra "banco não configurado". Configuração parcial ou inválida falha
 * alto citando só os nomes das variáveis, nunca os valores.
 */
export function databaseEnv(): DatabaseCredentials | null {
  const raw = {
    SUPABASE_URL: readVar('SUPABASE_URL'),
    SUPABASE_SECRET_KEY: readVar('SUPABASE_SECRET_KEY'),
  };
  if (raw.SUPABASE_URL === undefined && raw.SUPABASE_SECRET_KEY === undefined) return null;
  const parsed = DatabaseEnv.safeParse(raw);
  if (!parsed.success) {
    const names = [...new Set(parsed.error.issues.map((issue) => issue.path.join('.')))];
    throw new Error(
      `Variáveis de ambiente ausentes ou inválidas: ${names.join(', ')}. Veja docs/runbooks/ambiente-local.md.`,
    );
  }
  return { url: parsed.data.SUPABASE_URL, secretKey: parsed.data.SUPABASE_SECRET_KEY };
}
