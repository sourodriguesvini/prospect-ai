import { defineConfig } from 'vitest/config';

/** Testes de migrações, RLS e isolamento (PGlite por padrão; Supabase real com TEST_DATABASE_URL). */
export default defineConfig({
  test: {
    include: ['tests/db/**/*.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 120_000,
    // Cada arquivo cria o próprio banco; no modo Postgres compartilhado, evita disputa.
    fileParallelism: !process.env.TEST_DATABASE_URL,
  },
});
