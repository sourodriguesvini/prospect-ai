-- Shim mínimo do ambiente Supabase para testes de banco no PGlite (sem Docker).
-- Reproduz apenas o que as migrações e os testes usam: os papéis anon/authenticated/
-- service_role, os privilégios padrão que o Supabase concede no schema public e a interface do
-- Supabase Vault (ADR-0006) que a migração da caixa de e-mail usa.
-- NÃO é usado quando TEST_DATABASE_URL aponta para um Supabase real.

create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;

grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;

-- Vault: mesma assinatura da extensão supabase_vault 0.3.1. Aqui o segredo fica em texto puro
-- (é só teste); no Supabase ele é cifrado e a chave raiz fica fora do banco. Nenhum papel da
-- API tem acesso ao schema, como no Supabase.
create schema vault;
revoke all on schema vault from public;

create table vault.secrets (
  id uuid primary key default gen_random_uuid(),
  name text unique,
  description text not null default '',
  secret text not null,
  key_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create function vault.create_secret(
  new_secret text,
  new_name text default null,
  new_description text default '',
  new_key_id uuid default null
) returns uuid
  language sql
  security definer
  set search_path = ''
as $$
  insert into vault.secrets (secret, name, description, key_id)
  values (new_secret, new_name, coalesce(new_description, ''), new_key_id)
  returning id;
$$;

create function vault.update_secret(
  secret_id uuid,
  new_secret text default null,
  new_name text default null,
  new_description text default null,
  new_key_id uuid default null
) returns void
  language sql
  security definer
  set search_path = ''
as $$
  update vault.secrets
     set secret = coalesce(new_secret, secret),
         name = coalesce(new_name, name),
         description = coalesce(new_description, description),
         key_id = coalesce(new_key_id, key_id),
         updated_at = now()
   where id = secret_id;
$$;

create view vault.decrypted_secrets as
  select id, name, description, secret, secret as decrypted_secret, key_id, created_at, updated_at
  from vault.secrets;

revoke all on all tables in schema vault from public;
revoke execute on all functions in schema vault from public;
