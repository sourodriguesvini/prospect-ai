import type { Queryable } from './test-db';

/**
 * Verificações de catálogo que valem para TODAS as tabelas presentes e futuras.
 * Cada função devolve a lista de violações (vazia = ok).
 */

/** Catálogos globais somente leitura que podem existir sem org_id (docs/06 §1). */
export const GLOBAL_CATALOG_TABLES = new Set<string>([]);

export async function tablesWithoutRls(q: Queryable): Promise<string[]> {
  const rows = await q.query<{ table_name: string }>(`
    select c.relname as table_name
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity
    order by 1`);
  return rows.map((r) => r.table_name);
}

export async function tenantTablesWithoutSelectPolicy(q: Queryable): Promise<string[]> {
  const rows = await q.query<{ table_name: string }>(`
    select c.relname as table_name
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid and a.attname = 'org_id' and not a.attisdropped
    where n.nspname = 'public' and c.relkind in ('r', 'p')
      and not exists (
        select 1 from pg_policies p
        where p.schemaname = 'public' and p.tablename = c.relname and p.cmd in ('SELECT', 'ALL')
      )
    order by 1`);
  return rows.map((r) => r.table_name);
}

/** Tabelas de dados do tenant sem coluna org_id (fora das exceções documentadas). */
export async function tablesWithoutOrgId(q: Queryable): Promise<string[]> {
  const rows = await q.query<{ table_name: string }>(`
    select c.relname as table_name
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p')
      and not exists (
        select 1 from pg_attribute a
        where a.attrelid = c.oid and a.attname = 'org_id' and not a.attisdropped
      )
    order by 1`);
  // organizations é o próprio tenant; profiles é por usuário (protegida por RLS própria).
  const allowed = new Set(['organizations', 'profiles', ...GLOBAL_CATALOG_TABLES]);
  return rows.map((r) => r.table_name).filter((t) => !allowed.has(t));
}

export async function permissivePolicies(q: Queryable): Promise<string[]> {
  const rows = await q.query<{ name: string }>(`
    select tablename || '.' || policyname as name
    from pg_policies
    where schemaname = 'public'
      and (
        coalesce(qual, '') in ('true', '(true)')
        or coalesce(with_check, '') in ('true', '(true)')
        or roles && array['public', 'anon']::name[]
      )
    order by 1`);
  return rows.map((r) => r.name);
}

export async function securityDefinerWithoutSearchPath(q: Queryable): Promise<string[]> {
  const rows = await q.query<{ name: string }>(`
    select n.nspname || '.' || p.proname as name
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'app')
      and p.prosecdef
      and not exists (
        select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) as cfg where cfg like 'search_path=%'
      )
    order by 1`);
  return rows.map((r) => r.name);
}

/** Views em public ignoram o RLS das tabelas, a menos que usem security_invoker. */
export async function viewsBypassingRls(q: Queryable): Promise<string[]> {
  const rows = await q.query<{ name: string }>(`
    select c.relname as name
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and (
        c.relkind = 'm'
        or (
          c.relkind = 'v'
          and not exists (
            select 1 from unnest(coalesce(c.reloptions, '{}'::text[])) as opt
            where opt in ('security_invoker=true', 'security_invoker=on', 'security_invoker=1')
          )
        )
      )
    order by 1`);
  return rows.map((r) => r.name);
}

/** Tabelas de public em que anon tem qualquer privilégio. */
export async function tablesGrantedToAnon(q: Queryable): Promise<string[]> {
  const rows = await q.query<{ name: string }>(`
    select c.relname as name
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm')
      and has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
    order by 1`);
  return rows.map((r) => r.name);
}

/** Funções security definer (public e app) que anon consegue executar. */
export async function securityDefinerExecutableByAnon(q: Queryable): Promise<string[]> {
  const rows = await q.query<{ name: string }>(`
    select n.nspname || '.' || p.proname as name
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'app')
      and p.prosecdef
      and has_function_privilege('anon', p.oid, 'EXECUTE')
    order by 1`);
  return rows.map((r) => r.name);
}

/** Privilégios de tabela (não de coluna) que um papel tem numa tabela de public. */
export async function tablePrivileges(
  q: Queryable,
  role: string,
  table: string,
): Promise<string[]> {
  const all = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'];
  const rows = await q.query<Record<string, boolean>>(
    `select ${all
      .map((p) => `has_table_privilege($1, ('public.' || $2)::regclass, '${p}') as "${p}"`)
      .join(', ')}`,
    [role, table],
  );
  const row = rows[0] ?? {};
  return all.filter((p) => row[p]);
}

/** Nomes dos argumentos de uma função de public, na ordem (null se não existir). */
export async function functionArgNames(q: Queryable, name: string): Promise<string[] | null> {
  const rows = await q.query<{ args: string[] | null }>(
    `select p.proargnames as args
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = $1`,
    [name],
  );
  if (rows.length !== 1) return null;
  return rows[0]?.args ?? [];
}
