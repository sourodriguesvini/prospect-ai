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

test.describe('telas (sem banco configurado)', () => {
  test('início mostra o estado do banco e passa na acessibilidade', async ({ page }) => {
    await page.goto('/');
    await expect(
      page.getByRole('heading', { level: 1, name: /^(Bom dia|Boa tarde|Boa noite)$/ }),
    ).toBeVisible();
    await expect(page.getByRole('link', { name: 'Início' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    const status = page.locator('[data-status]');
    await expect(status).toHaveAttribute('data-status', 'not_configured');
    await expect(status).toContainText('Não configurado');
    await expect(status).toContainText('SUPABASE_URL');
    await expectNoA11yViolations(page);
  });

  test('não há tela de login nem pedido de credenciais', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('input[type="password"]')).toHaveCount(0);
    await expect(page.getByRole('link', { name: /^(entrar|sair)$/i })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^(entrar|sair)$/i })).toHaveCount(0);
  });

  test('módulo planejado mostra "Em breve" sem dados simulados', async ({ page }) => {
    await page.goto('/');
    await page
      .getByRole('navigation', { name: 'Principal' })
      .getByRole('link', { name: /Empresas/ })
      .click();
    await expect(page).toHaveURL(/\/empresas$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Empresas' })).toBeVisible();
    await expect(page.getByText('Em breve.')).toBeVisible();
    await expectNoA11yViolations(page);
  });

  test('configuração leva à auditoria, que avisa que o banco não está configurado', async ({
    page,
  }) => {
    await page.goto('/configuracoes');
    await expect(page.getByRole('heading', { level: 1, name: 'Configuração' })).toBeVisible();
    await page.getByRole('link', { name: /Auditoria/ }).click();
    await expect(page).toHaveURL(/\/configuracoes\/auditoria$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Auditoria' })).toBeVisible();
    await expect(
      page.getByRole('status').filter({ hasText: 'O banco de dados ainda não foi configurado' }),
    ).toBeVisible();
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
