import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RPC_SIGNATURES } from '../../src/rpc';
import {
  functionArgNames,
  permissivePolicies,
  securityDefinerExecutableByAnon,
  securityDefinerWithoutSearchPath,
  tablePrivileges,
  tablesGrantedToAnon,
  tablesWithoutOrgId,
  tablesWithoutRls,
  tenantTablesWithoutSelectPolicy,
  viewsBypassingRls,
} from '../support/catalog';
import { createTestDb, type TestDb } from '../support/test-db';

/**
 * Teste de catálogo: falha se QUALQUER tabela do schema public (atual ou futura)
 * ficar sem RLS, se uma tabela de tenant não tiver política de leitura, se surgir
 * política permissiva ou função security definer sem search_path fixo.
 */
describe('catálogo de RLS', () => {
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

  it('toda tabela com org_id tem política de leitura', async () => {
    expect(await tenantTablesWithoutSelectPolicy(db)).toEqual([]);
  });

  it('tabelas de dados têm org_id (exceções documentadas)', async () => {
    expect(await tablesWithoutOrgId(db)).toEqual([]);
  });

  it('nenhuma política permissiva (true) ou concedida a anon/public', async () => {
    expect(await permissivePolicies(db)).toEqual([]);
  });

  it('toda função security definer fixa o search_path', async () => {
    expect(await securityDefinerWithoutSearchPath(db)).toEqual([]);
  });

  it('nenhuma view em public contorna o RLS (exige security_invoker)', async () => {
    expect(await viewsBypassingRls(db)).toEqual([]);
  });

  it('anon não tem privilégio em nenhuma tabela de public', async () => {
    expect(await tablesGrantedToAnon(db)).toEqual([]);
  });

  it('anon não executa nenhuma função security definer', async () => {
    expect(await securityDefinerExecutableByAnon(db)).toEqual([]);
  });

  it('tabelas de tenancy: authenticated só lê; escrita apenas pelas RPCs', async () => {
    for (const table of ['organizations', 'profiles', 'memberships', 'audit_log']) {
      expect({ table, privileges: await tablePrivileges(db, 'authenticated', table) }).toEqual({
        table,
        privileges: ['SELECT'],
      });
    }
    // invitations: leitura só por coluna (sem token_hash), nenhum privilégio de tabela.
    expect(await tablePrivileges(db, 'authenticated', 'invitations')).toEqual([]);
  });

  it('as RPCs chamadas pelo repositório existem com os mesmos nomes de argumentos', async () => {
    for (const [name, args] of Object.entries(RPC_SIGNATURES)) {
      expect({ name, args: await functionArgNames(db, name) }).toEqual({ name, args: [...args] });
    }
  });

  it('o teste de catálogo detecta uma tabela de tenant criada sem RLS', async () => {
    // Prova de que o teste falharia: cria a tabela, verifica e remove em seguida.
    const table = `tmp_sem_rls_${Date.now()}`;
    try {
      await db.query(`create table public.${table} (id uuid primary key, org_id uuid not null)`);
      expect(await tablesWithoutRls(db)).toContain(table);
      expect(await tenantTablesWithoutSelectPolicy(db)).toContain(table);
    } finally {
      await db.query(`drop table if exists public.${table}`);
    }
  });
});
