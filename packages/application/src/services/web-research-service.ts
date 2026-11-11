import {
  PAGE_READ_MESSAGES,
  PageReadRequest,
  Uuid,
  WEB_LEDGER_PAGE_TEXT_MAX_CHARS,
  WEB_LEDGER_SNIPPET_MAX_CHARS,
  WEB_SEARCH_MESSAGES,
  WEB_SEARCH_PROVIDER_LABELS,
  WebSearchRequest,
  type Claim,
  type Company,
  type PageReadFailure,
  type PageReadOutcome,
  type WebPage,
  type WebResearchUsage,
  type WebSearchFailure,
  type WebSearchOutcome,
  type WebSearchProvider,
  type WebSearchRequestDraft,
} from '@prospector/contracts';
import { registryRetentionUntil } from '@prospector/domain';
import { z } from 'zod';
import { calendarDate, systemClock, type Clock } from '../clock';
import type { RequestContext } from '../context';
import { AppError, parseInput } from '../errors';
import type { CompanyRepository, EvidenceRepository } from '../ports/company-repository';
import type { PageFetcher } from '../ports/page-fetcher';
import type {
  WebResearchUsageStore,
  WebSearch,
  WebSearchProviderResult,
} from '../ports/web-search';
import type { EvidenceDraft, EvidenceService } from './evidence-service';

/**
 * Pesquisa na internet (D-AI-4, ADR-0012): busca (Tavily) e leitura de páginas (Playwright), com
 * - cache: busca idêntica e página já lida são reaproveitadas sem nova chamada (nem crédito);
 * - orçamento: créditos do mês somados no `provider_usage`; ao atingir o limite, nenhuma chamada
 *   sai (`budget_exhausted`). A reserva acontece antes da chamada, sob trava, para duas buscas
 *   simultâneas não passarem juntas do limite;
 * - concorrência limitada com fila curta (`busy` quando cheia);
 * - falha honesta: provedor fora do ar vira falha tipada com mensagem pt-BR, nunca resultado
 *   inventado nem resposta "vazia" disfarçada de sucesso.
 * Quando a pesquisa é sobre uma empresa cadastrada, cada resultado vira fonte do ledger
 * (`search_result` / `web_page`) gravada pelo `EvidenceService`, ancorada num claim mecânico
 * (texto montado pelo sistema, nunca pelo modelo): hipótese "a verificar" para menções achadas
 * pelo buscador; fato só para página do próprio domínio da empresa.
 *
 * Sem recusas por dado pessoal (decisão do usuário de 2026-11-10, emenda do ADR-0012): empresa
 * individual (MEI) é pesquisada como qualquer outra, nenhum site sai da busca por padrão e todo
 * resultado pode ir para o dossiê. A consulta não é gravada; trecho e texto guardados são curtos e
 * as fontes têm prazo de guarda (12 meses, doc 06 §6). O título da página fica só na fonte, nunca
 * no enunciado do claim (texto externo não vira afirmação).
 */

/** Chave do catálogo: página que pode falar da empresa, ainda não conferida (hipótese). */
export const WEB_MENTION_KEY = 'digital_presence.web_mention';
/** Chave do catálogo: página publicada no domínio da própria empresa (fato). */
export const WEBSITE_PAGE_KEY = 'digital_presence.website_page';

export type WebSearchSetting = WebSearch | 'disabled' | 'not_configured';
export type PageReaderSetting = PageFetcher | 'disabled';

export interface WebResearchStatus {
  search: 'enabled' | 'disabled' | 'not_configured';
  pageReader: 'enabled' | 'disabled';
  /** Consumo do mês; null quando a busca não está ligada. */
  usage: WebResearchUsage | null;
}

export interface CompanyWebSearchResult {
  outcome: WebSearchOutcome;
  /** Resultados gravados como fonte nova no dossiê. */
  recorded: number;
  /** Resultados que já estavam no dossiê e ganharam versão com a coleta nova. */
  refreshed: number;
}

export interface CompanyPageResult {
  outcome: PageReadOutcome;
  /** false quando a leitura falhou, a página veio vazia ou já estava gravada com esta coleta. */
  recorded: boolean;
  epistemicType: 'fact' | 'hypothesis' | null;
}

export interface WebResearchService {
  status(ctx: RequestContext): Promise<WebResearchStatus>;
  /** Busca sem gravar nada. Entrada inválida (inclusive dado pessoal na consulta): AppError. */
  search(ctx: RequestContext, raw: WebSearchRequestDraft): Promise<WebSearchOutcome>;
  /** Lê uma página pública sem gravar nada. */
  readPage(ctx: RequestContext, raw: { url: string }): Promise<PageReadOutcome>;
  /**
   * O endereço apareceu num resultado de busca nas últimas 24 h? A ferramenta do Copiloto só lê
   * esses: um endereço montado pelo modelo (por exemplo, a mando de texto escondido numa página)
   * poderia levar dados do dossiê para o servidor de quem escreveu a página.
   */
  wasSuggested(url: string): boolean;
  /** Busca e grava os resultados como fontes da empresa (hipóteses "a verificar"). */
  searchForCompany(
    ctx: RequestContext,
    input: { companyId: string } & WebSearchRequestDraft,
  ): Promise<CompanyWebSearchResult>;
  /** Lê a página e a grava como fonte da empresa. */
  readPageForCompany(
    ctx: RequestContext,
    input: { companyId: string; url: string },
  ): Promise<CompanyPageResult>;
}

export interface WebResearchServiceDeps {
  search: WebSearchSetting;
  pages: PageReaderSetting;
  usage: WebResearchUsageStore;
  companies: Pick<CompanyRepository, 'get'>;
  evidence: Pick<EvidenceRepository, 'claimsFor'>;
  evidenceService: EvidenceService;
  /** Créditos que o app pode gastar por mês civil (fuso da agência). 0 = nenhuma busca. */
  monthlyCreditBudget: number;
  maxConcurrentSearches?: number;
  maxQueuedSearches?: number;
  maxConcurrentPages?: number;
  maxQueuedPages?: number;
  /** 0 desliga o cache. */
  searchCacheTtlMs?: number;
  pageCacheTtlMs?: number;
  clock?: Clock;
  newId?: () => string;
  log?: (message: string) => void;
}

const HOUR_MS = 60 * 60 * 1000;

// -----------------------------------------------------------------------------
// Utilitários: cache com validade, fila limitada e trava
// -----------------------------------------------------------------------------

class TtlCache<V> {
  private readonly entries = new Map<string, { at: number; value: V }>();
  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries: number,
    private readonly now: () => number,
  ) {}

  get(key: string): V | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (this.now() - entry.at >= this.ttlMs) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: V): void {
    if (this.ttlMs <= 0) return;
    this.entries.delete(key);
    this.entries.set(key, { at: this.now(), value });
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }
}

const BUSY = Symbol('busy');

/** Até `maxActive` tarefas ao mesmo tempo e `maxQueue` esperando; além disso, `BUSY`. */
function createLimiter(maxActive: number, maxQueue: number) {
  let active = 0;
  const waiting: Array<() => void> = [];
  return async function run<T>(task: () => Promise<T>): Promise<T | typeof BUSY> {
    if (active >= maxActive) {
      if (waiting.length >= maxQueue) return BUSY;
      // A vaga é passada direto de quem termina para quem espera (`active` não muda).
      await new Promise<void>((resolve) => waiting.push(resolve));
    } else {
      active += 1;
    }
    try {
      return await task();
    } finally {
      const next = waiting.shift();
      if (next) next();
      else active -= 1;
    }
  };
}

/** Execução exclusiva (leitura do consumo + reserva; registro + liberação). */
function createMutex() {
  let tail: Promise<unknown> = Promise.resolve();
  return function exclusive<T>(task: () => Promise<T>): Promise<T> {
    const result = tail.then(task, task);
    tail = result.catch(() => undefined);
    return result;
  };
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function cut(text: string, max: number): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return url;
  }
}

/** Endereço comparável para cache e deduplicação: sem fragmento, host em minúsculas. */
function urlKey(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return url;
  }
}

/** A página está no domínio cadastrado da empresa (ou num subdomínio dele)? */
function isCompanyOwned(url: string, primaryDomain: string | null): boolean {
  if (!primaryDomain) return false;
  const host = hostOf(url);
  const domain = primaryDomain.toLowerCase().replace(/^www\./, '');
  return host === domain || host.endsWith(`.${domain}`);
}

function searchCacheKey(provider: WebSearchProvider, request: WebSearchRequest): string {
  return JSON.stringify([
    provider,
    request.query.toLowerCase().replace(/\s+/g, ' '),
    request.maxResults,
    request.topic,
    request.region,
    request.timeRange,
    [...request.includeDomains].sort(),
    [...request.excludeDomains].sort(),
  ]);
}

const CompanyRef = z.object({ companyId: Uuid });

/** Valor guardado no claim para deduplicar por endereço e coleta. */
const StoredWebValue = z.object({ url: z.string(), capturedAt: z.string() });

/** Log sem mensagem de erro: ela pode trazer URL, consulta ou trecho de página. */
const errorName = (error: unknown) => (error instanceof Error ? error.name : 'erro');

// -----------------------------------------------------------------------------
// Serviço
// -----------------------------------------------------------------------------

export function createWebResearchService(deps: WebResearchServiceDeps): WebResearchService {
  const clock = deps.clock ?? systemClock;
  const newId = deps.newId ?? (() => crypto.randomUUID());
  const log = deps.log ?? ((message: string) => console.warn(message));
  const nowMs = () => clock.now().getTime();
  const searchCache = new TtlCache<Extract<WebSearchOutcome, { ok: true }>>(
    deps.searchCacheTtlMs ?? 24 * HOUR_MS,
    200,
    nowMs,
  );
  const pageCache = new TtlCache<WebPage>(deps.pageCacheTtlMs ?? 6 * HOUR_MS, 50, nowMs);
  /** Endereços vindos de resultados de busca (para `wasSuggested`). */
  const suggested = new TtlCache<true>(24 * HOUR_MS, 2000, nowMs);
  const pendingSearches = new Map<string, Promise<WebSearchOutcome>>();
  const pendingPages = new Map<string, Promise<PageReadOutcome>>();
  const searchLimiter = createLimiter(deps.maxConcurrentSearches ?? 2, deps.maxQueuedSearches ?? 4);
  const pageLimiter = createLimiter(deps.maxConcurrentPages ?? 1, deps.maxQueuedPages ?? 3);
  const budgetLock = createMutex();
  /** Créditos reservados por chamadas em andamento ou que não conseguiram ser registrados. */
  let reserved = 0;

  const period = () => calendarDate(clock.now()).slice(0, 7);

  function searchFailure(
    failure: WebSearchFailure,
    provider: WebSearchProvider | null,
    retryAfterSeconds: number | null = null,
  ): WebSearchOutcome {
    return {
      ok: false,
      failure,
      message: WEB_SEARCH_MESSAGES[failure],
      provider,
      retryAfterSeconds,
    };
  }

  function pageFailure(
    failure: PageReadFailure,
    httpStatus: number | null = null,
  ): PageReadOutcome {
    return { ok: false, failure, message: PAGE_READ_MESSAGES[failure], httpStatus };
  }

  async function usage(provider: WebSearchProvider): Promise<WebResearchUsage> {
    const current = period();
    const used = await deps.usage.creditsUsed(provider, current);
    const counted = used + reserved;
    return {
      period: current,
      provider,
      creditsUsed: used,
      creditsBudget: deps.monthlyCreditBudget,
      creditsRemaining: Math.max(0, deps.monthlyCreditBudget - counted),
    };
  }

  /** Reserva, chama o provedor e registra o consumo. Nunca lança por falha do provedor. */
  async function callProvider(
    ctx: RequestContext,
    provider: WebSearch,
    request: WebSearchRequest,
  ): Promise<WebSearchOutcome> {
    const cost = provider.creditsPerSearch;
    const month = period();
    const admitted = await budgetLock(async () => {
      const used = await deps.usage.creditsUsed(provider.provider, month);
      if (used + reserved + cost > deps.monthlyCreditBudget) return false;
      reserved += cost;
      return true;
    });
    if (!admitted) return searchFailure('budget_exhausted', provider.provider);

    let result: WebSearchProviderResult;
    try {
      result = await provider.search(request);
    } catch (error) {
      // O adaptador não deveria lançar; se lançar, a chamada pode ter sido cobrada.
      log(
        `[pesquisa-web] ${provider.provider} lançou erro trace=${ctx.traceId}: ${errorName(error)}`,
      );
      result = {
        ok: false,
        failure: 'unavailable',
        creditsCharged: cost,
        retryAfterSeconds: null,
      };
    }
    const fetchedAt = clock.now().toISOString();
    await budgetLock(async () => {
      try {
        await deps.usage.record({
          provider: provider.provider,
          operation: 'search',
          units: Math.max(0, Math.round(result.creditsCharged)),
          period: month,
          outcome: result.ok ? 'ok' : result.failure,
          traceId: ctx.traceId,
          occurredAt: fetchedAt,
        });
        reserved -= cost;
      } catch (error) {
        // Sem registro, a reserva fica: o orçamento erra para menos, nunca para mais.
        log(`[pesquisa-web] consumo não registrado trace=${ctx.traceId}: ${errorName(error)}`);
      }
    });

    if (!result.ok) {
      return searchFailure(result.failure, provider.provider, result.retryAfterSeconds);
    }
    return {
      ok: true,
      provider: provider.provider,
      query: request.query,
      results: result.results.slice(0, request.maxResults),
      fetchedAt,
      fromCache: false,
      creditsCharged: Math.max(0, Math.round(result.creditsCharged)),
    };
  }

  async function search(ctx: RequestContext, raw: WebSearchRequestDraft) {
    const outcome = await runSearch(ctx, raw);
    if (outcome.ok) {
      for (const result of outcome.results) suggested.set(urlKey(result.url), true);
    }
    return outcome;
  }

  async function runSearch(
    ctx: RequestContext,
    raw: WebSearchRequestDraft,
  ): Promise<WebSearchOutcome> {
    const request = parseInput(WebSearchRequest, raw);
    const provider = deps.search;
    if (provider === 'disabled') return searchFailure('disabled', null);
    if (provider === 'not_configured') return searchFailure('not_configured', null);

    const key = searchCacheKey(provider.provider, request);
    const cached = searchCache.get(key);
    if (cached) return { ...cached, fromCache: true, creditsCharged: 0 };
    const inFlight = pendingSearches.get(key);
    if (inFlight) {
      const shared = await inFlight;
      return shared.ok ? { ...shared, fromCache: true, creditsCharged: 0 } : shared;
    }

    const task = (async (): Promise<WebSearchOutcome> => {
      const outcome = await searchLimiter(() => callProvider(ctx, provider, request));
      if (outcome === BUSY) return searchFailure('busy', provider.provider);
      if (outcome.ok) searchCache.set(key, outcome);
      return outcome;
    })();
    pendingSearches.set(key, task);
    try {
      return await task;
    } finally {
      pendingSearches.delete(key);
    }
  }

  async function readPage(ctx: RequestContext, raw: { url: string }) {
    const { url } = parseInput(PageReadRequest, raw);
    const fetcher = deps.pages;
    if (fetcher === 'disabled') return pageFailure('disabled');

    const key = urlKey(url);
    const cached = pageCache.get(key);
    if (cached) return { ok: true as const, page: cached, fromCache: true };
    const inFlight = pendingPages.get(key);
    if (inFlight) {
      const shared = await inFlight;
      return shared.ok ? { ...shared, fromCache: true } : shared;
    }

    const task = (async (): Promise<PageReadOutcome> => {
      const result = await pageLimiter(async () => {
        try {
          return await fetcher.fetchPage(url);
        } catch (error) {
          log(`[leitor] falhou trace=${ctx.traceId}: ${errorName(error)}`);
          return { ok: false as const, failure: 'unavailable' as const, httpStatus: null };
        }
      });
      if (result === BUSY) return pageFailure('busy');
      if (!result.ok) return pageFailure(result.failure, result.httpStatus);
      pageCache.set(key, result.page);
      return { ok: true, page: result.page, fromCache: false };
    })();
    pendingPages.set(key, task);
    try {
      return await task;
    } finally {
      pendingPages.delete(key);
    }
  }

  async function requireCompany(companyId: string): Promise<Company> {
    const { companyId: id } = parseInput(CompanyRef, { companyId });
    const company = await deps.companies.get(id);
    if (!company) throw new AppError('not_found', 'not_found');
    if (company.lifecycle === 'archived') throw new AppError('conflict', 'company_archived');
    return company;
  }

  /** Claims em vigor da empresa com as chaves da web, por endereço. */
  async function webClaimsByUrl(companyId: string): Promise<Map<string, Claim[]>> {
    const claims = await deps.evidence.claimsFor('company', companyId);
    const byUrl = new Map<string, Claim[]>();
    for (const claim of claims) {
      if (claim.status === 'superseded' || claim.status === 'rejected') continue;
      if (claim.key !== WEB_MENTION_KEY && claim.key !== WEBSITE_PAGE_KEY) continue;
      const value = StoredWebValue.safeParse(claim.value);
      if (!value.success) continue;
      const key = urlKey(value.data.url);
      byUrl.set(key, [...(byUrl.get(key) ?? []), claim]);
    }
    return byUrl;
  }

  /** Mesma chave e mesma coleta = nada a gravar; mesma chave e coleta nova = nova versão. */
  function previousVersion(
    existing: readonly Claim[] | undefined,
    key: string,
    capturedAt: string,
  ): { skip: boolean; supersedes: string | null } {
    const same = existing?.find((claim) => claim.key === key);
    if (!same) return { skip: false, supersedes: null };
    const value = StoredWebValue.safeParse(same.value);
    if (value.success && value.data.capturedAt === capturedAt) {
      return { skip: true, supersedes: null };
    }
    return { skip: false, supersedes: same.id };
  }

  async function searchDraft(
    company: Company,
    outcome: Extract<WebSearchOutcome, { ok: true }>,
  ): Promise<{ draft: EvidenceDraft; refreshed: number }> {
    const existing = await webClaimsByUrl(company.id);
    const providerLabel = WEB_SEARCH_PROVIDER_LABELS[outcome.provider];
    const draft: EvidenceDraft = { sources: [], claims: [] };
    let refreshed = 0;
    const seen = new Set<string>();
    for (const result of outcome.results) {
      const key = urlKey(result.url);
      if (seen.has(key)) continue;
      seen.add(key);
      const version = previousVersion(existing.get(key), WEB_MENTION_KEY, outcome.fetchedAt);
      if (version.skip) continue;
      if (version.supersedes) refreshed += 1;
      const sourceId = newId();
      const host = hostOf(result.url);
      const title = cut(result.title, 200);
      const snippet = result.snippet.trim()
        ? cut(result.snippet, WEB_LEDGER_SNIPPET_MAX_CHARS)
        : '';
      // Sem a consulta: ela pode trazer nome de pessoa e não é preciso para provar a menção.
      const excerpt = [
        `Título: ${title}`,
        `Endereço: ${result.url}`,
        snippet ? `Trecho: ${snippet}` : null,
      ]
        .filter((line): line is string => line !== null)
        .join('\n');
      draft.sources?.push({
        id: sourceId,
        source: {
          schemaVersion: 1,
          kind: 'search_result',
          url: result.url,
          provider: outcome.provider,
          capturedAt: outcome.fetchedAt,
          contentHash: await sha256(excerpt),
          mime: 'text/plain',
          title,
          excerptText: excerpt,
          licenseNote: `Resultado de busca da ${providerLabel}: título e começo do trecho do provedor, sem conferência.`,
          retentionUntil: registryRetentionUntil(outcome.fetchedAt),
          isDemo: company.isDemo,
        },
      });
      draft.claims.push({
        id: newId(),
        supersedes: version.supersedes,
        claim: {
          schemaVersion: 1,
          subjectType: 'company',
          subjectId: company.id,
          domain: 'digital_presence',
          key: WEB_MENTION_KEY,
          statement: `Uma página de ${cut(host, 80)} apareceu numa busca na internet e pode ser sobre esta empresa.`,
          value: {
            url: result.url,
            host,
            capturedAt: outcome.fetchedAt,
            rank: result.rank,
            provider: outcome.provider,
            publishedAt: result.publishedAt,
          },
          epistemicType: 'hypothesis',
          evidence: [{ sourceId, quote: snippet || title }],
          reasoning: `Resultado do buscador ${providerLabel} ainda não conferido: a busca devolve páginas parecidas com a consulta, que podem ser de outra empresa. Leia a página para confirmar antes de usar.`,
          isDemo: company.isDemo,
        },
      });
    }
    return { draft, refreshed };
  }

  return {
    async status() {
      const provider = deps.search;
      const searchState =
        provider === 'disabled' || provider === 'not_configured' ? provider : 'enabled';
      return {
        search: searchState,
        pageReader: deps.pages === 'disabled' ? 'disabled' : 'enabled',
        usage: typeof provider === 'string' ? null : await usage(provider.provider),
      };
    },

    search,
    wasSuggested(url) {
      try {
        return suggested.get(urlKey(url)) === true;
      } catch {
        return false;
      }
    },
    readPage,

    async searchForCompany(ctx, input) {
      const { companyId, ...request } = input;
      const company = await requireCompany(companyId);
      const outcome = await search(ctx, request);
      if (!outcome.ok || outcome.results.length === 0) {
        return { outcome, recorded: 0, refreshed: 0 };
      }
      const { draft, refreshed } = await searchDraft(company, outcome);
      if (draft.claims.length === 0) return { outcome, recorded: 0, refreshed: 0 };
      await deps.evidenceService.record(ctx, company.id, draft, {
        action: 'prospect.company.web_search_recorded',
        ownedOrigins: company.primaryDomain ? [company.primaryDomain] : [],
      });
      return { outcome, recorded: draft.claims.length - refreshed, refreshed };
    },

    async readPageForCompany(ctx, input) {
      const company = await requireCompany(input.companyId);
      const outcome = await readPage(ctx, { url: input.url });
      if (!outcome.ok) return { outcome, recorded: false, epistemicType: null };
      const { page } = outcome;
      const title = page.title?.trim() ? cut(page.title, 200) : null;
      // `noarchive`/`tdm-reservation`: o dossiê guarda só endereço e título, sem o texto.
      const text = page.noArchive ? '' : page.text.trim();
      const quote = title ?? (text ? cut(text, 200).replace(/…$/, '') : null);
      if (!quote) return { outcome, recorded: false, epistemicType: null };

      const owned = isCompanyOwned(page.url, company.primaryDomain);
      const key = owned ? WEBSITE_PAGE_KEY : WEB_MENTION_KEY;
      const existing = (await webClaimsByUrl(company.id)).get(urlKey(page.url));
      const version = previousVersion(existing, key, page.fetchedAt);
      if (version.skip) return { outcome, recorded: false, epistemicType: null };

      // Só o começo do texto: o resto pode trazer nomes de pessoas e o ledger não apaga.
      const excerpt = [
        title,
        page.noArchive ? null : page.description?.trim() || null,
        text ? text.slice(0, WEB_LEDGER_PAGE_TEXT_MAX_CHARS) : null,
      ]
        .filter((part): part is string => Boolean(part))
        .join('\n\n');
      const host = cut(hostOf(page.url), 80);
      const label = cut(title ?? new URL(page.url).pathname, 140);
      const sourceId = newId();
      const value = { url: page.url, host: hostOf(page.url), capturedAt: page.fetchedAt };
      await deps.evidenceService.record(
        ctx,
        company.id,
        {
          sources: [
            {
              id: sourceId,
              source: {
                schemaVersion: 1,
                kind: 'web_page',
                url: page.url,
                provider: 'prospector',
                capturedAt: page.fetchedAt,
                contentHash: await sha256(excerpt),
                mime: page.contentType,
                httpStatus: page.httpStatus,
                title: title ? cut(title, 300) : null,
                excerptText: excerpt,
                licenseNote: page.noArchive
                  ? 'Página pública lida pelo leitor do Prospector; o site pede para não guardar cópia, então só o título foi guardado.'
                  : 'Página pública lida pelo leitor do Prospector (robots.txt respeitado); só o começo do texto foi guardado, como evidência.',
                retentionUntil: registryRetentionUntil(page.fetchedAt),
                isDemo: company.isDemo,
              },
            },
          ],
          claims: [
            {
              id: newId(),
              supersedes: version.supersedes,
              claim: owned
                ? {
                    schemaVersion: 1,
                    subjectType: 'company',
                    subjectId: company.id,
                    domain: 'digital_presence',
                    key,
                    statement: `O site da empresa (${host}) publica a página "${label}".`,
                    value,
                    epistemicType: 'fact',
                    evidence: [{ sourceId, quote }],
                    isDemo: company.isDemo,
                  }
                : {
                    schemaVersion: 1,
                    subjectType: 'company',
                    subjectId: company.id,
                    domain: 'digital_presence',
                    key,
                    statement: `A página "${label}" (${host}) foi lida e pode ser sobre esta empresa.`,
                    value,
                    epistemicType: 'hypothesis',
                    evidence: [{ sourceId, quote }],
                    reasoning:
                      'Página pública fora do domínio cadastrado da empresa: a relação com ela não foi conferida. Confirme pelo conteúdo antes de usar.',
                    isDemo: company.isDemo,
                  },
            },
          ],
        },
        {
          action: 'prospect.company.web_page_recorded',
          ownedOrigins: company.primaryDomain ? [company.primaryDomain] : [],
        },
      );
      return { outcome, recorded: true, epistemicType: owned ? 'fact' : 'hypothesis' };
    },
  };
}
