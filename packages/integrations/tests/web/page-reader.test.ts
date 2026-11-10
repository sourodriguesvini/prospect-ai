import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  createPageReader,
  isRestrictedHost,
  subresourceFetcher,
  type BrowserRenderer,
} from '../../src';
import { PUBLIC_IP, fakeResolver, fakeTransport, html, redirect, reply } from './net-fakes';

const resolver = fakeResolver({
  'empresa.example.com': [PUBLIC_IP],
  'www.empresa.example.com': [PUBLIC_IP],
  'parceiro.example.org': ['151.101.1.1'],
  'interno.example.com': ['10.0.0.5'],
  'www.instagram.com': ['157.240.1.1'],
  'cdn.example.net': ['151.101.1.2'],
});

const ROBOTS_OPEN = reply(404);
const now = () => new Date('2026-11-10T15:00:00.000Z');

function reader(routes: Parameters<typeof fakeTransport>[0], extra: Record<string, unknown> = {}) {
  const net = fakeTransport(routes);
  const pages = createPageReader({
    resolver,
    transport: net.transport,
    renderer: 'http',
    now,
    log: () => undefined,
    ...extra,
  });
  return { pages, net };
}

const PAGE = `<html lang="pt-BR"><head><title>Empresa Exemplo</title>
<meta name="description" content="Fábrica de revestimentos"></head>
<body><h1>Quem somos</h1><p>Fale com a gente: (20) 3333-4444 ou vendas@empresa.example.com.</p>
<p>CNPJ 12.345.678/0001-95, desde 1990.</p></body></html>`;

describe('createPageReader', () => {
  it('lê a página: texto limpo, dados pessoais mascarados, hash e metadados', async () => {
    const { pages, net } = reader({
      'https://empresa.example.com/robots.txt': ROBOTS_OPEN,
      'https://empresa.example.com/sobre': html(PAGE),
    });
    const result = await pages.fetchPage('https://empresa.example.com/sobre#topo');
    if (!result.ok) throw new Error(`esperava sucesso: ${result.failure}`);
    const { page } = result;
    expect(page).toMatchObject({
      schemaVersion: 1,
      requestedUrl: 'https://empresa.example.com/sobre',
      url: 'https://empresa.example.com/sobre',
      httpStatus: 200,
      contentType: 'text/html',
      title: 'Empresa Exemplo',
      description: 'Fábrica de revestimentos',
      lang: 'pt-BR',
      truncated: false,
      fetchedAt: '2026-11-10T15:00:00.000Z',
      renderer: 'http',
    });
    expect(page.text).toContain('Quem somos');
    expect(page.text).toContain('[telefone omitido]');
    expect(page.text).toContain('[e-mail omitido]');
    // CNPJ é dado da empresa, não pessoal: fica.
    expect(page.text).toContain('12.345.678/0001-95');
    expect(page.text).not.toMatch(/3333-4444|vendas@/);
    expect(page.contentHash).toBe(createHash('sha256').update(page.text, 'utf8').digest('hex'));
    expect(net.urls()).toEqual([
      'https://empresa.example.com/robots.txt',
      'https://empresa.example.com/sobre',
    ]);
  });

  it('endereço interno, esquema estranho ou porta fora do padrão: nem pede', async () => {
    const { pages, net } = reader({});
    for (const url of [
      'http://127.0.0.1/',
      'http://169.254.169.254/latest/meta-data/',
      'file:///C:/Windows/win.ini',
      'http://empresa.example.com:8080/',
      'http://localhost:3000/',
    ]) {
      expect(await pages.fetchPage(url)).toEqual({
        ok: false,
        failure: 'blocked_address',
        httpStatus: null,
      });
    }
    expect(await pages.fetchPage('https://interno.example.com/')).toMatchObject({
      ok: false,
      failure: 'blocked_address',
    });
    expect(await pages.fetchPage('https://sem-dns.example.com/')).toMatchObject({
      ok: false,
      failure: 'unavailable',
    });
    // Nada saiu: nem a página nem o robots.txt.
    expect(net.calls).toHaveLength(0);
  });

  it('rede social e mapas: recusa pelos termos, sem pedir nada', async () => {
    const { pages, net } = reader({});
    expect(await pages.fetchPage('https://www.instagram.com/perfil.example/')).toEqual({
      ok: false,
      failure: 'restricted_site',
      httpStatus: null,
    });
    expect(net.calls).toHaveLength(0);
    expect(isRestrictedHost(new URL('https://br.linkedin.com/company/x'))).toBe(true);
    expect(isRestrictedHost(new URL('https://maps.google.com/?q=x'))).toBe(true);
    expect(isRestrictedHost(new URL('https://notlinkedin.com/'))).toBe(false);
  });

  it('agregador de CNPJ (sócios, CPF parcial) e outras redes: recusa sem pedir nada', async () => {
    const { pages, net } = reader({});
    for (const url of [
      'https://cnpj.biz/11222333000181',
      'https://www.casadosdados.com.br/solucao/cnpj/x',
      'https://www.threads.com/@perfil.example',
      'https://www.youtube.com/watch?v=x',
      'https://wa.me/5520999999999',
    ]) {
      expect(await pages.fetchPage(url)).toMatchObject({ failure: 'restricted_site' });
    }
    expect(net.calls).toHaveLength(0);
  });

  it('sub-recursos: widget de rede social e scripts do Maps nem são pedidos', async () => {
    const net = fakeTransport({
      'https://cdn.example.net/app.js': reply(200, 'console.log(1)', {
        'content-type': 'application/javascript',
      }),
    });
    const fetchResource = subresourceFetcher({
      resolver,
      transport: net.transport,
      timeoutMs: 2000,
    });
    expect(await fetchResource('https://www.instagram.com/embed.js')).toBeNull();
    expect(await fetchResource('https://maps.googleapis.com/maps/api/js?key=x')).toBeNull();
    expect(await fetchResource('https://connect.facebook.net/pt_BR/sdk.js')).toBeNull();
    expect(await fetchResource('http://169.254.169.254/latest/meta-data/')).toBeNull();
    expect(await fetchResource('não é url')).toBeNull();
    expect(net.calls).toHaveLength(0);
    const script = await fetchResource('https://cdn.example.net/app.js');
    expect(script?.status).toBe(200);
    expect(net.urls()).toEqual(['https://cdn.example.net/app.js']);
  });

  it('noarchive, none ou reserva de mineração: lê, mas marca para não guardar cópia', async () => {
    const cases: Array<[string, ReturnType<typeof html>]> = [
      ['/a', html(PAGE, { 'x-robots-tag': 'noarchive' })],
      ['/b', html('<meta name="robots" content="none"><p>x</p>')],
      ['/c', html('<meta name="tdm-reservation" content="1"><p>x</p>')],
      ['/d', html(PAGE, { 'tdm-reservation': '1' })],
      ['/e', html(PAGE)],
    ];
    const { pages } = reader({
      'https://empresa.example.com/robots.txt': ROBOTS_OPEN,
      ...Object.fromEntries(
        cases.map(([path, route]) => [`https://empresa.example.com${path}`, route]),
      ),
    });
    const flags = [];
    for (const [path] of cases) {
      const result = await pages.fetchPage(`https://empresa.example.com${path}`);
      flags.push(result.ok && result.page.noArchive);
    }
    expect(flags).toEqual([true, true, true, true, false]);
  });

  it('robots.txt proíbe: não lê a página', async () => {
    const { pages, net } = reader({
      'https://empresa.example.com/robots.txt': reply(200, 'User-agent: prospector\nDisallow: /'),
      'https://empresa.example.com/': html(PAGE),
    });
    expect(await pages.fetchPage('https://empresa.example.com/')).toMatchObject({
      ok: false,
      failure: 'robots_disallowed',
    });
    expect(net.urls()).toEqual(['https://empresa.example.com/robots.txt']);
  });

  it('robots.txt inacessível (5xx) = proibido', async () => {
    const { pages } = reader({ 'https://empresa.example.com/robots.txt': reply(500) });
    expect(await pages.fetchPage('https://empresa.example.com/')).toMatchObject({
      failure: 'robots_disallowed',
    });
  });

  it('redirecionamento confere o robots.txt e os termos do destino', async () => {
    const proibido = reader({
      'https://empresa.example.com/robots.txt': ROBOTS_OPEN,
      'https://empresa.example.com/': redirect('https://parceiro.example.org/vitrine'),
      'https://parceiro.example.org/robots.txt': reply(200, 'User-agent: *\nDisallow: /vitrine'),
    });
    expect(await proibido.pages.fetchPage('https://empresa.example.com/')).toMatchObject({
      failure: 'robots_disallowed',
    });
    expect(proibido.net.urls()).not.toContain('https://parceiro.example.org/vitrine');

    const social = reader({
      'https://empresa.example.com/robots.txt': ROBOTS_OPEN,
      'https://empresa.example.com/': redirect('https://www.instagram.com/empresa/'),
    });
    expect(await social.pages.fetchPage('https://empresa.example.com/')).toMatchObject({
      failure: 'restricted_site',
    });

    const interno = reader({
      'https://empresa.example.com/robots.txt': ROBOTS_OPEN,
      'https://empresa.example.com/': redirect('http://10.0.0.1/admin'),
    });
    expect(await interno.pages.fetchPage('https://empresa.example.com/')).toMatchObject({
      failure: 'blocked_address',
    });

    const rebind = reader({
      'https://empresa.example.com/robots.txt': ROBOTS_OPEN,
      'https://empresa.example.com/': redirect('https://interno.example.com/'),
    });
    expect(await rebind.pages.fetchPage('https://empresa.example.com/')).toMatchObject({
      failure: 'blocked_address',
    });
    expect(rebind.net.urls().some((url) => url.includes('interno'))).toBe(false);
  });

  it('segue redirecionamento permitido e informa a URL final', async () => {
    const { pages } = reader({
      'https://empresa.example.com/robots.txt': ROBOTS_OPEN,
      'https://www.empresa.example.com/robots.txt': ROBOTS_OPEN,
      'https://empresa.example.com/': redirect('https://www.empresa.example.com/', 301),
      'https://www.empresa.example.com/': html(PAGE),
    });
    const result = await pages.fetchPage('https://empresa.example.com/');
    expect(result.ok && result.page.requestedUrl).toBe('https://empresa.example.com/');
    expect(result.ok && result.page.url).toBe('https://www.empresa.example.com/');
  });

  it.each([
    [404, 'not_found'],
    [410, 'not_found'],
    [401, 'access_denied'],
    [403, 'access_denied'],
    [451, 'access_denied'],
    [429, 'rate_limited'],
    [500, 'unavailable'],
    [204, null],
  ] as const)('HTTP %i → %s', async (status, failure) => {
    const { pages } = reader({
      'https://empresa.example.com/robots.txt': ROBOTS_OPEN,
      'https://empresa.example.com/x': reply(status, '', { 'content-type': 'text/html' }),
    });
    const result = await pages.fetchPage('https://empresa.example.com/x');
    if (failure === null) {
      expect(result.ok).toBe(true);
    } else {
      expect(result).toEqual({ ok: false, failure, httpStatus: status });
    }
  });

  it('noai no cabeçalho ou no <meta>: acesso negado', async () => {
    const header = reader({
      'https://empresa.example.com/robots.txt': ROBOTS_OPEN,
      'https://empresa.example.com/': html(PAGE, { 'x-robots-tag': 'noai' }),
    });
    expect(await header.pages.fetchPage('https://empresa.example.com/')).toMatchObject({
      failure: 'access_denied',
    });
    const meta = reader({
      'https://empresa.example.com/robots.txt': ROBOTS_OPEN,
      'https://empresa.example.com/': html('<meta name="prospector" content="noai"><p>x</p>'),
    });
    expect(await meta.pages.fetchPage('https://empresa.example.com/')).toMatchObject({
      failure: 'access_denied',
    });
  });

  it('PDF e imagem: conteúdo não suportado; texto puro é lido', async () => {
    const { pages } = reader({
      'https://empresa.example.com/robots.txt': ROBOTS_OPEN,
      'https://empresa.example.com/a.pdf': reply(200, '%PDF', {
        'content-type': 'application/pdf',
      }),
      'https://empresa.example.com/a.txt': reply(200, 'linha 1\n\n\nlinha 2', {
        'content-type': 'text/plain; charset=utf-8',
      }),
    });
    expect(await pages.fetchPage('https://empresa.example.com/a.pdf')).toMatchObject({
      failure: 'unsupported_content',
    });
    const text = await pages.fetchPage('https://empresa.example.com/a.txt');
    expect(text.ok && text.page.text).toBe('linha 1\n\nlinha 2');
    expect(text.ok && text.page.title).toBeNull();
  });

  it('decodifica latin1 declarado no <meta>', async () => {
    const latin1 = Uint8Array.from(
      Buffer.from(
        '<meta charset="iso-8859-1"><title>Cer\u00e2mica</title><p>a\u00e7\u00e3o</p>',
        'latin1',
      ),
    );
    const { pages } = reader({
      'https://empresa.example.com/robots.txt': ROBOTS_OPEN,
      'https://empresa.example.com/': reply(200, latin1, { 'content-type': 'text/html' }),
    });
    const result = await pages.fetchPage('https://empresa.example.com/');
    expect(result.ok && result.page.title).toBe('Cerâmica');
    expect(result.ok && result.page.text).toBe('ação');
  });

  it('corta o texto no limite e marca truncated', async () => {
    const { pages } = reader(
      {
        'https://empresa.example.com/robots.txt': ROBOTS_OPEN,
        'https://empresa.example.com/': html(`<p>${'palavra '.repeat(200)}</p>`),
      },
      { maxTextChars: 100 },
    );
    const result = await pages.fetchPage('https://empresa.example.com/');
    expect(result.ok && result.page.text.length).toBe(100);
    expect(result.ok && result.page.truncated).toBe(true);
  });

  it('usa o texto do navegador quando renderiza; se o navegador falha, fica a extração estática', async () => {
    const routes = {
      'https://empresa.example.com/robots.txt': ROBOTS_OPEN,
      'https://empresa.example.com/': html('<title>SPA</title><div id="app"></div>'),
    };
    const render = vi.fn<BrowserRenderer['render']>(async () => ({
      title: null,
      description: 'montado por JS',
      lang: 'pt-BR',
      robots: [],
      text: 'Conteúdo montado pelo JavaScript. Contato: (20) 9 9999-0000',
    }));
    const ok = reader(routes, {
      renderer: 'browser',
      browser: { render, close: async () => undefined },
    });
    const rendered = await ok.pages.fetchPage('https://empresa.example.com/');
    expect(rendered.ok && rendered.page).toMatchObject({
      renderer: 'browser',
      title: 'SPA',
      description: 'montado por JS',
      text: 'Conteúdo montado pelo JavaScript. Contato: [telefone omitido]',
    });
    const main = render.mock.calls[0]?.[0];
    expect(main?.url).toBe('https://empresa.example.com/');
    expect(new TextDecoder().decode(main?.body)).toContain('<div id="app">');

    const broken = reader(routes, {
      renderer: 'browser',
      browser: {
        render: async () => {
          throw new Error('Chromium não instalado');
        },
        close: async () => undefined,
      },
    });
    const fallback = await broken.pages.fetchPage('https://empresa.example.com/');
    expect(fallback.ok && fallback.page.renderer).toBe('http');
    expect(fallback.ok && fallback.page.title).toBe('SPA');
  });

  it('noai que só aparece depois de renderizar também nega', async () => {
    const { pages } = reader(
      {
        'https://empresa.example.com/robots.txt': ROBOTS_OPEN,
        'https://empresa.example.com/': html('<p>x</p>'),
      },
      {
        renderer: 'browser',
        browser: {
          render: async () => ({
            title: null,
            description: null,
            lang: null,
            robots: ['noai'],
            text: 'x',
          }),
          close: async () => undefined,
        },
      },
    );
    expect(await pages.fetchPage('https://empresa.example.com/')).toMatchObject({
      failure: 'access_denied',
    });
  });
});

describe('createPageReader: prazo total', () => {
  it('DNS que não responde vira "fora do ar" dentro do prazo', async () => {
    const pages = createPageReader({
      resolver: () => new Promise<string[]>(() => undefined),
      renderer: 'http',
      timeoutMs: 300,
      now,
      log: () => undefined,
    });
    const started = Date.now();
    expect(await pages.fetchPage('https://empresa.example.com/')).toEqual({
      ok: false,
      failure: 'unavailable',
      httpStatus: null,
    });
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('cancelamento de quem chamou é repassado', async () => {
    const pages = createPageReader({
      resolver: () => new Promise<string[]>(() => undefined),
      renderer: 'http',
      now,
      log: () => undefined,
    });
    const controller = new AbortController();
    const pending = pages.fetchPage('https://empresa.example.com/', { signal: controller.signal });
    controller.abort(new Error('cancelado'));
    await expect(pending).rejects.toThrow('cancelado');
  });
});
