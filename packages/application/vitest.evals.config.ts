import { defineConfig } from 'vitest/config';

/** Revisão humana da qualidade (`pnpm review:quality`): grava a página local; sem GPU nem banco. */
export default defineConfig({
  test: { include: ['evals/**/*.eval.ts'], fileParallelism: false },
});
