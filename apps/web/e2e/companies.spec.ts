import { expect, test, type Page } from '@playwright/test';
import { expectNoA11yViolations, gotoWithShortcuts } from './support';

/**
 * M2 — Empresas e dossiê, de ponta a ponta, no servidor em modo memória (sem banco real) e sem
 * internet: a consulta de CNPJ é a SINTÉTICA (PROSPECTOR_CNPJ_LOOKUP=fixture,
 * src/server/cnpj-fixture.ts), cujos registros saem marcados DEMO. Os testes formam uma história e
 * rodam em série sobre o mesmo servidor. A consulta real é coberta pelos testes do adaptador
 * (respostas gravadas) e pela verificação manual registrada no doc 14.
 *
 * CNPJs de teste (dígitos válidos, nomes marcados como teste): 11.222.333/0001-81 (a consulta
 * sintética simula serviço fora do ar), 77.888.999/0001-81 (limitada) e 66.555.444/0001-00 (MEI).
 */
test.describe.configure({ mode: 'serial' });

const NAME = 'Empresa de teste E2E';
const CNPJ = '11.222.333/0001-81';
let dossierPath = '';
let importedPath = '';

async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

test('lista começa vazia, com o caminho para adicionar', async ({ page }) => {
  await page.goto('/empresas');
  await expect(page.getByRole('heading', { level: 1, name: 'Empresas' })).toBeVisible();
  await expect(page.getByText('Nenhuma empresa em acompanhamento.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Adicionar a primeira empresa' })).toBeVisible();
  await expectNoA11yViolations(page);
  await page.getByRole('link', { name: 'Adicionar empresa', exact: true }).click();
  await expect(page).toHaveURL(/\/empresas\/nova$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Adicionar empresa' })).toBeVisible();
});

test('a tela de adicionar avisa sobre MEI e o cadastro manual valida os campos', async ({
  page,
}) => {
  await page.goto('/empresas/nova');
  await expect(page.getByText('MEI e outras empresas de uma pessoa só')).toBeVisible();
  await expectNoA11yViolations(page);

  await page.getByRole('button', { name: 'Cadastrar à mão' }).click();
  await expect(page.getByText('Informe o nome da empresa.')).toBeVisible();

  await page.getByLabel('Nome da empresa').fill(NAME);
  await page.getByRole('textbox', { name: 'CNPJ', exact: true }).fill('11.222.333/0001-82');
  await page.getByRole('button', { name: 'Cadastrar à mão' }).click();
  await expect(page.getByRole('textbox', { name: 'CNPJ', exact: true })).toHaveAttribute(
    'aria-invalid',
    'true',
  );
  // O que foi digitado continua no formulário depois do erro.
  await expect(page.getByLabel('Nome da empresa')).toHaveValue(NAME);
});

test('cadastro manual leva ao dossiê, sem fatos e com os dados não conferidos', async ({
  page,
}) => {
  await page.goto('/empresas/nova');
  await page.getByLabel('Nome da empresa').fill(NAME);
  await page.getByRole('textbox', { name: 'CNPJ', exact: true }).fill(CNPJ);
  await page.getByLabel('Site').fill('https://www.exemplo-e2e.com.br/contato');
  await page.getByLabel('Cidade').fill('Curitiba');
  await page.getByLabel('UF').fill('pr');
  await page.getByRole('button', { name: 'Cadastrar à mão' }).click();

  await expect(page).toHaveURL(/\/empresas\/[0-9a-f-]{36}\?aviso=cadastrada$/);
  dossierPath = new URL(page.url()).pathname;
  await expect(page.getByRole('heading', { level: 1, name: NAME })).toBeVisible();
  await expect(page.locator('[data-aviso="cadastrada"]')).toContainText('Empresa cadastrada.');
  const registry = page.getByRole('region', { name: 'Cadastro' });
  await expect(registry).toContainText(CNPJ);
  await expect(registry).toContainText('exemplo-e2e.com.br');
  await expect(registry).toContainText('Curitiba/PR');
  await expect(registry).toContainText('Cadastro manual');
  await expect(registry).toContainText('Dados como você informou, sem verificação.');
  await expect(registry.getByText(`CNPJ: ${CNPJ} · não conferido`)).toBeVisible();
  // A raiz do CNPJ é chave interna: não aparece.
  await expect(registry).not.toContainText('Raiz do CNPJ');
  await expect(page.getByText('Nenhum fato registrado.')).toBeVisible();
  await expect(page).toHaveTitle(new RegExp(NAME));
  await expectNoA11yViolations(page);
});

test('consultar a Receita com o serviço fora do ar explica a falha e não grava nada', async ({
  page,
}) => {
  await page.goto(dossierPath);
  const receita = page.getByRole('region', { name: 'Receita Federal' });
  await receita.getByRole('button', { name: 'Consultar a Receita' }).click();
  await expect(receita.getByText('Não consegui consultar o CNPJ')).toBeVisible();
  // A empresa já existe: a mensagem não manda cadastrar à mão.
  await expect(receita.getByText('Os fatos guardados continuam como estavam')).toBeVisible();
  await expect(page.getByText('Nenhum fato registrado.')).toBeVisible();
});

test('o mesmo CNPJ não vira outra empresa: leva ao dossiê existente', async ({ page }) => {
  await page.goto('/empresas/nova');
  await page.getByLabel('Nome da empresa').fill('Outro nome para a mesma empresa');
  await page.getByRole('textbox', { name: 'CNPJ', exact: true }).fill('11222333000181');
  await page.getByRole('button', { name: 'Cadastrar à mão' }).click();
  await expect(page).toHaveURL(new RegExp(`${dossierPath}\\?aviso=ja-cadastrada$`));
  await expect(page.locator('[data-aviso="ja-cadastrada"]')).toContainText('já estava cadastrada');
  await expect(page.getByRole('heading', { level: 1, name: NAME })).toBeVisible();
});

test('a etapa só muda por decisão sua e fica na auditoria', async ({ page }) => {
  await page.goto(dossierPath);
  const stage = page.getByRole('region', { name: 'Etapa' });
  await stage.getByLabel('Etapa').selectOption({ label: 'Em investigação' });
  await stage.getByRole('button', { name: 'Salvar etapa' }).click();
  await expect(stage.getByRole('status')).toContainText('Salvo.');
  await page.reload();
  await expect(page.getByText('Em investigação').first()).toBeVisible();

  await page.goto('/configuracoes/auditoria');
  await expect(page.getByText('Etapa da empresa alterada').first()).toBeVisible();
  await expect(page.getByText('Empresa cadastrada').first()).toBeVisible();
});

test('lista busca por nome sem acento e por CNPJ com pontuação', async ({ page }) => {
  await page.goto('/empresas');
  await expect(page.getByRole('link', { name: NAME })).toBeVisible();
  const search = page.getByRole('search', { name: 'Buscar empresas' });
  await search.getByLabel('Buscar').fill('EMPRÉSA de TESTE');
  await search.getByRole('button', { name: 'Buscar' }).click();
  await expect(page).toHaveURL(/busca=/);
  await expect(page.getByRole('link', { name: NAME })).toBeVisible();

  await page.goto(`/empresas?busca=${encodeURIComponent('11.222.333/0001-81')}`);
  await expect(page.getByRole('link', { name: NAME })).toBeVisible();

  await page.goto('/empresas?busca=nada-com-esse-nome');
  await expect(page.getByText('Nenhuma empresa encontrada com esses filtros.')).toBeVisible();
  await expect(page.getByText('A busca não inclui as arquivadas')).toBeVisible();
  await expectNoA11yViolations(page);
});

test('cadastro pelo CNPJ grava os fatos com uma fonte só, conferida e marcada DEMO', async ({
  page,
}) => {
  await page.goto('/empresas/nova');
  await page.getByLabel('CNPJ para consultar').fill('77.888.999/0001-81');
  await page.getByRole('button', { name: 'Consultar e cadastrar' }).click();

  await expect(page).toHaveURL(/\/empresas\/[0-9a-f-]{36}\?aviso=cadastrada$/);
  importedPath = new URL(page.url()).pathname;
  await expect(page.getByRole('heading', { level: 1, name: 'ATELIE SINTETICO' })).toBeVisible();
  const registry = page.getByRole('region', { name: 'Cadastro' });
  await expect(registry).toContainText('Consulta de CNPJ');
  await expect(registry.getByText('CNPJ: 77.888.999/0001-81 · conferido')).toBeVisible();

  const evidence = page.getByRole('region', { name: 'Evidências' });
  const group = evidence.getByRole('group', { name: 'Dados do registro' });
  await expect(group).toContainText('Via OpenCNPJ, base da Receita de 15/10/2026');
  await expect(group).toContainText('Decreto 8.777/2016');
  await expect(group).toContainText('Cópia de dados públicos mantida por terceiros');
  await expect(group.getByText('DEMO').first()).toBeVisible();
  // A fonte aparece uma vez, não em cada fato.
  await expect(group.getByText(/^Consultada em/)).toHaveCount(1);
  await expect(group.getByText('Trecho conferido na fonte').first()).toBeVisible();
  const link = group.getByRole('link', { name: /Ver os dados atuais em OpenCNPJ/ });
  await expect(link).toHaveAttribute('href', 'https://api.opencnpj.org/77888999000181');
  await expect(link).toHaveAttribute('target', '_blank');
  await group.getByText('Ver texto guardado').click();
  await expect(group.locator('pre')).toContainText('Razão social: EMPRESA SINTETICA DE TESTE LTDA');
  await expectNoA11yViolations(page);
});

test('dossiê no tema escuro e no celular: acessível e sem rolagem lateral', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto(importedPath);
  await expect(page.getByRole('heading', { level: 1, name: 'ATELIE SINTETICO' })).toBeVisible();
  await expectNoA11yViolations(page);

  await page.emulateMedia({ colorScheme: 'light' });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: 'ATELIE SINTETICO' })).toBeVisible();
  await expectNoHorizontalScroll(page);
  await expectNoA11yViolations(page);
});

test('nova consulta sem mudança na Receita não grava nada', async ({ page }) => {
  await page.goto(importedPath);
  await page.getByRole('button', { name: 'Consultar a Receita de novo' }).click();
  await expect(page).toHaveURL(/aviso=receita-sem-mudanca$/);
  await expect(page.locator('[data-aviso="receita-sem-mudanca"]')).toContainText('nada mudou');
  await expect(page.getByText('versão anterior guardada no histórico')).toHaveCount(0);
});

test('MEI: o nome da pessoa fica só no cadastro, fora das evidências', async ({ page }) => {
  await page.goto('/empresas/nova');
  await page.getByLabel('CNPJ para consultar').fill('66.555.444/0001-00');
  await page.getByRole('button', { name: 'Consultar e cadastrar' }).click();

  await expect(page).toHaveURL(/\?aviso=cadastrada$/);
  await expect(page.getByText('Empresa individual: contém dado pessoal')).toBeVisible();
  const registry = page.getByRole('region', { name: 'Cadastro' });
  await expect(registry).toContainText('PESSOA SINTETICA DE TESTE');
  await expect(registry).toContainText('a razão social é o nome da pessoa titular');

  const evidence = page.getByRole('region', { name: 'Evidências' });
  await evidence.getByText('Ver texto guardado').click();
  await expect(evidence.locator('pre')).toContainText('nome da pessoa titular');
  await expect(evidence).not.toContainText('PESSOA SINTETICA');
  await expectNoA11yViolations(page);
});

test('a paleta (Ctrl+K) acha a empresa pelo nome e abre o dossiê, com o selo DEMO', async ({
  page,
}) => {
  await gotoWithShortcuts(page, '/');
  await page.keyboard.press('Control+k');
  const palette = page.getByRole('dialog', { name: 'Paleta de comandos' });
  await palette.getByRole('combobox').fill('atelie');
  const option = palette.getByRole('option', { name: /ATELIE SINTETICO/ });
  await expect(option).toBeVisible();
  await expect(option).toContainText('Demo');
  await expectNoA11yViolations(page);
  await option.click();
  await expect(page).toHaveURL((url) => url.pathname === importedPath);
  await expect(page.getByRole('heading', { level: 1, name: 'ATELIE SINTETICO' })).toBeVisible();
});

test('empresa arquivada sai da lista e não recebe consultas', async ({ page }) => {
  await page.goto(dossierPath);
  const stage = page.getByRole('region', { name: 'Etapa' });
  await stage.getByLabel('Etapa').selectOption({ label: 'Arquivada' });
  await stage.getByRole('button', { name: 'Salvar etapa' }).click();
  await expect(stage.getByRole('status')).toContainText('Salvo.');
  await page.reload();
  await expect(page.getByText('Empresa arquivada não recebe novas consultas.')).toBeVisible();
  await expect(page.getByRole('button', { name: /Consultar a Receita/ })).toHaveCount(0);

  await page.goto('/empresas');
  await expect(page.getByRole('link', { name: NAME })).toHaveCount(0);
  await page.goto('/empresas?etapa=archived');
  await expect(page.getByRole('link', { name: NAME })).toBeVisible();
});

test('id inexistente mostra "Empresa não encontrada"', async ({ page }) => {
  // O dossiê carrega dentro de um Suspense: o 404 chega como página, não como status HTTP.
  await page.goto('/empresas/00000000-0000-4000-8000-000000000000');
  await expect(page.getByRole('heading', { name: 'Empresa não encontrada' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Ver as empresas cadastradas' })).toBeVisible();
  await page.goto('/empresas/nao-e-um-id');
  await expect(page.getByRole('heading', { name: 'Empresa não encontrada' })).toBeVisible();
});
