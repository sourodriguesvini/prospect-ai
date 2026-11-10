import type { CnpjRegistryRecord } from '@prospector/contracts';
import { describe, expect, it } from 'vitest';
import {
  brazilianDate,
  brl,
  changedRegistryFacts,
  checkQuotes,
  isIndividualBusiness,
  isIndividualFromFacts,
  normalizeForQuote,
  quoteFoundIn,
  registryExcerpt,
  registryFacts,
  registryRetentionUntil,
  summarizeClaims,
} from '../../src';

/** Registro SINTÉTICO (CNPJ de teste com DV válido; nomes de exemplo). */
const RECORD: CnpjRegistryRecord = {
  schemaVersion: 1,
  provider: 'opencnpj',
  cnpj: '11222333000181',
  legalName: 'ATELIE EXEMPLO DE MARCENARIA LTDA',
  tradeName: 'ATELIE EXEMPLO',
  status: 'active',
  statusSince: '2015-03-10',
  headquarters: true,
  activityStart: '2015-03-10',
  cnaeMain: { code: '3101-2/00', description: 'Fabricação de móveis com predominância de madeira' },
  cnaeSecondary: ['4754-7/01'],
  legalNature: 'Sociedade Empresária Limitada',
  legalNatureCode: '2062',
  size: 'epp',
  isMei: false,
  simples: true,
  capitalCents: 15000000,
  city: 'CURITIBA',
  uf: 'PR',
  providerUpdatedAt: '2026-11-01T21:47:27.195Z',
};

describe('registro da Receita → fatos', () => {
  it('formata datas e reais sem depender da localidade', () => {
    expect(brazilianDate('2015-03-10')).toBe('10/03/2015');
    expect(brl(15000000)).toBe('R$ 150.000,00');
    expect(brl(5)).toBe('R$ 0,05');
    expect(brl(20543196049052)).toBe('R$ 205.431.960.490,52');
  });

  it('cada fato cita uma linha literal do texto da fonte', () => {
    const excerpt = registryExcerpt(RECORD);
    const facts = registryFacts(RECORD);
    expect(facts.length).toBeGreaterThanOrEqual(10);
    for (const fact of facts) {
      expect(excerpt.split('\n')).toContain(fact.quote);
      expect(fact.key).toMatch(/^registry\.[a-z_]+$/);
    }
    expect(new Set(facts.map((fact) => fact.key)).size).toBe(facts.length);
  });

  it('capital social é indício financeiro; o resto é firmográfico', () => {
    const byKey = new Map(registryFacts(RECORD).map((fact) => [fact.key, fact]));
    expect(byKey.get('registry.share_capital')).toMatchObject({
      domain: 'financial_proxy',
      statement: 'Capital social declarado: R$ 150.000,00.',
      value: { cents: 15000000 },
    });
    expect(byKey.get('registry.status')?.statement).toBe(
      'Situação cadastral na Receita Federal: ativa desde 10/03/2015.',
    );
    expect(byKey.get('registry.location')?.statement).toBe('Sede em CURITIBA/PR.');
    expect(byKey.get('registry.tax_regime')?.statement).toBe(
      'Optante pelo Simples Nacional (não é MEI).',
    );
  });

  it('campo ausente não vira fato (nem "nulo" no texto)', () => {
    const minimal: CnpjRegistryRecord = {
      ...RECORD,
      tradeName: null,
      statusSince: null,
      headquarters: null,
      activityStart: null,
      cnaeMain: null,
      cnaeSecondary: [],
      legalNature: null,
      size: null,
      capitalCents: null,
      city: null,
      uf: null,
    };
    const keys = registryFacts(minimal).map((fact) => fact.key);
    expect(keys).toEqual(['registry.legal_name', 'registry.status', 'registry.tax_regime']);
    expect(registryExcerpt(minimal)).not.toMatch(/null|undefined/);
  });

  it('MEI aparece como MEI, sem o nome da pessoa no texto da fonte nem nos fatos', () => {
    const mei = {
      ...RECORD,
      legalName: 'MARIA EXEMPLO',
      tradeName: 'MARIA EXEMPLO',
      legalNature: 'Empresário (Individual)',
      legalNatureCode: '2135',
      isMei: true,
      size: 'me' as const,
    };
    const facts = registryFacts(mei);
    expect(facts.find((fact) => fact.key === 'registry.tax_regime')?.statement).toBe(
      'É microempreendedor individual (MEI).',
    );
    expect(facts.map((fact) => fact.key)).not.toContain('registry.legal_name');
    expect(facts.map((fact) => fact.key)).not.toContain('registry.trade_name');
    const everything = registryExcerpt(mei) + JSON.stringify(facts);
    expect(everything).not.toMatch(/MARIA/);
    expect(everything).not.toMatch(/(?<!\d)\d{3}\.?\d{3}\.?\d{3}-?\d{2}(?!\d)/);
  });

  it('empresário individual, EIRELI e afins contam como empresa de uma pessoa', () => {
    const base = { isMei: false, legalNature: null, legalNatureCode: null };
    expect(isIndividualBusiness({ ...base, legalNatureCode: '2135' })).toBe(true);
    expect(isIndividualBusiness({ ...base, legalNature: 'Empresário (Individual)' })).toBe(true);
    expect(
      isIndividualBusiness({
        ...base,
        legalNature: 'Empresa Individual de Responsabilidade Limitada (de Natureza Empresária)',
      }),
    ).toBe(true);
    expect(isIndividualBusiness({ ...base, legalNature: 'Sociedade Empresária Limitada' })).toBe(
      false,
    );
    expect(isIndividualBusiness({ ...base, legalNatureCode: '2062' })).toBe(false);
  });

  it('nome fantasia diferente do nome da pessoa continua como fato', () => {
    const mei = {
      ...RECORD,
      legalName: 'MARIA EXEMPLO',
      tradeName: 'DOCES DA PRACA',
      isMei: true,
    };
    const trade = registryFacts(mei).find((fact) => fact.key === 'registry.trade_name');
    expect(trade?.statement).toBe('Nome fantasia: DOCES DA PRACA.');
  });

  it('dado que sumiu na nova consulta ganha fato de ausência citando a linha', () => {
    const without = { ...RECORD, tradeName: null, capitalCents: null };
    const facts = registryFacts(without, {
      replacing: new Set(['registry.trade_name', 'registry.share_capital', 'registry.status']),
    });
    const excerpt = registryExcerpt(without).split('\n');
    const trade = facts.find((fact) => fact.key === 'registry.trade_name');
    const capital = facts.find((fact) => fact.key === 'registry.share_capital');
    expect(trade).toMatchObject({
      value: { informed: false },
      quote: 'Nome fantasia: não informado',
    });
    expect(capital).toMatchObject({ domain: 'financial_proxy', value: { informed: false } });
    for (const fact of facts) expect(excerpt).toContain(fact.quote);
    expect(facts.filter((fact) => fact.key === 'registry.status')).toHaveLength(1);
  });

  it('conta os fatos que mudaram de valor', () => {
    const facts = registryFacts(RECORD);
    const previous = facts.map((fact) => ({ key: fact.key, value: { ...fact.value } }));
    expect(changedRegistryFacts(previous, facts)).toBe(0);
    const moved = registryFacts({ ...RECORD, city: 'LONDRINA' });
    expect(changedRegistryFacts(previous, moved)).toBe(1);
  });

  it('empresa individual reconhecida pelos fatos em vigor', () => {
    const mei = registryFacts({ ...RECORD, isMei: true, legalNatureCode: '2135' });
    expect(isIndividualFromFacts(mei)).toBe(true);
    expect(isIndividualFromFacts(registryFacts(RECORD))).toBe(false);
    expect(
      isIndividualFromFacts([
        {
          key: 'registry.legal_nature',
          value: { legalNature: 'Empresário (Individual)', code: null },
        },
      ]),
    ).toBe(true);
    expect(isIndividualFromFacts([])).toBe(false);
  });

  it('a fonte do registro fica guardada por 12 meses', () => {
    expect(registryRetentionUntil('2026-11-10T12:00:00.000Z')).toBe('2027-11-10T12:00:00.000Z');
  });
});

describe('conferência de trechos (docs/08 §2.4)', () => {
  it('compara sem acento, espaço extra, aspas tipográficas nem maiúsculas', () => {
    expect(normalizeForQuote('  Fabricação  de “móveis” ')).toBe('fabricacao de "moveis"');
    expect(quoteFoundIn('fabricacao de moveis', 'CNAE: Fabricação de   Móveis com madeira')).toBe(
      true,
    );
    expect(quoteFoundIn('móveis de aço', 'Fabricação de móveis com madeira')).toBe(false);
    expect(quoteFoundIn('   ', 'qualquer texto')).toBe(false);
  });

  it('trecho que não está na fonte impede a gravação; sem conteúdo fica sem conferência', () => {
    const contents = new Map<string, string | null>([
      ['a', 'Razão social: ATELIE EXEMPLO'],
      ['b', null],
    ]);
    const result = checkQuotes(
      [
        { sourceId: 'a', quote: 'razao social: atelie exemplo' },
        { sourceId: 'b', quote: 'qualquer coisa' },
        { sourceId: 'a', quote: 'Faturamento: R$ 1 milhão' },
        { sourceId: 'a', quote: null },
      ],
      contents,
    );
    expect(result.verified).toEqual([true, null, false, null]);
    expect(result.issues).toEqual([
      expect.objectContaining({ code: 'evidence_quote_not_found', field: 'evidence.2.quote' }),
    ]);
  });
});

describe('resumo do dossiê', () => {
  it('conta só o que está em vigor e lê o vencimento no instante pedido', () => {
    const now = new Date('2026-11-10T12:00:00Z');
    const summary = summarizeClaims(
      [
        { epistemicType: 'fact', status: 'active', validUntil: '2027-01-01T00:00:00Z' },
        { epistemicType: 'fact', status: 'active', validUntil: '2026-11-01T00:00:00Z' },
        { epistemicType: 'inference', status: 'disputed', validUntil: '2027-01-01T00:00:00Z' },
        { epistemicType: 'hypothesis', status: 'active', validUntil: '2027-01-01T00:00:00Z' },
        { epistemicType: 'fact', status: 'superseded', validUntil: '2027-01-01T00:00:00Z' },
        { epistemicType: 'fact', status: 'rejected', validUntil: '2027-01-01T00:00:00Z' },
      ],
      now,
    );
    expect(summary).toEqual({
      total: 4,
      facts: 2,
      inferences: 1,
      hypotheses: 1,
      stale: 1,
      disputed: 1,
    });
  });
});
