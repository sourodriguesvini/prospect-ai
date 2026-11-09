import { describe, expect, it } from 'vitest';
import {
  CLAIM_ISSUE_MESSAGES,
  CONFIDENCE_BAND_LABELS,
  Claim,
  ClaimDependency,
  ClaimEvidence,
  ClaimEvidenceInput,
  ClaimInput,
  ClaimIssueCode,
  ClaimKey,
  ConfidenceBand,
  EvidenceLocator,
  Source,
  SourceInput,
} from '../src';

const SOURCE_ID = '0b6f1d2e-3c4a-4b5c-8d6e-7f8091a2b3c4';
const CLAIM_ID = '1c7a2e3f-4d5b-4c6d-9e7f-8091a2b3c4d5';
const OTHER_ID = '2d8b3f4a-5e6c-4d7e-af80-91a2b3c4d5e6';
const COMPANY_ID = '3e9c4a5b-6f7d-4e8f-b091-a2b3c4d5e6f7';
const CAPTURED = '2026-11-08T14:30:00-03:00';

describe('SourceInput', () => {
  it('aceita página da web e preenche os opcionais', () => {
    const source = SourceInput.parse({
      schemaVersion: 1,
      kind: 'web_page',
      url: 'https://clinica.example.test/sobre',
      capturedAt: CAPTURED,
    });
    expect(source).toMatchObject({
      provider: null,
      externalRef: null,
      contentHash: null,
      isDemo: false,
    });
  });

  it('aceita registro de API com provedor e identificador, sem URL', () => {
    const result = SourceInput.safeParse({
      schemaVersion: 1,
      kind: 'api_record',
      provider: 'base_cnpj',
      externalRef: '12.345.678/0001-90',
      capturedAt: '2026-11-08T17:30:00Z',
    });
    expect(result.success).toBe(true);
  });

  it('aceita anotação do usuário sem URL nem identificador', () => {
    expect(
      SourceInput.safeParse({ schemaVersion: 1, kind: 'user_note', capturedAt: CAPTURED }).success,
    ).toBe(true);
  });

  it.each(['web_page', 'screenshot', 'social_post', 'search_result'] as const)(
    'recusa %s sem URL',
    (kind) => {
      const result = SourceInput.safeParse({
        schemaVersion: 1,
        kind,
        externalRef: 'algo',
        capturedAt: CAPTURED,
      });
      expect(result.success).toBe(false);
      expect(result.error?.issues[0]?.path).toEqual(['url']);
    },
  );

  it('recusa registro de API sem provedor', () => {
    const result = SourceInput.safeParse({
      schemaVersion: 1,
      kind: 'api_record',
      externalRef: '12345678000190',
      capturedAt: CAPTURED,
    });
    expect(result.error?.issues.map((issue) => issue.path)).toEqual([['provider']]);
  });

  it('recusa documento sem URL nem identificador', () => {
    const result = SourceInput.safeParse({
      schemaVersion: 1,
      kind: 'document',
      capturedAt: CAPTURED,
    });
    expect(result.error?.issues.map((issue) => issue.path)).toEqual([['externalRef']]);
  });

  it.each([
    ['URL fora de http(s)', { url: 'ftp://clinica.example.test/a' }],
    ['URL sem domínio', { url: 'https://' }],
    ['data sem fuso', { capturedAt: '2026-11-08T14:30:00' }],
    ['data só com dia', { capturedAt: '2026-11-08' }],
    ['hash curto', { contentHash: 'abc123' }],
    ['hash em maiúsculas', { contentHash: 'A'.repeat(64) }],
    ['status HTTP inválido', { httpStatus: 99 }],
    ['versão de contrato errada', { schemaVersion: 2 }],
    ['tipo desconhecido', { kind: 'rumor' }],
  ])('recusa %s', (_, override) => {
    const result = SourceInput.safeParse({
      schemaVersion: 1,
      kind: 'web_page',
      url: 'https://clinica.example.test',
      capturedAt: CAPTURED,
      ...override,
    });
    expect(result.success).toBe(false);
  });
});

describe('Source', () => {
  const stored = {
    schemaVersion: 1,
    id: SOURCE_ID,
    kind: 'web_page',
    url: 'https://clinica.example.test',
    capturedAt: CAPTURED,
    createdAt: CAPTURED,
  };

  it('aceita fonte gravada', () => {
    expect(Source.safeParse(stored).success).toBe(true);
  });

  it('não guarda categoria de confiabilidade: ela depende do sujeito e fica na evidência', () => {
    const parsed = Source.parse({ ...stored, reliabilityTier: 'company_owned' });
    expect(parsed).not.toHaveProperty('reliabilityTier');
  });

  it('recusa fonte gravada sem id ou data de gravação', () => {
    const { id: _, ...withoutId } = stored;
    expect(Source.safeParse(withoutId).success).toBe(false);
    expect(Source.safeParse({ ...stored, createdAt: 'ontem' }).success).toBe(false);
  });

  it('mantém a regra de localização na fonte gravada', () => {
    expect(Source.safeParse({ ...stored, url: null }).success).toBe(false);
  });
});

describe('EvidenceLocator', () => {
  it.each([
    { selector: 'header img.logo' },
    { bbox: [0, 0, 120, 40] },
    { page: 2 },
    { timestamp: 0 },
  ])('aceita %j', (locator) => {
    expect(EvidenceLocator.safeParse(locator).success).toBe(true);
  });

  it.each([{}, { bbox: [0, 0, 0, 40] }, { bbox: [-1, 0, 10, 10] }, { page: 0 }, { selector: ' ' }])(
    'recusa %j',
    (locator) => {
      expect(EvidenceLocator.safeParse(locator).success).toBe(false);
    },
  );
});

describe('ClaimEvidenceInput', () => {
  it('assume que a evidência sustenta e corta espaços do trecho', () => {
    expect(ClaimEvidenceInput.parse({ sourceId: SOURCE_ID, quote: '  Desde 1998  ' })).toEqual({
      sourceId: SOURCE_ID,
      quote: 'Desde 1998',
      locator: null,
      stance: 'supports',
    });
  });

  it.each([
    ['trecho vazio', { quote: '   ' }],
    ['trecho longo', { quote: 'a'.repeat(1201) }],
    ['fonte sem UUID', { sourceId: 'fonte-1' }],
    ['posição desconhecida', { stance: 'neutral' }],
  ])('recusa %s', (_, override) => {
    expect(
      ClaimEvidenceInput.safeParse({ sourceId: SOURCE_ID, quote: 'Desde 1998', ...override })
        .success,
    ).toBe(false);
  });

  it('aceita trecho de exatamente 1.200 caracteres', () => {
    expect(
      ClaimEvidenceInput.safeParse({ sourceId: SOURCE_ID, quote: 'a'.repeat(1200) }).success,
    ).toBe(true);
  });

  it('aceita região sem trecho (captura de tela)', () => {
    expect(
      ClaimEvidenceInput.parse({ sourceId: SOURCE_ID, locator: { bbox: [0, 0, 320, 80] } }),
    ).toMatchObject({ quote: null, locator: { bbox: [0, 0, 320, 80] } });
  });

  it('recusa evidência sem trecho nem região', () => {
    const result = ClaimEvidenceInput.safeParse({ sourceId: SOURCE_ID });
    expect(result.error?.issues.map((issue) => issue.path)).toEqual([['quote']]);
  });

  it('evidência gravada exige claim, categoria da fonte e conferência do trecho', () => {
    const base = {
      sourceId: SOURCE_ID,
      quote: 'Desde 1998',
      claimId: CLAIM_ID,
      reliabilityTier: 'company_owned',
    };
    expect(ClaimEvidence.safeParse({ ...base, quoteVerified: true }).success).toBe(true);
    expect(ClaimEvidence.safeParse(base).success).toBe(false);
    expect(
      ClaimEvidence.safeParse({ ...base, quoteVerified: true, reliabilityTier: 'trusted' }).success,
    ).toBe(false);
    const { reliabilityTier: _, ...withoutTier } = base;
    expect(ClaimEvidence.safeParse({ ...withoutTier, quoteVerified: true }).success).toBe(false);
  });

  it('região gravada sem trecho fica sem conferência', () => {
    expect(
      ClaimEvidence.safeParse({
        sourceId: SOURCE_ID,
        claimId: CLAIM_ID,
        locator: { bbox: [0, 0, 320, 80] },
        reliabilityTier: 'company_owned',
        quoteVerified: null,
      }).success,
    ).toBe(true);
  });
});

describe('ClaimDependency', () => {
  it('aceita dependência entre claims diferentes', () => {
    expect(
      ClaimDependency.safeParse({ claimId: CLAIM_ID, dependsOnClaimId: OTHER_ID }).success,
    ).toBe(true);
  });

  it('recusa claim que depende de si mesmo', () => {
    expect(
      ClaimDependency.safeParse({ claimId: CLAIM_ID, dependsOnClaimId: CLAIM_ID }).success,
    ).toBe(false);
  });
});

describe('ClaimKey', () => {
  it.each(['firmographic.cnae_main', 'brand.consistency.cross_channel', 'site'])(
    'aceita %s',
    (key) => {
      expect(ClaimKey.safeParse(key).success).toBe(true);
    },
  );

  it.each(['Brand.Logo', '1brand', 'brand..logo', '.brand', 'brand.', 'brand-logo', ''])(
    'recusa %j',
    (key) => {
      expect(ClaimKey.safeParse(key).success).toBe(false);
    },
  );
});

describe('ClaimInput', () => {
  const fact = {
    schemaVersion: 1,
    subjectType: 'company',
    subjectId: COMPANY_ID,
    domain: 'firmographic',
    key: 'firmographic.cnae_main',
    statement: 'CNAE principal 8630-5/04 segundo a base CNPJ.',
    epistemicType: 'fact',
    evidence: [{ sourceId: SOURCE_ID, quote: '8630-5/04' }],
  };

  it('aceita fato e preenche os padrões', () => {
    expect(ClaimInput.parse(fact)).toMatchObject({
      value: null,
      dependsOn: [],
      reasoning: null,
      reasoningFactor: null,
      isDemo: false,
    });
  });

  it('aceita inferência com dependências, raciocínio e fator', () => {
    const result = ClaimInput.safeParse({
      ...fact,
      domain: 'visual',
      key: 'brand.consistency.cross_channel',
      statement: 'A identidade visual é inconsistente entre canais.',
      epistemicType: 'inference',
      evidence: [],
      dependsOn: [CLAIM_ID, OTHER_ID],
      reasoning: 'Site e Instagram usam logotipos e paletas diferentes.',
      reasoningFactor: 0.8,
    });
    expect(result.success).toBe(true);
  });

  it('deixa as regras epistemológicas para o domínio (fato sem evidência passa na forma)', () => {
    expect(ClaimInput.safeParse({ ...fact, evidence: [] }).success).toBe(true);
  });

  it.each([
    ['tipo epistemológico desconhecido', { epistemicType: 'opinion' }],
    ['domínio desconhecido', { domain: 'gossip' }],
    ['sujeito desconhecido', { subjectType: 'person' }],
    ['afirmação curta', { statement: 'ok' }],
    ['afirmação longa', { statement: 'a'.repeat(501) }],
    ['mais de 8 evidências', { evidence: Array.from({ length: 9 }, () => fact.evidence[0]) }],
    ['mais de 20 dependências', { dependsOn: Array.from({ length: 21 }, () => CLAIM_ID) }],
    ['dependência sem UUID', { dependsOn: ['fato-1'] }],
    ['fator acima de 1', { reasoningFactor: 1.2 }],
    ['fator negativo', { reasoningFactor: -0.1 }],
    ['raciocínio longo', { reasoning: 'a'.repeat(801) }],
  ])('recusa %s', (_, override) => {
    expect(ClaimInput.safeParse({ ...fact, ...override }).success).toBe(false);
  });

  it('descarta confiança e estado enviados pelo modelo: quem calcula é o servidor', () => {
    const parsed = ClaimInput.parse({ ...fact, confidence: 0.99, status: 'active' });
    expect(parsed).not.toHaveProperty('confidence');
    expect(parsed).not.toHaveProperty('status');
  });
});

describe('Claim', () => {
  const base = {
    schemaVersion: 1,
    id: CLAIM_ID,
    subjectType: 'company',
    subjectId: COMPANY_ID,
    domain: 'firmographic',
    key: 'firmographic.cnae_main',
    statement: 'CNAE principal 8630-5/04 segundo a base CNPJ.',
    value: null,
    epistemicType: 'fact',
    confidence: 0.95,
    status: 'active',
    validUntil: '2027-05-07T17:30:00Z',
    reasoning: null,
    reasoningFactor: null,
    producedByRunId: null,
    promptVersionId: null,
    supersedesId: null,
    reviewedAt: null,
    isDemo: false,
    createdAt: CAPTURED,
  };
  const inference = {
    ...base,
    epistemicType: 'inference',
    confidence: 0.9,
    reasoning: 'Raciocínio.',
    reasoningFactor: 0.9,
  };
  const hypothesis = { ...base, epistemicType: 'hypothesis', confidence: null };

  it.each([
    ['fato', base],
    ['inferência no teto (0,9) com fator 0,9', inference],
    ['inferência com fator mínimo (0,5)', { ...inference, confidence: 0.3, reasoningFactor: 0.5 }],
    ['hipótese sem confiança', hypothesis],
    ['fato contestado', { ...base, status: 'disputed', confidence: 0.5 }],
  ])('aceita %s', (_, claim) => {
    expect(Claim.safeParse(claim).success).toBe(true);
  });

  it.each([
    ['fato sem confiança', { ...base, confidence: null }],
    ['hipótese com confiança', { ...hypothesis, confidence: 0.4 }],
    ['inferência acima de 0,9', { ...inference, confidence: 0.91 }],
    ['inferência sem fator', { ...inference, reasoningFactor: null }],
    ['inferência com fator acima de 0,9', { ...inference, reasoningFactor: 0.91 }],
    ['inferência com fator abaixo de 0,5', { ...inference, reasoningFactor: 0.49 }],
    ['fato com fator', { ...base, reasoningFactor: 0.7 }],
    ['estado desconhecido', { ...base, status: 'archived' }],
    ['confiança acima de 1', { ...base, confidence: 1.01 }],
  ])('recusa %s', (_, claim) => {
    expect(Claim.safeParse(claim).success).toBe(false);
  });
});

describe('textos', () => {
  it('toda faixa de confiança tem rótulo em pt-BR', () => {
    expect(Object.keys(CONFIDENCE_BAND_LABELS).sort()).toEqual([...ConfidenceBand.options].sort());
    expect(CONFIDENCE_BAND_LABELS.unverified).toBe('A verificar');
  });

  it('todo código de erro do ledger tem mensagem', () => {
    for (const code of ClaimIssueCode.options) {
      expect(CLAIM_ISSUE_MESSAGES[code].length).toBeGreaterThan(10);
    }
  });
});
