import type { ClaimView } from '@prospector/application';
import type { BusinessEvent } from '@prospector/contracts';
import { buildCommercialThesis, FOUND_STUDIO_PROFILE } from '@prospector/domain';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ThesisSection } from './thesis-section';
import { TimelineSection } from './timeline-section';

/** Dados SINTÉTICOS (Parte 8, Caso 1): conferem o que a página mostra, sem banco e sem IA. */
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

const FUNDING = event({
  type: 'funding',
  headline: 'Exemplo Benefícios levanta R$ 150 milhões em Série D',
  confirmedBy: ['braziljournal.com'],
  funding: {
    amountCents: 15_000_000_000,
    amount: { text: 'R$ 150 milhões', quote: 'rodada Série D de R$ 150 milhões' },
    round: { text: 'Série D', quote: 'rodada Série D de R$ 150 milhões' },
    investors: [],
    modality: 'equity',
    purpose: { status: 'unknown' },
    context: null,
  },
});

/** Só o que os componentes leem de um claim (id, chave, tipo e valor). */
function view(n: number, key: string, epistemicType: 'fact' | 'hypothesis', value: object) {
  return { claim: { id: id(n), key, epistemicType, value } } as unknown as ClaimView;
}

describe('Tese comercial na página da empresa', () => {
  const thesis = buildCommercialThesis({
    profile: FOUND_STUDIO_PROFILE,
    companyName: 'Exemplo Benefícios',
    events: [{ claimId: id(1), epistemicType: 'fact', event: FUNDING }],
    siteSignals: [
      { signal: 'site_accessibility', claimIds: [id(9)], detail: '24 textos com contraste baixo' },
    ],
    contactKnown: false,
    now: NOW,
  });
  const html = renderToStaticMarkup(createElement(ThesisSection, { thesis, views: [] }));

  it('mostra recomendação, ângulo com título navegável e as seis dimensões', () => {
    expect(html).toContain('Tese comercial');
    expect(html).toMatch(/<h4[^>]*>[^<]+<\/h4>/);
    expect(html).toContain('Acesso a quem decide');
    expect(html).toContain('O que não oferecer');
    expect(html).toContain('Abrir pela auditoria do site');
  });

  it('avisa quando as evidências do ângulo foram substituídas por uma coleta mais nova', () => {
    expect(html).toContain('As evidências disto foram substituídas');
  });
});

describe('Linha do tempo na página da empresa', () => {
  const views = [
    view(1, 'signal.web.funding_neofeed_com_br_exemplo', 'fact', { event: FUNDING }),
    // A mesma rodada gravada noutra análise, a partir de um título de busca: aparece uma vez.
    view(2, 'signal.web.funding_blog_test_exemplo', 'hypothesis', {
      event: event({
        type: 'funding',
        headline: 'Exemplo capta R$ 150 mi',
        host: 'blog.test',
        pageRead: false,
        funding: FUNDING.funding,
      }),
    }),
    view(3, 'signal.web.launch_exame_com_exemplo', 'fact', {
      event: event({
        type: 'launch',
        occurredOn: '2026-10-02',
        headline: 'Exemplo lança cartão corporativo',
        url: 'javascript:alert(1)',
        host: 'exame.com',
      }),
    }),
    view(4, 'signal.web.award_x', 'hypothesis', {
      event: event({ type: 'award', occurredOn: null, dateBasis: 'unknown', headline: 'Prêmio' }),
    }),
    view(5, 'positioning.region', 'fact', { label: 'Sul' }),
  ];
  const html = renderToStaticMarkup(createElement(TimelineSection, { views }));

  it('ordena por data, sem duplicar a mesma rodada, e deixa o sem data por último', () => {
    const order = ['R$ 150 milhões em Série D', 'cartão corporativo', 'Prêmio'].map((text) =>
      html.indexOf(text),
    );
    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(html).not.toContain('Exemplo capta R$ 150 mi');
    expect(html).toContain('Sem data');
    expect(html).toContain('confirmado por outra fonte');
  });

  it('lê a sequência investimento → lançamento e não transforma endereço perigoso em link', () => {
    expect(html).toContain('seguido de lançamento');
    expect(html).not.toContain('javascript:');
    expect(html).toContain('rel="noreferrer noopener"');
  });

  it('sem acontecimento gravado, a seção não aparece', () => {
    expect(
      renderToStaticMarkup(createElement(TimelineSection, { views: [views[4] as ClaimView] })),
    ).toBe('');
  });
});
