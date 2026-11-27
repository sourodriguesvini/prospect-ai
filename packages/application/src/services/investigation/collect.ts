import {
  CAPTURE_VIEWPORT_LABELS,
  CAPTURE_VIEWPORTS,
  COMPETITOR_KIND_LABELS,
  BUSINESS_EVENT_LABELS,
  CLAIM_EVIDENCE_LIMIT,
  INVESTIGATION_KEYS,
  captureKindOf,
  captureSlotOf,
  keySlug,
  type BrandCapture,
  type BrandCaptureFailure,
  BusinessEvent,
  type BusinessEventType,
  type CaptureExtrasRequest,
  type CaptureImage,
  type CaptureKind,
  type CaptureMissingPart,
  type CaptureRecord,
  type CaptureStorageOutcome,
  type CaptureViewport,
  type CompetitorKind,
  type DemandDetails,
  type FundingDetails,
  type SourceInputDraft,
  type WebSearchOutcome,
} from '@prospector/contracts';
import {
  bareHost,
  brazilianPartialDate,
  captureExcerpt,
  companyPassage,
  competitorSearchQueries,
  DEEP_READ_EVENTS,
  detectEventTypes,
  eventLeadQuote,
  extractCompanyFunding,
  extractDemand,
  formatBrlAmount,
  fundingQuotes,
  groupEventReports,
  guardEventText,
  type EventReport,
  dominantColors,
  filterCompetitorCandidates,
  isNotCompetitorDomain,
  looksLikeInjection,
  metricFacts,
  recordDiscard,
  segmentFromTitle,
  siteRegistrableDomain,
  selectSitePages,
} from '@prospector/domain';
import {
  aiIssue,
  analysisCompany,
  brazilianDay,
  claimsWithPrefix,
  countModel,
  countSearch,
  cut,
  daysBetween,
  hostOf,
  loadInForce,
  pageMemo,
  recordStep,
  retention,
  type ClaimDraftItem,
  type PageMemo,
  type Run,
  type StepOutcome,
} from './run';
import {
  CAPTURE_STORE_FAILURE_TEXT,
  CaptureStoreError,
  type BrandCaptureResult,
  type BrandCapturer,
  type CaptureStoreFailure,
} from '../../ports/investigation';
import { guardTriageInput, guardTriageOutput, recordGuardLog } from './guards';
import { WEB_MENTION_KEY } from '../web-research-service';

/**
 * Etapas de coleta: o que a empresa já tem no dossiê, site oficial, páginas do site, capturas da
 * marca, sinais na internet e concorrentes. Busca custa crédito da Tavily: sinais e concorrentes
 * ainda válidos de uma investigação anterior são reaproveitados (cenário J), salvo pedido de
 * coleta completa (`force`).
 */

const REUSE_SEARCH_DAYS = 30;
const VIEWPORTS: readonly CaptureViewport[] = ['desktop', 'mobile'];

function fold(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** Palavras do nome que identificam a empresa (sem "clínica", "ltda"…). */
function nameTokens(name: string): string[] {
  const generic = new Set([
    'ltda',
    'eireli',
    'me',
    'epp',
    'sa',
    'clinica',
    'consultorio',
    'loja',
    'comercio',
    'servicos',
    'industria',
    'empresa',
    'grupo',
    'centro',
    'studio',
    'estudio',
    'de',
    'da',
    'do',
    'das',
    'dos',
    'e',
  ]);
  return fold(name)
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length >= 3 && !generic.has(word));
}

function searchIssue(outcome: Extract<WebSearchOutcome, { ok: false }>) {
  return outcome.failure === 'budget_exhausted' || outcome.failure === 'quota_exceeded'
    ? ('search_budget' as const)
    : ('search_unavailable' as const);
}

function previousStep(run: Run, key: string) {
  return run.previous?.steps.find((step) => step.key === key) ?? null;
}

type SearchKey = 'signals' | 'competitors';

/**
 * Quando a pesquisa paga da etapa rodou de verdade na investigação anterior: a data gravada no
 * retrato ou, sem ela, o fim da etapa feita (nunca o de uma etapa reaproveitada, que é "agora" e
 * faria o reaproveitamento nunca vencer).
 */
function searchedAt(run: Run, key: SearchKey): string | null {
  const recorded = run.previous?.snapshot?.searchedAt?.[key];
  if (recorded) return recorded;
  const step = previousStep(run, key);
  return step?.state === 'done' && step.finishedAt ? step.finishedAt : null;
}

/** A pesquisa anterior ainda vale (feita há até `days` dias, sem pedido de coleta completa)? */
function reusable(run: Run, key: SearchKey, days: number): boolean {
  if (run.force) return false;
  const step = previousStep(run, key);
  if (!step || (step.state !== 'done' && step.state !== 'reused')) return false;
  const at = searchedAt(run, key);
  return at !== null && daysBetween(at, run.deps.clock.now()) <= days;
}

/** Guarda no retrato a data da pesquisa (a de agora, ou a da anterior quando reaproveitada). */
function markSearched(run: Run, key: SearchKey, at: string | null): void {
  if (!at) return;
  run.snapshot.searchedAt = { ...run.snapshot.searchedAt, [key]: at };
}

function searchSource(
  run: Run,
  result: { url: string; title: string; snippet: string; publishedAt: string | null },
  outcome: Extract<WebSearchOutcome, { ok: true }>,
) {
  const title = cut(result.title, 300);
  return {
    schemaVersion: 1 as const,
    kind: 'search_result' as const,
    url: result.url,
    provider: outcome.provider,
    capturedAt: outcome.fetchedAt,
    title,
    excerptText: [title, cut(result.snippet, 300)].filter(Boolean).join('\n'),
    licenseNote:
      'Resultado de pesquisa (título e trecho curto), guardado só como evidência (ADR-0012).',
    retentionUntil: retention(outcome.fetchedAt),
    isDemo: run.company.isDemo,
  };
}

// -----------------------------------------------------------------------------
// context
// -----------------------------------------------------------------------------

export async function stepContext(run: Run): Promise<StepOutcome> {
  await loadInForce(run);
  run.strategy = await run.deps.strategy.loadSnapshot();
  run.siteUrl = run.company.primaryDomain ? `https://${run.company.primaryDomain}/` : null;
  run.snapshot.siteUrl = run.siteUrl;
  const registry = claimsWithPrefix(run, 'registry.').length;
  const offers = run.strategy.offers.filter((offer) => offer.status === 'active').length;
  return { state: 'done', counts: { claims: run.inForce.size, registry, offers } };
}

// -----------------------------------------------------------------------------
// site: domínio cadastrado ou candidatos a confirmar
// -----------------------------------------------------------------------------

export async function stepSite(run: Run): Promise<StepOutcome> {
  if (run.siteUrl) return { state: 'done', counts: { confirmed: 1 } };
  const now = run.deps.clock.now();
  const fresh = claimsWithPrefix(run, `${INVESTIGATION_KEYS.officialSiteCandidate}.`).filter(
    (claim) => Date.parse(claim.validUntil) > now.getTime(),
  );
  if (!run.force && fresh.length > 0) {
    return { state: 'reused', issue: 'no_site', counts: { candidates: fresh.length } };
  }
  const web = run.deps.webResearch;
  if (!web) return { state: 'skipped', issue: 'search_unavailable' };

  const query = [run.company.displayName, run.company.city, run.company.uf]
    .filter(Boolean)
    .join(' ');
  const outcome = await web.search(run.ctx, { query, maxResults: 6 });
  if (!outcome.ok) return { state: 'failed', issue: searchIssue(outcome) };
  countSearch(run, outcome.creditsCharged);

  const tokens = nameTokens(run.company.displayName);
  const seen = new Set<string>();
  const candidates = outcome.results
    .map((result) => ({ result, domain: siteRegistrableDomain(result.url) }))
    .filter(
      (item): item is { result: (typeof outcome.results)[number]; domain: string } =>
        item.domain !== null && !isNotCompetitorDomain(item.domain),
    )
    .filter((item) => (seen.has(item.domain) ? false : (seen.add(item.domain), true)))
    .map((item) => ({ ...item, nameMatch: tokens.some((token) => item.domain.includes(token)) }))
    .sort((a, b) => Number(b.nameMatch) - Number(a.nameMatch))
    .slice(0, 3);
  if (candidates.length === 0) {
    return { state: 'done', issue: 'no_site', counts: { candidates: 0 } };
  }

  const sources: Array<{ id: string; source: ReturnType<typeof searchSource> }> = [];
  const claims: ClaimDraftItem[] = [];
  for (const { result, domain, nameMatch } of candidates) {
    const sourceId = run.deps.newId();
    const source = searchSource(run, result, outcome);
    sources.push({ id: sourceId, source });
    claims.push({
      id: run.deps.newId(),
      claim: {
        schemaVersion: 1,
        subjectType: 'company',
        subjectId: run.company.id,
        domain: 'digital_presence',
        key: `${INVESTIGATION_KEYS.officialSiteCandidate}.${keySlug(domain, 60)}`,
        statement: `O site ${domain} pode ser o site oficial da empresa (a confirmar).`,
        value: { domain, url: result.url, nameMatch },
        epistemicType: 'hypothesis',
        evidence: [{ sourceId, quote: source.title }],
        reasoning: `Apareceu na pesquisa pelo nome da empresa${
          nameMatch ? ' e o endereço contém parte do nome' : ''
        }. A investigação só lê o site e captura a marca depois que você confirmar.`,
        isDemo: run.company.isDemo,
      },
    });
  }
  const accepted = await recordStep(run, {
    action: 'company.investigation.site_candidates',
    sources,
    claims,
  });
  return { state: 'done', issue: 'no_site', counts: { candidates: accepted.size } };
}

// -----------------------------------------------------------------------------
// pages: página inicial + até três páginas que agregam
// -----------------------------------------------------------------------------

export async function stepPages(run: Run): Promise<StepOutcome> {
  if (!run.siteUrl || !run.company.primaryDomain) return { state: 'skipped', issue: 'no_site' };
  const web = run.deps.webResearch;
  if (!web) return { state: 'skipped', issue: 'reader_unavailable' };

  const home = await web.readPageForCompany(run.ctx, {
    companyId: run.company.id,
    url: run.siteUrl,
  });
  if (!home.outcome.ok) {
    const failure = home.outcome.failure;
    run.snapshot.siteReachable = false;
    run.snapshot.pages = [{ url: run.siteUrl, category: 'home', ok: false, contentHash: null }];
    const issue =
      failure === 'disabled'
        ? 'reader_unavailable'
        : ['robots_disallowed', 'access_denied', 'restricted_site', 'blocked_address'].includes(
              failure,
            )
          ? 'site_blocked'
          : 'site_unreachable';
    return { state: 'failed', issue, counts: { read: 0, failed: 1 } };
  }
  run.usage.pagesRead += 1;
  run.snapshot.siteReachable = true;
  run.pages = [pageMemo(home.outcome.page, 'P1', 'home')];
  const snapshotPages: typeof run.snapshot.pages = [
    {
      url: home.outcome.page.url,
      category: 'home',
      ok: true,
      contentHash: run.pages[0]?.contentHash ?? null,
    },
  ];

  const selected = selectSitePages(home.outcome.page.url, home.outcome.page.links, {
    siteDomain: run.company.primaryDomain,
    max: 3,
  }).slice(1);
  let failed = 0;
  for (const page of selected) {
    run.signal.throwIfAborted();
    const read = await web.readPageForCompany(run.ctx, {
      companyId: run.company.id,
      url: page.url,
    });
    if (!read.outcome.ok) {
      failed += 1;
      snapshotPages.push({ url: page.url, category: page.category, ok: false, contentHash: null });
      continue;
    }
    run.usage.pagesRead += 1;
    const memo = pageMemo(read.outcome.page, `P${run.pages.length + 1}`, page.category);
    run.pages.push(memo);
    snapshotPages.push({
      url: memo.url,
      category: page.category,
      ok: true,
      contentHash: memo.contentHash,
    });
  }
  run.snapshot.pages = snapshotPages;
  return { state: 'done', counts: { read: run.pages.length, failed } };
}

/** Retomada: relê as páginas que a etapa `pages` registrou no retrato (sem gravar de novo). */
export async function ensurePages(run: Run): Promise<void> {
  if (run.pages.length > 0 || !run.deps.webResearch) return;
  let index = 0;
  for (const page of run.snapshot.pages.filter((item) => item.ok)) {
    run.signal.throwIfAborted();
    const read = await run.deps.webResearch.readPage(run.ctx, { url: page.url });
    if (!read.ok) continue;
    index += 1;
    run.pages.push(pageMemo(read.page, `P${index}`, page.category));
  }
}

// -----------------------------------------------------------------------------
// capture: página inicial (primeiras telas, rodapé e menu aberto) e uma página interna
// -----------------------------------------------------------------------------

/** Página interna capturada: a primeira lida nesta ordem (produtos, serviços, institucional). */
const INNER_PAGE_ORDER: readonly string[] = ['products', 'services', 'about'];
const INNER_PAGE_LABELS: Record<string, string> = {
  products: 'de produtos',
  services: 'de serviços',
  about: 'institucional',
};
/** Gravação de cada imagem: até 3 tentativas, com espera crescente entre elas (ms). */
const STORE_BACKOFF_MS: readonly number[] = [0, 250, 750];
/** Espera antes de tentar a captura de novo quando o site ou o navegador falhou (ms). */
const CAPTURE_RETRY_DELAY_MS = 500;

const CAPTURE_FAILURE_TEXT: Record<BrandCaptureFailure, string> = {
  disabled: 'A captura de telas está desligada nesta instalação.',
  blocked_address: 'Endereço não permitido para captura.',
  robots_disallowed: 'O site não permite acesso automático a esta página (robots.txt).',
  access_denied: 'O site recusou o acesso ou pediu para não ser usado por IA.',
  restricted_site: 'Site com termos que não permitem captura automática.',
  not_found: 'A página não foi encontrada.',
  unsupported_content: 'O endereço não é uma página da web.',
  unavailable: 'O site não respondeu a tempo ou o navegador não conseguiu abrir a página.',
  browser_missing: 'O navegador das capturas não está instalado (veja Configurações › Sistema).',
};

const MISSING_TEXT: Record<
  CaptureMissingPart['region'],
  Record<CaptureMissingPart['reason'], string>
> = {
  footer: {
    inside_top: 'O rodapé já aparece nas primeiras telas.',
    not_found: 'A página não tem rodapé reconhecível.',
    failed: 'O navegador não conseguiu fazer a imagem do rodapé.',
  },
  menu: {
    inside_top: 'O menu já aparece aberto nas primeiras telas.',
    not_found: 'Nenhum menu de navegação abriu ao tocar no botão do celular.',
    failed: 'O navegador não conseguiu abrir o menu do celular.',
  },
};

const NO_ARCHIVE_TEXT = 'O site pede para não guardar cópia: a imagem foi analisada e descartada.';
const NOT_CONFIGURED_TEXT = 'A pasta de dados do Prospector não estava disponível.';

interface StoredImage {
  storagePath: string | null;
  storage: CaptureStorageOutcome;
  detail: string | null;
}

interface CaptureTally {
  stored: number;
  reused: number;
  notStored: number;
  claims: number;
}

function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/** Captura com uma nova tentativa quando a falha é passageira (site lento, navegador ocupado). */
async function captureWithRetry(
  run: Run,
  capturer: BrandCapturer,
  url: string,
  viewport: CaptureViewport,
  extras: CaptureExtrasRequest | null,
): Promise<{ result: BrandCaptureResult; attempts: number }> {
  const options = { signal: run.signal, ...(extras ? { extras } : {}) };
  const first = await capturer.capture(url, viewport, options);
  if (first.ok || first.failure !== 'unavailable') return { result: first, attempts: 1 };
  run.signal.throwIfAborted();
  await pause(CAPTURE_RETRY_DELAY_MS, run.signal);
  return { result: await capturer.capture(url, viewport, options), attempts: 2 };
}

/**
 * Guarda uma imagem. A mesma imagem (mesmo hash) de uma análise anterior reaproveita o arquivo
 * e renova o prazo dele; senão, grava com até 3 tentativas. Nunca apaga imagens anteriores: elas
 * continuam sendo a evidência dos claims substituídos até o fim da retenção (Parte 13.2).
 */
async function storeImage(
  run: Run,
  kind: CaptureKind,
  image: CaptureImage,
  capturedAt: string,
  noArchive: boolean,
): Promise<StoredImage> {
  if (noArchive) {
    await dropStoredImages(run, kind);
    return { storagePath: null, storage: 'no_archive', detail: NO_ARCHIVE_TEXT };
  }
  const store = run.deps.captureStore;
  if (!store) return { storagePath: null, storage: 'not_configured', detail: NOT_CONFIGURED_TEXT };
  const previous = run.inForce.get(INVESTIGATION_KEYS.capture(kind));
  const previousPath = previous?.value?.storagePath;
  if (typeof previousPath === 'string' && previous?.value?.sha256 === image.sha256) {
    try {
      if (await store.has(previousPath)) {
        await store.keep(previousPath);
        return { storagePath: previousPath, storage: 'reused', detail: null };
      }
    } catch {
      // Arquivo anterior ilegível: grava de novo abaixo.
    }
  }
  let reason: CaptureStoreFailure = 'unavailable';
  for (const delay of STORE_BACKOFF_MS) {
    run.signal.throwIfAborted();
    if (delay > 0) await pause(delay, run.signal);
    try {
      const saved = await store.put({
        companyId: run.company.id,
        investigationId: run.id,
        kind,
        image,
        capturedAt,
      });
      return { storagePath: saved.storagePath, storage: 'stored', detail: null };
    } catch (error) {
      reason = error instanceof CaptureStoreError ? error.reason : 'unavailable';
      // Disco cheio, sem permissão ou imagem inválida não melhoram em um segundo: só a falha
      // passageira tenta de novo.
      if (reason !== 'unavailable') break;
    }
  }
  run.deps.log(`[investigação] captura não guardada (${reason})`);
  return { storagePath: null, storage: 'failed', detail: CAPTURE_STORE_FAILURE_TEXT[reason] };
}

/**
 * O site passou a pedir para não guardar cópia: as imagens desta parte guardadas em análises
 * anteriores também saem (ADR-0012 §2). Claims e fontes continuam no ledger, com o hash; só o
 * arquivo sai. Falha ao apagar não derruba a investigação: fica no log, sem caminho.
 */
async function dropStoredImages(run: Run, kind: CaptureKind): Promise<void> {
  const store = run.deps.captureStore;
  if (!store) return;
  const key = INVESTIGATION_KEYS.capture(kind);
  const claims = await run.deps.evidence.claimsFor('company', run.company.id, {
    includeSuperseded: true,
  });
  const paths = new Set<string>();
  for (const claim of claims) {
    const path = claim.key === key ? claim.value?.storagePath : null;
    if (typeof path === 'string') paths.add(path);
  }
  for (const path of paths) {
    try {
      await store.delete(path);
    } catch {
      run.deps.log('[investigação] não foi possível apagar uma captura anterior');
    }
  }
}

function tallyStorage(tally: CaptureTally, stored: StoredImage): void {
  if (stored.storage === 'stored') tally.stored += 1;
  else if (stored.storage === 'reused') tally.reused += 1;
  else if (stored.storage === 'failed') tally.notStored += 1;
}

function screenshotSource(
  run: Run,
  input: {
    url: string;
    capturedAt: string;
    image: CaptureImage;
    storagePath: string | null;
    title: string | null;
    excerpt: string;
    noArchive: boolean;
  },
): SourceInputDraft {
  return {
    schemaVersion: 1,
    kind: 'screenshot',
    url: input.url,
    provider: 'prospector',
    capturedAt: input.capturedAt,
    contentHash: input.image.sha256,
    storagePath: input.storagePath,
    mime: input.image.mime,
    title: input.title ? cut(input.title, 300) : null,
    excerptText: input.excerpt,
    licenseNote: input.noArchive
      ? 'Captura automática da página pública (robots.txt respeitado). O site pede para não guardar cópia: a imagem foi analisada e descartada; ficam o endereço, o título e as medições.'
      : 'Captura automática da página pública pelo navegador do Prospector (robots.txt respeitado), guardada só como evidência.',
    retentionUntil: retention(input.capturedAt),
    isDemo: run.company.isDemo,
  };
}

function captureRecord(
  kind: CaptureKind,
  url: string,
  viewport: CaptureViewport,
  fields: Pick<CaptureRecord, 'state' | 'storage' | 'detail' | 'attempts'>,
): CaptureRecord {
  const size = CAPTURE_VIEWPORTS[viewport];
  return {
    kind,
    url: cut(url, 2048),
    viewportWidth: size.width,
    viewportHeight: size.height,
    ...fields,
    detail: fields.detail ? cut(fields.detail, 240) : null,
  };
}

/** Uma imagem extra (rodapé, menu ou página interna): fonte própria e um fato que a descreve. */
async function extraImageItems(
  run: Run,
  input: {
    kind: CaptureKind;
    viewport: CaptureViewport;
    url: string;
    capturedAt: string;
    image: CaptureImage;
    title: string | null;
    noArchive: boolean;
    statement: string;
    partLabel: string;
  },
): Promise<{
  stored: StoredImage;
  source: { id: string; source: SourceInputDraft };
  claim: ClaimDraftItem;
}> {
  const stored = await storeImage(run, input.kind, input.image, input.capturedAt, input.noArchive);
  const where = CAPTURE_VIEWPORT_LABELS[input.viewport];
  const slot = captureSlotOf(input.kind);
  const excerpt = `Captura ${input.partLabel} de ${input.url} no ${where} (${input.image.width}×${input.image.height} px) em ${brazilianDay(input.capturedAt)}.`;
  const sourceId = run.deps.newId();
  return {
    stored,
    source: {
      id: sourceId,
      source: screenshotSource(run, {
        url: input.url,
        capturedAt: input.capturedAt,
        image: input.image,
        storagePath: stored.storagePath,
        title: input.title,
        excerpt,
        noArchive: input.noArchive,
      }),
    },
    claim: {
      id: run.deps.newId(),
      claim: {
        schemaVersion: 1,
        subjectType: 'company',
        subjectId: run.company.id,
        domain: 'visual',
        key: INVESTIGATION_KEYS.capture(input.kind),
        statement: input.statement,
        value: {
          viewport: input.viewport,
          page: slot.page,
          region: slot.region,
          url: input.url,
          width: input.image.width,
          height: input.image.height,
          storagePath: stored.storagePath,
          sha256: input.image.sha256,
          noArchive: input.noArchive,
          storage: stored.storage,
        },
        epistemicType: 'fact',
        evidence: [
          {
            sourceId,
            quote: excerpt,
            locator: { bbox: [0, 0, input.image.width, input.image.height] },
          },
        ],
        isDemo: run.company.isDemo,
      },
    },
  };
}

/** Página inicial numa janela: primeiras telas com medições, mais rodapé e menu aberto. */
async function recordHomeCapture(
  run: Run,
  capture: BrandCapture,
  attempts: number,
  records: CaptureRecord[],
  tally: CaptureTally,
): Promise<void> {
  const { viewport } = capture;
  // O site pediu para não guardar cópia (na captura ou na leitura da mesma página): a imagem
  // vai à IA local nesta execução, mas não é guardada, e os textos da página (H1, botões) ficam
  // fora das evidências; fica o endereço, o título e as medições (ADR-0012 §2).
  const noArchive = capture.noArchive === true || run.pages[0]?.noArchive === true;
  const textOptions = { pageText: !noArchive };
  const kind: CaptureKind = viewport === 'desktop' ? 'site_desktop' : 'site_mobile';
  run.usage.captures += 1;
  run.usage.captureBytes += capture.image.bytes.length;
  run.images[viewport] = capture.image.bytes;
  run.snapshot.captureHashes[viewport] = capture.image.sha256;
  if (viewport === 'desktop') {
    run.snapshot.fonts = capture.metrics.fonts.slice(0, 5);
    run.snapshot.colors = dominantColors(capture.metrics);
  }

  const stored = await storeImage(run, kind, capture.image, capture.capturedAt, noArchive);
  tallyStorage(tally, stored);
  records.push(
    captureRecord(kind, capture.url, viewport, {
      state: 'captured',
      storage: stored.storage,
      detail: stored.detail,
      attempts,
    }),
  );

  const sourceId = run.deps.newId();
  const excerpt = captureExcerpt(capture.metrics, capture.url, capture.capturedAt, textOptions);
  const header = excerpt.split('\n')[0] ?? excerpt;
  const locator = {
    bbox: [0, 0, capture.image.width, capture.image.height] as [number, number, number, number],
  };
  const where = CAPTURE_VIEWPORT_LABELS[viewport];
  const host = hostOf(capture.url);
  const day = brazilianDay(capture.capturedAt);
  const captureClaim: ClaimDraftItem = {
    id: run.deps.newId(),
    claim: {
      schemaVersion: 1,
      subjectType: 'company',
      subjectId: run.company.id,
      domain: 'visual',
      key: INVESTIGATION_KEYS.capture(kind),
      statement: `A página inicial de ${host} foi capturada no ${where} em ${day}.`,
      value: {
        viewport,
        page: 'home',
        region: 'top',
        url: capture.url,
        width: capture.image.width,
        height: capture.image.height,
        storagePath: stored.storagePath,
        sha256: capture.image.sha256,
        // A tela explica por que não há imagem: pedido do site, pasta ausente ou falha.
        noArchive,
        storage: stored.storage,
      },
      epistemicType: 'fact',
      evidence: [{ sourceId, quote: header, locator }],
      isDemo: run.company.isDemo,
    },
  };
  const metricClaims: ClaimDraftItem[] = metricFacts(capture.metrics, textOptions).map((fact) => ({
    id: run.deps.newId(),
    claim: {
      schemaVersion: 1,
      subjectType: 'company',
      subjectId: run.company.id,
      domain: fact.domain,
      key: fact.key,
      statement: fact.statement,
      value: { ...fact.value, viewport },
      epistemicType: 'fact',
      evidence: [{ sourceId, quote: fact.quote, locator }],
      isDemo: run.company.isDemo,
    },
  }));

  const sources: Array<{ id: string; source: SourceInputDraft }> = [
    {
      id: sourceId,
      source: screenshotSource(run, {
        url: capture.url,
        capturedAt: capture.capturedAt,
        image: capture.image,
        storagePath: stored.storagePath,
        title: capture.metrics.title,
        excerpt,
        noArchive,
      }),
    },
  ];
  const extraClaims: ClaimDraftItem[] = [];
  for (const extra of capture.extras ?? []) {
    const extraKind = captureKindOf({ page: 'home', viewport, region: extra.region });
    if (!extraKind) continue;
    run.usage.captureBytes += extra.image.bytes.length;
    const item = await extraImageItems(run, {
      kind: extraKind,
      viewport,
      url: capture.url,
      capturedAt: capture.capturedAt,
      image: extra.image,
      title: capture.metrics.title,
      noArchive,
      statement:
        extra.region === 'footer'
          ? `O rodapé da página inicial de ${host} foi capturado no ${where} em ${day}.`
          : `O menu de navegação de ${host} foi capturado aberto no ${where} em ${day}.`,
      partLabel: extra.region === 'footer' ? 'do rodapé' : 'do menu de navegação aberto',
    });
    tallyStorage(tally, item.stored);
    records.push(
      captureRecord(extraKind, capture.url, viewport, {
        state: 'captured',
        storage: item.stored.storage,
        detail: item.stored.detail,
        attempts,
      }),
    );
    sources.push(item.source);
    extraClaims.push(item.claim);
  }
  for (const part of capture.missing ?? []) {
    const missingKind = captureKindOf({ page: 'home', viewport, region: part.region });
    if (!missingKind) continue;
    records.push(
      captureRecord(missingKind, capture.url, viewport, {
        state: part.reason === 'failed' ? 'failed' : 'missing',
        storage: null,
        detail: MISSING_TEXT[part.region][part.reason],
        attempts,
      }),
    );
  }

  const accepted = await recordStep(run, {
    action: 'company.investigation.capture',
    sources,
    claims: [captureClaim, ...extraClaims, ...metricClaims],
  });
  tally.claims += accepted.size;
}

/** Página interna relevante numa janela: só as primeiras telas, sem medições (são da inicial). */
async function recordInnerCapture(
  run: Run,
  capture: BrandCapture,
  page: PageMemo,
  attempts: number,
  records: CaptureRecord[],
  tally: CaptureTally,
): Promise<void> {
  const { viewport } = capture;
  const kind: CaptureKind = viewport === 'desktop' ? 'inner_desktop' : 'inner_mobile';
  const noArchive = capture.noArchive === true || page.noArchive;
  run.usage.captures += 1;
  run.usage.captureBytes += capture.image.bytes.length;
  const label = INNER_PAGE_LABELS[page.category] ?? 'interna';
  const where = CAPTURE_VIEWPORT_LABELS[viewport];
  const item = await extraImageItems(run, {
    kind,
    viewport,
    url: capture.url,
    capturedAt: capture.capturedAt,
    image: capture.image,
    title: capture.metrics.title,
    noArchive,
    statement: `A página ${label} de ${hostOf(capture.url)} foi capturada no ${where} em ${brazilianDay(capture.capturedAt)}.`,
    partLabel: `da página ${label}`,
  });
  tallyStorage(tally, item.stored);
  records.push(
    captureRecord(kind, capture.url, viewport, {
      state: 'captured',
      storage: item.stored.storage,
      detail: item.stored.detail,
      attempts,
    }),
  );
  const accepted = await recordStep(run, {
    action: 'company.investigation.capture',
    sources: [item.source],
    claims: [item.claim],
  });
  tally.claims += accepted.size;
}

export async function stepCapture(run: Run): Promise<StepOutcome> {
  if (!run.siteUrl) return { state: 'skipped', issue: 'no_site' };
  if (run.snapshot.siteReachable === false) return { state: 'skipped', issue: 'site_unreachable' };
  const capturer = run.deps.capturer;
  if (!capturer) return { state: 'skipped', issue: 'capture_unavailable' };
  const home = run.pages[0]?.url ?? run.siteUrl;
  const homeHost = hostOf(home);
  // Página interna do mesmo endereço do site primeiro (suporte e blog em subdomínio são outro site).
  const innerCandidates = (sameHost: boolean) =>
    INNER_PAGE_ORDER.map((category) =>
      run.pages.find(
        (page) =>
          page.category === category &&
          page.url !== home &&
          (hostOf(page.url) === homeHost) === sameHost,
      ),
    ).find((page): page is PageMemo => page !== undefined);
  const inner = innerCandidates(true) ?? innerCandidates(false) ?? null;
  const failures: BrandCaptureFailure[] = [];
  const records: CaptureRecord[] = [];
  const tally: CaptureTally = { stored: 0, reused: 0, notStored: 0, claims: 0 };

  for (const viewport of VIEWPORTS) {
    run.signal.throwIfAborted();
    const extras: CaptureExtrasRequest = { footer: true, menu: viewport === 'mobile' };
    const { result, attempts } = await captureWithRetry(run, capturer, home, viewport, extras);
    if (!result.ok) {
      failures.push(result.failure);
      records.push(
        captureRecord(viewport === 'desktop' ? 'site_desktop' : 'site_mobile', home, viewport, {
          state: 'failed',
          storage: null,
          detail: CAPTURE_FAILURE_TEXT[result.failure],
          attempts,
        }),
      );
      continue;
    }
    await recordHomeCapture(run, result.capture, attempts, records, tally);
  }

  // A página interna só vale a tentativa se a inicial abriu (site bloqueado bloqueia as duas).
  if (inner && run.usage.captures > 0) {
    for (const viewport of VIEWPORTS) {
      run.signal.throwIfAborted();
      const { result, attempts } = await captureWithRetry(run, capturer, inner.url, viewport, null);
      if (!result.ok) {
        const kind: CaptureKind = viewport === 'desktop' ? 'inner_desktop' : 'inner_mobile';
        records.push(
          captureRecord(kind, inner.url, viewport, {
            state: 'failed',
            storage: null,
            detail: CAPTURE_FAILURE_TEXT[result.failure],
            attempts,
          }),
        );
        continue;
      }
      await recordInnerCapture(run, result.capture, inner, attempts, records, tally);
    }
  }
  run.snapshot.captures = records.slice(0, 16);

  if (run.usage.captures === 0) {
    const blocked = failures.some((failure) =>
      ['robots_disallowed', 'access_denied', 'restricted_site', 'blocked_address'].includes(
        failure,
      ),
    );
    const missing = failures.includes('browser_missing') || failures.includes('disabled');
    return {
      state: 'failed',
      issue: blocked ? 'site_blocked' : missing ? 'capture_unavailable' : 'site_unreachable',
      counts: { captures: 0 },
    };
  }
  const issue = !run.deps.captureStore
    ? 'capture_storage_missing'
    : tally.notStored > 0
      ? 'capture_storage_failed'
      : records.some((record) => record.state === 'failed')
        ? 'capture_partial'
        : null;
  return {
    state: 'done',
    issue,
    counts: {
      captures: run.usage.captures,
      images: records.filter((record) => record.state === 'captured').length,
      stored: tally.stored,
      reused: tally.reused,
      notStored: tally.notStored,
      claims: tally.claims,
    },
  };
}

// -----------------------------------------------------------------------------
// signals: acontecimentos da empresa na internet (diretriz 2026-11-26, Parte 2.3)
// -----------------------------------------------------------------------------

/**
 * Matérias lidas por investigação, no máximo. O leitor é do Prospector (sem crédito de busca),
 * mas cada leitura leva alguns segundos: só os acontecimentos que mudam a leitura comercial
 * (`DEEP_READ_EVENTS`) são lidos; os demais ficam como hipótese a partir do título.
 */
const MAX_EVENT_PAGES = 2;
/** Acontecimentos distintos gravados por investigação. */
const MAX_EVENTS = 6;

/** Tipos de acontecimento que o texto (título e trecho de um resultado de busca) menciona. */
export function signalCodes(text: string): string[] {
  return detectEventTypes(text);
}

/** Por que a matéria de origem não foi usada: muda o que se guarda e o que se explica. */
type EventPageRefusal = 'unavailable' | 'no_archive' | 'off_topic';

const REFUSAL_NOTE: Readonly<Record<EventPageRefusal, string>> = {
  unavailable:
    'A página não pôde ser lida (fora do ar, bloqueio a robôs ou tela anti-robô): fica o título do resultado de busca.',
  no_archive:
    'A página pede para não guardar cópia (noarchive): guardado só o título do resultado de busca.',
  off_topic: 'A página lida não cita a empresa junto com o acontecimento.',
};

interface EventPageRead {
  readonly ok: true;
  readonly source: SourceInputDraft;
  /** Título da página lida (está na fonte), no lugar do título do resultado de busca. */
  readonly title: string | null;
  /**
   * Trecho da evidência: o ledger aceita uma evidência por fonte, então vai o mais forte (o do
   * valor, quando há; senão a frase que cita a empresa). Todos os trechos ficam na fonte, ao lado
   * do campo que sustentam no valor do acontecimento.
   */
  readonly quote: string;
  readonly funding: FundingDetails | null;
  /** Procura declarada (Caso 5): o que a empresa procura, prazo e canal, com trechos. */
  readonly demand: DemandDetails | null;
}

type EventPageOutcome = EventPageRead | { readonly ok: false; readonly reason: EventPageRefusal };

/**
 * Lê a matéria de origem e devolve só o que tem trecho literal: a frase que cita a empresa e o
 * acontecimento e, num investimento, valor, rodada, investidores, finalidade e contexto, lidos só
 * das frases que falam da empresa (`extractCompanyFunding`), nunca do menu ou de outra matéria da
 * mesma página. A fonte guarda o título e esses trechos (não a matéria inteira, ADR-0012). Página fora
 * do ar ou com tela anti-robô, página que pede para não guardar cópia e matéria que não cita a
 * empresa voltam com o motivo.
 */
async function readEventPage(
  run: Run,
  url: string,
  tokens: readonly string[],
  type: BusinessEventType,
  publishedAt: string | null,
): Promise<EventPageOutcome> {
  const web = run.deps.webResearch;
  if (!web) return { ok: false, reason: 'unavailable' };
  const read = await web.readPage(run.ctx, { url });
  if (!read.ok) return { ok: false, reason: 'unavailable' };
  if (read.page.noArchive) return { ok: false, reason: 'no_archive' };
  if (!read.page.text.trim()) return { ok: false, reason: 'unavailable' };
  run.usage.pagesRead += 1;
  const page = read.page;
  const title = page.title ? cut(page.title, 300) : null;
  const body = [title, page.text].filter(Boolean).join('\n');
  const lead = eventLeadQuote(body, tokens, type);
  if (!lead) return { ok: false, reason: 'off_topic' };
  const funding = type === 'funding' ? extractCompanyFunding(title, page.text, tokens) : null;
  // Procura declarada: lida só das frases que citam a empresa e das três seguintes (onde costumam
  // vir prazo e canal); o ano de um prazo sem ano vem da data da publicação.
  const demand =
    type === 'explicit_demand'
      ? extractDemand(
          companyPassage(body, tokens, 3),
          publishedAt ?? run.deps.clock.now().toISOString().slice(0, 10),
          run.company.primaryDomain ? [run.company.primaryDomain] : [],
        )
      : null;
  const demandQuotes = demand
    ? [demand.need.quote, demand.deadline?.quote, demand.responsible?.quote].filter(
        (item): item is string => Boolean(item),
      )
    : [];
  const quotes = [...new Set([lead, ...(funding ? fundingQuotes(funding) : []), ...demandQuotes])];
  const quote = funding?.amount?.quote ?? funding?.round?.quote ?? demand?.need.quote ?? lead;
  const excerpt = [title, ...quotes.filter((item) => item !== title)]
    .filter((part): part is string => Boolean(part))
    .join('\n[…]\n');
  return {
    ok: true,
    source: {
      schemaVersion: 1,
      kind: 'web_page',
      url: page.url,
      provider: 'prospector',
      capturedAt: page.fetchedAt,
      contentHash: page.contentHash,
      mime: page.contentType,
      httpStatus: page.httpStatus,
      title,
      excerptText: excerpt,
      licenseNote:
        'Matéria pública lida pelo leitor do Prospector; guardados só o título e os trechos citados, como evidência (ADR-0012).',
      retentionUntil: retention(page.fetchedAt),
      isDemo: run.company.isDemo,
    },
    title,
    quote,
    funding,
    demand,
  };
}

/** Enunciado do fato: o que a fonte informa, sem interpretação. */
function eventStatement(event: BusinessEvent, label: string): string {
  const when = event.occurredOn ? ` (${brazilianPartialDate(event.occurredOn)})` : '';
  const funding = event.funding;
  if (event.type === 'funding' && funding && (funding.amount || funding.round)) {
    const what = [
      funding.round?.text,
      funding.amountCents !== null ? formatBrlAmount(funding.amountCents) : funding.amount?.text,
    ]
      .filter(Boolean)
      .join(' de ');
    const investors =
      funding.investors.length > 0
        ? `, com ${funding.investors.map((investor) => investor.text).join(' e ')}`
        : '';
    const purpose =
      funding.purpose.status === 'declared'
        ? ` Finalidade declarada: ${funding.purpose.value.text}.`
        : ' A fonte não informa a finalidade dos recursos.';
    return cut(`Matéria em ${event.host}${when} informa ${what}${investors}.${purpose}`, 480);
  }
  const demand = event.demand;
  if (event.type === 'explicit_demand' && demand) {
    const deadline = demand.deadline ? `, com prazo ${demand.deadline.text}` : '';
    const channel = demand.responsible ? `; respostas por ${demand.responsible.text}` : '';
    return cut(
      `Publicação em ${event.host}${when} informa que a empresa procura ${demand.need.text}${deadline}${channel}.`,
      480,
    );
  }
  return cut(`Matéria em ${event.host}${when} informa ${label}: "${event.headline}".`, 480);
}

/**
 * O enunciado de um fato chega às capacidades de IA (mensagem, Copiloto). Título, investidores e
 * finalidade vêm da matéria: se o texto se dirige a máquinas ("ignore as instruções…"), o
 * enunciado fica só com o que o sistema escreve, e o texto externo fica na fonte e no valor.
 */
function factStatement(event: BusinessEvent, label: string): { text: string; guarded: boolean } {
  const statement = eventStatement(event, label);
  if (!looksLikeInjection(statement)) return { text: statement, guarded: false };
  const when = event.occurredOn ? ` (${brazilianPartialDate(event.occurredOn)})` : '';
  return { text: `Matéria em ${event.host}${when} informa ${label}.`, guarded: true };
}

function corroboration(event: BusinessEvent): string {
  const parts = [
    event.confirmedBy.length > 0
      ? `Confirmado por fonte independente: ${event.confirmedBy.join(', ')}.`
      : 'Sem confirmação independente.',
    event.republishedBy.length > 0
      ? `Republicações (${event.republishedBy.join(', ')}) não contam como confirmação.`
      : '',
    ...event.conflicts,
  ];
  return parts.filter(Boolean).join(' ');
}

/**
 * Método atual da busca de sinais (ver `InvestigationSnapshot.signalsMethod`). Mudou a forma de
 * investigar os acontecimentos: suba o número, para a busca da análise anterior não ser reaproveitada.
 * 3 (2026-11-27): lê as matérias dos sinais já gravados pela Descoberta e faz a consulta voltada a
 * acontecimentos quando a primeira não acha nenhum.
 * 4 (2026-11-27): a mesma matéria guardada duas vezes (menção e sinal) vira um candidato só, com a
 * data de publicação do sinal.
 */
export const SIGNALS_METHOD = 4;

/** ADR-0015: uma investigação gasta de 1 a 3 buscas (site, sinais, concorrentes). */
const MAX_SEARCHES_PER_RUN = 3;

/** Resultado de busca ou página de sinal já gravado; `stored` marca o segundo caso. */
type EventCandidate = EventReport & { readonly stored?: true };

/**
 * Validação real do Flash (27/11): a matéria da rodada Série D estava gravada como sinal da
 * Descoberta, mas a busca de sinais não a trouxe e ela nunca foi lida. As páginas dos sinais da
 * Descoberta (`signal.<tipo>`) e das menções guardadas entram como candidatas a acontecimento, na
 * frente dos resultados da busca. Não gastam crédito: só a leitura, que confere de novo se a página
 * cita a empresa junto com o acontecimento.
 */
async function storedEventCandidates(run: Run): Promise<EventCandidate[]> {
  const claims = [...run.inForce.values()].filter(
    (claim) =>
      (claim.key.startsWith('signal.') &&
        !claim.key.startsWith('signal.web.') &&
        !claim.key.startsWith('signal.site.')) ||
      claim.key === WEB_MENTION_KEY,
  );
  if (claims.length === 0) return [];
  const evidence = await run.deps.evidence.evidenceFor(claims.map((claim) => claim.id));
  const sourceIds = [...new Set(evidence.map((item) => item.sourceId))];
  const sources = sourceIds.length ? await run.deps.evidence.sourcesByIds(sourceIds) : [];
  const byId = new Map(sources.map((source) => [source.id, source]));
  const candidates: EventCandidate[] = [];
  for (const claim of claims) {
    const item = evidence.find((entry) => entry.claimId === claim.id);
    const source = item ? byId.get(item.sourceId) : undefined;
    const url = source?.url ?? (typeof claim.value?.url === 'string' ? claim.value.url : null);
    if (!url) continue;
    const publishedAt =
      typeof claim.value?.publishedAt === 'string' ? claim.value.publishedAt : null;
    const candidate: EventCandidate = {
      url,
      title: source?.title ?? '',
      // O trecho citado da fonte, não o resumo da IA da Descoberta.
      snippet: item?.quote ?? '',
      publishedAt,
      stored: true,
    };
    // A mesma matéria pode estar guardada duas vezes (menção sem data e sinal da Descoberta com
    // a data de publicação; validação da Flash, 27/11): junta as duas, sem perder data nem trecho.
    const same = candidates.findIndex((entry) => sameUrl(entry.url, url));
    if (same === -1) {
      candidates.push(candidate);
      continue;
    }
    const kept = candidates[same]!;
    candidates[same] = {
      ...kept,
      title: kept.title || candidate.title,
      snippet: kept.snippet || candidate.snippet,
      publishedAt: kept.publishedAt ?? candidate.publishedAt,
    };
  }
  return candidates;
}

/** Consulta voltada a acontecimentos (método 3), usada quando a primeira não acha nenhum. */
function eventQuery(run: Run): string {
  return `"${run.company.displayName}" investimento OR rodada OR aquisição OR expansão OR lançamento OR contratação`;
}

function sameUrl(a: string, b: string): boolean {
  return a.replace(/\/$/, '').toLowerCase() === b.replace(/\/$/, '').toLowerCase();
}

export async function stepSignals(run: Run): Promise<StepOutcome> {
  const web = run.deps.webResearch;
  if (!web) return { state: 'skipped', issue: 'search_unavailable' };
  const sameMethod = run.previous?.snapshot?.signalsMethod === SIGNALS_METHOD;
  if (sameMethod && reusable(run, 'signals', REUSE_SEARCH_DAYS)) {
    run.snapshot.signals = run.previous?.snapshot?.signals ?? [];
    run.snapshot.signalsMethod = SIGNALS_METHOD;
    markSearched(run, 'signals', searchedAt(run, 'signals'));
    return { state: 'reused', counts: { found: run.snapshot.signals.length } };
  }
  const query = [`"${run.company.displayName}"`, run.company.city].filter(Boolean).join(' ');
  const outcome = await web.search(run.ctx, {
    query,
    maxResults: 8,
    timeRange: 'year',
    ...(run.company.primaryDomain ? { excludeDomains: [run.company.primaryDomain] } : {}),
  });
  if (!outcome.ok) return { state: 'failed', issue: searchIssue(outcome) };
  countSearch(run, outcome.creditsCharged);
  markSearched(run, 'signals', run.deps.clock.now().toISOString());

  const tokens = nameTokens(run.company.displayName).slice(0, 2);
  const citesCompany = (result: EventReport) => {
    const text = fold(`${result.title} ${result.snippet}`);
    return tokens.length === 0 || tokens.every((token) => text.includes(token));
  };
  let results: EventCandidate[] = outcome.results.filter(citesCompany);
  // A primeira consulta (nome e cidade) não trouxe nenhum acontecimento: uma consulta voltada a
  // acontecimentos, só se ainda sobra uma busca para os concorrentes (teto do ADR-0015).
  if (
    groupEventReports(results, run.company.primaryDomain).length === 0 &&
    run.usage.searches + 1 < MAX_SEARCHES_PER_RUN
  ) {
    const second = await web.search(run.ctx, {
      query: eventQuery(run),
      maxResults: 8,
      timeRange: 'year',
      ...(run.company.primaryDomain ? { excludeDomains: [run.company.primaryDomain] } : {}),
    });
    if (second.ok) {
      countSearch(run, second.creditsCharged);
      results = [
        ...results,
        ...second.results
          .filter(citesCompany)
          .filter((result) => !results.some((known) => sameUrl(known.url, result.url))),
      ];
    }
  }
  // Os sinais já gravados vêm primeiro: são os primeiros a ser lidos.
  const stored = (await storedEventCandidates(run)).filter(
    (candidate) => !results.some((result) => sameUrl(result.url, candidate.url)),
  );
  const mentions: EventCandidate[] = [...stored, ...results];
  // Parte 3.3: mesma notícia em vários sites vira um acontecimento só, com a origem na frente.
  const groups = groupEventReports(mentions, run.company.primaryDomain).slice(0, MAX_EVENTS);
  const sources: Array<{ id: string; source: SourceInputDraft }> = [];
  const claims: ClaimDraftItem[] = [];
  const labels: string[] = [];
  let reads = 0;
  for (const group of groups) {
    run.signal.throwIfAborted();
    let result = group.origin;
    const label = BUSINESS_EVENT_LABELS[group.type];
    let page: EventPageOutcome | null = null;
    if (DEEP_READ_EVENTS.has(group.type) && reads < MAX_EVENT_PAGES) {
      reads += 1;
      page = await readEventPage(run, result.url, tokens, group.type, result.publishedAt);
    }
    const read = page?.ok ? page : null;
    if (!read && result.stored) {
      // A página do sinal guardado não foi lida: o sinal da Descoberta continua no ledger como
      // estava. Fica a hipótese de um resultado da busca do mesmo grupo, se houver.
      const fromSearch = group.members.find((member) => !member.stored);
      if (!fromSearch) continue;
      result = fromSearch;
    }
    const occurredOn = result.publishedAt ? result.publishedAt.slice(0, 10) : null;
    const draft: BusinessEvent = {
      type: group.type,
      occurredOn,
      dateBasis: occurredOn ? 'published' : 'unknown',
      // Página lida: o título é o dela (está na fonte); senão, o do resultado de busca.
      headline: read?.title ?? (cut(result.title, 300) || label),
      url: result.url,
      host: hostOf(result.url),
      sourceTier: group.originTier,
      republishedBy: group.republishedBy,
      confirmedBy: group.confirmedBy,
      conflicts: group.conflicts,
      pageRead: read !== null,
      funding: read?.funding ?? null,
      demand: read?.demand ?? null,
    };
    // O valor guardado passa pelo contrato: fora dele, o sinal é gravado sem o acontecimento
    // estruturado (e fica fora da tese), com aviso no log em vez de sumir em silêncio.
    const checked = BusinessEvent.safeParse(draft);
    if (!checked.success) {
      console.warn(
        '[investigacao] acontecimento fora do contrato',
        checked.error.issues.slice(0, 3).map((issue) => issue.path.join('.')),
      );
    }
    // Texto da página que se dirige a máquinas não fica no acontecimento estruturado (vai para a
    // tese e dali para a mensagem): fica só na fonte.
    const raw = checked.success ? checked.data : draft;
    const event = guardEventText(raw);
    const textGuarded = event !== raw;
    const value = {
      code: group.type,
      label,
      url: result.url,
      publishedAt: result.publishedAt,
      ...(checked.success ? { event } : {}),
    };
    // Tipo, site e começo do título do resultado: duas notícias do mesmo tipo no mesmo site não
    // se sobrepõem, e a mesma matéria numa análise seguinte substitui a versão anterior.
    const key = INVESTIGATION_KEYS.webSignal(`${group.type} ${event.host} ${result.title}`);
    // Parte 3.3: cada site com apuração própria entra como evidência do mesmo claim (uma fonte por
    // evidência; republicação não entra). Assim a confiança calculada no servidor os considera.
    const confirmations: Array<{ id: string; source: SourceInputDraft & { title: string } }> = [];
    for (const host of group.confirmedBy) {
      if (confirmations.length + 1 >= CLAIM_EVIDENCE_LIMIT) break;
      const member = group.members.find((item) => !item.stored && bareHost(item.url) === host);
      if (!member) continue;
      const source = searchSource(run, member, outcome);
      if (!source.title) continue;
      confirmations.push({ id: run.deps.newId(), source });
    }
    sources.push(...confirmations);
    const confirmationEvidence = confirmations.map(({ id, source }) => ({
      sourceId: id,
      quote: source.title,
    }));
    const sourceId = run.deps.newId();
    if (read) {
      const statement = factStatement(event, label);
      sources.push({ id: sourceId, source: read.source });
      claims.push({
        id: run.deps.newId(),
        claim: {
          schemaVersion: 1,
          subjectType: 'company',
          subjectId: run.company.id,
          domain: 'signal',
          key,
          statement: statement.text,
          value,
          // O fato é o que a fonte informa; o que isso significa para a empresa é interpretação
          // do motor de compatibilidade, e a oportunidade, hipótese (Parte 3.1).
          epistemicType: 'fact',
          evidence: [{ sourceId, quote: read.quote }, ...confirmationEvidence],
          reasoning: cut(
            [
              'Matéria lida pelo leitor do Prospector; o trecho cita a empresa e o acontecimento.',
              corroboration(event),
              statement.guarded || textGuarded
                ? 'O texto da matéria trazia frases dirigidas a sistemas automatizados: ficou só na fonte, fora do enunciado.'
                : '',
            ]
              .filter(Boolean)
              .join(' '),
            800,
          ),
          isDemo: run.company.isDemo,
        },
      });
    } else {
      const found = searchSource(run, result, outcome);
      const refusal = page && !page.ok ? page.reason : null;
      const source = refusal === 'no_archive' ? { ...found, excerptText: found.title } : found;
      sources.push({ id: sourceId, source });
      claims.push({
        id: run.deps.newId(),
        claim: {
          schemaVersion: 1,
          subjectType: 'company',
          subjectId: run.company.id,
          domain: 'signal',
          key,
          statement: `Resultado de pesquisa em ${event.host}${
            result.publishedAt ? ` (${brazilianDay(result.publishedAt)})` : ''
          } pode indicar ${label} — a conferir.`,
          value,
          epistemicType: 'hypothesis',
          evidence: [{ sourceId, quote: source.title }, ...confirmationEvidence],
          reasoning: cut(
            [
              `O título ou o trecho do resultado cita a empresa junto com termos de ${label}.`,
              refusal ? REFUSAL_NOTE[refusal] : 'A página não foi lida.',
              corroboration(event),
            ].join(' '),
            800,
          ),
          isDemo: run.company.isDemo,
        },
      });
    }
    labels.push(label);
  }
  run.snapshot.signals = [...new Set(labels)].slice(0, 10);
  run.snapshot.signalsMethod = SIGNALS_METHOD;
  if (claims.length === 0) return { state: 'done', counts: { found: 0 } };
  const accepted = await recordStep(run, {
    action: 'company.investigation.signals',
    sources,
    claims,
  });
  return { state: 'done', counts: { found: accepted.size, read: reads } };
}

// -----------------------------------------------------------------------------
// competitors: pesquisa, triagem da IA e leitura das páginas dos escolhidos
// -----------------------------------------------------------------------------

const MAX_COMPETITORS = 3;

function sameQueries(a: readonly string[] | undefined, b: readonly string[]): boolean {
  return a !== undefined && a.length === b.length && a.every((query, index) => query === b[index]);
}

export async function stepCompetitors(run: Run): Promise<StepOutcome> {
  const web = run.deps.webResearch;
  if (!web) return { state: 'skipped', issue: 'search_unavailable' };
  const existing = claimsWithPrefix(run, 'competitive.competitor.');
  if (existing.length > 0 && reusable(run, 'competitors', REUSE_SEARCH_DAYS)) {
    run.snapshot.competitors = run.previous?.snapshot?.competitors ?? [];
    run.snapshot.competitorQueries = run.previous?.snapshot?.competitorQueries;
    markSearched(run, 'competitors', searchedAt(run, 'competitors'));
    return { state: 'reused', counts: { kept: existing.length } };
  }

  const offering = claimsWithPrefix(run, 'positioning.offering.')
    .filter((claim) => claim.epistemicType === 'fact')
    .map((claim) => (typeof claim.value?.label === 'string' ? claim.value.label : null))
    .find((label): label is string => Boolean(label));
  const cnae = run.inForce.get('registry.cnae_main')?.value;
  const activity = typeof cnae?.description === 'string' ? cnae.description : null;
  const segment = run.inForce.get(INVESTIGATION_KEYS.segment);
  const home = run.pages.find((page) => page.category === 'home') ?? run.pages[0];
  // O ramo antes do produto: "rações em Curitiba PR" só trazia lojas virtuais (KI-152).
  const queries = competitorSearchQueries({
    segment:
      segment?.epistemicType === 'fact' && typeof segment.value?.label === 'string'
        ? segment.value.label
        : null,
    titleSegment: segmentFromTitle(home?.title ?? null, {
      name: run.company.displayName,
      domain: run.company.primaryDomain,
      city: run.company.city,
    }),
    activity,
    offering: offering ?? null,
    city: run.company.city,
    uf: run.company.uf,
  });
  if (queries.length === 0) return { state: 'skipped', issue: 'not_enough_evidence' };
  // Pesquisa que voltou sem nenhum candidato, com as mesmas consultas, vale por 30 dias contados
  // da pesquisa real: repetir gastaria os mesmos créditos para o mesmo resultado. Quando houve
  // candidatos e a triagem recusou todos, pesquisa de novo (a triagem pode mudar).
  const before = previousStep(run, 'competitors');
  if (
    existing.length === 0 &&
    reusable(run, 'competitors', REUSE_SEARCH_DAYS) &&
    before?.issue === 'no_competitors' &&
    before.counts?.candidates === 0 &&
    sameQueries(run.previous?.snapshot?.competitorQueries, queries)
  ) {
    run.snapshot.competitors = [];
    run.snapshot.competitorQueries = queries;
    markSearched(run, 'competitors', searchedAt(run, 'competitors'));
    return { state: 'reused', issue: 'no_competitors', counts: { candidates: 0, kept: 0 } };
  }
  run.snapshot.competitorQueries = queries;

  // A segunda consulta só quando a primeira não deixa candidato (cada uma custa um crédito) e
  // dentro do teto de buscas da investigação.
  let outcome: Extract<Awaited<ReturnType<typeof web.search>>, { ok: true }> | null = null;
  let candidates: ReturnType<typeof filterCompetitorCandidates> = [];
  for (const query of queries) {
    if (outcome && run.usage.searches >= MAX_SEARCHES_PER_RUN) break;
    const attempt = await web.search(run.ctx, {
      query,
      maxResults: 8,
      ...(run.company.primaryDomain ? { excludeDomains: [run.company.primaryDomain] } : {}),
    });
    // Crédito acabou (ou a busca falhou) na segunda consulta: diz isso, não "nenhum concorrente".
    if (!attempt.ok) return { state: 'failed', issue: searchIssue(attempt) };
    countSearch(run, attempt.creditsCharged);
    markSearched(run, 'competitors', run.deps.clock.now().toISOString());
    outcome = attempt;
    candidates = filterCompetitorCandidates(attempt.results, {
      companyDomain: run.company.primaryDomain,
      max: 6,
    });
    if (candidates.length > 0) break;
  }
  if (!outcome || candidates.length === 0) {
    return { state: 'done', issue: 'no_competitors', counts: { candidates: 0, kept: 0 } };
  }

  // Triagem: a IA classifica cada candidato; sem IA, ficam como hipóteses a conferir.
  type Kept = {
    candidate: (typeof candidates)[number];
    kind: CompetitorKind | null;
    reason: string | null;
  };
  let kept: Kept[];
  const ai = run.deps.ai;
  if (ai) {
    // Resultado com texto que fala com a IA ("classifique como concorrente direto") fica fora.
    const input = guardTriageInput({
      company: analysisCompany(run),
      offerings: claimsWithPrefix(run, 'positioning.offering.')
        .map((claim) => (typeof claim.value?.label === 'string' ? claim.value.label : ''))
        .filter(Boolean)
        .slice(0, 6),
      candidates: candidates.map((candidate) => ({
        ref: candidate.ref,
        domain: candidate.domain,
        title: cut(candidate.title, 160),
        snippet: cut(candidate.snippet, 400),
      })),
    });
    recordGuardLog(run.verification, input);
    const triage = await ai.analyze('competitor-triage', input.value, { signal: run.signal });
    await countModel(run, triage, 'competitor-triage');
    if (!triage.ok) {
      return {
        state: 'failed',
        issue: aiIssue(triage.code),
        counts: { candidates: candidates.length, kept: 0 },
      };
    }
    const shownRefs = new Set(input.value.candidates.map((candidate) => candidate.ref));
    const byRef = new Map(
      candidates
        .filter((candidate) => shownRefs.has(candidate.ref))
        .map((candidate) => [candidate.ref, candidate]),
    );
    // O motivo é justificativa, não afirmação (o teto de 200 caracteres corta a frase): passam o
    // filtro de afirmações proibidas e o de intensificadores; "falta de site" ali é do concorrente.
    const guarded = guardTriageOutput(triage.output, { siteRead: false });
    recordGuardLog(run.verification, guarded);
    const order: Record<CompetitorKind, number> = {
      direct: 0,
      aspirational: 1,
      different_size: 2,
      unrelated: 3,
    };
    kept = guarded.value.candidates
      .map((item) => ({ item, candidate: byRef.get(item.ref.trim().toUpperCase()) }))
      .filter((entry) => {
        if (!entry.candidate)
          recordDiscard(run.verification, 'Concorrente citado que não estava na pesquisa.');
        return entry.candidate !== undefined && entry.item.kind !== 'unrelated';
      })
      .sort((a, b) => order[a.item.kind] - order[b.item.kind])
      .slice(0, MAX_COMPETITORS)
      .map((entry) => ({
        candidate: entry.candidate!,
        kind: entry.item.kind,
        reason: entry.item.reason,
      }));
  } else {
    kept = candidates
      .slice(0, MAX_COMPETITORS)
      .map((candidate) => ({ candidate, kind: null, reason: null }));
  }
  if (kept.length === 0) {
    run.snapshot.competitors = [];
    return {
      state: 'done',
      issue: 'no_competitors',
      counts: { candidates: candidates.length, kept: 0 },
    };
  }

  const sources: Array<{ id: string; source: SourceInputDraft }> = [];
  const claims: ClaimDraftItem[] = [];
  for (const { candidate, kind, reason } of kept) {
    run.signal.throwIfAborted();
    const read = await web.readPage(run.ctx, { url: candidate.url });
    const peerId = run.deps.newId();
    const sourceId = run.deps.newId();
    let quote: string;
    let statement: string;
    if (read.ok && !read.page.noArchive && read.page.text.trim()) {
      run.usage.pagesRead += 1;
      const page = read.page;
      const title = page.title ? cut(page.title, 300) : null;
      const start = cut(page.text, 500);
      quote = title ?? cut(page.text, 200).replace(/…$/, '');
      run.competitorTexts.set(candidate.domain, cut(page.text, 1500));
      sources.push({
        id: sourceId,
        source: {
          schemaVersion: 1,
          kind: 'web_page',
          url: page.url,
          provider: 'prospector',
          capturedAt: page.fetchedAt,
          contentHash: page.contentHash,
          mime: page.contentType,
          httpStatus: page.httpStatus,
          title,
          excerptText: [title, start].filter(Boolean).join('\n'),
          licenseNote:
            'Página pública de concorrente lida pelo leitor do Prospector; só o começo do texto foi guardado, como evidência.',
          retentionUntil: retention(page.fetchedAt),
          isDemo: run.company.isDemo,
        },
      });
      statement = `${candidate.domain} tem site próprio, lido em ${brazilianDay(page.fetchedAt)}.`;
    } else {
      const source = searchSource(run, { ...candidate, publishedAt: null }, outcome);
      sources.push({ id: sourceId, source });
      quote = source.title;
      run.competitorTexts.set(
        candidate.domain,
        cut(`${candidate.title}. ${candidate.snippet}`, 600),
      );
      statement = `${candidate.domain} aparece na pesquisa de empresas do mesmo ramo e região.`;
    }
    const value = { domain: candidate.domain, url: candidate.url, kind };
    claims.push({
      id: peerId,
      ownedOrigins: [candidate.domain],
      claim: {
        schemaVersion: 1,
        subjectType: 'company',
        subjectId: run.company.id,
        domain: 'competitive',
        key: INVESTIGATION_KEYS.peerPage(candidate.domain),
        statement,
        value,
        epistemicType: 'fact',
        evidence: [{ sourceId, quote }],
        isDemo: run.company.isDemo,
      },
    });
    claims.push({
      id: run.deps.newId(),
      claim:
        kind && reason
          ? {
              schemaVersion: 1,
              subjectType: 'company',
              subjectId: run.company.id,
              domain: 'competitive',
              key: INVESTIGATION_KEYS.competitor(candidate.domain),
              statement: `${candidate.domain}: ${COMPETITOR_KIND_LABELS[kind].toLowerCase()} (triagem da IA).`,
              value,
              epistemicType: 'inference',
              dependsOn: [peerId],
              reasoning: reason,
              reasoningFactor: 0.6,
              isDemo: run.company.isDemo,
            }
          : {
              schemaVersion: 1,
              subjectType: 'company',
              subjectId: run.company.id,
              domain: 'competitive',
              key: INVESTIGATION_KEYS.competitor(candidate.domain),
              statement: `${candidate.domain} pode ser concorrente (a conferir).`,
              value,
              epistemicType: 'hypothesis',
              dependsOn: [peerId],
              reasoning:
                'Apareceu na pesquisa por empresas do mesmo ramo e região; a IA local não classificou o candidato.',
              isDemo: run.company.isDemo,
            },
    });
  }
  const accepted = await recordStep(run, {
    action: 'company.investigation.competitors',
    sources,
    claims,
  });
  run.snapshot.competitors = kept.map((item) => item.candidate.domain);
  return {
    state: 'done',
    counts: { candidates: candidates.length, kept: kept.length, claims: accepted.size },
  };
}
