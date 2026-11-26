import { request as httpRequest } from 'node:http';
import { expect, test } from '@playwright/test';
import { expectNoA11yViolations } from './support';

/** GET cru com cabeçalho Host arbitrário (o fetch do navegador não deixa trocar o Host). */
function getWithHost(baseURL: string, host: string): Promise<{ status: number; body: string }> {
  const url = new URL(baseURL);
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      { hostname: url.hostname, port: url.port, path: '/', method: 'GET', headers: { host } },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => (body += chunk));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
      },
    );
    req.on('error', reject);
    req.end();
  });
}

/** Com E2E_SUPABASE=1 o servidor usa o banco real; o estado "conectado" é coberto por database.spec.ts. */
const withDatabase = process.env.E2E_SUPABASE === '1';
const DATABASE_ON = 'com E2E_SUPABASE=1 o banco está ligado (ver database.spec.ts)';

test.describe('telas (sem banco configurado)', () => {
  test('Hoje avisa que o banco não está pronto e as Configurações mostram o estado', async ({
    page,
  }) => {
    test.skip(withDatabase, DATABASE_ON);
    await page.goto('/');
    await expect(
      // O leitor de tela ouve "Hoje: Bom dia" (o nome da tela vem antes da saudação).
      page.getByRole('heading', { level: 1, name: /^Hoje: (Bom dia|Boa tarde|Boa noite)$/ }),
    ).toBeVisible();
    await expect(page.getByRole('link', { name: 'Hoje' })).toHaveAttribute('aria-current', 'page');
    // Hoje só fala do sistema quando ele pede atenção, com o caminho para o detalhe.
    const notice = page.locator('[data-system="not_configured"]');
    await expect(notice).toContainText('O banco de dados não está pronto');
    await expectNoA11yViolations(page);
    await notice.getByRole('link', { name: 'Ver detalhes em Configurações' }).click();
    await expect(page).toHaveURL(/\/configuracoes#sistema$/);
    const status = page.locator('[data-status]');
    await expect(status).toHaveAttribute('data-status', 'not_configured');
    await expect(status).toContainText('Não configurado');
    await expect(status).toContainText('SUPABASE_URL');
  });

  test('não há tela de login nem pedido de credenciais', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('input[type="password"]')).toHaveCount(0);
    await expect(page.getByRole('link', { name: /^(entrar|sair)$/i })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^(entrar|sair)$/i })).toHaveCount(0);
  });

  for (const { name, path, inMenu } of [
    { name: 'Monitoramento', path: '/monitoramento', inMenu: false },
    { name: 'Resultados', path: '/inteligencia', inMenu: true },
  ]) {
    test(`${name} sem banco explica o estado em vez de mostrar números`, async ({ page }) => {
      test.skip(withDatabase, DATABASE_ON);
      if (inMenu) {
        await page.goto('/');
        await page
          .getByRole('navigation', { name: 'Principal' })
          .getByRole('link', { name, exact: true })
          .click();
      } else {
        // Fora do menu desde a proposta de 26/11: o endereço continua o mesmo.
        await page.goto(path);
      }
      await expect(page).toHaveURL(new RegExp(`${path}$`));
      await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
      await expect(
        page.getByRole('status').filter({ hasText: 'O banco de dados ainda não foi configurado' }),
      ).toBeVisible();
      await expect(page.getByText('Em breve')).toHaveCount(0);
      // Na navegação pelo cliente, o Next troca o <title> depois do conteúdo: espera antes do axe.
      await expect(page).toHaveTitle(new RegExp(name));
      await expectNoA11yViolations(page);
    });
  }

  test('Descobrir sem banco explica o estado em vez de pesquisar', async ({ page }) => {
    test.skip(withDatabase, DATABASE_ON);
    await page.goto('/');
    await page
      .getByRole('navigation', { name: 'Principal' })
      .getByRole('link', { name: 'Descobrir', exact: true })
      .click();
    await expect(page).toHaveURL(/\/descoberta$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Descobrir' })).toBeVisible();
    await expect(
      page.getByRole('status').filter({ hasText: 'O banco de dados ainda não foi configurado' }),
    ).toBeVisible();
    await expectNoA11yViolations(page);
  });

  test('Configurações levam ao histórico de ações, que avisa que o banco não está configurado', async ({
    page,
  }) => {
    test.skip(withDatabase, DATABASE_ON);
    await page.goto('/configuracoes');
    await expect(page.getByRole('heading', { level: 1, name: 'Configurações' })).toBeVisible();
    // O menu lateral também tem o Histórico de ações (submenu): aqui é o cartão da tela.
    await page
      .getByRole('main')
      .getByRole('link', { name: /Histórico de ações/ })
      .click();
    await expect(page).toHaveURL(/\/configuracoes\/auditoria$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Histórico de ações' })).toBeVisible();
    await expect(
      page.getByRole('status').filter({ hasText: 'O banco de dados ainda não foi configurado' }),
    ).toBeVisible();
    // Na navegação pelo cliente, o Next troca o <title> depois do conteúdo: espera antes do axe.
    await expect(page).toHaveTitle(/Histórico de ações/);
    await expectNoA11yViolations(page);
  });

  test('e-mail sem banco avisa e não mostra formulário', async ({ page }) => {
    test.skip(withDatabase, DATABASE_ON);
    await page.goto('/configuracoes/email');
    await expect(page.getByRole('heading', { level: 1, name: 'E-mail' })).toBeVisible();
    await expect(
      page.getByRole('status').filter({ hasText: 'O banco de dados ainda não foi configurado' }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Salvar identidade' })).toHaveCount(0);
    await expectNoA11yViolations(page);
  });

  for (const path of ['/entrar', '/cadastro', '/app', '/o/qualquer', '/convite/abc', '/nada']) {
    test(`rota inexistente ${path} responde 404`, async ({ page }) => {
      const response = await page.goto(path);
      expect(response?.status()).toBe(404);
      await expect(page.getByRole('heading', { name: 'Página não encontrada' })).toBeVisible();
    });
  }
});

test.describe('tema', () => {
  test('tema escuro aplica os tokens e mantém o contraste', async ({ page, context, baseURL }) => {
    await context.addCookies([{ name: 'theme', value: 'dark', url: baseURL! }]);
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(page.getByRole('button', { name: 'Escuro' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expectNoA11yViolations(page);
  });

  test('troca de tema funciona pelo formulário', async ({ page }) => {
    await page.goto('/configuracoes');
    await page.getByRole('button', { name: 'Escuro' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.getByRole('button', { name: 'Sistema' }).click();
    await expect(page.locator('html')).not.toHaveAttribute('data-theme', /.+/);
  });
});

test.describe('proteção (ADR-0007)', () => {
  test('Host externo é recusado com 403 (DNS rebinding)', async ({ baseURL }) => {
    const external = await getWithHost(baseURL!, 'evil.example:3100');
    expect(external.status).toBe(403);
    expect(external.body).not.toContain('Prospector</');
    const local = await getWithHost(baseURL!, `localhost:${new URL(baseURL!).port}`);
    expect(local.status).toBe(200);
  });

  test('escrita sem Origin ou de outro site é recusada (KI-064)', async ({ request, baseURL }) => {
    // Server Actions e rotas POST passam pelo mesmo filtro; o navegador sempre manda Origin.
    const variants: Record<string, string>[] = [
      {},
      { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' },
      { origin: baseURL!, 'sec-fetch-site': 'cross-site' },
    ];
    for (const headers of variants) {
      const response = await request.post('/configuracoes', { headers, data: 'x' });
      expect(response.status()).toBe(403);
      expect(await response.text()).toContain('Origem não permitida');
    }
  });

  test('CSP com nonce e proteção contra enquadramento', async ({ request }) => {
    const response = await request.get('/');
    const headers = response.headers();
    expect(headers['content-security-policy']).toMatch(
      /script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/,
    );
    expect(headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(headers['x-frame-options']).toBe('DENY');
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['x-powered-by']).toBeUndefined();
  });
});
