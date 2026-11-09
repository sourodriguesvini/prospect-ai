import {
  IcpContent,
  OfferContent,
  ProofAssetInput,
  VoiceGuideContent,
} from '@prospector/contracts';
import { describe, expect, it } from 'vitest';
import {
  icpInput,
  icpValues,
  offerInput,
  offerValues,
  proofAssetInput,
  proofAssetValues,
  voiceInput,
  voiceValues,
} from './strategy-forms';

describe('formulários da estratégia (ida e volta)', () => {
  it('oferta: listas por linha e reais ↔ centavos', () => {
    const content = OfferContent.parse(
      offerInput({
        name: 'Identidade visual',
        problems: 'Marca antiga\n\nSite confuso\n',
        priceMinCents: '15.000,00',
        priceMaxCents: '',
      }),
    );
    expect(content).toMatchObject({
      problems: ['Marca antiga', 'Site confuso'],
      priceMinCents: 1_500_000,
      priceMaxCents: null,
    });
    expect(OfferContent.parse(offerInput(offerValues(content)))).toEqual(content);
  });

  it('ICP: UFs e portes marcados, municípios "Cidade/UF", idades opcionais', () => {
    const content = IcpContent.parse(
      icpInput({
        name: 'Clínicas',
        'filters.cnaes': '8630504',
        'filters.ufs': ['PR', 'SC'],
        'filters.municipalities': 'Curitiba/PR',
        'filters.sizes': 'me',
        'filters.minAgeYears': '3',
        'filters.maxAgeYears': '',
        'exclusions.domains': 'https://www.concorrente.example/',
      }),
    );
    expect(content.filters).toMatchObject({
      cnaes: ['8630-5/04'],
      ufs: ['PR', 'SC'],
      municipalities: [{ name: 'Curitiba', uf: 'PR' }],
      sizes: ['me'],
      minAgeYears: 3,
      maxAgeYears: null,
    });
    expect(IcpContent.parse(icpInput(icpValues(content)))).toEqual(content);
  });

  it('voz: exemplos com várias linhas separados por ---', () => {
    const content = VoiceGuideContent.parse(
      voiceInput({ summary: 'Direta', goodExamples: 'Olá,\ntudo bem?\n---\nOutro exemplo' }),
    );
    expect(content.goodExamples).toEqual(['Olá,\ntudo bem?', 'Outro exemplo']);
    expect(VoiceGuideContent.parse(voiceInput(voiceValues(content)))).toEqual(content);
  });

  it('case: sem oferta vira null e a caixa marcada vira publicOk', () => {
    const input = ProofAssetInput.parse(
      proofAssetInput({
        title: 'Case',
        summary: 'Resumo',
        offerId: '',
        publicOk: 'on',
        consentRef: 'E-mail',
      }),
    );
    expect(input).toMatchObject({ offerId: null, publicOk: true });
    expect(
      ProofAssetInput.parse(
        proofAssetInput(
          proofAssetValues({
            ...input,
            id: '11111111-1111-4111-8111-111111111111',
            isDemo: false,
            archivedAt: null,
            createdAt: '',
            updatedAt: '',
          }),
        ),
      ),
    ).toEqual(input);
  });
});
