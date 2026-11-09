import {
  LiaContent,
  RubricContent,
  ScoringModelContent,
  type IcpContent,
  type OfferContent,
  type ProofAssetInput,
} from '@prospector/contracts';
import { describe, expect, it } from 'vitest';
import {
  DRAFT_BRANDING_RUBRIC,
  DRAFT_LIA,
  DRAFT_SCORING_MODEL,
  canChangeStatus,
  icpActivationIssues,
  icpContentIssues,
  offerActivationIssues,
  offerCompletenessGaps,
  offerContentIssues,
  proofAssetIssues,
  rubricIssues,
  sameContent,
  scoringModelIssues,
  weightsTotal,
} from '../../src';

const codes = (issues: readonly { code: string }[]) => issues.map((i) => i.code);
const fields = (issues: readonly { field: string }[]) => issues.map((i) => i.field);

const completeOffer: OfferContent = {
  name: 'Identidade visual para PMEs',
  description: '',
  problems: ['Marca inconsistente entre canais'],
  needSignals: ['Site e redes com logotipos diferentes'],
  disqualifiers: ['Rebranding concluído há menos de 18 meses'],
  deliverables: ['Sistema de identidade visual'],
  valueProps: [],
  priceMinCents: 1_500_000,
  priceMaxCents: 6_000_000,
};

describe('pesos', () => {
  it('soma inteiros', () => {
    expect(weightsTotal([25, 30, 20, 15, 10])).toBe(100);
    expect(weightsTotal([])).toBe(0);
  });
});

describe('oferta', () => {
  it('conteúdo completo não tem problemas nem lacunas', () => {
    expect(offerContentIssues(completeOffer)).toEqual([]);
    expect(offerCompletenessGaps(completeOffer)).toEqual([]);
  });

  it('faixa de investimento invertida é recusada', () => {
    const issues = offerContentIssues({ ...completeOffer, priceMinCents: 10, priceMaxCents: 5 });
    expect(fields(issues)).toEqual(['priceMaxCents']);
  });

  it('itens repetidos numa lista são recusados', () => {
    const issues = offerContentIssues({
      ...completeOffer,
      problems: ['Marca antiga', 'marca antiga '],
    });
    expect(codes(issues)).toEqual(['duplicate_item']);
    expect(fields(issues)).toEqual(['problems']);
  });

  it('lista o que falta para a oferta ficar completa', () => {
    const gaps = offerCompletenessGaps({
      ...completeOffer,
      disqualifiers: [],
      priceMinCents: null,
      priceMaxCents: null,
    });
    expect(gaps).toEqual(['desqualificadores', 'faixa de investimento']);
    expect(offerCompletenessGaps(null)).toEqual(['conteúdo da oferta']);
  });

  it('ativar exige conteúdo completo, rubrica e modelo de score', () => {
    expect(
      offerActivationIssues({ current: completeOffer, hasRubric: true, hasScoringModel: true }),
    ).toEqual([]);
    const issues = offerActivationIssues({
      current: { ...completeOffer, deliverables: [] },
      hasRubric: false,
      hasScoringModel: false,
    });
    expect(codes(issues)).toEqual(['offer_incomplete', 'rubric_missing', 'scoring_model_missing']);
    expect(issues[0]?.message).toContain('entregáveis');
  });

  it('transições de status permitidas', () => {
    expect(canChangeStatus('draft', 'active')).toBe(true);
    expect(canChangeStatus('active', 'draft')).toBe(true);
    expect(canChangeStatus('active', 'archived')).toBe(true);
    expect(canChangeStatus('archived', 'draft')).toBe(true);
    expect(canChangeStatus('archived', 'active')).toBe(false);
    expect(canChangeStatus('draft', 'draft')).toBe(false);
  });
});

describe('rubrica', () => {
  const criterion = (key: string, weight: number) => ({
    key,
    label: key,
    description: 'Descrição do critério.',
    weight,
    evidenceRequired: ['site_desktop' as const],
  });

  it('pesos que somam 100 e chaves únicas passam', () => {
    const rubric: RubricContent = { criteria: [criterion('a', 60), criterion('b', 40)] };
    expect(rubricIssues(rubric)).toEqual([]);
  });

  it('pesos que não somam 100 são recusados com o total', () => {
    const issues = rubricIssues({ criteria: [criterion('a', 60), criterion('b', 30)] });
    expect(codes(issues)).toEqual(['weights_total']);
    expect(issues[0]?.field).toBe('criteria');
    expect(issues[0]?.message).toContain('90');
  });

  it('chave repetida aponta o critério', () => {
    const issues = rubricIssues({ criteria: [criterion('a', 50), criterion('a', 50)] });
    expect(fields(issues)).toEqual(['criteria.1.key']);
  });
});

describe('modelo de score', () => {
  const valid: ScoringModelContent = {
    weights: { fit: 25, need: 30, signal: 20, capacity: 15, timing: 10 },
    thresholds: {
      pursuePriority: 70,
      prepareAccessPotential: 70,
      discardPotential: 40,
      minEvidenceCoverage: 50,
    },
  };

  it('pesos de branding propostos no doc 08 passam', () => {
    expect(scoringModelIssues(valid)).toEqual([]);
  });

  it('pesos que não somam 100 são recusados', () => {
    const issues = scoringModelIssues({ ...valid, weights: { ...valid.weights, fit: 35 } });
    expect(codes(issues)).toEqual(['weights_total']);
    expect(issues[0]?.message).toContain('110');
  });

  it('todos os pesos zerados são recusados (soma 0)', () => {
    const zero = { fit: 0, need: 0, signal: 0, capacity: 0, timing: 0 };
    expect(codes(scoringModelIssues({ ...valid, weights: zero }))).toEqual(['weights_total']);
  });

  it('limiar de descarte precisa ficar abaixo dos de abordar e preparar acesso', () => {
    const issues = scoringModelIssues({
      ...valid,
      thresholds: { ...valid.thresholds, discardPotential: 80 },
    });
    expect(fields(issues)).toEqual(['thresholds.discardPotential']);
  });
});

describe('ICP', () => {
  const icp: IcpContent = {
    name: 'Clínicas no Paraná',
    description: '',
    filters: {
      cnaes: ['8630-5/04'],
      ufs: ['PR'],
      municipalities: [],
      sizes: ['me', 'epp'],
      minAgeYears: 3,
      maxAgeYears: null,
    },
    exclusions: { cnaes: [], municipalities: [], cnpjRoots: [], domains: [] },
  };

  it('ICP com recorte é válido e ativável', () => {
    expect(icpContentIssues(icp)).toEqual([]);
    expect(icpActivationIssues(icp)).toEqual([]);
  });

  it('idade mínima maior que a máxima é recusada', () => {
    const issues = icpContentIssues({
      ...icp,
      filters: { ...icp.filters, minAgeYears: 10, maxAgeYears: 5 },
    });
    expect(fields(issues)).toEqual(['filters.maxAgeYears']);
  });

  it('CNAE incluído e excluído ao mesmo tempo é recusado', () => {
    const issues = icpContentIssues({
      ...icp,
      exclusions: { ...icp.exclusions, cnaes: ['8630-5/04'] },
    });
    expect(fields(issues)).toEqual(['exclusions.cnaes']);
  });

  it('município incluído e excluído ao mesmo tempo é recusado (sem diferenciar acento)', () => {
    const issues = icpContentIssues({
      ...icp,
      filters: { ...icp.filters, municipalities: [{ name: 'Maringá', uf: 'PR' }] },
      exclusions: { ...icp.exclusions, municipalities: [{ name: 'maringa', uf: 'PR' }] },
    });
    expect(fields(issues)).toEqual(['exclusions.municipalities']);
  });

  it('município fora das UFs escolhidas é recusado', () => {
    const issues = icpContentIssues({
      ...icp,
      filters: { ...icp.filters, municipalities: [{ name: 'Campinas', uf: 'SP' }] },
    });
    expect(fields(issues)).toEqual(['filters.municipalities']);
  });

  it('ativar exige ao menos um recorte de segmento ou região', () => {
    const open = {
      ...icp,
      filters: { ...icp.filters, cnaes: [], ufs: [], municipalities: [] },
    };
    expect(codes(icpActivationIssues(open))).toEqual(['icp_without_scope']);
  });
});

describe('cases', () => {
  const base: ProofAssetInput = {
    offerId: null,
    title: 'Clínica X',
    segment: 'Saúde',
    summary: 'Nova identidade.',
    results: '',
    publicOk: false,
    consentRef: '',
  };

  it('case privado não precisa de autorização', () => {
    expect(proofAssetIssues(base)).toEqual([]);
  });

  it('case público exige referência da autorização do cliente', () => {
    expect(fields(proofAssetIssues({ ...base, publicOk: true }))).toEqual(['consentRef']);
    expect(proofAssetIssues({ ...base, publicOk: true, consentRef: 'E-mail de 03/2026' })).toEqual(
      [],
    );
  });
});

describe('sameContent', () => {
  it('ignora a ordem das chaves e compara listas na ordem', () => {
    expect(sameContent({ a: 1, b: [1, 2] }, { b: [1, 2], a: 1 })).toBe(true);
    expect(sameContent({ a: 1, b: [1, 2] }, { a: 1, b: [2, 1] })).toBe(false);
    expect(sameContent({ a: null }, { a: null })).toBe(true);
    expect(sameContent({ a: 'x' }, { a: 'y' })).toBe(false);
  });
});

describe('rascunhos sugeridos', () => {
  it('rubrica e modelo de score sugeridos passam no contrato e nas regras', () => {
    expect(RubricContent.parse(DRAFT_BRANDING_RUBRIC)).toEqual(DRAFT_BRANDING_RUBRIC);
    expect(ScoringModelContent.parse(DRAFT_SCORING_MODEL)).toEqual(DRAFT_SCORING_MODEL);
    expect(rubricIssues(DRAFT_BRANDING_RUBRIC)).toEqual([]);
    expect(scoringModelIssues(DRAFT_SCORING_MODEL)).toEqual([]);
  });

  it('LIA sugerida deixa a conclusão para quem aprova', () => {
    expect(DRAFT_LIA.conclusion).toBe('');
    expect(LiaContent.safeParse(DRAFT_LIA).success).toBe(false);
    expect(
      LiaContent.safeParse({ ...DRAFT_LIA, conclusion: 'Escrita por quem aprova.' }).success,
    ).toBe(true);
  });
});
