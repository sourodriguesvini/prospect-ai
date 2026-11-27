-- =============================================================================
-- Diretriz de 2026-11-26, Partes 6.5 e 7 (pessoas para abordar), KI-190 e KI-210: pessoas
-- profissionais públicas (decisores de empresas, profissionais independentes) com base legal,
-- origem e prazo por contato (regra 7 do CLAUDE.md). Revisão de conformidade de 2026-11-27
-- (revisor-conformidade): os três bloqueios dela (LIA sem vínculo, opt-out que não sobrevivia ao
-- expurgo nem valia para os dois perfis, dados pessoais fora de `people`) estão resolvidos aqui e
-- na migração da pesquisa do Copiloto.
--
-- Minimização: só o que a LIA permite (nome, função ou cargo, e-mail e telefone profissionais,
-- perfil profissional), mais o contexto profissional (profissão, organização, cidade e UF). Nada
-- de CPF, data de nascimento, endereço residencial, foto ou dado sensível. E-mail e telefone só
-- quando aparecem literalmente na fonte (o servidor confere; nunca deduzidos). O nome tem de estar
-- no trecho guardado da fonte.
--
-- Origem: endereço, tipo e trecho literal da fonte em que o nome aparece (até 300 caracteres, uma
-- janela em volta do nome, ADR-0012), e a data da conferência.
-- Base legal: legítimo interesse. `lia_version` aponta a versão da LIA que cobre a linha; o banco só
-- aceita LIA aprovada, não revogada, com revisão em dia e que lista a fonte da linha. Sem LIA que
-- cubra, a pessoa fica guardada como resultado de pesquisa, NÃO é abordável e o prazo é de 90 dias.
-- Prazo: até 12 meses a partir da conferência (90 dias sem LIA); vencido, o servidor apaga a
-- linha, uma por vez e auditada.
-- Opt-out: `opted_out_at` exige apagar e-mail, telefone e perfil na mesma escrita, é final e grava a
-- identidade em `person_suppressions`, que sobrevive ao expurgo e vale para todos os perfis: a
-- pessoa não é recoletada por nenhum deles.
--
-- `dedupe_key`: HMAC-SHA256 (segredo do servidor, ADR-0006) da identidade normalizada (nome + UF +
-- profissão ou organização), SEM o perfil: a mesma chave serve para a supressão.
--
-- Só aditiva (a LIA só ganha opções). Uso local sem login (ADR-0007): sem org_id; acesso só pelo
-- servidor do app.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- A LIA passa a poder cobrir as fontes e os dados de pessoas profissionais
-- -----------------------------------------------------------------------------

alter table public.legal_basis_assessments drop constraint legal_basis_assessments_data_categories_check;
alter table public.legal_basis_assessments add constraint legal_basis_assessments_data_categories_check
  check (
    cardinality(data_categories) between 1 and 8
    and data_categories <@ array[
      'name', 'role_title', 'work_email', 'work_phone', 'professional_profile_url',
      'profession', 'organization', 'location'
    ]
  );
alter table public.legal_basis_assessments drop constraint legal_basis_assessments_data_sources_check;
alter table public.legal_basis_assessments add constraint legal_basis_assessments_data_sources_check
  check (
    cardinality(data_sources) between 1 and 6
    and data_sources <@ array[
      'registry_qsa', 'company_website', 'user_input', 'search_result', 'professional_directory',
      'press'
    ]
  );

-- -----------------------------------------------------------------------------
-- Pessoas
-- -----------------------------------------------------------------------------

create table public.people (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.commercial_profiles (id),
  full_name text not null check (char_length(btrim(full_name)) between 3 and 120),
  profession text check (profession is null or char_length(btrim(profession)) between 2 and 120),
  role_title text check (role_title is null or char_length(btrim(role_title)) between 2 and 120),
  organization_name text check (
    organization_name is null or char_length(btrim(organization_name)) between 2 and 160
  ),
  company_id uuid references public.companies (id),
  city text check (city is null or char_length(btrim(city)) between 2 and 80),
  uf text check (uf is null or uf ~ '^[A-Z]{2}$'),
  work_email text check (
    work_email is null or (
      char_length(work_email) between 6 and 254 and work_email = lower(work_email)
      and work_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
    )
  ),
  work_phone text check (work_phone is null or work_phone ~ '^\+?[0-9][0-9 ().-]{7,19}$'),
  profile_url text check (
    profile_url is null
    or (char_length(profile_url) <= 500 and profile_url ~ '^https://[^[:space:]"''<>`]+$')
  ),
  -- Quem é para o perfil comercial (Parte 6.5): usa, compra, influencia ou ainda não se sabe.
  audience_role text not null default 'unknown'
    check (audience_role in ('user', 'buyer', 'influencer', 'unknown')),
  -- Origem (regra 7).
  source_url text not null check (
    char_length(source_url) <= 2048 and source_url ~ '^https?://[^[:space:]"''<>`]+$'
  ),
  source_kind text not null check (
    source_kind in (
      'registry_qsa', 'company_website', 'professional_directory', 'press', 'search_result',
      'user_input'
    )
  ),
  source_quote text not null check (char_length(btrim(source_quote)) between 3 and 300),
  verified_at timestamptz not null,
  -- Base legal (regra 7).
  legal_basis text not null default 'legitimate_interest'
    check (legal_basis in ('legitimate_interest')),
  purpose text not null default 'commercial_prospecting'
    check (purpose in ('commercial_prospecting')),
  -- Conferida pelo gatilho `app.guard_person_lia` (existe, aprovada, em dia e cobre a fonte). Sem
  -- chave estrangeira: a LIA não pode ser apagada (só inclusão), e a FK mudaria o erro do
  -- `truncate` que a guarda da LIA já recusa.
  lia_version integer check (lia_version is null or lia_version >= 1),
  retention_until timestamptz not null,
  opted_out_at timestamptz,
  is_demo boolean not null default false,
  dedupe_key text not null check (dedupe_key ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Mesma pessoa no mesmo perfil uma vez só (a chave é da pessoa, sem o perfil).
  unique (profile_id, dedupe_key),
  -- O nome está no trecho guardado da fonte (nada de nome deduzido).
  check (strpos(lower(source_quote), lower(btrim(full_name))) > 0),
  -- Quem pediu para não ser contatado não guarda meio de contato.
  check (
    opted_out_at is null or (work_email is null and work_phone is null and profile_url is null)
  ),
  -- Prazo: depois da conferência; até 12 meses com LIA, até 90 dias sem ela.
  check (retention_until > verified_at),
  check (
    retention_until <= verified_at + case
      when lia_version is null then interval '90 days'
      else interval '12 months'
    end
  )
);
comment on table public.people is
  'Pessoas profissionais públicas (decisores e profissionais), com origem, base legal (legítimo '
  'interesse + versão da LIA que cobre a linha) e prazo por linha (regra 7). Só dado profissional; '
  'e-mail e telefone só se literais na fonte. Sem LIA que cubra: guardada, não abordável, 90 dias.';

create index people_company_idx on public.people (company_id) where company_id is not null;
create index people_retention_idx on public.people (retention_until);
create index people_profile_uf_idx on public.people (profile_id, uf);
create index people_dedupe_idx on public.people (dedupe_key);

create trigger people_updated_at
  before update on public.people
  for each row execute function app.set_updated_at();
create trigger people_audit
  after insert or update or delete on public.people
  for each row execute function app.audit_write();

-- A versão da LIA tem de valer de fato e cobrir a linha inteira (mesma regra de `effectiveLia` e
-- `liaStatus`): aprovada, não revogada, não substituída por versão aprovada mais nova, com revisão
-- em dia no fuso da agência, com a fonte entre as origens avaliadas e cada dado preenchido entre as
-- categorias avaliadas. Confere na inclusão e em toda alteração que acrescente ou troque dado, fonte,
-- versão ou prazo; o opt-out (que só apaga) passa sempre, mesmo com a LIA vencida ou revogada.
create function app.guard_person_lia() returns trigger
  language plpgsql
  set search_path = ''
as $$
declare
  lia public.legal_basis_assessments;
  agency_today date := (now() at time zone 'America/Sao_Paulo')::date;
  needed text[];
begin
  if new.lia_version is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and (
    (old.opted_out_at is null and new.opted_out_at is not null)
    or (
      new.lia_version is not distinct from old.lia_version
      and new.source_kind is not distinct from old.source_kind
      and new.retention_until <= old.retention_until
      and (new.role_title is null or new.role_title is not distinct from old.role_title)
      and (new.work_email is null or new.work_email is not distinct from old.work_email)
      and (new.work_phone is null or new.work_phone is not distinct from old.work_phone)
      and (new.profile_url is null or new.profile_url is not distinct from old.profile_url)
      and (new.profession is null or new.profession is not distinct from old.profession)
      and (new.organization_name is null
        or new.organization_name is not distinct from old.organization_name)
      and (new.company_id is null or new.company_id is not distinct from old.company_id)
      and (new.city is null or new.city is not distinct from old.city)
      and (new.uf is null or new.uf is not distinct from old.uf)
    )
  ) then
    return new;
  end if;

  select * into lia from public.legal_basis_assessments where version = new.lia_version;
  needed := array['name']
    || case when new.role_title is not null then array['role_title'] else array[]::text[] end
    || case when new.work_email is not null then array['work_email'] else array[]::text[] end
    || case when new.work_phone is not null then array['work_phone'] else array[]::text[] end
    || case when new.profile_url is not null
         then array['professional_profile_url'] else array[]::text[] end
    || case when new.profession is not null then array['profession'] else array[]::text[] end
    || case when new.organization_name is not null or new.company_id is not null
         then array['organization'] else array[]::text[] end
    || case when new.city is not null or new.uf is not null
         then array['location'] else array[]::text[] end;
  if lia.approved_at is null
    or lia.revoked_at is not null
    or (lia.review_due_on is not null and lia.review_due_on < agency_today)
    or exists (
      select 1 from public.legal_basis_assessments newer
      where newer.version > lia.version and newer.approved_at is not null
    )
    or not (new.source_kind = any (lia.data_sources))
    or not (needed <@ lia.data_categories)
  then
    raise exception 'person_lia_not_covering' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke execute on function app.guard_person_lia() from public, anon, authenticated;
create trigger people_guard_lia
  before insert or update on public.people
  for each row execute function app.guard_person_lia();

-- -----------------------------------------------------------------------------
-- Supressão de pessoa: sobrevive ao expurgo e vale para todos os perfis
-- -----------------------------------------------------------------------------

-- Só o hash (HMAC-SHA256 com o segredo do servidor) do e-mail normalizado, do telefone em E.164 e
-- da identidade (a mesma `dedupe_key` de `people`). Sem FK para `people`: a linha da pessoa pode
-- sumir (expurgo, eliminação a pedido), a supressão fica. Só inclusão.
create table public.person_suppressions (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('email', 'phone', 'identity')),
  value_hash text not null check (value_hash ~ '^[a-f0-9]{64}$'),
  reason text not null check (reason in ('opt_out', 'erasure_request', 'manual')),
  created_at timestamptz not null default now(),
  unique (kind, value_hash)
);
comment on table public.person_suppressions is
  'Supressão de pessoa (opt-out, eliminação a pedido): só hashes, sem FK para people, só inclusão. '
  'Vale para todos os perfis e sobrevive ao expurgo (doc 06 §6, doc 12 §4).';

create trigger person_suppressions_audit
  after insert on public.person_suppressions
  for each row execute function app.audit_write();

-- Opt-out é final: depois dele, nada volta a ter meio de contato, a marca não sai e o prazo não
-- cresce. Ao marcar, a identidade entra na supressão na mesma transação.
create function app.guard_person_opt_out() returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  if old.opted_out_at is not null and (
    new.opted_out_at is distinct from old.opted_out_at
    or new.work_email is not null
    or new.work_phone is not null
    or new.profile_url is not null
    or new.retention_until > old.retention_until
  ) then
    raise exception 'person_opted_out' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke execute on function app.guard_person_opt_out() from public, anon, authenticated;
create trigger people_guard_opt_out
  before update on public.people
  for each row execute function app.guard_person_opt_out();

-- O opt-out vale para a pessoa, não para a linha: as linhas da mesma identidade nos outros perfis
-- recebem a marca e perdem os meios de contato na mesma transação.
create function app.suppress_person_on_opt_out() returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  if new.opted_out_at is not null and old.opted_out_at is null then
    insert into public.person_suppressions (kind, value_hash, reason)
      values ('identity', new.dedupe_key, 'opt_out')
      on conflict (kind, value_hash) do nothing;
    update public.people
      set opted_out_at = new.opted_out_at, work_email = null, work_phone = null, profile_url = null
      where dedupe_key = new.dedupe_key and id <> new.id and opted_out_at is null;
  end if;
  return new;
end;
$$;
revoke execute on function app.suppress_person_on_opt_out() from public, anon, authenticated;
create trigger people_suppress_on_opt_out
  after update of opted_out_at on public.people
  for each row execute function app.suppress_person_on_opt_out();

-- Pessoa suprimida não volta: nenhum perfil grava de novo a mesma identidade.
create function app.guard_person_suppressed() returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  if exists (
    select 1 from public.person_suppressions
    where kind = 'identity' and value_hash = new.dedupe_key
  ) then
    raise exception 'person_suppressed' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke execute on function app.guard_person_suppressed() from public, anon, authenticated;
create trigger people_guard_suppressed
  before insert on public.people
  for each row execute function app.guard_person_suppressed();

-- -----------------------------------------------------------------------------
-- Acesso: só o servidor do app (ADR-0007)
-- -----------------------------------------------------------------------------

alter table public.people enable row level security;
alter table public.person_suppressions enable row level security;

revoke all on public.people, public.person_suppressions from anon, authenticated, service_role;
grant select, insert, delete on public.people to service_role;
-- Nome e chave não mudam: correção pedida pelo titular (art. 18, III) = apagar e recriar.
grant update (
  profession, role_title, organization_name, company_id, city, uf, work_email, work_phone,
  profile_url, audience_role, source_url, source_kind, source_quote, verified_at, lia_version,
  retention_until, opted_out_at
) on public.people to service_role;
grant select, insert on public.person_suppressions to service_role;
