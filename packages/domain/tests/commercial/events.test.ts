import { describe, expect, it } from 'vitest';
import {
  detectEventTypes,
  extractCompanyFunding,
  extractFunding,
  formatBrlAmount,
  fundingQuotes,
  groupEventReports,
  reportTier,
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
