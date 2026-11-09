import { defineConfig } from 'vitest/config';

/**
 * Testes contra o Ollama real deste computador (`pnpm ai:live`). Exigem o Ollama aberto e os
 * modelos da política instalados; geram texto de verdade (custo zero, uso de GPU).
 */
export default defineConfig({
  test: { include: ['tests/live/**/*.test.ts'], testTimeout: 300_000, fileParallelism: false },
});
