import 'server-only';
import { z } from 'zod';
import { ModelName, WEB_RESEARCH_ENV_FORMATS, WebResearchEnv } from '@prospector/contracts';

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

export type CnpjLookupMode = 'on' | 'off' | 'fixture';

/**
 * Consulta de CNPJ na internet (OpenCNPJ, com a Minha Receita de reserva; M2). Ligada por padrão,
 * sem chave. `PROSPECTOR_CNPJ_LOOKUP=off` desliga (uso sem internet); `fixture` usa registros
 * SINTÉTICOS, só no modo memória (testes de ponta a ponta).
 */
export function cnpjLookupMode(): CnpjLookupMode {
  const value = readVar('PROSPECTOR_CNPJ_LOOKUP');
  if (value === undefined || value === 'on') return 'on';
  if (value === 'off' || value === 'fixture') return value;
  throw new Error('PROSPECTOR_CNPJ_LOOKUP inválida: use "on", "off", "fixture" ou deixe vazia.');
}

export type RelationshipAiMode = 'ollama' | 'fixture';

/**
 * IA do Relacionamento (ADR-0014): o Ollama local por padrão. `PROSPECTOR_RELATIONSHIP_AI=fixture`
 * usa textos SINTÉTICOS, só no modo memória (testes de ponta a ponta, sem GPU).
 */
export function relationshipAiMode(): RelationshipAiMode {
  const value = readVar('PROSPECTOR_RELATIONSHIP_AI');
  if (value === undefined || value === 'ollama') return 'ollama';
  if (value === 'fixture') return value;
  throw new Error('PROSPECTOR_RELATIONSHIP_AI inválida: use "ollama", "fixture" ou deixe vazia.');
}

export function cnpjLookupEnabled(): boolean {
  return cnpjLookupMode() !== 'off';
}

export type DiscoveryMode = 'on' | 'off' | 'fixture';

/**
 * Descoberta (ADR-0013). Ligada por padrão (usa a pesquisa na internet e a IA local);
 * `PROSPECTOR_DISCOVERY=off` desliga o módulo e o trabalhador da fila; `fixture` usa buscador e
 * IA SINTÉTICOS, só no modo memória (demonstração e testes de ponta a ponta, tudo com selo DEMO).
 */
export function discoveryMode(): DiscoveryMode {
  const value = readVar('PROSPECTOR_DISCOVERY');
  if (value === undefined || value === 'on') return 'on';
  if (value === 'off' || value === 'fixture') return value;
  throw new Error('PROSPECTOR_DISCOVERY inválida: use "on", "off", "fixture" ou deixe vazia.');
}

/**
 * Trabalhador da fila (ADR-0011) neste processo: ligado por padrão. `PROSPECTOR_JOB_WORKER=off`
 * deixa as telas funcionando sem pegar tarefas nem rodar monitoramentos: para servidores de teste
 * apontados para o banco real e para ter um só trabalhador por banco (pnpm dev × app instalado).
 */
export function jobWorkerEnabled(): boolean {
  const value = readVar('PROSPECTOR_JOB_WORKER');
  if (value === undefined || value === 'on') return true;
  if (value === 'off') return false;
  throw new Error('PROSPECTOR_JOB_WORKER inválida: use "on", "off" ou deixe vazia.');
}

/** Padrão do teto diário de créditos dos monitoramentos (pesquisas automáticas). */
export const DISCOVERY_DAILY_AUTO_CREDITS_DEFAULT = 12;

/**
 * Teto de créditos da Tavily por dia para pesquisas que rodam sozinhas (monitoramentos), de 0 a
 * 200 (`DISCOVERY_DAILY_AUTO_CREDITS`; 0 = monitoramentos não rodam sozinhos). Valor inválido usa
 * o padrão e avisa no log (só o nome da variável).
 */
export function discoveryDailyAutoCredits(): number {
  const value = readVar('DISCOVERY_DAILY_AUTO_CREDITS');
  if (value === undefined) return DISCOVERY_DAILY_AUTO_CREDITS_DEFAULT;
  const parsed = Number(value);
  if (Number.isInteger(parsed) && parsed >= 0 && parsed <= 200) return parsed;
  console.error(
    `[descoberta] DISCOVERY_DAILY_AUTO_CREDITS inválida (inteiro de 0 a 200); usando ${DISCOVERY_DAILY_AUTO_CREDITS_DEFAULT}.`,
  );
  return DISCOVERY_DAILY_AUTO_CREDITS_DEFAULT;
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
    .pipe(z.array(ModelName).min(1))
    .optional(),
  AI_KEEP_ALIVE: z
    .string()
    .regex(/^(0|\d+(ms|s|m|h))$/)
    .optional(),
  AI_NUM_CTX: z.coerce.number().int().min(2048).max(262_144).optional(),
  AI_MAX_CONCURRENCY: z.coerce.number().int().min(1).max(4).default(1),
  AI_MAX_QUEUE: z.coerce.number().int().min(0).max(20).default(3),
  /** Memória de vídeo (MiB) que a IA local deixa para os outros programas; 0 desliga a reserva. */
  AI_VRAM_RESERVE_MIB: z.coerce.number().int().min(0).max(65_536).optional(),
});

/** Configuração da IA local (ADR-0008). Nada aqui é segredo; o endereço precisa ser local. */
export interface LocalAiSettings {
  baseUrl: string | undefined;
  copilotModels: string[] | undefined;
  keepAlive: string | undefined;
  numCtx: number | undefined;
  maxConcurrent: number;
  maxQueue: number;
  vramReserveMiB: number | undefined;
}

/**
 * Formato esperado de cada variável da IA local, para a mensagem de configuração inválida
 * (KI-067). Espelha as regras de `LocalAiEnv`; mostra o formato, nunca o valor recebido.
 */
export const LOCAL_AI_ENV_FORMATS: Record<string, string> = {
  // Sem o número da porta no texto: o endereço do Ollama só aparece em packages/agents (ADR-0008).
  OLLAMA_BASE_URL: 'endereço http deste computador (127.0.0.1 ou localhost), com a porta do Ollama',
  AI_COPILOT_MODELS: 'nomes de modelo separados por vírgula, como qwen3.5:4b',
  AI_KEEP_ALIVE: '0 ou um número seguido de ms, s, m ou h, como 5m',
  AI_NUM_CTX: 'número inteiro de 2048 a 262144',
  AI_MAX_CONCURRENCY: 'número inteiro de 1 a 4',
  AI_MAX_QUEUE: 'número inteiro de 0 a 20',
  AI_VRAM_RESERVE_MIB: 'número inteiro de MiB, de 0 a 65536 (0 desliga a reserva)',
};

/** Variável da IA local inválida. Leva só os nomes, nunca os valores. */
export class LocalAiConfigError extends Error {
  readonly variables: string[];
  constructor(variables: string[]) {
    super(
      `Variáveis da IA local inválidas: ${variables.join(', ')}. Veja docs/runbooks/ambiente-local.md.`,
    );
    this.name = 'LocalAiConfigError';
    this.variables = variables;
  }
}

export function localAiEnv(): LocalAiSettings {
  const parsed = LocalAiEnv.safeParse({
    OLLAMA_BASE_URL: readVar('OLLAMA_BASE_URL'),
    AI_COPILOT_MODELS: readVar('AI_COPILOT_MODELS'),
    AI_KEEP_ALIVE: readVar('AI_KEEP_ALIVE'),
    AI_NUM_CTX: readVar('AI_NUM_CTX'),
    AI_MAX_CONCURRENCY: readVar('AI_MAX_CONCURRENCY'),
    AI_MAX_QUEUE: readVar('AI_MAX_QUEUE'),
    AI_VRAM_RESERVE_MIB: readVar('AI_VRAM_RESERVE_MIB'),
  });
  if (!parsed.success) {
    throw new LocalAiConfigError([
      ...new Set(parsed.error.issues.map((issue) => issue.path.join('.'))),
    ]);
  }
  const env = parsed.data;
  return {
    baseUrl: env.OLLAMA_BASE_URL,
    copilotModels: env.AI_COPILOT_MODELS,
    keepAlive: env.AI_KEEP_ALIVE,
    numCtx: env.AI_NUM_CTX,
    maxConcurrent: env.AI_MAX_CONCURRENCY,
    maxQueue: env.AI_MAX_QUEUE,
    vramReserveMiB: env.AI_VRAM_RESERVE_MIB,
  };
}

/** Configuração da pesquisa na internet (ADR-0012). A chave só existe no servidor. */
export interface WebResearchSettings extends WebResearchEnv {
  /** Chave da Tavily; null = não configurada. Nunca vai para log, tela ou trace. */
  tavilyApiKey: string | null;
  searchEnabled: boolean;
  pageReaderEnabled: boolean;
}

/** Variável da pesquisa na internet inválida. Leva só os nomes e o formato, nunca os valores. */
export class WebResearchConfigError extends Error {
  constructor(variables: string[]) {
    const expected = variables.map((name) => {
      const format = WEB_RESEARCH_ENV_FORMATS[name as keyof WebResearchEnv];
      return format ? `${name} (${format})` : name;
    });
    super(
      `Pesquisa na internet desligada: variáveis inválidas: ${expected.join('; ')}. Corrija em apps/web/.env.local (veja docs/adr/0012-busca-web-tavily-playwright.md) e reinicie o app.`,
    );
    this.name = 'WebResearchConfigError';
  }
}

/**
 * Pesquisa na internet (ADR-0012). Sem TAVILY_API_KEY a busca responde "não configurada";
 * PROSPECTOR_WEB_SEARCH=off desliga mesmo com chave (padrão: ligada). O teto mensal de créditos
 * nunca passa da cota gratuita (D-AI-4).
 */
export function webResearchEnv(): WebResearchSettings {
  const raw = Object.fromEntries(
    Object.keys(WebResearchEnv.shape).map((name) => [name, readVar(name)]),
  );
  const parsed = WebResearchEnv.safeParse(raw);
  if (!parsed.success) {
    throw new WebResearchConfigError([
      ...new Set(parsed.error.issues.map((issue) => issue.path.join('.'))),
    ]);
  }
  return {
    ...parsed.data,
    tavilyApiKey: readVar('TAVILY_API_KEY') ?? null,
    searchEnabled: parsed.data.PROSPECTOR_WEB_SEARCH !== 'off',
    pageReaderEnabled: parsed.data.PROSPECTOR_PAGE_READER !== 'off',
  };
}

/**
 * Investigação de empresas (ADR-0015). `PROSPECTOR_CAPTURES_DIR`: pasta absoluta das capturas de
 * marca, fora do disco do sistema (C: quase cheio, KI-017); vazia = as imagens são analisadas,
 * mas não ficam guardadas (o dossiê mostra só as medições). `PROSPECTOR_BRAND_CAPTURE=off`
 * desliga a captura de tela (padrão: ligada).
 */
export interface InvestigationSettings {
  capturesDir: string | null;
  captureEnabled: boolean;
  /** Motivo de a pasta ter sido ignorada (texto para o log, sem o valor). */
  capturesDirProblem: string | null;
}

export function investigationEnv(): InvestigationSettings {
  const capture = readVar('PROSPECTOR_BRAND_CAPTURE');
  const dir = readVar('PROSPECTOR_CAPTURES_DIR');
  let capturesDir: string | null = null;
  let capturesDirProblem: string | null = null;
  if (dir !== undefined) {
    const windowsAbsolute = /^[A-Za-z]:[\\/]/.test(dir);
    const posixAbsolute = /^\/(?![\\/])/.test(dir);
    if (/^[\\/]{2}/.test(dir)) {
      // Compartilhamento de rede (\\servidor\pasta ou //servidor): a imagem sairia do computador.
      capturesDirProblem =
        'PROSPECTOR_CAPTURES_DIR não pode ser uma pasta de rede: as capturas ficam neste computador';
    } else if (!windowsAbsolute && !posixAbsolute) {
      capturesDirProblem =
        'PROSPECTOR_CAPTURES_DIR precisa ser um caminho absoluto com letra de unidade (ex.: D:\\Prospector-dados\\capturas)';
    } else if (/^[Cc]:/.test(dir)) {
      capturesDirProblem =
        'PROSPECTOR_CAPTURES_DIR não pode ficar no disco C: (quase cheio, KI-017)';
    } else if (/(^|[\\/])\.\.([\\/]|$)/.test(dir)) {
      capturesDirProblem = 'PROSPECTOR_CAPTURES_DIR não pode ter ".." no caminho';
    } else if (/onedrive|dropbox|google ?drive|icloud ?drive|meu drive|my drive/i.test(dir)) {
      // Pasta sincronizada copia as imagens para a nuvem (ADR-0015 §8, R-OPS-1).
      capturesDirProblem =
        'PROSPECTOR_CAPTURES_DIR não pode ficar numa pasta sincronizada com a nuvem (OneDrive, Dropbox, Google Drive, iCloud)';
    } else {
      capturesDir = dir;
    }
  }
  return { capturesDir, captureEnabled: capture !== 'off', capturesDirProblem };
}
