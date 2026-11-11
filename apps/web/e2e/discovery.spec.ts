import { expect, test, type Page } from '@playwright/test';
import { expectNoA11yViolations } from './support';

/**
 * F4 — Descoberta de ponta a ponta, num servidor próprio em modo memória com buscador e IA
 * SINTÉTICOS (PROSPECTOR_DISCOVERY=fixture, src/server/discovery-fixture.ts): fila, trabalhador,
 * conferência dos trechos, deduplicação, triagem, decisões, Investigar e monitoramentos, sem
 * internet, sem créditos e sem GPU. Tudo sai marcado DEMO. Os testes formam uma história e rodam
 * em série sobre o mesmo servidor. A busca e a IA reais são cobertas pelos testes dos adaptadores,
 * pelas avaliações (packages/agents/evals/discovery) e pela validação manual do doc 14.
 */
test.describe.configure({ mode: 'serial' });

const REQUEST = 'Clínicas em Ribeirão Preto com sinais de expansão';
let runPath = '';

/** Sem rolagem lateral; se houver, a mensagem diz quais elementos passam da largura da tela. */
async function expectNoHorizontalScroll(page: Page) {
  const { overflow, offenders } = await page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    const clipped = (element: Element) => {
      for (let node = element.parentElement; node; node = node.parentElement) {
        if (['auto', 'scroll', 'hidden', 'clip'].includes(getComputedStyle(node).overflowX)) {
          return true;
        }
      }
      return false;
    };
    const found = [...document.querySelectorAll('body *')]
      .filter((element) => element.getBoundingClientRect().right > width + 1 && !clipped(element))
      .slice(0, 5)
      .map(
        (element) =>
          `${element.tagName.toLowerCase()}.${String(element.className).slice(0, 60)} «${(element.textContent ?? '').trim().slice(0, 40)}»`,
      );
    return {
      overflow: document.documentElement.scrollWidth - width,
      offenders: found,
    };
  });
  expect(overflow, offenders.join('\n')).toBeLessThanOrEqual(0);
}

async function search(page: Page, request: string) {
  await page.goto('/descoberta');
  await page.getByRole('textbox', { name: /O que você quer encontrar/ }).fill(request);
  await page.getByRole('button', { name: 'Pesquisar' }).click();
  await expect(page).toHaveURL(/\/descoberta\/pesquisas\/[0-9a-f-]{36}/);
}

/** Cartão de uma empresa (o item da lista que tem o link com o nome dela). */
function card(page: Page, name: string) {
  return page.getByRole('listitem').filter({
    has: page.getByRole('link', { name, exact: true }),
  });
}

/** Região de status da lista com a mensagem (anúncio depois de uma ação, WCAG 4.1.3). */
function announcement(page: Page, text: string) {
  return page.getByRole('status').filter({ hasText: text });
}

test('início começa vazio, com exemplos e sem dados simulados', async ({ page }) => {
  await page.goto('/descoberta');
  await expect(page.getByRole('heading', { level: 1, name: 'Descoberta' })).toBeVisible();
  await expect(page.getByText('Nenhuma pesquisa ainda.')).toBeVisible();
  await expect(page.getByText('Nenhuma oportunidade ainda.')).toBeVisible();
  await expectNoA11yViolations(page);

  // Pedido curto demais: erro no campo, nada criado.
  await page.getByRole('textbox', { name: /O que você quer encontrar/ }).fill('abc');
  await page.getByRole('button', { name: 'Pesquisar' }).click();
  await expect(page.getByText('mínimo de 8 letras')).toBeVisible();
  await expect(page).toHaveURL(/\/descoberta$/);

  // Exemplo preenche o campo.
  await page.getByRole('button', { name: REQUEST }).click();
  await expect(page.getByRole('textbox', { name: /O que você quer encontrar/ })).toHaveValue(
    REQUEST,
  );
});

test('pesquisa roda em segundo plano e mostra empresas com fonte e trecho', async ({ page }) => {
  await search(page, REQUEST);
  runPath = new URL(page.url()).pathname;
  // Chegando depois de uma ação, o foco vai para o título (não cai no início da página).
  await expect(page.locator('#titulo-pesquisa')).toBeFocused();
  await expect(page.getByText('Pesquisa concluída.')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('heading', { level: 1, name: REQUEST })).toBeVisible();
  // Uma região viva só, com a etapa e o fim (não os contadores a cada atualização).
  await expect(announcement(page, 'Pesquisa concluída:')).toHaveText(
    /^Pesquisa concluída: \d+ empresas?, \d+ sina(?:l|is)\.$/,
  );
  await expect(page.locator('[role="status"] [role="status"]')).toHaveCount(0);

  // Como o pedido foi entendido, com o plano de buscas.
  await expect(
    page.getByText('Clínicas de Ribeirão Preto (SP) com sinais de expansão e vagas de marketing.'),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Buscas feitas' })).toBeVisible();

  // A notícia (sem cidade) e o site oficial viraram uma empresa só, com o sinal e o trecho.
  const aurora = page.getByRole('link', { name: 'Clínica Aurora', exact: true });
  await expect(aurora).toHaveCount(1);
  await expect(
    page.getByText('“anunciou a inauguração de uma nova unidade na zona sul de Ribeirão Preto”'),
  ).toBeVisible();
  // A fonte aparece ao lado do trecho no cartão (host com link para a página original).
  const quote = page.locator('blockquote', {
    hasText: 'anunciou a inauguração de uma nova unidade',
  });
  await expect(quote.getByText('Fonte:')).toBeVisible();
  await expect(quote.getByRole('link', { name: /noticias\.exemplo\.test/ })).toBeVisible();
  await expect(card(page, 'Clínica Aurora').getByText(/Confiança da análise: /)).toBeVisible();
  await expect(page.getByText('(site conferido)')).toBeVisible();
  await expect(
    page.getByTitle('Dados de demonstração: não representam empresas ou pessoas reais').first(),
  ).toBeVisible();
  await expectNoA11yViolations(page);
});

test('salvar e ignorar ficam registrados, são anunciados e não perdem o foco', async ({ page }) => {
  await page.goto(runPath);
  // Salvar vira "Salva" no mesmo lugar: o foco continua no botão e a lista anuncia.
  const boreal = card(page, 'Studio Boreal');
  await boreal.getByRole('button', { name: /^Salvar ?: Studio Boreal$/ }).click();
  const saved = boreal.getByRole('button', { name: /^Salva ?: Studio Boreal$/ });
  await expect(saved).toHaveAttribute('aria-disabled', 'true');
  await expect(saved).toBeFocused();
  await expect(announcement(page, 'Studio Boreal salva.')).toBeVisible();

  // Ignorar: o cartão some, a lista anuncia e o foco vai para o título do próximo cartão (ou da
  // lista, se era o último).
  const sorriso = card(page, 'Clínica Sorriso Pleno');
  const nextTitleId = await sorriso.evaluate((item) => {
    for (let node = item.nextElementSibling; node; node = node.nextElementSibling) {
      const title = node.querySelector('[data-card-title]');
      if (title) return title.id;
    }
    return 'resultados';
  });
  await sorriso.locator('summary').click();
  await sorriso.getByLabel('Motivo (opcional)').fill('Fora do perfil');
  await sorriso.getByRole('button', { name: 'Ignorar esta empresa' }).click();
  await expect(page.getByRole('link', { name: 'Clínica Sorriso Pleno', exact: true })).toHaveCount(
    0,
  );
  await expect(announcement(page, 'Clínica Sorriso Pleno ignorada.')).toBeVisible();
  await expect(page.locator(`[id="${nextTitleId}"]`)).toBeFocused();
  await expect(page.getByText('1 empresa ignorada não aparece.')).toBeVisible();

  // Na lista geral, a ignorada só aparece filtrando por "Ignorada", com o caminho de volta.
  await page.goto('/descoberta/empresas?situacao=dismissed');
  await expect(
    page.getByRole('link', { name: 'Clínica Sorriso Pleno', exact: true }),
  ).toBeVisible();
  await expect(page.getByText('das vistas mais recentemente numa pesquisa')).toBeVisible();
  await expectNoA11yViolations(page);

  // Voltar para a lista: some do filtro "Ignorada"; sem próximo cartão, o foco vai para o título.
  await page
    .getByRole('button', {
      name: /^Voltar para a lista ?: Clínica Sorriso Pleno$/,
    })
    .click();
  await expect(announcement(page, 'Clínica Sorriso Pleno voltou para a lista.')).toBeVisible();
  await expect(page.getByText('Nenhuma empresa encontrada com esses filtros.')).toBeVisible();
  await expect(page.locator('#lista-encontradas')).toBeFocused();
});

test('detalhe da empresa encontrada explica a triagem e Investigar leva a Empresas', async ({
  page,
}) => {
  await page.goto('/descoberta/empresas');
  await page.getByRole('link', { name: 'Clínica Aurora', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Clínica Aurora' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Triagem' })).toBeVisible();
  await expect(page.getByText('Não é probabilidade de fechar negócio.')).toBeVisible();
  await expect(page.getByText('CNPJ 11.222.333/0001-81, encontrado no site oficial')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Fontes' })).toBeVisible();
  await expect(
    page.getByText(/Relevância (alta|média|baixa) · confiança no sinal: \d+%/).first(),
  ).toBeVisible();
  await expect(page.getByText('Relevância: ')).toHaveCount(0);
  await expectNoA11yViolations(page);

  await page.getByRole('button', { name: 'Investigar' }).click();
  await expect(page).toHaveURL(/\/empresas\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Clínica Aurora' })).toBeVisible();
  await expect(page.getByRole('definition').filter({ hasText: /^Descoberta$/ })).toBeVisible();
  await expect(page.getByText('Trecho conferido na fonte').first()).toBeVisible();
});

test('pedido sem resultados termina sem inventar empresas', async ({ page }) => {
  await search(page, 'Clínicas sem resultados no interior');
  await expect(page.getByText('Pesquisa concluída.')).toBeVisible({ timeout: 30_000 });
  await expect(
    page.getByText('Nenhuma empresa encontrada com fontes que sustentem o pedido.'),
  ).toBeVisible();
});

test('monitoramento nasce de uma pesquisa, pausa, retoma e roda agora', async ({ page }) => {
  await page.goto(runPath);
  await page.getByRole('link', { name: 'Monitorar este pedido' }).click();
  await expect(page).toHaveURL(/\/descoberta\/monitoramentos\?novo=1/);
  await expect(page.getByLabel(/^Pedido/)).toHaveValue(REQUEST);
  await page.getByRole('button', { name: 'Criar monitoramento' }).click();
  await expect(page.getByText('Monitoramento criado.')).toBeVisible();
  await expectNoA11yViolations(page);

  const monitor = page.getByRole('listitem').filter({ hasText: REQUEST });
  await monitor.getByRole('button', { name: 'Pausar' }).click();
  await expect(monitor.getByText('Pausado', { exact: true })).toBeVisible();
  // Pausar e Retomar ocupam o mesmo lugar: o foco fica no botão, e a lista anuncia.
  await expect(monitor.getByRole('button', { name: /^Retomar/ })).toBeFocused();
  await expect(announcement(page, 'pausado.')).toBeVisible();
  await monitor.getByRole('button', { name: 'Retomar' }).click();
  await expect(monitor.getByText('Ativo', { exact: true })).toBeVisible();
  await expect(announcement(page, 'retomado.')).toBeVisible();

  await monitor.getByRole('button', { name: 'Rodar agora' }).click();
  await expect(page).toHaveURL(/\/descoberta\/pesquisas\//);
  await expect(page.locator('#titulo-pesquisa')).toBeFocused();
  await expect(page.getByText('Execução do monitoramento')).toBeVisible();
  await expect(page.getByText('Pesquisa concluída.')).toBeVisible({ timeout: 30_000 });
});

test('endereço inexistente mostra "não encontrada" dentro da moldura', async ({ page }) => {
  await page.goto('/descoberta/pesquisas/00000000-0000-4000-8000-000000000000');
  await expect(
    page.getByRole('heading', { level: 1, name: 'Pesquisa não encontrada' }),
  ).toBeVisible();
  await page.goto('/descoberta/pesquisas/nao-existe');
  await expect(
    page.getByRole('heading', { level: 1, name: 'Pesquisa não encontrada' }),
  ).toBeVisible();
  await page.goto('/descoberta/empresas/00000000-0000-4000-8000-000000000000');
  await expect(
    page.getByRole('heading', { level: 1, name: 'Empresa não encontrada' }),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: 'Ver as empresas encontradas' })).toBeVisible();
});

test('início mostra oportunidades, radar e pesquisas; cabe no celular', async ({ page }) => {
  await page.goto('/descoberta');
  await expect(page.getByRole('heading', { name: 'Oportunidades' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Radar de sinais' })).toBeVisible();
  await expect(page.getByRole('link', { name: REQUEST }).first()).toBeVisible();

  // Oportunidades e radar: o sinal vem com o selo de verificação, o trecho e a fonte.
  const verification = /Confirmado na fonte|Hipótese a investigar/;
  const opportunities = page.getByRole('region', { name: 'Oportunidades' });
  await expect(opportunities.getByText('não chance de fechar negócio')).toBeVisible();
  await expect(opportunities.getByText(verification).first()).toBeVisible();
  await expect(opportunities.getByText('Fonte:').first()).toBeVisible();
  const radar = page.getByRole('region', { name: 'Radar de sinais' });
  await expect(radar.getByText(verification).first()).toBeVisible();
  await expect(radar.getByText('Fonte:').first()).toBeVisible();
  await expect(
    radar.getByTitle('Dados de demonstração: não representam empresas ou pessoas reais').first(),
  ).toBeVisible();

  await page.setViewportSize({ width: 375, height: 812 });
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Radar de sinais' })).toBeVisible();
  await expectNoHorizontalScroll(page);
  await expectNoA11yViolations(page);

  await page.goto(runPath);
  await expect(page.getByRole('heading', { level: 1, name: REQUEST })).toBeVisible();
  await expectNoHorizontalScroll(page);
});
