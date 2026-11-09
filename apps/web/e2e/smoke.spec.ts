import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

async function expectNoA11yViolations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  const summary = results.violations.map(
    (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`,
  );
  expect(summary).toEqual([]);
}

test.describe('telas públicas', () => {
  test('entrar renderiza com rótulos e sem violações de acessibilidade', async ({ page }) => {
    await page.goto('/entrar');
    await expect(page.getByRole('heading', { level: 1, name: 'Entrar' })).toBeVisible();
    await expect(page.getByLabel('E-mail')).toBeVisible();
    await expect(page.getByLabel('Senha')).toBeVisible();
    await expectNoA11yViolations(page);
  });

  test('cadastro renderiza e valida campos no servidor', async ({ page }) => {
    await page.goto('/cadastro');
    await expect(page.getByRole('heading', { level: 1, name: 'Criar conta' })).toBeVisible();
    await expectNoA11yViolations(page);

    await page.getByLabel('Nome').fill('A');
    await page.getByLabel('E-mail de trabalho').fill('nao-e-email');
    await page.getByLabel('Senha').fill('curta');
    await page.getByRole('button', { name: 'Criar conta' }).click();

    await expect(page.getByText('Revise os campos destacados.')).toBeVisible();
    await expect(page.getByLabel('E-mail de trabalho')).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByLabel('E-mail de trabalho')).toHaveValue('nao-e-email');
    await expect(page.getByText('Use ao menos 10 caracteres.')).toBeVisible();
  });

  test('tema escuro aplica os tokens e mantém o contraste', async ({ page, context, baseURL }) => {
    await context.addCookies([{ name: 'theme', value: 'dark', url: baseURL! }]);
    await page.goto('/entrar');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(page.getByRole('button', { name: 'Escuro' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expectNoA11yViolations(page);
  });

  test('troca de tema funciona pelo formulário', async ({ page }) => {
    await page.goto('/entrar');
    await page.getByRole('button', { name: 'Escuro' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.getByRole('button', { name: 'Sistema' }).click();
    await expect(page.locator('html')).not.toHaveAttribute('data-theme', /.+/);
  });
});

test.describe('proteção de rotas', () => {
  for (const path of [
    '/app',
    '/app/nova-organizacao',
    '/o/qualquer',
    '/o/qualquer/configuracoes/equipe',
    '/convite/abc',
  ]) {
    test(`sem sessão, ${path} redireciona para entrar`, async ({ page }) => {
      await page.goto(path);
      await expect(page).toHaveURL(
        (url) => url.pathname === '/entrar' && url.searchParams.get('next') === path,
      );
    });
  }

  test('next externo é ignorado (sem open redirect)', async ({ page }) => {
    await page.goto('/entrar?next=https://evil.example/');
    await expect(page.locator('input[name="next"]')).toHaveValue('/app');
    await page.goto('/entrar?next=//evil.example');
    await expect(page.locator('input[name="next"]')).toHaveValue('/app');
  });

  test('link de confirmação inválido volta para entrar com aviso', async ({ page }) => {
    await page.goto('/auth/confirm?token_hash=invalido&type=nao-suportado');
    await expect(page).toHaveURL(/\/entrar\?erro=link/);
    await expect(page.getByRole('alert').filter({ hasText: 'link de confirmação' })).toBeVisible();
  });

  test('abrir o link de confirmação não cria sessão: exige clicar em confirmar', async ({
    page,
  }) => {
    await page.goto('/auth/confirm?token_hash=abc123&type=email&next=/app');
    await expect(page).toHaveURL(/\/auth\/confirm\?/);
    await expect(page.getByRole('heading', { name: 'Confirmar e-mail' })).toBeVisible();
    const cookies = await page.context().cookies();
    expect(cookies.filter((cookie) => cookie.name.startsWith('sb-'))).toEqual([]);
    await expect(page.getByRole('button', { name: 'Confirmar e entrar' })).toBeVisible();
    await expectNoA11yViolations(page);
  });
});

test.describe('cabeçalhos de segurança', () => {
  test('CSP com nonce e proteção contra enquadramento', async ({ request }) => {
    const response = await request.get('/entrar');
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
