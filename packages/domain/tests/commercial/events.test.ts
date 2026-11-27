import { describe, expect, it } from 'vitest';
import {
  detectEventTypes,
  eventLeadQuote,
  extractCompanyFunding,
  extractFunding,
  formatBrlAmount,
  fundingQuotes,
  groupEventReports,
  isExplainerContent,
  reportTier,
  thirdPartyMention,
} from '../../src';
import { normalizeForQuote } from '../../src/evidence/quotes';

/**
 * Matéria SINTÉTICA no formato de uma notícia de rodada (caso obrigatório da Flash, Parte 2.3).
 * Os fatos de base (Série D, R$ 150 milhões, Battery Ventures e Kevin Efrusy, "não precisava de
 * dinheiro") são os da fonte real registrada no doc 15 §4; o texto é escrito aqui.
 */
const FLASH_TITLE = 'A Flash não precisava de dinheiro, mas levantou R$ 150 milhões';
const FLASH_TEXT = `${FLASH_TITLE}
A Flash, plataforma de benefícios e despesas corporativas, anunciou uma rodada Série D de R$ 150 milhões.
A rodada foi liderada pela Battery Ventures e por Kevin Efrusy, com participação dos fundos que já eram sócios.
Segundo o fundador, a empresa já era lucrativa e não precisava de dinheiro para operar.
A companhia não detalhou como o valor será aplicado.`;

describe('detectEventTypes', () => {
  it.each([
    ['Flash levanta R$ 150 milhões em Série D', 'funding'],
    ['Startup capta aporte de fundo americano', 'funding'],
    // Validação real do Flash (27/11): "levantar" no infinitivo não era reconhecido.
    ['Flash quer levantar R$ 200 milhões com fundos americanos', 'funding'],
    ['Fintech pode levantar até US$ 50 milhões neste ano', 'funding'],
    ['Grupo adquire rede de clínicas no Sul', 'acquisition'],
    ['Empresas anunciam fusão e criam gigante do setor', 'merger'],
    ['Marca chega ao México e mira América Latina', 'new_market'],
    ['Rede inaugura nova unidade em Campinas', 'expansion'],
    ['Fintech lança nova plataforma para PMEs', 'launch'],
    ['Empresa anuncia novo CTO vindo do Nubank', 'leadership'],
    ['Varejista anuncia reestruturação e demissões', 'restructuring'],
  ])('"%s" → %s', (text, type) => {
    expect(detectEventTypes(text)[0]).toBe(type);
  });

  it('texto sem acontecimento não vira sinal', () => {
    expect(detectEventTypes('Conheça os benefícios da Flash para sua equipe')).toEqual([]);
  });

  // KI-242 (títulos SINTÉTICOS no formato dos da validação da Flash, 27/11).
  it('"<empresa> investe R$" é a empresa gastando, não rodada que ela recebeu', () => {
    expect(
      detectEventTypes('Flash investe R$ 400 milhões em IA e novos produtos', ['flash']),
    ).not.toContain('funding');
    expect(detectEventTypes('Flash investe R$ 400 mi em IA')).not.toContain('funding');
  });

  it('"investe R$" conta quando quem recebe é a empresa ou quem investe é investidor', () => {
    expect(detectEventTypes('Fundo americano investe R$ 50 milhões na Flash', ['flash'])).toContain(
      'funding',
    );
    expect(detectEventTypes('SoftBank investe R$ 80 mi na Flash', ['flash'])).toContain('funding');
    expect(detectEventTypes('Gestora investe R$ 30 milhões em healthtech paulista')).toContain(
      'funding',
    );
  });

  it('rodada no mesmo título continua rodada, mesmo com "investe"', () => {
    expect(
      detectEventTypes('Flash capta R$ 400 milhões e investe R$ 100 mi em IA', ['flash']),
    ).toContain('funding');
  });
});

describe('isExplainerContent (validação da Salesforce, 27/11)', () => {
  it.each([
    ['O que é SaaS (Software como Serviço)? | Salesforce BR', 'https://www.salesforce.com/br/saas'],
    ['Guia completo de CRM para pequenas empresas', 'https://empresa.test/blog/crm'],
    ['Como funciona a gestão de benefícios', 'https://empresa.test/blog/beneficios'],
    ['7 dicas para lançar um produto digital', 'https://empresa.test/blog/lancar'],
    ['Entenda o que muda com a nova lei', 'https://empresa.test/noticia'],
    ['Plataforma de vendas', 'https://empresa.test/o-que-e/plataforma'],
    ['SaaS: vale a pena para a sua empresa?', 'https://empresa.test/artigo'],
  ])('"%s" é conteúdo, não acontecimento', (title, url) => {
    expect(isExplainerContent(title, url)).toBe(true);
  });

  it.each([
    ['Salesforce lança Agentforce no Brasil', 'https://neofeed.com.br/salesforce-lanca-agentforce'],
    ['A Flash não precisava de dinheiro, mas levantou R$ 150 milhões', 'https://neofeed.com.br/x'],
    ['Rede inaugura nova unidade em Campinas', 'https://empresa.test/noticias/campinas'],
  ])('"%s" continua sendo notícia', (title, url) => {
    expect(isExplainerContent(title, url)).toBe(false);
  });

  it('a página de conteúdo não entra no agrupamento de acontecimentos', () => {
    const groups = groupEventReports(
      [
        {
          url: 'https://www.salesforce.com/br/saas',
          title: 'O que é SaaS (Software como Serviço)? | Salesforce BR',
          snippet: 'A Salesforce apresenta o lançamento de ferramentas como o Agentforce.',
          publishedAt: null,
        },
      ],
      'salesforce.com.br',
      ['salesforce'],
    );
    expect(groups).toEqual([]);
  });
});

describe('a mesma rodada em veículos diferentes é um grupo só (KI-242)', () => {
  it('mesma Série D, títulos diferentes, sem o mesmo valor no título', () => {
    const groups = groupEventReports(
      [
        {
          url: 'https://neofeed.com.br/flash-serie-d',
          title: 'A Flash não precisava de dinheiro, mas levantou R$ 400 milhões',
          snippet: 'A Flash anunciou uma rodada Série D liderada por fundos americanos.',
          publishedAt: '2026-08-19',
        },
        {
          url: 'https://startups.com.br/flash-rodada',
          title: 'Flash conclui Série D e mira novos produtos',
          snippet: 'A plataforma de benefícios fechou a rodada Série D.',
          publishedAt: '2026-08-20',
        },
      ],
      null,
      ['flash'],
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]?.members).toHaveLength(2);
  });

  it('Série A e Série D da mesma empresa continuam separadas', () => {
    const groups = groupEventReports(
      [
        {
          url: 'https://neofeed.com.br/a',
          title: 'Flash capta Série A',
          snippet: 'Rodada Série A da Flash.',
          publishedAt: '2022-03-01',
        },
        {
          url: 'https://neofeed.com.br/d',
          title: 'Flash fecha Série D com fundos',
          snippet: 'Rodada Série D da Flash.',
          publishedAt: '2026-08-19',
        },
      ],
      null,
      ['flash'],
    );
    expect(groups).toHaveLength(2);
  });
});

describe('extractFunding (caso Flash)', () => {
  const details = extractFunding(FLASH_TEXT);

  it('lê valor, rodada, investidores e modalidade, cada um com trecho literal', () => {
    expect(details.amountCents).toBe(15_000_000_000);
    expect(details.amount?.text).toBe('R$ 150 milhões');
    expect(details.round?.text).toBe('Série D');
    expect(details.investors.map((item) => item.text)).toEqual([
      'Battery Ventures',
      'Kevin Efrusy',
    ]);
    expect(details.modality).toBe('equity');
  });

  it('quem dirige a empresa não vira investidor ("a startup liderada por")', () => {
    // Validação real da Flash (27/11), texto SINTÉTICO no mesmo formato.
    const led = extractFunding(
      'Em uma fase de maturidade operacional, a startup liderada por Fulano Exemplo e pelos irmãos Beltrano mira a liderança do setor. A rodada foi liderada pela Fundo Exemplo Ventures.',
    );
    expect(led.investors.map((item) => item.text)).toEqual(['Fundo Exemplo Ventures']);
  });

  it('sem finalidade declarada, a destinação fica desconhecida (investimento não é orçamento)', () => {
    expect(details.purpose).toEqual({ status: 'unknown' });
  });

  it('guarda o contexto anterior: "não precisava de dinheiro"', () => {
    expect(details.context?.text.toLowerCase()).toContain('não precisava de dinheiro');
  });

  it('todo trecho citado existe no texto da fonte (o ledger confere)', () => {
    const source = normalizeForQuote(FLASH_TEXT);
    for (const quote of fundingQuotes(details)) {
      expect(source.includes(normalizeForQuote(quote))).toBe(true);
    }
  });

  it('finalidade declarada vem com o trecho', () => {
    const declared = extractFunding(
      'A Acme captou R$ 20 milhões em rodada seed. Os recursos serão usados para expandir o time de produto e lançar o aplicativo.',
    );
    expect(declared.purpose.status).toBe('declared');
    if (declared.purpose.status === 'declared') {
      expect(declared.purpose.value.quote).toContain('Os recursos serão usados para expandir');
    }
    expect(declared.round?.text).toBe('Seed');
  });

  it('dívida e crédito não viram rodada de participação', () => {
    expect(extractFunding('A empresa emitiu R$ 300 milhões em debêntures.').modality).toBe('debt');
    expect(
      extractFunding('O banco aprovou financiamento de R$ 40 milhões para a nova fábrica.')
        .modality,
    ).toBe('credit');
  });

  it('preço pequeno não é valor de rodada', () => {
    expect(extractFunding('O plano custa R$ 49 por mês.').amount).toBeNull();
  });

  it('formata o valor em reais', () => {
    expect(formatBrlAmount(15_000_000_000)).toBe('R$ 150 milhões');
    expect(formatBrlAmount(150_000_000_000)).toBe('R$ 1,5 bilhões');
  });
});

describe('extractCompanyFunding (só o que fala da empresa)', () => {
  const page = `Leia também: Outra Empresa capta R$ 500 milhões em Série E liderada pela Fundo Vizinho.
${FLASH_TEXT.split('\n').slice(1).join('\n')}`;

  it('valor e rodada de frases que citam a empresa, não da chamada de outra matéria', () => {
    const details = extractCompanyFunding(FLASH_TITLE, page, ['flash']);
    expect(details.amountCents).toBe(15_000_000_000);
    expect(details.round?.text).toBe('Série D');
    expect(details.investors.map((item) => item.text)).toEqual([
      'Battery Ventures',
      'Kevin Efrusy',
    ]);
    expect(details.context?.text).toBe('já era lucrativa');
    expect(details.context?.quote).toContain('não precisava de dinheiro');
  });

  it('sem frase sobre a empresa com valor, o valor fica em branco (nada de emprestar o de outra)', () => {
    const details = extractCompanyFunding(
      'Flash anuncia novidades',
      'Leia também: Outra Empresa capta R$ 500 milhões. A Flash lançou um aplicativo.',
      ['flash'],
    );
    expect(details.amount).toBeNull();
    expect(details.amountCents).toBeNull();
  });

  it('todo trecho citado existe na página (o ledger confere)', () => {
    const source = normalizeForQuote(`${FLASH_TITLE}\n${page}`);
    for (const quote of fundingQuotes(extractCompanyFunding(FLASH_TITLE, page, ['flash']))) {
      expect(source.includes(normalizeForQuote(quote))).toBe(true);
    }
  });
});

describe('fontes e republicações (Partes 3.2 e 3.3)', () => {
  it('hierarquia: site da empresa, imprensa reconhecida, outras', () => {
    expect(reportTier('https://www.flashapp.com.br/blog/serie-d', 'flashapp.com.br')).toBe(
      'official',
    );
    expect(reportTier('https://neofeed.com.br/startups/flash', 'flashapp.com.br')).toBe(
      'recognized_press',
    );
    expect(reportTier('https://blog-qualquer.test/flash', 'flashapp.com.br')).toBe('other');
  });

  it('republicação não conta como confirmação; apuração própria conta', () => {
    const groups = groupEventReports(
      [
        {
          url: 'https://agregador.test/noticia',
          title: 'A Flash não precisava de dinheiro, mas levantou R$ 150 milhões',
          snippet: 'Segundo o NeoFeed, a rodada foi liderada pela Battery.',
          publishedAt: '2026-08-20',
        },
        {
          url: 'https://neofeed.com.br/startups/flash-serie-d',
          title: 'A Flash não precisava de dinheiro, mas levantou R$ 150 milhões',
          snippet: 'Rodada Série D liderada pela Battery Ventures.',
          publishedAt: '2026-08-19',
        },
        {
          url: 'https://braziljournal.com/flash-capta',
          title: 'Flash capta R$ 150 mi com Battery para crescer em despesas',
          snippet: 'A empresa de benefícios fechou nova rodada.',
          publishedAt: '2026-08-21',
        },
        {
          url: 'https://outra.test/vagas',
          title: 'Flash abre vagas de engenharia',
          snippet: 'Processo seletivo aberto.',
          publishedAt: '2026-09-01',
        },
      ],
      'flashapp.com.br',
    );
    const funding = groups.find((group) => group.type === 'funding');
    expect(funding?.origin.url).toBe('https://neofeed.com.br/startups/flash-serie-d');
    expect(funding?.originTier).toBe('recognized_press');
    expect(funding?.republishedBy).toEqual(['agregador.test']);
    expect(funding?.confirmedBy).toEqual(['braziljournal.com']);
    expect(groups.find((group) => group.type === 'hiring')?.members).toHaveLength(1);
  });
});

describe('checagem de entidade: o acontecimento é da empresa (27/11)', () => {
  it('empresa citada só como cliente ou concorrente não recebe o acontecimento de outra', () => {
    expect(thirdPartyMention('a xyz, concorrente da flash, captou r$ 100 milhoes', ['flash'])).toBe(
      true,
    );
    expect(
      thirdPartyMention('startup que tem como cliente a flash capta r$ 20 mi', ['flash']),
    ).toBe(true);
    expect(thirdPartyMention('a flash captou r$ 400 milhoes em serie d', ['flash'])).toBe(false);
  });

  it('a frase principal da evidência não é a que cita a empresa como terceira', () => {
    const text = [
      'A XYZ, concorrente da Flash, captou R$ 100 milhões nesta semana.',
      'O mercado de benefícios segue aquecido.',
    ].join(' ');
    expect(eventLeadQuote(text, ['flash'], 'funding')).toBeNull();
  });

  it('resultado de busca que fala de outra empresa não vira grupo de acontecimento', () => {
    const groups = groupEventReports(
      [
        {
          url: 'https://neofeed.com.br/xyz',
          title: 'XYZ, rival da Flash, levanta R$ 100 milhões',
          snippet: 'A rodada da XYZ foi liderada por fundos.',
          publishedAt: '2026-10-01',
        },
      ],
      null,
      ['flash'],
    );
    expect(groups).toEqual([]);
  });
});
