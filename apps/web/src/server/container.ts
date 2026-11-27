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
  copilotPromptSupportsInvestigationTools,
  createLocalBrandAnalysisAi,
  type LocalAiGateway,
  type LocalAiRuntime,
} from '@prospector/agents';

/** Texto dos fatos do sistema para o Copiloto (função pura do pacote de IA). */
export { buildCopilotSystemFacts } from '@prospector/agents';
import {
  companyTools,
  discoveryTools,
  createAuditService,
  createEmailSettingsService,
  newEmailThrottle,
  createCompanyService,
  createCopilotService,
  createDiscoveryEngine,
  createDiscoveryScheduler,
  createDiscoveryService,
  createEvidenceService,
  createJobWorker,
  createRelationshipService,
  createInvestigationInsightsSource,
  createInvestigationService,
  createIntelligenceService,
  createMonitoringService,
  createStrategyService,
  createSystemService,
  createToolRegistry,
  createWebResearchService,
  createPersonKeyHasher,
  createResearchService,
  DiscoveryAiError,
  discoveryJobHandler,
  relationshipTools,
  investigationTools,
  strategyTools,
  systemClock,
  webResearchTools,
  type AiTelemetryRepository,
  type AuditRepository,
  type AuditService,
  type CnpjLookup,
  type CompanyRepository,
  type ApproachInsightsSource,
  type CompanyService,
  type CopilotRepository,
  type CopilotService,
  type DiscoveryAi,
  type DiscoveryRepository,
  type DiscoveryService,
  type EmailSettingsRepository,
  type EmailSettingsService,
  type EmailThrottle,
  type EvidenceRepository,
  type JobQueue,
  type JobWorker,
  type RelationshipAi,
  type RelationshipRepository,
  type RelationshipService,
  type InvestigationRepository,
  type InvestigationService,
  type IntelligenceService,
  type MonitoringService,
  type StrategyRepository,
  type StrategyService,
  type SystemService,
  type ToolDefinition,
  type ToolRegistry,
  type WebResearchService,
  type WebResearchUsageStore,
  type ResearchRepository,
  type ResearchService,
  type CaptureStore,
  type CaptureStoreHealth,
} from '@prospector/application';
import {
  createMemoryAuditRepository,
  createMemoryCompanyRepository,
  createMemoryCopilotRepository,
  createMemoryDiscoveryStore,
  createMemoryEmailRepository,
  createMemoryRelationshipRepository,
  createMemoryInvestigationRepository,
  createMemoryIntelligenceRepository,
  createMemoryMonitoringRepository,
  createMemoryStrategyRepository,
  createMemoryWebResearchUsage,
  createMemoryResearchRepository,
  type MemoryCompanyRepository,
  type MemoryResearchRepository,
} from '@prospector/application/memory';
import {
  createServerSupabaseClient,
  createSupabaseAuditRepository,
  createSupabaseCompanyRepository,
  createSupabaseCopilotRepository,
  createSupabaseDatabaseHealth,
  type DatabaseHealthMemory,
  createSupabaseEmailRepository,
  createSupabaseDiscoveryRepository,
  createSupabaseJobQueue,
  createSupabaseRelationshipRepository,
  createSupabaseResearchRepository,
  createSupabaseInvestigationRepository,
  createSupabaseIntelligenceRepository,
  createSupabaseMonitoringRepository,
  createSupabaseStrategyRepository,
  createSupabaseWebResearchUsage,
} from '@prospector/db';
import {
  createBrandCapturer,
  createCnpjLookup,
  createDnsTxtLookup,
  createEmailImageFetcher,
  createFileCaptureStore,
  createImapReader,
  createPageReader,
  createPlaywrightRenderer,
  createSmtpTransport,
  createTavilySearch,
  subresourceFetcher,
  systemResolver,
} from '@prospector/integrations';
import { cache } from 'react';
import { syntheticCnpjLookup } from './cnpj-fixture';
import { syntheticDiscoveryAi, syntheticDiscoveryWeb } from './discovery-fixture';
import { syntheticEmail } from './email-fixture';
import { syntheticRelationshipAi } from './relationship-ai-fixture';
import { syntheticResearchWeb } from './research-fixture';
import {
  cnpjLookupMode,
  databaseEnv,
  discoveryDailyAutoCredits,
  jobWorkerEnabled,
  discoveryMode,
  databaseEnvPresent,
  emailMode,
  investigationEnv,
  LOCAL_AI_ENV_FORMATS,
  LocalAiConfigError,
  localAiEnv,
  peopleKeyEnv,
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
   * Investigação de empresas e auditoria de marca (Módulo 02, ADR-0015): fila do processo,
   * capturas, análises da IA local e diagnóstico; null sem banco.
   */
  investigations: InvestigationService | null;
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
  /** E-mail (ADR-0016): identidade, caixa, senha no cofre e conferência; null sem banco. */
  email: EmailSettingsService | null;
  /** true com `PROSPECTOR_EMAIL=fixture`: caixa simulada, a tela mostra o selo DEMO. */
  emailSynthetic: boolean;
  /** Monitoramento de empresas já conhecidas e novidades das buscas recorrentes (ADR-0017). */
  monitoring: MonitoringService | null;
  /** Inteligência: funil e consumo do mês (ADR-0017); null sem banco. */
  intelligence: IntelligenceService | null;
  /**
   * Pesquisa extensa do Copiloto (diretriz de 2026-11-26, Partes 6.3 a 6.5): pedido ligado à
   * conversa, lotes na fila durável, resultados com origem; null sem banco.
   */
  copilotResearch: ResearchService | null;
}

interface MemoryStores {
  audit: AuditRepository;
  strategy: StrategyRepository;
  copilot: CopilotRepository & AiTelemetryRepository;
  companies: MemoryCompanyRepository;
  discovery: ReturnType<typeof createMemoryDiscoveryStore>;
  research: MemoryResearchRepository;
  relationship: RelationshipRepository;
  email: EmailSettingsRepository;
}

/** Um único conjunto de repositórios em memória por processo do servidor (sobrevive a requisições). */
function memoryStores(): MemoryStores {
  const holder = globalThis as { __prospectorMemoryStores?: MemoryStores };
  if (!holder.__prospectorMemoryStores) {
    const audit = createMemoryAuditRepository();
    const companies = createMemoryCompanyRepository({ audit });
    const discovery = createMemoryDiscoveryStore({ audit });
    // A estratégia grava a auditoria junto com cada escrita (KI-041), na mesma trilha.
    holder.__prospectorMemoryStores = {
      audit,
      strategy: createMemoryStrategyRepository({ audit }),
      copilot: createMemoryCopilotRepository({ audit }),
      companies,
      discovery,
      // A pesquisa do Copiloto usa a mesma fila (o que os gatilhos do banco fazem).
      research: createMemoryResearchRepository({
        audit,
        jobs: { enqueueJob: discovery.enqueueJob, cancelJobs: discovery.cancelJobs },
      }),
      relationship: createMemoryRelationshipRepository({ audit, companies }),
      email: createMemoryEmailRepository({ audit }),
    };
  }
  return holder.__prospectorMemoryStores;
}

/** Investigações em memória: mesma trilha de auditoria e mesmas empresas do modo memória. */
function memoryInvestigations(stores: MemoryStores): InvestigationRepository {
  const holder = globalThis as { __prospectorMemoryInvestigations?: InvestigationRepository };
  holder.__prospectorMemoryInvestigations ??= createMemoryInvestigationRepository({
    audit: stores.audit,
    companies: stores.companies,
  });
  return holder.__prospectorMemoryInvestigations;
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
  investigations: InvestigationService | null,
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
  // Investigação (ADR-0015): só com um prompt que declara conhecer a ferramenta que põe na fila
  // (`TOOLS_PROMPT_CAPABILITIES` em `@prospector/agents`), nunca pelo número da versão.
  const investigation =
    investigations && copilotPromptSupportsInvestigationTools(COPILOT_TOOLS_PROMPT_VERSION)
      ? investigationTools({ investigations, companies })
      : [];
  return [
    ...strategyTools({ strategy, audit }),
    ...companyTools({ companies }),
    ...investigation,
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

/**
 * Pesquisa extensa do Copiloto. A chave das pessoas (HMAC) vem de `PROSPECTOR_PEOPLE_KEY` ou do
 * arquivo na pasta de dados (KI-222); sem ela, pessoas achadas são só contadas.
 */
function copilotResearchService(parts: {
  repo: ResearchRepository;
  threads: CopilotRepository;
  research: WebResearchSetup;
  lia: StrategyRepository;
  /** A exportação (CSV) só sai com o registro na auditoria. */
  audit: Pick<AuditRepository, 'append'>;
}): ResearchService {
  const holder = globalThis as { __prospectorPeopleKeyWarned?: boolean };
  const settings = peopleKeyEnv();
  if (settings.problem && !holder.__prospectorPeopleKeyWarned) {
    holder.__prospectorPeopleKeyWarned = true;
    console.warn(`[pesquisa] ${settings.problem}`);
  }
  // Demonstração (`PROSPECTOR_DISCOVERY=fixture`, só em memória): buscador sintético e selo DEMO.
  const demo = storageMode() === 'memory' && discoveryMode() === 'fixture';
  const holderWeb = globalThis as {
    __prospectorResearchFixtureWeb?: ReturnType<typeof syntheticResearchWeb>;
  };
  if (demo) holderWeb.__prospectorResearchFixtureWeb ??= syntheticResearchWeb();
  return createResearchService({
    research: parts.repo,
    threads: parts.threads,
    webResearch: demo ? holderWeb.__prospectorResearchFixtureWeb! : parts.research.service,
    ...(demo ? { demo: true } : {}),
    lia: parts.lia,
    audit: parts.audit,
    personKey: settings.key ? createPersonKeyHasher(settings.key) : null,
    log: (message) => console.warn(message),
  });
}

/** Peças do trabalhador, montadas uma vez por processo (fora do ciclo de uma requisição). */
function workerParts(): {
  queue: JobQueue;
  wiring: DiscoveryWiring | null;
  strategy: StrategyService;
  companies: CompanyRepository;
  research: ResearchService;
} | null {
  if (storageMode() === 'memory') {
    const stores = memoryStores();
    const web = webResearch(stores.companies, null);
    return {
      queue: stores.discovery.queue,
      wiring: discoveryWiring('memory', stores.discovery, web),
      strategy: createStrategyService({ repo: stores.strategy, ephemeralStorage: true }),
      companies: stores.companies,
      research: copilotResearchService({
        repo: stores.research,
        threads: stores.copilot,
        research: web,
        lia: stores.strategy,
        audit: stores.audit,
      }),
    };
  }
  const credentials = databaseEnv();
  if (!credentials) return null;
  const client = createServerSupabaseClient(credentials.url, credentials.secretKey);
  const companyRepo = createSupabaseCompanyRepository(client);
  const web = webResearch(companyRepo, createSupabaseWebResearchUsage(client));
  const queue = createSupabaseJobQueue(client);
  const strategyRepo = createSupabaseStrategyRepository(client);
  return {
    queue,
    wiring: discoveryWiring(
      'supabase',
      { repository: createSupabaseDiscoveryRepository(client), queue },
      web,
    ),
    strategy: createStrategyService({ repo: strategyRepo }),
    companies: companyRepo,
    research: copilotResearchService({
      repo: createSupabaseResearchRepository(client),
      threads: createSupabaseCopilotRepository(client),
      research: web,
      lia: strategyRepo,
      audit: createSupabaseAuditRepository(client),
    }),
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
    const engine = wiring
      ? createDiscoveryEngine({
          repo: wiring.repo,
          ai: wiring.ai,
          web: wiring.web,
          strategy: parts.strategy,
          companies: parts.companies,
        })
      : null;
    const scheduler = wiring
      ? createDiscoveryScheduler({
          repo: wiring.repo,
          web: wiring.web,
          dailyAutoCredits: discoveryDailyAutoCredits(),
        })
      : null;
    let lastSchedule = 0;
    const worker = createJobWorker({
      queue: parts.queue,
      workerId: `web-${process.pid}-${crypto.randomUUID().slice(0, 8)}`,
      // A pesquisa do Copiloto roda mesmo com a Descoberta desligada (PROSPECTOR_DISCOVERY=off).
      handlers: {
        ...(engine ? { discovery_run: discoveryJobHandler(engine) } : {}),
        copilot_research: parts.research.jobHandler,
      },
      idleMs: 10_000,
      onIdle: async () => {
        if (!scheduler || Date.now() - lastSchedule < SCHEDULER_INTERVAL_MS) return;
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

/**
 * Investigação de empresas (ADR-0015): uma instância por processo, porque a fila (uma
 * investigação por vez), o batimento e o navegador da captura valem para todos os pedidos. Fica
 * em `globalThis` pelo mesmo motivo da IA local. Na criação, execuções sem batimento recente
 * (app fechado no meio) passam a `interrupted` e podem ser retomadas pela tela.
 */
const INVESTIGATIONS_KEY = '__prospectorInvestigations';
type InvestigationsHolder = typeof globalThis & { [INVESTIGATIONS_KEY]?: InvestigationService };

/** Prazo de uma captura (documento, navegador, medições e imagem) por janela. */
const CAPTURE_TIMEOUT_MS = 30_000;

function investigationService(parts: {
  repo: InvestigationRepository;
  companies: CompanyRepository & EvidenceRepository;
  strategy: StrategyRepository;
  research: WebResearchSetup;
  telemetry: AiTelemetryRepository;
}): InvestigationService {
  const holder = globalThis as InvestigationsHolder;
  const existing = holder[INVESTIGATIONS_KEY];
  if (existing) return existing;
  const settings = investigationEnv();
  const log = (message: string) => console.warn(`[investigacao] ${message}`);
  if (settings.capturesDirProblem) log(settings.capturesDirProblem);
  // Navegador próprio da captura: imagens e fontes entram (o do leitor de páginas as bloqueia),
  // sempre pelo cliente seguro (SSRF, sites restritos, robots.txt).
  const capturer = settings.captureEnabled
    ? createBrandCapturer({
        browser: createPlaywrightRenderer({
          log,
          fetchResource: subresourceFetcher({
            resolver: systemResolver,
            timeoutMs: CAPTURE_TIMEOUT_MS,
          }),
        }),
        timeoutMs: CAPTURE_TIMEOUT_MS,
        log,
      })
    : null;
  const companies = companyServices(parts.companies);
  const service = createInvestigationService(
    {
      investigations: parts.repo,
      companies: parts.companies,
      evidence: parts.companies,
      evidenceService: createEvidenceService({ evidence: parts.companies }),
      strategy: parts.strategy,
      webResearch: parts.research.service,
      capturer,
      captureStore: captureStoreFor(settings.capturesDir, log),
      // Mesmo gateway (e mesma fila de inferências) do Copiloto: uma inferência por vez.
      ai: createLocalBrandAnalysisAi({
        gateway: {
          chat: (...args: Parameters<LocalAiGateway['chat']>) =>
            localAiRuntime().gateway.chat(...args),
        },
        log,
      }),
      telemetry: parts.telemetry,
      // CNPJ publicado no site: consultado na Receita e vinculado só se o nome bater (KI-152).
      cnpjFromSite: (...args) => companies.linkCnpjFromSite(...args),
      clock: systemClock,
      newId: () => crypto.randomUUID(),
      log,
    },
    { runnerId: `web-${process.pid}-${crypto.randomUUID().slice(0, 8)}` },
  );
  holder[INVESTIGATIONS_KEY] = service;
  service.recoverInterrupted().then(
    (count) => {
      if (count > 0) log(`${count} investigação(ões) interrompida(s) marcada(s) para retomar.`);
    },
    (error: unknown) =>
      log(`não foi possível recuperar investigações interrompidas: ${String(error)}`),
  );
  return service;
}

/**
 * Retenção das imagens das capturas: a mesma das fontes (12 meses, `REGISTRY_SOURCE_RETENTION_MONTHS`),
 * contada do último uso (uma análise nova que reaproveita a imagem renova o prazo).
 */
const CAPTURE_RETENTION_MONTHS = 12;
const CAPTURE_PURGE_EVERY_MS = 24 * 60 * 60 * 1000;
const CAPTURE_STORE_KEY = Symbol.for('prospector.captureStore');
type CaptureStoreHolder = typeof globalThis & {
  [CAPTURE_STORE_KEY]?: { dir: string; store: CaptureStore };
};

/**
 * Armazenamento das capturas (um por processo e por pasta). Ao abrir, confere leitura e escrita e
 * agenda a limpeza das imagens vencidas: um minuto depois e a cada 24 horas.
 */
function captureStoreFor(dir: string | null, log: (message: string) => void): CaptureStore | null {
  if (!dir) return null;
  const holder = globalThis as CaptureStoreHolder;
  const current = holder[CAPTURE_STORE_KEY];
  if (current && current.dir === dir) return current.store;
  const store = createFileCaptureStore({ dir });
  holder[CAPTURE_STORE_KEY] = { dir, store };
  void store.check().then((health) => {
    if (!health.ok && health.problem) log(`pasta das capturas: ${health.problem}`);
  });
  const purge = () => {
    const before = new Date();
    before.setUTCMonth(before.getUTCMonth() - CAPTURE_RETENTION_MONTHS);
    store.purgeExpired(before).then(
      (count) => {
        if (count > 0) log(`${count} captura(s) com mais de 12 meses sem uso apagada(s).`);
      },
      () => log('não foi possível limpar as capturas vencidas.'),
    );
  };
  setTimeout(purge, 60_000).unref?.();
  setInterval(purge, CAPTURE_PURGE_EVERY_MS).unref?.();
  return store;
}

export interface CaptureStorageStatus {
  /** Captura de tela ligada nesta instalação. */
  captureEnabled: boolean;
  /** null = nenhuma pasta configurada (as imagens não ficam guardadas). */
  health: CaptureStoreHealth | null;
  /** Motivo de uma pasta ter sido recusada (sem o valor), ou null. */
  problem: string | null;
  source: ReturnType<typeof investigationEnv>['capturesDirSource'];
}

/** Estado da pasta das capturas para o painel Sistema (leitura e escrita conferidas agora). */
export async function captureStorageStatus(): Promise<CaptureStorageStatus> {
  const settings = investigationEnv();
  const log = (message: string) => console.warn(`[investigacao] ${message}`);
  const store = captureStoreFor(settings.capturesDir, log);
  return {
    captureEnabled: settings.captureEnabled,
    health: store ? await store.check() : null,
    problem: settings.capturesDirProblem,
    source: settings.capturesDirSource,
  };
}

/**
 * Diagnóstico de Empresas como insumo da abordagem do Relacionamento (KI-129): a investigação mais
 * recente com diagnóstico, com os textos dos claims em vigor lidos do ledger.
 */
function approachInsights(
  investigations: InvestigationService,
  evidence: EvidenceRepository,
): ApproachInsightsSource {
  return createInvestigationInsightsSource({
    investigations,
    evidence,
    clock: systemClock,
    log: (message) => console.warn(`[relacionamento] ${message}`),
  });
}

/**
 * Memória da checagem do banco que dura o processo (os serviços são recriados a cada requisição):
 * com ela, tabelas que já responderam e somem viram "banco reiniciando", não "migrações
 * pendentes" (KI-155).
 */
function databaseHealthMemory(): DatabaseHealthMemory {
  const holder = globalThis as { __prospectorDatabaseHealth?: DatabaseHealthMemory };
  holder.__prospectorDatabaseHealth ??= { seenTables: false };
  return holder.__prospectorDatabaseHealth;
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

/**
 * E-mail (ADR-0016): SMTP, IMAP e DNS de verdade, ou a caixa simulada (só no modo memória). O
 * intervalo entre e-mails de teste vale para o processo inteiro (os serviços são recriados a cada
 * pedido).
 */
function emailService(
  storage: StorageMode,
  repo: EmailSettingsRepository,
  strategy: Pick<StrategyRepository, 'listContactPolicyVersions'>,
  audit: Pick<AuditRepository, 'append'>,
): EmailSettingsService {
  const mode = emailMode();
  if (mode === 'fixture' && storage !== 'memory') {
    throw new Error(
      'PROSPECTOR_EMAIL=fixture só funciona com PROSPECTOR_STORAGE=memory (a caixa simulada nunca usa o banco).',
    );
  }
  const adapters =
    mode === 'fixture'
      ? syntheticEmail()
      : {
          transport: createSmtpTransport({ resolver: systemResolver }),
          reader: createImapReader({ resolver: systemResolver }),
          dns: createDnsTxtLookup(),
          images: createEmailImageFetcher({ resolver: systemResolver }),
        };
  // Um teste por minuto e uma conferência por vez valem para o processo, não para o pedido.
  const holder = globalThis as { __prospectorEmailThrottle?: EmailThrottle };
  holder.__prospectorEmailThrottle ??= newEmailThrottle();
  return createEmailSettingsService({
    repo,
    ...adapters,
    strategy,
    audit,
    throttle: holder.__prospectorEmailThrottle,
  });
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
    const investigations = investigationService({
      repo: memoryInvestigations(stores),
      companies: stores.companies,
      strategy: stores.strategy,
      research,
      telemetry: stores.copilot,
    });
    const relationshipAiSetup = relationshipAi();
    const relationship = createRelationshipService({
      repo: stores.relationship,
      companies,
      strategy,
      ai: relationshipAiSetup.ai,
      insights: approachInsights(investigations, stores.companies),
      telemetry: stores.copilot,
      syntheticAi: relationshipAiSetup.synthetic,
    });
    const memoryParts = {
      companies: stores.companies,
      investigations: memoryInvestigations(stores),
    };
    const monitoring = createMonitoringService({
      repo: createMemoryMonitoringRepository(memoryParts),
      companies,
      investigations,
      discovery,
    });
    const intelligence = createIntelligenceService({
      repo: createMemoryIntelligenceRepository({
        ...memoryParts,
        discovery: discovery ? stores.discovery.repository : null,
        relationship: stores.relationship,
      }),
      telemetry: stores.copilot,
      research: research.service,
    });
    return {
      storage: 'memory',
      system: createSystemService({ check: async () => 'memory' }),
      audit,
      strategy,
      copilot: createCopilotService({ repo: stores.copilot, telemetry: stores.copilot }),
      companies,
      investigations,
      research: research.service,
      tools: createToolRegistry({
        tools: copilotTools(
          strategy,
          audit,
          companies,
          research,
          discovery,
          relationship,
          investigations,
        ),
        telemetry: stores.copilot,
      }),
      discovery,
      relationship,
      email: emailService('memory', stores.email, stores.strategy, stores.audit),
      emailSynthetic: emailMode() === 'fixture',
      monitoring,
      intelligence,
      copilotResearch: copilotResearchService({
        repo: stores.research,
        threads: stores.copilot,
        research,
        lia: stores.strategy,
        audit: stores.audit,
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
      investigations: null,
      research: null,
      tools: null,
      discovery: null,
      relationship: null,
      email: null,
      emailSynthetic: false,
      monitoring: null,
      intelligence: null,
      copilotResearch: null,
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
  const investigations = investigationService({
    repo: createSupabaseInvestigationRepository(client),
    companies: companyRepo,
    strategy: createSupabaseStrategyRepository(client),
    research,
    telemetry: copilotRepo,
  });
  const relationshipAiSetup = relationshipAi();
  const relationship = createRelationshipService({
    repo: createSupabaseRelationshipRepository(client),
    companies,
    strategy,
    ai: relationshipAiSetup.ai,
    insights: approachInsights(investigations, companyRepo),
    telemetry: copilotRepo,
    syntheticAi: relationshipAiSetup.synthetic,
  });
  const monitoring = createMonitoringService({
    repo: createSupabaseMonitoringRepository(client),
    companies,
    investigations,
    discovery,
  });
  const intelligence = createIntelligenceService({
    repo: createSupabaseIntelligenceRepository(client),
    telemetry: copilotRepo,
    research: research.service,
  });
  return {
    storage: 'supabase',
    system: createSystemService(
      createSupabaseDatabaseHealth(client, undefined, undefined, databaseHealthMemory()),
    ),
    audit,
    strategy,
    copilot: createCopilotService({ repo: copilotRepo, telemetry: copilotRepo }),
    companies,
    investigations,
    research: research.service,
    tools: createToolRegistry({
      tools: copilotTools(
        strategy,
        audit,
        companies,
        research,
        discovery,
        relationship,
        investigations,
      ),
      telemetry: copilotRepo,
    }),
    discovery,
    relationship,
    email: emailService(
      'supabase',
      createSupabaseEmailRepository(client),
      createSupabaseStrategyRepository(client),
      createSupabaseAuditRepository(client),
    ),
    emailSynthetic: false,
    monitoring,
    intelligence,
    copilotResearch: copilotResearchService({
      repo: createSupabaseResearchRepository(client),
      threads: copilotRepo,
      research,
      lia: createSupabaseStrategyRepository(client),
      audit: createSupabaseAuditRepository(client),
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
