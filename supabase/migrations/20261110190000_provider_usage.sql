-- =============================================================================
-- D-AI-4 — consumo de APIs externas que não são modelo (docs/06 §4, ADR-0012).
-- Uso local sem login (ADR-0007): sem org_id.
--
-- provider_usage           uma linha por chamada cobrável a um provedor (hoje: busca Tavily).
--                          SOMENTE INCLUSÃO: é a base do orçamento mensal de créditos, que
--                          bloqueia novas chamadas ao atingir o limite e precisa sobreviver a
--                          reinícios do app. Nada da consulta é guardado aqui (minimização).
-- provider_usage_monthly   soma por provedor e mês (fuso de São Paulo, calculado pelo app).
--
-- Registro de execução: sem auditoria por linha (o próprio registro é a trilha, com trace_id).
-- Só aditiva: nenhum dado existente é alterado.
-- =============================================================================

create table public.provider_usage (
  id uuid primary key default gen_random_uuid(),
  -- Identificadores do código (ex.: 'tavily', 'opencnpj'); formato fixo em vez de enum para
  -- caber os próximos provedores sem migração.
  provider text not null check (provider ~ '^[a-z][a-z0-9_]{1,39}$'),
  operation text not null check (operation ~ '^[a-z][a-z0-9_]{1,39}$'),
  -- Unidade do provedor (créditos da Tavily). Zero quando a chamada não foi cobrada.
  units integer not null check (units between 0 and 1000),
  -- Plano gratuito: sem custo em dinheiro. Fica para provedores pagos (micro-dólares no app).
  cost_usd numeric(12, 6) not null default 0 check (cost_usd >= 0),
  -- Mês de referência do orçamento, 'AAAA-MM' no fuso America/Sao_Paulo.
  period text not null check (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  outcome text not null check (outcome ~ '^[a-z][a-z0-9_]{1,39}$'),
  trace_id uuid not null,
  -- Referência opaca (ex.: id de registro do provedor). Nunca a consulta nem dado pessoal.
  ref text check (ref is null or char_length(ref) between 1 and 200),
  occurred_at timestamptz not null,
  created_at timestamptz not null default now()
);
comment on table public.provider_usage is
  'Uma linha por chamada cobrável a API externa que não é modelo (somente inclusão). Base do orçamento mensal de créditos.';
create index provider_usage_period_idx on public.provider_usage (provider, period);
create index provider_usage_occurred_idx on public.provider_usage (occurred_at desc);

create trigger provider_usage_append_only
  before update or delete on public.provider_usage
  for each row execute function app.forbid_append_only_mutation();
create trigger provider_usage_no_truncate
  before truncate on public.provider_usage
  for each statement execute function app.forbid_append_only_mutation();

create view public.provider_usage_monthly with (security_invoker = true) as
  select
    provider,
    period,
    sum(units)::integer as units_used,
    count(*)::integer as calls
  from public.provider_usage
  group by provider, period;
comment on view public.provider_usage_monthly is
  'Unidades consumidas por provedor e mês (orçamento de créditos da pesquisa na internet).';

-- -----------------------------------------------------------------------------
-- Acesso: só o servidor do app (ADR-0007)
-- -----------------------------------------------------------------------------

alter table public.provider_usage enable row level security;

revoke all on public.provider_usage, public.provider_usage_monthly
  from anon, authenticated, service_role;
grant select, insert on public.provider_usage to service_role;
grant select on public.provider_usage_monthly to service_role;
