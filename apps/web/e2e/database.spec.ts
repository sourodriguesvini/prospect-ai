import { expect, test } from '@playwright/test';

/**
 * Só com E2E_SUPABASE=1 e um projeto Supabase de desenvolvimento com as migrações aplicadas
 * (docs/runbooks/ambiente-local.md). Lê o banco; não grava nada.
 */
test.skip(process.env.E2E_SUPABASE !== '1', 'requer E2E_SUPABASE=1 e banco de desenvolvimento');

test('início mostra o banco conectado', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('[data-status]')).toHaveAttribute('data-status', 'ok');
});

test('auditoria lê o banco sem aviso de indisponibilidade', async ({ page }) => {
  await page.goto('/configuracoes/auditoria');
  await expect(page.getByRole('heading', { level: 1, name: 'Auditoria' })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'banco' })).toHaveCount(0);
  await expect(page.getByRole('table').or(page.getByText('Nenhum registro ainda.'))).toBeVisible();
});
