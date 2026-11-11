import {
  EMPTY_APPROACH_INSIGHTS,
  NEXT_STEP_LABELS,
  RECOMMENDATION_LABELS,
  type ApproachInsights,
  type Claim,
  type DiagnosisSummary,
  type Investigation,
  type InvestigationStatus,
  type OfferAssessment,
  type OpportunityPriority,
  type RecommendedService,
} from '@prospector/contracts';
import { effectiveStatus } from '@prospector/domain';
import { systemClock, type Clock } from '../clock';
import type { RequestContext } from '../context';
import type { EvidenceRepository } from '../ports/company-repository';
import type { ApproachInsightsSource } from '../ports/relationship-ai';
import type { InvestigationService } from './investigation-service';

/**
 * Diagnóstico de Empresas (ADR-0015) como insumo da abordagem do Relacionamento (ADR-0014,
 * KI-129). A investigação guarda só ids de claims; os textos vêm do ledger, e só entra o que está
 * em vigor agora. Nada aqui é escrito pelo modelo: os avisos são do sistema.
 */

/** Investigações recentes olhadas: uma nova em andamento não esconde o último diagnóstico. */
const RECENT_INVESTIGATIONS = 5;
const MAX_FINDINGS = 12;
const MAX_STATEMENT = 500;
const MAX_RATIONALE = 800;
const MAX_RECOMMENDATION = 300;

const DIAGNOSED: ReadonlySet<InvestigationStatus> = new Set(['succeeded', 'partial']);

/** Resumo do sistema quando a investigação não deixou síntese em vigor. */
export const NO_SUMMARY_NOTICE =
  'A investigação não chegou a um resumo com base suficiente; valem só os achados abaixo, cada um com o seu tipo.';

/** Justificativa do sistema quando a IA não leu a oferta recomendada (ou a leitura saiu de vigor). */
export const NO_READING_NOTICE =
  'Oferta de maior prioridade na investigação, sem leitura da IA em vigor para ela.';

/** Faixas de 0 a 100 combinadas com Empresas: menos de 50 baixa, de 50 a 74 média, 75 ou mais alta. */
export function scoreBand(score: number): OpportunityPriority {
  if (score >= 75) return 'high';
  if (score >= 50) return 'medium';
  return 'low';
}

const clip = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;

/** O tipo fica no texto do achado: hipótese nunca chega à abordagem como afirmação. */
function findingStatement(claim: Claim, opportunity: boolean): string {
  const kind =
    claim.epistemicType === 'fact'
      ? 'Fato observado'
      : claim.epistemicType === 'inference'
        ? 'Inferência'
        : 'Hipótese a confirmar';
  const label = opportunity ? `Oportunidade (${kind.toLowerCase()})` : kind;
  return clip(`${label}: ${claim.statement}`, MAX_STATEMENT);
}

/** A investigação mais recente com diagnóstico (concluída ou concluída com lacunas). */
export function latestDiagnosed(history: readonly Investigation[]): Investigation | null {
  return history.find((item) => DIAGNOSED.has(item.status) && item.diagnosis !== null) ?? null;
}

/** Ids de claims que o diagnóstico cita (para buscar os textos de uma vez). */
export function claimIdsOf(investigation: Investigation): string[] {
  const diagnosis = investigation.diagnosis;
  if (!diagnosis) return [];
  const recommended = recommendedAssessment(investigation);
  return [
    ...new Set([
      ...(diagnosis.summaryClaimId ? [diagnosis.summaryClaimId] : []),
      ...diagnosis.factClaimIds,
      ...diagnosis.opportunityClaimIds,
      ...diagnosis.inferenceClaimIds,
      ...diagnosis.hypothesisClaimIds,
      ...(recommended?.opportunity.claimIds ?? []),
      ...(recommended?.readingClaimId ? [recommended.readingClaimId] : []),
    ]),
  ];
}

/** Avaliação da oferta recomendada; null quando a investigação não recomendou oferta. */
function recommendedAssessment(investigation: Investigation): OfferAssessment | null {
  const diagnosis = investigation.diagnosis;
  if (!diagnosis) return null;
  if (diagnosis.recommendedOfferId) {
    return diagnosis.offers.find((offer) => offer.offerId === diagnosis.recommendedOfferId) ?? null;
  }
  return null;
}

/**
 * Mapeamento puro (testável sem banco): investigação + claims lidos do ledger → insumos da
 * abordagem. `claims` pode trazer claims fora de vigor; eles são descartados aqui.
 */
export function insightsFromInvestigation(
  investigation: Investigation | null,
  claims: readonly Claim[],
  now: Date,
): ApproachInsights {
  const diagnosis = investigation?.diagnosis;
  if (!investigation || !diagnosis || !DIAGNOSED.has(investigation.status)) {
    return EMPTY_APPROACH_INSIGHTS;
  }
  const inForce = new Map(
    claims
      .filter((claim) => effectiveStatus(claim, now) === 'active')
      .map((claim) => [claim.id, claim]),
  );
  const assessedAt = investigation.finishedAt ?? investigation.updatedAt;

  // Achados: fato, oportunidade, inferência e hipótese, nessa ordem, sem repetir claim.
  const seen = new Set<string>();
  const findings: DiagnosisSummary['findings'] = [];
  const groups: ReadonlyArray<{ ids: readonly string[]; opportunity: boolean }> = [
    { ids: diagnosis.factClaimIds, opportunity: false },
    { ids: diagnosis.opportunityClaimIds, opportunity: true },
    { ids: diagnosis.inferenceClaimIds, opportunity: false },
    { ids: diagnosis.hypothesisClaimIds, opportunity: false },
  ];
  for (const group of groups) {
    for (const id of group.ids) {
      if (findings.length >= MAX_FINDINGS) break;
      const claim = inForce.get(id);
      if (!claim || seen.has(id) || id === diagnosis.summaryClaimId) continue;
      seen.add(id);
      findings.push({ statement: findingStatement(claim, group.opportunity), claimIds: [id] });
    }
  }

  const summaryClaim = diagnosis.summaryClaimId ? inForce.get(diagnosis.summaryClaimId) : null;
  const summary: DiagnosisSummary | null =
    summaryClaim || findings.length > 0
      ? {
          id: investigation.id,
          status: summaryClaim && investigation.status === 'succeeded' ? 'complete' : 'partial',
          summary: summaryClaim ? summaryClaim.statement : NO_SUMMARY_NOTICE,
          findings,
          producedAt: assessedAt,
          promptId:
            investigation.models.find((use) => use.agent === 'diagnosis')?.promptVersion ?? null,
        }
      : null;

  const assessment = recommendedAssessment(investigation);
  let recommendedService: RecommendedService | null = null;
  if (assessment) {
    const reading = assessment.readingClaimId ? inForce.get(assessment.readingClaimId) : null;
    recommendedService = {
      offerId: assessment.offerId,
      offerVersionId: assessment.offerVersionId,
      rationale: clip(
        `Oferta recomendada: ${assessment.offerName}. ${reading ? reading.statement : NO_READING_NOTICE}`,
        MAX_RATIONALE,
      ),
      claimIds: [
        ...new Set(
          [...assessment.opportunity.claimIds, ...(reading ? [reading.id] : [])].filter((id) =>
            inForce.has(id),
          ),
        ),
      ].slice(0, 20),
      confidence: scoreBand(assessment.confidence.score),
    };
  }

  // Prioridade da oferta recomendada ou, sem ela, da primeira avaliada. Nunca o Fit sozinho
  // (KI-132): a prioridade já combina Fit, oportunidade, confiança e potencial.
  const prioritized = assessment ?? diagnosis.offers[0] ?? null;
  const qualification: ApproachInsights['qualification'] = prioritized
    ? {
        priority: scoreBand(prioritized.priority),
        recommendation: clip(
          `${RECOMMENDATION_LABELS[diagnosis.recommendation]} · próximo passo: ${NEXT_STEP_LABELS[diagnosis.nextStep].toLowerCase()}`,
          MAX_RECOMMENDATION,
        ),
        assessedAt,
      }
    : null;

  return { diagnosis: summary, recommendedService, qualification };
}

/**
 * Porta `ApproachInsightsSource` sobre a investigação de Empresas. Falha de leitura vira "sem
 * diagnóstico" (a abordagem segue com base limitada), nunca erro na tela do Relacionamento.
 */
export function createInvestigationInsightsSource(deps: {
  investigations: Pick<InvestigationService, 'history'>;
  evidence: Pick<EvidenceRepository, 'claimsByIds'>;
  clock?: Clock;
  log?: (message: string) => void;
}): ApproachInsightsSource {
  const clock = deps.clock ?? systemClock;
  return {
    async forCompany(ctx: RequestContext, companyId: string) {
      try {
        const history = await deps.investigations.history(ctx, companyId, RECENT_INVESTIGATIONS);
        const investigation = latestDiagnosed(history);
        if (!investigation) return EMPTY_APPROACH_INSIGHTS;
        const ids = claimIdsOf(investigation);
        const claims = ids.length > 0 ? await deps.evidence.claimsByIds(ids) : [];
        return insightsFromInvestigation(investigation, claims, clock.now());
      } catch (error) {
        deps.log?.(`diagnóstico não lido para a abordagem: ${String(error)}`);
        return EMPTY_APPROACH_INSIGHTS;
      }
    },
  };
}
