import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { afterAll, describe, expect, it } from 'vitest';
import {
  createPlaywrightRenderer,
  type BrowserCapturer,
  type FetchedResource,
} from '../../src/web/browser';
import { createBrandCapturer, METRICS_SCRIPT } from '../../src/web/brand-capturer';
import { PUBLIC_IP, fakeResolver, fakeTransport, html, reply } from './net-fakes';

/**
 * Captura de marca: as proteções do caminho (SSRF, termos, robots, `noai`, tipo de conteúdo) com
 * rede falsa e navegador falso; e a captura de verdade num Chromium SEM rede, servido pela
 * interceptação do Playwright (pula se o Chromium do Playwright não estiver instalado). Dados
 * SINTÉTICOS.
 */

const now = () => new Date('2026-11-11T12:00:00Z');
const resolver = fakeResolver({
  'empresa.example.com': [PUBLIC_IP],
  'interno.example.com': ['10.0.0.5'],
});
const ROBOTS = 'https://empresa.example.com/robots.txt';

const PAGE = `<!doctype html><html lang="pt-BR"><head><title>Ateliê Exemplo</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="icon" href="/favicon.ico">
<style>
  body { margin: 0; font-family: Georgia, serif; background: #FAF7F2; color: #222222; }
  header { display: flex; justify-content: space-between; padding: 16px; background: #1F3A5F; }
  header a { color: #FFFFFF; margin-right: 12px; }
  h1 { font-size: 40px; color: #1F3A5F; }
  .claro { color: #DDDDDD; }
  .pequeno { font-size: 10px; }
  .botao { display: inline-block; padding: 14px 24px; background: #D9480F; color: #FFFFFF; }
  section { height: 900px; }
</style></head>
<body>
<header><a href="/"><img src="/logo.png" alt="Ateliê Exemplo" class="logo" width="120" height="40"></a>
<nav><a href="/sobre">Sobre</a><a href="/servicos">Serviços</a><a href="/contato">Contato</a></nav></header>
<main><h1>Móveis sob medida em Curitiba</h1>
<p>Projetos de marcenaria para casas e escritórios.</p>
<p class="claro">Texto com pouco contraste sobre o fundo claro.</p>
<p class="pequeno">Letra miúda no rodapé da seção.</p>
<a class="botao" href="/orcamento">Peça um orçamento</a>
<img src="/obra.jpg" width="300" height="200">
<section></section></main></body></html>`;

/** PNG 1×1 transparente. */
const PNG = Uint8Array.from(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
    'base64',
  ),
);

function chromiumInstalled(): boolean {
  try {
    return existsSync(chromium.executablePath());
  } catch {
    return false;
  }
}

const fakeBrowser = (): BrowserCapturer & { calls: number } => {
  const fake = {
    calls: 0,
    async capture() {
      fake.calls += 1;
      return {
        metrics: {},
        image: new Uint8Array([0xff, 0xd8, 0xff]),
        width: 1280,
        height: 800,
        transferredBytes: 10,
      };
    },
  };
  return fake;
};

function capturerWith(
  routes: Parameters<typeof fakeTransport>[0],
  browser: BrowserCapturer | null,
) {
  const net = fakeTransport({ [ROBOTS]: reply(404), ...routes });
  const capturer = createBrandCapturer({
    browser,
    resolver,
    transport: net.transport,
    now,
    log: () => undefined,
  });
  return { capturer, net };
}

describe('createBrandCapturer: proteções antes do navegador', () => {
  it('desligada sem navegador; endereço interno, rede social e robots.txt recusados', async () => {
    const off = capturerWith({}, null).capturer;
    expect(await off.capture('https://empresa.example.com/', 'desktop')).toEqual({
      ok: false,
      failure: 'disabled',
    });
    const browser = fakeBrowser();
    const { capturer } = capturerWith(
      {
        [ROBOTS]: reply(200, 'User-agent: *\nDisallow: /privado'),
        'https://empresa.example.com/privado': html(PAGE),
      },
      browser,
    );
    expect(await capturer.capture('http://127.0.0.1/', 'desktop')).toMatchObject({
      failure: 'blocked_address',
    });
    expect(await capturer.capture('https://interno.example.com/', 'desktop')).toMatchObject({
      failure: 'blocked_address',
    });
    expect(await capturer.capture('https://www.instagram.com/atelie', 'desktop')).toMatchObject({
      failure: 'restricted_site',
    });
    expect(await capturer.capture('https://empresa.example.com/privado', 'desktop')).toMatchObject({
      failure: 'robots_disallowed',
    });
    expect(browser.calls).toBe(0);
  });

  it('noai no cabeçalho ou na página, PDF e 404 não chegam ao navegador', async () => {
    const browser = fakeBrowser();
    const { capturer } = capturerWith(
      {
        'https://empresa.example.com/a': html(PAGE, { 'x-robots-tag': 'noai' }),
        'https://empresa.example.com/b': html('<meta name="robots" content="noai"><p>x</p>'),
        'https://empresa.example.com/c': reply(200, '%PDF', { 'content-type': 'application/pdf' }),
      },
      browser,
    );
    expect(await capturer.capture('https://empresa.example.com/a', 'desktop')).toMatchObject({
      failure: 'access_denied',
    });
    expect(await capturer.capture('https://empresa.example.com/b', 'desktop')).toMatchObject({
      failure: 'access_denied',
    });
    expect(await capturer.capture('https://empresa.example.com/c', 'desktop')).toMatchObject({
      failure: 'unsupported_content',
    });
    expect(await capturer.capture('https://empresa.example.com/d', 'desktop')).toMatchObject({
      failure: 'not_found',
    });
    expect(browser.calls).toBe(0);
  });

  it('tela anti-robô no lugar do site: acesso negado, sem abrir o navegador', async () => {
    const browser = fakeBrowser();
    const { capturer } = capturerWith(
      {
        'https://empresa.example.com/': html(
          '<html><head><title>Just a moment...</title></head><body>Enable JavaScript and cookies to continue</body></html>',
        ),
      },
      browser,
    );
    expect(await capturer.capture('https://empresa.example.com/', 'mobile')).toEqual({
      ok: false,
      failure: 'access_denied',
    });
    expect(browser.calls).toBe(0);
  });

  it('medições fora do contrato não viram captura; navegador ausente tem motivo próprio', async () => {
    const { capturer } = capturerWith(
      { 'https://empresa.example.com/': html(PAGE) },
      fakeBrowser(),
    );
    expect(await capturer.capture('https://empresa.example.com/', 'desktop')).toEqual({
      ok: false,
      failure: 'unavailable',
    });
    const missing: BrowserCapturer = {
      capture: async () => {
        throw new Error("browserType.launch: Executable doesn't exist at C:\\x\\chrome.exe");
      },
    };
    const other = capturerWith({ 'https://empresa.example.com/': html(PAGE) }, missing).capturer;
    expect(await other.capture('https://empresa.example.com/', 'mobile')).toEqual({
      ok: false,
      failure: 'browser_missing',
    });
  });
});

const served: string[] = [];
async function fetchResource(url: string): Promise<FetchedResource | null> {
  served.push(url);
  if (url.endsWith('/logo.png') || url.endsWith('/obra.jpg')) {
    return { status: 200, contentType: 'image/png', body: PNG };
  }
  return null;
}

const renderer = createPlaywrightRenderer({
  fetchResource,
  idleCloseMs: 1000,
  log: () => undefined,
});

afterAll(async () => {
  await renderer.close();
});

describe.skipIf(!chromiumInstalled())('captura com rodapé e menu (Chromium real, sem rede)', () => {
  it('repassa as partes pedidas (menu só no celular), com o hash de cada imagem', async () => {
    const seen: unknown[] = [];
    const spy: BrowserCapturer = {
      capture: (main, options) => {
        seen.push(options.extras ?? null);
        return renderer.capture(main, options);
      },
    };
    const { capturer } = capturerWith({ 'https://empresa.example.com/': html(PAGE) }, spy);
    const plain = await capturer.capture('https://empresa.example.com/', 'desktop');
    if (!plain.ok) throw new Error(`falhou: ${plain.failure}`);
    expect(plain.capture.extras).toBeUndefined();
    expect(plain.capture.missing).toBeUndefined();

    for (const viewport of ['desktop', 'mobile'] as const) {
      const result = await capturer.capture('https://empresa.example.com/', viewport, {
        extras: { footer: true, menu: true },
      });
      if (!result.ok) throw new Error(`falhou: ${result.failure}`);
      const parts = viewport === 'mobile' ? 2 : 1;
      const extras = result.capture.extras ?? [];
      const missing = result.capture.missing ?? [];
      expect(extras.length + missing.length).toBe(parts);
      for (const extra of extras) {
        expect(extra.image.sha256).toBe(
          createHash('sha256').update(extra.image.bytes).digest('hex'),
        );
        expect(extra.image.mime).toBe('image/jpeg');
      }
    }
    expect(seen).toEqual([null, { footer: true, menu: false }, { footer: true, menu: true }]);
  }, 90_000);
});

describe.skipIf(!chromiumInstalled())('captura com Chromium real (sem rede)', () => {
  it('desafio que só aparece depois do script: acesso negado, nenhuma imagem', async () => {
    const challenge = `<!doctype html><html><head><title>Loja Exemplo</title></head>
<body><p>Aguarde</p><script>document.title = 'Client Challenge';</script></body></html>`;
    const { capturer } = capturerWith(
      { 'https://empresa.example.com/': html(challenge) },
      renderer,
    );
    expect(await capturer.capture('https://empresa.example.com/', 'desktop')).toEqual({
      ok: false,
      failure: 'access_denied',
    });
  }, 40_000);

  it('computador: JPEG com altura limitada e medições da página', async () => {
    const { capturer } = capturerWith({ 'https://empresa.example.com/': html(PAGE) }, renderer);
    const result = await capturer.capture('https://empresa.example.com/', 'desktop');
    if (!result.ok) throw new Error(`falhou: ${result.failure}`);
    const { image, metrics } = result.capture;
    expect([...image.bytes.subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff]);
    expect(image.width).toBe(1280);
    expect(image.height).toBeLessThanOrEqual(1600);
    expect(image.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(metrics).toMatchObject({
      viewport: 'desktop',
      title: 'Ateliê Exemplo',
      hasViewportMeta: true,
      horizontalOverflow: false,
      h1Count: 1,
      h1Text: 'Móveis sob medida em Curitiba',
      hasFavicon: true,
      hasOgImage: false,
      imagesWithoutAlt: 1,
      forms: 0,
      logo: { found: true, format: 'raster' },
    });
    expect(metrics.fonts[0]).toBe('Georgia');
    expect(metrics.backgroundColors).toContain('#FAF7F2');
    expect(metrics.accentColors).toContain('#D9480F');
    expect(metrics.ctaTexts).toContain('Peça um orçamento');
    expect(metrics.navLinkCount).toBeGreaterThanOrEqual(3);
    expect(metrics.lowContrastTexts).toBeGreaterThanOrEqual(1);
    expect(metrics.smallTextPercent).toBeGreaterThan(0);
    expect(metrics.transferredBytes).toBeGreaterThan(PAGE.length);
    // Imagens passaram pelo cliente seguro (nunca pela rede do navegador).
    expect(served).toContain('https://empresa.example.com/logo.png');
  }, 60_000);

  it('texto sobre imagem de fundo não conta como contraste baixo (caso real, 2026-11-11)', async () => {
    const claro = '<p class="claro">Texto com pouco contraste sobre o fundo claro.</p>';
    const low = async (page: string) => {
      const { capturer } = capturerWith({ 'https://empresa.example.com/': html(page) }, renderer);
      const result = await capturer.capture('https://empresa.example.com/', 'desktop');
      if (!result.ok) throw new Error(`falhou: ${result.failure}`);
      return result.capture.metrics.lowContrastTexts;
    };
    const without = await low(PAGE.replace(claro, ''));
    const hero = await low(
      PAGE.replace(
        claro,
        '<div style="background-image: linear-gradient(#000000, #333333); padding: 24px">' +
          '<p style="color: #FFFFFF">Texto branco sobre a foto da vitrine.</p></div>',
      ),
    );
    // Só o botão branco sobre laranja (≈ 3,9:1) continua baixo nas duas.
    expect(hero).toBe(without);
  }, 60_000);

  it('noarchive na página ou no cabeçalho: captura feita e marcada para não guardar', async () => {
    const meta = PAGE.replace('<title>', '<meta name="robots" content="noarchive"><title>');
    const { capturer } = capturerWith(
      {
        'https://empresa.example.com/': html(PAGE),
        'https://empresa.example.com/meta': html(meta),
        'https://empresa.example.com/header': html(PAGE, { 'x-robots-tag': 'noarchive' }),
      },
      renderer,
    );
    const plain = await capturer.capture('https://empresa.example.com/', 'desktop');
    const byMeta = await capturer.capture('https://empresa.example.com/meta', 'desktop');
    const byHeader = await capturer.capture('https://empresa.example.com/header', 'desktop');
    if (!plain.ok || !byMeta.ok || !byHeader.ok) throw new Error('captura falhou');
    expect(plain.capture.noArchive).toBe(false);
    expect(byMeta.capture.noArchive).toBe(true);
    expect(byHeader.capture.noArchive).toBe(true);
  }, 60_000);

  it('celular: janela estreita e conteúdo largo demais acusado', async () => {
    const wide = PAGE.replace('<section></section>', '<div style="width:900px;height:20px"></div>');
    const { capturer } = capturerWith({ 'https://empresa.example.com/': html(wide) }, renderer);
    const result = await capturer.capture('https://empresa.example.com/', 'mobile');
    if (!result.ok) throw new Error(`falhou: ${result.failure}`);
    expect(result.capture.image.width).toBe(390);
    expect(result.capture.metrics).toMatchObject({ viewport: 'mobile', horizontalOverflow: true });
  }, 60_000);
});

describe('script das medições', () => {
  it('é uma expressão autocontida (sem interpolação do servidor)', () => {
    expect(METRICS_SCRIPT.startsWith('(() => {')).toBe(true);
    expect(METRICS_SCRIPT).not.toContain('${');
  });
});
