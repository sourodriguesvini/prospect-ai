import { describe, expect, it } from 'vitest';
import { CommercialProfile, CommercialThesis, type BusinessEvent } from '@prospector/contracts';
import {
  BLUMMY_PROFILE,
  buildBusinessTimeline,
  buildCommercialThesis,
  catalogIssues,
  COMMERCIAL_PROFILES,
  dedupeEventEvidence,
  extractFunding,
  FOUND_STUDIO_PROFILE,
  identifyCommercialProfile,
  type EventEvidence,
  type SiteSignalEvidence,
} from '../../src';

/** Cenários SINTÉTICOS da Parte 8 (ids fixos, datas relativas a 26/11/2026). */
const NOW = new Date('2026-11-26T12:00:00Z');
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function event(partial: Partial<BusinessEvent> & Pick<BusinessEvent, 'type'>): BusinessEvent {
  return {
    occurredOn: '2026-08-19',
    dateBasis: 'published',
    headline: 'Acontecimento',
    url: 'https://neofeed.com.br/materia',
    host: 'neofeed.com.br',
    sourceTier: 'recognized_press',
    republishedBy: [],
    confirmedBy: [],
    conflicts: [],
    pageRead: true,
    funding: null,
    ...partial,
  };
}

const SITE: SiteSignalEvidence[] = [
  {
    signal: 'site_accessibility',
    claimIds: [id(90)],
    detail: '24 de 139 textos com contraste baixo',
  },
  { signal: 'site_mobile', claimIds: [id(91)], detail: '48 alvos de toque pequenos no celular' },
];

describe('perfis comerciais (Parte 1)', () => {
  it.each(COMMERCIAL_PROFILES.map((profile) => [profile.id, profile] as const))(
    '%s passa no contrato e o catálogo fecha',
    (_id, profile) => {
      expect(CommercialProfile.parse(profile)).toEqual(profile);
      expect(catalogIssues(profile)).toEqual([]);
    },
  );

  it('Found Studio tem as seis famílias A a F', () => {
    expect(FOUND_STUDIO_PROFILE.families.map((family) => family.code)).toEqual([
      'A',
      'B',
      'C',
      'D',
      'E',
      'F',
    ]);
  });

  it('Blummy não inventa funcionalidades: o que falta fica a confirmar', () => {
    expect(BLUMMY_PROFILE.unknowns).toContain('Funcionalidades do produto');
    expect(BLUMMY_PROFILE.icps.flatMap((icp) => icp.roles)).toEqual(
      expect.arrayContaining(['user', 'buyer', 'influencer']),
    );
  });

  it.each([
    [
      'Quero encontrar 100 terapeutas ocupacionais no Brasil para apresentar a Blummy.',
      'blummy',
      'named',
    ],
    ['Encontre fonoaudiólogos e psicólogos com consultório em BH', 'blummy', 'keywords'],
    [
      'Liste startups que receberam rodada e podem precisar de rebranding',
      'found-studio',
      'keywords',
    ],
    ['Compare a Found Studio com a Blummy', null, 'ambiguous'],
    ['oi, tudo bem?', null, 'none'],
  ])('"%s" → %s', (request, profileId, reason) => {
    const result = identifyCommercialProfile(request);
    expect(result.profileId).toBe(profileId);
    expect(result.reason).toBe(reason);
  });
});

describe('tese comercial (Parte 4) nos cenários da Parte 8', () => {
  it('Caso 1 — Flash: o investimento vira o contexto; o site não vira a tese', () => {
    const funding = extractFunding(
      'A Flash levantou R$ 150 milhões em rodada Série D liderada pela Battery Ventures. Segundo o fundador, a empresa não precisava de dinheiro.',
    );
    const thesis = buildCommercialThesis({
      profile: FOUND_STUDIO_PROFILE,
      companyName: 'Flash',
      events: [
        {
          claimId: id(1),
          epistemicType: 'fact',
          event: event({
            type: 'funding',
            headline: 'A Flash não precisava de dinheiro, mas levantou R$ 150 milhões',
            confirmedBy: ['braziljournal.com'],
            republishedBy: ['agregador.test'],
            funding,
          }),
        },
        {
          claimId: id(2),
          epistemicType: 'fact',
          event: event({
            type: 'launch',
            occurredOn: '2026-10-02',
            headline: 'Flash lança nova plataforma de contratação com IA',
            url: 'https://flashapp.com.br/novidades',
            host: 'flashapp.com.br',
            sourceTier: 'official',
          }),
        },
      ],
      siteSignals: SITE,
      contactKnown: false,
      now: NOW,
    });
    expect(CommercialThesis.parse(thesis)).toEqual(thesis);
    expect(thesis.principal?.problemId).toBe('produto-em-estruturacao');
    expect(thesis.principal?.context).toContain('Série D de R$ 150 milhões');
    expect(thesis.principal?.offer).toEqual(
      expect.arrayContaining(['Product Discovery', 'Design System', 'Direção de implementação']),
    );
    // Nenhum ângulo sai das medições do site.
    for (const angle of [thesis.principal, ...thesis.alternatives]) {
      expect(angle?.problemId).not.toBe('experiencia-digital-com-falhas');
    }
    expect(thesis.alternatives.length).toBeLessThanOrEqual(2);
    expect(thesis.doNotOffer.map((item) => item.item)).toEqual(
      expect.arrayContaining([
        'Tratar o investimento como orçamento para serviços',
        'Abrir pela auditoria do site (contraste, toque, rolagem)',
      ]),
    );
    expect(
      thesis.doNotOffer.find((item) => item.item.startsWith('Tratar o investimento'))?.reason,
    ).toBe('A destinação dos recursos não está documentada.');
    expect(thesis.toConfirm).toContain('Para que serão usados os recursos do investimento');
    const dims = Object.fromEntries(thesis.dimensions.map((item) => [item.key, item.level]));
    expect(dims).toMatchObject({
      strategic_potential: 'high',
      evidence_quality: 'high',
      timing: 'high',
      accessibility: 'low',
    });
    expect(thesis.recommendation).toBe('approach');
  });

  it('Caso 3 — startup contratando produto e tecnologia: oportunidade de produto, sem prometer o que não é comprovado', () => {
    const thesis = buildCommercialThesis({
      profile: FOUND_STUDIO_PROFILE,
      companyName: 'Acme',
      events: [
        {
          claimId: id(3),
          epistemicType: 'fact',
          event: event({
            type: 'hiring',
            occurredOn: '2026-11-01',
            headline: 'Acme abre vagas de Product Manager e engenharia',
            url: 'https://acme.test/carreiras',
            host: 'acme.test',
            sourceTier: 'official',
          }),
        },
        {
          claimId: id(4),
          epistemicType: 'fact',
          event: event({
            type: 'leadership',
            occurredOn: '2026-09-15',
            headline: 'Acme anuncia nova CPO',
          }),
        },
      ],
      siteSignals: [],
      contactKnown: true,
      now: NOW,
    });
    expect(thesis.principal?.problemId).toBe('produto-em-estruturacao');
    expect(thesis.principal?.approachRole).toContain('produto');
    expect(thesis.dimensions.find((item) => item.key === 'accessibility')?.level).toBe('medium');
  });

  it('Caso 4 — só problema de site: reconhece a limitação e não prioriza', () => {
    const thesis = buildCommercialThesis({
      profile: FOUND_STUDIO_PROFILE,
      companyName: 'Loja',
      events: [],
      siteSignals: SITE,
      contactKnown: true,
      now: NOW,
    });
    expect(thesis.recommendation).toBe('deprioritize');
    expect(thesis.principal?.problemId).toBe('experiencia-digital-com-falhas');
    expect(thesis.dimensions.find((item) => item.key === 'strategic_potential')?.level).toBe('low');
    expect(thesis.principal?.whyNow).toContain('não indicam momento');
  });

  it('Caso 6 — fontes contraditórias: registra a divergência e pede confirmação', () => {
    const thesis = buildCommercialThesis({
      profile: FOUND_STUDIO_PROFILE,
      companyName: 'Beta',
      events: [
        {
          claimId: id(5),
          epistemicType: 'fact',
          event: event({
            type: 'funding',
            conflicts: [
              'Valores diferentes entre as fontes: R$ 150 milhões (neofeed.com.br) e R$ 120 milhões (outra.test).',
            ],
          }),
        },
      ],
      siteSignals: [],
      contactKnown: false,
      now: NOW,
    });
    expect(thesis.recommendation).toBe('deepen_research');
    expect(thesis.dimensions.find((item) => item.key === 'evidence_quality')?.level).toBe('low');
    expect(thesis.toConfirm.some((item) => item.includes('Valores diferentes'))).toBe(true);
  });

  it('sem nenhum sinal: não inventa tese, pede mais pesquisa', () => {
    const thesis = buildCommercialThesis({
      profile: FOUND_STUDIO_PROFILE,
      companyName: 'Vazia',
      events: [],
      siteSignals: [],
      contactKnown: false,
      now: NOW,
    });
    expect(thesis.principal).toBeNull();
    expect(thesis.recommendation).toBe('deepen_research');
    expect(thesis.dimensions.every((item) => item.level !== 'high')).toBe(true);
  });

  it('acontecimento só no título da busca (fonte fraca): aprofundar antes', () => {
    const thesis = buildCommercialThesis({
      profile: FOUND_STUDIO_PROFILE,
      companyName: 'Gama',
      events: [
        {
          claimId: id(6),
          epistemicType: 'hypothesis',
          event: event({
            type: 'acquisition',
            pageRead: false,
            sourceTier: 'other',
            host: 'blog.test',
          }),
        },
      ],
      siteSignals: [],
      contactKnown: false,
      now: NOW,
    });
    expect(thesis.recommendation).toBe('deepen_research');
    expect(thesis.toConfirm.some((item) => item.startsWith('Ler a matéria original'))).toBe(true);
  });

  it('perfis não se misturam: a tese da Blummy só usa o catálogo da Blummy', () => {
    const thesis = buildCommercialThesis({
      profile: BLUMMY_PROFILE,
      companyName: 'Clínica Exemplo',
      events: [
        {
          claimId: id(7),
          epistemicType: 'fact',
          event: event({ type: 'expansion', headline: 'Clínica inaugura nova unidade' }),
        },
      ],
      siteSignals: [],
      contactKnown: false,
      now: NOW,
    });
    expect(thesis.profileId).toBe('blummy');
    expect(thesis.principal?.offer).toEqual(['Assinatura da Blummy']);
    expect(thesis.principal?.approachRole).toContain('Gestor');
    expect(thesis.principal?.openingTopic).toContain('rotina da clínica');
  });

  it('o que não oferecer depois de um acontecimento vem do perfil, não do código', () => {
    const rebrand = {
      claimId: id(8),
      epistemicType: 'fact' as const,
      event: event({ type: 'brand_change', occurredOn: '2026-10-20' }),
    };
    const items = (profile: typeof FOUND_STUDIO_PROFILE) =>
      buildCommercialThesis({
        profile,
        companyName: 'Delta',
        events: [rebrand],
        siteSignals: [],
        contactKnown: false,
        now: NOW,
      }).doNotOffer.map((item) => item.item);
    expect(items(FOUND_STUDIO_PROFILE)).toContain('Rebranding');
    expect(items(BLUMMY_PROFILE)).not.toContain('Rebranding');
  });

  it('acontecimento sem data conferida: aprofundar antes de abordar (o momento é desconhecido)', () => {
    const thesis = buildCommercialThesis({
      profile: FOUND_STUDIO_PROFILE,
      companyName: 'Épsilon',
      events: [
        {
          claimId: id(9),
          epistemicType: 'fact',
          event: event({
            type: 'hiring',
            occurredOn: null,
            dateBasis: 'unknown',
            headline: 'O site menciona: vagas para designer de produto e engenharia',
            sourceTier: 'official',
          }),
        },
      ],
      siteSignals: [],
      contactKnown: false,
      now: NOW,
    });
    expect(thesis.dimensions.find((item) => item.key === 'timing')?.level).toBe('unknown');
    expect(thesis.recommendation).toBe('deepen_research');
  });
});

describe('um acontecimento conta uma vez (Parte 3.3)', () => {
  it('a mesma rodada gravada em duas análises, com a origem em sites diferentes, vira uma só', () => {
    const funding = (amountCents: number) => ({
      amountCents,
      amount: { text: 'R$ 150 milhões', quote: 'R$ 150 milhões' },
      round: null,
      investors: [],
      modality: 'equity' as const,
      purpose: { status: 'unknown' as const },
      context: null,
    });
    const kept = dedupeEventEvidence([
      {
        claimId: id(20),
        epistemicType: 'hypothesis',
        event: event({
          type: 'funding',
          headline: 'Flash capta R$ 150 mi',
          host: 'blog.test',
          pageRead: false,
          funding: funding(15_000_000_000),
        }),
      },
      {
        claimId: id(21),
        epistemicType: 'fact',
        event: event({
          type: 'funding',
          headline: 'A Flash não precisava de dinheiro, mas levantou R$ 150 milhões',
          funding: funding(15_000_000_000),
        }),
      },
      {
        claimId: id(22),
        epistemicType: 'fact',
        event: event({ type: 'launch', headline: 'Flash lança cartão corporativo' }),
      },
    ]);
    expect(kept.map((item) => item.claimId)).toEqual([id(21), id(22)]);
  });
});

describe('linha do tempo (Parte 2.4)', () => {
  it('ordena por data e lê sequências', () => {
    const items: EventEvidence[] = [
      {
        claimId: id(10),
        epistemicType: 'fact',
        event: event({ type: 'launch', occurredOn: '2026-10-02' }),
      },
      {
        claimId: id(11),
        epistemicType: 'fact',
        event: event({ type: 'funding', occurredOn: '2026-08-19' }),
      },
      {
        claimId: id(12),
        epistemicType: 'hypothesis',
        event: event({ type: 'award', occurredOn: null, dateBasis: 'unknown' }),
      },
    ];
    const timeline = buildBusinessTimeline(items);
    expect(timeline.entries.map((entry) => entry.claimId)).toEqual([id(11), id(10), id(12)]);
    expect(timeline.entries[0]?.importance).toBe('high');
    expect(timeline.sequences).toEqual([
      {
        claimIds: [id(11), id(10)],
        reading: expect.stringContaining('investimento ou rodada seguido de lançamento'),
      },
    ]);
  });
});
