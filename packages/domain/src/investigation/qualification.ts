import type {
  CompanySize,
  FitCheck,
  IcpContent,
  KnowledgeGap,
  NextStep,
  OfferContent,
  OfferRelevance,
  Recommendation,
  RegistryStatus,
  ScoreDimension,
  ScoringModelContent,
} from '@prospector/contracts';
import { REGISTRY_STATUS_LABELS } from '@prospector/contracts';

/**
 * Qualificação por oferta (docs/08 §3), separando três leituras que a tela mostra lado a lado:
 * Fit (aderência ao ICP, determinística), Opportunity (necessidade observada + sinais + timing) e
 * Confidence (cobertura e força das evidências). Potencial e prioridade seguem a composição do
 * doc 08 com os pesos do modelo de score da oferta. Dado desconhecido conta como neutro (50) no
 * potencial e derruba a cobertura, nunca vira certeza. Nenhuma pontuação é probabilidade de venda.
 */

export const DEFAULT_SCORING_MODEL: ScoringModelContent = Object.freeze({
  weights: { fit: 25, need: 30, signal: 20, capacity: 15, timing: 10 },
  thresholds: {
    pursuePriority: 70,
    prepareAccessPotential: 70,
    discardPotential: 40,
    minEvidenceCoverage: 60,
  },
});

/** Confiança mínima de um claim para contar como evidência de uma dimensão ("≥ média"). */
export const COVERAGE_MIN_CONFIDENCE = 0.6;
const NEUTRAL = 50;
const DIMENSIONS: readonly ScoreDimension[] = ['fit', 'need', 'signal', 'capacity', 'timing'];

export interface Firmographics {
  /** Subclasse no formato 0000-0/00. */
  cnaeMain: string | null;
  cnaeSecondary: readonly string[];
  uf: string | null;
  city: string | null;
  sizeBand: CompanySize | null;
  isMei: boolean | null;
  /** AAAA-MM-DD. */
  activityStart: string | null;
  registryStatus: RegistryStatus | null;
  headquarters: boolean | null;
  shareCapitalCents: number | null;
  cnpjRoot: string | null;
  domain: string | null;
}

export interface UsedClaim {
  id: string;
  confidence: number | null;
}

function fold(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

const SIZE_LABELS: Record<CompanySize, string> = {
  me: 'microempresa',
  epp: 'empresa de pequeno porte',
  demais: 'demais portes',
};

function digits(code: string): string {
  return code.replace(/\D/g, '');
}

function yearsSince(isoDate: string, now: Date): number | null {
  const start = Date.parse(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(start)) return null;
  return Math.floor((now.getTime() - start) / (365.25 * 24 * 3600 * 1000));
}

// -----------------------------------------------------------------------------
// Fit e barreiras (gates)
// -----------------------------------------------------------------------------

export interface Gate {
  text: string;
  /** `monitor`: rebranding recente e afins (acompanhar, não descartar). */
  kind: 'discard' | 'monitor';
}

export function evaluateFit(
  firm: Firmographics,
  icp: IcpContent | null,
  now: Date,
): { score: number | null; checks: FitCheck[]; gates: Gate[] } {
  const checks: FitCheck[] = [];
  const gates: Gate[] = [];

  if (firm.registryStatus !== null) {
    const active = firm.registryStatus === 'active';
    checks.push({
      criterion: 'registry_status',
      met: active,
      text: `Situação cadastral na Receita: ${REGISTRY_STATUS_LABELS[firm.registryStatus].toLowerCase()}.`,
    });
    if (!active)
      gates.push({ text: 'Situação cadastral inativa na Receita Federal.', kind: 'discard' });
  }

  if (icp) {
    const { filters, exclusions } = icp;
    if (filters.cnaes.length > 0) {
      const wanted = new Set(filters.cnaes.map(digits));
      const main = firm.cnaeMain ? wanted.has(digits(firm.cnaeMain)) : null;
      const secondary = firm.cnaeSecondary.some((code) => wanted.has(digits(code)));
      checks.push({
        criterion: 'cnae',
        met: main === null ? (secondary ? true : null) : main || secondary,
        text:
          main === null && !secondary
            ? 'Atividade (CNAE) desconhecida.'
            : main
              ? `Atividade principal (CNAE ${firm.cnaeMain}) está no ICP.`
              : secondary
                ? 'Uma atividade secundária está no ICP.'
                : `Atividade principal (CNAE ${firm.cnaeMain}) fora do ICP.`,
      });
    }
    if (filters.ufs.length > 0) {
      checks.push({
        criterion: 'uf',
        met: firm.uf === null ? null : (filters.ufs as readonly string[]).includes(firm.uf),
        text:
          firm.uf === null
            ? 'Estado desconhecido.'
            : (filters.ufs as readonly string[]).includes(firm.uf)
              ? `Estado ${firm.uf} está no ICP.`
              : `Estado ${firm.uf} fora do ICP.`,
      });
    }
    if (filters.municipalities.length > 0) {
      const met =
        firm.city === null || firm.uf === null
          ? null
          : filters.municipalities.some(
              (place) => place.uf === firm.uf && fold(place.name) === fold(firm.city ?? ''),
            );
      checks.push({
        criterion: 'municipality',
        met,
        text:
          met === null
            ? 'Município desconhecido.'
            : met
              ? `${firm.city}/${firm.uf} está entre os municípios do ICP.`
              : `${firm.city}/${firm.uf} fora dos municípios do ICP.`,
      });
    }
    if (filters.sizes.length > 0) {
      const met = firm.isMei
        ? false
        : firm.sizeBand === null
          ? null
          : filters.sizes.includes(firm.sizeBand);
      checks.push({
        criterion: 'size',
        met,
        text: firm.isMei
          ? 'MEI fica fora dos portes do ICP.'
          : firm.sizeBand === null
            ? 'Porte desconhecido.'
            : met
              ? `Porte (${SIZE_LABELS[firm.sizeBand]}) está no ICP.`
              : `Porte (${SIZE_LABELS[firm.sizeBand]}) fora do ICP.`,
      });
    }
    if (filters.minAgeYears !== null || filters.maxAgeYears !== null) {
      const age = firm.activityStart ? yearsSince(firm.activityStart, now) : null;
      const met =
        age === null
          ? null
          : (filters.minAgeYears === null || age >= filters.minAgeYears) &&
            (filters.maxAgeYears === null || age <= filters.maxAgeYears);
      checks.push({
        criterion: 'age',
        met,
        text:
          age === null
            ? 'Idade da empresa desconhecida.'
            : `${age} ${age === 1 ? 'ano' : 'anos'} de atividade${met ? ', dentro' : ', fora'} da faixa do ICP.`,
      });
    }

    const excludedBy: string[] = [];
    if (firm.cnpjRoot && exclusions.cnpjRoots.includes(firm.cnpjRoot)) excludedBy.push('CNPJ');
    if (firm.domain && exclusions.domains.includes(firm.domain.replace(/^www\./, '')))
      excludedBy.push('domínio');
    if (
      firm.city &&
      firm.uf &&
      exclusions.municipalities.some(
        (place) => place.uf === firm.uf && fold(place.name) === fold(firm.city ?? ''),
      )
    )
      excludedBy.push('município');
    if (firm.cnaeMain && exclusions.cnaes.map(digits).includes(digits(firm.cnaeMain)))
      excludedBy.push('CNAE');
    if (excludedBy.length > 0) {
      checks.push({
        criterion: 'exclusion',
        met: false,
        text: `Na lista de exclusões do ICP (${excludedBy.join(', ')}).`,
      });
      gates.push({
        text: `Empresa na lista de exclusões do ICP (${excludedBy.join(', ')}).`,
        kind: 'discard',
      });
    }
  }

  const scored = checks.filter(
    (check) =>
      check.criterion !== 'registry_status' &&
      check.criterion !== 'exclusion' &&
      check.met !== null,
  );
  const score =
    scored.length === 0
      ? null
      : Math.round((100 * scored.filter((check) => check.met).length) / scored.length);
  return { score, checks: checks.slice(0, 10), gates };
}

/**
 * Desqualificadores da oferta: os que o sistema confere sozinho (filial) e os apontados pela IA
 * com evidência (`flagged`, posições a partir de 1, já conferidas pelo serviço).
 */
export function offerGates(
  offer: OfferContent,
  firm: Firmographics,
  flagged: readonly number[],
): Gate[] {
  const gates: Gate[] = [];
  offer.disqualifiers.forEach((text, index) => {
    const folded = fold(text);
    // A situação cadastral já é barreira geral (evaluateFit).
    if (/situacao cadastral/.test(folded)) return;
    const branch =
      /\b(filial|franquia|franqueadora|matriz)\b/.test(folded) && firm.headquarters === false;
    if (branch || flagged.includes(index + 1)) {
      const recent = /rebranding|refeit|reformulad|recente/.test(folded);
      gates.push({
        text: `Desqualificador da oferta: ${text}${branch ? ' (o CNPJ é de uma filial)' : ' (apontado pela IA; confira antes de descartar)'}.`.slice(
          0,
          200,
        ),
        // Só o cadastro (fato conferido) descarta; o que a IA aponta pede no máximo acompanhar,
        // porque a IA pode citar um fato sem relação com o desqualificador (KI-133).
        kind: branch && !recent ? 'discard' : 'monitor',
      });
    }
  });
  return gates;
}

// -----------------------------------------------------------------------------
// Dimensões
// -----------------------------------------------------------------------------

const RELEVANCE_SCORES: Record<OfferRelevance, number> = {
  strong: 85,
  moderate: 65,
  weak: 40,
  none: 15,
};

export interface NeedInput {
  /** Leitura da IA para esta oferta; null = IA indisponível. */
  relevance: OfferRelevance | null;
  /** Claims citados pela IA e conferidos (fatos e inferências). */
  supporting: readonly UsedClaim[];
  /** Notas da auditoria visual (1 a 5), só achados funcionais e estratégicos. */
  auditScores: readonly number[];
}

export function needScore(input: NeedInput): number | null {
  const relevance = input.relevance === null ? null : RELEVANCE_SCORES[input.relevance];
  const weakness =
    input.auditScores.length === 0
      ? null
      : ((5 - input.auditScores.reduce((sum, score) => sum + score, 0) / input.auditScores.length) /
          4) *
        100;
  if (relevance === null && weakness === null) return null;
  const raw =
    relevance !== null && weakness !== null
      ? 0.6 * relevance + 0.4 * weakness
      : (relevance ?? weakness ?? 0);
  // Sem nenhum claim que sustente, a necessidade não passa de fraca.
  return Math.round(input.supporting.length === 0 ? Math.min(raw, 30) : raw);
}

export interface SignalClaim extends UsedClaim {
  /** Dias desde a coleta da fonte mais recente do sinal. */
  ageDays: number;
}

export interface SignalInput {
  /** false = a busca de sinais não rodou (dado desconhecido). */
  searched: boolean;
  claims: readonly SignalClaim[];
}

export function signalScore(input: SignalInput): number | null {
  if (!input.searched && input.claims.length === 0) return null;
  const total = input.claims.reduce(
    (sum, claim) => sum + 40 * Math.max(0.25, 1 - claim.ageDays / 180),
    0,
  );
  return Math.min(100, Math.round(total));
}

export function capacityScore(firm: Firmographics): number | null {
  if (firm.isMei) return 15;
  if (firm.sizeBand === null) return null;
  let score = firm.sizeBand === 'demais' ? 75 : firm.sizeBand === 'epp' ? 60 : 45;
  if (firm.shareCapitalCents !== null) {
    if (firm.shareCapitalCents >= 100_000_000) score += 20;
    else if (firm.shareCapitalCents >= 10_000_000) score += 10;
  }
  return Math.min(95, score);
}

export function timingScore(signals: SignalInput, gates: readonly Gate[]): number | null {
  if (gates.some((gate) => gate.kind === 'monitor')) return 10;
  if (signals.claims.some((claim) => claim.ageDays <= 90)) return 75;
  return signals.searched ? NEUTRAL : null;
}

// -----------------------------------------------------------------------------
// Composição e recomendação
// -----------------------------------------------------------------------------

export interface QualificationInput {
  offer: OfferContent;
  scoringModel: ScoringModelContent | null;
  icp: IcpContent | null;
  firm: Firmographics;
  /** Claims de cadastro usados no Fit e na Capacidade. */
  fitClaims: readonly UsedClaim[];
  capacityClaims: readonly UsedClaim[];
  need: NeedInput;
  signals: SignalInput;
  /** Desqualificadores apontados pela IA e conferidos (posições a partir de 1). */
  flaggedDisqualifiers: readonly number[];
  /** Sabemos quem decide e por qual canal falar (ainda não há módulo de contatos: false). */
  accessKnown: boolean;
  now: Date;
}

export interface QualificationResult {
  fit: { score: number | null; checks: FitCheck[] };
  scores: Record<ScoreDimension, number | null>;
  opportunity: { score: number; claimIds: string[] };
  confidence: { score: number; coveredDimensions: number };
  potential: number;
  priority: number;
  recommendation: Recommendation;
  gates: string[];
}

function covered(claims: readonly UsedClaim[]): boolean {
  return claims.some((claim) => (claim.confidence ?? 0) >= COVERAGE_MIN_CONFIDENCE);
}

export function qualifyOffer(input: QualificationInput): QualificationResult {
  const model = input.scoringModel ?? DEFAULT_SCORING_MODEL;
  const fit = evaluateFit(input.firm, input.icp, input.now);
  const gates = [...fit.gates, ...offerGates(input.offer, input.firm, input.flaggedDisqualifiers)];

  const scores: Record<ScoreDimension, number | null> = {
    fit: fit.score,
    need: needScore(input.need),
    signal: signalScore(input.signals),
    capacity: capacityScore(input.firm),
    timing: timingScore(input.signals, gates),
  };

  const weighted = (dims: readonly ScoreDimension[]) => {
    const totalWeight = dims.reduce((sum, dim) => sum + model.weights[dim], 0);
    if (totalWeight === 0) return NEUTRAL;
    return Math.round(
      dims.reduce((sum, dim) => sum + model.weights[dim] * (scores[dim] ?? NEUTRAL), 0) /
        totalWeight,
    );
  };
  const potential = weighted(DIMENSIONS);
  const opportunityScore = weighted(['need', 'signal', 'timing']);

  const timingClaims = input.signals.claims.filter((claim) => claim.ageDays <= 90);
  const coverageByDim: Record<ScoreDimension, boolean> = {
    fit: fit.score !== null && covered(input.fitClaims),
    need: covered(input.need.supporting),
    signal: covered(input.signals.claims),
    capacity: scores.capacity !== null && covered(input.capacityClaims),
    timing: covered(timingClaims),
  };
  const coveredDimensions = DIMENSIONS.filter((dim) => coverageByDim[dim]).length;
  const used = [
    ...input.fitClaims,
    ...input.capacityClaims,
    ...input.need.supporting,
    ...input.signals.claims,
  ];
  const meanConfidence =
    used.length === 0
      ? 0
      : used.reduce((sum, claim) => sum + (claim.confidence ?? 0), 0) / used.length;
  const confidenceScore = Math.round(100 * (0.6 * (coveredDimensions / 5) + 0.4 * meanConfidence));

  const confidenceFactor = 0.4 + 0.6 * (coveredDimensions / 5);
  const accessFactor = input.accessKnown ? 1 : 0.8;
  const priority = Math.round(potential * confidenceFactor * accessFactor);

  const needSupported =
    (scores.need ?? 0) >= 50 &&
    input.need.supporting.some((claim) => (claim.confidence ?? 0) >= COVERAGE_MIN_CONFIDENCE);
  const coveragePercent = (coveredDimensions / 5) * 100;
  const { thresholds } = model;

  let recommendation: Recommendation;
  if (gates.some((gate) => gate.kind === 'discard')) recommendation = 'discard';
  else if (gates.length > 0) recommendation = 'monitor';
  else if (coveragePercent < thresholds.minEvidenceCoverage)
    recommendation =
      potential >= thresholds.prepareAccessPotential ? 'investigate_more' : 'insufficient_evidence';
  else if (potential < thresholds.discardPotential) recommendation = 'discard';
  else if (priority >= thresholds.pursuePriority && needSupported && input.accessKnown)
    recommendation = 'pursue';
  else if (potential >= thresholds.prepareAccessPotential && needSupported)
    recommendation = 'prepare_access';
  else if ((fit.score ?? NEUTRAL) >= 60 && !needSupported) recommendation = 'monitor';
  else recommendation = 'investigate_more';

  const opportunityIds = [
    ...new Set([...input.need.supporting, ...input.signals.claims].map((claim) => claim.id)),
  ].slice(0, 12);

  return {
    fit: { score: fit.score, checks: fit.checks },
    scores,
    opportunity: { score: opportunityScore, claimIds: opportunityIds },
    confidence: { score: confidenceScore, coveredDimensions },
    potential,
    priority,
    recommendation,
    gates: gates.map((gate) => gate.text).slice(0, 6),
  };
}

// -----------------------------------------------------------------------------
// Diagnóstico geral: lacunas, recomendação e próximo passo
// -----------------------------------------------------------------------------

export interface CoverageState {
  hasSite: boolean;
  siteRead: boolean;
  captured: boolean;
  visualAnalyzed: boolean;
  competitorsFound: boolean;
  signalsFound: boolean;
  contactChannelKnown: boolean;
  registryChecked: boolean;
  /** Fontes distintas usadas no diagnóstico. */
  sourceCount: number;
}

const GAP_TEXTS: Record<KnowledgeGap['code'], string> = {
  no_site: 'Sem site confirmado: a marca não pôde ser vista no próprio site.',
  site_not_read: 'O site não pôde ser lido nesta coleta.',
  no_capture: 'Sem capturas de tela: a auditoria visual não teve imagens.',
  no_visual_analysis: 'A IA não analisou as capturas nesta investigação.',
  no_competitors: 'Nenhum concorrente verificável para comparar.',
  no_signals: 'Nenhum sinal recente encontrado (mudança, expansão, vagas, lançamento).',
  no_contact_channel: 'Ainda não sabemos quem decide nem por qual canal falar.',
  registry_missing: 'Sem consulta de CNPJ: porte, situação e atividade não confirmados.',
  few_sources: 'Poucas fontes independentes (menos de três).',
};

export function knowledgeGaps(state: CoverageState): KnowledgeGap[] {
  const gaps: KnowledgeGap['code'][] = [];
  if (!state.hasSite) gaps.push('no_site');
  else if (!state.siteRead) gaps.push('site_not_read');
  if (state.hasSite && !state.captured) gaps.push('no_capture');
  if (state.captured && !state.visualAnalyzed) gaps.push('no_visual_analysis');
  if (!state.competitorsFound) gaps.push('no_competitors');
  if (!state.signalsFound) gaps.push('no_signals');
  if (!state.contactChannelKnown) gaps.push('no_contact_channel');
  if (!state.registryChecked) gaps.push('registry_missing');
  if (state.sourceCount < 3) gaps.push('few_sources');
  return gaps.map((code) => ({ code, text: GAP_TEXTS[code] }));
}

const RECOMMENDATION_ORDER: readonly Recommendation[] = [
  'pursue',
  'prepare_access',
  'investigate_more',
  'monitor',
  'insufficient_evidence',
  'discard',
];

/** Oferta recomendada: a de maior prioridade entre as que não foram descartadas. */
export function pickRecommendedOffer<
  T extends { offerId: string; priority: number; recommendation: Recommendation },
>(assessments: readonly T[]): T | null {
  const ranked = [...assessments].sort(
    (a, b) =>
      RECOMMENDATION_ORDER.indexOf(a.recommendation) -
        RECOMMENDATION_ORDER.indexOf(b.recommendation) || b.priority - a.priority,
  );
  return ranked[0] ?? null;
}

export function nextStepFor(recommendation: Recommendation, hasSite: boolean): NextStep {
  if (!hasSite && recommendation !== 'discard') return 'confirm_site';
  switch (recommendation) {
    case 'pursue':
    case 'prepare_access':
      return 'prepare_approach';
    case 'monitor':
      return 'watch_signal';
    case 'discard':
      return 'discard_for_now';
    default:
      return 'investigate_more';
  }
}
