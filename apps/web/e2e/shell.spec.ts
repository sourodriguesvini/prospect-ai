import { expect, test, type Page } from '@playwright/test';
import { expectNoA11yViolations, gotoWithShortcuts } from './support';

/**
 * Menu lateral único (todos os menus à esquerda), paleta de comandos, atalhos de teclado,
 * indicadores do rodapé e linha de progresso. Servidor sem banco e com o Ollama apontando para
 * uma porta vazia (playwright.config.ts): os indicadores mostram esses estados.
 */

const sidebar = (page: Page) => page.locator('#menu-lateral');
const mainNav = (page: Page) => page.getByRole('navigation', { name: 'Principal' });

async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

test.describe('menu lateral no desktop', () => {
  test('todas as telas ficam no menu à esquerda, fixo ao rolar', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 600 });
    await page.goto('/configuracoes/auditoria');
    const nav = mainNav(page);
    for (const name of ['Início', 'Empresas', 'Copiloto', 'Configuração']) {
      await expect(nav.getByRole('link', { name, exact: true })).toBeVisible();
    }
    for (const name of ['Descoberta', 'Abordagens', 'Aprovações', 'Inteligência']) {
      await expect(nav.getByRole('link', { name: `${name} (em breve)` })).toBeVisible();
    }
    // Submenu da Configuração, com o item da tela atual destacado (um só).
    const sections = nav.getByRole('list', { name: 'Seções de Configuração' });
    await expect(sections.getByRole('link', { name: 'Auditoria' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(nav.locator('[aria-current="page"]')).toHaveCount(1);
    // Menu à esquerda do conteúdo e parado quando a página rola (conteúdo alto de propósito).
    await page.getByRole('main').evaluate((main) => {
      const spacer = document.createElement('div');
      spacer.style.height = '2000px';
      main.append(spacer);
    });
    const before = await sidebar(page).boundingBox();
    const main = await page.getByRole('main').boundingBox();
    expect(before!.x + before!.width).toBeLessThanOrEqual(main!.x);
    await page.mouse.move(800, 300);
    await page.mouse.wheel(0, 600);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
    expect((await sidebar(page).boundingBox())!.y).toBe(before!.y);
  });

  test('fora da Configuração o submenu fica fechado', async ({ page }) => {
    await page.goto('/empresas');
    await expect(mainNav(page).getByRole('link', { name: 'Empresas' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(page.getByRole('list', { name: 'Seções de Configuração' })).toHaveCount(0);
  });

  test('recolhe para só ícones, com dica, e a escolha volta do servidor', async ({
    page,
    context,
    baseURL,
  }) => {
    await page.goto('/');
    const toggle = page.getByRole('button', { name: 'Recolher menu' });
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(toggle).toHaveAttribute('aria-controls', 'menu-lateral');
    const wide = (await sidebar(page).boundingBox())!.width;

    await toggle.click();
    const expand = page.getByRole('button', { name: 'Expandir menu' });
    await expect(expand).toHaveAttribute('aria-expanded', 'false');
    await expect(sidebar(page)).toHaveAttribute('data-collapsed', 'true');
    expect((await sidebar(page).boundingBox())!.width).toBeLessThan(wide / 3);
    // Só ícones na tela, mas o nome acessível continua.
    const empresas = mainNav(page).getByRole('link', { name: 'Empresas' });
    await expect(empresas).toBeVisible();
    await empresas.hover();
    await expect(page.getByText('Empresas · G E')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByText('Empresas · G E')).toHaveCount(0);
    await expectNoA11yViolations(page);

    const cookies = await context.cookies(baseURL);
    expect(cookies.find((cookie) => cookie.name === 'sidebar')?.value).toBe('collapsed');
    // O HTML já chega recolhido (sem piscar ao carregar).
    const html = await (await page.request.get('/')).text();
    expect(html).toContain('data-collapsed="true"');
    await page.reload();
    await expect(sidebar(page)).toHaveAttribute('data-collapsed', 'true');

    await expand.click();
    await expect(sidebar(page)).toHaveAttribute('data-collapsed', 'false');
    const after = await context.cookies(baseURL);
    expect(after.find((cookie) => cookie.name === 'sidebar')?.value).toBe('expanded');
  });

  test('dica aparece pelo teclado no menu recolhido', async ({ page, context, baseURL }) => {
    await context.addCookies([{ name: 'sidebar', value: 'collapsed', url: baseURL! }]);
    await page.goto('/');
    await mainNav(page).getByRole('link', { name: 'Início' }).focus();
    await page.keyboard.press('Tab');
    await expect(mainNav(page).getByRole('link', { name: 'Descoberta (em breve)' })).toBeFocused();
    await expect(page.getByText('Descoberta (em breve) · G D')).toBeVisible();
    await page.keyboard.press('Tab');
    await expect(page.getByText('Empresas · G E')).toBeVisible();
    await expect(page.getByText('Descoberta (em breve) · G D')).toHaveCount(0);
  });

  test('Ctrl+B recolhe e expande', async ({ page }) => {
    await gotoWithShortcuts(page, '/');
    await page.keyboard.press('Control+b');
    await expect(sidebar(page)).toHaveAttribute('data-collapsed', 'true');
    await page.keyboard.press('Control+b');
    await expect(sidebar(page)).toHaveAttribute('data-collapsed', 'false');
  });

  test('tema escuro com o menu recolhido passa na acessibilidade', async ({
    page,
    context,
    baseURL,
  }) => {
    await context.addCookies([
      { name: 'theme', value: 'dark', url: baseURL! },
      { name: 'sidebar', value: 'collapsed', url: baseURL! },
    ]);
    await page.goto('/configuracoes/estrategia');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(sidebar(page)).toHaveAttribute('data-collapsed', 'true');
    await expectNoA11yViolations(page);
  });
});

test.describe('movimento', () => {
  test.describe('com movimento', () => {
    test.use({ reducedMotion: 'no-preference' });
    test('o menu anima ao recolher e os painéis entram com deslize', async ({ page }) => {
      await page.goto('/configuracoes');
      const duration = await sidebar(page).evaluate(
        (el) => getComputedStyle(el).transitionDuration,
      );
      expect(duration).toBe('0.3s');
      const panel = await page
        .locator('[data-panel]')
        .first()
        .evaluate((el) => getComputedStyle(el).animationName);
      expect(panel).toBe('panel-in');
    });
  });

  test('sem movimento quando o sistema pede menos movimento', async ({ page }) => {
    await page.goto('/configuracoes');
    const duration = await sidebar(page).evaluate((el) => getComputedStyle(el).transitionDuration);
    expect(parseFloat(duration)).toBeLessThan(0.001);
    const panel = await page
      .locator('[data-panel]')
      .first()
      .evaluate((el) => getComputedStyle(el).animationName);
    expect(panel).toBe('none');
  });
});

test.describe('gaveta no celular', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('abre pelo botão, prende o foco e fecha com Esc', async ({ page }) => {
    await page.goto('/');
    await expect(mainNav(page)).toBeHidden();
    await expectNoHorizontalScroll(page);
    const open = page.getByRole('button', { name: 'Abrir menu' });
    await expect(open).toHaveAttribute('aria-expanded', 'false');
    await expect(open).toHaveAttribute('aria-controls', 'menu-lateral');

    await open.click();
    const drawer = page.getByRole('dialog', { name: 'Menu lateral' });
    await expect(drawer).toBeVisible();
    await expect(drawer).toHaveAttribute('aria-modal', 'true');
    await expect(page.getByRole('button', { name: 'Fechar menu' })).toBeFocused();
    await expectNoA11yViolations(page);

    // Shift+Tab no primeiro (a marca) volta para o último (tema "Sistema"); Tab no último volta
    // para o primeiro.
    const brand = drawer.getByRole('link', { name: 'Prospector' });
    await page.keyboard.press('Shift+Tab');
    await expect(brand).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(drawer.getByRole('button', { name: 'Sistema' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(brand).toBeFocused();
    for (let i = 0; i < 25; i += 1) {
      await page.keyboard.press('Tab');
      const inside = await page.evaluate(() =>
        Boolean(document.activeElement?.closest('#menu-lateral')),
      );
      expect(inside).toBe(true);
    }

    await page.keyboard.press('Escape');
    await expect(drawer).toBeHidden();
    await expect(open).toBeFocused();
    await expect(open).toHaveAttribute('aria-expanded', 'false');
  });

  test('fecha com clique fora e ao escolher um item', async ({ page }) => {
    await page.goto('/');
    const open = page.getByRole('button', { name: 'Abrir menu' });
    await open.click();
    const drawer = page.getByRole('dialog', { name: 'Menu lateral' });
    await expect(drawer).toBeVisible();
    await page.mouse.click(360, 400);
    await expect(drawer).toBeHidden();

    // Clique fora devolve o foco ao botão do menu.
    await expect(open).toBeFocused();

    await open.click();
    await drawer.getByRole('link', { name: 'Configuração' }).click();
    await expect(page).toHaveURL(/\/configuracoes$/);
    await expect(drawer).toBeHidden();
    await expect(page.getByRole('heading', { level: 1, name: 'Configuração' })).toBeVisible();
    // Escolher uma tela leva o foco ao conteúdo (o link escolhido sumiu com a gaveta).
    await expect(page.getByRole('main')).toBeFocused();
  });

  test('busca aberta pela gaveta devolve o foco ao botão do menu', async ({ page }) => {
    await page.goto('/');
    const open = page.getByRole('button', { name: 'Abrir menu' });
    await open.click();
    await page
      .getByRole('dialog', { name: 'Menu lateral' })
      .getByRole('button', { name: /^Buscar ou ir para/ })
      .click();
    const palette = page.getByRole('dialog', { name: 'Paleta de comandos' });
    await expect(palette).toBeVisible();
    // Sem teclado, o fechar é um botão (no celular não há Esc).
    await palette.getByRole('button', { name: /^Fechar/ }).click();
    await expect(palette).toBeHidden();
    await expect(open).toBeFocused();
  });

  test('o topo com o botão do menu fica fixo ao rolar', async ({ page }) => {
    await page.goto('/configuracoes');
    await page.getByRole('main').evaluate((main) => {
      const spacer = document.createElement('div');
      spacer.style.height = '2000px';
      main.append(spacer);
    });
    await page.mouse.wheel(0, 800);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
    await expect(page.getByRole('button', { name: 'Abrir menu' })).toBeInViewport();
  });

  test('tema escuro com a gaveta aberta passa na acessibilidade', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/configuracoes/auditoria');
    await page.getByRole('button', { name: 'Abrir menu' }).click();
    await expect(page.getByRole('dialog', { name: 'Menu lateral' })).toBeVisible();
    await expectNoA11yViolations(page);
  });
});

test.describe('paleta de comandos', () => {
  test('Ctrl+K abre, filtra sem acento e Enter leva à tela', async ({ page }) => {
    await page.goto('/');
    const trigger = sidebar(page).getByRole('button', { name: /^Buscar ou ir para/ });
    await expect(trigger).toHaveAttribute('aria-keyshortcuts', 'Control+K');
    await trigger.focus();
    await page.keyboard.press('Control+k');
    const palette = page.getByRole('dialog', { name: 'Paleta de comandos' });
    await expect(palette).toBeVisible();
    const input = palette.getByRole('combobox', { name: 'Buscar telas, empresas e ações' });
    await expect(input).toBeFocused();
    await expectNoA11yViolations(page);

    await input.fill('conformidade');
    const first = palette.getByRole('option').first();
    await expect(first).toHaveAttribute('aria-selected', 'true');
    await expect(first).toContainText('Conformidade');
    await page.keyboard.press('ArrowDown');
    await expect(first).toHaveAttribute('aria-selected', 'false');
    await page.keyboard.press('ArrowUp');
    await expect(first).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/configuracoes\/conformidade$/);
    await expect(palette).toBeHidden();
  });

  test('sem resultado oferece buscar em Empresas e avisa que falta o banco; Esc fecha', async ({
    page,
  }) => {
    await page.goto('/');
    const trigger = sidebar(page).getByRole('button', { name: /^Buscar ou ir para/ });
    await trigger.click();
    const palette = page.getByRole('dialog', { name: 'Paleta de comandos' });
    await palette.getByRole('combobox').fill('xyzzy');
    const only = palette.getByRole('option');
    await expect(only).toHaveCount(1);
    await expect(only).toContainText('Buscar “xyzzy” em Empresas');
    // Sem banco, a paleta diz que não buscou (em vez de "nada encontrado").
    await expect(
      palette.getByText('A busca de empresas precisa do banco configurado.', { exact: true }),
    ).toBeVisible();
    await expect(palette.getByRole('status')).toContainText('1 resultado.');
    await page.keyboard.press('Escape');
    await expect(palette).toBeHidden();
    await expect(trigger).toBeFocused();

    await trigger.click();
    await palette.getByRole('combobox').fill('xyzzy');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/empresas\?busca=xyzzy$/);
  });

  test('troca o tema e recolhe o menu', async ({ page }) => {
    await gotoWithShortcuts(page, '/');
    await page.keyboard.press('Control+k');
    const palette = page.getByRole('dialog', { name: 'Paleta de comandos' });
    await palette.getByRole('combobox').fill('tema escuro');
    await page.keyboard.press('Enter');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

    await page.keyboard.press('Control+k');
    await palette.getByRole('combobox').fill('recolher');
    await page.keyboard.press('Enter');
    await expect(sidebar(page)).toHaveAttribute('data-collapsed', 'true');
  });

  test('mostra a linha de progresso enquanto a tela carrega', async ({ page }) => {
    // Atrasa a resposta da próxima tela (inclusive pré-carga) para a linha ter tempo de aparecer.
    await page.route(/\/configuracoes\/estrategia\/voz\?_rsc=/, async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1200));
      await route.continue();
    });
    await gotoWithShortcuts(page, '/');
    await page.keyboard.press('Control+k');
    await page.getByRole('combobox').fill('voz da agencia');
    await page.keyboard.press('Enter');
    const bar = page.locator('[data-phase]');
    await expect(bar).toHaveAttribute('data-phase', 'loading');
    await expect(page).toHaveURL(/\/configuracoes\/estrategia\/voz$/);
    await expect(bar).not.toHaveAttribute('data-phase', 'loading');
  });
});

test.describe('atalhos de teclado', () => {
  test('"g" e uma letra levam à tela; "?" mostra a lista', async ({ page }) => {
    await gotoWithShortcuts(page, '/');
    await page.keyboard.press('g');
    await page.keyboard.press('e');
    await expect(page).toHaveURL(/\/empresas$/);
    await page.keyboard.press('g');
    await page.keyboard.press('s');
    await expect(page).toHaveURL(/\/configuracoes$/);

    await page.keyboard.press('Shift+?');
    const dialog = page.getByRole('dialog', { name: 'Atalhos de teclado' });
    await expect(dialog).toBeVisible();
    await expectNoA11yViolations(page);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  });

  test('atalhos de uma tecla podem ser desligados (WCAG 2.1.4)', async ({ page }) => {
    await gotoWithShortcuts(page, '/');
    await page.keyboard.press('Shift+?');
    const dialog = page.getByRole('dialog', { name: 'Atalhos de teclado' });
    await dialog.getByRole('checkbox', { name: 'Atalhos de uma tecla (G e ?)' }).uncheck();
    await dialog.getByRole('button', { name: 'Fechar' }).click();
    await page.keyboard.press('g');
    await page.keyboard.press('e');
    await page.waitForTimeout(300);
    await expect(page).toHaveURL(/\/$/);
    // Ctrl+K continua valendo.
    await page.keyboard.press('Control+k');
    await expect(page.getByRole('dialog', { name: 'Paleta de comandos' })).toBeVisible();
  });

  test('não disparam enquanto se digita num campo', async ({ page }) => {
    await page.goto('/copiloto');
    const input = page.getByRole('textbox', { name: 'Mensagem para o Copiloto' });
    await input.click();
    await page.keyboard.type('ge');
    await expect(input).toHaveValue('ge');
    await expect(page).toHaveURL(/\/copiloto$/);
  });
});

test.describe('indicadores do rodapé', () => {
  test('mostram IA local, pesquisa e banco, cada um levando à tela que explica', async ({
    page,
  }) => {
    await page.goto('/');
    const status = page.getByRole('list', { name: 'Estado deste computador' });
    const ai = status.locator('[data-indicator="ia-local"]');
    await expect(ai).toContainText('Fora do ar');
    await expect(ai).toHaveAttribute('href', '/copiloto');
    await expect(status.locator('[data-indicator="pesquisa"]')).toContainText('Sem banco');
    await expect(status.locator('[data-indicator="banco"]')).toContainText('Não configurado');
    await expect(ai).toHaveAccessibleName(/^IA local\s*Fora do ar$/);
    await expect(ai).toHaveAccessibleDescription(/^O Ollama não está aberto/);
  });

  test('a rota de estado só lê e não devolve segredos', async ({ request }) => {
    const response = await request.get('/api/estado');
    expect(response.status()).toBe(200);
    expect(response.headers()['cache-control']).toBe('no-store');
    const body = (await response.json()) as { indicators: { id: string }[] };
    expect(body.indicators.map((item) => item.id)).toEqual(['ia-local', 'pesquisa', 'banco']);
    expect(JSON.stringify(body)).not.toMatch(/SECRET_KEY=|tvly-|https?:\/\//);
  });

  test('a busca de empresas sem banco responde lista vazia com o aviso', async ({ request }) => {
    const response = await request.get('/api/busca?q=teste');
    expect(response.status()).toBe(200);
    expect(await response.json()).toEqual({
      hits: [],
      error: 'A busca de empresas precisa do banco configurado.',
    });
    const long = await request.get(`/api/busca?q=${'a'.repeat(121)}`);
    expect(long.status()).toBe(400);
  });

  test('as rotas de leitura recusam pedido disparado por outro site', async ({ request }) => {
    for (const path of ['/api/estado', '/api/busca?q=teste']) {
      const response = await request.get(path, { headers: { 'sec-fetch-site': 'cross-site' } });
      expect(response.status()).toBe(403);
    }
  });
});
