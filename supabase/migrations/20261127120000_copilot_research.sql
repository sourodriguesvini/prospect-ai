-- =============================================================================
-- Diretriz de 2026-11-26, Partes 6.3 a 6.5: pesquisa extensa do Copiloto com contexto
-- persistente. O pedido ("100 terapeutas ocupacionais no Brasil para apresentar a Blummy") vira
-- uma pesquisa ligada à conversa, com objetivo, perfil comercial, público, critérios, região,
-- quantidade pedida, plano de buscas, progresso e resultados guardados. Um pedido seguinte na
-- mesma conversa ("agora priorize SP e MG") muda a pesquisa (nova versão dos critérios) sem
-- refazer o que já foi achado. Nada aqui contata ninguém.
--
-- copilot_research        o contexto da pesquisa (uma por pedido; a conversa pode ter várias).
-- copilot_research_items  o que a pesquisa achou: organização (dados da organização) ou pessoa
--                         (só a referência a `people`, onde ficam origem, base legal, prazo e
--                         opt-out). Pessoa apagada por prazo ou opt-out apaga o item junto.
-- ai_jobs                 ganha o tipo 'copilot_research': os lotes rodam no trabalhador do app
--                         (ADR-0011), com retomada se o app fechar.
--
-- Revisão de conformidade de 2026-11-27: item de organização não guarda pessoa (segmentos de
-- pessoa só em item de pessoa, e item de pessoa não guarda nome nem contato); as duas tabelas têm
-- prazo (até 12 meses) e podem ser apagadas, uma linha por vez, com auditoria.
--
-- Só aditiva. Uso local sem login (ADR-0007): sem org_id; acesso só pelo servidor do app.
-- =============================================================================

create table public.copilot_research (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.copilot_threads (id),
  profile_id uuid not null references public.commercial_profiles (id),
  -- As palavras da pessoa (o primeiro pedido); as mudanças ficam em `revisions`.
  request text not null check (char_length(btrim(request)) between 3 and 1000),
  objective text not null check (char_length(btrim(objective)) between 3 and 300),
  audience text not null check (char_length(btrim(audience)) between 2 and 120),
  -- { profession, terms, entityKinds, ufs, priorityUfs, cities, assumptions } (contrato
  -- ResearchCriteria no app).
  criteria jsonb not null check (
    jsonb_typeof(criteria) = 'object' and pg_column_size(criteria) <= 8192
  ),
  requested_count integer not null check (requested_count between 1 and 500),
  found_count integer not null default 0 check (found_count >= 0),
  status text not null default 'queued'
    check (status in ('queued', 'running', 'paused', 'done', 'failed', 'cancelled')),
  -- Por que parou antes da quantidade (orçamento de buscas, fontes esgotadas, cancelamento).
  stop_reason text check (stop_reason is null or stop_reason ~ '^[a-z][a-z0-9_]{1,59}$'),
  -- Buscas planejadas e o estado de cada uma (contrato ResearchPlan). As consultas são por
  -- profissão e região, nunca pelo nome de uma pessoa.
  plan jsonb not null default '{"queries": []}'::jsonb check (
    jsonb_typeof(plan) = 'object' and pg_column_size(plan) <= 65536
  ),
  -- Contagens e créditos (contrato ResearchProgress).
  progress jsonb not null default '{}'::jsonb check (
    jsonb_typeof(progress) = 'object' and pg_column_size(progress) <= 4096
  ),
  -- Mudanças pedidas depois ("agora priorize SP e MG"): [{ at, request, change }].
  revisions jsonb not null default '[]'::jsonb check (
    jsonb_typeof(revisions) = 'array' and pg_column_size(revisions) <= 16384
  ),
  -- Sobe com a mudança pedida pela pessoa (chave da fila: uma tarefa por versão e lote).
  version integer not null default 1 check (version >= 1),
  -- Sobe em toda gravação (gatilho): a gravação confere versão e `row_version`, então um lote e uma
  -- mudança simultâneos não se apagam (revisão de arquitetura de 26/11, D1).
  row_version integer not null default 1 check (row_version >= 1),
  -- Teto de créditos da Tavily desta pesquisa (plano gratuito: o mensal também vale).
  credit_cap integer not null check (credit_cap between 1 and 300),
  trace_id uuid not null,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz,
  -- O pedido e as consultas podem trazer nomes: a pesquisa também tem prazo.
  retention_until timestamptz not null,
  check ((status in ('done', 'failed', 'cancelled')) = (finished_at is not null)),
  check (retention_until > created_at and retention_until <= created_at + interval '12 months')
);
comment on table public.copilot_research is
  'Pesquisa extensa do Copiloto (diretriz 2026-11-26, 6.3 a 6.5): contexto persistente ligado à '
  'conversa, plano de buscas, progresso e mudanças pedidas depois. Prazo de até 12 meses.';

create index copilot_research_thread_idx on public.copilot_research (thread_id, created_at desc);
create index copilot_research_open_idx on public.copilot_research (status)
  where status in ('queued', 'running', 'paused');
create index copilot_research_retention_idx on public.copilot_research (retention_until);

create trigger copilot_research_updated_at
  before update on public.copilot_research
  for each row execute function app.set_updated_at();

create function app.bump_copilot_research_row_version() returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  new.row_version := old.row_version + 1;
  return new;
end;
$$;
revoke execute on function app.bump_copilot_research_row_version() from public, anon, authenticated;
create trigger copilot_research_row_version
  before update on public.copilot_research
  for each row execute function app.bump_copilot_research_row_version();
create trigger copilot_research_audit
  after insert or update or delete on public.copilot_research
  for each row execute function app.audit_write();

create table public.copilot_research_items (
  id uuid primary key default gen_random_uuid(),
  research_id uuid not null references public.copilot_research (id) on delete cascade,
  kind text not null check (kind in ('person', 'organization')),
  person_id uuid references public.people (id) on delete cascade,
  -- Organização: os dados ficam aqui (pessoa: em `people`).
  name text check (name is null or char_length(btrim(name)) between 2 and 160),
  city text check (city is null or char_length(btrim(city)) between 2 and 80),
  uf text check (uf is null or uf ~ '^[A-Z]{2}$'),
  website text check (
    website is null or (char_length(website) <= 500 and website ~ '^https?://[^[:space:]"''<>`]+$')
  ),
  public_email text check (
    public_email is null or (
      char_length(public_email) between 6 and 254 and public_email = lower(public_email)
      and public_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
    )
  ),
  public_phone text check (public_phone is null or public_phone ~ '^\+?[0-9][0-9 ().-]{7,19}$'),
  source_url text check (
    source_url is null
    or (char_length(source_url) <= 2048 and source_url ~ '^https?://[^[:space:]"''<>`]+$')
  ),
  source_quote text check (source_quote is null or char_length(btrim(source_quote)) between 3 and 300),
  -- Para o perfil: usuário, comprador, influenciador (Parte 6.5), por regra do perfil.
  audience_role text not null default 'unknown'
    check (audience_role in ('user', 'buyer', 'influencer', 'unknown')),
  segment text not null check (
    segment in ('independent_professional', 'clinic', 'manager', 'employed_professional', 'organization', 'unknown')
  ),
  -- Por que entrou na lista, escrito pela regra do perfil (não pelo modelo).
  fit_reason text not null check (char_length(btrim(fit_reason)) between 5 and 300),
  -- Onde a cidade foi conferida: no trecho da fonte ou só pela busca daquela cidade.
  location_basis text not null default 'query' check (location_basis in ('quote', 'query', 'none')),
  -- Consulta que achou (o índice no plano) e a ordem de chegada para a revisão (não é nota).
  query_index integer check (query_index is null or query_index >= 0),
  rank integer not null default 0,
  verified_at timestamptz not null,
  retention_until timestamptz not null,
  dedupe_key text not null check (dedupe_key ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  unique (research_id, dedupe_key),
  check ((kind = 'person') = (person_id is not null)),
  -- Organização: nome, fonte e trecho; nunca um segmento de pessoa.
  check (
    kind = 'person'
    or (
      name is not null and source_url is not null and source_quote is not null
      and segment in ('clinic', 'organization', 'unknown')
    )
  ),
  -- Pessoa: só a referência; nome, contato e fonte ficam em `people` (opt-out, prazo, LIA).
  check (
    kind = 'organization'
    or (
      name is null and city is null and uf is null and website is null and public_email is null
      and public_phone is null and source_url is null and source_quote is null
    )
  ),
  check (retention_until > verified_at and retention_until <= verified_at + interval '12 months')
);
comment on table public.copilot_research_items is
  'Resultados de uma pesquisa do Copiloto. Pessoa: só a referência a `people` (origem, base legal, '
  'prazo e opt-out ficam lá; apagar a pessoa apaga o item). Organização: dados públicos da '
  'organização, nunca de uma pessoa. Prazo de até 12 meses.';

create index copilot_research_items_research_idx
  on public.copilot_research_items (research_id, rank desc, created_at);
create index copilot_research_items_person_idx on public.copilot_research_items (person_id)
  where person_id is not null;
create index copilot_research_items_retention_idx on public.copilot_research_items (retention_until);

create trigger copilot_research_items_audit
  after insert or update or delete on public.copilot_research_items
  for each row execute function app.audit_write();

-- Os lotes da pesquisa rodam na fila durável.
alter table public.ai_jobs drop constraint ai_jobs_kind_check;
alter table public.ai_jobs add constraint ai_jobs_kind_check
  check (kind in ('discovery_run', 'copilot_research'));

-- Um lote por tarefa. A pesquisa aberta entra na fila na mesma escrita que a cria, que conclui um
-- lote (o número em `progress.batches` sobe), que a muda (a versão sobe) ou que a reabre. A chave
-- leva versão e lote: a tarefa velha, se ainda rodar, vê que não é a do estado atual e termina.
create function app.enqueue_copilot_research() returns trigger
  language plpgsql
  set search_path = ''
as $$
declare
  batch integer := coalesce((new.progress ->> 'batches')::integer, 0);
begin
  if new.status in ('queued', 'running') and (
    tg_op = 'INSERT'
    or old.status not in ('queued', 'running')
    or new.version is distinct from old.version
    or batch is distinct from coalesce((old.progress ->> 'batches')::integer, 0)
  ) then
    insert into public.ai_jobs (kind, idempotency_key, payload, trace_id)
    values (
      'copilot_research',
      'copilot_research:' || new.id::text || ':' || new.version::text || ':' || batch::text,
      jsonb_build_object('researchId', new.id, 'version', new.version, 'batch', batch),
      new.trace_id
    )
    on conflict (idempotency_key) do nothing;
  end if;
  return null;
end;
$$;
revoke execute on function app.enqueue_copilot_research() from public, anon, authenticated;

create trigger copilot_research_enqueue
  after insert or update of status, version, progress on public.copilot_research
  for each row execute function app.enqueue_copilot_research();

-- Cancelar a pesquisa marca as tarefas dela: quem está rodando para na próxima renovação do lease.
create function app.cancel_copilot_research_jobs() returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  if new.status = 'cancelled' and old.status is distinct from 'cancelled' then
    update public.ai_jobs
    set cancel_requested_at = now()
    where kind = 'copilot_research'
      and payload ->> 'researchId' = new.id::text
      and status in ('queued', 'running')
      and cancel_requested_at is null;
  end if;
  return null;
end;
$$;
revoke execute on function app.cancel_copilot_research_jobs() from public, anon, authenticated;

create trigger copilot_research_cancel_jobs
  after update of status on public.copilot_research
  for each row execute function app.cancel_copilot_research_jobs();

-- -----------------------------------------------------------------------------
-- Acesso: só o servidor do app (ADR-0007)
-- -----------------------------------------------------------------------------

alter table public.copilot_research enable row level security;
alter table public.copilot_research_items enable row level security;

revoke all on public.copilot_research, public.copilot_research_items
  from anon, authenticated, service_role;
grant select, insert, delete on public.copilot_research, public.copilot_research_items
  to service_role;
grant update (
  criteria, requested_count, found_count, status, stop_reason, plan, progress, revisions, version,
  credit_cap, finished_at
) on public.copilot_research to service_role;
grant update (audience_role, segment, fit_reason, rank, verified_at)
  on public.copilot_research_items to service_role;
