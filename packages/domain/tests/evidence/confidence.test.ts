import { describe, expect, it } from 'vitest';
import {
  DEFAULT_EVIDENCE_POLICY,
  applyReasoningFactor,
  assessFact,
  assessHypothesis,
  assessInference,
  canSupportAssertion,
  confidenceBand,
  effectiveStatus,
  freshness,
  resolveStatus,
  roundConfidence,
  validityDaysFor,
} from '../../src';
import {
  DAY_MS,
  NOW,
  contradicts,
  daysAgo,
  daysFromNow,
  dependency,
  msAgo,
  source,
  supports,
} from './fixtures';

/** Fato firmográfico (validade de 90 dias). */
function fact(...evidence: Parameters<typeof assessFact>[0]['evidence']) {
  return assessFact({ domain: 'firmographic', key: 'firmographic.cnae_main', evidence, now: NOW });
}

describe('roundConfidence', () => {
  it.each([
    [0.799, 0.79],
    [0.8, 0.8],
    [0.6, 0.6],
    [0.5999999999999999, 0.6],
    [0.85 + 0.05 + 0.05, 0.95],
    [0.6375, 0.63],
    [1.2, 1],
    [-0.1, 0],
  ])('%d → %d (trunca em 2 casas, nunca sobe de faixa)', (value, expected) => {
    expect(roundConfidence(value)).toBe(expected);
  });
});

describe('confidenceBand', () => {
  it.each([
    [1, 'high'],
    [0.8, 'high'],
    [0.79, 'medium'],
    [0.6, 'medium'],
    [0.59, 'low'],
    [0, 'low'],
    [null, 'unverified'],
  ] as const)('%s → %s', (confidence, band) => {
    expect(confidenceBand(confidence)).toBe(band);
  });
});

describe('freshness', () => {
  const VALIDITY = 90;

  it('vale 1,0 até o último milissegundo da validade', () => {
    expect(freshness(daysAgo(VALIDITY), NOW, VALIDITY)).toEqual({ factor: 1, stale: false });
    expect(freshness(daysAgo(0), NOW, VALIDITY)).toEqual({ factor: 1, stale: false });
  });

  it('começa a cair logo depois da validade', () => {
    const result = freshness(msAgo(VALIDITY * DAY_MS + 1), NOW, VALIDITY);
    expect(result.factor).toBeLessThan(1);
    expect(result.stale).toBe(false);
  });

  it('cai em linha reta: 0,75 a uma vez e meia a validade', () => {
    expect(freshness(daysAgo(135), NOW, VALIDITY).factor).toBeCloseTo(0.75, 10);
  });

  it('chega a 0,5 no dobro da validade, ainda sem vencer', () => {
    expect(freshness(daysAgo(2 * VALIDITY), NOW, VALIDITY)).toEqual({ factor: 0.5, stale: false });
  });

  it('vence (stale) um milissegundo depois do dobro, com piso de 0,5', () => {
    expect(freshness(msAgo(2 * VALIDITY * DAY_MS + 1), NOW, VALIDITY)).toEqual({
      factor: 0.5,
      stale: true,
    });
  });

  it('trata coleta no futuro como recém-coletada (a validação recusa antes)', () => {
    expect(freshness(daysFromNow(1), NOW, VALIDITY).factor).toBe(1);
  });

  it('recusa validade zero e data inválida', () => {
    expect(() => freshness(daysAgo(1), NOW, 0)).toThrow(RangeError);
    expect(() => freshness('ontem', NOW, VALIDITY)).toThrow(RangeError);
  });
});

describe('validityDaysFor', () => {
  it('usa a validade do domínio', () => {
    expect(validityDaysFor('firmographic', 'firmographic.cnae_main')).toBe(90);
    expect(validityDaysFor('digital_presence', 'site.active')).toBe(30);
    expect(validityDaysFor('visual', 'brand.logo')).toBe(180);
  });

  it('a validade da chave tem prioridade sobre a do domínio', () => {
    const policy = { ...DEFAULT_EVIDENCE_POLICY, keyValidityDays: { 'signal.hiring': 14 } };
    expect(validityDaysFor('signal', 'signal.hiring', policy)).toBe(14);
    expect(validityDaysFor('signal', 'signal.funding', policy)).toBe(30);
  });

  it('chave com nome de propriedade do protótipo usa a do domínio', () => {
    expect(validityDaysFor('positioning', 'constructor')).toBe(90);
  });

  it('recusa validade não positiva', () => {
    const policy = { ...DEFAULT_EVIDENCE_POLICY, keyValidityDays: { 'signal.hiring': 0 } };
    expect(() => validityDaysFor('signal', 'signal.hiring', policy)).toThrow(RangeError);
  });

  it('a política padrão é imutável', () => {
    expect(Object.isFrozen(DEFAULT_EVIDENCE_POLICY)).toBe(true);
    expect(Object.isFrozen(DEFAULT_EVIDENCE_POLICY.reliability)).toBe(true);
  });
});

describe('assessFact: confiabilidade × atualidade', () => {
  it.each([
    ['registro oficial', 'official_registry', 0.95, 'high'],
    ['site da própria empresa', 'company_owned', 0.85, 'high'],
    ['imprensa reconhecida (limite de Alta: 0,8)', 'recognized_press', 0.8, 'high'],
    ['anotação do usuário (proposta)', 'user_reported', 0.7, 'medium'],
    ['agregador (limite de Média: 0,6)', 'aggregator', 0.6, 'medium'],
    ['fonte desconhecida', 'unknown', 0.4, 'low'],
  ] as const)('%s recém-coletado → %d', (_, tier, confidence, band) => {
    const result = fact(supports(source(tier)));
    expect(result).toMatchObject({ confidence, band, status: 'active' });
  });

  it('vale até o dobro da validade contado da coleta', () => {
    const captured = daysAgo(10);
    expect(fact(supports(source('official_registry', captured))).validUntil).toBe(
      new Date(Date.parse(captured) + 180 * DAY_MS).toISOString(),
    );
  });

  it('perde confiança com o tempo: site a uma vez e meia a validade → 0,85 × 0,75', () => {
    const result = assessFact({
      domain: 'digital_presence',
      key: 'site.description',
      evidence: [supports(source('company_owned', daysAgo(45)))],
      now: NOW,
    });
    expect(result.confidence).toBe(0.63);
    expect(result.breakdown).toMatchObject({ type: 'fact', freshness: 0.75, reliability: 0.85 });
  });

  it('não sobe de faixa por arredondamento: 0,85 × 0,94 = 0,799 → 0,79 (Média)', () => {
    const result = assessFact({
      domain: 'digital_presence',
      key: 'site.description',
      evidence: [supports(source('company_owned', msAgo(33.6 * DAY_MS)))],
      now: NOW,
    });
    expect(result).toMatchObject({ confidence: 0.79, band: 'medium' });
  });

  it('usa a fonte com melhor confiabilidade × atualidade como base', () => {
    const result = fact(
      supports(source('aggregator')),
      supports(source('official_registry', daysAgo(170))),
    );
    // Registro a 170 dias: 0,95 × (1 − 0,5 × 80/90) = 0,527… < agregador recente 0,6.
    expect(result.breakdown).toMatchObject({ baseEvidenceIndex: 0, reliabilityTier: 'aggregator' });
  });

  it('escolhe a base entre as fontes não vencidas, mesmo com nota menor', () => {
    const result = fact(
      supports(source('official_registry', daysAgo(181))),
      supports(source('unknown')),
    );
    // Registro vencido: 0,95 × 0,5 = 0,475 > desconhecida recente 0,4, mas não pode ser a base.
    expect(result).toMatchObject({ status: 'active', confidence: 0.4 });
    expect(result.breakdown).toMatchObject({ baseEvidenceIndex: 1, reliabilityTier: 'unknown' });
  });

  it('a categoria vem da evidência: o mesmo site vale como da empresa só para ela', () => {
    const site = source('company_owned');
    const own = fact(supports(site));
    const other = fact(supports({ ...site, tier: 'unknown' }));
    expect(own.confidence).toBe(0.85);
    expect(other.confidence).toBe(0.4);
  });
});

describe('assessFact: concordância', () => {
  it('+0,05 por origem independente que concorda', () => {
    const result = fact(
      supports(source('company_owned')),
      supports(source('recognized_press')),
      supports(source('aggregator')),
    );
    expect(result.confidence).toBe(0.95);
    expect(result.breakdown).toMatchObject({ independentSources: 2 });
  });

  it('nunca passa de 1,0', () => {
    const result = fact(
      supports(source('official_registry')),
      supports(source('company_owned')),
      supports(source('recognized_press')),
    );
    expect(result.confidence).toBe(1);
  });

  it('páginas do mesmo site (com e sem www) são uma origem só', () => {
    const result = fact(
      supports(source('company_owned')),
      supports(
        source('company_owned', undefined, { url: 'https://www.clinica.example.test/contato' }),
      ),
    );
    expect(result).toMatchObject({ confidence: 0.85 });
    expect(result.breakdown).toMatchObject({ independentSources: 0 });
  });

  it('site e perfis da própria empresa são uma origem só (mesmo autor)', () => {
    const result = fact(
      supports(source('company_owned')),
      supports(
        source('company_owned', undefined, {
          kind: 'social_post',
          url: 'https://instagram.example.test/clinica/p/1',
        }),
      ),
      supports(source('company_owned', undefined, { url: 'https://loja.clinica-loja.test/' })),
    );
    expect(result).toMatchObject({ confidence: 0.85 });
    expect(result.breakdown).toMatchObject({ independentSources: 0 });
  });

  it('fonte desconhecida não conta como concordância (proposta)', () => {
    const result = fact(supports(source('company_owned')), supports(source('unknown')));
    expect(result.confidence).toBe(0.85);
  });

  it('fonte de apoio vencida não conta como concordância', () => {
    const result = fact(
      supports(source('company_owned')),
      supports(source('recognized_press', daysAgo(181))),
    );
    expect(result.confidence).toBe(0.85);
  });
});

describe('assessFact: conflito e vencimento', () => {
  it('fonte que contradiz deixa o fato contestado com teto de 0,5', () => {
    const result = fact(supports(source('official_registry')), contradicts(source('aggregator')));
    expect(result).toMatchObject({ status: 'disputed', confidence: 0.5, band: 'low' });
    expect(result.breakdown).toMatchObject({ contradicted: true });
  });

  it('o teto vale também quando a base é exatamente 0,6', () => {
    expect(fact(supports(source('aggregator')), contradicts(source('unknown'))).confidence).toBe(
      0.5,
    );
  });

  it('confiança já abaixo de 0,5 não muda com o conflito', () => {
    const result = fact(supports(source('unknown')), contradicts(source('aggregator')));
    expect(result).toMatchObject({ status: 'disputed', confidence: 0.4 });
  });

  it('contradição vencida não contesta', () => {
    const result = fact(
      supports(source('official_registry')),
      contradicts(source('aggregator', daysAgo(181))),
    );
    expect(result).toMatchObject({ status: 'active', confidence: 0.95 });
  });

  it('sem fonte de apoio dentro do dobro da validade → stale, com atualidade 0,5', () => {
    const result = fact(supports(source('official_registry', daysAgo(181))));
    expect(result).toMatchObject({ status: 'stale', confidence: 0.47 });
  });

  it('no dobro exato da validade ainda está ativo', () => {
    expect(fact(supports(source('official_registry', daysAgo(180)))).status).toBe('active');
  });

  it('vencido prevalece sobre contestado', () => {
    const result = fact(
      supports(source('official_registry', daysAgo(181))),
      contradicts(source('company_owned')),
    );
    expect(result).toMatchObject({ status: 'stale', confidence: 0.47 });
  });

  it('uma fonte de apoio recente mantém o fato ativo', () => {
    const result = fact(
      supports(source('official_registry', daysAgo(400))),
      supports(source('company_owned')),
    );
    expect(result).toMatchObject({ status: 'active', confidence: 0.85 });
    expect(result.validUntil).toBe(new Date(NOW.getTime() + 180 * DAY_MS).toISOString());
  });

  it('exige evidência que sustente (pré-condição)', () => {
    expect(() => fact(contradicts(source('aggregator')))).toThrow(RangeError);
    expect(() => fact()).toThrow(RangeError);
  });
});

describe('assessInference', () => {
  it('menor confiança das dependências × fator', () => {
    const result = assessInference({
      now: NOW,
      dependencies: [dependency({ confidence: 0.95 }), dependency({ confidence: 0.85 })],
      reasoningFactor: 0.8,
    });
    expect(result).toMatchObject({ confidence: 0.68, band: 'medium', status: 'active' });
    expect(result.breakdown).toEqual({
      type: 'inference',
      weakestDependency: 0.85,
      reasoningFactorProposed: 0.8,
      reasoningFactor: 0.8,
    });
  });

  it('nunca passa de 0,9, mesmo com dependências em 1,0', () => {
    const result = assessInference({
      now: NOW,
      dependencies: [dependency({ confidence: 1 })],
      reasoningFactor: 1,
    });
    expect(result.confidence).toBe(0.9);
  });

  it.each([
    [0.95, 0.9],
    [0.9, 0.9],
    [0.7, 0.7],
    [0.5, 0.5],
    [0.3, 0.5],
    [null, 0.5],
  ])('fator proposto %s → aplicado %s', (proposed, applied) => {
    expect(applyReasoningFactor(proposed)).toBe(applied);
    const result = assessInference({
      now: NOW,
      dependencies: [dependency({ confidence: 1 })],
      reasoningFactor: proposed,
    });
    expect(result.breakdown).toMatchObject({ reasoningFactor: applied });
    expect(result.confidence).toBe(applied);
  });

  it('dependência contestada → inferência contestada', () => {
    const result = assessInference({
      now: NOW,
      dependencies: [dependency(), dependency({ status: 'disputed', confidence: 0.5 })],
      reasoningFactor: 0.9,
    });
    expect(result).toMatchObject({ status: 'disputed', confidence: 0.45 });
  });

  it('teto de 0,5 mesmo se a dependência contestada vier com confiança alta', () => {
    const result = assessInference({
      now: NOW,
      dependencies: [dependency({ status: 'disputed', confidence: 0.9 })],
      reasoningFactor: 0.9,
    });
    expect(result.confidence).toBe(0.5);
  });

  it.each(['stale', 'rejected', 'superseded'] as const)(
    'dependência %s → inferência stale',
    (status) => {
      const result = assessInference({
        now: NOW,
        dependencies: [dependency(), dependency({ status })],
        reasoningFactor: 0.8,
      });
      expect(result.status).toBe('stale');
    },
  );

  it('dependência gravada como ativa, mas com validade vencida → inferência stale', () => {
    const result = assessInference({
      now: NOW,
      dependencies: [dependency(), dependency({ validUntil: daysAgo(1) })],
      reasoningFactor: 0.8,
    });
    expect(result.status).toBe('stale');
  });

  it('vencida prevalece sobre contestada', () => {
    const result = assessInference({
      now: NOW,
      dependencies: [
        dependency({ status: 'stale' }),
        dependency({ status: 'disputed', confidence: 0.5 }),
      ],
      reasoningFactor: 0.8,
    });
    expect(result.status).toBe('stale');
  });

  it('vale até a primeira dependência vencer', () => {
    const result = assessInference({
      now: NOW,
      dependencies: [
        dependency({ validUntil: daysFromNow(100) }),
        dependency({ validUntil: daysFromNow(20) }),
      ],
      reasoningFactor: 0.8,
    });
    expect(result.validUntil).toBe(daysFromNow(20));
  });

  it('exige dependências e recusa hipótese (pré-condição)', () => {
    expect(() => assessInference({ now: NOW, dependencies: [], reasoningFactor: 0.8 })).toThrow(
      RangeError,
    );
    expect(() =>
      assessInference({
        now: NOW,
        dependencies: [dependency({ epistemicType: 'hypothesis', confidence: null })],
        reasoningFactor: 0.8,
      }),
    ).toThrow(RangeError);
  });

  it('exemplo do doc 08: logotipos diferentes no site e no Instagram → inferência Média', () => {
    const site = assessFact({
      domain: 'visual',
      key: 'brand.logo.site',
      evidence: [supports(source('company_owned', daysAgo(1)))],
      now: NOW,
    });
    const instagram = assessFact({
      domain: 'visual',
      key: 'brand.logo.instagram',
      evidence: [
        supports(
          source('company_owned', daysAgo(1), {
            kind: 'screenshot',
            url: 'https://instagram.example.test/clinica',
          }),
        ),
      ],
      now: NOW,
    });
    const inference = assessInference({
      now: NOW,
      dependencies: [site, instagram].map((assessment) => ({
        epistemicType: 'fact' as const,
        status: assessment.status,
        confidence: assessment.confidence,
        validUntil: assessment.validUntil,
      })),
      reasoningFactor: 0.8,
    });
    expect(inference).toMatchObject({ confidence: 0.68, band: 'medium', status: 'active' });
  });
});

describe('assessHypothesis', () => {
  const base = {
    domain: 'positioning' as const,
    key: 'positioning.expansion',
    evidence: [],
    dependencies: [],
    createdAt: NOW.toISOString(),
    now: NOW,
  };

  it('fica sem confiança: "a verificar"', () => {
    expect(assessHypothesis(base)).toMatchObject({
      confidence: null,
      band: 'unverified',
      status: 'active',
      validUntil: daysFromNow(180),
    });
  });

  it('vence no dobro da validade contado do registro', () => {
    const createdAt = daysAgo(180);
    expect(assessHypothesis({ ...base, createdAt }).status).toBe('active');
    expect(assessHypothesis({ ...base, createdAt: msAgo(180 * DAY_MS + 1) }).status).toBe('stale');
  });

  it('com evidência de apoio, conta a validade da coleta mais recente', () => {
    const result = assessHypothesis({
      ...base,
      createdAt: daysAgo(170),
      evidence: [
        supports(source('unknown', daysAgo(100))),
        supports(source('aggregator', daysAgo(5))),
      ],
    });
    expect(result.validUntil).toBe(daysFromNow(175));
  });

  it('dependência vencida, rejeitada ou substituída vence a hipótese', () => {
    for (const status of ['stale', 'rejected', 'superseded'] as const) {
      expect(assessHypothesis({ ...base, dependencies: [dependency({ status })] }).status).toBe(
        'stale',
      );
    }
  });

  it('vale até a dependência vencer', () => {
    const result = assessHypothesis({
      ...base,
      dependencies: [dependency({ validUntil: daysFromNow(3) })],
    });
    expect(result.validUntil).toBe(daysFromNow(3));
  });

  it('evidência recente que contradiz → contestada', () => {
    const result = assessHypothesis({ ...base, evidence: [contradicts(source('company_owned'))] });
    expect(result.status).toBe('disputed');
  });
});

describe('effectiveStatus', () => {
  it.each([
    ['active', daysFromNow(1), 'active'],
    ['active', NOW.toISOString(), 'active'],
    ['active', msAgo(1), 'stale'],
    ['disputed', msAgo(1), 'stale'],
    ['disputed', daysFromNow(1), 'disputed'],
    ['stale', daysFromNow(1), 'stale'],
    ['rejected', msAgo(1), 'rejected'],
    ['superseded', msAgo(1), 'superseded'],
  ] as const)('%s com validade até %s → %s', (status, validUntil, expected) => {
    expect(effectiveStatus({ status, validUntil }, NOW)).toBe(expected);
  });
});

describe('resolveStatus', () => {
  it.each([
    ['rejected', 'active', 'rejected'],
    ['superseded', 'active', 'superseded'],
    ['rejected', 'stale', 'rejected'],
    ['active', 'disputed', 'disputed'],
    ['stale', 'active', 'active'],
    ['disputed', 'stale', 'stale'],
  ] as const)('gravado %s, calculado %s → %s', (stored, computed, expected) => {
    expect(resolveStatus(stored, computed)).toBe(expected);
  });
});

describe('canSupportAssertion', () => {
  const VALID = daysFromNow(1);

  it.each([
    ['fato ativo Média (0,6)', { epistemicType: 'fact', status: 'active', confidence: 0.6 }, true],
    [
      'inferência ativa Alta',
      { epistemicType: 'inference', status: 'active', confidence: 0.8 },
      true,
    ],
    [
      'fato ativo Baixa (0,59)',
      { epistemicType: 'fact', status: 'active', confidence: 0.59 },
      false,
    ],
    ['hipótese', { epistemicType: 'hypothesis', status: 'active', confidence: null }, false],
    ['fato vencido', { epistemicType: 'fact', status: 'stale', confidence: 0.95 }, false],
    ['fato contestado', { epistemicType: 'fact', status: 'disputed', confidence: 0.5 }, false],
    ['fato rejeitado', { epistemicType: 'fact', status: 'rejected', confidence: 0.95 }, false],
  ] as const)('%s → %s', (_, claim, expected) => {
    expect(canSupportAssertion({ ...claim, validUntil: VALID }, NOW)).toBe(expected);
  });

  it('fato gravado como ativo, mas com validade vencida em `now`, não sustenta', () => {
    const claim = { epistemicType: 'fact', status: 'active', confidence: 0.95 } as const;
    expect(canSupportAssertion({ ...claim, validUntil: NOW.toISOString() }, NOW)).toBe(true);
    expect(canSupportAssertion({ ...claim, validUntil: msAgo(1) }, NOW)).toBe(false);
  });
});
