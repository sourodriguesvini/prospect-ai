import type { Queryable } from './test-db';

/**
 * Verificações de catálogo que valem para TODOS os objetos presentes e futuros do banco.
 * Regra (ADR-0007): só o servidor do app (service_role) acessa o banco; a API pública
 * (anon/authenticated) não enxerga nada. Cada função devolve a lista de violações (vazia = ok).
 */

const API_ROLES = ['anon', 'authenticated'] as const;

export async function tablesWithoutRls(q: Queryable): Promise<string[]> {
  const rows = await q.query<{ table_name: string }>(`
    select c.relname as table_name
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity
    order by 1`);
  return rows.map((r) => r.table_name);
}

/** Qualquer política em public abriria linhas para a API pública: não deve existir nenhuma. */
export async function policiesInPublic(q: Queryable): Promise<string[]> {
  const rows = await q.query<{ name: string }>(`
    select tablename || '.' || policyname as name
    from pg_policies
    where schemaname = 'public'
    order by 1`);
  return rows.map((r) => r.name);
}

/** Tabelas, views e sequências de public em que anon/authenticated têm qualquer privilégio. */
export async function objectsGrantedToApiRoles(q: Queryable): Promise<string[]> {
  const rows = await q.query<{ name: string }>(
    `
    select r.role || ': ' || c.relname as name
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    cross join unnest($1::text[]) as r(role)
    where n.nspname = 'public'
      and (
        (c.relkind in ('r', 'p', 'v', 'm', 'f')
          and (has_table_privilege(r.role, c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
               or has_any_column_privilege(r.role, c.oid, 'SELECT,INSERT,UPDATE,REFERENCES')))
        or (c.relkind = 'S' and has_sequence_privilege(r.role, c.oid, 'USAGE,SELECT,UPDATE'))
      )
    order by 1`,
    [API_ROLES],
  );
  return rows.map((r) => r.name);
}

/** Funções de public e app que anon/authenticated conseguem executar. */
export async function functionsExecutableByApiRoles(q: Queryable): Promise<string[]> {
  const rows = await q.query<{ name: string }>(
    `
    select r.role || ': ' || n.nspname || '.' || p.proname as name
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    cross join unnest($1::text[]) as r(role)
    where n.nspname in ('public', 'app')
      and has_function_privilege(r.role, p.oid, 'EXECUTE')
    order by 1`,
    [API_ROLES],
  );
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
