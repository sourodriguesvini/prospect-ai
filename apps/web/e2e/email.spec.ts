import { expect, test, type Page } from '@playwright/test';
import { expectNoA11yViolations } from './support';

/**
 * E3 — Configuração › E-mail (ADR-0016) de ponta a ponta, no servidor de memória da Descoberta
 * com a caixa SIMULADA (PROSPECTOR_EMAIL=fixture, src/server/email-fixture.ts): identidade, caixa,
 * senha, conferência e e-mail de teste, sem conectar em servidor nenhum e sem DNS. Tudo é marcado
 * DEMO e os dados são ILUSTRATIVOS. O SMTP/IMAP/DNS reais são cobertos pelos testes dos
 * adaptadores (packages/integrations/tests/email). Os testes formam uma história, em série.
 */
test.describe.configure({ mode: 'serial' });

const PATH = '/configuracoes/email';
const ADDRESS = 'fala@estudio.exemplo.com.br';
const TEST_PASSWORD = 'senha-ficticia-do-teste-e2e';
const PREVIEW_FRAME = 'iframe[title="Prévia do e-mail de teste"]';

const status = (page: Page, text: string | RegExp) =>
  page.getByRole('status').filter({ hasText: text });

test('sem nada cadastrado: aviso de demonstração, envio bloqueado e acessível', async ({
  page,
}) => {
  await page.goto(PATH);
  await expect(page.getByRole('heading', { level: 1, name: 'E-mail' })).toBeVisible();
  await expect(page.getByRole('note').filter({ hasText: 'Caixa simulada' })).toBeVisible();
  await expect(page.getByRole('note').filter({ hasText: 'Nada desta tela escreve' })).toBeVisible();
  await expect(page.getByText('Salve quem assina para ver a prévia.')).toBeVisible();
  // Bloqueado sem sair da ordem do teclado: `aria-disabled`, com o motivo como descrição.
  const send = page.getByRole('button', { name: 'Enviar e-mail de teste para mim' });
  await expect(send).toHaveAttribute('aria-disabled', 'true');
  await expect(send).toHaveAttribute('type', 'button');
  await expect(send).toHaveAccessibleDescription(/Salve quem assina/);
  await send.focus();
  await expect(send).toBeFocused();
  await expectNoA11yViolations(page);
});

test('identidade, caixa, senha, conferência e e-mail de teste', async ({ page }) => {
  await page.goto(PATH);

  // Quem assina: validação no servidor e depois a versão salva.
  await page
    .getByRole('textbox', { name: 'Nome (obrigatório)', exact: true })
    .fill('Pessoa Exemplo');
  await page.getByRole('textbox', { name: 'Cargo' }).fill('Direção de arte');
  await page.getByRole('textbox', { name: 'Estúdio' }).fill('Estúdio Exemplo');
  await page.getByRole('textbox', { name: 'E-mail na assinatura' }).fill(ADDRESS);
  await page.getByRole('textbox', { name: 'Site' }).fill('http://estudio.exemplo.com.br');
  await page.getByRole('button', { name: 'Salvar identidade' }).click();
  await expect(page.getByRole('textbox', { name: 'Site' })).toHaveAttribute('aria-invalid', 'true');
  await page.getByRole('textbox', { name: 'Site' }).fill('https://estudio.exemplo.com.br');
  await page.getByRole('button', { name: 'Salvar identidade' }).click();
  await expect(status(page, 'Identidade salva')).toBeVisible();

  // A prévia já usa a identidade; sem política de contato, avisa que falta o opt-out.
  const preview = page.frameLocator(PREVIEW_FRAME);
  await expect(preview.getByText('Pessoa Exemplo').first()).toBeVisible();
  await expect(page.getByTestId('opt-out-missing')).toContainText('Conformidade');

  // A prévia é um documento próprio: só ela aceita imagens https e nenhuma aceita script de fora.
  const frameSrc = await page.locator(PREVIEW_FRAME).getAttribute('src');
  expect(frameSrc).toMatch(/^\/configuracoes\/email\/previa\?v=/);
  await expect(page.locator(PREVIEW_FRAME)).toHaveAttribute(
    'sandbox',
    'allow-popups allow-popups-to-escape-sandbox',
  );
  const previewResponse = await page.request.get(frameSrc!);
  const previewCsp = previewResponse.headers()['content-security-policy'] ?? '';
  expect(previewCsp).toContain("default-src 'none'");
  expect(previewCsp).toContain('img-src https: data:');
  expect(previewCsp).toContain("frame-ancestors 'self'");
  expect(previewResponse.headers()['x-frame-options']).toBe('SAMEORIGIN');
  expect(await previewResponse.text()).toContain('<base target="_blank">');
  const pageCsp = (await page.request.get(PATH)).headers()['content-security-policy'] ?? '';
  expect(pageCsp).toContain("img-src 'self' blob: data:;");
  expect(pageCsp).toContain("frame-ancestors 'none'");

  // Caixa: servidores da Hostinger já vêm preenchidos.
  await expect(page.getByRole('textbox', { name: 'Servidor de envio (SMTP)' })).toHaveValue(
    'smtp.hostinger.com',
  );
  await page.getByRole('textbox', { name: 'Endereço que envia' }).fill(ADDRESS);
  await page.getByRole('textbox', { name: 'Nome do remetente' }).fill('Pessoa Exemplo');
  await page.getByRole('textbox', { name: 'Usuário' }).fill(ADDRESS);
  await page.getByRole('button', { name: 'Salvar caixa' }).click();
  await expect(status(page, 'Caixa salva')).toBeVisible();
  await expect(page.locator('[data-mailbox-status]')).toHaveAttribute(
    'data-mailbox-status',
    'unverified',
  );

  // Senha: gravada e nunca devolvida ao campo nem à página.
  const password = page.locator('input[name="password"]');
  await expect(password).toHaveAttribute('type', 'password');
  await expect(password).toHaveAccessibleName(/Senha da caixa/);
  await password.fill(TEST_PASSWORD);
  await page.getByRole('button', { name: 'Gravar senha' }).click();
  await expect(status(page, 'Senha guardada só na memória do app')).toBeVisible();
  await expect(password).toHaveValue('');
  expect(await page.content()).not.toContain(TEST_PASSWORD);

  // Conferência simulada: logins aceitos, DNS publicado e DMARC só monitorando (aviso).
  await page.getByRole('button', { name: 'Testar conexão' }).click();
  await expect(status(page, 'Conferência simulada feita: a caixa está conferida')).toBeVisible();
  const check = page.getByTestId('mailbox-check');
  await expect(check.locator('[data-check-item="smtp"]')).toContainText('Login aceito');
  await expect(check.locator('[data-check-item="imap"]')).toContainText('Login aceito');
  await expect(check.locator('[data-check-item="dmarc"]')).toContainText('p=none');
  await expect(page.locator('[data-mailbox-status]')).toHaveAttribute(
    'data-mailbox-status',
    'verified',
  );

  // E-mail de teste: só para a própria caixa, e um por minuto. Simulado, a mensagem diz que nada saiu.
  const send = page.getByRole('button', { name: 'Enviar e-mail de teste para mim' });
  await expect(send).not.toHaveAttribute('aria-disabled', 'true');
  await expect(send).toHaveAccessibleDescription(
    `Vai só para ${ADDRESS}, no máximo um por minuto.`,
  );
  await send.click();
  await expect(status(page, 'Simulação: nada saiu deste computador')).toContainText(ADDRESS);
  await send.click();
  await expect(page.getByRole('alert').filter({ hasText: 'Espere um minuto' })).toBeVisible();

  // A prévia é um iframe em sandbox (sem script): o axe não entra nele. O HTML do e-mail tem a
  // própria cobertura (idioma, textos alternativos) em packages/domain/tests/relationship.
  await expectNoA11yViolations(page, { exclude: [PREVIEW_FRAME] });
});

test('trocar o servidor desfaz a conferência', async ({ page }) => {
  await page.goto(PATH);
  await expect(page.locator('[data-mailbox-status]')).toHaveAttribute(
    'data-mailbox-status',
    'verified',
  );
  await page.getByRole('combobox', { name: 'Porta SMTP' }).selectOption('587');
  await page.getByRole('button', { name: 'Salvar caixa' }).click();
  await expect(status(page, 'Caixa salva')).toBeVisible();
  await expect(page.locator('[data-mailbox-status]')).toHaveAttribute(
    'data-mailbox-status',
    'unverified',
  );
  await expect(
    page.getByRole('button', { name: 'Enviar e-mail de teste para mim' }),
  ).toHaveAccessibleDescription(/Clique em Testar conexão/);
});
