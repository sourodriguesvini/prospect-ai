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

const MODEL_NAME = /^[a-z0-9][a-z0-9._\-/]*(:[a-z0-9][a-z0-9._-]*)?$/i;

const LocalAiEnv = z.object({
  OLLAMA_BASE_URL: z.url({ protocol: /^https?$/ }).optional(),
  AI_COPILOT_MODELS: z
    .string()
    .transform((value) =>
      value
        .split(',')
        .map((name) => name.trim())
        .filter(Boolean),
    )
    .pipe(z.array(z.string().regex(MODEL_NAME)).min(1))
    .optional(),
  AI_KEEP_ALIVE: z
    .string()
    .regex(/^(0|\d+(ms|s|m|h))$/)
    .optional(),
  AI_NUM_CTX: z.coerce.number().int().min(2048).max(262_144).optional(),
  AI_MAX_CONCURRENCY: z.coerce.number().int().min(1).max(4).default(1),
  AI_MAX_QUEUE: z.coerce.number().int().min(0).max(20).default(3),
});

/** Configuração da IA local (ADR-0008). Nada aqui é segredo; o endereço precisa ser local. */
export interface LocalAiSettings {
  baseUrl: string | undefined;
  copilotModels: string[] | undefined;
  keepAlive: string | undefined;
  numCtx: number | undefined;
  maxConcurrent: number;
  maxQueue: number;
}

export function localAiEnv(): LocalAiSettings {
  const parsed = LocalAiEnv.safeParse({
    OLLAMA_BASE_URL: readVar('OLLAMA_BASE_URL'),
    AI_COPILOT_MODELS: readVar('AI_COPILOT_MODELS'),
    AI_KEEP_ALIVE: readVar('AI_KEEP_ALIVE'),
    AI_NUM_CTX: readVar('AI_NUM_CTX'),
    AI_MAX_CONCURRENCY: readVar('AI_MAX_CONCURRENCY'),
    AI_MAX_QUEUE: readVar('AI_MAX_QUEUE'),
  });
  if (!parsed.success) {
    const names = [...new Set(parsed.error.issues.map((issue) => issue.path.join('.')))];
    throw new Error(
      `Variáveis da IA local inválidas: ${names.join(', ')}. Veja docs/runbooks/ambiente-local.md.`,
    );
  }
  const env = parsed.data;
  return {
    baseUrl: env.OLLAMA_BASE_URL,
    copilotModels: env.AI_COPILOT_MODELS,
    keepAlive: env.AI_KEEP_ALIVE,
    numCtx: env.AI_NUM_CTX,
    maxConcurrent: env.AI_MAX_CONCURRENCY,
    maxQueue: env.AI_MAX_QUEUE,
  };
}
