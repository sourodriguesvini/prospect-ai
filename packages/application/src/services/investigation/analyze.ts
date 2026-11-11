import {
  COMPETITIVE_FINDING_LABELS,
  FINDING_NATURE_LABELS,
  INVESTIGATION_KEYS,
  type CaptureViewport,
  type Claim,
  type CompetitorKind,
  type ExtractedItem,
  type ModelInference,
  type OfferRelevance,
  type SourceInputDraft,
} from '@prospector/contracts';
import {
  forbiddenAssertion,
  knowledgeGaps,
  quoteFoundIn,
  recordDiscard,
  resolveRefs,
  statementSimilarity,
  visualRubric,
} from '@prospector/domain';
import type { RefText } from '../../ports/investigation';
import { ensurePages } from './collect';
import { coverageState } from './qualify';
import {
  aiIssue,
  analysisCompany,
  claimsWithPrefix,
  clip,
  companyClaim,
  countModel,
  cut,
  inForceById,
  previousOk,
  recordStep,
  rejectedByPolicy,
  retention,
  sha256,
  type ClaimDraftItem,
  type OfferReading,
  type PageMemo,
  type Run,
  type StepOutcome,
} from './run';

/**
 * Análises com a IA local: negócio (texto do site), auditoria da marca (capturas + medições),
 * comparação com concorrentes e diagnóstico ligado às ofertas. O modelo só propõe; o servidor
 * confere cada referência (`P1`, `M2`, `K7`…), cada trecho citado (precisa estar na página),
 * barra afirmações proibidas e grava pelo ledger, que exige fato por trás de toda inferência.
 * Análises cujas entradas não mudaram desde a investigação anterior são reaproveitadas.
 */

const PAGE_CHARS_FIRST = 3500;
const PAGE_CHARS_OTHER = 1800;
const MAX_PAGES_SHOWN = 4;

function discardUnknownRefs(run: Run, unknown: readonly string[]): void {
  if (unknown.length > 0) {
    recordDiscard(
      run.verification,
      'Referência citada pela IA que não existe (ignorada).',
      unknown.length,
    );
  }
}

function isFact(claim: Claim | undefined): boolean {
  return claim?.epistemicType === 'fact';
}

function unique(ids: readonly string[]): string[] {
  return [...new Set(ids)];
}

/** Texto curto de um claim para o modelo, com o tipo e a confiança. */
function claimLine(claim: Claim): string {
  return cut(claim.statement, 300);
}

// -----------------------------------------------------------------------------
// business_analysis: ofertas, público, diferenciais, região, sinais do site
// -----------------------------------------------------------------------------

interface ItemGroup {
  prefix: string;
  items: readonly ExtractedItem[];
  max: number;
  claim: (label: string) => { key: string; domain: 'positioning' | 'signal'; statement: string };
}

export async function stepBusiness(run: Run): Promise<StepOutcome> {
  if (!run.siteUrl) return { state: 'skipped', issue: 'no_site' };
  await ensurePages(run);
  const pages = run.pages.filter((page) => page.text.trim().length > 0);
  if (pages.length === 0) {
    return {
      state: 'skipped',
      issue: run.snapshot.siteReachable === false ? 'site_unreachable' : 'not_enough_evidence',
    };
  }
  const ai = run.deps.ai;
  if (!ai) return { state: 'skipped', issue: 'ai_unavailable' };

  const hashes = (list: ReadonlyArray<{ ok: boolean; contentHash: string | null }>) =>
    list
      .filter((page) => page.ok && page.contentHash)
      .map((page) => page.contentHash)
      .sort()
      .join(',');
  const current = hashes(run.snapshot.pages);
  if (
    !run.force &&
    previousOk(run, 'business_analysis') &&
    current !== '' &&
    current === hashes(run.previous?.snapshot?.pages ?? []) &&
    claimsWithPrefix(run, 'positioning.offering.').length > 0
  ) {
    run.snapshot.offerings = run.previous?.snapshot?.offerings ?? [];
    run.snapshot.valueProposition = run.previous?.snapshot?.valueProposition ?? null;
    return { state: 'reused', counts: { offerings: run.snapshot.offerings.length } };
  }

  const shown = pages.slice(0, MAX_PAGES_SHOWN);
  const result = await ai.analyze(
    'company-business',
    {
      company: analysisCompany(run),
      pages: shown.map((page, index) => ({
        ref: page.ref,
        url: page.url,
        category: page.category,
        title: page.title,
        text: clip(page.text, index === 0 ? PAGE_CHARS_FIRST : PAGE_CHARS_OTHER),
      })),
    },
    { signal: run.signal },
  );
  await countModel(run, result, 'company-business');
  if (!result.ok) return { state: 'failed', issue: aiIssue(result.code) };
  const output = result.output;

  const pageByRef = new Map(shown.map((page) => [page.ref.toUpperCase(), page]));
  const quotesByPage = new Map<PageMemo, string[]>();
  const sourceIdByPage = new Map<PageMemo, string>();
  const refs = new Map<string, string>();
  const facts: ClaimDraftItem[] = [];
  const offeringIds: Array<{ label: string; id: string }> = [];

  const groups: ItemGroup[] = [
    {
      prefix: 'O',
      items: output.offerings,
      max: 8,
      claim: (label) => ({
        key: INVESTIGATION_KEYS.offering(label),
        domain: 'positioning',
        statement: `O site oferece: ${label}.`,
      }),
    },
    {
      prefix: 'A',
      items: output.audiences,
      max: 3,
      claim: (label) => ({
        key: INVESTIGATION_KEYS.audience(label),
        domain: 'positioning',
        statement: `O site se dirige a: ${label}.`,
      }),
    },
    {
      prefix: 'D',
      items: output.differentiators,
      max: 4,
      claim: (label) => ({
        key: INVESTIGATION_KEYS.differentiator(label),
        domain: 'positioning',
        statement: `O site destaca como diferencial: ${label}.`,
      }),
    },
    {
      prefix: 'R',
      items: output.regions,
      max: 1,
      claim: (label) => ({
        key: INVESTIGATION_KEYS.region,
        domain: 'positioning',
        statement: `O site indica atendimento em: ${label}.`,
      }),
    },
    {
      prefix: 'S',
      items: output.signals,
      max: 3,
      claim: (label) => ({
        key: INVESTIGATION_KEYS.pageSignal(label),
        domain: 'signal',
        statement: `O site menciona: ${label}.`,
      }),
    },
  ];

  for (const group of groups) {
    const accepted: string[] = [];
    group.items.forEach((item, index) => {
      const ref = `${group.prefix}${index + 1}`;
      const page = pageByRef.get(item.page.trim().toUpperCase());
      const quote = item.quote.replace(/…$/, '').trim();
      const label = item.label.replace(/[.;:]+$/, '').trim();
      if (!page) {
        recordDiscard(run.verification, 'Página citada pela IA que não foi mostrada a ela.');
        return;
      }
      if (quote.length < 4 || !quoteFoundIn(quote, page.text)) {
        recordDiscard(run.verification, 'Trecho citado pela IA que não aparece na página.');
        return;
      }
      if (label.length < 2 || rejectedByPolicy(run, label)) return;
      if (accepted.some((other) => statementSimilarity(other, label) >= 0.8)) {
        recordDiscard(run.verification, 'Item repetido na análise do site.');
        return;
      }
      if (accepted.length >= group.max) return;
      accepted.push(label);
      let sourceId = sourceIdByPage.get(page);
      if (!sourceId) {
        sourceId = run.deps.newId();
        sourceIdByPage.set(page, sourceId);
        quotesByPage.set(page, []);
      }
      quotesByPage.get(page)?.push(quote);
      const id = run.deps.newId();
      refs.set(ref, id);
      if (group.prefix === 'O') offeringIds.push({ label, id });
      const { key, domain, statement } = group.claim(label);
      facts.push({
        id,
        claim: companyClaim(run, {
          domain,
          key,
          statement,
          epistemicType: 'fact',
          value: { label, url: page.url, category: page.category },
          evidence: [{ sourceId, quote }],
        }),
      });
    });
  }

  // Inferências do posicionamento: dependem dos itens extraídos ou das páginas lidas.
  for (const page of shown) {
    const pageClaim = run.pageClaims.get(page.url);
    if (pageClaim) refs.set(page.ref.toUpperCase(), pageClaim);
  }
  const pageFacts = unique(
    shown.map((page) => run.pageClaims.get(page.url)).filter((id): id is string => Boolean(id)),
  );
  const inferences: ClaimDraftItem[] = [];
  const proposals: Array<[ModelInference | null, string]> = [
    [output.valueProposition, INVESTIGATION_KEYS.valueProposition],
    [output.toneOfVoice, INVESTIGATION_KEYS.tone],
    [output.businessModel, INVESTIGATION_KEYS.businessModel],
  ];
  let valueProposition: { id: string; statement: string } | null = null;
  for (const [inference, key] of proposals) {
    if (!inference) continue;
    if (rejectedByPolicy(run, inference.statement, inference.reasoning)) continue;
    const { resolved, unknown } = resolveRefs(inference.basedOn, refs);
    discardUnknownRefs(run, unknown);
    // Sem referência nenhuma, a leitura é do site como um todo: depende das páginas mostradas.
    const dependsOn =
      resolved.length > 0 ? resolved : inference.basedOn.length === 0 ? pageFacts : [];
    if (dependsOn.length === 0) {
      recordDiscard(run.verification, 'Inferência sem base verificável.');
      continue;
    }
    const id = run.deps.newId();
    if (key === INVESTIGATION_KEYS.valueProposition)
      valueProposition = { id, statement: inference.statement };
    inferences.push({
      id,
      claim: companyClaim(run, {
        domain: 'positioning',
        key,
        statement: inference.statement,
        epistemicType: 'inference',
        dependsOn,
        reasoning: inference.reasoning,
        reasoningFactor: inference.factor,
      }),
    });
  }

  const sources: Array<{ id: string; source: SourceInputDraft }> = [];
  for (const [page, quotes] of quotesByPage) {
    const excerpt = [page.title, ...quotes].filter(Boolean).join('\n');
    sources.push({
      id: sourceIdByPage.get(page) ?? run.deps.newId(),
      source: {
        schemaVersion: 1,
        kind: 'web_page',
        url: page.url,
        provider: 'prospector',
        capturedAt: page.fetchedAt,
        contentHash: await sha256(excerpt),
        mime: 'text/html',
        title: page.title ? cut(page.title, 300) : null,
        excerptText: excerpt,
        licenseNote:
          'Trechos literais da página citados na análise do site; o resto do texto não foi guardado.',
        retentionUntil: retention(page.fetchedAt),
        isDemo: run.company.isDemo,
      },
    });
  }
  const accepted = await recordStep(run, {
    action: 'company.investigation.business_analysis',
    sources,
    claims: [...facts, ...inferences],
  });
  run.snapshot.offerings = offeringIds
    .filter((item) => accepted.has(item.id))
    .map((item) => cut(item.label, 80))
    .slice(0, 12);
  run.snapshot.valueProposition =
    valueProposition && accepted.has(valueProposition.id)
      ? cut(valueProposition.statement, 300)
      : null;
  const factCount = facts.filter((item) => accepted.has(item.id)).length;
  return {
    state: 'done',
    issue: factCount === 0 ? 'not_enough_evidence' : null,
    counts: {
      facts: factCount,
      inferences: inferences.filter((item) => accepted.has(item.id)).length,
    },
  };
}

// -----------------------------------------------------------------------------
// visual_analysis: rubrica sobre as capturas e as medições
// -----------------------------------------------------------------------------

export async function stepVisual(run: Run): Promise<StepOutcome> {
  if (!run.siteUrl) return { state: 'skipped', issue: 'no_site' };
  if (run.stepStates.capture !== 'done') return { state: 'skipped', issue: 'capture_unavailable' };
  const ai = run.deps.ai;
  if (!ai) return { state: 'skipped', issue: 'ai_unavailable' };

  const fromThisRun = (claim: Claim) => claim.producedByRunId === run.id;
  const captureClaims: Partial<Record<CaptureViewport, Claim>> = {};
  for (const viewport of ['desktop', 'mobile'] as const) {
    const claim = run.inForce.get(
      INVESTIGATION_KEYS.capture(viewport === 'desktop' ? 'site_desktop' : 'site_mobile'),
    );
    if (claim && fromThisRun(claim)) captureClaims[viewport] = claim;
  }
  const metrics = claimsWithPrefix(
    run,
    'visual.metric.',
    INVESTIGATION_KEYS.palette,
    INVESTIGATION_KEYS.typography,
  ).filter((claim) => isFact(claim) && fromThisRun(claim));
  if (!captureClaims.desktop && !captureClaims.mobile && metrics.length === 0) {
    return { state: 'skipped', issue: 'capture_unavailable' };
  }

  const previousHashes = run.previous?.snapshot?.captureHashes;
  const { desktop, mobile } = run.snapshot.captureHashes;
  if (
    !run.force &&
    previousOk(run, 'visual_analysis') &&
    (desktop !== null || mobile !== null) &&
    previousHashes?.desktop === desktop &&
    previousHashes.mobile === mobile &&
    claimsWithPrefix(run, 'visual.audit.').length > 0
  ) {
    return { state: 'reused', counts: { criteria: claimsWithPrefix(run, 'visual.audit.').length } };
  }

  // Imagens: as desta execução ou, na retomada, as guardadas pelo CaptureStore.
  const images: Partial<Record<CaptureViewport, Uint8Array>> = { ...run.images };
  for (const viewport of ['desktop', 'mobile'] as const) {
    const path = captureClaims[viewport]?.value?.storagePath;
    if (!images[viewport] && typeof path === 'string' && run.deps.captureStore) {
      const stored = await run.deps.captureStore.get(path);
      if (stored) images[viewport] = stored.bytes;
    }
  }
  const shownImageIds = (Object.keys(images) as CaptureViewport[])
    .map((viewport) => captureClaims[viewport]?.id)
    .filter((id): id is string => Boolean(id));

  const strategy = run.strategy;
  const activeOffers = new Set(
    (strategy?.offers ?? []).filter((offer) => offer.status === 'active').map((offer) => offer.id),
  );
  const rubric = visualRubric(strategy?.rubrics ?? [], activeOffers);
  const metricRefs: RefText[] = metrics.slice(0, 30).map((claim, index) => ({
    ref: `M${index + 1}`,
    text: claimLine(claim),
  }));
  const contextClaims = claimsWithPrefix(
    run,
    'positioning.offering.',
    'positioning.audience.',
    INVESTIGATION_KEYS.valueProposition,
    INVESTIGATION_KEYS.tone,
  )
    .filter((claim) => claim.epistemicType !== 'hypothesis')
    .slice(0, 10);
  const context: RefText[] = contextClaims.map((claim, index) => ({
    ref: `K${index + 1}`,
    text: claimLine(claim),
  }));

  const result = await ai.analyze(
    'brand-visual',
    { company: analysisCompany(run), rubric, metrics: metricRefs, images, context },
    { signal: run.signal },
  );
  await countModel(run, result, 'brand-visual');
  if (!result.ok) return { state: 'failed', issue: aiIssue(result.code) };

  const refIds = new Map<string, string>([
    ...metrics.slice(0, 30).map((claim, index): [string, string] => [`M${index + 1}`, claim.id]),
    ...contextClaims.map((claim, index): [string, string] => [`K${index + 1}`, claim.id]),
  ]);
  const metricOnly = new Map([...refIds].filter(([ref]) => ref.startsWith('M')));
  const rubricByKey = new Map(rubric.map((criterion) => [criterion.key, criterion]));
  const claims: ClaimDraftItem[] = [];
  for (const finding of result.output.criteria) {
    const criterion = rubricByKey.get(finding.criterion.trim().toLowerCase());
    if (!criterion) {
      recordDiscard(run.verification, 'Critério da auditoria fora da rubrica.');
      continue;
    }
    if (!finding.observation || rejectedByPolicy(run, finding.observation)) continue;
    const cited = finding.images
      .filter((viewport) => images[viewport])
      .map((viewport) => captureClaims[viewport]?.id)
      .filter((id): id is string => Boolean(id));
    const { resolved, unknown } = resolveRefs(finding.metrics, metricOnly);
    discardUnknownRefs(run, unknown);
    const dependsOn = unique([...cited, ...resolved, ...(cited.length === 0 ? shownImageIds : [])]);
    if (dependsOn.length === 0) {
      recordDiscard(run.verification, 'Achado visual sem captura nem medição que o sustente.');
      continue;
    }
    const viewports =
      finding.images.length > 0 ? finding.images : (Object.keys(images) as CaptureViewport[]);
    const where =
      viewports.length === 0
        ? 'nas medições da página'
        : `na captura ${viewports.map((viewport) => (viewport === 'desktop' ? 'do computador' : 'do celular')).join(' e ')}`;
    claims.push({
      id: run.deps.newId(),
      claim: companyClaim(run, {
        domain: 'visual',
        key: INVESTIGATION_KEYS.audit(criterion.key),
        statement: `${criterion.label}: ${finding.observation}`,
        epistemicType: 'inference',
        value: {
          criterion: criterion.key,
          label: criterion.label,
          score: finding.score,
          nature: finding.nature,
          images: viewports,
        },
        dependsOn,
        reasoning: `Nota ${finding.score} de 5 na rubrica (${FINDING_NATURE_LABELS[finding.nature]}), observada ${where}.`,
        reasoningFactor: finding.factor,
      }),
    });
  }
  const positioning = result.output.positioning;
  if (positioning && !rejectedByPolicy(run, positioning.statement, positioning.reasoning)) {
    const { resolved, unknown } = resolveRefs(positioning.basedOn, refIds);
    discardUnknownRefs(run, unknown);
    const dependsOn = unique([...shownImageIds, ...resolved]);
    if (
      dependsOn.some((id) => metrics.some((claim) => claim.id === id)) ||
      shownImageIds.length > 0
    ) {
      claims.push({
        id: run.deps.newId(),
        claim: companyClaim(run, {
          domain: 'visual',
          key: INVESTIGATION_KEYS.visualPositioning,
          statement: positioning.statement,
          epistemicType: 'inference',
          dependsOn,
          reasoning: positioning.reasoning,
          reasoningFactor: positioning.factor,
        }),
      });
    } else {
      recordDiscard(run.verification, 'Leitura visual sem captura que a sustente.');
    }
  }
  if (claims.length === 0)
    return { state: 'done', issue: 'not_enough_evidence', counts: { criteria: 0 } };
  const accepted = await recordStep(run, {
    action: 'company.investigation.visual_analysis',
    claims,
  });
  return { state: 'done', counts: { criteria: accepted.size } };
}

// -----------------------------------------------------------------------------
// competitive_analysis: o que a empresa diz e mostra x concorrentes escolhidos
// -----------------------------------------------------------------------------

const COMPETITOR_KINDS: readonly CompetitorKind[] = ['direct', 'aspirational', 'different_size'];

export async function stepCompetitive(run: Run): Promise<StepOutcome> {
  const competitors = claimsWithPrefix(run, 'competitive.competitor.').filter((claim) => {
    const kind = claim.value?.kind;
    const domain = claim.value?.domain;
    return (
      claim.epistemicType === 'inference' &&
      typeof kind === 'string' &&
      COMPETITOR_KINDS.includes(kind as CompetitorKind) &&
      typeof domain === 'string' &&
      run.snapshot.competitors.includes(domain)
    );
  });
  if (competitors.length === 0) return { state: 'skipped', issue: 'no_competitors' };
  const ai = run.deps.ai;
  if (!ai) return { state: 'skipped', issue: 'ai_unavailable' };

  const upstreamChanged = (['competitors', 'business_analysis', 'visual_analysis'] as const).some(
    (key) => run.stepStates[key] === 'done',
  );
  if (
    !run.force &&
    !upstreamChanged &&
    previousOk(run, 'competitive_analysis') &&
    claimsWithPrefix(run, 'competitive.finding.').length > 0
  ) {
    return {
      state: 'reused',
      counts: { findings: claimsWithPrefix(run, 'competitive.finding.').length },
    };
  }

  const companyClaims = claimsWithPrefix(
    run,
    'positioning.offering.',
    'positioning.audience.',
    'positioning.differentiator.',
    INVESTIGATION_KEYS.valueProposition,
    INVESTIGATION_KEYS.tone,
    INVESTIGATION_KEYS.visualPositioning,
    'visual.audit.',
  )
    .filter((claim) => claim.epistemicType !== 'hypothesis')
    .slice(0, 16);
  // Sem nada verificado sobre a própria empresa não há o que comparar.
  if (companyClaims.length === 0) return { state: 'skipped', issue: 'not_enough_evidence' };
  const refIds = new Map<string, string[]>(
    companyClaims.map((claim, index) => [`K${index + 1}`, [claim.id]]),
  );
  const shown = competitors.slice(0, 3).map((claim, index) => {
    const domain = String(claim.value?.domain);
    const peer = run.inForce.get(INVESTIGATION_KEYS.peerPage(domain));
    refIds.set(`C${index + 1}`, [...(peer ? [peer.id] : []), claim.id]);
    return {
      ref: `C${index + 1}`,
      domain,
      kind: claim.value?.kind as CompetitorKind,
      text: run.competitorTexts.get(domain) ?? peer?.statement ?? claim.statement,
    };
  });

  const result = await ai.analyze(
    'competitive',
    {
      company: analysisCompany(run),
      facts: companyClaims.map((claim, index) => ({
        ref: `K${index + 1}`,
        text: claimLine(claim),
      })),
      competitors: shown,
    },
    { signal: run.signal },
  );
  await countModel(run, result, 'competitive');
  if (!result.ok) return { state: 'failed', issue: aiIssue(result.code) };

  const byId = inForceById(run);
  const claims: ClaimDraftItem[] = [];
  for (const finding of result.output.findings) {
    if (rejectedByPolicy(run, finding.statement, finding.reasoning)) continue;
    const { resolved, unknown } = resolveRefs(finding.basedOn, refIds);
    discardUnknownRefs(run, unknown);
    const dependsOn = unique(resolved.flat()).filter(
      (id) => byId.get(id)?.epistemicType !== 'hypothesis',
    );
    if (!dependsOn.some((id) => isFact(byId.get(id)))) {
      recordDiscard(run.verification, 'Comparação sem fato verificável por trás.');
      continue;
    }
    claims.push({
      id: run.deps.newId(),
      claim: companyClaim(run, {
        domain: 'competitive',
        key: INVESTIGATION_KEYS.competitiveFinding(finding.kind),
        statement: finding.statement,
        epistemicType: 'inference',
        value: { kind: finding.kind, label: COMPETITIVE_FINDING_LABELS[finding.kind] },
        dependsOn,
        reasoning: finding.reasoning,
        reasoningFactor: finding.factor,
      }),
    });
  }
  if (claims.length === 0)
    return { state: 'done', issue: 'not_enough_evidence', counts: { findings: 0 } };
  const accepted = await recordStep(run, {
    action: 'company.investigation.competitive_analysis',
    claims,
  });
  return { state: 'done', counts: { findings: accepted.size } };
}

// -----------------------------------------------------------------------------
// diagnosis: síntese, hipóteses e leitura de cada oferta
// -----------------------------------------------------------------------------

/** O que o diagnóstico mostra ao modelo, na ordem de importância. */
const DIAGNOSIS_PREFIXES = [
  'positioning.offering.',
  'positioning.audience.',
  'positioning.differentiator.',
  INVESTIGATION_KEYS.valueProposition,
  INVESTIGATION_KEYS.tone,
  INVESTIGATION_KEYS.businessModel,
  INVESTIGATION_KEYS.region,
  INVESTIGATION_KEYS.visualPositioning,
  'visual.audit.',
  'competitive.finding.',
  'competitive.competitor.',
  'signal.',
  'registry.cnae_main',
  'registry.size',
  'registry.activity_start',
  'registry.location',
  'registry.status',
  'registry.tax_regime',
  'registry.establishment_type',
  'visual.metric.',
];
const MAX_DIAGNOSIS_FACTS = 40;

function diagnosisClaims(run: Run): Claim[] {
  const picked: Claim[] = [];
  const seen = new Set<string>();
  for (const prefix of DIAGNOSIS_PREFIXES) {
    for (const claim of claimsWithPrefix(run, prefix)) {
      if (seen.has(claim.id) || picked.length >= MAX_DIAGNOSIS_FACTS) continue;
      seen.add(claim.id);
      picked.push(claim);
    }
  }
  return picked;
}

export function readingFromClaim(run: Run, claim: Claim): OfferReading | null {
  const value = claim.value ?? {};
  const relevance = value.relevance;
  if (
    relevance !== 'strong' &&
    relevance !== 'moderate' &&
    relevance !== 'weak' &&
    relevance !== 'none'
  ) {
    return null;
  }
  const byId = inForceById(run);
  const supporting = (Array.isArray(value.supporting) ? value.supporting : [])
    .filter((id): id is string => typeof id === 'string')
    .map((id) => byId.get(id))
    .filter((item): item is Claim => item !== undefined && item.epistemicType !== 'hypothesis')
    .map((item) => ({ id: item.id, confidence: item.confidence }));
  const strings = (list: unknown) =>
    (Array.isArray(list) ? list : []).filter((item): item is string => typeof item === 'string');
  return {
    relevance,
    supporting,
    flaggedDisqualifiers: (Array.isArray(value.disqualifiersHit)
      ? value.disqualifiersHit
      : []
    ).filter((item): item is number => typeof item === 'number'),
    rationale: claim.reasoning,
    openingAngle: typeof value.openingAngle === 'string' ? value.openingAngle : null,
    objections: strings(value.objections),
    toVerify: strings(value.toVerify),
  };
}

/** Reaproveita o diagnóstico anterior: síntese, hipóteses e oportunidades ainda em vigor. */
export function reuseDiagnosis(run: Run): boolean {
  const previous = run.previous?.diagnosis;
  if (!previous) return false;
  const byId = inForceById(run);
  run.summaryClaimId =
    previous.summaryClaimId && byId.has(previous.summaryClaimId) ? previous.summaryClaimId : null;
  run.hypothesisIds = previous.hypothesisClaimIds.filter(
    (id) => byId.get(id)?.key.startsWith('positioning.hypothesis.') ?? false,
  );
  for (const id of previous.factClaimIds) if (byId.has(id)) run.citedFactIds.add(id);
  for (const id of previous.opportunityClaimIds) {
    const claim = byId.get(id);
    const offerId = claim?.value?.offerId;
    if (!claim || typeof offerId !== 'string') continue;
    const reading = readingFromClaim(run, claim);
    if (!reading) continue;
    run.opportunityIds.set(offerId, claim.id);
    run.offerReadings.set(offerId, reading);
  }
  return true;
}

function clean(run: Run, text: string | null): string | null {
  if (!text) return null;
  const hit = forbiddenAssertion(text);
  if (hit) {
    recordDiscard(run.verification, `Texto descartado: ${hit.reason}.`);
    return null;
  }
  return text;
}

export async function stepDiagnosis(run: Run): Promise<StepOutcome> {
  const ai = run.deps.ai;
  if (!ai) return { state: 'skipped', issue: 'ai_unavailable' };
  const offers = (run.strategy?.offers ?? [])
    .filter((offer) => offer.status === 'active' && offer.current)
    .slice(0, 6);

  const upstreamChanged = (
    [
      'signals',
      'competitors',
      'business_analysis',
      'visual_analysis',
      'competitive_analysis',
    ] as const
  ).some((key) => run.stepStates[key] === 'done');
  if (!run.force && !upstreamChanged && previousOk(run, 'diagnosis') && reuseDiagnosis(run)) {
    return {
      state: 'reused',
      issue: offers.length === 0 ? 'no_offers' : null,
      counts: { offers: run.opportunityIds.size },
    };
  }

  const shownClaims = diagnosisClaims(run);
  if (shownClaims.filter(isFact).length === 0) {
    return { state: 'skipped', issue: 'not_enough_evidence' };
  }
  const refIds = new Map(shownClaims.map((claim, index) => [`K${index + 1}`, claim.id]));
  const byId = inForceById(run);
  const offerByRef = new Map(offers.map((offer, index) => [`OF${index + 1}`, offer]));
  const gaps = knowledgeGaps(coverageState(run)).map((gap) => gap.text);

  const result = await ai.analyze(
    'diagnosis',
    {
      company: analysisCompany(run),
      facts: shownClaims.map((claim, index) => ({
        ref: `K${index + 1}`,
        text: claimLine(claim),
        type: claim.epistemicType,
        confidence: claim.confidence,
      })),
      offers: offers.map((offer, index) => {
        const content = offer.current?.content;
        return {
          ref: `OF${index + 1}`,
          name: content?.name ?? 'Oferta',
          problems: content?.problems ?? [],
          needSignals: content?.needSignals ?? [],
          disqualifiers: content?.disqualifiers ?? [],
        };
      }),
      gaps,
    },
    { signal: run.signal },
  );
  await countModel(run, result, 'diagnosis');
  if (!result.ok) return { state: 'failed', issue: aiIssue(result.code) };
  const output = result.output;

  const resolve = (refs: readonly string[]) => {
    const { resolved, unknown } = resolveRefs(refs, refIds);
    discardUnknownRefs(run, unknown);
    return unique(resolved);
  };
  const noHypotheses = (ids: readonly string[]) =>
    ids.filter((id) => byId.get(id)?.epistemicType !== 'hypothesis');
  const cite = (ids: readonly string[]) => {
    for (const id of ids) if (isFact(byId.get(id))) run.citedFactIds.add(id);
  };

  const claims: ClaimDraftItem[] = [];
  let summaryId: string | null = null;
  if (
    output.summary &&
    !rejectedByPolicy(run, output.summary.statement, output.summary.reasoning)
  ) {
    const dependsOn = noHypotheses(resolve(output.summary.basedOn));
    if (dependsOn.some((id) => isFact(byId.get(id)))) {
      summaryId = run.deps.newId();
      cite(dependsOn);
      claims.push({
        id: summaryId,
        claim: companyClaim(run, {
          domain: 'positioning',
          key: INVESTIGATION_KEYS.summary,
          statement: output.summary.statement,
          epistemicType: 'inference',
          dependsOn,
          reasoning: output.summary.reasoning,
          reasoningFactor: output.summary.factor,
        }),
      });
    } else {
      recordDiscard(run.verification, 'Síntese sem fato verificável por trás.');
    }
  }

  const hypothesisIds: string[] = [];
  for (const hypothesis of output.hypotheses) {
    if (rejectedByPolicy(run, hypothesis.statement, hypothesis.reasoning)) continue;
    if (!hypothesis.reasoning) continue;
    const dependsOn = resolve(hypothesis.basedOn);
    cite(dependsOn);
    const id = run.deps.newId();
    hypothesisIds.push(id);
    claims.push({
      id,
      claim: companyClaim(run, {
        domain: 'positioning',
        key: INVESTIGATION_KEYS.hypothesis(hypothesis.statement),
        statement: hypothesis.statement,
        epistemicType: 'hypothesis',
        dependsOn,
        reasoning: hypothesis.reasoning,
      }),
    });
  }

  // Leitura por oferta: só vale (relevância e desqualificadores) se o claim entrar no ledger.
  const readings = new Map<string, { id: string; reading: OfferReading }>();
  const seenOffers = new Set<string>();
  for (const entry of output.offers) {
    const offer = offerByRef.get(entry.offer.trim().toUpperCase());
    const content = offer?.current?.content;
    if (!offer || !content || !offer.current) {
      recordDiscard(run.verification, 'Oferta citada pela IA que não está cadastrada.');
      continue;
    }
    if (seenOffers.has(offer.id)) continue;
    seenOffers.add(offer.id);
    const cited = resolve(entry.basedOn);
    const supportingIds = noHypotheses(cited);
    const hasFact = supportingIds.some((id) => isFact(byId.get(id)));
    cite(cited);
    const inRange = (list: readonly number[], length: number) =>
      [...new Set(list)].filter((position) => position >= 1 && position <= length);
    // Desqualificador só conta com fato por trás (doc 08 §3.3).
    const flagged = hasFact ? inRange(entry.disqualifiersHit, content.disqualifiers.length) : [];
    const relevance: OfferRelevance = entry.relevance;
    const rationale = clean(run, entry.reasoning);
    const reading: OfferReading = {
      relevance,
      supporting: supportingIds.map((id) => ({ id, confidence: byId.get(id)?.confidence ?? null })),
      flaggedDisqualifiers: flagged,
      rationale,
      openingAngle: clean(run, entry.openingAngle),
      objections: entry.objections
        .map((text) => clean(run, text))
        .filter((text): text is string => Boolean(text)),
      toVerify: entry.toVerify
        .map((text) => clean(run, text))
        .filter((text): text is string => Boolean(text)),
    };
    if (!rationale || rejectedByPolicy(run, entry.statement)) {
      recordDiscard(run.verification, 'Leitura de oferta sem justificativa aceita: não conta.');
      continue;
    }

    const asInference = (relevance === 'strong' || relevance === 'moderate') && hasFact;
    const id = run.deps.newId();
    readings.set(offer.id, { id, reading });
    claims.push({
      id,
      claim: companyClaim(run, {
        domain: 'positioning',
        key: INVESTIGATION_KEYS.opportunity(content.name),
        statement: entry.statement,
        epistemicType: asInference ? 'inference' : 'hypothesis',
        value: {
          offerId: offer.id,
          offerVersionId: offer.current.id,
          offerName: content.name,
          relevance,
          problemsMatched: inRange(entry.problemsMatched, content.problems.length),
          signalsMatched: inRange(entry.signalsMatched, content.needSignals.length),
          disqualifiersHit: flagged,
          supporting: supportingIds,
          openingAngle: reading.openingAngle,
          objections: reading.objections,
          toVerify: reading.toVerify,
        },
        dependsOn: asInference ? supportingIds : cited,
        reasoning: rationale,
        reasoningFactor: entry.factor,
      }),
    });
  }

  const accepted = claims.length
    ? await recordStep(run, { action: 'company.investigation.diagnosis', claims })
    : new Set<string>();
  run.summaryClaimId = summaryId && accepted.has(summaryId) ? summaryId : null;
  run.hypothesisIds = hypothesisIds.filter((id) => accepted.has(id));
  for (const [offerId, { id, reading }] of readings) {
    if (!accepted.has(id)) continue;
    run.opportunityIds.set(offerId, id);
    run.offerReadings.set(offerId, reading);
  }
  return {
    state: 'done',
    issue: offers.length === 0 ? 'no_offers' : null,
    counts: {
      summary: run.summaryClaimId ? 1 : 0,
      hypotheses: run.hypothesisIds.length,
      opportunities: run.opportunityIds.size,
    },
  };
}
