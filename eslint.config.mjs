import js from '@eslint/js';
import nextPlugin from '@next/eslint-plugin-next';
import reactHooks from 'eslint-plugin-react-hooks';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';

/**
 * Fronteiras do ADR-0001 aplicadas no nível de import. O grafo de dependências entre
 * pacotes é verificado também por scripts/check-boundaries.mjs (package.json + imports relativos).
 */
const INFRA = ['@supabase/*', 'next', 'next/*', 'react', 'react-dom', 'pg', '@electric-sql/*'];
const AI_SDK = {
  group: ['@anthropic-ai/*'],
  message: 'Toda chamada ao Claude passa pelo LLM Gateway em packages/agents (CLAUDE.md).',
};

/**
 * Raiz de composição: único arquivo da web que liga serviços de application aos adaptadores de
 * @prospector/db (e o único que recebe a secret key, via src/server/env.ts). ADR-0007.
 */
const COMPOSITION_ROOT = 'apps/web/src/server/container.ts';

/** domain e contracts são puros e rodam também no navegador: sem IO, relógio ou acaso globais. */
const IMPURE_GLOBALS = [
  'fetch',
  'process',
  'Buffer',
  'setTimeout',
  'setInterval',
  'crypto',
  'XMLHttpRequest',
  'WebSocket',
  'localStorage',
  'sessionStorage',
  'document',
  'window',
];
const PURE =
  'domain e contracts são puros (ADR-0001): receba relógio, aleatoriedade e IO por parâmetro.';

function restrict(groups, message) {
  return ['error', { patterns: [{ group: groups, message }, AI_SDK] }];
}

export default defineConfig(
  {
    ignores: [
      '**/node_modules/**',
      '**/.next/**',
      '**/.turbo/**',
      '**/playwright-report/**',
      '**/test-results/**',
      '**/next-env.d.ts',
      'docs/**',
    ],
  },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-console': ['error', { allow: ['error', 'warn'] }],
    },
  },
  {
    files: ['**/*.mjs'],
    languageOptions: {
      globals: { process: 'readonly', console: 'readonly', URL: 'readonly' },
    },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    ...nextPlugin.configs['core-web-vitals'],
    settings: { next: { rootDir: 'apps/web' } },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}', 'packages/ui/**/*.{ts,tsx}'],
    ...reactHooks.configs.flat.recommended,
  },

  // --- Fronteiras (ADR-0001) ---------------------------------------------------
  {
    files: ['packages/contracts/src/**'],
    rules: {
      'no-restricted-imports': restrict(
        ['@prospector/*', ...INFRA, 'node:*'],
        'contracts só depende de zod.',
      ),
    },
  },
  {
    files: ['packages/domain/src/**'],
    rules: {
      'no-restricted-imports': restrict(
        [
          '@prospector/application',
          '@prospector/db',
          '@prospector/ui',
          '@prospector/web',
          ...INFRA,
          'node:*',
        ],
        'domain é puro: só @prospector/contracts, sem IO.',
      ),
    },
  },
  {
    files: ['packages/application/src/**'],
    rules: {
      'no-restricted-imports': restrict(
        ['@prospector/db', '@prospector/ui', '@prospector/web', ...INFRA],
        'application define portas; adaptadores (db, integrações) as implementam.',
      ),
    },
  },
  {
    files: ['packages/db/src/**'],
    rules: {
      'no-restricted-imports': restrict(
        ['@prospector/domain', '@prospector/ui', '@prospector/web', 'next', 'next/*', 'react'],
        'db implementa portas de application; não conhece UI nem regras de domínio.',
      ),
    },
  },
  {
    files: ['packages/ui/src/**'],
    rules: {
      'no-restricted-imports': restrict(
        ['@prospector/*', '@supabase/*', 'next', 'next/*'],
        'ui é apresentação pura: sem dados nem framework de rotas.',
      ),
    },
  },
  {
    files: ['packages/domain/src/**', 'packages/contracts/src/**'],
    rules: {
      'no-restricted-globals': [
        'error',
        ...IMPURE_GLOBALS.map((name) => ({ name, message: PURE })),
      ],
      'no-restricted-properties': [
        'error',
        { object: 'Date', property: 'now', message: PURE },
        { object: 'Math', property: 'random', message: PURE },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: "NewExpression[callee.name='Date'][arguments.length=0]",
          message: PURE,
        },
      ],
    },
  },
  {
    files: ['apps/web/src/**'],
    ignores: [COMPOSITION_ROOT],
    rules: {
      'no-restricted-imports': restrict(
        ['@prospector/db', '@supabase/*'],
        'A web acessa dados só pelos serviços de application (src/server/container.ts); @prospector/db só na raiz de composição e Supabase só dentro de @prospector/db (ADR-0001, ADR-0007).',
      ),
    },
  },
  {
    files: [COMPOSITION_ROOT],
    rules: {
      'no-restricted-imports': restrict(
        ['@supabase/*'],
        'A raiz de composição cria o cliente por @prospector/db; Supabase não entra na web.',
      ),
    },
  },
);
