import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT ?? 3100);
const baseURL = `http://127.0.0.1:${PORT}`;
const withDatabase = process.env.E2E_SUPABASE === '1';

/**
 * Smoke (sempre): telas, estados sem banco, proteção de host, cabeçalhos e acessibilidade.
 * Roda com o banco desligado de propósito (variáveis vazias sobrepõem o .env.local).
 *
 * Com banco (E2E_SUPABASE=1): usa SUPABASE_URL e SUPABASE_SECRET_KEY do ambiente ou do
 * .env.local de um projeto de desenvolvimento com as migrações aplicadas. Ver
 * docs/runbooks/ambiente-local.md e e2e/database.spec.ts.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: { baseURL, trace: 'retain-on-failure', locale: 'pt-BR' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `pnpm exec next build && pnpm exec next start --hostname 127.0.0.1 --port ${PORT}`,
    url: `${baseURL}/configuracoes`,
    reuseExistingServer: !process.env.CI,
    timeout: 300_000,
    env: {
      NEXT_TELEMETRY_DISABLED: '1',
      ...(withDatabase ? {} : { SUPABASE_URL: '', SUPABASE_SECRET_KEY: '' }),
    },
  },
});
