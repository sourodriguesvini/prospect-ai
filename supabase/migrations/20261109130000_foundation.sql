-- =============================================================================
-- F1 — Fundação (uso interno, local, sem login — docs/adr/0007)
--
-- Acesso ao banco: SOMENTE o servidor do app, com a secret key (papel service_role,
-- que ignora o RLS). A API pública do Supabase (anon/authenticated, chave pública)
-- não enxerga nada: toda tabela de public tem RLS habilitado, nenhuma política e
-- nenhum privilégio para esses papéis. O teste de catálogo vale para tabelas futuras.
--
-- Erros de regra: `raise exception '<chave>'`; a chave é mapeada para mensagem em
-- packages/application/src/errors.ts (ERROR_MESSAGES) ou listada como interna em
-- packages/db/src/sql-errors.ts.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Privilégios padrão: objetos novos não ficam acessíveis à API pública.
-- (O Supabase concede tudo a anon/authenticated por padrão no schema public.)
-- -----------------------------------------------------------------------------

alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;

create schema if not exists app;
comment on schema app is 'Funções internas do Prospector. Não exposto pela API de dados.';
revoke all on schema app from public;
grant usage on schema app to service_role;
alter default privileges in schema app revoke execute on functions from public;

-- -----------------------------------------------------------------------------
-- Utilitários
-- -----------------------------------------------------------------------------

create function app.set_updated_at() returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- audit_log (somente inclusão)
-- Escrito pela aplicação (AuditService) com ator e traceId explícitos.
-- -----------------------------------------------------------------------------

create table public.audit_log (
  id bigint generated always as identity primary key,
  actor_type text not null check (actor_type in ('user', 'agent', 'system')),
  -- Nome do agente/versão ou do processo; null para o usuário.
  actor_label text check (actor_label is null or char_length(actor_label) between 1 and 120),
  -- Convenção dominio.entidade.verbo (docs/contracts §2), ex.: approvals.approval.granted
  action text not null check (action ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){1,3}$'),
  entity_type text not null check (char_length(entity_type) between 1 and 60),
  entity_id text check (entity_id is null or char_length(entity_id) <= 200),
  diff jsonb not null default '{}'::jsonb check (pg_column_size(diff) <= 65536),
  trace_id uuid,
  occurred_at timestamptz not null default now()
);
comment on table public.audit_log is
  'Trilha de auditoria somente inclusão. Update/delete/truncate bloqueados por trigger para todos os papéis; '
  'expurgo por retenção será feito por partição (F13).';

create index audit_log_occurred_idx on public.audit_log (occurred_at desc);

create function app.forbid_audit_mutation() returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  raise exception 'audit_log_append_only' using errcode = '42501';
end;
$$;

create trigger audit_log_no_update_delete
  before update or delete on public.audit_log
  for each row execute function app.forbid_audit_mutation();

create trigger audit_log_no_truncate
  before truncate on public.audit_log
  for each statement execute function app.forbid_audit_mutation();

-- -----------------------------------------------------------------------------
-- RLS e privilégios
-- -----------------------------------------------------------------------------

alter table public.audit_log enable row level security;
-- Sem políticas: anon e authenticated não leem nem escrevem nada.
revoke all on public.audit_log from anon, authenticated;
-- O servidor (service_role) só lê e inclui.
revoke all on public.audit_log from service_role;
grant select, insert on public.audit_log to service_role;

revoke execute on all functions in schema app from public, anon, authenticated;
