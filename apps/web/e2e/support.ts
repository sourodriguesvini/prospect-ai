import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

/**
 * Abre a página e espera os atalhos de teclado da moldura estarem ligados. Eles só passam a
 * valer depois que o React assume a página no navegador, o que no CI pode vir depois do
 * evento "load"; sem esperar, Ctrl+K, Ctrl+B ou "g e" apertados cedo demais se perdem.
 */
export async function gotoWithShortcuts(page: Page, path: string) {
  await page.goto(path);
  await expect(page.locator('html[data-shortcuts="ready"]')).toBeAttached();
}

/**
 * Falha listando cada violação WCAG 2.2 AA encontrada pelo axe na página atual.
 *
 * Depois de um router.refresh() o <title> pode sumir por um instante, inclusive entre a espera
 * pelo título e a análise (falha intermitente "document-title" no CI, Copiloto no celular). Por
 * isso a análise é repetida por alguns segundos: violação passageira some, violação real continua
 * falhando com a lista de achados.
 *
 * `exclude` tira elementos da análise. Só para o que o axe não consegue analisar: um iframe com
 * `sandbox=""` não roda script, a injeção do axe trava nele e a análise inteira falha.
 */
export async function expectNoA11yViolations(page: Page, options: { exclude?: string[] } = {}) {
  await expect(async () => {
    await expect(page).toHaveTitle(/\S/);
    let builder = new AxeBuilder({ page }).withTags(WCAG_TAGS);
    for (const selector of options.exclude ?? []) builder = builder.exclude(selector);
    const results = await builder.analyze();
    const summary = results.violations.map(
      (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`,
    );
    expect(summary).toEqual([]);
  }).toPass({ timeout: 10_000 });
}
