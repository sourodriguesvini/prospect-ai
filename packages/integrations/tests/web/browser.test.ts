import { existsSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { afterAll, describe, expect, it } from 'vitest';
import { createPlaywrightRenderer, type FetchedResource } from '../../src/web/browser';

/**
 * Chromium de verdade, mas SEM rede: o documento principal e os sub-recursos são servidos pela
 * interceptação do Playwright. Pula se o navegador do Playwright não estiver instalado
 * (`pnpm --filter @prospector/web exec playwright install chromium`).
 */
function chromiumInstalled(): boolean {
  try {
    return existsSync(chromium.executablePath());
  } catch {
    return false;
  }
}

const requested: string[] = [];
const encoder = new TextEncoder();

const SCRIPT = `
document.getElementById('app').textContent = 'Revestimentos montados por script';
fetch('http://169.254.169.254/latest/meta-data/').then(
  () => { document.title = 'vazou'; },
  () => {},
);
const img = document.createElement('img');
img.src = '/logo.png';
document.body.appendChild(img);
`;

async function fetchResource(url: string): Promise<FetchedResource | null> {
  requested.push(url);
  if (url === 'https://empresa.example.com/app.js') {
    return { status: 200, contentType: 'application/javascript', body: encoder.encode(SCRIPT) };
  }
  // O leitor de verdade passa tudo pelo safeFetch, que recusaria o endereço interno.
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

describe.skipIf(!chromiumInstalled())('createPlaywrightRenderer (Chromium real, sem rede)', () => {
  it('renderiza o HTML recebido, executa o script e só pede sub-recursos pelo cliente seguro', async () => {
    const html = `<!doctype html><html lang="pt-BR"><head><title>Empresa Exemplo</title>
<meta name="description" content="Página de teste"><meta name="robots" content="index, noai">
</head><body><div id="app">carregando</div>
<a href="https://outro.example.com/">sair</a><script src="/app.js"></script></body></html>`;
    const page = await renderer.render(
      {
        url: 'https://empresa.example.com/',
        status: 200,
        contentType: 'text/html; charset=utf-8',
        body: encoder.encode(html),
      },
      { timeoutMs: 20_000 },
    );
    expect(page.title).toBe('Empresa Exemplo');
    expect(page.description).toBe('Página de teste');
    expect(page.lang).toBe('pt-BR');
    expect(page.robots).toEqual(['index', 'noai']);
    expect(page.text).toContain('Revestimentos montados por script');
    expect(page.text).not.toContain('carregando');
    expect(requested).toContain('https://empresa.example.com/app.js');
    // O fetch do script chegou ao cliente seguro (que recusa) em vez de sair pelo navegador.
    expect(requested).toContain('http://169.254.169.254/latest/meta-data/');
    // Imagem nunca chega ao cliente: tipo de recurso bloqueado no navegador.
    expect(requested).not.toContain('https://empresa.example.com/logo.png');
  }, 30_000);
});

/** Página longa com rodapé e menu que abre no celular (diretriz de 2026-11-26, Parte 13.3). */
const LONG_PAGE = `<!doctype html><html lang="pt-BR"><head><meta name="viewport" content="width=device-width">
<title>Página longa</title><style>
body { margin: 0; font-family: sans-serif; }
header { height: 64px; display: flex; align-items: center; justify-content: space-between; padding: 0 16px; }
#menu { display: none; }
#menu.aberto { display: block; position: fixed; inset: 64px 0 0 0; background: #fff; }
#menu a { display: block; padding: 16px; }
section { height: 900px; border-bottom: 1px solid #ccc; }
footer { height: 320px; background: #222; color: #fff; padding: 24px; }
</style></head><body>
<header><strong>Empresa</strong>
<button id="abrir" aria-label="Abrir menu" aria-expanded="false" aria-controls="menu">☰</button></header>
<nav id="menu"><a href="/sobre">Sobre</a><a href="/servicos">Serviços</a><a href="/contato">Contato</a></nav>
<section>Primeira</section><section>Segunda</section><section>Terceira</section>
<footer role="contentinfo">Rodapé com endereço e redes</footer>
<script src="/menu.js"></script>
</body></html>`;

const MENU_JS = `document.getElementById('abrir').addEventListener('click', () => {
  const menu = document.getElementById('menu');
  menu.classList.toggle('aberto');
  document.getElementById('abrir').setAttribute('aria-expanded', String(menu.classList.contains('aberto')));
});`;

describe.skipIf(!chromiumInstalled())('createPlaywrightRenderer: rodapé e menu aberto', () => {
  const own = createPlaywrightRenderer({
    fetchResource: async (url) =>
      url === 'https://longa.example.com/menu.js'
        ? { status: 200, contentType: 'application/javascript', body: encoder.encode(MENU_JS) }
        : null,
    idleCloseMs: 1000,
    log: () => undefined,
  });
  afterAll(async () => {
    await own.close();
  });
  const main = (html: string, url = 'https://longa.example.com/') => ({
    url,
    status: 200,
    contentType: 'text/html; charset=utf-8',
    body: encoder.encode(html),
  });
  const isJpeg = (bytes: Uint8Array) => bytes[0] === 0xff && bytes[1] === 0xd8;

  it('computador: rodapé recortado pelo elemento, fora das primeiras telas', async () => {
    const shot = await own.capture(main(LONG_PAGE), {
      timeoutMs: 25_000,
      viewport: { width: 1280, height: 800 },
      mobile: false,
      maxHeight: 1600,
      quality: 70,
      metricsScript: '({})',
      extras: { footer: true },
    });
    expect(shot.height).toBe(1600);
    expect(shot.missing).toEqual([]);
    const footer = shot.extras?.find((extra) => extra.region === 'footer');
    // 320 px de altura + 24 px de respiro em cima e embaixo: a imagem pega o rodapé inteiro.
    expect(footer).toMatchObject({ width: 1280, height: 368, located: 'element' });
    expect(isJpeg(footer?.image ?? new Uint8Array())).toBe(true);
  }, 40_000);

  it('celular: toca no botão, confere que o menu abriu e tira a imagem da tela', async () => {
    const shot = await own.capture(main(LONG_PAGE), {
      timeoutMs: 25_000,
      viewport: { width: 390, height: 844 },
      mobile: true,
      maxHeight: 1700,
      quality: 70,
      metricsScript: '({})',
      extras: { footer: true, menu: true },
    });
    expect(shot.missing).toEqual([]);
    expect(shot.extras?.map((extra) => extra.region).sort()).toEqual(['footer', 'menu']);
    const menu = shot.extras?.find((extra) => extra.region === 'menu');
    expect(menu).toMatchObject({ width: 390, height: 844 });
    expect(isJpeg(menu?.image ?? new Uint8Array())).toBe(true);
  }, 40_000);

  it('página curta sem menu: rodapé já nas primeiras telas e menu não encontrado', async () => {
    const short = `<!doctype html><html><head><meta name="viewport" content="width=device-width"></head>
<body><p>Curta</p><footer>Rodapé</footer></body></html>`;
    const shot = await own.capture(main(short, 'https://curta.example.com/'), {
      timeoutMs: 25_000,
      viewport: { width: 390, height: 844 },
      mobile: true,
      maxHeight: 1700,
      quality: 70,
      metricsScript: '({})',
      extras: { footer: true, menu: true },
    });
    expect(shot.extras).toEqual([]);
    expect(shot.missing).toEqual([
      { region: 'footer', reason: 'inside_top' },
      { region: 'menu', reason: 'not_found' },
    ]);
  }, 40_000);
});

describe.skipIf(!chromiumInstalled())('createPlaywrightRenderer: página que trava', () => {
  it('laço infinito depois de carregar: estoura o prazo, libera e a próxima página funciona', async () => {
    const own = createPlaywrightRenderer({
      fetchResource: async () => null,
      idleCloseMs: 1000,
      log: () => undefined,
    });
    try {
      const hang = `<!doctype html><html><body><p>trava</p>
<script>setTimeout(() => { for (;;) {} }, 50);</script></body></html>`;
      const started = Date.now();
      await expect(
        own.render(
          {
            url: 'https://trava.example.com/',
            status: 200,
            contentType: 'text/html; charset=utf-8',
            body: encoder.encode(hang),
          },
          { timeoutMs: 3000 },
        ),
      ).rejects.toThrow();
      // Prazo de 3 s + até 2 s para fechar a página + até 5 s para fechar o navegador.
      expect(Date.now() - started).toBeLessThan(11_000);

      const ok = await own.render(
        {
          url: 'https://ok.example.com/',
          status: 200,
          contentType: 'text/html; charset=utf-8',
          body: encoder.encode('<!doctype html><html><body><p>normal</p></body></html>'),
        },
        { timeoutMs: 15_000 },
      );
      expect(ok.text).toContain('normal');
    } finally {
      await own.close();
    }
  }, 40_000);
});
