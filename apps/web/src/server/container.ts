import 'server-only';
import {
  COPILOT_TOOLS_PROMPT_VERSION,
  copilotPromptSupportsInvestigationTools,
  copilotPromptSupportsWebTools,
  createLocalAiRuntime,
  createLocalBrandAnalysisAi,
  createUnavailableLocalAi,
  DEFAULT_OLLAMA_URL,
  isAiError,
  type LocalAiGateway,
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
  createInvestigationService,
  createStrategyService,
  createSystemService,
  createToolRegistry,
  createWebResearchService,
  investigationTools,
  strategyTools,
  systemClock,
  webResearchTools,
  type AiTelemetryRepository,
  type AuditRepository,
  type AuditService,
  type CnpjLookup,
  type CompanyRepository,
  type CompanyService,
  type CopilotRepository,
  type CopilotService,
  type EvidenceRepository,
  type InvestigationRepository,
  type InvestigationService,
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
  createMemoryInvestigationRepository,
  createMemoryStrategyRepository,
  createMemoryWebResearchUsage,
  type MemoryCompanyRepository,
} from '@prospector/application/memory';
import {
  createServerSupabaseClient,
  createSupabaseAuditRepository,
  createSupabaseCompanyRepository,
  createSupabaseCopilotRepository,
  createSupabaseDatabaseHealth,
  createSupabaseInvestigationRepository,
  createSupabaseStrategyRepository,
  createSupabaseWebResearchUsage,
} from '@prospector/db';
import {
  createBrandCapturer,
  createCnpjLookup,
  createFileCaptureStore,
  createPageReader,
  createPlaywrightRenderer,
  createTavilySearch,
  subresourceFetcher,
  systemResolver,
} from '@prospector/integrations';
import { cache } from 'react';
import { syntheticCnpjLookup } from './cnpj-fixture';
import {
  cnpjLookupMode,
  databaseEnv,
  databaseEnvPresent,
  investigationEnv,
  LOCAL_AI_ENV_FORMATS,
  LocalAiConfigError,
  localAiEnv,
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
}

interface MemoryStores {
  audit: AuditRepository;
  strategy: StrategyRepository;
  copilot: CopilotRepository & AiTelemetryRepository;
  companies: MemoryCompanyRepository;
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
 * modelo que nenhuma ferramenta acessa a internet (KI-096).
 */
function copilotTools(
  strategy: StrategyService,
  audit: AuditService,
  companies: CompanyService,
  research: WebResearchSetup,
  investigations: InvestigationService | null,
): ToolDefinition[] {
  const web =
    research.searchOn && copilotPromptSupportsWebTools(COPILOT_TOOLS_PROMPT_VERSION)
      ? webResearchTools({ research: research.service })
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
    ...web,
  ];
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
  const service = createInvestigationService(
    {
      investigations: parts.repo,
      companies: parts.companies,
      evidence: parts.companies,
      evidenceService: createEvidenceService({ evidence: parts.companies }),
      strategy: parts.strategy,
      webResearch: parts.research.service,
      capturer,
      captureStore: settings.capturesDir
        ? createFileCaptureStore({ dir: settings.capturesDir })
        : null,
      // Mesmo gateway (e mesma fila de inferências) do Copiloto: uma inferência por vez.
      ai: createLocalBrandAnalysisAi({
        gateway: {
          chat: (...args: Parameters<LocalAiGateway['chat']>) =>
            localAiRuntime().gateway.chat(...args),
        },
        log,
      }),
      telemetry: parts.telemetry,
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

/** Imagens das capturas para a rota que as serve; null = pasta não configurada. */
export function getCaptureStore(): ReturnType<typeof createFileCaptureStore> | null {
  const settings = investigationEnv();
  return settings.capturesDir ? createFileCaptureStore({ dir: settings.capturesDir }) : null;
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
    const investigations = investigationService({
      repo: memoryInvestigations(stores),
      companies: stores.companies,
      strategy: stores.strategy,
      research,
      telemetry: stores.copilot,
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
        tools: copilotTools(strategy, audit, companies, research, investigations),
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
      investigations: null,
      research: null,
      tools: null,
    };
  }
  const client = createServerSupabaseClient(credentials.url, credentials.secretKey);
  const audit = createAuditService(createSupabaseAuditRepository(client));
  const strategy = createStrategyService({ repo: createSupabaseStrategyRepository(client) });
  const copilotRepo = createSupabaseCopilotRepository(client);
  const companyRepo = createSupabaseCompanyRepository(client);
  const companies = companyServices(companyRepo);
  const research = webResearch(companyRepo, createSupabaseWebResearchUsage(client));
  const investigations = investigationService({
    repo: createSupabaseInvestigationRepository(client),
    companies: companyRepo,
    strategy: createSupabaseStrategyRepository(client),
    research,
    telemetry: copilotRepo,
  });
  return {
    storage: 'supabase',
    system: createSystemService(createSupabaseDatabaseHealth(client)),
    audit,
    strategy,
    copilot: createCopilotService({ repo: copilotRepo, telemetry: copilotRepo }),
    companies,
    investigations,
    research: research.service,
    tools: createToolRegistry({
      tools: copilotTools(strategy, audit, companies, research, investigations),
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
