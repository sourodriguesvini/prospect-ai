/**
 * Apaga `apps/desktop/dist` antes do build: um módulo removido de `src` não pode sobrar no `dist` e
 * ir para a instalação (o empacotador copia a pasta inteira).
 */
import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

rmSync(fileURLToPath(new URL('../dist', import.meta.url)), { recursive: true, force: true });
