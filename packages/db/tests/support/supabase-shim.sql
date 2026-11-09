-- Shim mínimo do ambiente Supabase para testes de banco no PGlite (sem Docker).
-- Reproduz apenas o que as migrações e as políticas usam:
--   papéis anon/authenticated/service_role, schema auth, auth.users, auth.uid()
--   e os privilégios padrão que o Supabase concede no schema public.
-- NÃO é usado quando TEST_DATABASE_URL aponta para um Supabase real.

create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;

create schema auth;
grant usage on schema auth to anon, authenticated, service_role;

create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  email_confirmed_at timestamptz,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Mesma semântica do Supabase: lê o "sub" das claims do JWT da requisição.
create function auth.uid() returns uuid
  language sql
  stable
as $$
  select nullif(
    coalesce(
      nullif(current_setting('request.jwt.claim.sub', true), ''),
      nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
    ),
    ''
  )::uuid
$$;

grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
