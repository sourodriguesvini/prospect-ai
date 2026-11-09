import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Banco de teste para migrações e RLS.
 * - Padrão: PGlite (Postgres em WASM) + shim do Supabase. Rápido, sem Docker.
 * - Com TEST_DATABASE_URL: Postgres de um Supabase local (`supabase start` + `supabase db reset`),
 *   com as migrações já aplicadas. Usado no CI para validar contra o ambiente real.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../../..');
const migrationsDir = path.join(repoRoot, 'supabase', 'migrations');

export type Row = Record<string, unknown>;

export interface Queryable {
  query<T extends Row = Row>(sql: string, params?: unknown[]): Promise<T[]>;
}

export interface TestUser {
  id: string;
  email: string;
}

export interface TestDb extends Queryable {
  readonly mode: 'pglite' | 'postgres';
  /** Executa `fn` numa transação como `authenticated` com o JWT do usuário. */
  asUser<T>(userId: string, fn: (q: Queryable) => Promise<T>): Promise<T>;
  /** Executa `fn` numa transação com outro papel do Supabase. */
  asRole<T>(role: 'anon' | 'service_role', fn: (q: Queryable) => Promise<T>): Promise<T>;
  createUser(options?: { confirmed?: boolean; fullName?: string }): Promise<TestUser>;
  close(): Promise<void>;
}

/** E-mail único e claramente fictício (TLD reservado .test). */
export function testEmail(label: string): string {
  return `${label}-${randomUUID().slice(0, 8)}@example.test`;
}

/** Slug único para organizações de teste. */
export function testSlug(label: string): string {
  return `${label}-${randomUUID().slice(0, 8)}`;
}

async function listMigrations(): Promise<string[]> {
  const files = (await readdir(migrationsDir)).filter((f) => f.endsWith('.sql')).sort();
  return files.map((f) => path.join(migrationsDir, f));
}

const CREATE_USER_SQL = `
  insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data)
  values ($1, $2, case when $3::boolean then now() end, $4::jsonb)
  returning id`;

export async function createTestDb(): Promise<TestDb> {
  const url = process.env.TEST_DATABASE_URL;
  return url ? createPostgresDb(url) : createPgliteDb();
}

async function createPgliteDb(): Promise<TestDb> {
  const { PGlite } = await import('@electric-sql/pglite');
  const db = new PGlite();
  await db.exec(await readFile(path.join(here, 'supabase-shim.sql'), 'utf8'));
  for (const file of await listMigrations()) {
    try {
      await db.exec(await readFile(file, 'utf8'));
    } catch (error) {
      throw new Error(`Falha ao aplicar ${path.basename(file)}: ${(error as Error).message}`, {
        cause: error,
      });
    }
  }

  type Runner = { query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }> };
  const wrap = (runner: Runner): Queryable => ({
    async query<T extends Row = Row>(sql: string, params?: unknown[]) {
      return (await runner.query(sql, params)).rows as T[];
    },
  });

  const inTransaction = <T>(
    setup: string[],
    claims: string | null,
    fn: (q: Queryable) => Promise<T>,
  ) =>
    db.transaction(async (tx) => {
      for (const statement of setup) await tx.exec(statement);
      if (claims !== null)
        await tx.query("select set_config('request.jwt.claims', $1, true)", [claims]);
      return fn(wrap(tx));
    });

  const base = wrap(db);
  return {
    mode: 'pglite',
    query: base.query,
    asUser: (userId, fn) =>
      inTransaction(
        ['set local role authenticated'],
        JSON.stringify({ sub: userId, role: 'authenticated' }),
        fn,
      ),
    asRole: (role, fn) => inTransaction([`set local role ${role}`], JSON.stringify({ role }), fn),
    async createUser(options) {
      const email = testEmail('user');
      const meta = JSON.stringify(options?.fullName ? { full_name: options.fullName } : {});
      const rows = await base.query<{ id: string }>(CREATE_USER_SQL, [
        randomUUID(),
        email,
        options?.confirmed ?? true,
        meta,
      ]);
      return { id: rows[0]!.id, email };
    },
    close: () => db.close(),
  };
}

async function createPostgresDb(url: string): Promise<TestDb> {
  const { default: pg } = await import('pg');
  const pool = new pg.Pool({ connectionString: url, max: 4 });

  const wrap = (client: {
    query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>;
  }): Queryable => ({
    async query<T extends Row = Row>(sql: string, params?: unknown[]) {
      return (await client.query(sql, params)).rows as T[];
    },
  });

  async function inTransaction<T>(
    role: string,
    claims: string,
    fn: (q: Queryable) => Promise<T>,
  ): Promise<T> {
    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query(`set local role ${role}`);
      await client.query("select set_config('request.jwt.claims', $1, true)", [claims]);
      const result = await fn(wrap(client));
      await client.query('commit');
      return result;
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  const base = wrap(pool);
  return {
    mode: 'postgres',
    query: base.query,
    asUser: (userId, fn) =>
      inTransaction('authenticated', JSON.stringify({ sub: userId, role: 'authenticated' }), fn),
    asRole: (role, fn) => inTransaction(role, JSON.stringify({ role }), fn),
    async createUser(options) {
      const email = testEmail('user');
      const meta = JSON.stringify(options?.fullName ? { full_name: options.fullName } : {});
      const rows = await base.query<{ id: string }>(CREATE_USER_SQL, [
        randomUUID(),
        email,
        options?.confirmed ?? true,
        meta,
      ]);
      return { id: rows[0]!.id, email };
    },
    close: () => pool.end(),
  };
}

/** Espera que a promessa falhe com a chave de erro (mensagem) ou código SQLSTATE indicados. */
export async function expectDbError(
  promise: Promise<unknown>,
  expected: { message?: string | RegExp; code?: string },
) {
  let error: unknown;
  try {
    await promise;
  } catch (e) {
    error = e;
  }
  if (!error)
    throw new Error(`Esperava erro ${JSON.stringify(expected)}, mas a operação foi aceita.`);
  const { message, code } = error as { message?: string; code?: string };
  if (expected.code && code !== expected.code) {
    throw new Error(`Esperava código ${expected.code}, recebi ${code}: ${message}`);
  }
  if (expected.message) {
    const ok =
      typeof expected.message === 'string'
        ? message === expected.message
        : expected.message.test(message ?? '');
    if (!ok) throw new Error(`Esperava mensagem ${String(expected.message)}, recebi: ${message}`);
  }
}
