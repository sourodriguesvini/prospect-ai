import { IcpContent, OfferContent } from '@prospector/contracts';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SCORING_MODEL,
  capacityScore,
  dedupeByStatement,
  evaluateFit,
  forbiddenAssertion,
  incompleteStatement,
  knowledgeGaps,
  needScore,
  nextStepFor,
  offerGates,
  pickRecommendedOffer,
  qualifyOffer,
  recordDiscard,
  emptyVerificationLog,
  resolveRefs,
  signalScore,
  type Firmographics,
  type QualificationInput,
} from '../../src';

const now = new Date('2026-11-11T12:00:00Z');

const firm: Firmographics = {
  cnaeMain: '8630-5/04',
  cnaeSecondary: [],
  uf: 'PR',
  city: 'Curitiba',
  sizeBand: 'epp',
  isMei: false,
  activityStart: '2018-03-01',
  registryStatus: 'active',
  headquarters: true,
  shareCapitalCents: 15_000_000,
  cnpjRoot: '12345678',
  domain: 'clinicaexemplo.com.br',
};

const icp = IcpContent.parse({
  name: 'Clínicas odontológicas no Paraná',
  description: '',
  filters: {
    cnaes: ['8630-5/04'],
    ufs: ['PR'],
    municipalities: [],
    sizes: ['me', 'epp'],
    minAgeYears: 2,
    maxAgeYears: null,
  },
  exclusions: { cnaes: [], municipalities: [], cnpjRoots: [], domains: [] },
});

const offer = OfferContent.parse({
  name: 'Rebranding',
  description: '',
  problems: ['Aparência datada'],
  needSignals: ['Estética antiga'],
  disqualifiers: [
    'Rebranding nos últimos dois anos',
    'Marca controlada por matriz ou franqueadora',
    'Situação cadastral diferente de ativa',
  ],
  deliverables: ['Nova identidade'],
  valueProps: [],
  priceMinCents: null,
  priceMaxCents: null,
});

const strongClaim = { id: '00000000-0000-4000-8000-000000000001', confidence: 0.85 };
const registryClaim = { id: '00000000-0000-4000-8000-000000000002', confidence: 0.95 };

function input(overrides: Partial<QualificationInput> = {}): QualificationInput {
  return {
    offer,
    scoringModel: DEFAULT_SCORING_MODEL,
    icp,
    firm,
    fitClaims: [registryClaim],
    capacityClaims: [registryClaim],
    need: { relevance: 'strong', supporting: [strongClaim], auditScores: [2, 2, 3] },
    signals: {
      searched: true,
      claims: [{ id: '00000000-0000-4000-8000-000000000003', confidence: 0.7, ageDays: 20 }],
    },
    flaggedDisqualifiers: [],
    accessKnown: false,
    now,
    ...overrides,
  };
}

describe('Fit pelo ICP', () => {
  it('conta só critérios cadastrados; dado desconhecido não soma nem tira', () => {
    const fit = evaluateFit(firm, icp, now);
    expect(fit.score).toBe(100);
    expect(fit.checks.map((check) => check.criterion)).toEqual([
      'registry_status',
      'cnae',
      'uf',
      'size',
      'age',
    ]);
    const unknown = evaluateFit({ ...firm, uf: null, sizeBand: null }, icp, now);
    expect(unknown.score).toBe(100);
    expect(unknown.checks.find((check) => check.criterion === 'uf')?.met).toBeNull();
  });

  it('MEI fica fora dos portes, e situação inativa é barreira', () => {
    const fit = evaluateFit({ ...firm, isMei: true, registryStatus: 'closed' }, icp, now);
    expect(fit.checks.find((check) => check.criterion === 'size')?.met).toBe(false);
    expect(fit.gates.map((gate) => gate.text)).toEqual([
      'Situação cadastral inativa na Receita Federal.',
    ]);
  });

  it('exclusão do ICP é barreira com o motivo', () => {
    const fit = evaluateFit(
      firm,
      { ...icp, exclusions: { ...icp.exclusions, domains: ['clinicaexemplo.com.br'] } },
      now,
    );
    expect(fit.gates[0]?.text).toContain('domínio');
  });

  it('sem ICP não há nota de Fit', () => {
    expect(evaluateFit(firm, null, now).score).toBeNull();
  });
});

describe('desqualificadores da oferta', () => {
  it('filial confere sozinho; rebranding recente vira acompanhar; situação fica com a regra geral', () => {
    const gates = offerGates(offer, { ...firm, headquarters: false }, [1, 3]);
    expect(gates).toEqual([
      {
        text: 'Desqualificador da oferta: Rebranding nos últimos dois anos (apontado pela IA; confira antes de descartar).',
        kind: 'monitor',
      },
      {
        text: 'Desqualificador da oferta: Marca controlada por matriz ou franqueadora (o CNPJ é de uma filial).',
        kind: 'discard',
      },
    ]);
  });
});

describe('desqualificador apontado só pela IA', () => {
  it('nunca descarta: no máximo acompanhar (KI-133, caso real 2026-11-11)', () => {
    // Antes, "controlada por matriz" apontado pela IA (com a sede no CNPJ) descartava.
    const gates = offerGates(offer, { ...firm, headquarters: true }, [2]);
    expect(gates).toHaveLength(1);
    expect(gates[0]?.kind).toBe('monitor');
    expect(gates[0]?.text).toContain('apontado pela IA');
  });
});

describe('dimensões', () => {
  it('necessidade sem claim que sustente não passa de 30', () => {
    expect(needScore({ relevance: 'strong', supporting: [], auditScores: [] })).toBe(30);
    expect(needScore({ relevance: null, supporting: [], auditScores: [] })).toBeNull();
    expect(needScore({ relevance: 'strong', supporting: [strongClaim], auditScores: [1, 1] })).toBe(
      91,
    );
  });

  it('sinal decai com a idade e não roda = desconhecido', () => {
    expect(signalScore({ searched: false, claims: [] })).toBeNull();
    expect(signalScore({ searched: true, claims: [] })).toBe(0);
    expect(
      signalScore({ searched: true, claims: [{ id: 'a', confidence: 0.7, ageDays: 0 }] }),
    ).toBe(40);
    expect(
      signalScore({ searched: true, claims: [{ id: 'a', confidence: 0.7, ageDays: 400 }] }),
    ).toBe(10);
  });

  it('capacidade por porte e capital; MEI é baixa', () => {
    expect(capacityScore({ ...firm, isMei: true })).toBe(15);
    expect(capacityScore(firm)).toBe(70);
    expect(capacityScore({ ...firm, sizeBand: null })).toBeNull();
  });
});

describe('qualifyOffer', () => {
  it('necessidade sustentada e potencial alto, sem canal conhecido: preparar acesso', () => {
    const result = qualifyOffer(input());
    expect(result.potential).toBeGreaterThanOrEqual(70);
    expect(result.recommendation).toBe('prepare_access');
    expect(result.confidence.coveredDimensions).toBe(5);
    expect(result.priority).toBeLessThan(result.potential);
    expect(result.opportunity.claimIds).toContain(strongClaim.id);
  });

  it('com canal conhecido e prioridade alta: abordar agora', () => {
    expect(qualifyOffer(input({ accessKnown: true })).recommendation).toBe('pursue');
  });

  it('barreira de descarte vence qualquer pontuação', () => {
    const result = qualifyOffer(input({ firm: { ...firm, registryStatus: 'suspended' } }));
    expect(result.recommendation).toBe('discard');
    expect(result.gates).toContain('Situação cadastral inativa na Receita Federal.');
  });

  it('rebranding recente apontado com evidência: acompanhar', () => {
    expect(qualifyOffer(input({ flaggedDisqualifiers: [1] })).recommendation).toBe('monitor');
  });

  it('sem IA e sem sinais a cobertura cai: sem base suficiente', () => {
    const result = qualifyOffer(
      input({
        need: { relevance: null, supporting: [], auditScores: [] },
        signals: { searched: false, claims: [] },
        fitClaims: [],
        capacityClaims: [],
      }),
    );
    expect(result.confidence.coveredDimensions).toBe(0);
    expect(result.recommendation).toBe('insufficient_evidence');
  });

  it('bom Fit sem necessidade observada: acompanhar', () => {
    const result = qualifyOffer(
      input({
        need: { relevance: 'none', supporting: [strongClaim], auditScores: [5, 4, 5] },
        signals: {
          searched: true,
          claims: [{ id: '00000000-0000-4000-8000-000000000003', confidence: 0.7, ageDays: 20 }],
        },
      }),
    );
    expect(result.recommendation).toBe('monitor');
  });
});

describe('diagnóstico geral', () => {
  it('oferta recomendada segue a recomendação e depois a prioridade', () => {
    const best = pickRecommendedOffer([
      { offerId: 'a', priority: 90, recommendation: 'discard' as const },
      { offerId: 'b', priority: 50, recommendation: 'prepare_access' as const },
      { offerId: 'c', priority: 60, recommendation: 'prepare_access' as const },
    ]);
    expect(best?.offerId).toBe('c');
    expect(pickRecommendedOffer([])).toBeNull();
  });

  it('próximo passo: sem site pede confirmação; descarte é descarte', () => {
    expect(nextStepFor('prepare_access', false)).toBe('confirm_site');
    expect(nextStepFor('discard', false)).toBe('discard_for_now');
    expect(nextStepFor('monitor', true)).toBe('watch_signal');
  });

  it('lacunas em texto do sistema', () => {
    const gaps = knowledgeGaps({
      hasSite: true,
      siteRead: true,
      captured: true,
      visualAnalyzed: false,
      competitorsFound: false,
      signalsFound: true,
      contactChannelKnown: false,
      registryChecked: true,
      sourceCount: 5,
    });
    expect(gaps.map((gap) => gap.code)).toEqual([
      'no_visual_analysis',
      'no_competitors',
      'no_contact_channel',
    ]);
  });
});

describe('verificação das afirmações da IA', () => {
  it.each([
    ['A clínica fatura cerca de R$ 2 milhões por ano.', 'revenue'],
    ['O orçamento de marketing é pequeno.', 'budget'],
    ['A marca mostra falta de investimento em design.', 'budget'],
    ['A empresa não investiu na identidade visual.', 'budget'],
    ['O site foi refeito para reduzir custos.', 'budget'],
    ['O site tem baixa conversão e está perdendo pacientes.', 'conversion'],
    ['Os sócios estão insatisfeitos com a marca.', 'dissatisfaction'],
    ['A empresa está procurando uma agência.', 'hiring_intent'],
    ['A clínica precisa de rebranding.', 'needs_service'],
    ['A diretoria decidiu expandir para Londrina.', 'internal_decision'],
    ['O engajamento caiu nos últimos meses.', 'campaign_results'],
  ])('descarta: %s', (text, code) => {
    expect(forbiddenAssertion(text)?.code).toBe(code);
  });

  it.each([
    'A clínica pode precisar de rebranding se a nova unidade abrir com outra marca.',
    'O site usa três fontes diferentes e o logotipo aparece pixelado no celular.',
    'A página de tratamentos lista implante, clareamento e ortodontia.',
  ])('mantém: %s', (text) => {
    expect(forbiddenAssertion(text)).toBeNull();
  });

  it('reconhece afirmação interrompida pelo modelo (caso real, 2026-11-11)', () => {
    expect(incompleteStatement('A marca pode estar sofrendo com a percepção de')).toBe(true);
    expect(incompleteStatement('O site é lido por arquitetos e')).toBe(true);
    expect(incompleteStatement('A marca pode estar sofrendo com a percepção de amadorismo.')).toBe(
      false,
    );
    expect(incompleteStatement('Logotipo em bitmap de 91×27 px')).toBe(false);
    expect(incompleteStatement('Texto longo encurtado pelo sistema de…')).toBe(false);
    expect(incompleteStatement('')).toBe(false);
  });

  it('tira repetições quase iguais', () => {
    const { kept, dropped } = dedupeByStatement(
      [
        'O logotipo aparece pixelado no celular.',
        'O logotipo aparece pixelado no celular!',
        'A paleta muda entre o site e o Instagram.',
      ],
      (text) => text,
    );
    expect(kept).toHaveLength(2);
    expect(dropped).toBe(1);
  });

  it('referência inventada fica de fora', () => {
    const known = new Map([
      ['P1', 'page-1'],
      ['K2', 'claim-2'],
    ]);
    expect(resolveRefs(['p1', 'K2', 'K9', 'P1'], known)).toEqual({
      resolved: ['page-1', 'claim-2'],
      unknown: ['K9'],
    });
  });

  it('registro de descartes guarda cada motivo uma vez', () => {
    const log = emptyVerificationLog();
    recordDiscard(log, 'sem fonte');
    recordDiscard(log, 'sem fonte', 2);
    recordDiscard(log, 'nada', 0);
    expect(log).toEqual({ discarded: 3, reasons: ['sem fonte'] });
  });
});
