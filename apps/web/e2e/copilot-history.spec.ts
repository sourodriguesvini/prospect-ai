import { expect, test } from '@playwright/test';
import { expectNoA11yViolations } from './support';

/**
 * IA-2 — conversas salvas do Copiloto, no servidor em modo memória (sem banco real) e sem
 * Ollama: a pergunta fica salva mesmo quando a IA falha, a conversa reabre pela URL e pode ser
 * renomeada e arquivada.
 */
test.describe('Copiloto: conversas salvas', () => {
  test.skip(process.env.E2E_OLLAMA === '1', 'só sem E2E_OLLAMA (porta sem servidor)');

  test('a pergunta fica salva, reabre pela URL, é renomeada e arquivada', async ({ page }) => {
    await page.goto('/copiloto');
    const question = `Quais ofertas eu tenho? ${Date.now()}`;
    const input = page.getByRole('textbox', { name: 'Mensagem para o Copiloto' });
    await input.fill(question);
    await input.press('Enter');

    const log = page.getByRole('log', { name: 'Conversa com o Copiloto' });
    await expect(log.getByRole('alert')).toContainText('Ollama não está respondendo');
    // A conversa nova passa a ter endereço próprio.
    await expect(page).toHaveURL(/\/copiloto\?conversa=[0-9a-f-]{36}$/);
    const address = page.url();

    // Recarregar reabre a conversa salva: a pergunta e a falha continuam lá.
    await page.goto(address);
    await expect(page.getByRole('heading', { level: 2, name: question })).toBeVisible();
    await expect(log.getByText(question)).toBeVisible();
    await expect(log.getByRole('alert')).toBeVisible();
    const list = page.getByRole('list', { name: 'Conversas salvas' });
    await expect(list.getByRole('link', { name: question })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expectNoA11yViolations(page);

    // Renomear.
    await list.getByRole('button', { name: `Renomear ${question}` }).click();
    const title = page.getByRole('textbox', { name: 'Nome da conversa' });
    await title.fill('Ofertas — teste e2e');
    await page.getByRole('button', { name: 'Salvar' }).click();
    await expect(list.getByRole('link', { name: /Ofertas — teste e2e/ })).toBeVisible();

    // Arquivar a conversa aberta volta para uma conversa nova; ela aparece nas arquivadas.
    await list.getByRole('button', { name: 'Arquivar Ofertas — teste e2e' }).click();
    await expect(page).toHaveURL(/\/copiloto$/);
    await expect(page.getByText(/Arquivadas \(\d+\)/)).toBeVisible();
    await expect(list.getByRole('link', { name: /Ofertas — teste e2e/ })).toHaveCount(0);
  });

  test('conversa inexistente avisa e oferece começar outra', async ({ page }) => {
    await page.goto('/copiloto?conversa=0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f');
    await expect(page.getByRole('note').filter({ hasText: 'não existe mais' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'Nova conversa' })).toBeVisible();
  });
});
