import { expect, test, type Page } from '@playwright/test';
import { expectNoA11yViolations } from './support';

/**
 * Relacionamento (ADR-0014) de ponta a ponta, no servidor em modo memória (sem banco real) e sem
 * IA de verdade: a IA do Relacionamento é a SINTÉTICA (PROSPECTOR_RELATIONSHIP_AI=fixture,
 * src/server/relationship-ai-fixture.ts), que grava tudo marcado DEMO. Roda depois dos specs da
 * estratégia e de empresas (projeto "relacionamento-memoria" em playwright.config.ts): usa a
 * oferta e a empresa sintética 77.888.999/0001-81 que eles deixam.
 *
 * Em modo memória a conformidade nunca libera a aprovação (a LIA aprovada sumiria ao reiniciar):
 * aqui se confere que a tela explica o bloqueio; a aprovação, o registro do envio e a checagem de
 * supressão no envio são cobertos pelos testes do serviço e do banco (PGlite).
 */
test.describe.configure({ mode: 'serial' });

const COMPANY = 'ATELIE SINTETICO';
let opportunityPath = '';

/** Sem rolagem lateral; se houver, a mensagem diz quais elementos passam da largura da tela. */
async function expectNoHorizontalScroll(page: Page) {
  const { overflow, culprits } = await page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    // Dentro de um contêiner com rolagem própria (quadro, tabela), passar da tela é o esperado.
    // Elemento com posição absoluta só fica preso se o bloco de referência dele estiver dentro
    // do contêiner (caso clássico: texto `sr-only` dentro de um quadro com rolagem).
    const clipped = (element: Element) => {
      let contained = !/^(absolute|fixed)$/.test(getComputedStyle(element).position);
      for (let node = element.parentElement; node && node !== document.body;) {
        const style = getComputedStyle(node);
        if (!contained && style.position !== 'static') contained = true;
        if (contained && style.overflowX !== 'visible') return true;
        node = node.parentElement;
      }
      return false;
    };
    const culprits = [...document.body.querySelectorAll('*')]
      .filter((element) => element.getBoundingClientRect().right > width + 1 && !clipped(element))
      .slice(0, 5)
      .map((element) => {
        const box = element.getBoundingClientRect();
        const name = `${element.tagName.toLowerCase()}.${String(element.className).slice(0, 80)}`;
        return `${name} (${Math.round(box.width)}px)`;
      });
    return { overflow: document.documentElement.scrollWidth - width, culprits };
  });
  expect(overflow, `Passam da tela: ${culprits.join(' | ')}`).toBeLessThanOrEqual(0);
}

/** Hoje na agência (America/Sao_Paulo), no formato do campo de data. */
function todayInAgency(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
}

test('telas começam vazias, sem dados simulados; endereços antigos redirecionam', async ({
  page,
}) => {
  await page.goto('/conversas');
  await expect(page).toHaveURL(/\/relacionamento\/conversas$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Conversas' })).toBeVisible();
  await expect(page.getByText('Nenhuma conversa registrada ainda.')).toBeVisible();
  await expect(page.getByText('DEMO')).toHaveCount(0);
  await expectNoA11yViolations(page);

  await page.goto('/pipeline');
  await expect(page).toHaveURL(/\/relacionamento\/pipeline$/);
  await expect(page.getByText('Nenhuma conversa ainda.')).toBeVisible();
  await expect(page.getByText('DEMO')).toHaveCount(0);
  await expectNoA11yViolations(page);

  await page.goto('/aprovacoes');
  await expect(page.getByRole('heading', { level: 1, name: 'Aprovações' })).toBeVisible();
  await expect(page.getByText('Nada esperando aprovação.')).toBeVisible();
  await expect(page.getByText('Nenhuma aprovação registrada ainda.')).toBeVisible();
  await expectNoA11yViolations(page);

  // O menu tem um item só para o módulo (Conversas); as abas e as Aprovações ficam dentro dele.
  const nav = page.getByRole('navigation', { name: 'Principal' });
  await expect(nav.getByRole('link', { name: 'Conversas', exact: true })).toBeVisible();
  await expect(nav.getByRole('link', { name: /^(Para enviar|Aprovações)$/ })).toHaveCount(0);
});

test('prepara a abordagem no dossiê, com a estratégia apoiada em evidências (cenário A)', async ({
  page,
}) => {
  // A oferta criada pelo spec da estratégia termina em rascunho: ativa de novo.
  await page.goto('/configuracoes/estrategia');
  await page.getByRole('link', { name: 'Oferta E2E de rebranding' }).first().click();
  const status = page.getByRole('button', { name: /^(Ativar oferta|Voltar para rascunho)$/ });
  await expect(status).toBeVisible();
  if ((await status.textContent())?.includes('Ativar')) {
    await status.click();
    await expect(page.getByRole('button', { name: 'Voltar para rascunho' })).toBeVisible();
  }

  await page.goto(`/empresas?busca=${encodeURIComponent('Atelie')}`);
  await page.getByRole('link', { name: COMPANY }).click();
  await expect(page.getByRole('heading', { level: 1, name: COMPANY })).toBeVisible();
  const panel = page.getByRole('region', { name: 'Conversas' });
  await expect(panel.getByRole('button', { name: 'Preparar mensagem' })).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Escrever sem a IA' })).toBeVisible();
  // Sem investigação concluída, o painel avisa que a abordagem sai com base limitada (KI-129).
  await expect(panel.locator('[data-diagnosis="none"]')).toContainText('Sem diagnóstico');
  await expectNoA11yViolations(page);
  await panel
    .getByRole('combobox', { name: 'Oferta (obrigatório)' })
    .selectOption({ label: 'Oferta E2E de rebranding' });
  await panel.getByRole('button', { name: 'Preparar mensagem' }).click();

  await expect(page).toHaveURL(
    /\/relacionamento\/oportunidades\/[0-9a-f-]{36}\?aviso=abordagem-preparada$/,
  );
  opportunityPath = new URL(page.url()).pathname;
  await expect(page.getByRole('heading', { level: 1, name: COMPANY })).toBeVisible();
  await expect(page.locator('[data-aviso="abordagem-preparada"]')).toContainText(
    'nada foi enviado',
  );

  const strategy = page.getByRole('region', { name: 'Estratégia' });
  await expect(strategy).toContainText('Em que se apoia');
  await expect(strategy).toContainText('Ponto de teste baseado em');
  // Cada ponto mostra a evidência do dossiê que o sustenta, com o tipo e a confiança.
  await expect(strategy.getByText(/^Fato · /).first()).toBeVisible();
  await expect(strategy.getByText('DEMO').first()).toBeVisible();

  const messages = page.getByRole('region', { name: 'Mensagens' });
  const draft = messages.locator('article[data-message-status="draft"]');
  await expect(draft).toHaveCount(1);
  await expect(draft).toContainText('rascunho SINTÉTICO de teste');
  await expect(draft.getByText('DEMO')).toBeVisible();
  await expectNoA11yViolations(page);
});

test('aprovar fica bloqueado sem conformidade, e nada é enviado pelo app (cenários B e J)', async ({
  page,
}) => {
  test.skip(!opportunityPath, 'depende do teste anterior');
  await page.goto(opportunityPath);
  await expect(page.locator('[data-compliance]')).toBeVisible();
  const messages = page.getByRole('region', { name: 'Mensagens' });
  const blocked = messages.locator('[data-approve-blocked]');
  await expect(blocked).toContainText('A conformidade para abordar não está atendida');
  await expect(messages.getByRole('button', { name: 'Aprovar para uso' })).toHaveCount(0);
  // Nenhum botão envia nada: o app só registra o que você enviou por conta própria.
  await expect(page.getByRole('button', { name: /enviar/i })).toHaveCount(0);

  await page.goto('/aprovacoes');
  const pending = page.locator('[data-pending]');
  await expect(pending).toHaveCount(1);
  await expect(pending).toContainText(COMPANY);
  await expect(pending.locator('[data-approve-blocked]')).toBeVisible();
  await expect(page.getByRole('button', { name: /enviar/i })).toHaveCount(0);
  await expectNoA11yViolations(page);
});

test('registra um contato manual ligado à oportunidade (cenário C)', async ({ page }) => {
  test.skip(!opportunityPath, 'depende dos testes anteriores');
  await page.goto(opportunityPath);
  const conversation = page.getByRole('region', { name: 'Conversa' });
  await conversation.locator('summary', { hasText: 'Registrar nota' }).click();
  await conversation
    .getByLabel('Resumo')
    .fill('Liguei para a recepção; pediram para mandar a apresentação por e-mail.');
  await conversation.getByRole('button', { name: 'Registrar nota' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Nota registrada.' })).toBeVisible();
  await expect(conversation.locator('li[data-interaction="note"]')).toContainText(
    'Liguei para a recepção',
  );
  // Persiste: outra leitura mostra o mesmo registro.
  await page.reload();
  await expect(
    page.getByRole('region', { name: 'Conversa' }).locator('li[data-interaction="note"]'),
  ).toContainText('Liguei para a recepção');
});

test('registra a resposta, interpreta com a IA e cria o rascunho sugerido (cenário D)', async ({
  page,
}) => {
  test.skip(!opportunityPath, 'depende dos testes anteriores');
  await page.goto(opportunityPath);
  const conversation = page.getByRole('region', { name: 'Conversa' });
  await conversation.locator('summary', { hasText: 'Registrar resposta recebida' }).click();
  await conversation
    .getByLabel('O que a empresa respondeu')
    .fill('Obrigada pelo contato! Podemos conversar na semana que vem sobre isso?');
  await conversation.getByLabel('Quem respondeu (função ou área)').fill('Sócia');
  await expect(conversation.getByLabel('Mover a oportunidade para Em conversa')).toBeChecked();
  await conversation.getByRole('button', { name: 'Registrar resposta' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Resposta registrada.' })).toBeVisible();
  await expect(page.locator('[data-stage="in_conversation"]').first()).toBeVisible();

  await page
    .getByRole('region', { name: 'Conversa' })
    .getByRole('button', { name: 'Interpretar com a IA' })
    .click();
  const analysis = page.locator('[data-analysis="meeting_request"]');
  await expect(analysis).toBeVisible();
  await expect(analysis).toContainText('Pede reunião');
  await expect(analysis).toContainText('Confiança alta');
  await expect(analysis).toContainText('É uma sugestão');

  await analysis.getByRole('button', { name: 'Usar como rascunho de resposta' }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Rascunho de resposta criado' }),
  ).toBeVisible();
  await expect(
    page.getByRole('region', { name: 'Mensagens' }).locator('article[data-message-status="draft"]'),
  ).toHaveCount(2);
  await expectNoA11yViolations(page);
});

test('o follow-up marcado aparece na lista de hoje (cenário E)', async ({ page }) => {
  test.skip(!opportunityPath, 'depende dos testes anteriores');
  await page.goto(opportunityPath);
  const followUps = page.getByRole('region', { name: 'Follow-ups' });
  await followUps.locator('summary', { hasText: 'Marcar follow-up' }).click();
  await followUps.getByLabel('O que fazer').fill('Ligar para confirmar a conversa');
  await followUps.getByLabel(/^Data/).fill(todayInAgency());
  await followUps.getByRole('button', { name: 'Marcar follow-up' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Follow-up marcado.' })).toBeVisible();
  await expect(followUps.locator('li[data-task="open"]')).toContainText(
    'Ligar para confirmar a conversa',
  );

  await page.goto('/relacionamento/conversas');
  const today = page.getByRole('region', { name: 'Para acompanhar hoje' });
  await expect(
    today.locator('[data-attention="task_overdue"], [data-attention="task_due_today"]').first(),
  ).toContainText(COMPANY);
  await expect(page.getByRole('region', { name: 'Em contato' })).toContainText(COMPANY);
  await expectNoA11yViolations(page);
});

test('mudar de etapa é decisão sua, fica no histórico e na auditoria (cenário F)', async ({
  page,
}) => {
  test.skip(!opportunityPath, 'depende dos testes anteriores');
  await page.goto(opportunityPath);
  const stage = page.getByRole('region', { name: 'Etapa' });
  await stage.getByLabel('Mover para').selectOption({ label: 'Reunião' });
  await stage.getByLabel('Observação').fill('Conversa marcada para terça');
  await stage.getByRole('button', { name: 'Mudar etapa' }).click();
  await expect(stage.getByRole('status')).toContainText('Etapa alterada.');
  await expect(stage).toContainText('Em conversa → Reunião');
  await expect(stage).toContainText('Conversa marcada para terça');

  await page.goto('/relacionamento/pipeline');
  await expect(page.locator('[data-column="meeting"]')).toContainText(COMPANY);
  await expectNoA11yViolations(page);
  await page.goto('/relacionamento/pipeline?vista=lista');
  await expect(page.locator('tr[data-stage="meeting"]')).toContainText(COMPANY);
  await expectNoA11yViolations(page);

  await page.goto('/configuracoes/auditoria');
  await expect(page.getByText('Etapa da oportunidade alterada').first()).toBeVisible();
  await expect(page.getByText('Resposta interpretada pela IA local').first()).toBeVisible();
  await expect(page.getByText('Mensagem aprovada para uso')).toHaveCount(0);
});

test('no celular, detalhe e pipeline não rolam para o lado', async ({ page }) => {
  test.skip(!opportunityPath, 'depende dos testes anteriores');
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(opportunityPath);
  await expect(page.getByRole('heading', { level: 1, name: COMPANY })).toBeVisible();
  await expectNoHorizontalScroll(page);
  await page.goto('/relacionamento/pipeline');
  await expect(page.locator('[data-column="meeting"]')).toBeVisible();
  await expectNoHorizontalScroll(page);
  await page.goto('/relacionamento/pipeline?vista=lista');
  await expect(page.locator('tr[data-stage="meeting"]')).toBeVisible();
  await expectNoHorizontalScroll(page);
});

test('pedido para parar suprime a empresa na hora e cancela os follow-ups', async ({ page }) => {
  test.skip(!opportunityPath, 'depende dos testes anteriores');
  await page.goto(opportunityPath);
  const conversation = page.getByRole('region', { name: 'Conversa' });
  await conversation.locator('summary', { hasText: 'Registrar resposta recebida' }).click();
  await conversation
    .getByLabel('O que a empresa respondeu')
    .fill('Pensamos melhor. Por favor, não me mandem mais mensagens.');
  await conversation.getByRole('button', { name: 'Registrar resposta' }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'a empresa entrou na lista de supressão' }),
  ).toBeVisible();

  await page.reload();
  await expect(page.locator('[data-suppressed]')).toContainText('Não contatar esta empresa.');
  await expect(page.getByRole('region', { name: 'Follow-ups' })).toContainText(
    'Nenhum follow-up aberto.',
  );
  await expect(page.getByText('Nova mensagem com a IA')).toHaveCount(0);
  await expect(
    page.getByRole('region', { name: 'Mensagens' }).locator('[data-approve-blocked]').first(),
  ).toContainText('A empresa pediu para não ser contatada.');
  await expectNoA11yViolations(page);

  // A lista de hoje não mostra empresa com opt-out.
  await page.goto('/relacionamento/conversas');
  await expect(page.getByRole('region', { name: 'Para acompanhar hoje' })).not.toContainText(
    COMPANY,
  );
});
