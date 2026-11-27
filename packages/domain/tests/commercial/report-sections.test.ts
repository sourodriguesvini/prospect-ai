import { describe, expect, it } from 'vitest';
import type { BusinessEvent } from '@prospector/contracts';
import {
  buildCommercialThesis,
  eventsForTopic,
  executiveSummary,
  FOUND_STUDIO_PROFILE,
  reportTopics,
  type EventEvidence,
  type ReportClaim,
  type SiteSignalEvidence,
} from '../../src';

/** Cenários SINTÉTICOS da Parte 7 (ids fixos, datas relativas a 26/11/2026). */
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

const FUNDING: EventEvidence = {
  claimId: id(1),
  epistemicType: 'fact',
  event: event({
    type: 'funding',
    headline: 'Flash levanta R$ 150 milhões em Série D',
    funding: {
      amountCents: 15_000_000_000,
      amount: { text: 'R$ 150 milhões', quote: 'R$ 150 milhões' },
      round: { text: 'Série D', quote: 'Série D' },
      investors: [],
      modality: 'equity',
      purpose: {
        status: 'declared',
        value: {
          text: 'novos produtos e inteligência artificial',
          quote: 'investir em novos produtos e inteligência artificial',
        },
      },
      context: null,
    },
  }),
};
const LAUNCH: EventEvidence = {
  claimId: id(2),
  epistemicType: 'fact',
  event: event({
    type: 'launch',
    occurredOn: '2026-10-02',
    headline: 'Flash lança nova plataforma de contratação',
    host: 'flashapp.com.br',
    url: 'https://flashapp.com.br/novidades',
    sourceTier: 'official',
  }),
};
const LEADERSHIP: EventEvidence = {
  claimId: id(3),
  epistemicType: 'hypothesis',
  event: event({
    type: 'leadership',
    occurredOn: '2026-06',
    headline: 'Flash anuncia nova diretora de marketing',
    sourceTier: 'other',
    host: 'blog.test',
  }),
};
const AWARD: EventEvidence = {
  claimId: id(4),
  epistemicType: 'fact',
  event: event({ type: 'award', occurredOn: '2025-03-01', headline: 'Flash ganha prêmio' }),
};

const SITE: SiteSignalEvidence[] = [
  { signal: 'site_mobile', claimIds: [id(91)], detail: '48 alvos de toque pequenos no celular' },
];

function thesisFor(events: EventEvidence[], contactKnown = false) {
  return buildCommercialThesis({
    profile: FOUND_STUDIO_PROFILE,
    companyName: 'Flash',
    events,
    siteSignals: SITE,
    contactKnown,
    now: NOW,
  });
}

const CLAIMS: ReportClaim[] = [
  { key: 'positioning.segment', statement: 'O site se apresenta como: benefícios flexíveis' },
  {
    key: 'positioning.value_proposition',
    statement: 'A empresa oferece benefícios flexíveis para empresas de todos os portes',
  },
  { key: 'positioning.business_model', statement: 'O site menciona: venda para empresas (B2B)' },
  { key: 'registry.cnae_main', statement: 'CNAE principal: 6201-5/01' },
];

describe('temas dos acontecimentos (Parte 7, seções 6 e 8)', () => {
  it('lançamento e parceria são produto; liderança e contratação são estrutura', () => {
    expect(reportTopics(LAUNCH.event)).toEqual(['product_technology']);
    expect(reportTopics(LEADERSHIP.event)).toEqual(['organization']);
    expect(reportTopics(AWARD.event)).toEqual([]);
  });

  it('rodada entra em produto só quando a finalidade declarada fala de produto ou tecnologia', () => {
    expect(reportTopics(FUNDING.event)).toEqual(['product_technology']);
    const plain = event({ type: 'funding', headline: 'Empresa capta R$ 10 milhões' });
    expect(reportTopics(plain)).toEqual([]);
  });

  it('contratação de engenharia conta nos dois temas; "ia" dentro de palavra não conta', () => {
    const hiring = event({ type: 'hiring', headline: 'Acme abre vagas de engenharia' });
    expect(reportTopics(hiring)).toEqual(['product_technology', 'organization']);
    const notAi = event({ type: 'expansion', headline: 'Empresa abre filial na Bahia' });
    expect(reportTopics(notAi)).toEqual(['organization']);
  });

  it('lista por tema do mais recente ao mais antigo', () => {
    const list = eventsForTopic([FUNDING, LAUNCH, LEADERSHIP, AWARD], 'product_technology');
    expect(list.map((item) => item.claimId)).toEqual([id(2), id(1)]);
    expect(eventsForTopic([FUNDING, LAUNCH, LEADERSHIP], 'organization')).toEqual([LEADERSHIP]);
  });
});

describe('resumo executivo: as cinco perguntas (Parte 7)', () => {
  it('responde as cinco, na ordem, a partir do ledger e da tese', () => {
    const thesis = thesisFor([FUNDING, LAUNCH]);
    const answers = executiveSummary({
      claims: CLAIMS,
      events: [FUNDING, LAUNCH, LEADERSHIP],
      thesis,
      fallbackOffer: null,
      contactBlocked: false,
    });
    expect(answers.map((answer) => answer.label)).toEqual([
      'Quem é a empresa?',
      'O que está acontecendo?',
      'Por que ela merece atenção?',
      'Onde podemos contribuir?',
      'Qual é a melhor abordagem?',
    ]);
    const [who, what, why, where, how] = answers;
    expect(who?.text).toBe(
      'A empresa oferece benefícios flexíveis para empresas de todos os portes. O site menciona: venda para empresas (B2B).',
    );
    expect(who?.basis).toBe('site');
    // O mais importante primeiro (rodada), depois o mais recente de mesma importância.
    expect(what?.text).toContain(
      '19/08/2026: Flash levanta R$ 150 milhões em Série D (fato, neofeed.com.br).',
    );
    expect(what?.text).toContain('Mais 1 acontecimento na linha do tempo.');
    expect(why?.text).toMatch(/^Hipótese a confirmar: /);
    expect(where?.text).toContain(thesis.principal!.title);
    expect(how?.text).toMatch(/^Vale preparar a abordagem\. Com quem falar: /);
    expect(how?.text).toContain('Para abrir: ');
    expect(answers.every((answer) => answer.known)).toBe(true);
  });

  it('sem nada gravado, diz o que falta em vez de preencher', () => {
    const answers = executiveSummary({
      claims: [],
      events: [],
      thesis: null,
      fallbackOffer: null,
      contactBlocked: false,
    });
    expect(answers.every((answer) => !answer.known)).toBe(true);
    expect(answers[0]?.text).toBe(
      'Ainda não sabemos: a análise não trouxe como a empresa se apresenta nem a atividade do cadastro.',
    );
    expect(answers[1]?.text).toBe('Nenhum acontecimento recente apareceu nas fontes consultadas.');
  });

  it('só com a Receita, diz a atividade e o que falta, sem afirmar a causa', () => {
    const [who] = executiveSummary({
      claims: [{ key: 'registry.cnae_main', statement: 'CNAE principal: 6201-5/01' }],
      events: [],
      thesis: null,
      fallbackOffer: 'Identidade visual',
      contactBlocked: false,
    });
    expect(who?.basis).toBe('registry');
    expect(who?.text).toBe(
      'CNAE principal: 6201-5/01. A análise ainda não trouxe como a empresa se apresenta.',
    );
  });

  it('marca inferência e ignora claim vencido ou contestado', () => {
    const [who] = executiveSummary({
      claims: [
        {
          key: 'positioning.value_proposition',
          statement: 'Promete entrega rápida',
          epistemicType: 'inference',
          status: 'disputed',
        },
        {
          key: 'positioning.segment',
          statement: 'Atende clínicas veterinárias.',
          epistemicType: 'inference',
          status: 'active',
        },
      ],
      events: [],
      thesis: null,
      fallbackOffer: null,
      contactBlocked: false,
    });
    expect(who?.text).toBe('Atende clínicas veterinárias (inferência).');
  });

  it('análise antiga sem tese usa o serviço recomendado e pede para atualizar', () => {
    const answers = executiveSummary({
      claims: CLAIMS,
      events: [],
      thesis: null,
      fallbackOffer: 'Identidade visual',
      contactBlocked: false,
    });
    expect(answers[3]).toMatchObject({
      text: 'Identidade visual (pela comparação com os serviços ativos).',
      basis: 'offers',
      known: true,
    });
    expect(answers[4]?.known).toBe(false);
  });

  it('não prioriza só com medições do site e diz o motivo', () => {
    const thesis = thesisFor([], true);
    expect(thesis.recommendation).toBe('deprioritize');
    const how = executiveSummary({
      claims: CLAIMS,
      events: [],
      thesis,
      fallbackOffer: null,
      contactBlocked: false,
    })[4];
    // Rótulo e motivo em frases separadas: nada de dois-pontos encadeados.
    expect(how?.text).toMatch(/^Não priorizar agora\. Só há detalhes técnicos do site/);
  });

  it('sem ângulo principal, o motivo aparece uma vez só (em "Por que")', () => {
    const thesis = buildCommercialThesis({
      profile: FOUND_STUDIO_PROFILE,
      companyName: 'Flash',
      events: [],
      siteSignals: [],
      contactKnown: false,
      now: NOW,
    });
    expect(thesis.principal).toBeNull();
    const [, , why, where, how] = executiveSummary({
      claims: CLAIMS,
      events: [],
      thesis,
      fallbackOffer: null,
      contactBlocked: false,
    });
    expect(why?.text).toBe(thesis.recommendationReason);
    expect(how?.text).toBe('Vale aprofundar a pesquisa antes.');
    expect(where?.text).toBe('Ainda sem base para dizer: nenhum acontecimento sustenta um ângulo.');
  });

  it('com pedido de não contato, nunca sugere abordar', () => {
    const how = executiveSummary({
      claims: CLAIMS,
      events: [FUNDING],
      thesis: thesisFor([FUNDING]),
      fallbackOffer: null,
      contactBlocked: true,
    })[4];
    expect(how?.text).toBe('Não abordar: a empresa pediu para não ser contatada.');
  });
});
