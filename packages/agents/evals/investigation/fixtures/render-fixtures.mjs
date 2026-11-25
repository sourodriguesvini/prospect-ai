// Gera as capturas SINTÉTICAS da avaliação da auditoria visual a partir das páginas .html desta
// pasta (empresas inventadas, nada de site real). Mesmas larguras, alturas máximas e formato
// (JPEG 70) das capturas do produto. Na raiz, para todas ou só as citadas:
// node packages/agents/evals/investigation/fixtures/render-fixtures.mjs [oficina-campanha.html]
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
// O playwright-core é dependência do pacote de integrações (captura real); aqui só gera as fixtures.
const require = createRequire(join(here, '../../../../integrations/package.json'));
const { chromium } = require('playwright-core');

const VIEWPORTS = {
  desktop: { width: 1280, height: 800, maxHeight: 1600 },
  mobile: { width: 390, height: 844, maxHeight: 1700 },
};

const files = process.argv.slice(2).length
  ? process.argv.slice(2).map((file) => basename(file))
  : readdirSync(here).filter((file) => file.endsWith('.html'));
const browser = await chromium.launch({ headless: true });
try {
  for (const [file, [name, size]] of files.flatMap((file) =>
    Object.entries(VIEWPORTS).map((entry) => [file, entry]),
  )) {
    const html = readFileSync(join(here, file), 'utf8');
    const page = await browser.newPage({
      viewport: { width: size.width, height: size.height },
      deviceScaleFactor: 1,
    });
    await page.setContent(html, { waitUntil: 'load' });
    const height = Math.min(
      size.maxHeight,
      await page.evaluate('document.documentElement.scrollHeight'),
    );
    const image = await page.screenshot({
      type: 'jpeg',
      quality: 70,
      clip: { x: 0, y: 0, width: size.width, height },
      fullPage: true,
    });
    writeFileSync(join(here, `${file.replace(/\.html$/, '')}-${name}.jpg`), image);
    console.log(`${file} ${name}: ${size.width}x${height}, ${Math.round(image.length / 1024)} KB`);
    await page.close();
  }
} finally {
  await browser.close();
}
