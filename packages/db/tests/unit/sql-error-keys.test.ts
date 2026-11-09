import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ERROR_MESSAGES } from '@prospector/application';
import { describe, expect, it } from 'vitest';
import { toAppError } from '../../src/errors';
import { INTERNAL_DB_ERROR_KEYS } from '../../src/sql-errors';

const migrationsDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../supabase/migrations',
);

function raisedKeys(): string[] {
  const keys = new Set<string>();
  for (const file of readdirSync(migrationsDir).filter((f) => f.endsWith('.sql'))) {
    const sql = readFileSync(path.join(migrationsDir, file), 'utf8');
    for (const match of sql.matchAll(/raise exception '([a-z_]+)'/g)) {
      if (match[1]) keys.add(match[1]);
    }
  }
  return [...keys].sort();
}

/**
 * Contrato entre o SQL e a aplicação: toda chave levantada por `raise exception '<chave>'`
 * ou é interna (lista explícita) ou tem mensagem em pt-BR e chega à UI com o mesmo motivo.
 */
describe('chaves de erro do banco', () => {
  const keys = raisedKeys();

  it('as migrações levantam erros com chave', () => {
    expect(keys.length).toBeGreaterThan(0);
  });

  it('toda chave pública tem mensagem e é mapeada para o mesmo motivo', () => {
    for (const key of keys.filter((k) => !INTERNAL_DB_ERROR_KEYS.includes(k))) {
      expect(Object.hasOwn(ERROR_MESSAGES, key), key).toBe(true);
      expect(toAppError({ message: key }).reason, key).toBe(key);
    }
  });

  it('a lista de chaves internas não tem sobras', () => {
    for (const key of INTERNAL_DB_ERROR_KEYS) expect(keys, key).toContain(key);
  });
});
