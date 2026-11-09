import { createClient } from '@supabase/supabase-js';
import { expect, test, type Browser, type Page } from '@playwright/test';

/**
 * Fluxo completo da F1 contra um Supabase real (local, via `supabase start`):
 * conta → organização → convite → aceite → papéis na tela → auditoria → isolamento entre orgs.
 *
 * Usuários de teste são criados já confirmados pela Admin API, usando a secret key do
 * Supabase LOCAL apenas neste processo de teste (nunca na aplicação). E-mails usam o domínio
 * reservado `example.test`; nada aqui é dado real.
 */
const enabled = process.env.E2E_SUPABASE === '1';
test.skip(
  !enabled,
  'Defina E2E_SUPABASE=1 com Supabase local rodando (docs/runbooks/ambiente-local.md).',
);
test.describe.configure({ mode: 'serial' });

const PASSWORD = 'senha-de-teste-e2e-123';
const runId = Date.now().toString(36);
const email = (label: string) => `e2e-${label}-${runId}@example.test`;

async function createConfirmedUser(label: string, fullName: string): Promise<string> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secret)
    throw new Error('NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SECRET_KEY (local) são necessárias.');
  const admin = createClient(url, secret, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const address = email(label);
  const { error } = await admin.auth.admin.createUser({
    email: address,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });
  if (error) throw error;
  return address;
}

async function signIn(page: Page, address: string, next?: string) {
  await page.goto(next ? `/entrar?next=${encodeURIComponent(next)}` : '/entrar');
  await page.getByLabel('E-mail').fill(address);
  await page.getByLabel('Senha').fill(PASSWORD);
  await page.getByRole('button', { name: 'Entrar' }).click();
}

async function newPage(browser: Browser): Promise<Page> {
  const context = await browser.newContext();
  return context.newPage();
}

test('dono cria organização, convida, operador aceita e papéis são aplicados', async ({
  browser,
}) => {
  const ownerEmail = await createConfirmedUser('dono', 'Dona Teste');
  const memberEmail = await createConfirmedUser('membro', 'Membro Teste');
  const outsiderEmail = await createConfirmedUser('externo', 'Externo Teste');
  const slug = `e2e-${runId}`;

  // Dono: entra, cria a organização.
  const owner = await newPage(browser);
  await signIn(owner, ownerEmail);
  await expect(owner).toHaveURL(/\/app$/);
  await owner.getByRole('link', { name: 'Criar organização' }).click();
  await owner.getByLabel('Nome da organização').fill(`Estúdio E2E ${runId}`);
  await owner.getByLabel('Endereço na web').fill(slug);
  await owner.getByRole('button', { name: 'Criar organização' }).click();
  await expect(owner).toHaveURL(new RegExp(`/o/${slug}$`));

  // Dono: convida como operador e copia o link.
  await owner.goto(`/o/${slug}/configuracoes/equipe`);
  await owner.getByLabel('E-mail', { exact: true }).fill(memberEmail);
  await owner.getByLabel('Papel', { exact: true }).selectOption('operator');
  await owner.getByRole('button', { name: 'Criar convite' }).click();
  const linkInput = owner.getByLabel('Link do convite');
  await expect(linkInput).toBeVisible();
  const link = await linkInput.inputValue();
  expect(link).toMatch(/\/convite\/[a-f0-9]{64}$/);
  await expect(owner.getByRole('region', { name: 'Convites pendentes' })).toContainText(
    memberEmail,
  );

  // Pessoa errada não aceita o convite.
  const outsider = await newPage(browser);
  const invitePath = new URL(link).pathname;
  await signIn(outsider, outsiderEmail, invitePath);
  await expect(outsider).toHaveURL(new RegExp(invitePath));
  await outsider.getByRole('button', { name: 'Aceitar convite' }).click();
  await expect(
    outsider.getByRole('alert').filter({ hasText: 'enviado para outro e-mail' }),
  ).toBeVisible();

  // Membro convidado aceita e cai na organização.
  const member = await newPage(browser);
  await signIn(member, memberEmail, invitePath);
  await member.getByRole('button', { name: 'Aceitar convite' }).click();
  await expect(member).toHaveURL(new RegExp(`/o/${slug}$`));

  // Operador: vê a equipe, mas não gerencia nem vê auditoria.
  await member.goto(`/o/${slug}/configuracoes/equipe`);
  await expect(member.getByRole('heading', { name: 'Convidar' })).toHaveCount(0);
  await expect(member.getByRole('button', { name: 'Alterar papel' })).toHaveCount(0);
  await member.goto(`/o/${slug}/configuracoes/auditoria`);
  await expect(
    member.getByText('Apenas administradores e proprietários veem a auditoria.'),
  ).toBeVisible();

  // Dono promove o operador a administrador.
  await owner.reload();
  const row = owner.getByRole('row', { name: /Membro Teste/ });
  await row.getByLabel('Novo papel de Membro Teste').selectOption('admin');
  await row.getByRole('button', { name: 'Alterar papel' }).click();
  await expect(row.getByRole('cell', { name: 'Administrador', exact: true })).toBeVisible();

  // Auditoria registra convite, entrada e mudança de papel.
  await owner.goto(`/o/${slug}/configuracoes/auditoria`);
  const table = owner.getByRole('table');
  await expect(table).toContainText('Convite criado');
  await expect(table).toContainText('Membro adicionado');
  await expect(table).toContainText('Papel alterado');
  await expect(table).toContainText('Operador → Administrador');

  // Isolamento: quem não é membro recebe 404, sem revelar a organização.
  await outsider.goto(`/o/${slug}`);
  await expect(
    outsider.getByRole('heading', { name: 'Não encontrado ou sem acesso' }),
  ).toBeVisible();
  await outsider.goto(`/o/${slug}/configuracoes/equipe`);
  await expect(
    outsider.getByRole('heading', { name: 'Não encontrado ou sem acesso' }),
  ).toBeVisible();
});
