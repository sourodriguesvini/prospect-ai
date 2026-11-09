import { defineConfig } from 'vitest/config';

/** Unitários: sem Ollama, sem GPU, sem rede (fetch e nvidia-smi simulados). */
export default defineConfig({
  test: { include: ['tests/**/*.test.ts'], exclude: ['tests/live/**'] },
});
