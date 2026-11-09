-- =============================================================================
-- F2 — Estratégia: ofertas, rubrica, modelo de score, ICP, voz, cases, LIA e opt-out
-- (docs/09 F2, docs/06 §4.2, ADR-0009). Uso local sem login (ADR-0007): sem org_id.
--
-- Versões são SOMENTE INCLUSÃO. Editar cria nova versão; update/delete/truncate falham para
-- todos (trigger) e o servidor só tem select/insert nelas. O número da versão é atribuído pelo
-- banco (máximo + 1 sob trava), nunca pelo app. A versão atual é a de maior número (views
-- current_*). Assim, a versão usada por qualquer avaliação futura nunca muda.
-- Exceção: na LIA, aprovação e revogação preenchem uma vez colunas próprias; o conteúdo
-- continua imutável.
--
-- Cabeçalhos (offers, icp_profiles) guardam só identidade e status; cases (proof_assets) são
-- editáveis e arquivados em vez de apagados. Ninguém apaga nada aqui.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Utilitários
-- -----------------------------------------------------------------------------

create function app.forbid_version_mutation() returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  raise exception 'version_immutable' using errcode = '42501';
end;
$$;

-- Número da próxima versão: max(version) + 1 do mesmo pai (tg_argv[0]) ou da tabela inteira
-- (sem argumento). A trava transacional serializa inclusões concorrentes; o unique é a última
-- defesa.
create function app.assign_version() returns trigger
  language plpgsql
  set search_path = ''
as $$
declare
  parent_column text := tg_argv[0];
  parent_value text;
  next_version integer;
begin
  if parent_column is null then
    perform pg_advisory_xact_lock(hashtext(tg_table_name));
    execute format('select coalesce(max(version), 0) + 1 from %I.%I', tg_table_schema, tg_table_name)
      into next_version;
  else
    parent_value := to_jsonb(new) ->> parent_column;
    perform pg_advisory_xact_lock(hashtext(tg_table_name || ':' || parent_value));
    execute format(
      'select coalesce(max(version), 0) + 1 from %I.%I where %I::text = $1',
      tg_table_schema, tg_table_name, parent_column
    )
      into next_version
      using parent_value;
  end if;
  new.version := next_version;
  -- A data da versão também é do banco: ninguém escolhe quando uma versão "foi criada".
  new.created_at := now();
  return new;
end;
$$;

-- Todo item da lista casa com o padrão; item nulo ou fora do formato recusa a lista inteira.
-- (array_to_string ignoraria nulos e aceitaria '' ou itens com vírgula.)
create function app.all_match(items text[], pattern text)
  returns boolean
  language sql
  immutable
  set search_path = ''
as $$
  select not exists (
    select 1 from unnest(items) as item where item is null or item !~ pattern
  );
$$;

-- Cabeçalhos (ofertas, ICPs) nascem em rascunho, com datas do banco: ativar é sempre uma
-- mudança de status validada e auditada pelo serviço, nunca uma inclusão já ativa.
create function app.header_new_draft() returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  new.status := 'draft';
  new.created_at := now();
  new.updated_at := now();
  return new;
end;
$$;

-- Lista de textos curtos: até max_items itens, nenhum vazio nem maior que max_length.
create function app.text_list_ok(items text[], max_items integer, max_length integer)
  returns boolean
  language sql
  immutable
  set search_path = ''
as $$
  select coalesce(cardinality(items), 0) <= max_items
    and not exists (
      select 1 from unnest(items) as item
      where item is null or char_length(btrim(item)) = 0 or char_length(item) > max_length
    )
$$;

-- Lista de municípios: [{ "name": "...", "uf": "PR" }, ...]
create function app.municipalities_ok(items jsonb, max_items integer) returns boolean
  language sql
  immutable
  set search_path = ''
as $$
  select jsonb_typeof(items) = 'array'
    and jsonb_array_length(items) <= max_items
    and not exists (
      select 1 from jsonb_array_elements(items) as m
      where jsonb_typeof(m) <> 'object'
        or char_length(btrim(coalesce(m ->> 'name', ''))) not between 1 and 80
        or coalesce(m ->> 'uf', '') !~ '^[A-Z]{2}$'
    )
$$;

-- Critérios da rubrica: 1 a 15 objetos com chave única e peso inteiro; pesos somam 100.
create function app.rubric_criteria_ok(criteria jsonb) returns boolean
  language sql
  immutable
  set search_path = ''
as $$
  select jsonb_typeof(criteria) = 'array'
    and jsonb_array_length(criteria) between 1 and 15
    and not exists (
      select 1 from jsonb_array_elements(criteria) as c
      where jsonb_typeof(c) <> 'object'
        or coalesce(c ->> 'key', '') !~ '^[a-z][a-z0-9_]{1,39}$'
        or jsonb_typeof(c -> 'weight') <> 'number'
        or (c ->> 'weight')::numeric <> trunc((c ->> 'weight')::numeric)
        or (c ->> 'weight')::numeric not between 0 and 100
        or jsonb_typeof(c -> 'evidenceRequired') <> 'array'
        or jsonb_array_length(c -> 'evidenceRequired') = 0
    )
    and (select count(distinct c ->> 'key') from jsonb_array_elements(criteria) as c)
      = jsonb_array_length(criteria)
    and (select sum((c ->> 'weight')::numeric) from jsonb_array_elements(criteria) as c) = 100
$$;

-- -----------------------------------------------------------------------------
-- Ofertas: cabeçalho (status) + versões (conteúdo)
-- -----------------------------------------------------------------------------

create table public.offers (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'draft' check (status in ('draft', 'active', 'archived')),
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.offers is
  'Oferta da agência (identidade e status). O conteúdo está em offer_versions (somente inclusão).';

create trigger offers_updated_at
  before update on public.offers
  for each row execute function app.set_updated_at();

create trigger offers_new_draft
  before insert on public.offers
  for each row execute function app.header_new_draft();

create table public.offer_versions (
  id uuid primary key default gen_random_uuid(),
  offer_id uuid not null references public.offers (id),
  version integer not null check (version >= 1),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  description text not null default '' check (char_length(description) <= 2000),
  problems text[] not null default '{}' check (app.text_list_ok(problems, 20, 300)),
  need_signals text[] not null default '{}' check (app.text_list_ok(need_signals, 20, 300)),
  disqualifiers text[] not null default '{}' check (app.text_list_ok(disqualifiers, 20, 300)),
  deliverables text[] not null default '{}' check (app.text_list_ok(deliverables, 20, 300)),
  value_props text[] not null default '{}' check (app.text_list_ok(value_props, 10, 300)),
  -- Faixa de investimento em centavos de real.
  price_min_cents bigint check (price_min_cents >= 0),
  price_max_cents bigint check (price_max_cents >= 0),
  created_at timestamptz not null default now(),
  unique (offer_id, version),
  check (price_min_cents is null or price_max_cents is null or price_min_cents <= price_max_cents)
);
comment on table public.offer_versions is
  'Versões do conteúdo da oferta. Somente inclusão: avaliações citam a versão usada.';

create trigger offer_versions_assign_version
  before insert on public.offer_versions
  for each row execute function app.assign_version('offer_id');

-- -----------------------------------------------------------------------------
-- Rubrica de auditoria visual (versões por oferta). Escala fixa de 1 a 5.
-- -----------------------------------------------------------------------------

create table public.audit_rubrics (
  id uuid primary key default gen_random_uuid(),
  offer_id uuid not null references public.offers (id),
  version integer not null check (version >= 1),
  -- [{ key, label, description, weight, evidenceRequired[] }]; pesos inteiros somam 100.
  criteria jsonb not null check (app.rubric_criteria_ok(criteria)),
  created_at timestamptz not null default now(),
  unique (offer_id, version)
);
comment on table public.audit_rubrics is
  'Rubrica de auditoria visual por oferta. Somente inclusão; a auditoria registra a versão usada.';

create trigger audit_rubrics_assign_version
  before insert on public.audit_rubrics
  for each row execute function app.assign_version('offer_id');

-- -----------------------------------------------------------------------------
-- Modelo de score (versões por oferta): pesos das dimensões e limiares (docs/08 §3)
-- -----------------------------------------------------------------------------

create table public.scoring_models (
  id uuid primary key default gen_random_uuid(),
  offer_id uuid not null references public.offers (id),
  version integer not null check (version >= 1),
  -- Pesos em pontos percentuais inteiros; somam 100 (= 1).
  weight_fit smallint not null check (weight_fit between 0 and 100),
  weight_need smallint not null check (weight_need between 0 and 100),
  weight_signal smallint not null check (weight_signal between 0 and 100),
  weight_capacity smallint not null check (weight_capacity between 0 and 100),
  weight_timing smallint not null check (weight_timing between 0 and 100),
  pursue_priority smallint not null check (pursue_priority between 0 and 100),
  prepare_access_potential smallint not null check (prepare_access_potential between 0 and 100),
  discard_potential smallint not null check (discard_potential between 0 and 100),
  min_evidence_coverage smallint not null check (min_evidence_coverage between 0 and 100),
  -- Proposta de calibração que originou a versão (D16, futuro).
  created_from_proposal_id uuid,
  created_at timestamptz not null default now(),
  unique (offer_id, version),
  constraint scoring_models_weights_total
    check (weight_fit + weight_need + weight_signal + weight_capacity + weight_timing = 100),
  constraint scoring_models_thresholds_order
    check (discard_potential < pursue_priority and discard_potential < prepare_access_potential)
);
comment on table public.scoring_models is
  'Modelo de score por oferta. Somente inclusão; cada avaliação registra a versão usada.';

create trigger scoring_models_assign_version
  before insert on public.scoring_models
  for each row execute function app.assign_version('offer_id');

-- -----------------------------------------------------------------------------
-- ICP: perfil (status) + versões (filtros e exclusões)
-- -----------------------------------------------------------------------------

create table public.icp_profiles (
  id uuid primary key default gen_random_uuid(),
  offer_id uuid not null references public.offers (id),
  status text not null default 'draft' check (status in ('draft', 'active', 'archived')),
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.icp_profiles is
  'Perfil de cliente ideal de uma oferta (identidade e status). Filtros em icp_profile_versions.';

create index icp_profiles_offer_idx on public.icp_profiles (offer_id);

create trigger icp_profiles_updated_at
  before update on public.icp_profiles
  for each row execute function app.set_updated_at();

create trigger icp_profiles_new_draft
  before insert on public.icp_profiles
  for each row execute function app.header_new_draft();

create table public.icp_profile_versions (
  id uuid primary key default gen_random_uuid(),
  icp_id uuid not null references public.icp_profiles (id),
  version integer not null check (version >= 1),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  description text not null default '' check (char_length(description) <= 1000),
  -- Filtros (docs/06 §4.2). CNAE no formato 0000-0/00; porte da Receita sem MEI.
  cnaes text[] not null default '{}'
    check (cardinality(cnaes) <= 100 and app.all_match(cnaes, '^\d{4}-\d/\d{2}$')),
  ufs text[] not null default '{}'
    check (ufs <@ array['AC','AL','AM','AP','BA','CE','DF','ES','GO','MA','MG','MS','MT','PA','PB',
                         'PE','PI','PR','RJ','RN','RO','RR','RS','SC','SE','SP','TO']),
  municipalities jsonb not null default '[]' check (app.municipalities_ok(municipalities, 200)),
  sizes text[] not null default '{}' check (sizes <@ array['me', 'epp', 'demais']),
  min_age_years smallint check (min_age_years between 0 and 200),
  max_age_years smallint check (max_age_years between 0 and 200),
  -- Exclusões.
  excluded_cnaes text[] not null default '{}'
    check (cardinality(excluded_cnaes) <= 100
      and app.all_match(excluded_cnaes, '^\d{4}-\d/\d{2}$')),
  excluded_municipalities jsonb not null default '[]'
    check (app.municipalities_ok(excluded_municipalities, 200)),
  excluded_cnpj_roots text[] not null default '{}'
    check (cardinality(excluded_cnpj_roots) <= 500
      and app.all_match(excluded_cnpj_roots, '^[0-9A-Z]{8}$')),
  excluded_domains text[] not null default '{}' check (app.text_list_ok(excluded_domains, 500, 253)),
  created_at timestamptz not null default now(),
  unique (icp_id, version),
  check (min_age_years is null or max_age_years is null or min_age_years <= max_age_years)
);
comment on table public.icp_profile_versions is
  'Versões dos filtros e exclusões do ICP. Somente inclusão: avaliações citam a versão usada.';

create trigger icp_profile_versions_assign_version
  before insert on public.icp_profile_versions
  for each row execute function app.assign_version('icp_id');

-- -----------------------------------------------------------------------------
-- Voz da agência e política de contato (versões únicas do espaço de trabalho)
-- -----------------------------------------------------------------------------

create table public.voice_guides (
  id uuid primary key default gen_random_uuid(),
  version integer not null unique check (version >= 1),
  summary text not null check (char_length(btrim(summary)) between 1 and 1000),
  principles text[] not null default '{}' check (app.text_list_ok(principles, 15, 300)),
  avoid text[] not null default '{}' check (app.text_list_ok(avoid, 15, 300)),
  good_examples text[] not null default '{}' check (app.text_list_ok(good_examples, 5, 2000)),
  bad_examples text[] not null default '{}' check (app.text_list_ok(bad_examples, 5, 2000)),
  created_at timestamptz not null default now()
);
comment on table public.voice_guides is 'Voz da agência. Somente inclusão; a atual é a de maior versão.';

create trigger voice_guides_assign_version
  before insert on public.voice_guides
  for each row execute function app.assign_version();

create table public.contact_policies (
  id uuid primary key default gen_random_uuid(),
  version integer not null unique check (version >= 1),
  agency_name text not null check (char_length(btrim(agency_name)) between 1 and 120),
  -- Canal do titular (encarregado ou formulário): e-mail ou https.
  privacy_contact text not null check (char_length(btrim(privacy_contact)) between 1 and 200),
  opt_out_text text not null check (char_length(btrim(opt_out_text)) between 1 and 500),
  created_at timestamptz not null default now()
);
comment on table public.contact_policies is
  'Identificação da agência, canal do titular e texto de opt-out (docs/12 §4). Somente inclusão.';

create trigger contact_policies_assign_version
  before insert on public.contact_policies
  for each row execute function app.assign_version();

-- -----------------------------------------------------------------------------
-- Cases (provas). Só public_ok com autorização registrada vai para mensagens.
-- -----------------------------------------------------------------------------

create table public.proof_assets (
  id uuid primary key default gen_random_uuid(),
  offer_id uuid references public.offers (id),
  title text not null check (char_length(btrim(title)) between 1 and 120),
  segment text not null default '' check (char_length(segment) <= 120),
  summary text not null check (char_length(btrim(summary)) between 1 and 1000),
  results text not null default '' check (char_length(results) <= 1000),
  public_ok boolean not null default false,
  consent_ref text not null default '' check (char_length(consent_ref) <= 300),
  is_demo boolean not null default false,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint proof_assets_public_requires_consent
    check (not public_ok or char_length(btrim(consent_ref)) > 0)
);
comment on table public.proof_assets is
  'Cases da agência. Só public_ok (com autorização registrada em consent_ref) pode ser citado.';

create trigger proof_assets_updated_at
  before update on public.proof_assets
  for each row execute function app.set_updated_at();

-- -----------------------------------------------------------------------------
-- LIA — avaliação de legítimo interesse (docs/12 §4). Conteúdo imutável; aprovação e
-- revogação uma vez cada.
-- -----------------------------------------------------------------------------

create table public.legal_basis_assessments (
  id uuid primary key default gen_random_uuid(),
  version integer not null unique check (version >= 1),
  purpose text not null check (char_length(btrim(purpose)) between 1 and 1000),
  legitimate_interest text not null check (char_length(btrim(legitimate_interest)) between 1 and 2000),
  necessity text not null check (char_length(btrim(necessity)) between 1 and 2000),
  -- Lista fechada de minimização (sem CPF, sem dado sensível).
  data_categories text[] not null
    check (cardinality(data_categories) between 1 and 5
      and data_categories <@ array['name', 'role_title', 'work_email', 'work_phone', 'professional_profile_url']),
  data_sources text[] not null
    check (cardinality(data_sources) between 1 and 3
      and data_sources <@ array['registry_qsa', 'company_website', 'user_input']),
  expectations text not null check (char_length(btrim(expectations)) between 1 and 2000),
  risks text not null check (char_length(btrim(risks)) between 1 and 2000),
  safeguards text not null check (char_length(btrim(safeguards)) between 1 and 2000),
  conclusion text not null check (char_length(btrim(conclusion)) between 1 and 1000),
  approved_at timestamptz,
  review_due_on date,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  constraint legal_basis_assessments_approval_complete
    check ((approved_at is null) = (review_due_on is null)),
  constraint legal_basis_assessments_revoke_after_approval
    check (revoked_at is null or approved_at is not null)
);
comment on table public.legal_basis_assessments is
  'LIA versionada. Conteúdo imutável; approved_at/review_due_on e revoked_at são preenchidos uma vez.';

create trigger legal_basis_assessments_assign_version
  before insert on public.legal_basis_assessments
  for each row execute function app.assign_version();

-- Toda LIA nasce rascunho, com data do banco: decisões só por UPDATE (guard abaixo).
create function app.lia_new_draft() returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  new.approved_at := null;
  new.review_due_on := null;
  new.revoked_at := null;
  new.created_at := now();
  return new;
end;
$$;

create trigger legal_basis_assessments_new_draft
  before insert on public.legal_basis_assessments
  for each row execute function app.lia_new_draft();

-- Só a mudança das colunas de decisão passa, e cada uma só de vazio para preenchida.
-- Aprovar: só a versão mais recente, nunca junto com a revogação, revisão entre amanhã e
-- 24 meses no fuso da agência (mesma regra do domínio, ADR-0009 §5). Os instantes de aprovação
-- e revogação são do banco.
create function app.guard_lia_decision() returns trigger
  language plpgsql
  set search_path = ''
as $$
declare
  decision_columns constant text[] := array['approved_at', 'review_due_on', 'revoked_at'];
  agency_today date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  if (to_jsonb(new) - decision_columns) is distinct from (to_jsonb(old) - decision_columns) then
    raise exception 'version_immutable' using errcode = '42501';
  end if;
  if (old.approved_at is not null and new.approved_at is distinct from old.approved_at)
    or (old.review_due_on is not null and new.review_due_on is distinct from old.review_due_on)
    or (old.revoked_at is not null and new.revoked_at is distinct from old.revoked_at) then
    raise exception 'lia_decision_locked' using errcode = '42501';
  end if;
  if old.approved_at is null and new.approved_at is not null then
    if new.revoked_at is not null then
      raise exception 'lia_decision_locked' using errcode = '42501';
    end if;
    if exists (
      select 1 from public.legal_basis_assessments as newer where newer.version > old.version
    ) then
      raise exception 'lia_not_latest' using errcode = '42501';
    end if;
    -- Sem data de revisão, o check approval_complete recusa.
    if new.review_due_on is not null and (
      new.review_due_on <= agency_today
      or new.review_due_on > (agency_today + interval '24 months')::date
    ) then
      raise exception 'review_date_out_of_range' using errcode = '22023';
    end if;
    new.approved_at := now();
  end if;
  if old.revoked_at is null and new.revoked_at is not null then
    new.revoked_at := now();
  end if;
  return new;
end;
$$;

create trigger legal_basis_assessments_guard
  before update on public.legal_basis_assessments
  for each row execute function app.guard_lia_decision();

-- -----------------------------------------------------------------------------
-- Versões somente inclusão: update/delete/truncate bloqueados para todos (por instrução, então
-- falham mesmo quando não atingiriam nenhuma linha). Na LIA, só delete/truncate.
-- -----------------------------------------------------------------------------

create trigger offer_versions_immutable
  before update or delete or truncate on public.offer_versions
  for each statement execute function app.forbid_version_mutation();
create trigger audit_rubrics_immutable
  before update or delete or truncate on public.audit_rubrics
  for each statement execute function app.forbid_version_mutation();
create trigger scoring_models_immutable
  before update or delete or truncate on public.scoring_models
  for each statement execute function app.forbid_version_mutation();
create trigger icp_profile_versions_immutable
  before update or delete or truncate on public.icp_profile_versions
  for each statement execute function app.forbid_version_mutation();
create trigger voice_guides_immutable
  before update or delete or truncate on public.voice_guides
  for each statement execute function app.forbid_version_mutation();
create trigger contact_policies_immutable
  before update or delete or truncate on public.contact_policies
  for each statement execute function app.forbid_version_mutation();
create trigger legal_basis_assessments_immutable
  before delete or truncate on public.legal_basis_assessments
  for each statement execute function app.forbid_version_mutation();

-- -----------------------------------------------------------------------------
-- Versões atuais (a de maior número). security_invoker: valem os privilégios de quem lê.
-- -----------------------------------------------------------------------------

create view public.current_offer_versions with (security_invoker = true) as
  select distinct on (offer_id) *
  from public.offer_versions
  order by offer_id, version desc;

create view public.current_audit_rubrics with (security_invoker = true) as
  select distinct on (offer_id) *
  from public.audit_rubrics
  order by offer_id, version desc;

create view public.current_scoring_models with (security_invoker = true) as
  select distinct on (offer_id) *
  from public.scoring_models
  order by offer_id, version desc;

create view public.current_icp_profile_versions with (security_invoker = true) as
  select distinct on (icp_id) *
  from public.icp_profile_versions
  order by icp_id, version desc;

-- -----------------------------------------------------------------------------
-- Criação atômica de cabeçalho + primeira versão (o PostgREST não tem transação entre
-- chamadas). p_version traz as colunas da versão em snake_case; o número vem do trigger.
-- -----------------------------------------------------------------------------

create function public.create_offer(p_version jsonb) returns uuid
  language plpgsql
  set search_path = ''
as $$
declare
  new_id uuid;
begin
  insert into public.offers default values returning id into new_id;
  insert into public.offer_versions (
    offer_id, name, description, problems, need_signals, disqualifiers, deliverables,
    value_props, price_min_cents, price_max_cents
  )
  select new_id, r.name, coalesce(r.description, ''), coalesce(r.problems, '{}'),
    coalesce(r.need_signals, '{}'), coalesce(r.disqualifiers, '{}'),
    coalesce(r.deliverables, '{}'), coalesce(r.value_props, '{}'),
    r.price_min_cents, r.price_max_cents
  from jsonb_populate_record(null::public.offer_versions, p_version) as r;
  return new_id;
end;
$$;

create function public.create_icp_profile(p_offer_id uuid, p_version jsonb) returns uuid
  language plpgsql
  set search_path = ''
as $$
declare
  new_id uuid;
begin
  insert into public.icp_profiles (offer_id) values (p_offer_id) returning id into new_id;
  insert into public.icp_profile_versions (
    icp_id, name, description, cnaes, ufs, municipalities, sizes, min_age_years, max_age_years,
    excluded_cnaes, excluded_municipalities, excluded_cnpj_roots, excluded_domains
  )
  select new_id, r.name, coalesce(r.description, ''), coalesce(r.cnaes, '{}'),
    coalesce(r.ufs, '{}'), coalesce(r.municipalities, '[]'), coalesce(r.sizes, '{}'),
    r.min_age_years, r.max_age_years, coalesce(r.excluded_cnaes, '{}'),
    coalesce(r.excluded_municipalities, '[]'), coalesce(r.excluded_cnpj_roots, '{}'),
    coalesce(r.excluded_domains, '{}')
  from jsonb_populate_record(null::public.icp_profile_versions, p_version) as r;
  return new_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- RLS e privilégios: API pública (anon/authenticated) sem nada; servidor com o mínimo.
-- -----------------------------------------------------------------------------

alter table public.offers enable row level security;
alter table public.offer_versions enable row level security;
alter table public.audit_rubrics enable row level security;
alter table public.scoring_models enable row level security;
alter table public.icp_profiles enable row level security;
alter table public.icp_profile_versions enable row level security;
alter table public.voice_guides enable row level security;
alter table public.contact_policies enable row level security;
alter table public.proof_assets enable row level security;
alter table public.legal_basis_assessments enable row level security;

revoke all on
  public.offers, public.offer_versions, public.audit_rubrics, public.scoring_models,
  public.icp_profiles, public.icp_profile_versions, public.voice_guides,
  public.contact_policies, public.proof_assets, public.legal_basis_assessments,
  public.current_offer_versions, public.current_audit_rubrics, public.current_scoring_models,
  public.current_icp_profile_versions
from anon, authenticated, service_role;

-- Versões: só leitura e inclusão.
grant select, insert on
  public.offer_versions, public.audit_rubrics, public.scoring_models,
  public.icp_profile_versions, public.voice_guides, public.contact_policies
to service_role;

-- Cabeçalhos: inclusão e troca de status; nada de apagar nem de mudar is_demo.
grant select, insert on public.offers, public.icp_profiles to service_role;
grant update (status) on public.offers, public.icp_profiles to service_role;

-- Cases: editáveis e arquiváveis, nunca apagados.
grant select, insert on public.proof_assets to service_role;
grant update (offer_id, title, segment, summary, results, public_ok, consent_ref, archived_at)
  on public.proof_assets to service_role;

-- LIA: inclusão de versões; aprovação e revogação (uma vez cada, garantido pelo trigger).
grant select, insert on public.legal_basis_assessments to service_role;
grant update (approved_at, review_due_on, revoked_at)
  on public.legal_basis_assessments to service_role;

grant select on
  public.current_offer_versions, public.current_audit_rubrics, public.current_scoring_models,
  public.current_icp_profile_versions
to service_role;

-- Funções: só o servidor executa (as de checagem rodam dentro dos constraints).
revoke execute on function
  public.create_offer(jsonb), public.create_icp_profile(uuid, jsonb)
from public, anon, authenticated;
grant execute on function
  public.create_offer(jsonb), public.create_icp_profile(uuid, jsonb)
to service_role;

revoke execute on all functions in schema app from public, anon, authenticated;
grant execute on function
  app.text_list_ok(text[], integer, integer), app.municipalities_ok(jsonb, integer),
  app.rubric_criteria_ok(jsonb), app.all_match(text[], text)
to service_role;
