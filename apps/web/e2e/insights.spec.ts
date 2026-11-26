import { expect, test, type Page } from '@playwright/test';
import { expectNoA11yViolations } from './support';

/**
 * Monitoramento e Resultados (a antiga Inteligência; ADR-0017) no servidor em modo memória, DEPOIS dos specs que gravam
 * (empresas, estratégia, relacionamento): as telas leem o que eles deixaram. Os números dependem
 * desses specs, então aqui se confere a estrutura, os filtros e os estados, não contagens exatas;
 * as contagens são cobertas pelos testes do domínio, do serviço e do repositório.
 */

async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

test('Monitoramento mostra o feed com filtro e a lista de acompanhamento', async ({ page }) => {
  await page.goto('/monitoramento');
  await expect(page.getByRole('heading', { level: 1, name: 'Monitoramento' })).toBeVisible();
  await expect(page.getByRole('note').filter({ hasText: 'Modo de teste' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'Novidades' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'Para olhar de novo' })).toBeVisible();

  const filters = page.getByRole('navigation', { name: 'Filtrar novidades' });
  await expect(filters.getByRole('link', { name: /^Tudo/ })).toHaveAttribute(
    'aria-current',
    'page',
  );
  // Feed vazio ou com itens, sempre com uma saída: nunca uma área em branco.
  await expect(page.locator('[data-feed-item], [data-feed-empty]').first()).toBeVisible();
  await expect(page.locator('[data-watch-state], [data-watch-empty]').first()).toBeVisible();
  await expectNoA11yViolations(page);

  await filters.getByRole('link', { name: /^Buscas recorrentes/ }).click();
  await expect(page).toHaveURL(/\/monitoramento\?origem=buscas$/);
  await expect(page).toHaveTitle(/Buscas recorrentes · Monitoramento/);
  await expect(filters.getByRole('link', { name: /^Buscas recorrentes/ })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(page.locator('[data-feed-item="company_change"]')).toHaveCount(0);

  // Filtro desconhecido volta para "Tudo" em vez de quebrar.
  await page.goto('/monitoramento?origem=qualquer');
  await expect(filters.getByRole('link', { name: /^Tudo/ })).toHaveAttribute(
    'aria-current',
    'page',
  );

  await page.setViewportSize({ width: 375, height: 812 });
  await expectNoHorizontalScroll(page);
});

test('Resultados mostra o funil das sete etapas, o período e o consumo do mês', async ({
  page,
}) => {
  await page.goto('/inteligencia');
  await expect(page.getByRole('heading', { level: 1, name: 'Resultados' })).toBeVisible();
  await expect(page.getByRole('note').filter({ hasText: 'Modo de teste' })).toBeVisible();

  // Os specs anteriores cadastraram empresas neste mês: o funil não está vazio.
  const funnel = page.locator('main [data-funnel]');
  await expect(funnel.locator('[data-stage]')).toHaveCount(7);
  await expect(funnel.locator('[data-stage="saved"] [data-count]')).not.toHaveText('0');

  const period = page.getByRole('navigation', { name: 'Período do funil' });
  await expect(period.getByRole('link', { name: 'Este mês' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  // Modo memória não registra gasto em dinheiro: zero, nunca número inventado.
  await expect(page.locator('[data-usage="money"]')).toHaveText(/US\$\s0,00/);
  // Sem banco a busca na internet não conta créditos: o cartão diz isso, com o texto do topo.
  await expect(page.locator('[data-usage="search"]')).toHaveText('Sem banco');
  await expect(page.getByText('ainda não são registradas aqui')).toBeVisible();
  await expectNoA11yViolations(page);

  await period.getByRole('link', { name: 'Desde o início' }).click();
  await expect(page).toHaveURL(/\/inteligencia\?periodo=total$/);
  await expect(page).toHaveTitle(/Desde o início · Resultados/);
  await expect(period.getByRole('link', { name: 'Desde o início' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(funnel.locator('[data-stage]')).toHaveCount(7);

  await page.setViewportSize({ width: 375, height: 812 });
  await expectNoHorizontalScroll(page);
});

test('Hoje mostra o que pede atenção e o resumo comercial, com link para Resultados', async ({
  page,
}) => {
  await page.goto('/');
  // Os specs anteriores deixaram oportunidades e mensagens: Hoje lista algo ou diz que está em dia.
  await expect(page.locator('[data-today], [data-today-empty]').first()).toBeVisible();
  const summary = page.getByRole('region', { name: 'Resumo comercial' });
  await expect(summary).toContainText('Conversas abertas');
  await expect(summary).toContainText('Em negociação');
  await expect(summary).toContainText('Prontas para abordar');
  await expect(page.getByText('O gráfico ainda não existe')).toHaveCount(0);
  await expect(page.getByText('Chega na F13')).toHaveCount(0);
  await expectNoA11yViolations(page);
  await summary.getByRole('link', { name: 'Resultados' }).click();
  await expect(page).toHaveURL(/\/inteligencia$/);
});
