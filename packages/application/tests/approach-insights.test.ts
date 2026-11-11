import {
  EMPTY_APPROACH_INSIGHTS,
  EMPTY_INVESTIGATION_SNAPSHOT,
  type Claim,
  type Diagnosis,
  type Investigation,
  type OfferAssessment,
} from '@prospector/contracts';
import { describe, expect, it } from 'vitest';
import {
  createInvestigationInsightsSource,
  insightsFromInvestigation,
  latestDiagnosed,
  NO_READING_NOTICE,
  NO_SUMMARY_NOTICE,
  scoreBand,
  type RequestContext,
} from '../src';

/**
 * KI-129: diagnóstico de Empresas (ADR-0015) → insumos da abordagem do Relacionamento (ADR-0014).
 * Investigações e claims SINTÉTICOS, montados à mão.
 */

const ctx: RequestContext = {
  actor: { type: 'user' },
  traceId: '0b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d',
};
const NOW = new Date('2026-11-11T15:00:00Z');
const COMPANY = '10000000-0000-4000-8000-000000000001';
const OFFER = '20000000-0000-4000-8000-000000000001';
const OFFER_VERSION = '20000000-0000-4000-8000-000000000002';
const OTHER_OFFER = '20000000-0000-4000-8000-000000000003';

const id = (n: number) => `30000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function claim(
  n: number,
  epistemicType: Claim['epistemicType'],
  statement: string,
  overrides: Partial<Claim> = {},
): Claim {
  return {
    schemaVersion: 1,
    id: id(n),
    subjectType: 'company',
    subjectId: COMPANY,
    domain: 'positioning',
    key: `positioning.teste.c${n}`,
    statement,
    value: null,
    epistemicType,
    confidence: epistemicType === 'hypothesis' ? null : 0.8,
    status: 'active',
    validUntil: '2027-05-01T00:00:00.000Z',
    reasoning: null,
    reasoningFactor: epistemicType === 'inference' ? 0.9 : null,
    producedByRunId: null,
    promptVersionId: null,
    supersedesId: null,
    reviewedAt: null,
    isDemo: true,
    createdAt: '2026-11-10T12:00:00.000Z',
    ...overrides,
  };
}

const SUMMARY = claim(
  1,
  'inference',
  'Marca sólida no cadastro, mas o site não acompanha a empresa.',
);
const FACT = claim(2, 'fact', 'O site da empresa usa um modelo de 2014.');
const INFERENCE = claim(3, 'inference', 'A identidade visual não comunica a linha premium.');
const HYPOTHESIS = claim(4, 'hypothesis', 'Talvez estejam preparando uma nova unidade.');
const OPPORTUNITY = claim(5, 'inference', 'Rebranding ajudaria a vender a linha premium.');
const READING = claim(6, 'inference', 'Justificativa: necessidade de marca observada no site.');
const EXPIRED = claim(7, 'fact', 'Fato vencido.', { validUntil: '2026-01-01T00:00:00.000Z' });
const SUPERSEDED = claim(8, 'fact', 'Fato substituído.', { status: 'superseded' });

const CLAIMS = [SUMMARY, FACT, INFERENCE, HYPOTHESIS, OPPORTUNITY, READING, EXPIRED, SUPERSEDED];

function assessment(overrides: Partial<OfferAssessment> = {}): OfferAssessment {
  return {
    offerId: OFFER,
    offerVersionId: OFFER_VERSION,
    offerName: 'Identidade visual para indústrias',
    scoringModelId: null,
    icpVersionId: null,
    fit: { score: 100, checks: [] },
    opportunity: { score: 70, claimIds: [OPPORTUNITY.id, EXPIRED.id] },
    confidence: { score: 74, coveredDimensions: 3 },
    potential: 60,
    priority: 75,
    recommendation: 'pursue',
    gates: [],
    readingClaimId: READING.id,
    ...overrides,
  };
}

function diagnosis(overrides: Partial<Diagnosis> = {}): Diagnosis {
  return {
    summaryClaimId: SUMMARY.id,
    factClaimIds: [FACT.id, EXPIRED.id, SUPERSEDED.id],
    inferenceClaimIds: [INFERENCE.id, SUMMARY.id],
    hypothesisClaimIds: [HYPOTHESIS.id],
    opportunityClaimIds: [OPPORTUNITY.id],
    gaps: [],
    offers: [assessment()],
    recommendedOfferId: OFFER,
    recommendation: 'pursue',
    nextStep: 'prepare_approach',
    confidence: 70,
    verification: { discarded: 0, reasons: [] },
    ...overrides,
  };
}

function investigation(overrides: Partial<Investigation> = {}): Investigation {
  return {
    id: '40000000-0000-4000-8000-000000000001',
    companyId: COMPANY,
    status: 'succeeded',
    trigger: 'user',
    pipelineVersion: 1,
    steps: [],
    usage: {
      searches: 0,
      searchCredits: 0,
      pagesRead: 0,
      captures: 0,
      captureBytes: 0,
      modelCalls: 0,
      modelMs: 0,
    },
    models: [
      { agent: 'company-business', model: 'modelo-falso', promptVersion: 'company-business/v1' },
      { agent: 'diagnosis', model: 'modelo-falso', promptVersion: 'diagnosis/v1' },
    ],
    diagnosis: diagnosis(),
    snapshot: EMPTY_INVESTIGATION_SNAPSHOT,
    changes: [],
    previousId: null,
    jobId: null,
    issue: null,
    cancelRequestedAt: null,
    startedAt: '2026-11-10T11:00:00.000Z',
    finishedAt: '2026-11-10T12:00:00.000Z',
    isDemo: true,
    createdAt: '2026-11-10T11:00:00.000Z',
    updatedAt: '2026-11-10T12:00:00.000Z',
    ...overrides,
  };
}

describe('diagnóstico de Empresas para a abordagem (KI-129)', () => {
  it('investigação concluída vira diagnóstico completo com achados em vigor, por tipo', () => {
    const insights = insightsFromInvestigation(investigation(), CLAIMS, NOW);
    expect(insights.diagnosis).toMatchObject({
      id: '40000000-0000-4000-8000-000000000001',
      status: 'complete',
      summary: SUMMARY.statement,
      producedAt: '2026-11-10T12:00:00.000Z',
      promptId: 'diagnosis/v1',
    });
    // Ordem fato, oportunidade, inferência, hipótese; vencido, substituído e o resumo ficam fora.
    expect(insights.diagnosis?.findings).toEqual([
      { statement: `Fato observado: ${FACT.statement}`, claimIds: [FACT.id] },
      {
        statement: `Oportunidade (inferência): ${OPPORTUNITY.statement}`,
        claimIds: [OPPORTUNITY.id],
      },
      { statement: `Inferência: ${INFERENCE.statement}`, claimIds: [INFERENCE.id] },
      { statement: `Hipótese a confirmar: ${HYPOTHESIS.statement}`, claimIds: [HYPOTHESIS.id] },
    ]);
  });

  it('serviço recomendado e qualificação pelas faixas combinadas, sem usar o Fit', () => {
    const insights = insightsFromInvestigation(investigation(), CLAIMS, NOW);
    expect(insights.recommendedService).toEqual({
      offerId: OFFER,
      offerVersionId: OFFER_VERSION,
      rationale: `Oferta recomendada: Identidade visual para indústrias. ${READING.statement}`,
      // O claim vencido da oportunidade sai.
      claimIds: [OPPORTUNITY.id, READING.id],
      confidence: 'medium',
    });
    expect(insights.qualification).toEqual({
      priority: 'high',
      recommendation: 'Abordar agora · próximo passo: preparar abordagem',
      assessedAt: '2026-11-10T12:00:00.000Z',
    });
    // Fit 100 com prioridade baixa continua baixa: o Fit nunca decide sozinho (KI-132).
    const low = insightsFromInvestigation(
      investigation({ diagnosis: diagnosis({ offers: [assessment({ priority: 49 })] }) }),
      CLAIMS,
      NOW,
    );
    expect(low.qualification?.priority).toBe('low');
  });

  it('faixas: abaixo de 50 baixa, de 50 a 74 média, 75 ou mais alta', () => {
    expect([0, 49, 50, 74, 75, 100].map(scoreBand)).toEqual([
      'low',
      'low',
      'medium',
      'medium',
      'high',
      'high',
    ]);
  });

  it('sem resumo em vigor, o diagnóstico fica parcial com aviso do sistema', () => {
    const withoutSummary = insightsFromInvestigation(
      investigation({ diagnosis: diagnosis({ summaryClaimId: null }) }),
      CLAIMS,
      NOW,
    );
    expect(withoutSummary.diagnosis).toMatchObject({
      status: 'partial',
      summary: NO_SUMMARY_NOTICE,
    });
    expect(withoutSummary.diagnosis?.findings.length).toBeGreaterThan(0);
    // Resumo que saiu de vigor conta como ausente.
    const expiredSummary = insightsFromInvestigation(
      investigation(),
      CLAIMS.map((item) => (item.id === SUMMARY.id ? { ...item, status: 'stale' as const } : item)),
      NOW,
    );
    expect(expiredSummary.diagnosis?.status).toBe('partial');
    // Investigação "concluída com lacunas" nunca vira diagnóstico completo.
    const partial = insightsFromInvestigation(investigation({ status: 'partial' }), CLAIMS, NOW);
    expect(partial.diagnosis?.status).toBe('partial');
  });

  it('sem resumo nem achado em vigor, não há diagnóstico (a abordagem fica com base limitada)', () => {
    const insights = insightsFromInvestigation(
      investigation({
        diagnosis: diagnosis({
          summaryClaimId: null,
          factClaimIds: [EXPIRED.id],
          inferenceClaimIds: [],
          hypothesisClaimIds: [],
          opportunityClaimIds: [],
        }),
      }),
      CLAIMS,
      NOW,
    );
    expect(insights.diagnosis).toBeNull();
  });

  it('no máximo 12 achados, fatos primeiro', () => {
    const facts = Array.from({ length: 15 }, (_, index) =>
      claim(100 + index, 'fact', `Fato sintético número ${index + 1}.`),
    );
    const insights = insightsFromInvestigation(
      investigation({ diagnosis: diagnosis({ factClaimIds: facts.map((item) => item.id) }) }),
      [...CLAIMS, ...facts],
      NOW,
    );
    expect(insights.diagnosis?.findings).toHaveLength(12);
    expect(insights.diagnosis?.findings.every((item) => item.statement.startsWith('Fato'))).toBe(
      true,
    );
  });

  it('sem leitura da IA para a oferta, a justificativa diz isso; sem recomendação, sem serviço', () => {
    const noReading = insightsFromInvestigation(
      investigation({ diagnosis: diagnosis({ offers: [assessment({ readingClaimId: null })] }) }),
      CLAIMS,
      NOW,
    );
    expect(noReading.recommendedService?.rationale).toBe(
      `Oferta recomendada: Identidade visual para indústrias. ${NO_READING_NOTICE}`,
    );
    expect(noReading.recommendedService?.claimIds).toEqual([OPPORTUNITY.id]);
    const noRecommendation = insightsFromInvestigation(
      investigation({
        diagnosis: diagnosis({
          recommendedOfferId: null,
          recommendation: 'insufficient_evidence',
          nextStep: 'investigate_more',
          offers: [assessment({ offerId: OTHER_OFFER, priority: 40 })],
        }),
      }),
      CLAIMS,
      NOW,
    );
    expect(noRecommendation.recommendedService).toBeNull();
    expect(noRecommendation.qualification).toMatchObject({
      priority: 'low',
      recommendation: 'Sem base suficiente · próximo passo: investigar mais',
    });
  });

  it('investigação sem diagnóstico (fila, falha, cancelada) não vira insumo', () => {
    for (const status of ['queued', 'running', 'failed', 'cancelled', 'interrupted'] as const) {
      expect(insightsFromInvestigation(investigation({ status }), CLAIMS, NOW)).toEqual(
        EMPTY_APPROACH_INSIGHTS,
      );
    }
    expect(insightsFromInvestigation(null, CLAIMS, NOW)).toEqual(EMPTY_APPROACH_INSIGHTS);
  });

  it('uma investigação nova em andamento não esconde o último diagnóstico', () => {
    const running = investigation({
      id: '40000000-0000-4000-8000-000000000002',
      status: 'running',
      diagnosis: null,
    });
    const done = investigation();
    expect(latestDiagnosed([running, done])?.id).toBe(done.id);
    expect(latestDiagnosed([running])).toBeNull();
  });

  it('a fonte lê a investigação e os claims citados; falha de leitura vira "sem diagnóstico"', async () => {
    const asked: string[][] = [];
    const logs: string[] = [];
    const source = createInvestigationInsightsSource({
      investigations: {
        history: async (_ctx, companyId, limit) => {
          expect(companyId).toBe(COMPANY);
          expect(limit).toBe(5);
          return [investigation()];
        },
      },
      evidence: {
        claimsByIds: async (ids) => {
          asked.push([...ids]);
          return CLAIMS.filter((item) => ids.includes(item.id));
        },
      },
      clock: { now: () => NOW },
    });
    const insights = await source.forCompany(ctx, COMPANY);
    expect(insights.diagnosis?.status).toBe('complete');
    expect(asked).toHaveLength(1);
    expect(asked[0]).toEqual(expect.arrayContaining([SUMMARY.id, FACT.id, READING.id]));

    const failing = createInvestigationInsightsSource({
      investigations: {
        history: async () => {
          throw new Error('banco fora do ar');
        },
      },
      evidence: { claimsByIds: async () => [] },
      log: (message) => logs.push(message),
    });
    expect(await failing.forCompany(ctx, COMPANY)).toEqual(EMPTY_APPROACH_INSIGHTS);
    expect(logs).toHaveLength(1);
  });
});
