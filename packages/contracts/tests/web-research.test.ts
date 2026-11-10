import { describe, expect, it } from 'vitest';
import {
  PAGE_READ_MESSAGES,
  PageReadFailure,
  PageReadOutcome,
  TAVILY_FREE_MONTHLY_CREDITS,
  WEB_RESEARCH_ENV_FORMATS,
  WEB_SEARCH_MESSAGES,
  WebDomain,
  WebPage,
  WebResearchEnv,
  WebSearchFailure,
  WebSearchOutcome,
  WebSearchQuery,
  WebSearchRequest,
  WebSearchResult,
  findPersonalData,
  redactPersonalData,
  webHostRestriction,
} from '../src';

const HASH = 'a'.repeat(64);

describe('consulta de busca', () => {
  it('aceita segmento, cidade e CNPJ', () => {
    expect(WebSearchQuery.parse('  clínicas odontológicas Ribeirão Preto  ')).toBe(
      'clínicas odontológicas Ribeirão Preto',
    );
    expect(WebSearchQuery.safeParse('CNPJ 11.222.333/0001-81 site oficial').success).toBe(true);
    expect(WebSearchQuery.safeParse('padaria Campinas CEP 13010-000').success).toBe(true);
  });

  it('recusa e-mail, CPF e telefone (dados pessoais não vão para o buscador)', () => {
    expect(findPersonalData('contato fulano@exemplo.com.br')).toBe('email');
    expect(findPersonalData('cpf 123.456.789-09')).toBe('document_or_phone');
    expect(findPersonalData('12345678909')).toBe('document_or_phone');
    expect(findPersonalData('(20) 99123-4567 dentista')).toBe('document_or_phone');
    expect(findPersonalData('+55 20 3610 1234')).toBe('document_or_phone');
    expect(findPersonalData('20993652147 whatsapp')).toBe('document_or_phone');
    expect(findPersonalData('11222333000181')).toBeNull();
    expect(findPersonalData('11.222.333/0001-81')).toBeNull();
    expect(findPersonalData('agência de branding 2026')).toBeNull();
    expect(findPersonalData('desde 2010 2015 2020, CEP 14020-260')).toBeNull();
    const result = WebSearchQuery.safeParse('dentista (20) 99123-4567');
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toMatch(/CPF ou telefone/);
  });

  it('mascara dado pessoal no texto que vem da internet', () => {
    expect(
      redactPersonalData(
        'Rua Exemplo, 804 - Centro (20) 99365-2147, contato@clinica.test, CPF 123.456.789-09, CNPJ 11.222.333/0001-81, desde 2015.',
      ),
    ).toBe(
      'Rua Exemplo, 804 - Centro [telefone omitido], [e-mail omitido], CPF [documento omitido], CNPJ 11.222.333/0001-81, desde 2015.',
    );
    expect(redactPersonalData('WhatsApp: +55 20 99493-1234')).toBe('WhatsApp: [telefone omitido]');
  });

  it('celular com o 9 separado e CPF parcial dos agregadores também são dado pessoal', () => {
    expect(findPersonalData('(20) 9 9876-5432')).toBe('document_or_phone');
    expect(findPersonalData('20 9 9876 5432')).toBe('document_or_phone');
    expect(findPersonalData('sócio ***.456.789-**')).toBe('document_or_phone');
    expect(redactPersonalData('Celular (20) 9 9876-5432')).toBe('Celular [telefone omitido]');
    expect(redactPersonalData('Sócio: FULANO EXEMPLO (***.456.789-**)')).toBe(
      'Sócio: FULANO EXEMPLO ([documento omitido])',
    );
    expect(redactPersonalData('CNPJ 11.222.333/0001-81')).toBe('CNPJ 11.222.333/0001-81');
  });

  it('hosts que o Prospector não lê nem guarda', () => {
    expect(webHostRestriction('br.linkedin.com')).toBe('terms');
    expect(webHostRestriction('www.threads.com')).toBe('terms');
    expect(webHostRestriction('m.youtube.com')).toBe('terms');
    expect(webHostRestriction('maps.googleapis.com')).toBe('terms');
    expect(webHostRestriction('cnpj.biz')).toBe('minimization');
    expect(webHostRestriction('www.casadosdados.com.br.')).toBe('minimization');
    expect(webHostRestriction('notlinkedin.com')).toBeNull();
    expect(webHostRestriction('ajax.googleapis.com')).toBeNull();
    expect(webHostRestriction('empresa.example.com')).toBeNull();
  });

  it('limita tamanho', () => {
    expect(WebSearchQuery.safeParse('ab').success).toBe(false);
    expect(WebSearchQuery.safeParse('a'.repeat(301)).success).toBe(false);
  });

  it('preenche padrões: 5 resultados, tema geral, preferência pelo Brasil', () => {
    expect(WebSearchRequest.parse({ query: 'padarias Campinas' })).toEqual({
      query: 'padarias Campinas',
      maxResults: 5,
      topic: 'general',
      region: 'br',
      timeRange: null,
      includeDomains: [],
      excludeDomains: [],
    });
    expect(WebSearchRequest.safeParse({ query: 'padarias', maxResults: 11 }).success).toBe(false);
  });

  it('domínios só como domínio', () => {
    expect(WebDomain.parse(' Exemplo.COM.br ')).toBe('exemplo.com.br');
    expect(WebDomain.safeParse('https://exemplo.com.br').success).toBe(false);
    expect(WebDomain.safeParse('exemplo.com.br/pagina').success).toBe(false);
    expect(WebDomain.safeParse('localhost').success).toBe(false);
  });
});

describe('resultado e desfecho', () => {
  it('resultado exige URL http(s) e título', () => {
    const ok = WebSearchResult.parse({
      rank: 1,
      url: 'https://exemplo.com.br/sobre',
      title: 'Sobre nós',
      snippet: 'Clínica fundada em 2010.',
    });
    expect(ok.publishedAt).toBeNull();
    expect(ok.score).toBeNull();
    expect(
      WebSearchResult.safeParse({ rank: 1, url: 'ftp://x.com', title: 'x', snippet: '' }).success,
    ).toBe(false);
    expect(
      WebSearchResult.safeParse({ rank: 1, url: 'javascript:alert(1)', title: 'x', snippet: '' })
        .success,
    ).toBe(false);
  });

  it('toda falha tem mensagem em pt-BR', () => {
    for (const failure of WebSearchFailure.options) {
      expect(WEB_SEARCH_MESSAGES[failure].length).toBeGreaterThan(20);
    }
    for (const failure of PageReadFailure.options) {
      expect(PAGE_READ_MESSAGES[failure].length).toBeGreaterThan(20);
    }
  });

  it('desfecho de falha não carrega resultados', () => {
    const failed = WebSearchOutcome.parse({
      ok: false,
      failure: 'budget_exhausted',
      message: WEB_SEARCH_MESSAGES.budget_exhausted,
      provider: null,
    });
    expect(failed).not.toHaveProperty('results');
    expect(failed.ok === false && failed.retryAfterSeconds).toBeNull();
  });

  it('página lida guarda texto, hash e endereço final', () => {
    const page = WebPage.parse({
      schemaVersion: 1,
      requestedUrl: 'http://exemplo.com.br',
      url: 'https://www.exemplo.com.br/',
      httpStatus: 200,
      contentType: 'text/html',
      title: 'Exemplo',
      description: null,
      lang: 'pt-BR',
      text: 'Bem-vindo',
      truncated: false,
      contentHash: HASH,
      fetchedAt: '2026-11-10T12:00:00.000Z',
      renderer: 'browser',
    });
    expect(PageReadOutcome.parse({ ok: true, page, fromCache: false }).ok).toBe(true);
    expect(WebPage.safeParse({ ...page, contentHash: 'abc' }).success).toBe(false);
  });
});

describe('variáveis de ambiente', () => {
  it('padrões seguros: abaixo da cota gratuita, concorrência baixa', () => {
    expect(WebResearchEnv.parse({})).toEqual({
      WEB_SEARCH_MONTHLY_CREDITS: 900,
      WEB_SEARCH_MAX_CONCURRENCY: 2,
      WEB_SEARCH_CACHE_HOURS: 24,
      PAGE_READER_MAX_CONCURRENCY: 1,
    });
  });

  it('não deixa o orçamento passar da cota gratuita', () => {
    expect(
      WebResearchEnv.safeParse({ WEB_SEARCH_MONTHLY_CREDITS: String(TAVILY_FREE_MONTHLY_CREDITS) })
        .success,
    ).toBe(true);
    expect(WebResearchEnv.safeParse({ WEB_SEARCH_MONTHLY_CREDITS: '1001' }).success).toBe(false);
    expect(WebResearchEnv.safeParse({ PROSPECTOR_WEB_SEARCH: 'yes' }).success).toBe(false);
  });

  it('descreve o formato de cada variável', () => {
    expect(Object.keys(WEB_RESEARCH_ENV_FORMATS).sort()).toEqual(
      Object.keys(WebResearchEnv.shape).sort(),
    );
  });
});

describe('máscara de dados pessoais com texto hostil', () => {
  it('3 MiB sem "@" terminam em menos de 1 s e o e-mail ainda é achado', () => {
    const started = performance.now();
    redactPersonalData('a'.repeat(3 * 1024 * 1024));
    redactPersonalData('a.'.repeat(1024 * 1024));
    expect(performance.now() - started).toBeLessThan(1000);
    expect(redactPersonalData('fale com vendas.sul+br@empresa.example.com.br hoje')).toBe(
      'fale com [e-mail omitido] hoje',
    );
  });
});
