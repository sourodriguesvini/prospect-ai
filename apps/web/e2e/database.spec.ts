import { expect, test } from '@playwright/test';

/**
 * Só com E2E_SUPABASE=1 e um projeto Supabase de desenvolvimento com as migrações aplicadas
 * (docs/runbooks/ambiente-local.md). Lê o banco; não grava nada.
 */
test.skip(process.env.E2E_SUPABASE !== '1', 'requer E2E_SUPABASE=1 e banco de desenvolvimento');

test('Configurações mostram o banco conectado e Hoje não avisa nada', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('[data-system]')).toHaveCount(0);
  await page.goto('/configuracoes');
  await expect(page.locator('[data-status]')).toHaveAttribute('data-status', 'ok');
});

test('o histórico de ações lê o banco sem aviso de indisponibilidade', async ({ page }) => {
  await page.goto('/configuracoes/auditoria');
  await expect(page.getByRole('heading', { level: 1, name: 'Histórico de ações' })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'banco' })).toHaveCount(0);
  await expect(page.getByRole('table').or(page.getByText('Nenhum registro ainda.'))).toBeVisible();
});
