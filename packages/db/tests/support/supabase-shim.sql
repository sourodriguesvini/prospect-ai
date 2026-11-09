-- Shim mínimo do ambiente Supabase para testes de banco no PGlite (sem Docker).
-- Reproduz apenas o que as migrações e os testes usam: os papéis anon/authenticated/
-- service_role e os privilégios padrão que o Supabase concede no schema public.
-- NÃO é usado quando TEST_DATABASE_URL aponta para um Supabase real.

create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;

grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
