-- =============================================================================
-- F4 — Descoberta inteligente (ADR-0013) e fila durável de tarefas (ADR-0011).
-- Uso local sem login (ADR-0007): sem org_id; só o servidor do app (service_role) acessa.
--
-- ai_jobs                 fila durável: tarefa longa que sobrevive a reinício do app (lease,
--                         tentativas, cancelamento). Registro de execução (sem auditoria por linha).
-- discovery_monitors      pesquisas recorrentes (frequência, limites, próxima execução).
-- discovery_runs          cada pesquisa: pedido, intenção interpretada, plano, limites, progresso.
-- discovery_run_queries   cada busca feita e os resultados que trouxe: retomar sem gastar crédito.
-- discovery_prospects     empresas encontradas, deduplicadas entre pesquisas (chave única).
-- discovery_run_prospects quais empresas cada pesquisa achou (e se eram novidade).
-- discovery_sources       fontes de cada empresa (trecho curto, prazo de guarda de 12 meses).
-- discovery_signals       sinais comerciais com trecho conferido, datas e confiança do servidor.
--
-- Auditoria (ADR-0010): só as ações de pessoa ou de agendamento — criar, confirmar e cancelar
-- pesquisa; decidir sobre empresa (salvar, ignorar, investigar); criar e mudar monitoramento. As
-- escritas do trabalhador (progresso, resultados) são registro de execução, com trace_id.
-- Só aditiva: nenhum dado existente é alterado.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- ai_jobs — fila durável (ADR-0011)
-- -----------------------------------------------------------------------------

create table public.ai_jobs (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('discovery_run')),
  status text not null default 'queued'
    check (status in ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  -- Mesma tarefa pedida duas vezes = uma linha só (ex.: 'discovery_run:<id>').
  idempotency_key text not null unique check (char_length(idempotency_key) between 1 and 200),
  -- Só referências (ids); o conteúdo fica na tabela do domínio.
  payload jsonb not null default '{}'::jsonb
    check (jsonb_typeof(payload) = 'object' and pg_column_size(payload) <= 4096),
  attempts integer not null default 0 check (attempts between 0 and 50),
  max_attempts integer not null default 3 check (max_attempts between 1 and 10),
  run_after timestamptz not null default now(),
  lease_owner text check (lease_owner is null or char_length(lease_owner) between 1 and 120),
  lease_expires_at timestamptz,
  cancel_requested_at timestamptz,
  last_error_code text check (last_error_code is null or last_error_code ~ '^[a-z][a-z0-9_]{1,59}$'),
  trace_id uuid not null,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  updated_at timestamptz not null default now(),
  check ((status = 'running') = (lease_owner is not null and lease_expires_at is not null)),
  check ((status in ('succeeded', 'failed', 'cancelled')) = (finished_at is not null))
);
comment on table public.ai_jobs is
  'Fila durável de tarefas longas (ADR-0011). O trabalhador do app pega uma tarefa por vez com '
  'claim_ai_job (FOR UPDATE SKIP LOCKED), renova o lease e a encerra com finish_ai_job.';
create index ai_jobs_pending_idx on public.ai_jobs (run_after, created_at)
  where status in ('queued', 'running');
create index ai_jobs_created_idx on public.ai_jobs (created_at desc);

create trigger ai_jobs_updated_at
  before update on public.ai_jobs
  for each row execute function app.set_updated_at();

-- Pega a próxima tarefa (fila ou lease vencido de quem caiu) e marca como rodando.
create function public.claim_ai_job(p_worker text, p_kinds text[], p_lease_seconds integer)
  returns setof public.ai_jobs
  language plpgsql
  set search_path = ''
as $$
declare
  picked uuid;
begin
  if p_worker is null or char_length(p_worker) not between 1 and 120
    or p_lease_seconds is null or p_lease_seconds not between 10 and 3600 then
    raise exception 'invalid_job_claim' using errcode = '22023';
  end if;

  select j.id into picked
  from public.ai_jobs j
  where j.kind = any (p_kinds)
    and j.attempts < j.max_attempts
    and j.cancel_requested_at is null
    and (
      (j.status = 'queued' and j.run_after <= now())
      or (j.status = 'running' and j.lease_expires_at < now())
    )
  order by j.run_after, j.created_at
  for update skip locked
  limit 1;

  if picked is null then
    return;
  end if;

  return query
    update public.ai_jobs
    set status = 'running',
        attempts = attempts + 1,
        lease_owner = p_worker,
        lease_expires_at = now() + make_interval(secs => p_lease_seconds),
        started_at = coalesce(started_at, now())
    where id = picked
    returning *;
end;
$$;
comment on function public.claim_ai_job(text, text[], integer) is
  'Pega a próxima tarefa pronta (ou com lease vencido) com FOR UPDATE SKIP LOCKED e devolve a linha.';

-- Renova o lease. false = o trabalhador perdeu a tarefa (lease vencido e pego por outro) ou foi
-- pedido o cancelamento: ele deve parar.
create function public.heartbeat_ai_job(p_id uuid, p_worker text, p_lease_seconds integer)
  returns boolean
  language plpgsql
  set search_path = ''
as $$
declare
  touched integer;
begin
  if p_lease_seconds is null or p_lease_seconds not between 10 and 3600 then
    raise exception 'invalid_job_heartbeat' using errcode = '22023';
  end if;
  update public.ai_jobs
  set lease_expires_at = now() + make_interval(secs => p_lease_seconds)
  where id = p_id and status = 'running' and lease_owner = p_worker
    and cancel_requested_at is null;
  get diagnostics touched = row_count;
  return touched = 1;
end;
$$;

-- Encerra a tarefa (ou devolve à fila para nova tentativa). Só quem tem o lease encerra.
create function public.finish_ai_job(
  p_id uuid,
  p_worker text,
  p_status text,
  p_error_code text,
  p_retry_after_seconds integer
)
  returns boolean
  language plpgsql
  set search_path = ''
as $$
declare
  touched integer;
begin
  if p_status not in ('succeeded', 'failed', 'cancelled', 'retry') then
    raise exception 'invalid_job_status' using errcode = '22023';
  end if;
  if p_status = 'retry' then
    update public.ai_jobs
    set status = 'queued',
        lease_owner = null,
        lease_expires_at = null,
        last_error_code = p_error_code,
        run_after = now() + make_interval(secs => greatest(coalesce(p_retry_after_seconds, 30), 1))
    where id = p_id and status = 'running' and lease_owner = p_worker
      and attempts < max_attempts;
    get diagnostics touched = row_count;
    if touched = 1 then
      return true;
    end if;
    -- Sem tentativas sobrando: encerra como falha.
    p_status := 'failed';
  end if;
  update public.ai_jobs
  set status = p_status,
      lease_owner = null,
      lease_expires_at = null,
      last_error_code = p_error_code,
      finished_at = now()
  where id = p_id and status = 'running' and lease_owner = p_worker;
  get diagnostics touched = row_count;
  return touched = 1;
end;
$$;

-- Encerra as tarefas que caíram com o lease vencido e sem tentativa sobrando (e as canceladas
-- antes de rodar). Devolve as linhas para o app encerrar o que é de cada domínio.
create function public.expire_ai_jobs()
  returns setof public.ai_jobs
  language sql
  set search_path = ''
as $$
  update public.ai_jobs
  set status = case when cancel_requested_at is null then 'failed' else 'cancelled' end,
      last_error_code = case when cancel_requested_at is null then 'attempts_exhausted' else last_error_code end,
      lease_owner = null,
      lease_expires_at = null,
      finished_at = now()
  where (status = 'running' and lease_expires_at < now()
         and (attempts >= max_attempts or cancel_requested_at is not null))
     or (status = 'queued' and (attempts >= max_attempts or cancel_requested_at is not null))
  returning *;
$$;

-- -----------------------------------------------------------------------------
-- discovery_monitors — pesquisas recorrentes
-- -----------------------------------------------------------------------------

create table public.discovery_monitors (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 3 and 120),
  request text not null check (char_length(request) between 8 and 500),
  frequency text not null check (frequency in ('daily', 'every_3_days', 'weekly')),
  status text not null default 'active' check (status in ('active', 'paused', 'archived')),
  max_searches integer not null check (max_searches between 1 and 6),
  max_prospects integer not null check (max_prospects between 1 and 30),
  icp_id uuid references public.icp_profiles (id) on delete set null,
  next_run_at timestamptz,
  last_run_at timestamptz,
  last_run_id uuid,
  missed_runs integer not null default 0 check (missed_runs >= 0),
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status = 'active' or next_run_at is null)
);
comment on table public.discovery_monitors is
  'Pesquisas recorrentes da Descoberta. O agendador do app cria a pesquisa quando next_run_at '
  'vence; com o computador desligado, recupera uma vez só (missed_runs).';
create index discovery_monitors_due_idx on public.discovery_monitors (next_run_at)
  where status = 'active';

create trigger discovery_monitors_updated_at
  before update on public.discovery_monitors
  for each row execute function app.set_updated_at();
-- Auditoria só do que a pessoa muda (não do agendamento feito pelo trabalhador).
create trigger discovery_monitors_audit
  after insert or update of name, request, frequency, status, max_searches, max_prospects, icp_id
  on public.discovery_monitors
  for each row execute function app.audit_write();

-- -----------------------------------------------------------------------------
-- discovery_runs — cada pesquisa
-- -----------------------------------------------------------------------------

create table public.discovery_runs (
  id uuid primary key default gen_random_uuid(),
  request text not null check (char_length(request) between 8 and 500),
  options jsonb not null default '{}'::jsonb
    check (jsonb_typeof(options) = 'object' and pg_column_size(options) <= 4096),
  trigger text not null check (trigger in ('user', 'copilot', 'schedule', 'catch_up')),
  monitor_id uuid references public.discovery_monitors (id) on delete set null,
  status text not null
    check (status in ('draft', 'queued', 'running', 'completed', 'failed', 'cancelled')),
  stage text check (stage is null or stage in ('interpreting', 'searching', 'verifying', 'qualifying', 'done')),
  intent jsonb check (intent is null or (jsonb_typeof(intent) = 'object' and pg_column_size(intent) <= 16384)),
  plan jsonb check (plan is null or (jsonb_typeof(plan) = 'object' and pg_column_size(plan) <= 16384)),
  limits jsonb not null check (jsonb_typeof(limits) = 'object' and pg_column_size(limits) <= 1024),
  progress jsonb not null default '{}'::jsonb
    check (jsonb_typeof(progress) = 'object' and pg_column_size(progress) <= 2048),
  partial boolean not null default false,
  failure_code text check (failure_code is null or failure_code ~ '^[a-z][a-z0-9_]{1,39}$'),
  icp_id uuid references public.icp_profiles (id) on delete set null,
  icp_version_id uuid references public.icp_profile_versions (id) on delete set null,
  offer_id uuid references public.offers (id) on delete set null,
  scoring_model_version_id uuid references public.scoring_models (id) on delete set null,
  prompt_ids text[] not null default '{}' check (cardinality(prompt_ids) <= 6),
  trace_id uuid not null,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  confirmed_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  cancel_requested_at timestamptz,
  updated_at timestamptz not null default now(),
  check ((status in ('completed', 'failed', 'cancelled')) = (finished_at is not null)),
  -- Rascunho do Copiloto só sai da gaveta com a confirmação da pessoa (ou é cancelado).
  check (confirmed_at is not null or status in ('draft', 'cancelled'))
);
comment on table public.discovery_runs is
  'Pesquisas da Descoberta (pedido em linguagem natural, intenção, plano, limites e progresso). '
  'draft = preparada pelo Copiloto, espera a confirmação da pessoa.';
create index discovery_runs_created_idx on public.discovery_runs (created_at desc);
create index discovery_runs_active_idx on public.discovery_runs (status)
  where status in ('draft', 'queued', 'running');
create index discovery_runs_monitor_idx on public.discovery_runs (monitor_id, created_at desc)
  where monitor_id is not null;

alter table public.discovery_monitors
  add constraint discovery_monitors_last_run_fk
  foreign key (last_run_id) references public.discovery_runs (id) on delete set null;

create trigger discovery_runs_updated_at
  before update on public.discovery_runs
  for each row execute function app.set_updated_at();
-- Criar, confirmar e cancelar são decisões auditadas; progresso do trabalhador não.
create trigger discovery_runs_audit
  after insert or update of confirmed_at, cancel_requested_at on public.discovery_runs
  for each row execute function app.audit_write();

-- Pesquisa confirmada entra na fila na mesma transação (sem pesquisa "na fila" sem tarefa).
create function app.enqueue_discovery_run() returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  if new.status = 'queued' and (tg_op = 'INSERT' or old.status is distinct from 'queued') then
    insert into public.ai_jobs (kind, idempotency_key, payload, trace_id)
    values ('discovery_run', 'discovery_run:' || new.id::text,
            jsonb_build_object('runId', new.id), new.trace_id)
    on conflict (idempotency_key) do nothing;
  end if;
  return null;
end;
$$;

create trigger discovery_runs_enqueue
  after insert or update of status on public.discovery_runs
  for each row execute function app.enqueue_discovery_run();

-- Cancelar a pesquisa marca a tarefa: quem está rodando para na próxima renovação do lease.
create function app.cancel_discovery_job() returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  if new.cancel_requested_at is not null and old.cancel_requested_at is null then
    update public.ai_jobs
    set cancel_requested_at = new.cancel_requested_at
    where idempotency_key = 'discovery_run:' || new.id::text
      and status in ('queued', 'running');
  end if;
  return null;
end;
$$;

create trigger discovery_runs_cancel_job
  after update of cancel_requested_at on public.discovery_runs
  for each row execute function app.cancel_discovery_job();

-- -----------------------------------------------------------------------------
-- discovery_run_queries — buscas feitas (retomar sem gastar crédito)
-- -----------------------------------------------------------------------------

create table public.discovery_run_queries (
  run_id uuid not null references public.discovery_runs (id) on delete cascade,
  position smallint not null check (position between 0 and 11),
  query jsonb not null check (jsonb_typeof(query) = 'object' and pg_column_size(query) <= 2048),
  status text not null check (status in ('done', 'failed')),
  -- Resultados do buscador como vieram (sem máscara desde a emenda do ADR-0012), só para retomar
  -- a pesquisa sem gastar crédito; esvaziados depois do prazo de guarda (KI-113).
  results jsonb not null default '[]'::jsonb
    check (jsonb_typeof(results) = 'array' and jsonb_array_length(results) <= 10
           and pg_column_size(results) <= 32768),
  credits_charged integer not null default 0 check (credits_charged between 0 and 10),
  failure text check (failure is null or failure ~ '^[a-z][a-z0-9_]{1,39}$'),
  fetched_at timestamptz not null,
  retention_until timestamptz not null,
  primary key (run_id, position)
);
comment on table public.discovery_run_queries is
  'Cada busca do plano e os resultados (trechos curtos, prazo de guarda de 12 meses).';
create index discovery_run_queries_retention_idx on public.discovery_run_queries (retention_until);

-- -----------------------------------------------------------------------------
-- discovery_prospects — empresas encontradas (deduplicadas)
-- -----------------------------------------------------------------------------

create table public.discovery_prospects (
  id uuid primary key default gen_random_uuid(),
  -- 'domain:<site>' ou 'name:<nome normalizado>|<cidade>|<uf>' (@prospector/domain).
  dedupe_key text not null unique check (char_length(dedupe_key) between 3 and 300),
  display_name text not null check (char_length(display_name) between 1 and 160),
  -- Nome normalizado (sem acento, pontuação e forma jurídica): junta por nome + cidade.
  name_key text not null check (char_length(name_key) between 1 and 160),
  domain text check (domain is null or char_length(domain) between 3 and 253),
  website_url text check (website_url is null or (char_length(website_url) <= 2048 and website_url ~ '^https?://')),
  segment text check (segment is null or char_length(segment) <= 120),
  city text check (city is null or char_length(city) <= 120),
  uf text check (uf is null or uf ~ '^[A-Z]{2}$'),
  description text check (description is null or char_length(description) <= 400),
  cnpj text check (cnpj is null or cnpj ~ '^[0-9A-Z]{14}$'),
  company_id uuid references public.companies (id) on delete set null,
  status text not null default 'new' check (status in ('new', 'saved', 'investigating', 'dismissed')),
  dismissed_reason text check (dismissed_reason is null or char_length(dismissed_reason) <= 200),
  priority text not null check (priority in ('high', 'medium', 'low', 'insufficient')),
  priority_score integer check (priority_score is null or priority_score between 0 and 100),
  confidence text not null check (confidence in ('high', 'medium', 'low')),
  assessment jsonb check (assessment is null or (jsonb_typeof(assessment) = 'object' and pg_column_size(assessment) <= 16384)),
  site_verified boolean not null default false,
  first_seen_at timestamptz not null,
  last_seen_at timestamptz not null,
  last_verified_at timestamptz,
  first_run_id uuid not null references public.discovery_runs (id),
  last_run_id uuid not null references public.discovery_runs (id),
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status = 'dismissed' or dismissed_reason is null)
);
comment on table public.discovery_prospects is
  'Empresas encontradas pela Descoberta, uma linha por empresa entre todas as pesquisas. Viram '
  'empresa do módulo Empresas só quando a pessoa manda investigar.';
create index discovery_prospects_name_idx on public.discovery_prospects (name_key);
create index discovery_prospects_domain_idx on public.discovery_prospects (domain) where domain is not null;
create index discovery_prospects_cnpj_idx on public.discovery_prospects (left(cnpj, 8)) where cnpj is not null;
create index discovery_prospects_seen_idx on public.discovery_prospects (last_seen_at desc);
create index discovery_prospects_company_idx on public.discovery_prospects (company_id)
  where company_id is not null;

create trigger discovery_prospects_updated_at
  before update on public.discovery_prospects
  for each row execute function app.set_updated_at();
-- Decisões da pessoa (salvar, ignorar, investigar) e ligação com Empresas são auditadas.
create trigger discovery_prospects_audit
  after update of status, dismissed_reason, company_id on public.discovery_prospects
  for each row execute function app.audit_write();

-- -----------------------------------------------------------------------------
-- discovery_run_prospects — o que cada pesquisa achou
-- -----------------------------------------------------------------------------

create table public.discovery_run_prospects (
  run_id uuid not null references public.discovery_runs (id) on delete cascade,
  prospect_id uuid not null references public.discovery_prospects (id) on delete cascade,
  -- A empresa apareceu pela primeira vez nesta pesquisa (novidade de monitoramento).
  is_new boolean not null,
  matched_by text check (matched_by is null or matched_by in ('cnpj', 'site', 'name_location')),
  position smallint not null check (position between 1 and 100),
  created_at timestamptz not null default now(),
  primary key (run_id, prospect_id)
);
create index discovery_run_prospects_prospect_idx on public.discovery_run_prospects (prospect_id);

-- -----------------------------------------------------------------------------
-- discovery_sources — fontes de cada empresa
-- -----------------------------------------------------------------------------

create table public.discovery_sources (
  id uuid primary key default gen_random_uuid(),
  prospect_id uuid not null references public.discovery_prospects (id) on delete cascade,
  run_id uuid not null references public.discovery_runs (id),
  url text not null check (char_length(url) between 8 and 2048 and url ~ '^https?://'),
  host text not null check (char_length(host) between 1 and 253),
  title text check (title is null or char_length(title) <= 300),
  -- Trecho curto (até 300 caracteres, sem máscara desde a emenda do ADR-0012); esvaziado depois
  -- do prazo de guarda.
  snippet text not null default '' check (char_length(snippet) <= 300),
  kind text not null check (kind in ('search_result', 'web_page')),
  relation text not null check (relation in ('official_site', 'mention', 'directory', 'news', 'job_post')),
  provider text not null check (provider ~ '^[a-z][a-z0-9_]{1,39}$'),
  published_at date,
  captured_at timestamptz not null,
  retention_until timestamptz not null,
  unique (prospect_id, url)
);
create index discovery_sources_retention_idx on public.discovery_sources (retention_until);

-- -----------------------------------------------------------------------------
-- discovery_signals — sinais comerciais
-- -----------------------------------------------------------------------------

create table public.discovery_signals (
  id uuid primary key default gen_random_uuid(),
  prospect_id uuid not null references public.discovery_prospects (id) on delete cascade,
  run_id uuid not null references public.discovery_runs (id),
  source_id uuid not null references public.discovery_sources (id) on delete cascade,
  -- Tipos e serviços vêm dos contratos (packages/contracts); o banco só confere o formato, para
  -- um catálogo novo de sinais ou de serviços (dados da oferta) não exigir migração (ADR-0001).
  type text not null check (type ~ '^[a-z][a-z0-9_]{1,39}$'),
  summary text not null check (char_length(summary) between 1 and 300),
  quote text not null check (char_length(quote) between 1 and 300),
  event_date text check (event_date is null or event_date ~ '^\d{4}(-(0[1-9]|1[0-2])(-(0[1-9]|[12]\d|3[01]))?)?$'),
  published_at date,
  discovered_at timestamptz not null,
  verification text not null check (verification in ('confirmed', 'hypothesis')),
  confidence numeric(3, 2) not null check (confidence between 0 and 1),
  relevance text not null check (relevance in ('high', 'medium', 'low')),
  related_service text check (related_service is null or related_service ~ '^[a-z][a-z0-9_]{1,39}$'),
  rationale text not null default '' check (char_length(rationale) <= 400),
  recency text not null check (recency in ('recent', 'older', 'unknown')),
  fingerprint text not null unique check (fingerprint ~ '^[a-f0-9]{64}$'),
  retention_until timestamptz not null,
  created_at timestamptz not null default now()
);
create index discovery_signals_prospect_idx on public.discovery_signals (prospect_id, discovered_at desc);
create index discovery_signals_run_idx on public.discovery_signals (run_id);
create index discovery_signals_retention_idx on public.discovery_signals (retention_until);

-- -----------------------------------------------------------------------------
-- Acesso: só o servidor do app (ADR-0007)
-- -----------------------------------------------------------------------------

alter table public.ai_jobs enable row level security;
alter table public.discovery_monitors enable row level security;
alter table public.discovery_runs enable row level security;
alter table public.discovery_run_queries enable row level security;
alter table public.discovery_prospects enable row level security;
alter table public.discovery_run_prospects enable row level security;
alter table public.discovery_sources enable row level security;
alter table public.discovery_signals enable row level security;

revoke all on
  public.ai_jobs, public.discovery_monitors, public.discovery_runs, public.discovery_run_queries,
  public.discovery_prospects, public.discovery_run_prospects, public.discovery_sources,
  public.discovery_signals
  from anon, authenticated, service_role;

grant select, insert on
  public.ai_jobs, public.discovery_monitors, public.discovery_runs, public.discovery_run_queries,
  public.discovery_prospects, public.discovery_run_prospects, public.discovery_sources,
  public.discovery_signals
  to service_role;

-- Atualizações por coluna: o que nunca muda (ids, chaves, datas de criação, demo) fica fora.
grant update (
  status, attempts, run_after, lease_owner, lease_expires_at, cancel_requested_at,
  last_error_code, started_at, finished_at
) on public.ai_jobs to service_role;
grant update (
  name, request, frequency, status, max_searches, max_prospects, icp_id, next_run_at,
  last_run_at, last_run_id, missed_runs
) on public.discovery_monitors to service_role;
grant update (
  status, stage, intent, plan, limits, progress, partial, failure_code, icp_id, icp_version_id,
  offer_id, scoring_model_version_id, prompt_ids, confirmed_at, started_at, finished_at,
  cancel_requested_at
) on public.discovery_runs to service_role;
grant update (status, results, credits_charged, failure, fetched_at, retention_until)
  on public.discovery_run_queries to service_role;
grant update (
  dedupe_key, display_name, name_key, domain, website_url, segment, city, uf, description, cnpj,
  company_id, status, dismissed_reason, priority, priority_score, confidence, assessment,
  site_verified, last_seen_at, last_verified_at, last_run_id
) on public.discovery_prospects to service_role;
grant update (is_new, matched_by, position) on public.discovery_run_prospects to service_role;
grant update (title, snippet, retention_until) on public.discovery_sources to service_role;
-- Sinal vencido (prazo de guarda) é apagado: o trecho literal não fica além de 12 meses.
grant delete on public.discovery_signals to service_role;

-- Funções: só o servidor executa.
revoke execute on function
  public.claim_ai_job(text, text[], integer),
  public.heartbeat_ai_job(uuid, text, integer),
  public.finish_ai_job(uuid, text, text, text, integer),
  public.expire_ai_jobs()
from public, anon, authenticated;
grant execute on function
  public.claim_ai_job(text, text[], integer),
  public.heartbeat_ai_job(uuid, text, integer),
  public.finish_ai_job(uuid, text, text, text, integer),
  public.expire_ai_jobs()
to service_role;

revoke execute on all functions in schema app from public, anon, authenticated;
