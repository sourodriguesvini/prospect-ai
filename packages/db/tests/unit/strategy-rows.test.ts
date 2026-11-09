import type {
  ContactPolicyContent,
  IcpContent,
  LiaContent,
  OfferContent,
  ScoringModelContent,
  VoiceGuideContent,
} from '@prospector/contracts';
import { describe, expect, it } from 'vitest';
import {
  contactPolicyColumns,
  icpVersionColumns,
  liaColumns,
  mapContactPolicy,
  mapIcpVersion,
  mapLia,
  mapOfferVersion,
  mapProofAsset,
  mapScoring,
  mapVoice,
  offerVersionColumns,
  proofAssetColumns,
  scoringColumns,
  voiceColumns,
} from '../../src/strategy-rows';

/**
 * Ida e volta conteúdo → colunas → linha → conteúdo para cada tabela da estratégia. Valores
 * distintos em todos os campos: uma troca de colunas (ex.: os dois limiares de 70 do rascunho)
 * aparece aqui, não só no banco real.
 */

const ID = '11111111-1111-4111-8111-111111111111';
const PARENT = '22222222-2222-4222-8222-222222222222';
const AT = '2026-11-09T12:00:00+00:00';
const meta = { id: ID, version: 3, created_at: AT };

describe('linhas da estratégia: ida e volta sem trocar colunas', () => {
  it('versão da oferta', () => {
    const content: OfferContent = {
      name: 'Rebranding',
      description: 'Descrição',
      problems: ['P1', 'P2'],
      needSignals: ['S1'],
      disqualifiers: ['D1'],
      deliverables: ['E1', 'E2'],
      valueProps: ['V1'],
      priceMinCents: 1_000_000,
      priceMaxCents: 3_000_000,
    };
    const row = { ...meta, offer_id: PARENT, ...offerVersionColumns(content) };
    expect(mapOfferVersion(row)).toEqual({
      id: ID,
      offerId: PARENT,
      version: 3,
      createdAt: AT,
      content,
    });
  });

  it('modelo de score', () => {
    const content: ScoringModelContent = {
      weights: { fit: 11, need: 29, signal: 23, capacity: 17, timing: 20 },
      thresholds: {
        pursuePriority: 71,
        prepareAccessPotential: 66,
        discardPotential: 39,
        minEvidenceCoverage: 52,
      },
    };
    const row = { ...meta, offer_id: PARENT, ...scoringColumns(content) };
    expect(mapScoring(row).content).toEqual(content);
  });

  it('versão do ICP (filtros e exclusões não se misturam)', () => {
    const content: IcpContent = {
      name: 'ICP',
      description: 'Desc',
      filters: {
        cnaes: ['8630-5/04'],
        ufs: ['PR'],
        municipalities: [{ name: 'Curitiba', uf: 'PR' }],
        sizes: ['me'],
        minAgeYears: 2,
        maxAgeYears: 20,
      },
      exclusions: {
        cnaes: ['4711-3/02'],
        municipalities: [{ name: 'Londrina', uf: 'PR' }],
        cnpjRoots: ['12345678'],
        domains: ['concorrente.example'],
      },
    };
    const row = { ...meta, icp_id: PARENT, ...icpVersionColumns(content) };
    expect(mapIcpVersion(row).content).toEqual(content);
  });

  it('voz da agência (exemplos bons e ruins)', () => {
    const content: VoiceGuideContent = {
      summary: 'Direta',
      principles: ['Clareza'],
      avoid: ['Jargão'],
      goodExamples: ['Bom'],
      badExamples: ['Ruim'],
    };
    expect(mapVoice({ ...meta, ...voiceColumns(content) }).content).toEqual(content);
  });

  it('política de contato', () => {
    const content: ContactPolicyContent = {
      agencyName: 'Agência',
      privacyContact: 'privacidade@agencia.example',
      optOutText: 'Responda "remover".',
    };
    expect(mapContactPolicy({ ...meta, ...contactPolicyColumns(content) }).content).toEqual(
      content,
    );
  });

  it('LIA (conteúdo e decisões)', () => {
    const content: LiaContent = {
      purpose: 'Finalidade',
      legitimateInterest: 'Interesse',
      necessity: 'Necessidade',
      dataCategories: ['name', 'work_email'],
      dataSources: ['company_website', 'user_input'],
      expectations: 'Expectativa',
      risks: 'Riscos',
      safeguards: 'Salvaguardas',
      conclusion: 'Conclusão',
    };
    const lia = mapLia({
      ...meta,
      ...liaColumns(content),
      approved_at: AT,
      review_due_on: '2027-11-09',
      revoked_at: null,
    });
    expect(lia).toMatchObject({ content, approvedAt: AT, reviewDueOn: '2027-11-09' });
  });

  it('case: o PATCH leva só as colunas que o servidor pode alterar', () => {
    const input = {
      offerId: PARENT,
      title: 'Case',
      segment: 'Saúde',
      summary: 'Resumo',
      results: 'Resultados',
      publicOk: true,
      consentRef: 'Contrato',
    };
    const columns = proofAssetColumns(input);
    // Sem is_demo nem archived_at (o banco recusaria com 42501).
    expect(Object.keys(columns).sort()).toEqual(
      ['consent_ref', 'offer_id', 'public_ok', 'results', 'segment', 'summary', 'title'].sort(),
    );
    const asset = mapProofAsset({
      ...columns,
      id: ID,
      is_demo: false,
      archived_at: null,
      created_at: AT,
      updated_at: AT,
    });
    expect(asset).toMatchObject(input);
  });
});
