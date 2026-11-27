-- =============================================================================
-- ADR-0019 (aceito pelo usuário em 2026-11-27) e diretriz de 2026-11-26, Parte 1.5: perfis
-- comerciais independentes (Found Studio, Blummy). O catálogo de cada perfil (capacidades,
-- problemas, serviços, soluções) continua dado versionado no código
-- (`packages/domain/src/commercial/profiles.ts`); esta tabela dá a cada perfil uma identidade no
-- banco para o que pertence a ele: ofertas, cases e pesquisas do Copiloto.
--
-- Só aditiva. As ofertas e os cases que já existem passam a ser da Found Studio, o único perfil
-- que existia de fato (eram as três ofertas de marca). Nada é apagado nem reescrito além disso.
-- Uso local sem login (ADR-0007): sem org_id; acesso só pelo servidor do app.
-- =============================================================================

create table public.commercial_profiles (
  id uuid primary key default gen_random_uuid(),
  -- O mesmo id do perfil no código (`CommercialProfile.id`): 'found-studio', 'blummy'.
  key text not null unique check (key ~ '^[a-z][a-z0-9-]{1,39}$'),
  name text not null check (char_length(btrim(name)) between 1 and 80),
  kind text not null check (kind in ('services', 'product')),
  status text not null default 'active' check (status in ('active', 'archived')),
  -- Perfil usado quando nada diz outro (a investigação de empresas, hoje).
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.commercial_profiles is
  'Perfis comerciais independentes (ADR-0019). O catálogo fica no código; aqui, a identidade a que '
  'pertencem ofertas, cases e pesquisas do Copiloto.';

-- Um padrão só.
create unique index commercial_profiles_single_default on public.commercial_profiles ((true))
  where is_default;

create trigger commercial_profiles_updated_at
  before update on public.commercial_profiles
  for each row execute function app.set_updated_at();
create trigger commercial_profiles_audit
  after insert or update on public.commercial_profiles
  for each row execute function app.audit_write();

-- Os dois perfis do ADR-0019 (dado do produto, não demonstração).
insert into public.commercial_profiles (key, name, kind, is_default) values
  ('found-studio', 'Found Studio', 'services', true),
  ('blummy', 'Blummy', 'product', false);

-- -----------------------------------------------------------------------------
-- Ofertas e cases pertencem a um perfil
-- -----------------------------------------------------------------------------

alter table public.offers add column profile_id uuid references public.commercial_profiles (id);
alter table public.proof_assets add column profile_id uuid references public.commercial_profiles (id);

update public.offers
  set profile_id = (select id from public.commercial_profiles where key = 'found-studio')
  where profile_id is null;
update public.proof_assets
  set profile_id = (select id from public.commercial_profiles where key = 'found-studio')
  where profile_id is null;

-- Quem não diz o perfil (o app de antes desta migração, por exemplo) grava no perfil padrão.
create function app.default_commercial_profile() returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  if new.profile_id is null then
    select id into new.profile_id from public.commercial_profiles where is_default;
  end if;
  return new;
end;
$$;
revoke execute on function app.default_commercial_profile() from public, anon, authenticated;

create trigger offers_default_profile
  before insert on public.offers
  for each row execute function app.default_commercial_profile();
create trigger proof_assets_default_profile
  before insert on public.proof_assets
  for each row execute function app.default_commercial_profile();

alter table public.offers alter column profile_id set not null;
alter table public.proof_assets alter column profile_id set not null;

create index offers_profile_idx on public.offers (profile_id);
create index proof_assets_profile_idx on public.proof_assets (profile_id);

-- -----------------------------------------------------------------------------
-- Acesso: só o servidor do app (ADR-0007)
-- -----------------------------------------------------------------------------

alter table public.commercial_profiles enable row level security;

revoke all on public.commercial_profiles from anon, authenticated, service_role;
grant select on public.commercial_profiles to service_role;
grant update (status, is_default) on public.commercial_profiles to service_role;
