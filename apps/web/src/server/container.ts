import 'server-only';
import {
  createLocalAiRuntime,
  createUnavailableLocalAi,
  DEFAULT_OLLAMA_URL,
  isAiError,
  type LocalAiRuntime,
} from '@prospector/agents';

/** Texto dos fatos do sistema para o Copiloto (função pura do pacote de IA). */
export { buildCopilotSystemFacts } from '@prospector/agents';
import {
  companyTools,
  createAuditService,
  createCompanyService,
  createCopilotService,
  createEvidenceService,
  createStrategyService,
  createSystemService,
  createToolRegistry,
  strategyTools,
  type AiTelemetryRepository,
  type AuditRepository,
  type AuditService,
  type CnpjLookup,
  type CompanyRepository,
  type CompanyService,
  type CopilotRepository,
  type CopilotService,
  type EvidenceRepository,
  type StrategyRepository,
  type StrategyService,
  type SystemService,
  type ToolRegistry,
} from '@prospector/application';
import {
  createMemoryAuditRepository,
  createMemoryCompanyRepository,
  createMemoryCopilotRepository,
  createMemoryStrategyRepository,
} from '@prospector/application/memory';
import {
  createServerSupabaseClient,
  createSupabaseAuditRepository,
  createSupabaseCompanyRepository,
  createSupabaseCopilotRepository,
  createSupabaseDatabaseHealth,
  createSupabaseStrategyRepository,
} from '@prospector/db';
import { createCnpjLookup } from '@prospector/integrations';
import { cache } from 'react';
import { syntheticCnpjLookup } from './cnpj-fixture';
import {
  cnpjLookupMode,
  databaseEnv,
  databaseEnvPresent,
  LOCAL_AI_ENV_FORMATS,
  LocalAiConfigError,
  localAiEnv,
  storageMode,
  type StorageMode,
} from './env';

/**
 * Raiz de composição da aplicação web: o único lugar que liga serviços de aplicação a
 * adaptadores concretos (`@prospector/db`, `@prospector/agents`, `@prospector/integrations`) e o
 * único que lê a secret key
 * (ADR-0007, ADR-0008). Telas, rotas e Server Actions recebem serviços daqui.
 */
export interface Services {
  /** Onde os dados ficam; em "memory" as telas avisam que tudo some ao reiniciar (ADR-0009). */
  storage: StorageMode;
  system: SystemService;
  /** null enquanto o banco não estiver configurado: a tela mostra o estado, não um erro. */
  audit: AuditService | null;
  strategy: StrategyService | null;
  /** Conversas persistentes do Copiloto e telemetria da IA local (IA-2). */
  copilot: CopilotService | null;
  /** Empresas, consulta de CNPJ e dossiês (M2); null sem banco. */
  companies: CompanyService | null;
  /** Ferramentas de leitura oferecidas ao Copiloto; null sem banco. */
  tools: ToolRegistry | null;
}

interface MemoryStores {
  audit: AuditRepository;
  strategy: StrategyRepository;
  copilot: CopilotRepository & AiTelemetryRepository;
  companies: CompanyRepository & EvidenceRepository;
}

/** Um único conjunto de repositórios em memória por processo do servidor (sobrevive a requisições). */
function memoryStores(): MemoryStores {
  const holder = globalThis as { __prospectorMemoryStores?: MemoryStores };
  if (!holder.__prospectorMemoryStores) {
    const audit = createMemoryAuditRepository();
    // A estratégia grava a auditoria junto com cada escrita (KI-041), na mesma trilha.
    holder.__prospectorMemoryStores = {
      audit,
      strategy: createMemoryStrategyRepository({ audit }),
      copilot: createMemoryCopilotRepository({ audit }),
      companies: createMemoryCompanyRepository({ audit }),
    };
  }
  return holder.__prospectorMemoryStores;
}

/**
 * Consulta de CNPJ: uma instância por processo, para o cache (um dia por CNPJ) valer entre
 * pedidos e poupar os provedores gratuitos. null quando desligada por variável. A consulta
 * sintética (testes) só existe no modo memória: registro de teste nunca chega ao banco.
 */
function cnpjLookup(): CnpjLookup | null {
  const mode = cnpjLookupMode();
  if (mode === 'off') return null;
  if (mode === 'fixture') {
    if (storageMode() !== 'memory') {
      throw new Error(
        'PROSPECTOR_CNPJ_LOOKUP=fixture só funciona com PROSPECTOR_STORAGE=memory (registros de teste nunca vão para o banco).',
      );
    }
    return syntheticCnpjLookup;
  }
  const holder = globalThis as { __prospectorCnpjLookup?: CnpjLookup };
  holder.__prospectorCnpjLookup ??= createCnpjLookup();
  return holder.__prospectorCnpjLookup;
}

function companyServices(repo: CompanyRepository & EvidenceRepository): CompanyService {
  return createCompanyService({
    companies: repo,
    evidence: repo,
    evidenceService: createEvidenceService({ evidence: repo }),
    cnpjLookup: cnpjLookup(),
  });
}

/** Credenciais do banco ignoradas pelo modo memória: avisa uma vez por processo, alto. */
function warnIgnoredDatabase(): void {
  const holder = globalThis as { __prospectorMemoryWarned?: boolean };
  if (holder.__prospectorMemoryWarned) return;
  holder.__prospectorMemoryWarned = true;
  if (databaseEnvPresent()) {
    console.error(
      'ATENÇÃO: PROSPECTOR_STORAGE=memory com SUPABASE_* definidas. O banco está sendo IGNORADO: nada do que for salvo dura, e as abordagens ficam bloqueadas. Remova PROSPECTOR_STORAGE para usar o banco.',
    );
  }
}

export const getServices = cache((): Services => {
  if (storageMode() === 'memory') {
    warnIgnoredDatabase();
    const stores = memoryStores();
    const audit = createAuditService(stores.audit);
    // LIA e auditoria somem ao reiniciar: a barreira de abordagem nunca libera (ADR-0009).
    const strategy = createStrategyService({ repo: stores.strategy, ephemeralStorage: true });
    const companies = companyServices(stores.companies);
    return {
      storage: 'memory',
      system: createSystemService({ check: async () => 'memory' }),
      audit,
      strategy,
      copilot: createCopilotService({ repo: stores.copilot, telemetry: stores.copilot }),
      companies,
      tools: createToolRegistry({
        tools: [...strategyTools({ strategy, audit }), ...companyTools({ companies })],
        telemetry: stores.copilot,
      }),
    };
  }
  const credentials = databaseEnv();
  if (!credentials) {
    return {
      storage: 'supabase',
      system: createSystemService(null),
      audit: null,
      strategy: null,
      copilot: null,
      companies: null,
      tools: null,
    };
  }
  const client = createServerSupabaseClient(credentials.url, credentials.secretKey);
  const audit = createAuditService(createSupabaseAuditRepository(client));
  const strategy = createStrategyService({ repo: createSupabaseStrategyRepository(client) });
  const copilotRepo = createSupabaseCopilotRepository(client);
  const companies = companyServices(createSupabaseCompanyRepository(client));
  return {
    storage: 'supabase',
    system: createSystemService(createSupabaseDatabaseHealth(client)),
    audit,
    strategy,
    copilot: createCopilotService({ repo: copilotRepo, telemetry: copilotRepo }),
    companies,
    tools: createToolRegistry({
      tools: [...strategyTools({ strategy, audit }), ...companyTools({ companies })],
      telemetry: copilotRepo,
    }),
  };
});

/** O que as telas e rotas usam da IA local: estado, descarregar modelo e o Copiloto. */
export interface LocalAi {
  status: LocalAiRuntime['gateway']['status'];
  unload: LocalAiRuntime['gateway']['unload'];
  copilot: LocalAiRuntime['copilot'];
}

/**
 * IA local: uma única instância no processo do servidor (não por requisição), porque o limite
 * de concorrência e a fila precisam valer para todos os pedidos ao mesmo tempo. Fica em
 * `globalThis` porque o Next carrega este módulo mais de uma vez (rotas de API e telas são
 * empacotadas separadamente); um `let` no módulo criaria uma fila para cada cópia.
 */
const LOCAL_AI_KEY = '__prospectorLocalAi';
type LocalAiHolder = typeof globalThis & { [LOCAL_AI_KEY]?: LocalAiRuntime };

export function getLocalAi(): LocalAi {
  const holder = globalThis as LocalAiHolder;
  let runtime: Pick<LocalAiRuntime, 'gateway' | 'copilot'> | undefined = holder[LOCAL_AI_KEY];
  if (!runtime) {
    try {
      const settings = localAiEnv();
      const created = createLocalAiRuntime({
        baseUrl: settings.baseUrl ?? DEFAULT_OLLAMA_URL,
        copilotModels: settings.copilotModels,
        keepAlive: settings.keepAlive,
        numCtx: settings.numCtx,
        maxConcurrent: settings.maxConcurrent,
        maxQueue: settings.maxQueue,
        vramReserveMiB: settings.vramReserveMiB,
      });
      holder[LOCAL_AI_KEY] = created;
      runtime = created;
    } catch (error) {
      // Configuração inválida não derruba a página nem a rota com erro 500: o painel e o
      // Copiloto mostram o motivo. Não fica guardada: corrigida a variável, a próxima leitura
      // monta a IA local de verdade. Qualquer outro erro é defeito e continua subindo.
      const invalid =
        error instanceof LocalAiConfigError ||
        (isAiError(error) && error.code === 'invalid_config');
      if (!invalid) throw error;
      if (isAiError(error) && error.detail) {
        console.warn(`[ia-local] configuração inválida: ${error.detail}`);
      }
      runtime = createUnavailableLocalAi('invalid_config', invalidConfigMessage(error));
    }
  }
  const { gateway, copilot } = runtime;
  return {
    status: () => gateway.status(),
    unload: (model) => gateway.unload(model),
    copilot,
  };
}

/**
 * Texto para a tela: nomes das variáveis, o formato esperado de cada uma e o que fazer, nunca
 * os valores (KI-067).
 */
function invalidConfigMessage(error: unknown): string {
  const expected = (name: string) => {
    const format = LOCAL_AI_ENV_FORMATS[name];
    return format ? `${name} (${format})` : name;
  };
  const what =
    error instanceof LocalAiConfigError
      ? error.variables.length === 1
        ? `a variável ${error.variables.map(expected).join('')} está inválida`
        : `as variáveis ${error.variables.map(expected).join('; ')} estão inválidas`
      : isAiError(error)
        ? error.message.replace(/\.$/, '')
        : 'não foi possível ler as variáveis AI_* e OLLAMA_BASE_URL';
  return `A IA local não foi iniciada: ${what}. Corrija em apps/web/.env.local (veja docs/runbooks/ambiente-local.md) e reinicie o app.`;
}
