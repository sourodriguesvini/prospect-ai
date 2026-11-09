import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  functionsExecutableByApiRoles,
  objectsGrantedToApiRoles,
  policiesInPublic,
  securityDefinerWithoutSearchPath,
  tablesWithoutRls,
  viewsBypassingRls,
} from '../support/catalog';
import { createTestDb, type TestDb } from '../support/test-db';

/**
 * Teste de catálogo (ADR-0007): falha se QUALQUER objeto do banco, atual ou futuro, ficar
 * acessível pela API pública do Supabase (chave pública → anon/authenticated). O acesso é
 * só pelo servidor do app, com a secret key.
 */
describe('catálogo: banco fechado para a API pública', () => {
  let db: TestDb;
  beforeAll(async () => {
    db = await createTestDb();
  });
  afterAll(async () => {
    await db.close();
  });

  it('toda tabela do schema public tem RLS habilitado', async () => {
    expect(await tablesWithoutRls(db)).toEqual([]);
  });

  it('nenhuma política RLS em public (nenhuma linha visível para a API pública)', async () => {
    expect(await policiesInPublic(db)).toEqual([]);
  });

  it('anon e authenticated não têm privilégio em tabelas, views ou sequências', async () => {
    expect(await objectsGrantedToApiRoles(db)).toEqual([]);
  });

  it('anon e authenticated não executam nenhuma função de public ou app', async () => {
    expect(await functionsExecutableByApiRoles(db)).toEqual([]);
  });

  it('nenhuma view em public contorna o RLS (exige security_invoker)', async () => {
    expect(await viewsBypassingRls(db)).toEqual([]);
  });

  it('toda função security definer fixa o search_path', async () => {
    expect(await securityDefinerWithoutSearchPath(db)).toEqual([]);
  });

  it('uma tabela criada numa migração futura nasce fechada para a API pública', async () => {
    // Os privilégios padrão do Supabase dariam tudo a anon/authenticated; a migração os revoga.
    const table = `tmp_futura_${Date.now()}`;
    try {
      await db.query(`create table public.${table} (id uuid primary key)`);
      expect(await objectsGrantedToApiRoles(db)).toEqual([]);
      expect(await tablesWithoutRls(db)).toContain(table);
    } finally {
      await db.query(`drop table if exists public.${table}`);
    }
  });

  it('o teste detecta política e privilégio concedidos à API pública', async () => {
    const table = `tmp_aberta_${Date.now()}`;
    try {
      await db.query(`create table public.${table} (id uuid primary key)`);
      await db.query(`alter table public.${table} enable row level security`);
      await db.query(`grant select on public.${table} to anon`);
      await db.query(`create policy leitura on public.${table} for select to anon using (true)`);
      expect(await objectsGrantedToApiRoles(db)).toContain(`anon: ${table}`);
      expect(await policiesInPublic(db)).toContain(`${table}.leitura`);
    } finally {
      await db.query(`drop table if exists public.${table}`);
    }
  });
});
