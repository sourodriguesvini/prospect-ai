import { describe, expect, it } from 'vitest';
import {
  ApproachProposal,
  ProposalRecommendation,
  type BusinessEvent,
} from '@prospector/contracts';
import {
  BLUMMY_PROFILE,
  assessProposalCoherence,
  buildCommercialThesis,
  buildProposal,
  extractFunding,
  FOUND_STUDIO_PROFILE,
  identifyCommercialProfile,
  recommendProposal,
  type EventEvidence,
} from '../../src';

/** Cenários SINTÉTICOS do ajuste de 27/11 (motor de ofertas); ids fixos, datas perto de 27/11. */
const NOW = new Date('2026-11-27T12:00:00Z');
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function event(partial: Partial<BusinessEvent> & Pick<BusinessEvent, 'type'>): BusinessEvent {
  return {
    occurredOn: '2026-10-20',
    dateBasis: 'published',
    headline: 'Acontecimento',
    url: 'https://neofeed.com.br/materia',
    host: 'neofeed.com.br',
    sourceTier: 'recognized_press',
    republishedBy: [],
    confirmedBy: ['braziljournal.com'],
    conflicts: [],
    pageRead: true,
    funding: null,
    ...partial,
  };
}

const fact = (n: number, e: BusinessEvent): EventEvidence => ({
  claimId: id(n),
  epistemicType: 'fact',
  event: e,
});

function thesisFor(events: EventEvidence[], profile = FOUND_STUDIO_PROFILE, name = 'Empresa') {
  return buildCommercialThesis({
    profile,
    companyName: name,
    events,
    siteSignals: [],
    contactKnown: true,
    now: NOW,
  });
}

const codes = (families: ReadonlyArray<{ code: string }>) => families.map((family) => family.code);
const ALL = new Set(Array.from({ length: 30 }, (_, n) => id(n)));

describe('solução recomendada a partir da tese (ajuste de 27/11)', () => {
  it('Flash — investimento e lançamento com IA: produto e tecnologia, nunca site institucional', () => {
    const thesis = thesisFor(
      [
        fact(
          1,
          event({
            type: 'funding',
            headline: 'A Flash não precisava de dinheiro, mas levantou R$ 150 milhões',
            funding: extractFunding(
              'A Flash levantou R$ 150 milhões em rodada Série D liderada pela Battery Ventures.',
            ),
          }),
        ),
        fact(
          2,
          event({
            type: 'launch',
            occurredOn: '2026-11-02',
            headline: 'Flash lança nova plataforma de contratação com IA',
            url: 'https://flashapp.com.br/novidades',
            host: 'flashapp.com.br',
            sourceTier: 'official',
          }),
        ),
      ],
      FOUND_STUDIO_PROFILE,
      'Flash',
    );
    expect(thesis.recommendation).toBe('approach');
    const recommendation = recommendProposal(FOUND_STUDIO_PROFILE, thesis);
    expect(ProposalRecommendation.parse(recommendation)).toEqual(recommendation);
    expect(codes(recommendation!.families)).toContain('D');
    expect(codes(recommendation!.families)).toEqual(expect.arrayContaining(['D', 'E']));
    expect(recommendation!.services).not.toContain('Site');
    expect(recommendation!.title).toContain('Estruturação e evolução do produto digital');
    expect(recommendation!.rationale.length).toBeGreaterThan(20);
  });

  it('startup em expansão — rodada para o time de produto e vagas de PM e UX: PM, UX/UI e direção de projetos', () => {
    const thesis = thesisFor([
      fact(
        3,
        event({
          type: 'funding',
          headline: 'Acme recebe aporte de R$ 20 milhões para ampliar o time de produto',
          funding: extractFunding(
            'A Acme recebeu aporte de R$ 20 milhões em rodada Série A para ampliar o time de produto.',
          ),
        }),
      ),
      fact(
        4,
        event({
          type: 'hiring',
          occurredOn: '2026-11-10',
          headline: 'Acme abre vagas de Product Manager e designer de UX',
          url: 'https://acme.test/carreiras',
          host: 'acme.test',
          sourceTier: 'official',
        }),
      ),
    ]);
    expect(thesis.principal?.problemId).toBe('produto-em-estruturacao');
    const recommendation = recommendProposal(FOUND_STUDIO_PROFILE, thesis)!;
    expect(codes(recommendation.families)).toEqual(expect.arrayContaining(['D', 'F']));
    expect(recommendation.services).toEqual(
      expect.arrayContaining(['Diagnóstico de produto', 'UX/UI', 'Direção de implementação']),
    );
    expect(recommendation.services).not.toContain('Site');
  });

  it('reestruturação da operação e reposicionamento da marca: estratégia, branding e estruturação operacional', () => {
    const thesis = thesisFor([
      fact(
        5,
        event({
          type: 'restructuring',
          headline: 'Beta anuncia reestruturação da operação e reposicionamento da marca',
        }),
      ),
    ]);
    expect(thesis.principal?.problemId).toBe('marca-desalinhada-ao-momento');
    const recommendation = recommendProposal(FOUND_STUDIO_PROFILE, thesis)!;
    expect(codes(recommendation.families)).toEqual(['A', 'B', 'F']);
    expect(recommendation.combinedWith).toBe('Estruturação da operação de projetos');
    expect(recommendation.rationale).toContain('mesmo acontecimento');
  });

  it('Blummy — clínica que abre unidade: perfil certo, SaaS para profissionais terapêuticos', () => {
    expect(
      identifyCommercialProfile('Clínica de terapia ocupacional com terapeutas em BH').profileId,
    ).toBe('blummy');
    const thesis = thesisFor(
      [
        fact(
          6,
          event({
            type: 'expansion',
            headline: 'Clínica Alfa abre nova unidade e amplia equipe de terapeutas',
          }),
        ),
      ],
      BLUMMY_PROFILE,
      'Clínica Alfa',
    );
    expect(thesis.profileId).toBe('blummy');
    const proposal = buildProposal({
      profile: BLUMMY_PROFILE,
      thesis,
      choice: 'principal',
      mode: 'recommended',
      families: [],
      note: null,
    });
    expect(ApproachProposal.parse(proposal)).toEqual(proposal);
    expect(proposal).toMatchObject({
      profileId: 'blummy',
      profileKind: 'product',
      services: ['Assinatura da Blummy'],
    });
    expect(codes(proposal.families)).toEqual(['G']);
    expect(proposal.objective).toContain('produto');
    // Nada da Found Studio entra na proposta da Blummy.
    expect(proposal.services.join(' ')).not.toMatch(/marca|UX|site/i);
  });

  it('networking — primeira mensagem sem oferta: nenhuma frente, nenhum serviço, objetivo de conversa', () => {
    const proposal = buildProposal({
      profile: FOUND_STUDIO_PROFILE,
      thesis: null,
      choice: null,
      mode: 'conversation',
      families: [],
      note: 'Quero só me apresentar e entender o momento deles.',
    });
    expect(ApproachProposal.parse(proposal)).toEqual(proposal);
    expect(proposal.families).toEqual([]);
    expect(proposal.services).toEqual([]);
    expect(proposal.objective).toContain('sem apresentar serviço');
    expect(proposal.note).toBe('Quero só me apresentar e entender o momento deles.');
    expect(
      assessProposalCoherence({
        profile: FOUND_STUDIO_PROFILE,
        thesis: null,
        choice: null,
        mode: 'conversation',
        families: [],
        citableClaimIds: new Set(),
      }),
    ).toEqual([]);
  });

  it('ajuste livre: frentes escolhidas trazem os serviços do ângulo e os da frente nova', () => {
    const thesis = thesisFor([
      fact(
        3,
        event({ type: 'funding', headline: 'Acme recebe aporte para ampliar o time de produto' }),
      ),
    ]);
    const proposal = buildProposal({
      profile: FOUND_STUDIO_PROFILE,
      thesis,
      choice: 'principal',
      mode: 'custom',
      families: ['D', 'C'],
      note: null,
    });
    expect(codes(proposal.families)).toEqual(['C', 'D']);
    expect(proposal.services).toEqual(expect.arrayContaining(['UX/UI', 'Campanha e key visual']));
    expect(proposal.title).toBe('Direção Criativa e Comunicação + Produto e Experiência Digital');
  });
});

describe('barreira de coerência antes de gerar (correção de 27/11)', () => {
  const flash = thesisFor([
    fact(
      1,
      event({ type: 'funding', headline: 'Flash levanta R$ 150 milhões para acelerar produto' }),
    ),
  ]);

  it('sem tese do perfil: propor serviço bloqueia, conversa não', () => {
    const base = {
      profile: FOUND_STUDIO_PROFILE,
      thesis: null,
      choice: 'principal' as const,
      families: [],
      citableClaimIds: ALL,
    };
    expect(assessProposalCoherence({ ...base, mode: 'recommended' })[0]).toContain(
      'Ainda não há tese da Found Studio',
    );
    expect(assessProposalCoherence({ ...base, mode: 'conversation' })).toEqual([]);
  });

  it('tese que manda aprofundar ou não priorizar bloqueia com o motivo e o que confirmar', () => {
    const siteOnly = buildCommercialThesis({
      profile: FOUND_STUDIO_PROFILE,
      companyName: 'Loja',
      events: [],
      siteSignals: [
        { signal: 'site_mobile', claimIds: [id(9)], detail: '48 alvos de toque pequenos' },
      ],
      contactKnown: true,
      now: NOW,
    });
    const [blocker] = assessProposalCoherence({
      profile: FOUND_STUDIO_PROFILE,
      thesis: siteOnly,
      choice: 'principal',
      mode: 'recommended',
      families: [],
      citableClaimIds: ALL,
    });
    expect(blocker).toContain('Não priorizar agora');
    expect(blocker).toContain('Só há detalhes técnicos do site');
    const conflicting = thesisFor([
      fact(
        7,
        event({
          type: 'funding',
          conflicts: [
            'Valores diferentes entre as fontes: R$ 150 milhões (a) e R$ 120 milhões (b).',
          ],
        }),
      ),
    ]);
    const [deepen] = assessProposalCoherence({
      profile: FOUND_STUDIO_PROFILE,
      thesis: conflicting,
      choice: 'principal',
      mode: 'custom',
      families: ['D'],
      citableClaimIds: ALL,
    });
    expect(deepen).toContain('Vale aprofundar a pesquisa antes');
    expect(deepen).toContain('Antes de propor, confirme');
  });

  it('evidência do ângulo fora de vigor bloqueia', () => {
    expect(flash.recommendation).toBe('approach');
    const [blocker] = assessProposalCoherence({
      profile: FOUND_STUDIO_PROFILE,
      thesis: flash,
      choice: 'principal',
      mode: 'recommended',
      families: [],
      citableClaimIds: new Set([id(99)]),
    });
    expect(blocker).toContain('não estão mais em vigor');
  });

  it('frentes desligadas do ângulo bloqueiam; incluir uma ligada libera a combinação', () => {
    const base = {
      profile: FOUND_STUDIO_PROFILE,
      thesis: flash,
      choice: 'principal' as const,
      mode: 'custom' as const,
      citableClaimIds: ALL,
    };
    const [blocker] = assessProposalCoherence({ ...base, families: ['C'] });
    expect(blocker).toContain('não se ligam ao ângulo');
    expect(blocker).toContain('Produto e Experiência Digital');
    expect(assessProposalCoherence({ ...base, families: ['C', 'D'] })).toEqual([]);
    expect(assessProposalCoherence({ ...base, families: [] })).toEqual([
      'Escolha ao menos uma frente do catálogo para propor.',
    ]);
  });

  it('sem ângulo ("sem a tese") não há o que recomendar', () => {
    expect(
      assessProposalCoherence({
        profile: FOUND_STUDIO_PROFILE,
        thesis: flash,
        choice: null,
        mode: 'recommended',
        families: [],
        citableClaimIds: ALL,
      })[0],
    ).toContain('Sem um ângulo da tese');
  });
});
