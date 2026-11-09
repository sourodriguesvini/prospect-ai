import { expect, test } from '@playwright/test';
import { expectNoA11yViolations } from './support';

const withOllama = process.env.E2E_OLLAMA === '1';
const ask = { schemaVersion: 1, messages: [{ role: 'user', content: 'oi' }] };

test.describe('Copiloto: rota protegida', () => {
  test('recusa pedido vindo de outro site (CSRF)', async ({ request }) => {
    const response = await request.post('/api/copiloto', {
      data: ask,
      headers: { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' },
    });
    expect(response.status()).toBe(403);
  });

  test('recusa pedido sem Origin: só a página do app usa o Copiloto', async ({ request }) => {
    // O cliente de API do Playwright, como curl, não envia Origin; o navegador sempre envia.
    const response = await request.post('/api/copiloto', { data: ask });
    expect(response.status()).toBe(403);
  });

  test('exige JSON e valida o contrato', async ({ request, baseURL }) => {
    const headers = { origin: baseURL!, 'sec-fetch-site': 'same-origin' };
    const text = await request.post('/api/copiloto', {
      headers: { ...headers, 'content-type': 'text/plain' },
      data: 'oi',
    });
    expect(text.status()).toBe(415);
    const invalid = await request.post('/api/copiloto', {
      headers,
      data: { schemaVersion: 1, messages: [{ role: 'assistant', content: 'oi' }] },
    });
    expect(invalid.status()).toBe(400);
    expect((await invalid.json()) as unknown).toEqual({
      error: 'A última mensagem precisa ser do usuário.',
    });
  });
});

test.describe('Copiloto sem Ollama', () => {
  test.skip(withOllama, 'só sem E2E_OLLAMA (porta sem servidor)');

  test('mostra o estado fora do ar e passa na acessibilidade', async ({ page }) => {
    await page.goto('/copiloto');
    await expect(page.getByRole('heading', { level: 1, name: 'Copiloto' })).toBeVisible();
    await expect(page.getByText('Ollama fora do ar')).toBeVisible();
    await expect(
      page.getByRole('status').filter({ hasText: 'Ollama não está respondendo' }),
    ).toBeVisible();
    await expectNoA11yViolations(page);
  });

  test('a rota responde em NDJSON com erro tratado', async ({ request, baseURL }) => {
    const response = await request.post('/api/copiloto', {
      data: ask,
      headers: { origin: baseURL!, 'sec-fetch-site': 'same-origin' },
    });
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain('application/x-ndjson');
    const events = (await response.text())
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { type: string; code?: string });
    expect(events).toEqual([
      expect.objectContaining({ type: 'error', code: 'runtime_unavailable' }),
    ]);
  });

  test('enviar uma pergunta mostra o erro na conversa, sem travar a tela', async ({ page }) => {
    await page.goto('/copiloto');
    const input = page.getByRole('textbox', { name: 'Mensagem para o Copiloto' });
    await input.fill('Que dia é hoje?');
    await input.press('Enter');
    const log = page.getByRole('log', { name: 'Conversa com o Copiloto' });
    await expect(log.getByText('Que dia é hoje?')).toBeVisible();
    await expect(log.getByRole('alert')).toContainText('Ollama não está respondendo');
    await expect(page.getByRole('button', { name: 'Enviar' })).toBeVisible();
    await expectNoA11yViolations(page);
  });
});

test.describe('Copiloto no celular e no tema escuro', () => {
  test.skip(withOllama, 'só sem E2E_OLLAMA (porta sem servidor)');

  test('no celular nada transborda e a pergunta volta para o campo depois do erro', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/copiloto');
    await expect(page.getByRole('heading', { level: 1, name: 'Copiloto' })).toBeVisible();
    await expect(page.getByRole('note')).toContainText('fora do ar');
    const input = page.getByRole('textbox', { name: 'Mensagem para o Copiloto' });
    const question = `Veja https://exemplo.invalid/${'a'.repeat(300)}`;
    await input.fill(question);
    await input.press('Enter');
    const log = page.getByRole('log', { name: 'Conversa com o Copiloto' });
    await expect(log.getByRole('alert')).toContainText('Ollama não está respondendo');
    await expect(input).toHaveValue(question);
    await expect(page.getByRole('button', { name: 'Tentar de novo' })).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    await expectNoA11yViolations(page);
  });

  test('tema escuro passa na acessibilidade', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/copiloto');
    await expect(page.getByText('Ollama fora do ar')).toBeVisible();
    await expectNoA11yViolations(page);
  });
});

test.describe('Copiloto com Ollama real', () => {
  test.skip(!withOllama, 'requer E2E_OLLAMA=1 e o Ollama aberto com o modelo do Copiloto');

  test('gera uma resposta real e mostra as métricas', async ({ page }) => {
    test.setTimeout(180_000);
    await page.goto('/copiloto');
    await expect(page.getByText(/Ollama .* conectado/)).toBeVisible();
    const input = page.getByRole('textbox', { name: 'Mensagem para o Copiloto' });
    await input.fill('Responda em uma frase: que dia é hoje?');
    await input.press('Enter');
    const log = page.getByRole('log', { name: 'Conversa com o Copiloto' });
    await expect(log.getByText(/tokens\/s/)).toBeVisible({ timeout: 150_000 });
    await expect(log.getByRole('alert')).toHaveCount(0);
    await expectNoA11yViolations(page);
  });
});
