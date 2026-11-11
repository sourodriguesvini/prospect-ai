-- =============================================================================
-- Módulo 02 — Investigação de empresas e Brand Intelligence (ADR-0015).
-- Uso local sem login (ADR-0007): sem org_id. Só aditiva: nenhum dado existente é alterado.
--
-- company_investigations  uma linha por execução: estado das etapas, consumo (buscas, páginas,
--                         capturas, chamadas de modelo), modelos usados, retrato da coleta,
--                         mudanças detectadas e a COMPOSIÇÃO do diagnóstico (ids de claims, notas
--                         e recomendação). As conclusões em si ficam no Evidence Ledger (claims).
--                         Uma ativa (na fila ou rodando) por empresa. Dono (runner) e batimento
--                         (heartbeat_at) permitem marcar como interrompida a execução de um
--                         processo encerrado no meio. Enquanto a fila compartilhada `ai_jobs`
--                         (ADR-0011) não chega, a execução é em processo; job_id fica reservado.
-- company_investigation_summaries  última investigação de cada empresa (lista de empresas).
-- confirm_company_site    grava o domínio confirmado como site oficial (e a chave forte).
--
-- Auditoria (ADR-0010): início, pedido de cancelamento, retomada e conclusão gravam o audit_log
-- na mesma transação. O progresso das etapas e o batimento NÃO são auditados (mudam a cada poucos
-- segundos): o trigger só dispara nas transições de estado que importam.
-- =============================================================================

create table public.company_investigations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id),
  status text not null default 'queued' check (
    status in ('queued', 'running', 'succeeded', 'partial', 'failed', 'cancelled', 'interrupted')
  ),
  trigger text not null check (trigger in ('user', 'copilot', 'discovery')),
  pipeline_version integer not null check (pipeline_version between 1 and 1000),
  steps jsonb not null default '[]'
    check (jsonb_typeof(steps) = 'array' and octet_length(steps::text) <= 32768),
  usage jsonb not null default '{}'
    check (jsonb_typeof(usage) = 'object' and octet_length(usage::text) <= 4096),
  models jsonb not null default '[]'
    check (jsonb_typeof(models) = 'array' and octet_length(models::text) <= 8192),
  diagnosis jsonb check (
    diagnosis is null or (jsonb_typeof(diagnosis) = 'object' and octet_length(diagnosis::text) <= 262144)
  ),
  snapshot jsonb check (
    snapshot is null or (jsonb_typeof(snapshot) = 'object' and octet_length(snapshot::text) <= 65536)
  ),
  changes jsonb not null default '[]'
    check (jsonb_typeof(changes) = 'array' and octet_length(changes::text) <= 32768),
  previous_id uuid references public.company_investigations (id),
  job_id text check (job_id is null or char_length(job_id) between 1 and 80),
  issue text check (issue is null or issue ~ '^[a-z][a-z_]{1,39}$'),
  cancel_requested_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  runner text check (runner is null or char_length(runner) between 1 and 120),
  heartbeat_at timestamptz,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.company_investigations is
  'Execuções da investigação de empresas (ADR-0015): etapas, consumo e composição do diagnóstico. As conclusões ficam em claims.';

-- Uma ativa por empresa: a segunda dá unique_violation (o servidor converte em investigation_running).
create unique index company_investigations_active_key on public.company_investigations (company_id)
  where status in ('queued', 'running');
create index company_investigations_company_idx
  on public.company_investigations (company_id, created_at desc);
create index company_investigations_stale_idx on public.company_investigations (heartbeat_at)
  where status in ('queued', 'running');

create trigger company_investigations_updated_at
  before update on public.company_investigations
  for each row execute function app.set_updated_at();

-- Estados finais não voltam; interrompida e com falha podem voltar para a fila (retomada).
-- O resultado de uma execução encerrada também não muda: a conclusão foi auditada com ele, e uma
-- reescrita depois (diagnóstico, etapas, uso) não deixaria rastro.
create function app.guard_investigation_update() returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  if old.status in ('succeeded', 'partial', 'cancelled')
    and new.status is distinct from old.status then
    raise exception 'investigation_not_resumable' using errcode = '55000';
  end if;
  if old.status in ('succeeded', 'partial', 'cancelled')
    and (new.diagnosis is distinct from old.diagnosis
      or new.snapshot is distinct from old.snapshot
      or new.steps is distinct from old.steps
      or new.usage is distinct from old.usage
      or new.models is distinct from old.models
      or new.changes is distinct from old.changes
      or new.issue is distinct from old.issue
      or new.finished_at is distinct from old.finished_at) then
    raise exception 'investigation_finished' using errcode = '55000';
  end if;
  if new.status = 'queued' and old.status is distinct from 'queued'
    and old.status not in ('failed', 'interrupted') then
    raise exception 'investigation_not_resumable' using errcode = '55000';
  end if;
  return new;
end;
$$;

create trigger company_investigations_guard_update
  before update on public.company_investigations
  for each row execute function app.guard_investigation_update();

-- Auditoria: inclusão sempre; atualização só em conclusão, retomada e pedido de cancelamento.
create trigger company_investigations_audit_insert
  after insert on public.company_investigations
  for each row execute function app.audit_write();
create trigger company_investigations_audit_update
  after update on public.company_investigations
  for each row
  when (
    (old.status is distinct from new.status
      and new.status in ('succeeded', 'partial', 'failed', 'cancelled', 'queued'))
    or (old.cancel_requested_at is null and new.cancel_requested_at is not null)
  )
  execute function app.audit_write();

-- Conclusão com resultado: a empresa passa a mostrar a data da última investigação. O update em
-- companies é coberto pelo mesmo registro de auditoria (covers: companies).
create function app.touch_investigated_company() returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  update public.companies
  set last_investigated_at = coalesce(new.finished_at, now())
  where id = new.company_id;
  return null;
end;
$$;

create trigger company_investigations_touch_company
  after update of status on public.company_investigations
  for each row
  when (old.status is distinct from new.status and new.status in ('succeeded', 'partial'))
  execute function app.touch_investigated_company();

-- -----------------------------------------------------------------------------
-- Última investigação de cada empresa (status da mais recente; recomendação da mais recente
-- que tem diagnóstico, para a lista não "esquecer" a recomendação enquanto outra roda).
-- -----------------------------------------------------------------------------

create view public.company_investigation_summaries with (security_invoker = true) as
  select distinct on (i.company_id)
    i.company_id,
    i.id as investigation_id,
    i.status,
    i.finished_at,
    i.updated_at,
    d.recommendation,
    d.recommended_offer_name,
    d.priority
  from public.company_investigations as i
  left join lateral (
    select
      j.diagnosis ->> 'recommendation' as recommendation,
      o.offer ->> 'offerName' as recommended_offer_name,
      (o.offer ->> 'priority')::integer as priority
    from public.company_investigations as j
    left join lateral (
      select x as offer
      from jsonb_array_elements(coalesce(j.diagnosis -> 'offers', '[]')) as x
      where x ->> 'offerId' = j.diagnosis ->> 'recommendedOfferId'
      limit 1
    ) as o on true
    where j.company_id = i.company_id and j.diagnosis is not null
    order by j.created_at desc
    limit 1
  ) as d on true
  order by i.company_id, i.created_at desc;
comment on view public.company_investigation_summaries is
  'Última investigação de cada empresa (lista de empresas, ADR-0015).';

-- -----------------------------------------------------------------------------
-- Confirmação do site oficial: domínio na empresa + chave forte `domain`, numa transação.
-- Auditoria no cabeçalho: table companies, covers company_identifiers.
-- -----------------------------------------------------------------------------

create function public.confirm_company_site(p_company_id uuid, p_domain text) returns boolean
  language plpgsql
  set search_path = ''
as $$
declare
  domain text := lower(btrim(coalesce(p_domain, '')));
begin
  if char_length(domain) not between 4 and 253
    or domain !~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$' then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  begin
    update public.companies set primary_domain = domain where id = p_company_id;
    if not found then
      return false;
    end if;
    insert into public.company_identifiers (company_id, kind, value_normalized, strength, verified)
    select p_company_id, 'domain', domain, 'strong', true
    where not exists (
      select 1 from public.company_identifiers
      where company_id = p_company_id and kind = 'domain' and value_normalized = domain
    );
  exception when unique_violation then
    raise exception 'company_duplicate' using errcode = '23505';
  end;
  return true;
end;
$$;

-- -----------------------------------------------------------------------------
-- Acesso: só o servidor do app (ADR-0007)
-- -----------------------------------------------------------------------------

alter table public.company_investigations enable row level security;

revoke all on public.company_investigations, public.company_investigation_summaries
  from anon, authenticated, service_role;
grant select, insert on public.company_investigations to service_role;
-- Empresa, gatilho, versão do processo, investigação anterior e is_demo nunca mudam.
grant update (
  status, steps, usage, models, diagnosis, snapshot, changes, job_id, issue,
  cancel_requested_at, started_at, finished_at, runner, heartbeat_at
) on public.company_investigations to service_role;
grant select on public.company_investigation_summaries to service_role;

revoke execute on function app.guard_investigation_update() from public, anon, authenticated;
revoke execute on function app.touch_investigated_company() from public, anon, authenticated;
revoke execute on function public.confirm_company_site(uuid, text)
  from public, anon, authenticated;
grant execute on function public.confirm_company_site(uuid, text) to service_role;
