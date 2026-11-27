import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT ?? 3100);
const baseURL = `http://127.0.0.1:${PORT}`;
const MEMORY_PORT = Number(process.env.E2E_MEMORY_PORT ?? 3110);
const memoryURL = `http://127.0.0.1:${MEMORY_PORT}`;
/** Descoberta (F4): servidor próprio, para as empresas que ela cria não aparecerem nos outros specs. */
const DISCOVERY_PORT = Number(process.env.E2E_DISCOVERY_PORT ?? MEMORY_PORT + 5);
const discoveryURL = `http://127.0.0.1:${DISCOVERY_PORT}`;
const DISCOVERY_SPEC = /discovery\.spec\.ts$/;
/**
 * E-mail (ADR-0016, E3): também no servidor da Descoberta, que tem a caixa simulada e nenhuma
 * política de contato (a tela avisa que falta o opt-out sem depender da ordem dos outros specs).
 */
const EMAIL_SPEC = /email\.spec\.ts$/;
/**
 * Pesquisa extensa do Copiloto: no servidor da Descoberta (buscador sintético e trabalhador da
 * fila ligados), DEPOIS da Descoberta, para os lotes não disputarem a fila com as pesquisas dela.
 */
const RESEARCH_SPEC = /copilot-research\.spec\.ts$/;
const withDatabase = process.env.E2E_SUPABASE === '1';
const withOllama = process.env.E2E_OLLAMA === '1';
/** Specs que gravam dados: rodam no servidor em modo memória (sem banco real). */
const STRATEGY_SPEC = /(strategy|copilot-history)\.spec\.ts$/;
/**
 * Empresas: mesmo servidor de memória, ANTES da Estratégia. Os testes conferem a lista vazia e a
 * investigação sem oferta ativa; rodando junto com strategy.spec (que ativa e depois desativa a
 * oferta), o resultado dependia de quem chegava primeiro e falhava no CI, com menos workers.
 */
const COMPANIES_SPEC = /companies\.spec\.ts$/;
/**
 * Relacionamento: mesmo servidor de memória, mas DEPOIS dos specs acima (usa a oferta e a empresa
 * que eles criam, e não pode criar dados enquanto eles conferem os estados vazios).
 */
const RELATIONSHIP_SPEC = /relationship\.spec\.ts$/;
/** Monitoramento e Inteligência: só leem, DEPOIS de todos os specs que gravam no mesmo servidor. */
const INSIGHTS_SPEC = /insights\.spec\.ts$/;

/** Sem E2E_OLLAMA=1, o Copiloto aponta para uma porta sem servidor (estado "Ollama fora do ar"). */
const ollamaEnv: Record<string, string> = withOllama
  ? {}
  : { OLLAMA_BASE_URL: 'http://127.0.0.1:9' };

/**
 * Sem internet nos testes: no servidor principal a consulta de CNPJ fica desligada; no de memória,
 * usa registros sintéticos (src/server/cnpj-fixture.ts), marcados como demonstração.
 */
const offlineEnv: Record<string, string> = { PROSPECTOR_CNPJ_LOOKUP: 'off' };
const fixtureEnv: Record<string, string> = {
  PROSPECTOR_CNPJ_LOOKUP: 'fixture',
  // IA do Relacionamento sintética (src/server/relationship-ai-fixture.ts), marcada DEMO.
  PROSPECTOR_RELATIONSHIP_AI: 'fixture',
};

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
  // Sem animação (o app respeita "reduzir movimento"): o axe e os cliques não pegam um painel no
  // meio da entrada. O movimento em si é conferido em e2e/shell.spec.ts.
  use: { baseURL, trace: 'retain-on-failure', locale: 'pt-BR', reducedMotion: 'reduce' },
  projects: [
    {
      name: 'chromium',
      testIgnore: [
        STRATEGY_SPEC,
        COMPANIES_SPEC,
        DISCOVERY_SPEC,
        RELATIONSHIP_SPEC,
        EMAIL_SPEC,
        INSIGHTS_SPEC,
        RESEARCH_SPEC,
      ],
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'empresas-memoria',
      testMatch: COMPANIES_SPEC,
      use: { ...devices['Desktop Chrome'], baseURL: memoryURL },
    },
    {
      name: 'estrategia-memoria',
      testMatch: STRATEGY_SPEC,
      dependencies: ['empresas-memoria'],
      use: { ...devices['Desktop Chrome'], baseURL: memoryURL },
    },
    {
      name: 'descoberta-memoria',
      testMatch: DISCOVERY_SPEC,
      use: { ...devices['Desktop Chrome'], baseURL: discoveryURL },
    },
    {
      name: 'pesquisa-copiloto-memoria',
      testMatch: RESEARCH_SPEC,
      dependencies: ['descoberta-memoria'],
      use: { ...devices['Desktop Chrome'], baseURL: discoveryURL },
    },
    {
      name: 'email-memoria',
      testMatch: EMAIL_SPEC,
      use: { ...devices['Desktop Chrome'], baseURL: discoveryURL },
    },
    {
      name: 'relacionamento-memoria',
      testMatch: RELATIONSHIP_SPEC,
      dependencies: ['estrategia-memoria'],
      use: { ...devices['Desktop Chrome'], baseURL: memoryURL },
    },
    {
      name: 'insights-memoria',
      testMatch: INSIGHTS_SPEC,
      dependencies: ['relacionamento-memoria'],
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
        // Com E2E_SUPABASE=1 este servidor usa o banco real: sem trabalhador da fila, ele não pega
        // as pesquisas nem os monitoramentos do usuário (e não gasta créditos nem GPU sozinho).
        PROSPECTOR_JOB_WORKER: 'off',
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
        PROSPECTOR_JOB_WORKER: 'off',
        SUPABASE_URL: '',
        SUPABASE_SECRET_KEY: '',
        ...ollamaEnv,
        ...fixtureEnv,
      },
    },
    {
      // Buscador e IA SINTÉTICOS (src/server/discovery-fixture.ts): sem internet, sem créditos
      // e sem GPU; tudo sai marcado DEMO.
      command: `pnpm exec next start --hostname 127.0.0.1 --port ${DISCOVERY_PORT}`,
      url: `${discoveryURL}/configuracoes`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        NEXT_TELEMETRY_DISABLED: '1',
        PROSPECTOR_STORAGE: 'memory',
        PROSPECTOR_DISCOVERY: 'fixture',
        // Caixa de e-mail SIMULADA (src/server/email-fixture.ts): não conecta em servidor nenhum.
        PROSPECTOR_EMAIL: 'fixture',
        SUPABASE_URL: '',
        SUPABASE_SECRET_KEY: '',
        ...ollamaEnv,
        ...fixtureEnv,
      },
    },
  ],
});
