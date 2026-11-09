import {
  CLAIM_ISSUE_MESSAGES,
  ClaimInput,
  type ClaimInputDraft,
  type ClaimIssue,
} from '@prospector/contracts';
import { describe, expect, it } from 'vitest';
import {
  type AssessedDependency,
  type AssessedSource,
  type ClaimRulesContext,
  evaluateClaim,
  validateClaimInput,
} from '../../src';
import { CLASSIFICATION, NOW, daysAgo, daysFromNow, dependency, source } from './fixtures';

const IDS = {
  company: '3e9c4a5b-6f7d-4e8f-b091-a2b3c4d5e6f7',
  registry: '0b6f1d2e-3c4a-4b5c-8d6e-7f8091a2b3c4',
  site: '1b6f1d2e-3c4a-4b5c-8d6e-7f8091a2b3c4',
  future: '2b6f1d2e-3c4a-4b5c-8d6e-7f8091a2b3c4',
  screenshot: '3b6f1d2e-3c4a-4b5c-8d6e-7f8091a2b3c4',
  oldRegistry: '4b6f1d2e-3c4a-4b5c-8d6e-7f8091a2b3c4',
  missing: '9b6f1d2e-3c4a-4b5c-8d6e-7f8091a2b3c4',
  fact: '1c7a2e3f-4d5b-4c6d-9e7f-8091a2b3c4d5',
  fact2: '2c7a2e3f-4d5b-4c6d-9e7f-8091a2b3c4d5',
  staleFact: '3c7a2e3f-4d5b-4c6d-9e7f-8091a2b3c4d5',
  disputedFact: '4c7a2e3f-4d5b-4c6d-9e7f-8091a2b3c4d5',
  inference: '5c7a2e3f-4d5b-4c6d-9e7f-8091a2b3c4d5',
  hypothesis: '6c7a2e3f-4d5b-4c6d-9e7f-8091a2b3c4d5',
  expiredFact: '7c7a2e3f-4d5b-4c6d-9e7f-8091a2b3c4d5',
} as const;

const SOURCES = new Map<string, AssessedSource>([
  [IDS.registry, source('official_registry', daysAgo(1))],
  [IDS.site, source('company_owned', daysAgo(1))],
  [IDS.future, source('company_owned', new Date(NOW.getTime() + 1).toISOString())],
  [
    IDS.screenshot,
    source('company_owned', daysAgo(1), {
      kind: 'screenshot',
      url: 'https://clinica.example.test/',
    }),
  ],
  [IDS.oldRegistry, source('official_registry', daysAgo(181))],
]);

const CLAIMS = new Map<string, AssessedDependency>([
  [IDS.fact, dependency({ confidence: 0.95 })],
  [IDS.fact2, dependency({ confidence: 0.85, validUntil: daysFromNow(30) })],
  [IDS.staleFact, dependency({ status: 'stale', confidence: 0.47 })],
  [IDS.disputedFact, dependency({ status: 'disputed', confidence: 0.5 })],
  [IDS.inference, dependency({ epistemicType: 'inference', confidence: 0.68 })],
  [IDS.hypothesis, dependency({ epistemicType: 'hypothesis', confidence: null })],
  // Gravado como ativo, mas a validade já passou: conta como vencido (effectiveStatus).
  [IDS.expiredFact, dependency({ validUntil: daysAgo(1) })],
]);

const CONTEXT: ClaimRulesContext = {
  now: NOW,
  sources: SOURCES,
  claims: CLAIMS,
  classification: CLASSIFICATION,
};

const FACT: ClaimInputDraft = {
  schemaVersion: 1,
  subjectType: 'company',
  subjectId: IDS.company,
  domain: 'firmographic',
  key: 'firmographic.cnae_main',
  statement: 'CNAE principal 8630-5/04 segundo a base CNPJ.',
  epistemicType: 'fact',
  evidence: [{ sourceId: IDS.registry, quote: '8630-5/04' }],
};

const INFERENCE: ClaimInputDraft = {
  ...FACT,
  domain: 'visual',
  key: 'brand.consistency.cross_channel',
  statement: 'A identidade visual é inconsistente entre canais.',
  epistemicType: 'inference',
  evidence: [],
  dependsOn: [IDS.fact, IDS.fact2],
  reasoning: 'Site e Instagram usam logotipos e paletas diferentes.',
  reasoningFactor: 0.8,
};

const HYPOTHESIS: ClaimInputDraft = {
  ...FACT,
  domain: 'positioning',
  key: 'positioning.expansion',
  statement: 'A empresa pode estar preparando expansão regional.',
  epistemicType: 'hypothesis',
  evidence: [],
  reasoning: 'Vagas abertas em outra cidade; confirmar com o decisor.',
};

function check(draft: ClaimInputDraft, context: ClaimRulesContext = CONTEXT): ClaimIssue[] {
  return validateClaimInput(ClaimInput.parse(draft), context);
}

function codes(draft: ClaimInputDraft): string[] {
  return check(draft).map((issue) => `${issue.code}@${issue.field}`);
}

describe('validateClaimInput: fato', () => {
  it('aceita fato com evidência de fonte existente', () => {
    expect(check(FACT)).toEqual([]);
  });

  it('recusa fato sem evidência', () => {
    expect(codes({ ...FACT, evidence: [] })).toEqual(['fact_requires_evidence@evidence']);
  });

  it('recusa fato só com evidência que contradiz', () => {
    expect(
      codes({
        ...FACT,
        evidence: [{ sourceId: IDS.site, quote: 'outro CNAE', stance: 'contradicts' }],
      }),
    ).toEqual(['fact_requires_evidence@evidence']);
  });

  it('recusa fato que depende de outros claims', () => {
    expect(codes({ ...FACT, dependsOn: [IDS.fact] })).toEqual(['fact_has_dependencies@dependsOn']);
  });

  it('recusa fonte que não existe no ledger', () => {
    expect(codes({ ...FACT, evidence: [{ sourceId: IDS.missing, quote: '8630-5/04' }] })).toEqual([
      'evidence_source_not_found@evidence.0.sourceId',
    ]);
  });

  it('recusa trecho em branco (defesa além do contrato)', () => {
    const input = ClaimInput.parse(FACT);
    const blank = { ...input, evidence: [{ ...input.evidence[0]!, quote: '   ' }] };
    expect(validateClaimInput(blank, CONTEXT).map((issue) => issue.code)).toEqual([
      'evidence_quote_missing',
    ]);
  });

  it('recusa fonte coletada no futuro, mas aceita coleta no instante exato', () => {
    expect(codes({ ...FACT, evidence: [{ sourceId: IDS.future, quote: '8630-5/04' }] })).toEqual([
      'evidence_captured_in_future@evidence.0.sourceId',
    ]);
    const atNow = new Map(SOURCES).set(IDS.future, source('company_owned', NOW.toISOString()));
    expect(
      check(
        { ...FACT, evidence: [{ sourceId: IDS.future, quote: '8630-5/04' }] },
        {
          ...CONTEXT,
          sources: atNow,
        },
      ),
    ).toEqual([]);
  });

  it('recusa a mesma fonte citada duas vezes no claim', () => {
    expect(
      codes({
        ...FACT,
        evidence: [
          { sourceId: IDS.registry, quote: '8630-5/04' },
          { sourceId: IDS.registry, quote: 'Atividade médica' },
        ],
      }),
    ).toEqual(['evidence_duplicate_source@evidence.1.sourceId']);
  });

  it('página citada só por região, sem trecho, é recusada', () => {
    expect(
      codes({ ...FACT, evidence: [{ sourceId: IDS.site, locator: { selector: 'main h1' } }] }),
    ).toEqual(['evidence_quote_missing@evidence.0.quote']);
  });

  describe('captura de tela', () => {
    const VISUAL = { ...FACT, domain: 'visual', key: 'brand.logo.site' } as const;

    it('aceita a região (bbox) sem trecho', () => {
      expect(
        check({
          ...VISUAL,
          evidence: [{ sourceId: IDS.screenshot, locator: { bbox: [0, 0, 320, 120] } }],
        }),
      ).toEqual([]);
    });

    it.each([
      ['só com trecho', { quote: 'Clínica' }],
      ['com localizador sem bbox', { quote: 'Clínica', locator: { selector: 'header' } }],
    ])('recusa captura %s', (_, evidence) => {
      expect(codes({ ...VISUAL, evidence: [{ sourceId: IDS.screenshot, ...evidence }] })).toEqual([
        'evidence_region_missing@evidence.0.locator',
      ]);
    });
  });

  it('recusa fator de raciocínio em fato', () => {
    expect(codes({ ...FACT, reasoningFactor: 0.7 })).toEqual([
      'reasoning_factor_only_for_inference@reasoningFactor',
    ]);
  });
});

describe('validateClaimInput: inferência', () => {
  it('aceita inferência apoiada em fatos ativos, com raciocínio', () => {
    expect(check(INFERENCE)).toEqual([]);
  });

  it('aceita inferência que também se apoia em outra inferência', () => {
    expect(check({ ...INFERENCE, dependsOn: [IDS.fact, IDS.inference] })).toEqual([]);
  });

  it('recusa inferência sem dependências', () => {
    expect(codes({ ...INFERENCE, dependsOn: [] })).toEqual([
      'inference_requires_dependencies@dependsOn',
    ]);
  });

  it('recusa inferência apoiada só em inferência', () => {
    expect(codes({ ...INFERENCE, dependsOn: [IDS.inference] })).toEqual([
      'inference_requires_fact@dependsOn',
    ]);
  });

  it('recusa inferência apoiada em hipótese', () => {
    expect(codes({ ...INFERENCE, dependsOn: [IDS.fact, IDS.hypothesis] })).toEqual([
      'dependency_is_hypothesis@dependsOn.1',
    ]);
  });

  it.each([
    ['vencida', IDS.staleFact],
    ['contestada', IDS.disputedFact],
    ['ativa no banco, mas com a validade já passada', IDS.expiredFact],
  ])('recusa dependência %s', (_, id) => {
    expect(codes({ ...INFERENCE, dependsOn: [IDS.fact, id] })).toEqual([
      'dependency_not_active@dependsOn.1',
    ]);
  });

  it('recusa dependência inexistente (e sem nenhum fato conhecido)', () => {
    expect(codes({ ...INFERENCE, dependsOn: [IDS.missing] })).toEqual([
      'dependency_not_found@dependsOn.0',
      'inference_requires_fact@dependsOn',
    ]);
  });

  it('recusa dependência repetida', () => {
    expect(codes({ ...INFERENCE, dependsOn: [IDS.fact, IDS.fact] })).toEqual([
      'dependency_duplicate@dependsOn.1',
    ]);
  });

  it('recusa inferência que cita fonte diretamente', () => {
    expect(codes({ ...INFERENCE, evidence: FACT.evidence })).toEqual([
      'inference_has_evidence@evidence',
    ]);
  });

  it.each([null, '', '   '])('recusa inferência sem raciocínio (%j)', (reasoning) => {
    expect(codes({ ...INFERENCE, reasoning })).toEqual(['inference_requires_reasoning@reasoning']);
  });

  it('aceita inferência sem fator (o domínio aplica o mínimo)', () => {
    expect(check({ ...INFERENCE, reasoningFactor: null })).toEqual([]);
  });
});

describe('validateClaimInput: hipótese', () => {
  it('aceita hipótese sem evidência, com raciocínio', () => {
    expect(check(HYPOTHESIS)).toEqual([]);
  });

  it('aceita hipótese apoiada em pista e em outra hipótese', () => {
    expect(
      check({
        ...HYPOTHESIS,
        evidence: [{ sourceId: IDS.site, quote: 'Vagas em Campinas' }],
        dependsOn: [IDS.hypothesis],
      }),
    ).toEqual([]);
  });

  it('recusa hipótese sem raciocínio', () => {
    expect(codes({ ...HYPOTHESIS, reasoning: null })).toEqual([
      'hypothesis_requires_reasoning@reasoning',
    ]);
  });

  it('recusa hipótese com fonte inexistente e dependência vencida', () => {
    expect(
      codes({
        ...HYPOTHESIS,
        evidence: [{ sourceId: IDS.missing, quote: 'Vagas' }],
        dependsOn: [IDS.staleFact],
      }),
    ).toEqual([
      'evidence_source_not_found@evidence.0.sourceId',
      'dependency_not_active@dependsOn.0',
    ]);
  });

  it('recusa fator de raciocínio em hipótese', () => {
    expect(codes({ ...HYPOTHESIS, reasoningFactor: 0.6 })).toEqual([
      'reasoning_factor_only_for_inference@reasoningFactor',
    ]);
  });
});

describe('validateClaimInput: erros', () => {
  it('lista todos os problemas de uma vez, com mensagem em pt-BR', () => {
    const issues = check({
      ...INFERENCE,
      evidence: FACT.evidence,
      dependsOn: [IDS.missing, IDS.missing],
      reasoning: null,
    });
    expect(issues.map((issue) => issue.code)).toEqual([
      'inference_has_evidence',
      'dependency_not_found',
      'dependency_duplicate',
      'inference_requires_fact',
      'inference_requires_reasoning',
    ]);
    for (const issue of issues) expect(issue.message).toBe(CLAIM_ISSUE_MESSAGES[issue.code]);
  });
});

describe('evaluateClaim', () => {
  it('não calcula quando há problema', () => {
    const result = evaluateClaim(ClaimInput.parse({ ...FACT, evidence: [] }), CONTEXT);
    expect(result).toEqual({
      ok: false,
      issues: [
        {
          code: 'fact_requires_evidence',
          field: 'evidence',
          message: CLAIM_ISSUE_MESSAGES.fact_requires_evidence,
        },
      ],
    });
  });

  it('fato: confiança da fonte oficial', () => {
    const result = evaluateClaim(ClaimInput.parse(FACT), CONTEXT);
    expect(result.ok && result.assessment).toMatchObject({
      confidence: 0.95,
      band: 'high',
      status: 'active',
      validUntil: daysFromNow(179),
    });
  });

  it('fato com duas origens independentes ganha concordância', () => {
    const result = evaluateClaim(
      ClaimInput.parse({
        ...FACT,
        evidence: [
          { sourceId: IDS.registry, quote: '8630-5/04' },
          { sourceId: IDS.site, quote: 'Clínica médica' },
        ],
      }),
      CONTEXT,
    );
    expect(result.ok && result.assessment.confidence).toBe(1);
  });

  it('devolve a categoria de cada evidência, para o sujeito do claim', () => {
    const input = ClaimInput.parse({
      ...FACT,
      evidence: [
        { sourceId: IDS.registry, quote: '8630-5/04' },
        { sourceId: IDS.site, quote: 'Clínica médica' },
      ],
    });
    const own = evaluateClaim(input, CONTEXT);
    expect(own.ok && own.evidenceTiers).toEqual(['official_registry', 'company_owned']);

    // O mesmo site num claim sobre outra empresa não é da empresa: não soma concordância.
    const other = evaluateClaim(input, {
      ...CONTEXT,
      classification: { ...CLASSIFICATION, ownedOrigins: [] },
    });
    expect(other.ok && other.evidenceTiers).toEqual(['official_registry', 'unknown']);
    expect(other.ok && other.assessment.confidence).toBe(0.95);
  });

  it('fato com fonte já vencida é aceito e nasce stale', () => {
    const result = evaluateClaim(
      ClaimInput.parse({ ...FACT, evidence: [{ sourceId: IDS.oldRegistry, quote: '8630-5/04' }] }),
      CONTEXT,
    );
    expect(result.ok && result.assessment).toMatchObject({ status: 'stale', confidence: 0.47 });
  });

  it('inferência: menor dependência × fator, válida até a primeira dependência vencer', () => {
    const result = evaluateClaim(ClaimInput.parse(INFERENCE), CONTEXT);
    expect(result.ok && result.assessment).toMatchObject({
      confidence: 0.68,
      band: 'medium',
      status: 'active',
      validUntil: daysFromNow(30),
    });
  });

  it('hipótese: sem confiança, válida pelo dobro da validade a partir do registro', () => {
    const result = evaluateClaim(ClaimInput.parse(HYPOTHESIS), CONTEXT);
    expect(result.ok && result.assessment).toMatchObject({
      confidence: null,
      band: 'unverified',
      status: 'active',
      validUntil: daysFromNow(180),
    });
  });
});
