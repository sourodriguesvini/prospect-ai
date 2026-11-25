import {
  CompanySize,
  RegistryStatus,
  type Claim,
  type Diagnosis,
  type InvestigationStepKey,
  type OfferAssessment,
  type Recommendation,
} from '@prospector/contracts';
import {
  detectChanges,
  knowledgeGaps,
  linkedCnpjFromClaims,
  nextStepFor,
  pickRecommendedOffer,
  qualifyOffer,
  type CoverageState,
  type Firmographics,
  type SignalInput,
  type UsedClaim,
} from '@prospector/domain';
import { claimsWithPrefix, daysBetween, hostOf, type Run, type StepOutcome } from './run';

/**
 * Qualificação determinística (sem modelo): Fit pelo ICP, Opportunity pela necessidade lida no
 * diagnóstico e pelos sinais, Confidence pela cobertura das evidências (doc 08 §3). Monta o
 * diagnóstico (ids de claims, notas, recomendação e próximo passo) e compara o retrato desta
 * coleta com o da investigação anterior. Sempre recalculada: é barata e depende da Estratégia.
 */

const DONE: ReadonlyArray<StepOutcome['state'] | undefined> = ['done', 'reused'];

function stepOk(run: Run, key: InvestigationStepKey): boolean {
  return DONE.includes(run.stepStates[key]);
}

function used(claim: Claim | undefined): UsedClaim[] {
  return claim ? [{ id: claim.id, confidence: claim.confidence }] : [];
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

/** Dados cadastrais (consulta de CNPJ) em vigor, no formato da qualificação. */
export function firmographics(run: Run): {
  firm: Firmographics;
  fitClaims: UsedClaim[];
  capacityClaims: UsedClaim[];
} {
  const get = (key: string) => run.inForce.get(`registry.${key}`);
  const cnae = get('cnae_main');
  const secondary = get('cnae_secondary');
  const location = get('location');
  const size = get('size');
  const regime = get('tax_regime');
  const start = get('activity_start');
  const status = get('status');
  const establishment = get('establishment_type');
  const capital = get('share_capital');

  const sizeBand = CompanySize.safeParse(size?.value?.size);
  const registryStatus = RegistryStatus.safeParse(status?.value?.status);
  const codes = secondary?.value?.codes;
  const firm: Firmographics = {
    cnaeMain: str(cnae?.value?.code) ?? run.company.cnaeMain,
    cnaeSecondary: Array.isArray(codes)
      ? codes.filter((code): code is string => typeof code === 'string')
      : [],
    uf: str(location?.value?.uf) ?? run.company.uf,
    city: str(location?.value?.city) ?? run.company.city,
    sizeBand: sizeBand.success ? sizeBand.data : run.company.sizeBand,
    isMei: typeof regime?.value?.isMei === 'boolean' ? regime.value.isMei : null,
    activityStart: str(start?.value?.activityStart),
    registryStatus: registryStatus.success ? registryStatus.data : null,
    headquarters:
      typeof establishment?.value?.headquarters === 'boolean'
        ? establishment.value.headquarters
        : null,
    shareCapitalCents: typeof capital?.value?.cents === 'number' ? capital.value.cents : null,
    // Sem CNPJ no cadastro, vale o vinculado depois (lido no site ou informado por você).
    cnpjRoot:
      run.company.cnpjRoot ??
      linkedCnpjFromClaims([...run.inForce.values()])?.cnpj.slice(0, 8) ??
      null,
    domain: run.company.primaryDomain,
  };
  return {
    firm,
    fitClaims: [cnae, location, size, start, status, establishment].flatMap(used),
    capacityClaims: [size, regime, capital].flatMap(used),
  };
}

/** Sinais em vigor (do site e da internet), com a idade da informação. */
export function signalInput(run: Run): SignalInput {
  const now = run.deps.clock.now();
  const claims = claimsWithPrefix(run, 'signal.').map((claim) => {
    const published = str(claim.value?.publishedAt);
    return {
      id: claim.id,
      confidence: claim.confidence,
      ageDays: daysBetween(published ?? claim.createdAt, now),
    };
  });
  return { searched: stepOk(run, 'signals'), claims };
}

/** Sabemos por qual canal falar? (ainda não há módulo de contatos: só claims do domínio contact). */
export function accessKnown(run: Run): boolean {
  return [...run.inForce.values()].some((claim) => claim.domain === 'contact');
}

export function coverageState(run: Run): CoverageState {
  const registry = claimsWithPrefix(run, 'registry.').length > 0;
  const siteRead = run.snapshot.pages.some((page) => page.ok);
  const webHosts = new Set(
    claimsWithPrefix(run, 'signal.web.', 'competitive.peer_page.')
      .map((claim) => str(claim.value?.url))
      .filter((url): url is string => url !== null)
      .map(hostOf),
  );
  return {
    hasSite: run.siteUrl !== null,
    siteRead,
    captured:
      run.snapshot.captureHashes.desktop !== null || run.snapshot.captureHashes.mobile !== null,
    visualAnalyzed: stepOk(run, 'visual_analysis'),
    competitorsFound: run.snapshot.competitors.length > 0,
    signalsFound: claimsWithPrefix(run, 'signal.').length > 0,
    contactChannelKnown: accessKnown(run),
    registryChecked: registry,
    // Fontes independentes: cadastro, o próprio site e cada site de terceiros citado.
    sourceCount: (registry ? 1 : 0) + (siteRead ? 1 : 0) + webHosts.size,
  };
}

function idsOf(
  run: Run,
  type: Claim['epistemicType'],
  prefixes: readonly string[],
  first: readonly string[],
  max: number,
): string[] {
  const ids = new Set(first);
  for (const claim of claimsWithPrefix(run, ...prefixes)) {
    if (ids.size >= max) break;
    if (claim.epistemicType === type) ids.add(claim.id);
  }
  return [...ids].slice(0, max);
}

const FACT_PREFIXES = [
  'positioning.',
  'visual.capture.',
  'visual.identity.',
  'visual.metric.',
  'signal.',
  'competitive.peer_page.',
  'digital_presence.',
  'registry.',
];
const INFERENCE_PREFIXES = [
  'positioning.value_proposition',
  'positioning.tone_of_voice',
  'positioning.business_model',
  'visual.identity.positioning',
  'visual.audit.',
  'competitive.finding.',
  'competitive.competitor.',
];
const HYPOTHESIS_PREFIXES = [
  'signal.web.',
  'competitive.competitor.',
  'digital_presence.official_site_candidate.',
  'digital_presence.web_mention',
];

export async function stepQualification(run: Run): Promise<StepOutcome> {
  const strategy = run.strategy ?? (await run.deps.strategy.loadSnapshot());
  run.strategy = strategy;
  const offers = strategy.offers.filter((offer) => offer.status === 'active' && offer.current);
  const { firm, fitClaims, capacityClaims } = firmographics(run);
  const signals = signalInput(run);
  const auditScores = claimsWithPrefix(run, 'visual.audit.')
    .filter(
      (claim) => claim.value?.nature !== 'aesthetic' && typeof claim.value?.score === 'number',
    )
    .map((claim) => Number(claim.value?.score));
  const access = accessKnown(run);
  const now = run.deps.clock.now();

  const assessments: OfferAssessment[] = offers.flatMap((offer) => {
    const version = offer.current;
    if (!version) return [];
    const reading = run.offerReadings.get(offer.id) ?? null;
    const icp = strategy.icps.find(
      (profile) => profile.offerId === offer.id && profile.status === 'active' && profile.current,
    );
    const scoring = strategy.scoringModels.find((model) => model.offerId === offer.id) ?? null;
    const result = qualifyOffer({
      offer: version.content,
      scoringModel: scoring?.content ?? null,
      icp: icp?.current?.content ?? null,
      firm,
      fitClaims,
      capacityClaims,
      need: {
        relevance: reading?.relevance ?? null,
        supporting: reading?.supporting ?? [],
        auditScores,
      },
      signals,
      flaggedDisqualifiers: reading?.flaggedDisqualifiers ?? [],
      accessKnown: access,
      now,
    });
    const opportunityId = run.opportunityIds.get(offer.id);
    return [
      {
        offerId: offer.id,
        offerVersionId: version.id,
        offerName: version.content.name,
        scoringModelId: scoring?.id ?? null,
        icpVersionId: icp?.current?.id ?? null,
        fit: { score: result.fit.score, checks: result.fit.checks.slice(0, 10) },
        opportunity: {
          score: result.opportunity.score,
          claimIds: [
            ...new Set([...(opportunityId ? [opportunityId] : []), ...result.opportunity.claimIds]),
          ].slice(0, 12),
        },
        confidence: result.confidence,
        potential: result.potential,
        priority: result.priority,
        recommendation: result.recommendation,
        gates: result.gates,
        readingClaimId: reading && opportunityId ? opportunityId : null,
      },
    ];
  });
  assessments.sort((a, b) => b.priority - a.priority);

  const coverage = coverageState(run);
  const gaps = knowledgeGaps(coverage);
  const recommended = pickRecommendedOffer(assessments);
  const recommendation: Recommendation = recommended?.recommendation ?? 'insufficient_evidence';
  const confidence =
    recommended?.confidence.score ?? Math.round(100 * Math.max(0, 1 - gaps.length / 9) * 0.6);

  const diagnosis: Diagnosis = {
    summaryClaimId: run.summaryClaimId,
    factClaimIds: idsOf(run, 'fact', FACT_PREFIXES, [...run.citedFactIds], 40),
    inferenceClaimIds: idsOf(run, 'inference', INFERENCE_PREFIXES, [], 30),
    hypothesisClaimIds: idsOf(run, 'hypothesis', HYPOTHESIS_PREFIXES, run.hypothesisIds, 20),
    opportunityClaimIds: [...run.opportunityIds.values()].slice(0, 10),
    gaps: gaps.slice(0, 10),
    offers: assessments.slice(0, 10),
    recommendedOfferId: recommended?.offerId ?? null,
    recommendation,
    nextStep: nextStepFor(recommendation, coverage.hasSite),
    confidence,
    verification: {
      discarded: run.verification.discarded,
      altered: run.verification.altered ?? 0,
      added: run.verification.added ?? 0,
      reasons: [...run.verification.reasons],
    },
  };
  run.diagnosis = diagnosis;
  run.changes = detectChanges(run.previous?.snapshot ?? null, run.snapshot).slice(0, 30);
  return {
    state: 'done',
    issue: offers.length === 0 ? 'no_offers' : null,
    counts: { offers: assessments.length, gaps: gaps.length, changes: run.changes.length },
  };
}
