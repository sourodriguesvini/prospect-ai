import { expect, test } from '@playwright/test';
import { expectNoA11yViolations } from './support';

/**
 * Pesquisa extensa do Copiloto (Partes 6.2 a 6.5), no servidor da Descoberta em modo memória com
 * buscador SINTÉTICO (src/server/research-fixture.ts): o pedido vira pesquisa na fila, roda em
 * lotes, os achados aparecem na tela de revisão com a fonte, e um pedido seguinte na mesma
 * conversa muda a mesma pesquisa. Sem internet, sem créditos e sem GPU; tudo sai marcado DEMO.
 */
test.describe.configure({ mode: 'serial' });

test.describe('Copiloto: pesquisa extensa', () => {
  test.skip(process.env.E2E_OLLAMA === '1', 'só sem E2E_OLLAMA (porta sem servidor)');

  test('pedido vira pesquisa, os achados aparecem com a fonte e a mudança vale na conversa', async ({
    page,
  }) => {
    await page.goto('/copiloto');
    const input = page.getByRole('textbox', { name: 'Mensagem para o Copiloto' });
    await input.fill(
      'Quero encontrar 6 terapeutas ocupacionais no Brasil para apresentar a Blummy.',
    );
    await input.press('Enter');

    const log = page.getByRole('log', { name: 'Conversa com o Copiloto' });
    // Respondido por regra, sem o modelo (o Ollama está fora do ar neste servidor).
    await expect(log).toContainText('Vou pesquisar 6 terapeutas ocupacionais para Blummy');
    await expect(log).toContainText('Nada é enviado a ninguém');
    await expect(log.getByRole('alert')).toHaveCount(0);
    await expect(page).toHaveURL(/\/copiloto\?conversa=[0-9a-f-]{36}$/);

    // A tela de revisão: a pesquisa roda em segundo plano e termina sozinha.
    await log.getByRole('link', { name: 'Ver a pesquisa' }).click();
    await expect(page).toHaveURL(/\/copiloto\/pesquisas\/[0-9a-f-]{36}$/);
    await expect(page.getByRole('heading', { level: 1 })).toContainText(
      '6 terapeutas ocupacionais',
    );
    await expect(page.getByText('DADOS DE DEMONSTRAÇÃO', { exact: false }).first()).toBeVisible();
    await expect(page.getByRole('group', { name: 'Estado da pesquisa' })).toContainText(
      'Pesquisa concluída',
      { timeout: 30_000 },
    );
    const table = page.getByRole('table', { name: /Resultados da pesquisa/ });
    await expect(table.getByRole('row')).toHaveCount(7);
    // Caso 2 (Parte 8): distribuição por região, segmento e papel, contada do que foi guardado.
    const spread = page.getByRole('region', { name: 'Como os achados se distribuem' });
    await expect(spread).toContainText('Por região');
    await expect(spread).toContainText('Papel provável para o perfil');
    // Cada achado tem a fonte e o trecho; sem LIA aprovada, a pessoa fica só para revisão.
    await expect(table.getByRole('link', { name: 'diretorio-demo.test' }).first()).toBeVisible();
    await expect(table.getByText('Só para revisão').first()).toBeVisible();
    await expect(page.getByRole('link', { name: 'Baixar CSV' })).toHaveAttribute(
      'href',
      /\/api\/copiloto\/pesquisas\/[0-9a-f-]{36}\/csv$/,
    );
    await expectNoA11yViolations(page);

    // De volta à conversa: o cartão da pesquisa está na coluna, e "mais 4" muda a mesma pesquisa.
    await page.getByRole('link', { name: 'Voltar à conversa' }).click();
    await expect(page.getByRole('region', { name: 'Pesquisas desta conversa' })).toContainText(
      '6 terapeutas ocupacionais',
    );
    const next = page.getByRole('textbox', { name: 'Mensagem para o Copiloto' });
    await next.fill('mais 4, agora priorize o PR');
    await next.press('Enter');
    await expect(log).toContainText('Prioridade para PR; quantidade pedida passa a 10');
    await expect(log).toContainText('Próximas buscas: Londrina (PR)');
  });

  test('o CSV sai com os achados e só para as telas do app', async ({ page, request }) => {
    await page.goto('/copiloto/pesquisas');
    await page
      .getByRole('link', { name: /terapeutas ocupacionais/ })
      .first()
      .click();
    const href = await page.getByRole('link', { name: 'Baixar CSV' }).getAttribute('href');
    expect(href).toBeTruthy();
    const csv = await request.get(href!, { headers: { 'sec-fetch-site': 'same-origin' } });
    expect(csv.status()).toBe(200);
    expect(csv.headers()['content-type']).toContain('text/csv');
    const text = await csv.text();
    expect(text.split('\r\n')[0]).toContain('tipo;nome;profissao');
    expect(text).toContain('Demo ');
    const foreign = await request.get(href!, { headers: { 'sec-fetch-site': 'cross-site' } });
    expect(foreign.status()).toBe(403);
  });

  test('opt-out pela tela é confirmado, avisado e tira a pessoa da planilha', async ({
    page,
    request,
  }) => {
    await page.goto('/copiloto/pesquisas');
    await page
      .getByRole('link', { name: /terapeutas ocupacionais/ })
      .first()
      .click();
    const table = page.getByRole('table', { name: /Resultados da pesquisa/ });
    const row = table.getByRole('row').filter({ hasText: 'Só para revisão' }).first();
    const name = (await row.getByRole('rowheader').locator('span').first().innerText()).trim();
    await row.getByText('Registrar opt-out').click();
    await row.getByRole('button', { name: `Confirmar opt-out de ${name}` }).click();
    await expect(page).toHaveURL(/\?aviso=opt-out$/);
    await expect(page.getByRole('note').filter({ hasText: 'Opt-out registrado' })).toBeVisible();
    await expect(
      table.getByRole('row').filter({ hasText: name }).getByText('Pediu para não ser contatada'),
    ).toBeVisible();
    // O foco vai para o título (o botão apertado sumiu).
    await expect(page.locator('#titulo-pesquisa')).toBeFocused();

    const href = await page.getByRole('link', { name: 'Baixar CSV' }).getAttribute('href');
    const csv = await request.get(href!, { headers: { 'sec-fetch-site': 'same-origin' } });
    const text = await csv.text();
    expect(text.split('\r\n')[0]).toContain('coberto_pela_lia;lia_versao');
    expect(text).not.toContain(name);
  });

  test('no celular e no modo escuro: cartões, sem rolagem lateral e sem falha de acessibilidade', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/copiloto/pesquisas');
    await page
      .getByRole('link', { name: /terapeutas ocupacionais/ })
      .first()
      .click();
    const cards = page.getByRole('list', { name: 'Resultados da pesquisa' });
    await expect(cards).toBeVisible();
    await expect(cards.getByRole('listitem').first()).toContainText('Visto na fonte em');
    await expect(page.getByRole('table', { name: /Resultados da pesquisa/ })).toBeHidden();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    await expectNoA11yViolations(page);
  });
});
