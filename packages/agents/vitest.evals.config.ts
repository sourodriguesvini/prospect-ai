import { defineConfig } from 'vitest/config';

/** Avaliações locais (`pnpm evals`): rodam no Ollama deste computador, sem custo de API. */
export default defineConfig({
  test: { include: ['evals/**/*.eval.ts'], testTimeout: 1_800_000, fileParallelism: false },
});
