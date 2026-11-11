import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/**
 * F2 — Estratégia e barreira das abordagens, de ponta a ponta, no servidor em modo memória
 * (playwright.config.ts, projeto "estrategia-memoria"). Os testes formam uma história e rodam em
 * série sobre o mesmo servidor, que sobe vazio.
 *
 * Em modo memória a abordagem nunca é liberada (a LIA aprovada sumiria ao reiniciar): o item
 * "Banco de dados persistente" fica sempre pendente. Por isso a história confere que, com tudo
 * configurado, ele é o único item que falta; a liberação completa é coberta pelos testes do
 * serviço e do domínio.
 */
test.describe.configure({ mode: 'serial' });

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

async function expectNoA11yViolations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  const summary = results.violations.map(
    (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`,
  );
  expect(summary).toEqual([]);
}

const OFFER_NAME = 'Oferta E2E de rebranding';
let offerPath = '';

function readinessItem(page: Page, code: string) {
  return page.locator(`[data-readiness="${code}"]`).first();
}

/** Códigos dos itens obrigatórios pendentes do checklist de /abordagens (case citável é só recomendado). */
async function missingApproachItems(page: Page): Promise<string[]> {
  const missing = page.locator(
    '[data-gate-ready] [data-readiness][data-ok="false"][data-blocking="true"]',
  );
  return (await missing.evaluateAll((nodes) =>
    nodes.map((n) => n.getAttribute('data-readiness') ?? ''),
  )) as string[];
}

test('abordagens começam bloqueadas, com a explicação do que falta', async ({ page }) => {
  await page.goto('/abordagens');
  await expect(page.getByRole('heading', { level: 1, name: 'Abordagens' })).toBeVisible();
  await expect(page.getByRole('alert').filter({ hasText: 'Modo memória' })).toHaveCount(0);
  const gate = page.locator('[data-gate-ready]');
  await expect(gate).toHaveAttribute('data-gate-ready', 'false');
  await expect(gate).toContainText('Bloqueado');
  await expect(readinessItem(page, 'lia_approved')).toHaveAttribute('data-ok', 'false');
  await expect(readinessItem(page, 'lia_approved')).toContainText('Nenhuma LIA registrada');
  await expect(readinessItem(page, 'offer_active')).toHaveAttribute('data-ok', 'false');
  await expect(readinessItem(page, 'persistent_storage')).toHaveAttribute('data-ok', 'false');
  await expect(readinessItem(page, 'persistent_storage')).toContainText('Modo memória');
  // Cada item pendente com correção possível leva à tela que resolve.
  await expect(
    readinessItem(page, 'lia_approved').getByRole('link', { name: /Resolver/ }),
  ).toHaveAttribute('href', '/configuracoes/conformidade');
  await expectNoA11yViolations(page);
});

test('configura oferta, rubrica, score e ICP; pesos inválidos são recusados', async ({ page }) => {
  await page.goto('/configuracoes');
  // O cartão da tela (o menu lateral também tem Estratégia, no submenu da Configuração).
  await page
    .getByRole('main')
    .getByRole('link', { name: /Estratégia/ })
    .click();
  await expect(page.getByRole('heading', { level: 1, name: 'Estratégia' })).toBeVisible();
  await expect(page.getByRole('note').filter({ hasText: 'Modo memória' })).toBeVisible();
  await expect(page.getByText('Nenhuma oferta ainda.')).toBeVisible();
  await expectNoA11yViolations(page);

  // Oferta
  await page.getByRole('link', { name: 'Nova oferta' }).click();
  await page.getByLabel('Nome da oferta').fill(OFFER_NAME);
  await page.getByLabel('Descrição').fill('Identidade visual completa para empresas de serviço.');
  await page.getByLabel('Problemas que resolve').fill('Marca desatualizada\nCanais sem unidade');
  await page.getByLabel('Sinais de necessidade').fill('Site antigo');
  await page.getByLabel('Desqualificadores').fill('Marca refeita há menos de um ano');
  await page.getByLabel('Entregáveis').fill('Logotipo\nManual de marca');
  await page.getByLabel('Mínimo', { exact: true }).fill('15.000,00');
  await page.getByLabel('Máximo', { exact: true }).fill('40.000,00');
  await page.getByRole('button', { name: 'Criar oferta' }).click();

  await expect(page.getByRole('heading', { level: 1, name: OFFER_NAME })).toBeVisible();
  offerPath = new URL(page.url()).pathname;
  expect(offerPath).toMatch(/^\/configuracoes\/estrategia\/ofertas\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('note').filter({ hasText: 'Para ativar, falta' })).toContainText(
    'rubrica',
  );
  await expectNoA11yViolations(page);

  // Rubrica: padrão do Prospector; soma diferente de 100 é recusada.
  await page.getByRole('link', { name: 'Criar rubrica' }).click();
  await expect(page.getByText('Padrão do Prospector — revise antes de salvar')).toBeVisible();
  const rubricTotal = page.locator('[data-weight-total]');
  await expect(rubricTotal).toHaveAttribute('data-weight-total', '100');
  const firstWeight = page.getByLabel('Peso').first();
  await firstWeight.fill('25');
  await expect(rubricTotal).toHaveAttribute('data-weight-total', '105');
  await page.getByRole('button', { name: 'Salvar rubrica' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Revise' })).toBeVisible();
  await expect(page.getByText('Os pesos somam 105; precisam somar exatamente 100.')).toBeVisible();
  expect(new URL(page.url()).pathname).toBe(`${offerPath}/rubrica`);
  await expectNoA11yViolations(page);
  await firstWeight.fill('20');
  await page.getByRole('button', { name: 'Salvar rubrica' }).click();
  await expect(page).toHaveURL(new RegExp(`${offerPath}$`));
  await expect(page.getByRole('link', { name: 'Editar rubrica' })).toBeVisible();

  // Modelo de score: mesma regra.
  await page.getByRole('link', { name: 'Criar modelo' }).click();
  const fit = page.getByLabel('Adequação');
  await fit.fill('30');
  await expect(page.locator('[data-weight-total]')).toHaveAttribute('data-weight-total', '105');
  await page.getByRole('button', { name: 'Salvar modelo de score' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Revise' })).toBeVisible();
  expect(new URL(page.url()).pathname).toBe(`${offerPath}/score`);
  await fit.fill('25');
  await page.getByRole('button', { name: 'Salvar modelo de score' }).click();
  await expect(page).toHaveURL(new RegExp(`${offerPath}$`));
  await expect(page.getByRole('link', { name: 'Editar modelo' })).toBeVisible();

  // Ativar a oferta.
  await page.getByRole('button', { name: 'Ativar oferta' }).click();
  await expect(page.getByRole('button', { name: 'Voltar para rascunho' })).toBeVisible();
  await expect(page.getByText('Ativa', { exact: true }).first()).toBeVisible();

  // ICP: sem filtro não ativa; com UF ativa.
  await page.getByRole('link', { name: 'Novo ICP' }).click();
  await page.getByLabel('Nome do ICP').fill('ICP E2E');
  await page.getByRole('button', { name: 'Criar ICP' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'ICP E2E' })).toBeVisible();
  await expect(page.getByRole('note').filter({ hasText: 'Para ativar, falta' })).toContainText(
    'ao menos um CNAE, UF ou município',
  );
  await page.getByRole('checkbox', { name: 'PR', exact: true }).check();
  await page.getByRole('button', { name: 'Salvar nova versão' }).click();
  await expect(page.getByText('Versão 2.')).toBeVisible();
  await page.getByRole('button', { name: 'Ativar ICP' }).click();
  await expect(page.getByRole('button', { name: 'Pausar' })).toBeVisible();
  await expectNoA11yViolations(page);

  // Descoberta liberada.
  await page.goto('/configuracoes/estrategia');
  const discover = page.locator('section[aria-labelledby="prontidao-descobrir"]');
  await expect(discover).toHaveAttribute('data-gate-ready', 'true');
});

test('editar a oferta cria a versão 2 e mantém a 1 no histórico', async ({ page }) => {
  test.skip(!offerPath, 'depende do teste anterior');
  await page.goto(offerPath);
  await page.getByRole('link', { name: 'Editar oferta' }).click();
  await expect(page.getByText('Salvar cria a versão 2')).toBeVisible();

  // Sem mudanças, nada é salvo.
  await page.getByRole('button', { name: 'Salvar nova versão' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Nenhuma alteração' })).toBeVisible();

  await page.getByLabel('Descrição').fill('Identidade visual e site para empresas de serviço.');
  await page.getByRole('button', { name: 'Salvar nova versão' }).click();
  await expect(page).toHaveURL(new RegExp(`${offerPath}$`));
  await expect(page.getByText('Identidade visual e site para empresas de serviço.')).toBeVisible();
  const history = page.getByRole('region', { name: 'Histórico da oferta' });
  await expect(history.getByRole('listitem')).toHaveCount(2);
  await expect(history.getByRole('listitem').first()).toContainText('v2');
  await expect(history.getByRole('listitem').first()).toContainText('atual');
  await expect(history.getByRole('listitem').last()).toContainText('v1');
});

test('com LIA aprovada só falta o banco persistente; revogar bloqueia de novo', async ({
  page,
}) => {
  test.skip(!offerPath, 'depende dos testes anteriores');

  // Voz e opt-out.
  await page.goto('/configuracoes/estrategia/voz');
  await page.getByLabel('Resumo da voz').fill('Direta, próxima e sem jargão de agência.');
  await page.getByRole('button', { name: 'Salvar voz' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Salvo.' })).toBeVisible();

  await page.goto('/configuracoes/conformidade/opt-out');
  await expect(page.getByText('Padrão do Prospector — revise antes de salvar')).toBeVisible();
  await page.getByLabel('Nome da agência').fill('Agência E2E');
  await page.getByLabel('Canal do titular').fill('https://agencia.example/privacidade');
  await page.getByRole('button', { name: 'Salvar' }).click();
  await expect(page).toHaveURL(/\/configuracoes\/conformidade\?aviso=opt-out-salvo$/);
  await expect(page.locator('[data-aviso="opt-out-salvo"]')).toBeVisible();

  // Ainda bloqueado: falta a LIA.
  await page.goto('/abordagens');
  await expect(page.locator('[data-gate-ready]')).toHaveAttribute('data-gate-ready', 'false');
  await expect(readinessItem(page, 'voice_guide')).toHaveAttribute('data-ok', 'true');
  await expect(readinessItem(page, 'contact_policy')).toHaveAttribute('data-ok', 'true');
  await expect(readinessItem(page, 'lia_approved')).toHaveAttribute('data-ok', 'false');

  // LIA: modelo guiado com conclusão em branco; salvar cria rascunho, não aprova.
  await page.goto('/configuracoes/conformidade/lia');
  await expect(page.getByText('Padrão do Prospector — revise antes de salvar')).toBeVisible();
  await expect(page.getByLabel('Conclusão')).toHaveValue('');
  await page.getByRole('button', { name: 'Salvar v1' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Revise' })).toBeVisible();
  await page
    .getByLabel('Conclusão')
    .fill('Com as salvaguardas acima, o interesse legítimo prevalece neste teste.');
  await page.getByRole('button', { name: 'Salvar v1' }).click();
  await expect(page).toHaveURL(/\/configuracoes\/conformidade\?aviso=lia-salva$/);
  await expect(page.locator('[data-lia-status]')).toHaveAttribute('data-lia-status', 'pending');
  await expectNoA11yViolations(page);

  // Aprovar exige confirmação explícita.
  await page.getByRole('button', { name: 'Aprovar LIA v1' }).click();
  await expect(
    page.getByText('Confirme que revisou o texto e assume esta avaliação.'),
  ).toBeVisible();
  await page.getByLabel('Revisei a LIA v1 e assumo esta avaliação.').check();
  await page.getByRole('button', { name: 'Aprovar LIA v1' }).click();
  await expect(page).toHaveURL(/\?aviso=lia-aprovada$/);
  await expect(page.locator('[data-aviso="lia-aprovada"]')).toBeVisible();
  await expect(page.locator('[data-lia-status]')).toHaveAttribute('data-lia-status', 'approved');

  // Com LIA aprovada, só falta o banco persistente (modo memória nunca libera).
  await page.goto('/abordagens');
  await expect(readinessItem(page, 'lia_approved')).toHaveAttribute('data-ok', 'true');
  expect(await missingApproachItems(page)).toEqual(['persistent_storage']);
  await expect(page.locator('[data-gate-ready]')).toHaveAttribute('data-gate-ready', 'false');
  await expectNoA11yViolations(page);

  // Revogar bloqueia na hora; o texto em vigor fica à mão antes de revogar.
  await page.goto('/configuracoes/conformidade');
  await page.getByText('Ver o texto da LIA v1 em vigor').click();
  await expect(
    page.getByText('Com as salvaguardas acima, o interesse legítimo prevalece'),
  ).toBeVisible();
  await page
    .getByLabel('Entendo que, sem LIA em vigor, todas as ações de abordagem ficam bloqueadas.')
    .check();
  await page.getByRole('button', { name: 'Revogar LIA v1' }).click();
  await expect(page.locator('[data-aviso="lia-revogada"]')).toBeVisible();
  await expect(page.locator('[data-lia-status]')).toHaveAttribute('data-lia-status', 'revoked');
  await page.goto('/abordagens');
  await expect(readinessItem(page, 'lia_approved')).toHaveAttribute('data-ok', 'false');
  await expect(readinessItem(page, 'lia_approved')).toContainText('revogada');
  expect(await missingApproachItems(page)).toEqual(['lia_approved', 'persistent_storage']);
});

test('depois de revogar, a mesma LIA pode ser renovada como nova versão', async ({ page }) => {
  test.skip(!offerPath, 'depende dos testes anteriores');
  await page.goto('/configuracoes/conformidade/lia');
  await expect(page.getByRole('note').filter({ hasText: 'foi revogada' })).toBeVisible();
  // Mesmo texto: depois de uma decisão, salvar cria a v2 (renovação), não "nenhuma alteração".
  await page.getByRole('button', { name: 'Salvar como v2' }).click();
  await expect(page).toHaveURL(/\?aviso=lia-salva$/);
  await page.getByLabel('Revisei a LIA v2 e assumo esta avaliação.').check();
  await page.getByRole('button', { name: 'Aprovar LIA v2' }).click();
  await expect(page.locator('[data-lia-status]')).toHaveAttribute('data-lia-status', 'approved');

  await page.goto('/abordagens');
  expect(await missingApproachItems(page)).toEqual(['persistent_storage']);
});

test('voltar a oferta para rascunho bloqueia descoberta e abordagem', async ({ page }) => {
  test.skip(!offerPath, 'depende dos testes anteriores');
  await page.goto(offerPath);
  await page.getByRole('button', { name: 'Voltar para rascunho' }).click();
  await expect(page.getByRole('button', { name: 'Ativar oferta' })).toBeVisible();

  await page.goto('/abordagens');
  await expect(readinessItem(page, 'offer_active')).toHaveAttribute('data-ok', 'false');
  expect(await missingApproachItems(page)).toContain('offer_active');

  await page.goto('/configuracoes/estrategia');
  const discover = page.locator('section[aria-labelledby="prontidao-descobrir"]');
  await expect(discover).toHaveAttribute('data-gate-ready', 'false');
});

test('arquivar case pede confirmação; Cancelar e Esc devolvem o foco (KI-050)', async ({
  page,
}) => {
  await page.goto('/configuracoes/estrategia/cases/novo');
  await page.getByLabel('Título').fill('Case E2E para arquivar');
  await page.getByLabel('Resumo').fill('Rebranding de uma clínica com identidade nova.');
  await page.getByRole('button', { name: 'Criar case' }).click();
  await expect(page).toHaveURL(/\/configuracoes\/estrategia\/cases$/);
  await page.getByRole('link', { name: 'Case E2E para arquivar' }).click();

  const archive = page.getByRole('button', { name: 'Arquivar case' });
  const question = page.getByText('Arquivar este case?');
  await archive.click();
  await expect(question).toBeFocused();
  const confirmForm = page.locator('form').filter({ has: question });
  await confirmForm.getByRole('button', { name: 'Cancelar' }).click();
  await expect(archive).toBeFocused();

  await archive.click();
  await expect(question).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(archive).toBeFocused();

  await archive.click();
  await page.getByRole('button', { name: 'Sim, arquivar case' }).click();
  await expect(page).toHaveURL(/\/configuracoes\/estrategia\/cases\?aviso=case-arquivado$/);
  await expect(page.locator('[data-aviso="case-arquivado"]')).toContainText('Case arquivado.');
  await expectNoA11yViolations(page);
});
