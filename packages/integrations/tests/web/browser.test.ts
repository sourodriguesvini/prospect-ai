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
