import 'server-only';
import {
  COPILOT_TOOLS_PROMPT_VERSION,
  copilotPromptSupportsDiscoveryTools,
  copilotPromptSupportsRelationshipTools,
  copilotPromptSupportsWebTools,
  createLocalAiRuntime,
  createLocalDiscoveryAi,
  createRelationshipAi,
  createUnavailableLocalAi,
  DEFAULT_OLLAMA_URL,
  isAiError,
  toAiError,
  type LocalAiGateway,
  type LocalAiRuntime,
} from '@prospector/agents';

/** Texto dos fatos do sistema para o Copiloto (função pura do pacote de IA). */
export { buildCopilotSystemFacts } from '@prospector/agents';
import {
  companyTools,
  discoveryTools,
  createAuditService,
  createCompanyService,
  createCopilotService,
  createDiscoveryEngine,
  createDiscoveryScheduler,
  createDiscoveryService,
  createEvidenceService,
  createJobWorker,
  createRelationshipService,
  createStrategyService,
  createSystemService,
  createToolRegistry,
  createWebResearchService,
  DiscoveryAiError,
  discoveryJobHandler,
  relationshipTools,
  strategyTools,
  webResearchTools,
  type AiTelemetryRepository,
  type AuditRepository,
  type AuditService,
  type CnpjLookup,
  type CompanyRepository,
  type CompanyService,
  type CopilotRepository,
  type CopilotService,
  type DiscoveryAi,
  type DiscoveryRepository,
  type DiscoveryService,
  type EvidenceRepository,
  type JobQueue,
  type JobWorker,
  type RelationshipAi,
  type RelationshipRepository,
  type RelationshipService,
  type StrategyRepository,
  type StrategyService,
  type SystemService,
  type ToolDefinition,
  type ToolRegistry,
  type WebResearchService,
  type WebResearchUsageStore,
} from '@prospector/application';
import {
  createMemoryAuditRepository,
  createMemoryCompanyRepository,
  createMemoryCopilotRepository,
  createMemoryDiscoveryStore,
  createMemoryRelationshipRepository,
  createMemoryStrategyRepository,
  createMemoryWebResearchUsage,
} from '@prospector/application/memory';
import {
  createServerSupabaseClient,
  createSupabaseAuditRepository,
  createSupabaseCompanyRepository,
  createSupabaseCopilotRepository,
  createSupabaseDatabaseHealth,
  createSupabaseDiscoveryRepository,
  createSupabaseJobQueue,
  createSupabaseRelationshipRepository,
  createSupabaseStrategyRepository,
  createSupabaseWebResearchUsage,
} from '@prospector/db';
import { createCnpjLookup, createPageReader, createTavilySearch } from '@prospector/integrations';
import { cache } from 'react';
import { syntheticCnpjLookup } from './cnpj-fixture';
import { syntheticDiscoveryAi, syntheticDiscoveryWeb } from './discovery-fixture';
import { syntheticRelationshipAi } from './relationship-ai-fixture';
import {
  cnpjLookupMode,
  databaseEnv,
  discoveryDailyAutoCredits,
  jobWorkerEnabled,
  discoveryMode,
  databaseEnvPresent,
  LOCAL_AI_ENV_FORMATS,
  LocalAiConfigError,
  localAiEnv,
  relationshipAiMode,
  storageMode,
  WebResearchConfigError,
  webResearchEnv,
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
  /**
   * Pesquisa na internet (ADR-0012): busca Tavily e leitura de páginas; null sem banco. As
   * ferramentas do Copiloto para ela entram conforme `copilotTools`.
   */
  research: WebResearchService | null;
  /** Ferramentas oferecidas ao Copiloto; null sem banco. */
  tools: ToolRegistry | null;
  /**
   * Descoberta (ADR-0013): pesquisas, empresas encontradas, sinais e monitoramentos; null sem
   * banco ou com `PROSPECTOR_DISCOVERY=off`. Quem executa é o trabalhador da fila.
   */
  discovery: DiscoveryService | null;
  /** Relacionamento (ADR-0014): abordagens, conversas, pipeline e aprovações; null sem banco. */
  relationship: RelationshipService | null;
}

interface MemoryStores {
  audit: AuditRepository;
  strategy: StrategyRepository;
  copilot: CopilotRepository & AiTelemetryRepository;
  companies: CompanyRepository & EvidenceRepository;
  discovery: { repository: DiscoveryRepository; queue: JobQueue };
  relationship: RelationshipRepository;
}

/** Um único conjunto de repositórios em memória por processo do servidor (sobrevive a requisições). */
function memoryStores(): MemoryStores {
  const holder = globalThis as { __prospectorMemoryStores?: MemoryStores };
  if (!holder.__prospectorMemoryStores) {
    const audit = createMemoryAuditRepository();
    const companies = createMemoryCompanyRepository({ audit });
    // A estratégia grava a auditoria junto com cada escrita (KI-041), na mesma trilha.
    holder.__prospectorMemoryStores = {
      audit,
      strategy: createMemoryStrategyRepository({ audit }),
      copilot: createMemoryCopilotRepository({ audit }),
      companies,
      discovery: createMemoryDiscoveryStore({ audit }),
      relationship: createMemoryRelationshipRepository({ audit, companies }),
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

/**
 * Pesquisa na internet (ADR-0012): uma instância por processo, porque o cache, o orçamento de
 * créditos (trava e reserva), as filas, o cache de robots.txt, a lista de endereços vindos de
 * busca e o navegador valem para todos os pedidos. Sem banco (`usage` null) a busca fica
 * desligada: o contador em memória zeraria a cada reinício e o teto mensal deixaria de valer.
 * Configuração inválida desliga a pesquisa e avisa no log (só nomes e formatos, nunca valores).
 */
interface WebResearchSetup {
  service: WebResearchService;
  /** Busca ligada: há banco, chave e a busca não foi desligada (`PROSPECTOR_WEB_SEARCH=off`). */
  searchOn: boolean;
}

function webResearch(
  repo: CompanyRepository & EvidenceRepository,
  usage: WebResearchUsageStore | null,
): WebResearchSetup {
  const holder = globalThis as { __prospectorWebResearchSetup?: WebResearchSetup };
  if (holder.__prospectorWebResearchSetup) return holder.__prospectorWebResearchSetup;
  let env: ReturnType<typeof webResearchEnv> | null = null;
  try {
    env = webResearchEnv();
  } catch (error) {
    if (!(error instanceof WebResearchConfigError)) throw error;
    console.error(`[pesquisa-web] ${error.message}`);
  }
  const searchOn = Boolean(env && env.searchEnabled && usage && env.tavilyApiKey);
  const service = createWebResearchService({
    search:
      !env || !env.searchEnabled || !usage
        ? 'disabled'
        : env.tavilyApiKey
          ? createTavilySearch({ apiKey: env.tavilyApiKey })
          : 'not_configured',
    pages: env?.pageReaderEnabled ? createPageReader() : 'disabled',
    // Sem banco, o contador em memória só alimenta o estado: a busca já está desligada.
    usage: usage ?? createMemoryWebResearchUsage(),
    companies: repo,
    evidence: repo,
    evidenceService: createEvidenceService({ evidence: repo }),
    monthlyCreditBudget: env?.WEB_SEARCH_MONTHLY_CREDITS ?? 0,
    maxConcurrentSearches: env?.WEB_SEARCH_MAX_CONCURRENCY,
    maxConcurrentPages: env?.PAGE_READER_MAX_CONCURRENCY,
    searchCacheTtlMs: env ? env.WEB_SEARCH_CACHE_HOURS * 60 * 60 * 1000 : undefined,
  });
  holder.__prospectorWebResearchSetup = { service, searchOn };
  return holder.__prospectorWebResearchSetup;
}

/**
 * Ferramentas oferecidas ao Copiloto. As da pesquisa na internet (`webResearchTools`) só entram
 * com a busca ligada e com um prompt que as conhece (`copilot-tools/v3` em diante): o v2 diz ao
 * modelo que nenhuma ferramenta acessa a internet (KI-096). As da Descoberta (M3) só entram com a
 * Descoberta ligada e um prompt que conhece o rascunho de pesquisa (`copilot-tools/v4` em diante).
 */
function copilotTools(
  strategy: StrategyService,
  audit: AuditService,
  companies: CompanyService,
  research: WebResearchSetup,
  discovery: DiscoveryService | null,
  relationship: RelationshipService,
): ToolDefinition[] {
  const web =
    research.searchOn && copilotPromptSupportsWebTools(COPILOT_TOOLS_PROMPT_VERSION)
      ? webResearchTools({ research: research.service })
      : [];
  const found =
    discovery && copilotPromptSupportsDiscoveryTools(COPILOT_TOOLS_PROMPT_VERSION)
      ? discoveryTools({ discovery })
      : [];
  // Só com um prompt que as conhece (ADR-0014): o copilot-tools/v3 diz que Aprovações está "em
  // construção" e não sabe do Relacionamento. Entram quando um v4 avaliado for promovido.
  const followUp = copilotPromptSupportsRelationshipTools(COPILOT_TOOLS_PROMPT_VERSION)
    ? relationshipTools({ relationship, companies })
    : [];
  return [
    ...strategyTools({ strategy, audit }),
    ...companyTools({ companies }),
    ...followUp,
    ...web,
    ...found,
  ];
}

/**
 * Peças da Descoberta para o serviço (telas) e para o trabalhador da fila. No modo `fixture`
 * buscador e IA são SINTÉTICOS e tudo sai com selo DEMO; registro de demonstração nunca chega ao
 * banco. null = Descoberta desligada.
 */
interface DiscoveryWiring {
  repo: DiscoveryRepository;
  queue: JobQueue;
  web: Pick<WebResearchService, 'status' | 'search' | 'readPage'>;
  ai: DiscoveryAi;
  demo: boolean;
}

function discoveryWiring(
  storage: StorageMode,
  store: { repository: DiscoveryRepository; queue: JobQueue },
  research: WebResearchSetup,
): DiscoveryWiring | null {
  const mode = discoveryMode();
  if (mode === 'off') return null;
  if (mode === 'fixture') {
    if (storage !== 'memory') {
      throw new Error(
        'PROSPECTOR_DISCOVERY=fixture só funciona com PROSPECTOR_STORAGE=memory (pesquisas de demonstração nunca vão para o banco).',
      );
    }
    return {
      repo: store.repository,
      queue: store.queue,
      web: syntheticDiscoveryWeb(),
      ai: syntheticDiscoveryAi,
      demo: true,
    };
  }
  return {
    repo: store.repository,
    queue: store.queue,
    web: research.service,
    ai: discoveryAi(),
    demo: false,
  };
}

function discoveryService(
  wiring: DiscoveryWiring | null,
  repo: CompanyRepository & EvidenceRepository,
  companies: CompanyService,
): DiscoveryService | null {
  if (!wiring) return null;
  ensureDiscoveryWorker();
  return createDiscoveryService({
    repo: wiring.repo,
    web: wiring.web,
    companies,
    companyRepo: repo,
    evidenceService: createEvidenceService({ evidence: repo }),
    demo: wiring.demo,
  });
}

/**
 * IA local da Descoberta: mesmo gateway (e mesma fila de inferências) do Copiloto, porque o
 * computador roda uma inferência por vez. Erros viram `DiscoveryAiError` com o código do gateway.
 */
function discoveryAi(): DiscoveryAi {
  const holder = globalThis as { __prospectorDiscoveryAi?: DiscoveryAi };
  if (holder.__prospectorDiscoveryAi) return holder.__prospectorDiscoveryAi;
  const local = createLocalDiscoveryAi({
    gateway: {
      chat: (...args: Parameters<LocalAiGateway['chat']>) => localAiRuntime().gateway.chat(...args),
    },
  });
  async function guarded<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      throw new DiscoveryAiError(toAiError(error).code);
    }
  }
  holder.__prospectorDiscoveryAi = {
    promptIds: local.promptIds,
    interpret: (input, signal) => guarded(() => local.interpret(input, signal)),
    extract: (input, signal) => guarded(() => local.extract(input, signal)),
  };
  return holder.__prospectorDiscoveryAi;
}

/** Peças do trabalhador, montadas uma vez por processo (fora do ciclo de uma requisição). */
function workerParts(): {
  wiring: DiscoveryWiring;
  strategy: StrategyService;
  companies: CompanyRepository;
} | null {
  if (storageMode() === 'memory') {
    const stores = memoryStores();
    const wiring = discoveryWiring('memory', stores.discovery, webResearch(stores.companies, null));
    if (!wiring) return null;
    return {
      wiring,
      strategy: createStrategyService({ repo: stores.strategy, ephemeralStorage: true }),
      companies: stores.companies,
    };
  }
  const credentials = databaseEnv();
  if (!credentials) return null;
  const client = createServerSupabaseClient(credentials.url, credentials.secretKey);
  const companyRepo = createSupabaseCompanyRepository(client);
  const wiring = discoveryWiring(
    'supabase',
    {
      repository: createSupabaseDiscoveryRepository(client),
      queue: createSupabaseJobQueue(client),
    },
    webResearch(companyRepo, createSupabaseWebResearchUsage(client)),
  );
  if (!wiring) return null;
  return {
    wiring,
    strategy: createStrategyService({ repo: createSupabaseStrategyRepository(client) }),
    companies: companyRepo,
  };
}

/** Intervalo mínimo entre duas passadas do agendador de monitoramentos. */
const SCHEDULER_INTERVAL_MS = 60_000;
const DISCOVERY_WORKER_KEY = '__prospectorDiscoveryWorker';
type DiscoveryWorkerHolder = typeof globalThis & { [DISCOVERY_WORKER_KEY]?: JobWorker | null };

/**
 * Trabalhador da fila durável (ADR-0011): um por processo do servidor, iniciado na abertura do
 * app (`instrumentation.ts`) e, por garantia, na primeira tela que usa a Descoberta. Roda uma
 * tarefa por vez; o agendador de monitoramentos passa no máximo uma vez por minuto. Pesquisa
 * interrompida (app fechado no meio) volta à fila quando o lease vence e é retomada.
 */
export function ensureDiscoveryWorker(): void {
  const holder = globalThis as DiscoveryWorkerHolder;
  if (holder[DISCOVERY_WORKER_KEY] !== undefined) return;
  holder[DISCOVERY_WORKER_KEY] = null;
  try {
    if (!jobWorkerEnabled()) return; // PROSPECTOR_JOB_WORKER=off: outro processo cuida da fila
    const parts = workerParts();
    if (!parts) return;
    const { wiring } = parts;
    const engine = createDiscoveryEngine({
      repo: wiring.repo,
      ai: wiring.ai,
      web: wiring.web,
      strategy: parts.strategy,
      companies: parts.companies,
    });
    const scheduler = createDiscoveryScheduler({
      repo: wiring.repo,
      web: wiring.web,
      dailyAutoCredits: discoveryDailyAutoCredits(),
    });
    let lastSchedule = 0;
    const worker = createJobWorker({
      queue: wiring.queue,
      workerId: `web-${process.pid}-${crypto.randomUUID().slice(0, 8)}`,
      handlers: { discovery_run: discoveryJobHandler(engine) },
      idleMs: 10_000,
      onIdle: async () => {
        if (Date.now() - lastSchedule < SCHEDULER_INTERVAL_MS) return;
        lastSchedule = Date.now();
        try {
          await scheduler.tick();
        } catch (error) {
          console.error(`[descoberta] agendador de monitoramentos falhou: ${String(error)}`);
        }
      },
    });
    worker.start();
    holder[DISCOVERY_WORKER_KEY] = worker;
  } catch (error) {
    console.error(`[descoberta] o trabalhador da fila não iniciou: ${String(error)}`);
  }
}

/** Pesquisa nova na fila: acorda o trabalhador em vez de esperar o intervalo ocioso. */
export function pokeDiscoveryWorker(): void {
  (globalThis as DiscoveryWorkerHolder)[DISCOVERY_WORKER_KEY]?.poke();
}

/**
 * IA do Relacionamento: o Ollama local pelo gateway único (mesma fila e limite de concorrência do
 * Copiloto) ou, nos testes, a fixture SINTÉTICA, que só existe no modo memória.
 */
function relationshipAi(): { ai: RelationshipAi; synthetic: boolean } {
  if (relationshipAiMode() === 'fixture') {
    if (storageMode() !== 'memory') {
      throw new Error(
        'PROSPECTOR_RELATIONSHIP_AI=fixture só funciona com PROSPECTOR_STORAGE=memory (textos de teste nunca vão para o banco).',
      );
    }
    return { ai: syntheticRelationshipAi, synthetic: true };
  }
  const { gateway } = localAiRuntime();
  return {
    ai: createRelationshipAi({ gateway, contextTokens: copilotContextTokens() }),
    synthetic: false,
  };
}

/**
 * Janela da tarefa `copilot` na política em vigor (AI_NUM_CTX muda), para a IA do Relacionamento
 * montar os DADOS do tamanho que cabe. Sem IA local montada, vale o padrão da política.
 */
function copilotContextTokens(): number | undefined {
  return (globalThis as LocalAiHolder)[LOCAL_AI_KEY]?.policy.copilot.numCtx;
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
    const research = webResearch(stores.companies, null);
    const discovery = discoveryService(
      discoveryWiring('memory', stores.discovery, research),
      stores.companies,
      companies,
    );
    const relationshipAiSetup = relationshipAi();
    const relationship = createRelationshipService({
      repo: stores.relationship,
      companies,
      strategy,
      ai: relationshipAiSetup.ai,
      telemetry: stores.copilot,
      syntheticAi: relationshipAiSetup.synthetic,
    });
    return {
      storage: 'memory',
      system: createSystemService({ check: async () => 'memory' }),
      audit,
      strategy,
      copilot: createCopilotService({ repo: stores.copilot, telemetry: stores.copilot }),
      companies,
      research: research.service,
      tools: createToolRegistry({
        tools: copilotTools(strategy, audit, companies, research, discovery, relationship),
        telemetry: stores.copilot,
      }),
      discovery,
      relationship,
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
      research: null,
      tools: null,
      discovery: null,
      relationship: null,
    };
  }
  const client = createServerSupabaseClient(credentials.url, credentials.secretKey);
  const audit = createAuditService(createSupabaseAuditRepository(client));
  const strategy = createStrategyService({ repo: createSupabaseStrategyRepository(client) });
  const copilotRepo = createSupabaseCopilotRepository(client);
  const companyRepo = createSupabaseCompanyRepository(client);
  const companies = companyServices(companyRepo);
  const research = webResearch(companyRepo, createSupabaseWebResearchUsage(client));
  const discovery = discoveryService(
    discoveryWiring(
      'supabase',
      {
        repository: createSupabaseDiscoveryRepository(client),
        queue: createSupabaseJobQueue(client),
      },
      research,
    ),
    companyRepo,
    companies,
  );
  const relationshipAiSetup = relationshipAi();
  const relationship = createRelationshipService({
    repo: createSupabaseRelationshipRepository(client),
    companies,
    strategy,
    ai: relationshipAiSetup.ai,
    telemetry: copilotRepo,
    syntheticAi: relationshipAiSetup.synthetic,
  });
  return {
    storage: 'supabase',
    system: createSystemService(createSupabaseDatabaseHealth(client)),
    audit,
    strategy,
    copilot: createCopilotService({ repo: copilotRepo, telemetry: copilotRepo }),
    companies,
    research: research.service,
    tools: createToolRegistry({
      tools: copilotTools(strategy, audit, companies, research, discovery, relationship),
      telemetry: copilotRepo,
    }),
    discovery,
    relationship,
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

function localAiRuntime(): Pick<LocalAiRuntime, 'gateway' | 'copilot'> {
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
  return runtime;
}

export function getLocalAi(): LocalAi {
  const { gateway, copilot } = localAiRuntime();
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
