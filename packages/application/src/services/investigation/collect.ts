import {
  CAPTURE_VIEWPORT_LABELS,
  COMPETITOR_KIND_LABELS,
  INVESTIGATION_KEYS,
  keySlug,
  type CaptureViewport,
  type CompetitorKind,
  type SourceInputDraft,
  type WebSearchOutcome,
} from '@prospector/contracts';
import {
  captureExcerpt,
  competitorSearchQuery,
  dominantColors,
  filterCompetitorCandidates,
  isNotCompetitorDomain,
  metricFacts,
  recordDiscard,
  registrableDomain,
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
  rejectedByPolicy,
  retention,
  type ClaimDraftItem,
  type Run,
  type StepOutcome,
} from './run';

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

/** A etapa anterior ainda vale (feita há até `days` dias, sem pedido de coleta completa)? */
function reusable(run: Run, key: string, days: number): boolean {
  if (run.force) return false;
  const step = previousStep(run, key);
  if (!step || (step.state !== 'done' && step.state !== 'reused') || !step.finishedAt) return false;
  return daysBetween(step.finishedAt, run.deps.clock.now()) <= days;
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
    .map((result) => ({ result, domain: registrableDomain(result.url) }))
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
// capture: computador e celular, com medições
// -----------------------------------------------------------------------------

export async function stepCapture(run: Run): Promise<StepOutcome> {
  if (!run.siteUrl) return { state: 'skipped', issue: 'no_site' };
  if (run.snapshot.siteReachable === false) return { state: 'skipped', issue: 'site_unreachable' };
  const capturer = run.deps.capturer;
  if (!capturer) return { state: 'skipped', issue: 'capture_unavailable' };
  const target = run.pages[0]?.url ?? run.siteUrl;
  const failures: string[] = [];
  let stored = 0;
  let recorded = 0;

  for (const viewport of VIEWPORTS) {
    run.signal.throwIfAborted();
    const result = await capturer.capture(target, viewport, { signal: run.signal });
    if (!result.ok) {
      failures.push(result.failure);
      continue;
    }
    const { capture } = result;
    // O site pediu para não guardar cópia (na captura ou na leitura da mesma página): a imagem
    // vai à IA local nesta execução, mas não é guardada, e os textos da página (H1, botões) ficam
    // fora das evidências; fica o endereço, o título e as medições (ADR-0012 §2).
    const noArchive = capture.noArchive === true || run.pages[0]?.noArchive === true;
    const textOptions = { pageText: !noArchive };
    run.usage.captures += 1;
    run.usage.captureBytes += capture.image.bytes.length;
    run.images[viewport] = capture.image.bytes;
    run.snapshot.captureHashes[viewport] = capture.image.sha256;
    if (viewport === 'desktop') {
      run.snapshot.fonts = capture.metrics.fonts.slice(0, 5);
      run.snapshot.colors = dominantColors(capture.metrics);
    }

    let storagePath: string | null = null;
    if (run.deps.captureStore && !noArchive) {
      try {
        const saved = await run.deps.captureStore.put({
          companyId: run.company.id,
          investigationId: run.id,
          viewport,
          image: capture.image,
          capturedAt: capture.capturedAt,
        });
        storagePath = saved.storagePath;
        stored += 1;
      } catch {
        run.deps.log('[investigação] não foi possível guardar a captura');
      }
    }

    const sourceId = run.deps.newId();
    const excerpt = captureExcerpt(capture.metrics, capture.url, capture.capturedAt, textOptions);
    const header = excerpt.split('\n')[0] ?? excerpt;
    const locator = {
      bbox: [0, 0, capture.image.width, capture.image.height] as [number, number, number, number],
    };
    const where = CAPTURE_VIEWPORT_LABELS[viewport];
    const captureKey = INVESTIGATION_KEYS.capture(
      viewport === 'desktop' ? 'site_desktop' : 'site_mobile',
    );
    const captureClaim: ClaimDraftItem = {
      id: run.deps.newId(),
      claim: {
        schemaVersion: 1,
        subjectType: 'company',
        subjectId: run.company.id,
        domain: 'visual',
        key: captureKey,
        statement: `A página inicial de ${hostOf(capture.url)} foi capturada no ${where} em ${brazilianDay(capture.capturedAt)}.`,
        value: {
          viewport,
          url: capture.url,
          width: capture.image.width,
          height: capture.image.height,
          storagePath,
          sha256: capture.image.sha256,
          // A tela explica por que não há imagem: pedido do site, não pasta ausente.
          noArchive,
        },
        epistemicType: 'fact',
        evidence: [{ sourceId, quote: header, locator }],
        isDemo: run.company.isDemo,
      },
    };
    const metricClaims: ClaimDraftItem[] = metricFacts(capture.metrics, textOptions).map(
      (fact) => ({
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
      }),
    );
    const accepted = await recordStep(run, {
      action: 'company.investigation.capture',
      sources: [
        {
          id: sourceId,
          source: {
            schemaVersion: 1,
            kind: 'screenshot',
            url: capture.url,
            provider: 'prospector',
            capturedAt: capture.capturedAt,
            contentHash: capture.image.sha256,
            storagePath,
            mime: capture.image.mime,
            title: capture.metrics.title ? cut(capture.metrics.title, 300) : null,
            excerptText: excerpt,
            licenseNote: noArchive
              ? 'Captura automática da página pública (robots.txt respeitado). O site pede para não guardar cópia: a imagem foi analisada e descartada; ficam o endereço, o título e as medições.'
              : 'Captura automática da página pública pelo navegador do Prospector (robots.txt respeitado), guardada só como evidência.',
            retentionUntil: retention(capture.capturedAt),
            isDemo: run.company.isDemo,
          },
        },
      ],
      claims: [captureClaim, ...metricClaims],
    });
    recorded += accepted.size;
    // Uma imagem por janela e por empresa: as anteriores, substituídas por esta captura, são
    // apagadas (o que mudou entre elas fica pelos hashes). Só depois de a nova entrar no ledger.
    if (accepted.has(captureClaim.id)) await dropOlderCaptures(run, captureKey, storagePath);
  }

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
  return {
    state: 'done',
    issue: run.deps.captureStore ? null : 'capture_storage_missing',
    counts: { captures: run.usage.captures, stored, claims: recorded },
  };
}

/**
 * Apaga as imagens das capturas anteriores desta janela (claims em vigor, substituídos ou
 * vencidos). O claim e a fonte continuam no ledger, com o hash; só o arquivo sai. Falha ao apagar
 * não derruba a investigação: fica no log, sem caminho.
 */
async function dropOlderCaptures(run: Run, key: string, keep: string | null): Promise<void> {
  const store = run.deps.captureStore;
  if (!store) return;
  const claims = await run.deps.evidence.claimsFor('company', run.company.id, {
    includeSuperseded: true,
  });
  const older = new Set<string>();
  for (const claim of claims) {
    const path = claim.key === key ? claim.value?.storagePath : null;
    if (typeof path === 'string' && path !== keep) older.add(path);
  }
  for (const path of older) {
    try {
      await store.delete(path);
    } catch {
      run.deps.log('[investigação] não foi possível apagar uma captura anterior');
    }
  }
}

// -----------------------------------------------------------------------------
// signals: menções recentes da empresa (hipóteses a conferir)
// -----------------------------------------------------------------------------

const SIGNAL_PATTERNS: ReadonlyArray<{ code: string; label: string; pattern: RegExp }> = [
  {
    code: 'brand_change',
    label: 'mudança de marca',
    pattern: /\b(nova marca|nova identidade|rebranding|novo logo|repaginad|nova logomarca)/,
  },
  {
    code: 'expansion',
    label: 'expansão ou nova unidade',
    pattern:
      /\b(inaugur|nova unidade|nova loja|nova filial|nova clinica|expans|abre as portas|abertura d)/,
  },
  {
    code: 'launch',
    label: 'lançamento',
    pattern: /\b(lanca|lancamento|novo produto|nova linha|novo servico)/,
  },
  {
    code: 'move',
    label: 'mudança de endereço ou reforma',
    pattern: /\b(novo endereco|mudou[- ]se|nova sede|reforma)/,
  },
  { code: 'hiring', label: 'contratação', pattern: /\b(vagas?|contratando|processo seletivo)\b/ },
  {
    code: 'award',
    label: 'prêmio ou certificação',
    // "premi" sozinho pegaria "premium" (nome de linha de produto).
    pattern: /\b(premio|premios|premiad|premiacao|certificad|certificacao)/,
  },
  {
    code: 'anniversary',
    label: 'aniversário da empresa',
    // Só idade da empresa: "45 anos de idade" de uma pessoa não é sinal (e é dado pessoal).
    pattern:
      /\b(\d{1,3} anos de (historia|mercado|tradicao|atuacao|experiencia|fundacao)|aniversario da (empresa|loja|marca|clinica))/,
  },
];

/** Códigos de sinal que o texto (título e trecho de um resultado de busca) menciona. */
export function signalCodes(text: string): string[] {
  const folded = fold(text);
  return SIGNAL_PATTERNS.filter((signal) => signal.pattern.test(folded)).map(
    (signal) => signal.code,
  );
}

export async function stepSignals(run: Run): Promise<StepOutcome> {
  const web = run.deps.webResearch;
  if (!web) return { state: 'skipped', issue: 'search_unavailable' };
  if (reusable(run, 'signals', REUSE_SEARCH_DAYS)) {
    run.snapshot.signals = run.previous?.snapshot?.signals ?? [];
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

  const tokens = nameTokens(run.company.displayName).slice(0, 2);
  const found = new Map<string, { result: (typeof outcome.results)[number]; label: string }>();
  for (const result of outcome.results) {
    const text = fold(`${result.title} ${result.snippet}`);
    if (tokens.length > 0 && !tokens.every((token) => text.includes(token))) continue;
    for (const signal of SIGNAL_PATTERNS) {
      if (found.has(signal.code) || !signal.pattern.test(text)) continue;
      found.set(signal.code, { result, label: signal.label });
      break;
    }
  }
  const sources: Array<{ id: string; source: ReturnType<typeof searchSource> }> = [];
  const claims: ClaimDraftItem[] = [];
  for (const [code, { result, label }] of found) {
    const sourceId = run.deps.newId();
    const source = searchSource(run, result, outcome);
    const host = hostOf(result.url);
    sources.push({ id: sourceId, source });
    claims.push({
      id: run.deps.newId(),
      claim: {
        schemaVersion: 1,
        subjectType: 'company',
        subjectId: run.company.id,
        domain: 'signal',
        key: INVESTIGATION_KEYS.webSignal(`${code} ${host}`),
        statement: `Resultado de pesquisa em ${host}${
          result.publishedAt ? ` (${brazilianDay(result.publishedAt)})` : ''
        } pode indicar ${label} — a conferir.`,
        value: { code, label, url: result.url, publishedAt: result.publishedAt },
        epistemicType: 'hypothesis',
        evidence: [{ sourceId, quote: source.title }],
        reasoning: `O título ou o trecho do resultado cita a empresa junto com termos de ${label}. A página e a data não foram conferidas.`,
        isDemo: run.company.isDemo,
      },
    });
  }
  run.snapshot.signals = [...found.values()].map((item) => item.label);
  if (claims.length === 0) return { state: 'done', counts: { found: 0 } };
  const accepted = await recordStep(run, {
    action: 'company.investigation.signals',
    sources,
    claims,
  });
  return { state: 'done', counts: { found: accepted.size } };
}

// -----------------------------------------------------------------------------
// competitors: pesquisa, triagem da IA e leitura das páginas dos escolhidos
// -----------------------------------------------------------------------------

const MAX_COMPETITORS = 3;

export async function stepCompetitors(run: Run): Promise<StepOutcome> {
  const web = run.deps.webResearch;
  if (!web) return { state: 'skipped', issue: 'search_unavailable' };
  const existing = claimsWithPrefix(run, 'competitive.competitor.');
  if (existing.length > 0 && reusable(run, 'competitors', REUSE_SEARCH_DAYS)) {
    run.snapshot.competitors = run.previous?.snapshot?.competitors ?? [];
    return { state: 'reused', counts: { kept: existing.length } };
  }

  const offering = claimsWithPrefix(run, 'positioning.offering.')
    .filter((claim) => claim.epistemicType === 'fact')
    .map((claim) => (typeof claim.value?.label === 'string' ? claim.value.label : null))
    .find((label): label is string => Boolean(label));
  const cnae = run.inForce.get('registry.cnae_main')?.value;
  const activity = typeof cnae?.description === 'string' ? cnae.description : null;
  const query = competitorSearchQuery({
    offering: offering ?? null,
    activity,
    city: run.company.city,
    uf: run.company.uf,
  });
  if (!query) return { state: 'skipped', issue: 'not_enough_evidence' };

  const outcome = await web.search(run.ctx, {
    query,
    maxResults: 8,
    ...(run.company.primaryDomain ? { excludeDomains: [run.company.primaryDomain] } : {}),
  });
  if (!outcome.ok) return { state: 'failed', issue: searchIssue(outcome) };
  countSearch(run, outcome.creditsCharged);

  const candidates = filterCompetitorCandidates(outcome.results, {
    companyDomain: run.company.primaryDomain,
    max: 6,
  });
  if (candidates.length === 0) {
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
    const triage = await ai.analyze(
      'competitor-triage',
      {
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
      },
      { signal: run.signal },
    );
    await countModel(run, triage, 'competitor-triage');
    if (!triage.ok) {
      return {
        state: 'failed',
        issue: aiIssue(triage.code),
        counts: { candidates: candidates.length, kept: 0 },
      };
    }
    const byRef = new Map(candidates.map((candidate) => [candidate.ref, candidate]));
    const order: Record<CompetitorKind, number> = {
      direct: 0,
      aspirational: 1,
      different_size: 2,
      unrelated: 3,
    };
    kept = triage.output.candidates
      .map((item) => ({ item, candidate: byRef.get(item.ref.trim().toUpperCase()) }))
      .filter((entry) => {
        if (!entry.candidate)
          recordDiscard(run.verification, 'Concorrente citado que não estava na pesquisa.');
        return entry.candidate !== undefined && entry.item.kind !== 'unrelated';
      })
      .filter((entry) => !rejectedByPolicy(run, entry.item.reason))
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
