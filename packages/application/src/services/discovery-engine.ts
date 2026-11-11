import {
  DISCOVERY_MAX_QUERIES,
  DISCOVERY_SNIPPET_MAX,
  SERVICE_HINT_LABELS,
  WebSearchQuery,
  isValidCnpj,
  type CompanyLifecycle,
  type CompanySize,
  type DiscoveryFailure,
  type DiscoveryIntent,
  type DiscoveryPlan,
  type DiscoveryProgress,
  type DiscoveryQuery,
  type DiscoveryQueryResult,
  type DiscoveryRun,
  type DiscoveryRunQuery,
  type ExtractorOutput,
  type IcpProfile,
  type InterpreterOutput,
  type Offer,
  type ProspectSignal,
  type ProspectSourceRelation,
  type ResultKind,
  type ScoringModelVersion,
  type SignalType,
  type UF,
  type WebSearchFailure,
  withoutCpf,
} from '@prospector/contracts';
import {
  assessProspect,
  distinctiveTokens,
  findSameCompany,
  companyNameCore,
  homepageOf,
  hostCategory,
  hostOf,
  looksLikeInstruction,
  nameFoundIn,
  nameMatchesHost,
  normalizeCity,
  normalizeCompanyName,
  normalizeForQuote,
  prospectDedupeKey,
  quoteFoundIn,
  signalConfidence,
  signalFingerprintText,
  signalRecency,
  supportedEventDate,
  signalVerification,
  siteKey,
  stripAccents,
  type DedupeCandidate,
  type HostCategory,
  type MatchReason,
} from '@prospector/domain';
import { calendarDate, systemClock, type Clock } from '../clock';
import type { RequestContext } from '../context';
import { isAppError } from '../errors';
import type { CompanyRepository } from '../ports/company-repository';
import {
  DiscoveryAiError,
  type DiscoveryAi,
  type DiscoveryRepository,
  type NewProspectSignal,
  type NewProspectSource,
  type ProspectPatch,
  type ProspectRecord,
} from '../ports/discovery';
import type { JobHandler } from './job-worker';
import { pendingAudit } from './pending-audit';
import type { StrategyService } from './strategy-service';
import type { WebResearchService } from './web-research-service';

/**
 * Motor da Descoberta (F4, ADR-0013). Roda no trabalhador da fila (ADR-0011), uma pesquisa por
 * vez, em três níveis:
 * 1. descoberta — a IA local entende o pedido e planeja as buscas; o buscador traz resultados;
 *    a IA local identifica empresas e sinais em cada lote (o servidor confere tudo);
 * 2. verificação — lê a página inicial do site oficial (nome confere? CNPJ? cidade?);
 * 3. pré-qualificação — deduplica com o que já foi achado, grava fontes e sinais e faz a triagem
 *    `discovery-triage/v1` (domínio), com motivos e o que falta saber.
 *
 * Retomada: cada busca feita fica gravada com os resultados (`discovery_run_queries`); ao retomar
 * depois de reinício, só as buscas que faltam vão ao buscador. Extração e gravação são
 * idempotentes (chave da empresa, URL da fonte e impressão digital do sinal).
 * Conteúdo da internet é dado, nunca instrução: o modelo só recebe trechos numerados e responde
 * em JSON validado; nome, trecho e site oficial são conferidos no servidor.
 */

export interface DiscoveryEngineDeps {
  repo: DiscoveryRepository;
  ai: DiscoveryAi;
  web: Pick<WebResearchService, 'search' | 'readPage'>;
  strategy: Pick<StrategyService, 'overview'>;
  companies: Pick<CompanyRepository, 'findByStrongIdentifier'>;
  clock?: Clock;
  newId?: () => string;
  log?: (message: string) => void;
}

export type EngineOutcome =
  | { kind: 'finished'; status: 'completed' | 'failed' | 'cancelled' }
  | { kind: 'retry'; errorCode: string; retryAfterSeconds: number };

export interface ExecuteOptions {
  signal: AbortSignal;
  /** Última tentativa da tarefa: falha passageira vira falha da pesquisa, sem nova espera. */
  lastAttempt: boolean;
  /** Número da tentativa (1…), para a espera crescer. */
  attempt: number;
}

export interface DiscoveryEngine {
  execute(runId: string, options: ExecuteOptions): Promise<EngineOutcome>;
  /** A tarefa caiu sem tentativas sobrando (ou foi cancelada antes de rodar). */
  abandon(runId: string, cancelled: boolean): Promise<void>;
}

/**
 * A Descoberta como tarefa da fila (ADR-0011): `discovery_run` com `{ runId }` no payload. A
 * última tentativa transforma falha passageira em falha da pesquisa (sem nova espera).
 */
export function discoveryJobHandler(engine: DiscoveryEngine): JobHandler {
  return {
    async run(job, signal) {
      const outcome = await engine.execute(String(job.payload.runId), {
        signal,
        lastAttempt: job.attempts >= job.maxAttempts,
        attempt: job.attempts,
      });
      if (outcome.kind === 'retry') {
        return {
          status: 'retry',
          errorCode: outcome.errorCode,
          retryAfterSeconds: outcome.retryAfterSeconds,
        };
      }
      return outcome.status === 'completed'
        ? { status: 'succeeded' }
        : { status: outcome.status, errorCode: null };
    },
    abandon: (job) => engine.abandon(String(job.payload.runId), job.status === 'cancelled'),
  };
}

/** Quantos resultados cada busca pede ao buscador, por profundidade. */
const RESULTS_PER_SEARCH = { quick: 6, standard: 8, deep: 10 } as const;
/** Quantidade padrão quando o pedido não diz quantas empresas. */
const DEFAULT_QUANTITY = { quick: 10, standard: 15, deep: 25 } as const;
/** Resultados por chamada do extrator (cabe no contexto de 8k do modelo local). */
const EXTRACT_BATCH = 8;
const RETENTION_MONTHS = 12;
const MIN_QUOTE_CHARS = 12;

/** Palavras que puxam cada tipo de sinal nas buscas montadas pelo servidor. */
const SIGNAL_QUERY_TERMS: Record<SignalType, string> = {
  expansion: 'inaugura nova unidade expansão',
  hiring: 'vaga marketing',
  launch: 'lança lançamento',
  strategic_change: 'nova fase reposicionamento',
  investment: 'investimento ampliação',
  brand_communication: 'nova marca novo site',
};

const RETRYABLE_AI: ReadonlySet<string> = new Set(['busy', 'insufficient_vram', 'timeout']);

class Cancelled extends Error {
  constructor() {
    super('cancelled');
  }
}

class StopRun extends Error {
  constructor(readonly failure: DiscoveryFailure) {
    super(failure);
  }
}

interface StrategyContext {
  icp: IcpProfile | null;
  offer: Offer | null;
  scoring: ScoringModelVersion | null;
}

interface CandidateSource {
  url: string;
  host: string;
  title: string | null;
  snippet: string;
  kind: 'search_result' | 'web_page';
  relation: ProspectSourceRelation;
  provider: string;
  publishedAt: string | null;
}

interface CandidateSignal {
  url: string;
  type: SignalType;
  summary: string;
  quote: string;
  eventDate: string | null;
  publishedAt: string | null;
  verification: ProspectSignal['verification'];
  confidence: number;
  relevance: ProspectSignal['relevance'];
  relatedService: ProspectSignal['relatedService'];
  rationale: string;
  recency: ProspectSignal['recency'];
}

interface Candidate {
  name: string;
  siteKey: string | null;
  websiteUrl: string | null;
  city: string | null;
  uf: UF | null;
  segment: string | null;
  description: string | null;
  cnpj: string | null;
  siteVerified: boolean;
  sources: Map<string, CandidateSource>;
  signals: CandidateSignal[];
}

interface SearchResultRow extends DiscoveryQueryResult {
  host: string;
  hostKind: HostCategory | null;
}

// -----------------------------------------------------------------------------
// Auxiliares de texto
// -----------------------------------------------------------------------------

function comparable(text: string): string {
  return stripAccents(text)
    .toLowerCase()
    .replace(/[“”"'‘’`´]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * O trecho que o modelo citou está mesmo no texto da fonte? Mesma regra do Evidence Ledger
 * (acento, aspas, travessão, caixa e espaços não contam; o resto precisa ser igual).
 */
export function signalQuoteFound(quote: string, text: string): boolean {
  return normalizeForQuote(quote).length >= MIN_QUOTE_CHARS && quoteFoundIn(quote, text);
}

/**
 * Janela do texto com o trecho citado dentro (a fonte guarda só 300 caracteres e o trecho precisa
 * caber nela para ser evidência depois, no módulo Empresas).
 */
export function excerptAround(text: string, quote: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= max) return flat;
  let normalized = '';
  const origin: number[] = [];
  for (let index = 0; index < flat.length; index += 1) {
    const piece = normalizeForQuote(flat[index] ?? '') || (flat[index] === ' ' ? ' ' : '');
    for (const char of piece) {
      normalized += char;
      origin.push(index);
    }
  }
  const wanted = normalizeForQuote(quote);
  const at = normalized.indexOf(wanted);
  if (at < 0 || wanted.length === 0) return flat.slice(0, max);
  const start = origin[at] ?? 0;
  const end = (origin[at + wanted.length - 1] ?? start) + 1;
  const room = Math.max(0, max - (end - start));
  const from = Math.max(0, Math.min(start - Math.floor(room / 2), flat.length - max));
  return flat.slice(from, from + max);
}

function cityIn(city: string, text: string): boolean {
  const needle = normalizeCity(city);
  return needle.length >= 3 && ` ${comparable(text)} `.includes(` ${needle} `);
}

function ufIn(uf: string, text: string): boolean {
  return new RegExp(`(^|[^A-Za-z])${uf}([^A-Za-z]|$)`).test(text);
}

const STATE_NAMES: Record<UF, string> = {
  AC: 'Acre',
  AL: 'Alagoas',
  AP: 'Amapá',
  AM: 'Amazonas',
  BA: 'Bahia',
  CE: 'Ceará',
  DF: 'Distrito Federal',
  ES: 'Espírito Santo',
  GO: 'Goiás',
  MA: 'Maranhão',
  MT: 'Mato Grosso',
  MS: 'Mato Grosso do Sul',
  MG: 'Minas Gerais',
  PA: 'Pará',
  PB: 'Paraíba',
  PR: 'Paraná',
  PE: 'Pernambuco',
  PI: 'Piauí',
  RJ: 'Rio de Janeiro',
  RN: 'Rio Grande do Norte',
  RS: 'Rio Grande do Sul',
  RO: 'Rondônia',
  RR: 'Roraima',
  SC: 'Santa Catarina',
  SP: 'São Paulo',
  SE: 'Sergipe',
  TO: 'Tocantins',
};

/** O texto cita o estado pelo nome ("interior de São Paulo", "em Minas Gerais")? */
function stateNameIn(uf: UF, text: string): boolean {
  return cityIn(STATE_NAMES[uf], text);
}

function clean(text: string | null | undefined, max: number): string | null {
  if (!text) return null;
  const value = text.replace(/\s+/g, ' ').trim();
  return value ? value.slice(0, max) : null;
}

function unique<T>(items: readonly T[]): T[] {
  return [...new Set(items)];
}

function dateOnly(value: string | null): string | null {
  return value && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : null;
}

const CNPJ_IN_TEXT = /\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g;

/** Primeiro CNPJ válido (dígitos conferem) no texto da página. */
export function cnpjInText(text: string): string | null {
  for (const match of text.matchAll(CNPJ_IN_TEXT)) {
    const digits = match[0].replace(/\D/g, '');
    if (isValidCnpj(digits)) return digits;
  }
  return null;
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function addMonths(date: Date, months: number): Date {
  const result = new Date(date.getTime());
  result.setUTCMonth(result.getUTCMonth() + months);
  return result;
}

function relationFor(
  category: HostCategory | null,
  kind: ResultKind | undefined,
): ProspectSourceRelation {
  switch (category) {
    case 'news':
      return 'news';
    case 'job_board':
      return 'job_post';
    case 'directory':
    case 'marketplace':
      return 'directory';
    case 'social':
    case 'government':
    case 'reference':
      return 'mention';
    default:
      if (kind === 'news') return 'news';
      if (kind === 'job_post') return 'job_post';
      if (kind === 'directory') return 'directory';
      return 'mention';
  }
}

// -----------------------------------------------------------------------------
// Interpretação e plano
// -----------------------------------------------------------------------------

export function regionLabel(intent: Pick<DiscoveryIntent, 'region'>): string {
  const { cities, ufs } = intent.region;
  if (cities.length > 0) return `${cities.join(', ')}${ufs.length === 1 ? ` (${ufs[0]})` : ''}`;
  if (ufs.length > 0) return ufs.join(', ');
  return 'Brasil';
}

export function buildIntent(
  run: Pick<DiscoveryRun, 'request' | 'options' | 'limits'>,
  output: InterpreterOutput,
): DiscoveryIntent {
  const options = run.options;
  const depth = options.depth ?? 'standard';
  const defaults: string[] = [];
  // O modelo só propõe: cidade que não está no pedido é descartada (ele às vezes inventa a região),
  // e a UF dele só fica se estiver no pedido ou acompanhar uma cidade que está.
  const cities = options.city
    ? [options.city]
    : output.cities.filter((city) => cityIn(city, run.request)).slice(0, 10);
  const modelUfs = output.ufs.filter(
    (uf) => ufIn(uf, run.request) || stateNameIn(uf, run.request) || cities.length > 0,
  );
  const ufs = unique([...(options.uf ? [options.uf] : []), ...modelUfs]).slice(0, 5);
  let scope = output.regionScope;
  if (options.city || (cities.length > 0 && (scope === 'unspecified' || scope === 'country'))) {
    scope = 'city';
  } else if (cities.length === 0 && ufs.length > 0 && scope !== 'region') scope = 'state';
  if (cities.length === 0 && ufs.length === 0) {
    scope = 'country';
    defaults.push('Região: o pedido não cita cidade nem estado; a busca vale para o Brasil.');
  }
  const asked = options.quantity ?? output.quantity;
  const quantity = Math.max(1, Math.min(asked ?? DEFAULT_QUANTITY[depth], run.limits.maxProspects));
  if (asked === null) defaults.push(`Quantidade: até ${quantity} empresas (padrão).`);
  else if (asked > run.limits.maxProspects) {
    defaults.push(`Quantidade: até ${quantity} empresas (limite desta profundidade).`);
  }
  if (!options.depth) defaults.push('Profundidade: padrão.');
  const signals = unique([...options.signals, ...output.signals]).slice(0, 6);
  const segment = output.segment;
  const intent: DiscoveryIntent = {
    summary: '',
    segment,
    segmentTerms: output.segmentTerms.length > 0 ? output.segmentTerms : segment ? [segment] : [],
    region: { scope, cities, ufs, label: null },
    sizeHint: output.sizeHint,
    services: output.services,
    signals,
    quantity,
    depth,
    constraints: output.constraints,
    defaultsApplied: defaults.slice(0, 8),
  };
  intent.region.label = regionLabel(intent).slice(0, 120);
  intent.summary = (
    output.summary ??
    `Empresas${segment ? ` de ${segment}` : ''} em ${intent.region.label}${
      signals.length > 0 ? ', com sinais comerciais' : ''
    }.`
  ).slice(0, 300);
  return intent;
}

/** Chave para não repetir busca: sem acento, caixa, pontuação nem plural simples. */
function queryKey(text: string): string {
  return comparable(text)
    .split(' ')
    .filter((word) => !['de', 'da', 'do', 'das', 'dos', 'em', 'e'].includes(word))
    .map((word) => (word.length > 3 ? word.replace(/s$/, '') : word))
    .join(' ');
}

function queryText(text: string): string | null {
  const value = text
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300);
  return WebSearchQuery.safeParse(value).success ? value : null;
}

/** Plano de buscas: o do modelo, conferido e completado pelo servidor, dentro do limite. */
export function buildPlan(
  request: string,
  output: InterpreterOutput,
  intent: DiscoveryIntent,
  maxSearches: number,
): DiscoveryPlan {
  const queries: DiscoveryQuery[] = [];
  const seen = new Set<string>();
  const add = (
    text: string,
    purpose: DiscoveryQuery['purpose'],
    signal: SignalType | null,
    recent: boolean,
  ) => {
    const value = queryText(text);
    if (!value) return;
    const key = queryKey(value);
    if (seen.has(key)) return;
    seen.add(key);
    queries.push({
      text: value,
      purpose,
      signal,
      topic: purpose === 'signals' && signal !== 'hiring' ? 'news' : 'general',
      timeRange: recent || purpose === 'signals' ? 'year' : null,
    });
  };
  for (const query of output.queries) {
    add(
      query.text,
      query.purpose,
      query.purpose === 'signals' ? (query.signal ?? null) : null,
      query.recent,
    );
  }
  const subject = intent.segment ?? intent.segmentTerms[0] ?? request.slice(0, 120);
  const where = intent.region.cities[0] ?? intent.region.ufs[0] ?? '';
  if (!queries.some((query) => query.purpose === 'companies')) {
    add(`${subject} ${where}`.trim(), 'companies', null, false);
  }
  for (const signal of intent.signals) {
    if (!queries.some((query) => query.signal === signal)) {
      add(`${subject} ${SIGNAL_QUERY_TERMS[signal]} ${where}`.trim(), 'signals', signal, true);
    }
  }
  if (queries.length === 0) add(request, 'companies', null, false);
  // Poucas buscas de empresas para a quantidade pedida: completa com variações (outras cidades da
  // região, outros termos do setor). Achado da pesquisa real de 2026-11-11 (KI-117): a IA propôs
  // uma busca só para 15 empresas, e sobraram 2 das 3 buscas da profundidade rápida.
  const wanted = Math.ceil(intent.quantity / Math.max(1, RESULTS_PER_SEARCH[intent.depth] - 1));
  const subjectWords = new Set(queryKey(subject).split(' '));
  const variations = [
    ...intent.region.cities.slice(1).map((city) => `${subject} ${city}`),
    ...(intent.region.cities.length === 0
      ? intent.region.ufs.slice(1).map((uf) => `${subject} ${uf}`)
      : []),
    // Termo que só repete palavras do setor ("clínica de saúde" para "clínicas de saúde",
    // "saúde") não traz empresas novas.
    ...intent.segmentTerms
      .filter((term) =>
        queryKey(term)
          .split(' ')
          .some((word) => !subjectWords.has(word)),
      )
      .map((term) => `${term} ${where}`.trim()),
  ];
  for (const variation of variations) {
    if (queries.filter((query) => query.purpose === 'companies').length >= wanted) break;
    add(variation, 'companies', null, false);
  }
  // Empresas primeiro, depois um sinal de cada tipo, até o limite.
  const ordered = [
    ...queries.filter((query) => query.purpose === 'companies').slice(0, 1),
    ...queries.filter((query) => query.purpose === 'signals'),
    ...queries.filter((query) => query.purpose === 'companies').slice(1),
  ];
  return { queries: ordered.slice(0, Math.min(maxSearches, DISCOVERY_MAX_QUERIES)) };
}

// -----------------------------------------------------------------------------
// Motor
// -----------------------------------------------------------------------------

export function createDiscoveryEngine(deps: DiscoveryEngineDeps): DiscoveryEngine {
  const { repo, ai, web } = deps;
  const clock = deps.clock ?? systemClock;
  const log = deps.log ?? ((message: string) => console.warn(message));
  const nowIso = () => clock.now().toISOString();

  async function loadStrategy(ctx: RequestContext, run: DiscoveryRun): Promise<StrategyContext> {
    try {
      const { snapshot } = await deps.strategy.overview(ctx);
      const icp =
        (run.options.icpId
          ? snapshot.icps.find((item) => item.id === run.options.icpId)
          : snapshot.icps.find((item) => item.status === 'active' && item.current !== null)) ??
        null;
      const offer =
        (icp
          ? snapshot.offers.find((item) => item.id === icp.offerId)
          : snapshot.offers.find((item) => item.status === 'active')) ?? null;
      const scoring = offer
        ? (snapshot.scoringModels.find((item) => item.offerId === offer.id) ?? null)
        : null;
      return { icp, offer, scoring };
    } catch (error) {
      // Estratégia é opcional para pesquisar: sem ela, a triagem usa só o pedido.
      log(`[descoberta] estratégia indisponível para a triagem: ${String(error)}`);
      return { icp: null, offer: null, scoring: null };
    }
  }

  async function finish(
    run: DiscoveryRun,
    status: 'completed' | 'failed' | 'cancelled',
    patch: {
      progress?: DiscoveryProgress;
      partial?: boolean;
      failureCode?: DiscoveryFailure | null;
    },
  ): Promise<EngineOutcome> {
    await repo.updateRun(run.id, {
      status,
      stage: status === 'completed' ? 'done' : run.stage,
      finishedAt: nowIso(),
      ...(patch.progress ? { progress: patch.progress } : {}),
      partial: patch.partial ?? false,
      failureCode: patch.failureCode ?? null,
    });
    return { kind: 'finished', status };
  }

  async function execute(runId: string, options: ExecuteOptions): Promise<EngineOutcome> {
    const loaded = await repo.getRun(runId);
    if (!loaded) return { kind: 'finished', status: 'failed' };
    if (
      loaded.status === 'completed' ||
      loaded.status === 'failed' ||
      loaded.status === 'cancelled'
    ) {
      return { kind: 'finished', status: loaded.status };
    }
    if (loaded.status === 'draft') return { kind: 'finished', status: 'cancelled' };
    let run: DiscoveryRun = loaded;
    const progress: DiscoveryProgress = { ...run.progress };
    if (run.cancelRequestedAt) return finish(run, 'cancelled', { progress, partial: false });

    const ctx: RequestContext = {
      actor: { type: 'system', component: 'discovery-worker' },
      traceId: run.traceId,
    };
    const now = clock.now();
    const today = calendarDate(now);
    const retentionUntil = addMonths(now, RETENTION_MONTHS).toISOString();
    let stopFailure: DiscoveryFailure | null = null;

    const checkCancel = async () => {
      if (options.signal.aborted) throw new Cancelled();
      const fresh = await repo.getRun(run.id);
      if (!fresh || fresh.cancelRequestedAt) throw new Cancelled();
    };
    const setStage = async (stage: DiscoveryRun['stage']) => {
      run = { ...run, stage };
      await repo.updateRun(run.id, { stage, progress });
    };

    await repo.updateRun(run.id, {
      status: 'running',
      startedAt: run.startedAt ?? nowIso(),
      stage: run.stage ?? 'interpreting',
    });
    run = { ...run, status: 'running', stage: run.stage ?? 'interpreting' };

    try {
      const strategy = await loadStrategy(ctx, run);

      // 1. Entender o pedido e planejar (só na primeira vez; ao retomar, reaproveita).
      let intent = run.intent;
      let plan = run.plan;
      if (!intent || !plan) {
        const icpContent = strategy.icp?.current?.content ?? null;
        const output = await ai.interpret(
          {
            request: run.request,
            options: run.options,
            today,
            context: {
              offer: strategy.offer?.current?.content.name ?? null,
              icpRegions: icpContent
                ? [
                    ...icpContent.filters.municipalities.map((item) => `${item.name}/${item.uf}`),
                    ...icpContent.filters.ufs,
                  ].slice(0, 10)
                : [],
              services: Object.values(SERVICE_HINT_LABELS),
            },
          },
          options.signal,
        );
        intent = buildIntent(run, output);
        plan = buildPlan(run.request, output, intent, run.limits.maxSearches);
        progress.searchesPlanned = plan.queries.length;
        await repo.updateRun(run.id, {
          intent,
          plan,
          progress,
          stage: 'searching',
          promptIds: [ai.promptIds.interpreter, ai.promptIds.extractor],
          icpId: strategy.icp?.id ?? null,
          icpVersionId: strategy.icp?.current?.id ?? null,
          offerId: strategy.offer?.id ?? null,
          scoringModelVersionId: strategy.scoring?.id ?? null,
        });
        run = { ...run, intent, plan, stage: 'searching' };
      }
      await checkCancel();

      // 2. Buscar (cada busca feita fica gravada: retomada não gasta crédito de novo).
      const stored = new Map((await repo.listQueries(run.id)).map((row) => [row.position, row]));
      const perSearch = RESULTS_PER_SEARCH[intent.depth];
      let transientFailures = 0;
      for (const [position, query] of plan.queries.entries()) {
        if (stored.get(position)?.status === 'done') continue;
        await checkCancel();
        const outcome = await web.search(ctx, {
          query: query.text,
          maxResults: perSearch,
          topic: query.topic,
          timeRange: query.timeRange,
          region: 'br',
        });
        const fetchedAt = nowIso();
        if (outcome.ok) {
          const row: DiscoveryRunQuery = {
            runId: run.id,
            position,
            query,
            status: 'done',
            results: outcome.results.slice(0, 10).map((result) => ({
              rank: result.rank,
              url: result.url,
              title: result.title.slice(0, 300),
              snippet: result.snippet.slice(0, 600),
              publishedAt: dateOnly(result.publishedAt),
            })),
            creditsCharged: outcome.creditsCharged,
            fetchedAt,
            failure: null,
          };
          await repo.saveQuery({ ...row, retentionUntil });
          stored.set(position, row);
          progress.creditsUsed += outcome.creditsCharged;
        } else {
          const failure = outcome.failure;
          await repo.saveQuery({
            runId: run.id,
            position,
            query,
            status: 'failed',
            results: [],
            creditsCharged: 0,
            fetchedAt,
            failure,
            retentionUntil,
          });
          const stop = stopFor(failure);
          if (stop) {
            stopFailure = stop;
            break;
          }
          transientFailures += 1;
        }
        progress.searchesDone = [...stored.values()].filter((row) => row.status === 'done').length;
        await repo.updateRun(run.id, { progress });
      }
      const doneQueries = [...stored.values()].filter((row) => row.status === 'done');
      progress.searchesDone = doneQueries.length;
      if (doneQueries.length === 0) {
        if (stopFailure) throw new StopRun(stopFailure);
        if (transientFailures > 0 && !options.lastAttempt) {
          return requeue(run, progress, 'search_unavailable', options);
        }
        throw new StopRun('search_unavailable');
      }
      if (transientFailures > 0) stopFailure ??= 'search_unavailable';

      // 3. Identificar empresas e sinais nos resultados (IA local, conferida no servidor).
      const results = collectResults(doneQueries);
      const candidates: Candidate[] = [];
      for (let start = 0; start < results.length; start += EXTRACT_BATCH) {
        await checkCancel();
        const batch = results.slice(start, start + EXTRACT_BATCH);
        const output = await ai.extract(
          {
            intent,
            today,
            results: batch.map((result, index) => ({
              n: index + 1,
              url: result.url,
              host: result.host,
              hostKind: result.hostKind,
              title: result.title,
              snippet: result.snippet,
              publishedAt: result.publishedAt,
            })),
          },
          options.signal,
        );
        absorb(candidates, batch, output, intent.region, clock.now());
      }

      // 4. Conferir sites oficiais (nível 2), começando pelas mais promissoras.
      await setStage('verifying');
      rank(candidates, intent);
      let pages = 0;
      for (const candidate of candidates) {
        if (pages >= run.limits.maxPages) break;
        if (!candidate.websiteUrl) continue;
        await checkCancel();
        pages += 1;
        progress.pagesRead += 1;
        await verifySite(ctx, candidate, intent);
      }
      await repo.updateRun(run.id, { progress });

      // 5. Deduplicar, gravar e fazer a triagem, uma empresa por vez (progresso parcial salvo).
      await setStage('qualifying');
      rank(candidates, intent);
      const selected = candidates.slice(0, intent.quantity);
      for (const [index, candidate] of selected.entries()) {
        await checkCancel();
        const saved = await persist(
          ctx,
          run,
          candidate,
          index + 1,
          strategy,
          intent,
          retentionUntil,
        );
        progress.prospects += saved.counted ? 1 : 0;
        progress.newProspects += saved.isNew ? 1 : 0;
        progress.signals += saved.signals;
        await repo.updateRun(run.id, { progress });
      }
      const partial = stopFailure !== null;
      return await finish(run, 'completed', { progress, partial, failureCode: stopFailure });
    } catch (error) {
      if (
        error instanceof Cancelled ||
        (options.signal.aborted && error instanceof DiscoveryAiError)
      ) {
        const fresh = await repo.getRun(run.id);
        if (fresh && !fresh.cancelRequestedAt && options.signal.aborted) {
          // O trabalhador perdeu o lease (não foi cancelamento): quem pegou a tarefa continua.
          return { kind: 'retry', errorCode: 'lease_lost', retryAfterSeconds: 5 };
        }
        return finish(run, 'cancelled', {
          progress,
          partial: progress.searchesDone > 0 || progress.prospects > 0,
        });
      }
      if (error instanceof StopRun) {
        return finish(run, 'failed', {
          progress,
          partial: progress.prospects > 0,
          failureCode: error.failure,
        });
      }
      if (error instanceof DiscoveryAiError) {
        if (RETRYABLE_AI.has(error.code) && !options.lastAttempt) {
          return requeue(run, progress, `ai_${error.code}`, options);
        }
        const failure: DiscoveryFailure =
          error.code === 'runtime_unavailable' ||
          error.code === 'model_not_installed' ||
          error.code === 'invalid_config'
            ? 'ai_unavailable'
            : 'ai_failed';
        return finish(run, 'failed', {
          progress,
          partial: progress.prospects > 0,
          failureCode: failure,
        });
      }
      if (isAppError(error) && error.code === 'unavailable') {
        try {
          if (!options.lastAttempt)
            return await requeue(run, progress, 'database_unavailable', options);
          return await finish(run, 'failed', {
            progress,
            partial: progress.prospects > 0,
            failureCode: 'database_unavailable',
          });
        } catch {
          // Banco fora: a tarefa volta para a fila pelo lease vencido.
          return { kind: 'retry', errorCode: 'database_unavailable', retryAfterSeconds: 60 };
        }
      }
      log(
        `[descoberta] falha inesperada na pesquisa ${run.id} (trace ${run.traceId}): ${String(error)}`,
      );
      return finish(run, 'failed', {
        progress,
        partial: progress.prospects > 0,
        failureCode: 'unexpected',
      });
    }
  }

  async function requeue(
    run: DiscoveryRun,
    progress: DiscoveryProgress,
    errorCode: string,
    options: ExecuteOptions,
  ): Promise<EngineOutcome> {
    await repo.updateRun(run.id, { status: 'queued', progress });
    return {
      kind: 'retry',
      errorCode: errorCode.slice(0, 60),
      retryAfterSeconds: Math.min(600, 30 * 2 ** Math.max(0, options.attempt - 1)),
    };
  }

  function stopFor(failure: WebSearchFailure): DiscoveryFailure | null {
    switch (failure) {
      case 'not_configured':
        return 'search_not_configured';
      case 'disabled':
        return 'search_disabled';
      case 'budget_exhausted':
        return 'budget_exhausted';
      case 'quota_exceeded':
        return 'quota_exceeded';
      case 'unauthorized':
        return 'search_unavailable';
      default:
        return null;
    }
  }

  function collectResults(queries: readonly DiscoveryRunQuery[]): SearchResultRow[] {
    const seen = new Set<string>();
    const rows: SearchResultRow[] = [];
    for (const query of [...queries].sort((a, b) => a.position - b.position)) {
      for (const result of query.results) {
        const host = hostOf(result.url);
        if (!host || seen.has(result.url)) continue;
        seen.add(result.url);
        // Texto que tenta dar ordens ao modelo não é fonte: nem chega ao extrator.
        if (looksLikeInstruction(`${result.title} ${result.snippet}`)) continue;
        rows.push({ ...result, host, hostKind: hostCategory(host) });
      }
    }
    return rows;
  }

  async function verifySite(
    ctx: RequestContext,
    candidate: Candidate,
    intent: DiscoveryIntent,
  ): Promise<void> {
    if (!candidate.websiteUrl) return;
    const outcome = await web.readPage(ctx, { url: candidate.websiteUrl });
    if (!outcome.ok) return;
    const page = outcome.page;
    const text = `${page.title ?? ''} ${page.description ?? ''} ${page.text}`;
    if (!nameFoundIn(candidate.name, text)) return;
    candidate.siteVerified = true;
    const host = hostOf(page.url) ?? hostOf(candidate.websiteUrl) ?? '';
    candidate.sources.set(page.url, {
      url: page.url,
      host,
      title: clean(page.title, 300),
      snippet: page.noArchive
        ? ''
        : (clean(page.description ?? page.text, DISCOVERY_SNIPPET_MAX) ?? ''),
      kind: 'web_page',
      relation: 'official_site',
      provider: 'prospector',
      publishedAt: null,
    });
    candidate.cnpj ??= cnpjInText(page.text);
    if (!candidate.city) {
      const city = intent.region.cities.find((item) => cityIn(item, text));
      if (city) {
        candidate.city = city;
        candidate.uf ??= intent.region.ufs.length === 1 ? (intent.region.ufs[0] ?? null) : null;
      }
    }
  }

  async function companyLink(candidate: Candidate): Promise<{
    id: string;
    lifecycle: CompanyLifecycle;
    sizeBand: CompanySize | null;
  } | null> {
    const keys: Array<{ kind: 'domain' | 'cnpj'; value: string }> = [];
    if (candidate.siteKey && !candidate.siteKey.includes('/'))
      keys.push({ kind: 'domain', value: candidate.siteKey });
    if (candidate.cnpj) keys.push({ kind: 'cnpj', value: candidate.cnpj });
    if (keys.length === 0) return null;
    const company = await deps.companies.findByStrongIdentifier(keys);
    return company
      ? { id: company.id, lifecycle: company.lifecycle, sizeBand: company.sizeBand }
      : null;
  }

  async function persist(
    ctx: RequestContext,
    run: DiscoveryRun,
    candidate: Candidate,
    position: number,
    strategy: StrategyContext,
    intent: DiscoveryIntent,
    retentionUntil: string,
  ): Promise<{ isNew: boolean; counted: boolean; signals: number }> {
    const now = nowIso();
    const dedupe: DedupeCandidate = {
      name: candidate.name,
      siteKey: candidate.siteKey,
      city: candidate.city,
      uf: candidate.uf,
      cnpj: candidate.cnpj,
    };
    const dedupeKey = prospectDedupeKey(dedupe);
    // Chave de busca pelo nome: o núcleo (sem cidade no fim nem segmento no começo), para achar o
    // mesmo nome escrito de outro jeito; as gravadas antes (nome normalizado inteiro) também valem.
    const nameKey =
      companyNameCore(candidate.name, [candidate.city, candidate.uf]).slice(0, 160) ||
      dedupeKey.slice(0, 160);
    const fullNameKey = normalizeCompanyName(candidate.name).slice(0, 160);
    const domain = candidate.siteKey;
    const known = await repo.findProspects({
      dedupeKeys: [dedupeKey],
      domains: domain ? [domain] : [],
      cnpjRoots: candidate.cnpj ? [candidate.cnpj.slice(0, 8)] : [],
      nameKeys: unique([nameKey, fullNameKey].filter(Boolean)),
    });
    const match = findSameCompany(
      dedupe,
      known.map((item) => ({
        id: item.id,
        name: item.displayName,
        siteKey: item.domain,
        city: item.city,
        uf: item.uf,
        cnpj: item.cnpj,
      })),
    );
    const link = await companyLink(candidate);

    let prospect: ProspectRecord;
    let isNew = false;
    let matchedBy: MatchReason | null = null;
    const existing = match ? known.find((item) => item.id === match.target.id) : undefined;
    if (existing && match) {
      matchedBy = match.reason;
      prospect = existing;
      const sitePatch: ProspectPatch =
        !existing.domain && domain && dedupeKey.startsWith('domain:')
          ? { domain, websiteUrl: candidate.websiteUrl, dedupeKey }
          : {};
      const patch: ProspectPatch = {
        lastSeenAt: now,
        lastRunId: run.id,
        ...(!existing.city && candidate.city ? { city: candidate.city } : {}),
        ...(!existing.uf && candidate.uf ? { uf: candidate.uf } : {}),
        ...(!existing.segment && candidate.segment ? { segment: candidate.segment } : {}),
        ...(!existing.description && candidate.description
          ? { description: candidate.description }
          : {}),
        ...(!existing.cnpj && candidate.cnpj ? { cnpj: candidate.cnpj } : {}),
        ...(candidate.siteVerified ? { siteVerified: true, lastVerifiedAt: now } : {}),
      };
      let applied: ProspectPatch = { ...patch, ...sitePatch };
      try {
        await repo.updateProspect(existing.id, applied);
      } catch (error) {
        // Outra empresa já tem a chave do site: mantém a chave antiga.
        if (!(isAppError(error) && error.code === 'conflict') || !sitePatch.dedupeKey) throw error;
        applied = patch;
        await repo.updateProspect(existing.id, applied);
      }
      prospect = { ...existing, ...applied };
      if (link && !existing.companyId) {
        await repo.setProspectStatus(
          existing.id,
          {
            status: existing.status,
            dismissedReason: existing.dismissedReason,
            companyId: link.id,
          },
          pendingAudit(ctx, {
            action: 'discovery.prospect.company_linked',
            entityType: 'discovery_prospect',
            entityId: existing.id,
            diff: { companyId: link.id },
          }),
        );
        prospect = { ...prospect, companyId: link.id };
      }
    } else {
      isNew = true;
      try {
        prospect = await repo.insertProspect({
          id: deps.newId?.() ?? crypto.randomUUID(),
          dedupeKey,
          nameKey,
          displayName: candidate.name.slice(0, 160),
          domain,
          websiteUrl: candidate.websiteUrl,
          segment: candidate.segment,
          city: candidate.city,
          uf: candidate.uf,
          description: candidate.description,
          cnpj: candidate.cnpj,
          companyId: link?.id ?? null,
          status: 'new',
          dismissedReason: null,
          priority: 'insufficient',
          priorityScore: null,
          confidence: 'low',
          assessment: null,
          siteVerified: candidate.siteVerified,
          firstSeenAt: now,
          lastSeenAt: now,
          lastVerifiedAt: candidate.siteVerified ? now : null,
          firstRunId: run.id,
          lastRunId: run.id,
          isDemo: run.isDemo,
        });
      } catch (error) {
        if (!(isAppError(error) && error.code === 'conflict')) throw error;
        // Corrida com outra gravação da mesma chave: usa a que ficou.
        const [again] = await repo.findProspects({
          dedupeKeys: [dedupeKey],
          domains: [],
          cnpjRoots: [],
          nameKeys: [],
        });
        if (!again) throw error;
        prospect = again;
        isNew = false;
      }
    }

    await repo.linkRunProspect({
      runId: run.id,
      prospectId: prospect.id,
      isNew,
      matchedBy,
      position,
    });

    const sources = await repo.upsertSources(
      [...candidate.sources.values()].map((source): NewProspectSource => ({
        prospectId: prospect.id,
        runId: run.id,
        url: source.url,
        host: source.host,
        title: source.title,
        snippet: source.snippet,
        kind: source.kind,
        relation: source.relation,
        provider: source.provider,
        publishedAt: source.publishedAt,
        capturedAt: now,
        retentionUntil,
      })),
    );
    const sourceByUrl = new Map(sources.map((source) => [source.url, source]));
    const signalRows: NewProspectSignal[] = [];
    for (const signal of candidate.signals) {
      const source = sourceByUrl.get(signal.url);
      if (!source) continue;
      signalRows.push({
        prospectId: prospect.id,
        runId: run.id,
        sourceId: source.id,
        type: signal.type,
        summary: signal.summary,
        quote: signal.quote,
        eventDate: signal.eventDate,
        publishedAt: signal.publishedAt,
        discoveredAt: now,
        verification: signal.verification,
        confidence: signal.confidence,
        relevance: signal.relevance,
        relatedService: signal.relatedService,
        rationale: signal.rationale,
        recency: signal.recency,
        fingerprint: await sha256Hex(
          signalFingerprintText({ prospectId: prospect.id, type: signal.type, url: signal.url }),
        ),
        retentionUntil,
      });
    }
    const inserted = signalRows.length > 0 ? await repo.insertSignals(signalRows) : [];

    // Triagem com tudo o que se sabe da empresa (todas as pesquisas).
    const [allSources, allSignals] = await Promise.all([
      repo.sourcesFor([prospect.id]),
      repo.signalsFor([prospect.id]),
    ]);
    const official = allSources.find((source) => source.relation === 'official_site');
    const icpContent = strategy.icp?.current?.content ?? null;
    const triage = assessProspect({
      name: prospect.displayName,
      domain: prospect.domain,
      hasOfficialSite: prospect.websiteUrl !== null,
      siteVerified: prospect.siteVerified || candidate.siteVerified,
      officialSiteSourceId: official?.id ?? null,
      segment: prospect.segment,
      description: prospect.description,
      city: prospect.city,
      uf: prospect.uf,
      cnpj: prospect.cnpj,
      sources: allSources.map((source) => ({ id: source.id, relation: source.relation })),
      signals: allSignals.map((signal) => ({
        type: signal.type,
        verification: signal.verification,
        relevance: signal.relevance,
        recency: signalRecency(signal.eventDate, signal.publishedAt, clock.now()),
        sourceId: signal.sourceId,
        summary: signal.summary,
      })),
      wanted: {
        segment: intent.segment,
        segmentTerms: intent.segmentTerms,
        cities: intent.region.cities,
        ufs: intent.region.ufs,
        signals: intent.signals,
      },
      icp:
        strategy.icp?.current && icpContent
          ? {
              versionId: strategy.icp.current.id,
              ufs: icpContent.filters.ufs,
              municipalities: icpContent.filters.municipalities,
              sizes: icpContent.filters.sizes,
              exclusions: {
                domains: icpContent.exclusions.domains,
                cnpjRoots: icpContent.exclusions.cnpjRoots,
                municipalities: icpContent.exclusions.municipalities,
              },
            }
          : null,
      scoring: strategy.scoring
        ? { versionId: strategy.scoring.id, weights: strategy.scoring.content.weights }
        : null,
      companyLifecycle: link?.lifecycle ?? null,
      sizeBand: link?.sizeBand ?? null,
      now: clock.now(),
    });
    await repo.updateProspect(prospect.id, {
      priority: triage.priority,
      priorityScore: triage.priorityScore,
      confidence: triage.confidence,
      assessment: triage.assessment,
    });
    return { isNew, counted: true, signals: inserted.length };
  }

  async function abandon(runId: string, cancelled: boolean): Promise<void> {
    const run = await repo.getRun(runId);
    if (!run || run.status === 'completed' || run.status === 'failed' || run.status === 'cancelled')
      return;
    await repo.updateRun(runId, {
      status: cancelled ? 'cancelled' : 'failed',
      failureCode: cancelled ? null : 'interrupted',
      partial: run.progress.prospects > 0,
      finishedAt: nowIso(),
    });
  }

  return { execute, abandon };
}

// -----------------------------------------------------------------------------
// Absorver a resposta do extrator (servidor confere nome, trecho e site oficial)
// -----------------------------------------------------------------------------

function rankScore(candidate: Candidate, intent: DiscoveryIntent): number {
  let score = 0;
  if (candidate.siteKey) score += 3;
  if (candidate.siteVerified) score += 2;
  score += Math.min(3, candidate.signals.length);
  score += candidate.signals.filter((signal) => signal.verification === 'confirmed').length;
  if (
    candidate.city &&
    intent.region.cities.some((city) => normalizeCity(city) === normalizeCity(candidate.city ?? ''))
  ) {
    score += 1;
  }
  return score;
}

function rank(candidates: Candidate[], intent: DiscoveryIntent): void {
  candidates.sort((a, b) => rankScore(b, intent) - rankScore(a, intent));
}

function findCandidate(candidates: readonly Candidate[], probe: DedupeCandidate): Candidate | null {
  const match = findSameCompany(
    probe,
    candidates.map((candidate, index) => ({
      id: String(index),
      name: candidate.name,
      siteKey: candidate.siteKey,
      city: candidate.city,
      uf: candidate.uf,
      cnpj: candidate.cnpj,
    })),
  );
  return match ? (candidates[Number(match.target.id)] ?? null) : null;
}

/**
 * Cidade da região pedida citada no próprio texto do resultado (e a UF, se a região tem uma só).
 * Sem ela, a mesma empresa achada por uma notícia (sem cidade) e pelo site (com cidade) ficaria
 * duplicada: nome igual só junta com localização compatível (`findSameCompany`).
 */
function regionPlace(
  text: string,
  region: DiscoveryIntent['region'],
): { city: string | null; uf: UF | null } {
  const city = region.cities.find((item) => cityIn(item, text)) ?? null;
  return { city, uf: city && region.ufs.length === 1 ? (region.ufs[0] ?? null) : null };
}

/** Junta a resposta do extrator aos candidatos da pesquisa, descartando o que não se confirma. */
function absorb(
  candidates: Candidate[],
  batch: readonly SearchResultRow[],
  output: ExtractorOutput,
  region: DiscoveryIntent['region'],
  now: Date,
): void {
  const kinds = new Map(output.results.map((item) => [item.result, item.kind]));
  const byResultCompany = new Map<string, Candidate>();

  for (const company of output.companies) {
    const result = batch[company.result - 1];
    if (!result) continue;
    // Sites de dados de CNPJ mostram o nome do MEI com o CPF: o CPF fica de fora (regra 7).
    const name = withoutCpf(company.name).slice(0, 160);
    if (distinctiveTokens(name).length === 0) continue;
    const text = `${result.title} ${result.snippet}`;
    const key = siteKey(result.url);
    // Site oficial só quando o endereço confere com o nome: a palavra do modelo (ou de uma
    // página que se diz "site oficial") não basta para ligar CNPJ, domínio e dossiê.
    const official = key !== null && nameMatchesHost(name, result.host);
    // Nome que não aparece na fonte (e não é o site da empresa) é invenção do modelo: descarta.
    if (!official && !nameFoundIn(name, text)) continue;
    const stated = company.city && cityIn(company.city, text) ? company.city : null;
    const place = stated ? null : regionPlace(text, region);
    const city = stated ?? place?.city ?? null;
    const uf = company.uf && (city || ufIn(company.uf, text)) ? company.uf : (place?.uf ?? null);
    const probe: DedupeCandidate = {
      name,
      siteKey: official ? key : null,
      city,
      uf,
      cnpj: null,
    };
    let candidate = findCandidate(candidates, probe);
    if (!candidate) {
      candidate = {
        name,
        siteKey: probe.siteKey,
        websiteUrl: official ? homepageOf(result.url) : null,
        city,
        uf,
        segment: company.segment,
        description: company.description,
        cnpj: null,
        siteVerified: false,
        sources: new Map(),
        signals: [],
      };
      candidates.push(candidate);
    } else {
      if (official && !candidate.siteKey) {
        candidate.siteKey = key;
        candidate.websiteUrl = homepageOf(result.url);
      }
      candidate.city ??= city;
      candidate.uf ??= uf;
      candidate.segment ??= company.segment;
      candidate.description ??= company.description;
    }
    candidate.sources.set(result.url, {
      url: result.url,
      host: result.host,
      title: clean(result.title, 300),
      snippet: result.snippet.slice(0, DISCOVERY_SNIPPET_MAX),
      kind: 'search_result',
      relation: official
        ? 'official_site'
        : relationFor(result.hostKind, kinds.get(company.result)),
      provider: 'tavily',
      publishedAt: result.publishedAt,
    });
    byResultCompany.set(`${company.result}|${normalizeCompanyName(name)}`, candidate);
  }

  for (const signal of output.signals) {
    const result = batch[signal.result - 1];
    if (!result) continue;
    const text = `${result.title} ${result.snippet}`;
    // Conferido em um campo só: citação que atravessa título e trecho não existe na fonte.
    if (
      !signalQuoteFound(signal.quote, result.title) &&
      !signalQuoteFound(signal.quote, result.snippet)
    )
      continue;
    const eventDate = supportedEventDate(signal.eventDate, text);
    const companyName = signal.company.replace(/\s+/g, ' ').trim();
    let candidate =
      byResultCompany.get(`${signal.result}|${normalizeCompanyName(companyName)}`) ??
      candidates.find(
        (item) =>
          item.sources.has(result.url) &&
          (nameFoundIn(item.name, companyName) || nameFoundIn(companyName, item.name)),
      ) ??
      null;
    if (!candidate) {
      if (distinctiveTokens(companyName).length === 0 || !nameFoundIn(companyName, text)) continue;
      const place = regionPlace(text, region);
      candidate = findCandidate(candidates, {
        name: companyName,
        siteKey: null,
        city: place.city,
        uf: place.uf,
        cnpj: null,
      });
      if (!candidate) {
        candidate = {
          name: companyName.slice(0, 160),
          siteKey: null,
          websiteUrl: null,
          city: place.city,
          uf: place.uf,
          segment: null,
          description: null,
          cnpj: null,
          siteVerified: false,
          sources: new Map(),
          signals: [],
        };
        candidates.push(candidate);
      }
    }
    const isOfficial = candidate.siteKey !== null && siteKey(result.url) === candidate.siteKey;
    const relation: ProspectSourceRelation = isOfficial
      ? 'official_site'
      : relationFor(result.hostKind, kinds.get(signal.result));
    const known = candidate.sources.get(result.url);
    const title = clean(result.title, 300);
    const inTitle = title !== null && quoteFoundIn(signal.quote, title);
    if (!known) {
      candidate.sources.set(result.url, {
        url: result.url,
        host: result.host,
        title,
        snippet: inTitle
          ? result.snippet.slice(0, DISCOVERY_SNIPPET_MAX)
          : excerptAround(result.snippet, signal.quote, DISCOVERY_SNIPPET_MAX),
        kind: 'search_result',
        relation,
        provider: 'tavily',
        publishedAt: result.publishedAt,
      });
    } else if (!inTitle && !quoteFoundIn(signal.quote, known.snippet)) {
      known.snippet = excerptAround(result.snippet, signal.quote, DISCOVERY_SNIPPET_MAX);
    }
    const recency = signalRecency(eventDate, result.publishedAt, now);
    const assessment = { relation, quoteVerified: true, explicit: signal.explicit, recency };
    if (candidate.signals.some((item) => item.url === result.url && item.type === signal.type))
      continue;
    candidate.signals.push({
      url: result.url,
      type: signal.type,
      summary: signal.summary.slice(0, 300),
      quote: signal.quote.slice(0, DISCOVERY_SNIPPET_MAX),
      eventDate,
      publishedAt: result.publishedAt,
      verification: signalVerification(assessment),
      confidence: signalConfidence(assessment),
      relevance: signal.relevance,
      relatedService: signal.service,
      rationale: (signal.rationale ?? '').slice(0, 400),
      recency,
    });
  }
}
