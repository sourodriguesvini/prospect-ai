import type { ClaimView } from '@prospector/application';
import type { BusinessEvent } from '@prospector/contracts';
import { buildCommercialThesis, executiveSummary, FOUND_STUDIO_PROFILE } from '@prospector/domain';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ExecutiveSummaryList, OrganizationPanel, ProductTechnologyPanel } from './report-panels';
import { eventEvidenceOf } from './timeline-section';

/** Dados SINTÉTICOS (Parte 7): conferem o que a página mostra, sem banco e sem IA. */
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
  funding: {
    amountCents: 15_000_000_000,
    amount: { text: 'R$ 150 milhões', quote: 'rodada Série D de R$ 150 milhões' },
    round: { text: 'Série D', quote: 'rodada Série D de R$ 150 milhões' },
    investors: [],
    modality: 'equity',
    purpose: {
      status: 'declared',
      value: { text: 'novos produtos', quote: 'o dinheiro vai para novos produtos' },
    },
    context: null,
  },
});
const LEADERSHIP = event({
  type: 'leadership',
  occurredOn: '2026-06',
  headline: 'Exemplo Benefícios anuncia nova diretora de produto',
  host: 'blog.test',
  url: 'https://blog.test/nova-diretora',
  sourceTier: 'other',
});

/** ClaimView completo o bastante para o cartão de claim (sem fonte). */
function view(
  n: number,
  key: string,
  statement: string,
  epistemicType: 'fact' | 'inference' | 'hypothesis' = 'fact',
  value: object = {},
): ClaimView {
  return {
    claim: {
      id: id(n),
      key,
      statement,
      epistemicType,
      value,
      confidence: null,
      reasoning: null,
      validUntil: null,
      isDemo: true,
    },
    status: 'active',
    band: 'medium',
    evidence: [],
    dependsOn: [],
  } as unknown as ClaimView;
}

const VIEWS: ClaimView[] = [
  view(
    1,
    'positioning.value_proposition',
    'Benefícios flexíveis para empresas de todos os portes',
    'inference',
  ),
  view(2, 'positioning.offering.cartao_de_beneficios', 'O site oferece: cartão de benefícios.'),
  view(3, 'registry.size', 'Porte: demais'),
  view(4, 'registry.legal_nature', 'Natureza jurídica: sociedade anônima fechada'),
  view(5, 'signal.web.funding_exemplo', FUNDING.headline, 'fact', { event: FUNDING }),
  view(6, 'signal.web.leadership_exemplo', LEADERSHIP.headline, 'hypothesis', {
    event: LEADERSHIP,
  }),
];

const THESIS = buildCommercialThesis({
  profile: FOUND_STUDIO_PROFILE,
  companyName: 'Exemplo Benefícios',
  events: eventEvidenceOf(VIEWS),
  siteSignals: [],
  contactKnown: false,
  now: NOW,
});

describe('Resumo executivo no topo da página da empresa', () => {
  const answers = executiveSummary({
    claims: VIEWS.map((item) => ({ key: item.claim.key, statement: item.claim.statement })),
    events: eventEvidenceOf(VIEWS),
    thesis: THESIS,
    fallbackOffer: null,
    contactBlocked: false,
  });
  const html = renderToStaticMarkup(createElement(ExecutiveSummaryList, { answers }));

  it('mostra as cinco perguntas como lista de definições, com o caminho para cada seção', () => {
    for (const question of [
      'Quem é a empresa?',
      'O que está acontecendo?',
      'Por que ela merece atenção?',
      'Onde podemos contribuir?',
      'Qual é a melhor abordagem?',
    ]) {
      expect(html).toContain(`<dt class="text-xs text-muted-foreground">${question}</dt>`);
    }
    expect(html).toContain('aria-labelledby="resumo-executivo"');
    expect(html).toContain('href="#linha-do-tempo"');
    expect(html).toContain('href="#tese-comercial"');
    expect(html).toContain('href="#mercado"');
  });
});

describe('Produto e tecnologia (Parte 7, seção 6)', () => {
  it('mostra o que o site oferece e a rodada com destino declarado em produto', () => {
    const html = renderToStaticMarkup(
      createElement(ProductTechnologyPanel, { views: VIEWS, analyzed: true }),
    );
    expect(html).toContain('Produto e tecnologia');
    expect(html).toContain('O site oferece: cartão de benefícios.');
    expect(html).toContain('Destino declarado na fonte: novos produtos');
    expect(html).toContain('(abre em outra aba)');
    expect(html).not.toContain('nova diretora');
  });

  it('com análise e sem dado, diz o que falta; sem análise, não aparece', () => {
    const empty = renderToStaticMarkup(
      createElement(ProductTechnologyPanel, { views: [], analyzed: true }),
    );
    expect(empty).toContain('O site não mostrou produtos ou serviços de forma clara');
    expect(
      renderToStaticMarkup(createElement(ProductTechnologyPanel, { views: [], analyzed: false })),
    ).toBe('');
  });
});

describe('Estrutura organizacional (Parte 7, seção 8)', () => {
  it('mostra a Receita, a mudança de liderança como hipótese e o papel a procurar', () => {
    const html = renderToStaticMarkup(
      createElement(OrganizationPanel, { views: VIEWS, thesis: THESIS, analyzed: true }),
    );
    expect(html).toContain('Estrutura organizacional');
    expect(html.indexOf('Natureza jurídica')).toBeLessThan(html.indexOf('Porte: demais'));
    expect(html).toContain('nova diretora de produto');
    expect(html).toContain('Hipótese');
    expect(html).toContain('A análise não monta lista de pessoas');
    expect(html).toContain(`Papel a procurar, pela tese: ${THESIS.principal!.approachRole}.`);
  });

  it('com pedido de não contato, não sugere papel a procurar', () => {
    const html = renderToStaticMarkup(
      createElement(OrganizationPanel, {
        views: VIEWS,
        thesis: THESIS,
        analyzed: true,
        contactBlocked: true,
      }),
    );
    expect(html).toContain('Não abordar: a empresa pediu para não ser contatada.');
    expect(html).not.toContain('Papel a procurar');
  });

  it('sem Receita, aponta a consulta do CNPJ', () => {
    const html = renderToStaticMarkup(
      createElement(OrganizationPanel, { views: [], thesis: null, analyzed: true }),
    );
    expect(html).toContain('Sem dados da Receita');
    expect(html).toContain('href="#receita"');
  });
});
