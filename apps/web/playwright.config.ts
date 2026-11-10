import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT ?? 3100);
const baseURL = `http://127.0.0.1:${PORT}`;
const MEMORY_PORT = Number(process.env.E2E_MEMORY_PORT ?? 3110);
const memoryURL = `http://127.0.0.1:${MEMORY_PORT}`;
const withDatabase = process.env.E2E_SUPABASE === '1';
const withOllama = process.env.E2E_OLLAMA === '1';
/** Specs que gravam dados: rodam no servidor em modo memória (sem banco real). */
const STRATEGY_SPEC = /(strategy|copilot-history|companies)\.spec\.ts$/;

/** Sem E2E_OLLAMA=1, o Copiloto aponta para uma porta sem servidor (estado "Ollama fora do ar"). */
const ollamaEnv: Record<string, string> = withOllama
  ? {}
  : { OLLAMA_BASE_URL: 'http://127.0.0.1:9' };

/**
 * Sem internet nos testes: no servidor principal a consulta de CNPJ fica desligada; no de memória,
 * usa registros sintéticos (src/server/cnpj-fixture.ts), marcados como demonstração.
 */
const offlineEnv: Record<string, string> = { PROSPECTOR_CNPJ_LOOKUP: 'off' };
const fixtureEnv: Record<string, string> = { PROSPECTOR_CNPJ_LOOKUP: 'fixture' };

/**
 * Smoke (sempre): telas, estados sem banco, proteção de host, cabeçalhos e acessibilidade.
 * Roda com o banco desligado de propósito (variáveis vazias sobrepõem o .env.local).
 *
 * Estratégia (F2): fluxo completo de gravação num segundo servidor do mesmo build, em modo
 * memória (PROSPECTOR_STORAGE=memory, ADR-0009), sem tocar em banco nenhum. Sobe sempre do zero
 * (sem reaproveitar servidor) para começar sem dados.
 *
 * Com banco (E2E_SUPABASE=1): usa SUPABASE_URL e SUPABASE_SECRET_KEY do ambiente ou do
 * .env.local de um projeto de desenvolvimento com as migrações aplicadas. Ver
 * docs/runbooks/ambiente-local.md e e2e/database.spec.ts.
 *
 * IA local: com E2E_OLLAMA=1 usa o Ollama real deste computador e gera uma resposta de verdade.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: { baseURL, trace: 'retain-on-failure', locale: 'pt-BR' },
  projects: [
    { name: 'chromium', testIgnore: STRATEGY_SPEC, use: { ...devices['Desktop Chrome'] } },
    {
      name: 'estrategia-memoria',
      testMatch: STRATEGY_SPEC,
      use: { ...devices['Desktop Chrome'], baseURL: memoryURL },
    },
  ],
  // Os servidores sobem em sequência: o segundo reaproveita o build feito pelo primeiro.
  webServer: [
    {
      command: `pnpm exec next build && pnpm exec next start --hostname 127.0.0.1 --port ${PORT}`,
      url: `${baseURL}/configuracoes`,
      reuseExistingServer: !process.env.CI,
      timeout: 300_000,
      env: {
        NEXT_TELEMETRY_DISABLED: '1',
        ...(withDatabase ? {} : { SUPABASE_URL: '', SUPABASE_SECRET_KEY: '' }),
        ...ollamaEnv,
        ...offlineEnv,
      },
    },
    {
      command: `pnpm exec next start --hostname 127.0.0.1 --port ${MEMORY_PORT}`,
      url: `${memoryURL}/configuracoes`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        NEXT_TELEMETRY_DISABLED: '1',
        PROSPECTOR_STORAGE: 'memory',
        SUPABASE_URL: '',
        SUPABASE_SECRET_KEY: '',
        ...ollamaEnv,
        ...fixtureEnv,
      },
    },
  ],
});
