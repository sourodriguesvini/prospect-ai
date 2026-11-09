import {
  INFERENCE_MAX_CONFIDENCE,
  REASONING_FACTOR_RANGE,
  type Claim,
  type ClaimDomain,
  type ClaimStatus,
  type ConfidenceBand,
  type EvidenceStance,
  type Source,
  type SourceReliabilityTier,
} from '@prospector/contracts';
import { DEFAULT_EVIDENCE_POLICY, type EvidencePolicy, validityDaysFor } from './policy';
import { evidenceOrigin } from './sources';

/**
 * Cálculo de confiança, atualidade e estado dos claims (docs/08 §2.2 e §2.3). Puro: o "agora"
 * chega por parâmetro. A confiança vale para o momento `now`; como a atualidade decai, quem grava
 * precisa recalcular com o tempo.
 */

const DAY_MS = 86_400_000;

/** Faixas da interface (docs/08 §2.2): Alta ≥ 0,8 · Média de 0,6 a 0,8 · Baixa < 0,6. */
export const CONFIDENCE_BAND_THRESHOLDS = { high: 0.8, medium: 0.6 } as const;

/** Atualidade dentro da validade, no dobro dela e depois (docs/08 §2.2). */
const FRESH_FACTOR = 1;
const FRESHNESS_FLOOR = 0.5;
const STALE_AFTER_VALIDITY_MULTIPLE = 2;

/**
 * Duas casas decimais, como em `claims.confidence numeric(3,2)`, truncando para baixo: o valor
 * gravado nunca sobe de faixa por arredondamento (0,799 → 0,79, Média). O epsilon absorve o erro
 * de ponto flutuante (0,85 + 0,05 + 0,05 = 0,9500000000000001).
 */
export function roundConfidence(value: number): number {
  const clamped = Math.min(1, Math.max(0, value));
  return Math.floor(clamped * 100 + 1e-9) / 100;
}

export function confidenceBand(confidence: number | null): ConfidenceBand {
  if (confidence === null) return 'unverified';
  if (confidence >= CONFIDENCE_BAND_THRESHOLDS.high) return 'high';
  if (confidence >= CONFIDENCE_BAND_THRESHOLDS.medium) return 'medium';
  return 'low';
}

export interface Freshness {
  /** 1,0 até a validade; cai em linha reta até 0,5 no dobro; 0,5 depois. */
  readonly factor: number;
  /** Passou do dobro da validade. */
  readonly stale: boolean;
}

/** Atualidade de um dado coletado em `capturedAt`. Coleta no futuro conta como recém-coletada. */
export function freshness(capturedAt: string, now: Date, validityDays: number): Freshness {
  if (!(validityDays > 0)) throw new RangeError(`Validade inválida: ${validityDays}.`);
  const captured = Date.parse(capturedAt);
  if (Number.isNaN(captured)) throw new RangeError(`Data de coleta inválida: ${capturedAt}.`);
  const validityMs = validityDays * DAY_MS;
  const ageMs = Math.max(0, now.getTime() - captured);
  if (ageMs <= validityMs) return { factor: FRESH_FACTOR, stale: false };
  if (ageMs <= STALE_AFTER_VALIDITY_MULTIPLE * validityMs) {
    const decay = (FRESH_FACTOR - FRESHNESS_FLOOR) * ((ageMs - validityMs) / validityMs);
    return { factor: FRESH_FACTOR - decay, stale: false };
  }
  return { factor: FRESHNESS_FLOOR, stale: true };
}

/** Momento em que um dado coletado em `capturedAt` fica `stale`. */
export function staleAfter(capturedAt: string, validityDays: number): Date {
  return new Date(Date.parse(capturedAt) + STALE_AFTER_VALIDITY_MULTIPLE * validityDays * DAY_MS);
}

/** O que o cálculo precisa de uma fonte. */
export type AssessedSource = Pick<Source, 'kind' | 'url' | 'provider' | 'capturedAt'>;

export interface AssessedEvidence {
  readonly stance: EvidenceStance;
  /**
   * Categoria da fonte para o sujeito deste claim (`claim_evidence.reliability_tier`): o site de
   * uma empresa é `company_owned` para ela e não para outra.
   */
  readonly reliabilityTier: SourceReliabilityTier;
  readonly source: AssessedSource;
}

/** O que o cálculo precisa de um claim citado como dependência. */
export type AssessedDependency = Pick<
  Claim,
  'epistemicType' | 'status' | 'confidence' | 'validUntil'
>;

/** Estados que o cálculo produz; `rejected` e `superseded` vêm de revisão ou nova versão. */
export type AssessedStatus = Extract<ClaimStatus, 'active' | 'stale' | 'disputed'>;

/**
 * Estado de um claim gravado, lido no instante `now`: `active` ou `disputed` depois de
 * `validUntil` contam como `stale`, mesmo que o banco ainda não tenha sido atualizado (KI-071).
 */
export function effectiveStatus(
  claim: Pick<Claim, 'status' | 'validUntil'>,
  now: Date,
): ClaimStatus {
  const expirable = claim.status === 'active' || claim.status === 'disputed';
  return expirable && now.getTime() > Date.parse(claim.validUntil) ? 'stale' : claim.status;
}

/**
 * Estado a gravar depois de recalcular: `rejected` (verificação ou revisão) e `superseded` (nova
 * versão) não mudam com o recálculo; nos demais vale o calculado. Por isso a contradição achada
 * pelo juiz (docs/08 §2.4) entra como evidência que contradiz, e não como estado solto.
 */
export function resolveStatus(stored: ClaimStatus, computed: AssessedStatus): ClaimStatus {
  return stored === 'rejected' || stored === 'superseded' ? stored : computed;
}

export type ConfidenceBreakdown =
  | {
      readonly type: 'fact';
      readonly validityDays: number;
      /** Fonte que deu a melhor base (índice na lista de evidências). */
      readonly baseEvidenceIndex: number;
      readonly reliabilityTier: SourceReliabilityTier;
      readonly reliability: number;
      readonly freshness: number;
      /** Origens independentes que concordam, além da base. */
      readonly independentSources: number;
      readonly concordanceBonus: number;
      /** Há fonte não vencida que contradiz. */
      readonly contradicted: boolean;
    }
  | {
      readonly type: 'inference';
      readonly weakestDependency: number;
      readonly reasoningFactorProposed: number | null;
      readonly reasoningFactor: number;
    }
  | { readonly type: 'hypothesis'; readonly validityDays: number };

export interface ClaimAssessment {
  /** Null só em hipótese. */
  readonly confidence: number | null;
  readonly band: ConfidenceBand;
  readonly status: AssessedStatus;
  /** ISO 8601: depois disso o claim fica `stale`. */
  readonly validUntil: string;
  readonly breakdown: ConfidenceBreakdown;
}

interface ScoredEvidence {
  readonly index: number;
  readonly stance: EvidenceStance;
  readonly tier: SourceReliabilityTier;
  readonly reliability: number;
  readonly freshness: Freshness;
  readonly score: number;
  readonly origin: string;
  readonly capturedAt: string;
}

function scoreEvidence(
  evidence: readonly AssessedEvidence[],
  now: Date,
  validityDays: number,
  policy: EvidencePolicy,
): ScoredEvidence[] {
  return evidence.map(({ stance, reliabilityTier, source }, index) => {
    const reliability = policy.reliability[reliabilityTier];
    const fresh = freshness(source.capturedAt, now, validityDays);
    return {
      index,
      stance,
      tier: reliabilityTier,
      reliability,
      freshness: fresh,
      score: reliability * fresh.factor,
      origin: evidenceOrigin(source, reliabilityTier),
      capturedAt: source.capturedAt,
    };
  });
}

function latestCapture(items: readonly ScoredEvidence[]): string | null {
  let latest: string | null = null;
  for (const item of items) {
    if (latest === null || Date.parse(item.capturedAt) > Date.parse(latest))
      latest = item.capturedAt;
  }
  return latest;
}

export interface FactAssessmentInput {
  readonly domain: ClaimDomain;
  readonly key: string;
  readonly evidence: readonly AssessedEvidence[];
  readonly now: Date;
  readonly policy?: EvidencePolicy;
}

/**
 * Fato: confiabilidade da melhor fonte × atualidade, + bônus por origem independente que
 * concorda (até 1,0). A melhor fonte é escolhida entre as não vencidas; só se todas venceram,
 * entre as vencidas. Fonte não vencida que contradiz → `disputed` e teto de 0,5. Sem fonte de
 * apoio dentro do dobro da validade → `stale`, que prevalece sobre `disputed` (o teto continua).
 * Pré-condição: ≥ 1 evidência que sustenta.
 */
export function assessFact(input: FactAssessmentInput): ClaimAssessment {
  const policy = input.policy ?? DEFAULT_EVIDENCE_POLICY;
  const validityDays = validityDaysFor(input.domain, input.key, policy);
  const scored = scoreEvidence(input.evidence, input.now, validityDays, policy);
  const supporting = scored.filter((item) => item.stance === 'supports');
  const liveSupporting = supporting.filter((item) => !item.freshness.stale);
  const candidates = liveSupporting.length > 0 ? liveSupporting : supporting;
  const best = candidates.reduce<ScoredEvidence | undefined>(
    (top, item) => (top === undefined || item.score > top.score ? item : top),
    undefined,
  );
  if (best === undefined) {
    throw new RangeError('Fato sem evidência que o sustente: valide antes de calcular.');
  }

  const independentOrigins = new Set(
    liveSupporting
      .filter((item) => !policy.concordanceExcludedTiers.includes(item.tier))
      .map((item) => item.origin),
  );
  independentOrigins.delete(best.origin);
  const independentSources = independentOrigins.size;
  const concordanceBonus = independentSources * policy.concordanceBonus;
  const contradicted = scored.some(
    (item) => item.stance === 'contradicts' && !item.freshness.stale,
  );

  let value = Math.min(1, best.score + concordanceBonus);
  if (contradicted) value = Math.min(value, policy.disputedMaxConfidence);
  const confidence = roundConfidence(value);

  const status: AssessedStatus =
    liveSupporting.length === 0 ? 'stale' : contradicted ? 'disputed' : 'active';
  // `supporting` não é vazio (best existe), então há uma coleta mais recente.
  const validUntil = staleAfter(latestCapture(supporting) ?? best.capturedAt, validityDays);

  return {
    confidence,
    band: confidenceBand(confidence),
    status,
    validUntil: validUntil.toISOString(),
    breakdown: {
      type: 'fact',
      validityDays,
      baseEvidenceIndex: best.index,
      reliabilityTier: best.tier,
      reliability: best.reliability,
      freshness: best.freshness.factor,
      independentSources,
      concordanceBonus,
      contradicted,
    },
  };
}

/** Limita o fator proposto pelo modelo a [0,5; 0,9]; sem proposta, usa o mínimo (conservador). */
export function applyReasoningFactor(proposed: number | null): number {
  if (proposed === null) return REASONING_FACTOR_RANGE.min;
  return Math.min(REASONING_FACTOR_RANGE.max, Math.max(REASONING_FACTOR_RANGE.min, proposed));
}

const INACTIVE_FOR_DERIVATION: readonly ClaimStatus[] = ['stale', 'rejected', 'superseded'];

export interface InferenceAssessmentInput {
  readonly dependencies: readonly AssessedDependency[];
  readonly reasoningFactor: number | null;
  readonly now: Date;
  readonly policy?: EvidencePolicy;
}

/**
 * Inferência: menor confiança entre as dependências × fator de raciocínio limitado, nunca acima de
 * 0,9. Herda o estado das dependências em `now` (`effectiveStatus`): alguma vencida, rejeitada ou
 * substituída → `stale`; senão alguma contestada → `disputed` (teto de 0,5). Vale até a primeira
 * dependência vencer. Pré-condição: ≥ 1 dependência, nenhuma hipótese.
 */
export function assessInference(input: InferenceAssessmentInput): ClaimAssessment {
  const policy = input.policy ?? DEFAULT_EVIDENCE_POLICY;
  const { dependencies } = input;
  if (dependencies.length === 0) {
    throw new RangeError('Inferência sem dependências: valide antes de calcular.');
  }
  const confidences = dependencies.map((dependency) => dependency.confidence);
  if (confidences.some((value) => value === null)) {
    throw new RangeError('Inferência apoiada em hipótese: valide antes de calcular.');
  }
  const weakestDependency = Math.min(...(confidences as number[]));
  const reasoningFactor = applyReasoningFactor(input.reasoningFactor);

  const statuses = dependencies.map((d) => effectiveStatus(d, input.now));
  const status: AssessedStatus = statuses.some((value) => INACTIVE_FOR_DERIVATION.includes(value))
    ? 'stale'
    : statuses.includes('disputed')
      ? 'disputed'
      : 'active';

  let value = Math.min(INFERENCE_MAX_CONFIDENCE, weakestDependency * reasoningFactor);
  if (status === 'disputed') value = Math.min(value, policy.disputedMaxConfidence);
  const confidence = roundConfidence(value);
  const validUntil = Math.min(...dependencies.map((d) => Date.parse(d.validUntil)));

  return {
    confidence,
    band: confidenceBand(confidence),
    status,
    validUntil: new Date(validUntil).toISOString(),
    breakdown: {
      type: 'inference',
      weakestDependency,
      reasoningFactorProposed: input.reasoningFactor,
      reasoningFactor,
    },
  };
}

export interface HypothesisAssessmentInput {
  readonly domain: ClaimDomain;
  readonly key: string;
  readonly evidence: readonly AssessedEvidence[];
  readonly dependencies: readonly AssessedDependency[];
  /** Quando a hipótese foi registrada: base da validade se não há evidência de apoio. */
  readonly createdAt: string;
  readonly now: Date;
  readonly policy?: EvidencePolicy;
}

/**
 * Hipótese (proposta F3a): sem confiança calculada ("A verificar"). Vence pela validade do
 * domínio contada da evidência de apoio mais recente (ou do registro) e com qualquer dependência
 * vencida em `now`, rejeitada ou substituída. Evidência não vencida que contradiz → `disputed`.
 */
export function assessHypothesis(input: HypothesisAssessmentInput): ClaimAssessment {
  const policy = input.policy ?? DEFAULT_EVIDENCE_POLICY;
  const validityDays = validityDaysFor(input.domain, input.key, policy);
  const scored = scoreEvidence(input.evidence, input.now, validityDays, policy);
  const supporting = scored.filter((item) => item.stance === 'supports');
  const anchor = latestCapture(supporting) ?? input.createdAt;
  const validUntil = Math.min(
    staleAfter(anchor, validityDays).getTime(),
    ...input.dependencies.map((d) => Date.parse(d.validUntil)),
  );

  const expired =
    input.now.getTime() > validUntil ||
    input.dependencies.some((d) => INACTIVE_FOR_DERIVATION.includes(effectiveStatus(d, input.now)));
  const contradicted = scored.some(
    (item) => item.stance === 'contradicts' && !item.freshness.stale,
  );
  const status: AssessedStatus = expired ? 'stale' : contradicted ? 'disputed' : 'active';

  return {
    confidence: null,
    band: 'unverified',
    status,
    validUntil: new Date(validUntil).toISOString(),
    breakdown: { type: 'hypothesis', validityDays },
  };
}

/**
 * Pode sustentar uma afirmação em mensagem ou recomendação (docs/08 §4.3 e §5.3): fato ou
 * inferência ativo em `now` com confiança ao menos Média. Hipótese nunca. A confiança precisa ter
 * sido recalculada perto de `now`: a gravada pode estar velha, porque a atualidade decai (KI-071).
 */
export function canSupportAssertion(
  claim: Pick<Claim, 'epistemicType' | 'status' | 'confidence' | 'validUntil'>,
  now: Date,
): boolean {
  return (
    claim.epistemicType !== 'hypothesis' &&
    effectiveStatus(claim, now) === 'active' &&
    claim.confidence !== null &&
    claim.confidence >= CONFIDENCE_BAND_THRESHOLDS.medium
  );
}
