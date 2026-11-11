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

/** Falha listando cada violação WCAG 2.2 AA encontrada pelo axe na página atual. */
export async function expectNoA11yViolations(page: Page) {
  // Depois de um router.refresh() o <title> pode sumir por um instante (falha intermitente
  // "document-title" no CI); espera o título voltar antes de analisar.
  await expect(page).toHaveTitle(/\S/);
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  const summary = results.violations.map(
    (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`,
  );
  expect(summary).toEqual([]);
}
