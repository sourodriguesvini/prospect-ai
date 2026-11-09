-- =============================================================================
-- F1 — Fundação de tenancy
--   organizations, profiles, memberships, invitations, audit_log (somente inserção)
--   funções auxiliares de RLS (schema app) e RPCs de equipe (schema public)
--
-- Padrão de RLS: docs/06-modelo-de-dados.md §2.
-- Regras de papel espelham packages/domain/src/tenancy/roles.ts.
-- Erros de regra: `raise exception '<chave>'`; a chave é mapeada para mensagem
-- em packages/application/src/errors.ts (ERROR_MESSAGES).
-- =============================================================================

create schema if not exists app;
comment on schema app is 'Funções internas do Prospector. Não exposto pela API de dados.';
grant usage on schema app to authenticated, service_role;

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

create function app.role_rank(p_role text) returns integer
  language sql
  immutable
  set search_path = ''
as $$
  select case p_role
    when 'owner' then 4
    when 'admin' then 3
    when 'operator' then 2
    when 'viewer' then 1
    else 0
  end;
$$;

-- -----------------------------------------------------------------------------
-- organizations
-- -----------------------------------------------------------------------------

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (name = btrim(name) and char_length(name) between 2 and 120),
  slug text not null unique check (slug ~ '^[a-z0-9](?:[a-z0-9-]{1,46}[a-z0-9])$'),
  settings jsonb not null default '{}'::jsonb check (pg_column_size(settings) <= 16384),
  is_demo boolean not null default false,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);
comment on table public.organizations is 'Tenant. Criação apenas pela RPC public.create_organization.';

create trigger organizations_set_updated_at
  before update on public.organizations
  for each row execute function app.set_updated_at();

-- -----------------------------------------------------------------------------
-- profiles (1:1 com auth.users; criado por trigger no cadastro)
-- -----------------------------------------------------------------------------

create table public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  email text,
  full_name text check (full_name is null or char_length(full_name) <= 120),
  title text check (title is null or char_length(title) <= 120),
  avatar_url text check (avatar_url is null or avatar_url ~ '^https://'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.profiles is 'Perfil de usuário da plataforma (equipe da agência), não de prospects.';

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function app.set_updated_at();

create function app.handle_new_user() returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
-- security definer: grava em public.profiles a partir do schema auth (sem sessão de usuário).
begin
  insert into public.profiles (user_id, email, full_name)
  values (
    new.id,
    lower(new.email),
    nullif(left(btrim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), 120), '')
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function app.handle_new_user();

create function app.handle_user_email_change() returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
-- security definer: mantém public.profiles.email em sincronia com auth.users.
begin
  update public.profiles set email = lower(new.email) where user_id = new.id;
  return new;
end;
$$;

create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row execute function app.handle_user_email_change();

-- -----------------------------------------------------------------------------
-- memberships
-- -----------------------------------------------------------------------------

create table public.memberships (
  org_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references public.profiles (user_id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'operator', 'viewer')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (org_id, user_id)
);
comment on table public.memberships is 'Escrita apenas pelas RPCs de equipe (regras de papel e último owner).';

create index memberships_user_id_idx on public.memberships (user_id);

create trigger memberships_set_updated_at
  before update on public.memberships
  for each row execute function app.set_updated_at();

-- -----------------------------------------------------------------------------
-- Auxiliares de RLS
-- -----------------------------------------------------------------------------

create function app.is_member(p_org uuid, p_min_role text default 'viewer') returns boolean
  language sql
  stable
  security definer
  set search_path = ''
as $$
  -- security definer: lê memberships sem acionar o RLS da própria tabela (evita recursão).
  select exists (
    select 1
    from public.memberships m
    where m.org_id = p_org
      and m.user_id = (select auth.uid())
      and app.role_rank(m.role) >= app.role_rank(p_min_role)
  );
$$;

create function app.shares_org_with(p_user uuid) returns boolean
  language sql
  stable
  security definer
  set search_path = ''
as $$
  -- security definer: mesmo motivo de app.is_member.
  select exists (
    select 1
    from public.memberships mine
    join public.memberships theirs on theirs.org_id = mine.org_id
    where mine.user_id = (select auth.uid())
      and theirs.user_id = p_user
  );
$$;

-- -----------------------------------------------------------------------------
-- invitations
-- -----------------------------------------------------------------------------

create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  email text not null check (email = lower(btrim(email)) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  role text not null check (role in ('admin', 'operator', 'viewer')),
  token_hash text not null unique check (token_hash ~ '^[a-f0-9]{64}$'),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'revoked', 'expired')),
  invited_by uuid references auth.users (id) on delete set null,
  expires_at timestamptz not null default (now() + interval '7 days'),
  accepted_by uuid references auth.users (id) on delete set null,
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.invitations is 'Convites de equipe. Guarda apenas o SHA-256 do token.';

create unique index invitations_one_pending_per_email
  on public.invitations (org_id, email)
  where status = 'pending';
create index invitations_org_status_idx on public.invitations (org_id, status);

create trigger invitations_set_updated_at
  before update on public.invitations
  for each row execute function app.set_updated_at();

-- -----------------------------------------------------------------------------
-- audit_log (somente inserção)
-- -----------------------------------------------------------------------------

create table public.audit_log (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.organizations (id),
  actor_type text not null check (actor_type in ('user', 'agent', 'system')),
  actor_id uuid,
  action text not null,
  entity_type text not null,
  entity_id text,
  diff jsonb,
  ip inet,
  user_agent text,
  occurred_at timestamptz not null default now()
);
comment on table public.audit_log is
  'Trilha de auditoria somente inserção. Update/delete/truncate bloqueados por trigger para todos os papéis; '
  'expurgo por retenção será feito por partição (F13).';

create index audit_log_org_occurred_idx on public.audit_log (org_id, occurred_at desc);

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

create function app.write_audit(
  p_org uuid,
  p_action text,
  p_entity_type text,
  p_entity_id text,
  p_diff jsonb
) returns void
  language plpgsql
  security definer
  set search_path = ''
as $$
-- security definer: única porta de escrita no audit_log a partir de triggers e RPCs.
declare
  v_actor uuid := auth.uid();
begin
  insert into public.audit_log (org_id, actor_type, actor_id, action, entity_type, entity_id, diff)
  values (
    p_org,
    case when v_actor is null then 'system' else 'user' end,
    v_actor,
    p_action,
    p_entity_type,
    p_entity_id,
    p_diff
  );
end;
$$;

create function app.audit_row_change() returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
-- security definer: grava no audit_log, que não aceita inserção direta de usuários.
declare
  v_old jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) - 'token_hash' end;
  v_new jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) - 'token_hash' end;
  v_row jsonb := coalesce(v_new, v_old);
  v_org uuid;
  v_entity text;
  v_diff jsonb;
begin
  if tg_table_name = 'organizations' then
    v_org := (v_row ->> 'id')::uuid;
    v_entity := v_row ->> 'id';
  elsif tg_table_name = 'memberships' then
    v_org := (v_row ->> 'org_id')::uuid;
    v_entity := v_row ->> 'user_id';
  else
    v_org := (v_row ->> 'org_id')::uuid;
    v_entity := v_row ->> 'id';
  end if;

  if tg_op = 'UPDATE' then
    select jsonb_object_agg(e.key, jsonb_build_object('from', v_old -> e.key, 'to', e.value))
      into v_diff
      from jsonb_each(v_new) as e (key, value)
      where (v_old -> e.key) is distinct from e.value
        and e.key <> 'updated_at';
    if v_diff is null then
      return null;
    end if;
  elsif tg_op = 'INSERT' then
    v_diff := v_new;
  else
    v_diff := v_old;
  end if;

  perform app.write_audit(v_org, tg_table_name || '.' || lower(tg_op), tg_table_name, v_entity, v_diff);
  return null;
end;
$$;

create trigger organizations_audit
  after insert or update on public.organizations
  for each row execute function app.audit_row_change();

create trigger memberships_audit
  after insert or update or delete on public.memberships
  for each row execute function app.audit_row_change();

create trigger invitations_audit
  after insert or update or delete on public.invitations
  for each row execute function app.audit_row_change();

-- -----------------------------------------------------------------------------
-- RLS e privilégios
-- -----------------------------------------------------------------------------

alter table public.organizations enable row level security;
alter table public.profiles enable row level security;
alter table public.memberships enable row level security;
alter table public.invitations enable row level security;
alter table public.audit_log enable row level security;

-- Privilégios explícitos: nada depende dos privilégios padrão do projeto.
-- anon não acessa nada de tenancy; authenticated recebe só o que cada tabela precisa.
revoke all on public.organizations, public.profiles, public.memberships, public.invitations, public.audit_log
  from anon, authenticated;

-- organizations: membros leem; admin altera apenas nome e configurações; criação só por RPC.
create policy organizations_select on public.organizations
  for select to authenticated
  using ((select app.is_member(id)));
create policy organizations_update on public.organizations
  for update to authenticated
  using ((select app.is_member(id, 'admin')))
  with check ((select app.is_member(id, 'admin')));
grant select on public.organizations to authenticated;
-- settings fica fora até existir um caso de uso com validação (RPC + contrato).
grant update (name) on public.organizations to authenticated;

-- profiles: o próprio usuário e quem compartilha organização leem; cada um edita o próprio.
create policy profiles_select on public.profiles
  for select to authenticated
  using (user_id = (select auth.uid()) or app.shares_org_with(user_id));
create policy profiles_update on public.profiles
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
grant select on public.profiles to authenticated;
grant update (full_name, title, avatar_url) on public.profiles to authenticated;

-- memberships: membros leem a equipe; escrita somente pelas RPCs.
create policy memberships_select on public.memberships
  for select to authenticated
  using ((select app.is_member(org_id)));
grant select on public.memberships to authenticated;

-- invitations: só admin/owner leem (sem a coluna token_hash); escrita somente pelas RPCs.
create policy invitations_select on public.invitations
  for select to authenticated
  using ((select app.is_member(org_id, 'admin')));
grant select (id, org_id, email, role, status, invited_by, expires_at, accepted_by, accepted_at, created_at, updated_at)
  on public.invitations to authenticated;

-- audit_log: admin/owner leem; ninguém altera (trigger); inserção só pelo backend.
create policy audit_log_select on public.audit_log
  for select to authenticated
  using ((select app.is_member(org_id, 'admin')));
grant select on public.audit_log to authenticated;
revoke update, delete, truncate on public.audit_log from service_role;

-- Funções internas não são chamáveis diretamente por usuários.
revoke execute on function app.write_audit(uuid, text, text, text, jsonb) from public, anon, authenticated;
revoke execute on function app.audit_row_change() from public, anon, authenticated;
revoke execute on function app.handle_new_user() from public, anon, authenticated;
revoke execute on function app.handle_user_email_change() from public, anon, authenticated;

-- Nenhuma função do schema app é executável por padrão (nem as futuras); authenticated
-- executa só as auxiliares usadas nas políticas de RLS.
revoke execute on all functions in schema app from public, anon, authenticated;
alter default privileges in schema app revoke execute on functions from public;
grant execute on function app.is_member(uuid, text), app.shares_org_with(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- RPCs de organização e equipe
-- Todas: security definer (escrevem em tabelas sem política de escrita),
-- search_path vazio e checagem explícita de papel.
-- -----------------------------------------------------------------------------

create function public.create_organization(p_name text, p_slug text) returns uuid
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_org uuid;
begin
  if v_user is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  begin
    insert into public.organizations (name, slug, created_by)
    values (btrim(p_name), lower(btrim(p_slug)), v_user)
    returning id into v_org;
  exception when unique_violation then
    raise exception 'slug_taken' using errcode = '23505';
  end;

  insert into public.memberships (org_id, user_id, role) values (v_org, v_user, 'owner');
  return v_org;
end;
$$;

create function public.create_invitation(p_org_id uuid, p_email text, p_role text) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_actor_role text;
  v_email text := lower(btrim(p_email));
  v_token text;
  v_id uuid;
  v_expires timestamptz;
begin
  if v_user is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  select m.role into v_actor_role
    from public.memberships m
    where m.org_id = p_org_id and m.user_id = v_user;
  if v_actor_role is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if app.role_rank(v_actor_role) < app.role_rank('admin') then
    raise exception 'not_admin' using errcode = '42501';
  end if;
  if p_role = 'owner' then
    raise exception 'owner_only' using errcode = '42501';
  end if;
  if p_role is null or p_role not in ('admin', 'operator', 'viewer') then
    raise exception 'invalid_input' using errcode = '22023';
  end if;

  if exists (
    select 1
    from public.memberships m
    join public.profiles p on p.user_id = m.user_id
    where m.org_id = p_org_id and p.email = v_email
  ) then
    raise exception 'already_member' using errcode = '23505';
  end if;

  -- Convites vencidos deixam de bloquear um novo convite para o mesmo e-mail.
  update public.invitations i
    set status = 'expired'
    where i.org_id = p_org_id and i.email = v_email and i.status = 'pending' and i.expires_at <= now();

  -- 64 caracteres hexadecimais aleatórios (2 × UUID v4); o banco guarda só o SHA-256.
  v_token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');

  begin
    insert into public.invitations (org_id, email, role, token_hash, invited_by)
    values (p_org_id, v_email, p_role, encode(sha256(convert_to(v_token, 'UTF8')), 'hex'), v_user)
    returning id, expires_at into v_id, v_expires;
  exception when unique_violation then
    raise exception 'invitation_pending' using errcode = '23505';
  end;

  return jsonb_build_object('invitationId', v_id, 'token', v_token, 'expiresAt', v_expires);
end;
$$;

create function public.accept_invitation(p_token text) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_email text;
  v_confirmed_at timestamptz;
  v_inv public.invitations%rowtype;
  v_slug text;
begin
  if v_user is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if p_token is null or p_token !~ '^[a-f0-9]{64}$' then
    raise exception 'invitation_invalid' using errcode = 'P0002';
  end if;

  select * into v_inv
    from public.invitations i
    where i.token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex')
    for update;
  if not found or v_inv.status <> 'pending' then
    raise exception 'invitation_invalid' using errcode = 'P0002';
  end if;
  if v_inv.expires_at <= now() then
    raise exception 'invitation_expired' using errcode = '42501';
  end if;
  -- O convite só vale enquanto quem convidou continua administrando a organização
  -- (removido, rebaixado ou com a conta excluída: o convite deixa de dar acesso).
  if v_inv.invited_by is null or not exists (
    select 1
    from public.memberships m
    where m.org_id = v_inv.org_id
      and m.user_id = v_inv.invited_by
      and app.role_rank(m.role) >= app.role_rank('admin')
  ) then
    raise exception 'invitation_invalid' using errcode = 'P0002';
  end if;

  select lower(u.email), u.email_confirmed_at into v_email, v_confirmed_at
    from auth.users u
    where u.id = v_user;
  if v_confirmed_at is null then
    raise exception 'email_not_confirmed' using errcode = '42501';
  end if;
  if v_email is distinct from v_inv.email then
    raise exception 'invitation_email_mismatch' using errcode = '42501';
  end if;
  if exists (select 1 from public.memberships m where m.org_id = v_inv.org_id and m.user_id = v_user) then
    raise exception 'already_member' using errcode = '23505';
  end if;

  insert into public.memberships (org_id, user_id, role) values (v_inv.org_id, v_user, v_inv.role);
  update public.invitations
    set status = 'accepted', accepted_by = v_user, accepted_at = now()
    where id = v_inv.id;

  select o.slug into v_slug from public.organizations o where o.id = v_inv.org_id;
  return jsonb_build_object('orgId', v_inv.org_id, 'slug', v_slug);
end;
$$;

create function public.revoke_invitation(p_org_id uuid, p_invitation_id uuid) returns void
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if not app.is_member(p_org_id) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if not app.is_member(p_org_id, 'admin') then
    raise exception 'not_admin' using errcode = '42501';
  end if;

  update public.invitations i
    set status = 'revoked'
    where i.id = p_invitation_id and i.org_id = p_org_id and i.status = 'pending';
  if not found then
    raise exception 'invitation_invalid' using errcode = 'P0002';
  end if;
end;
$$;

create function public.change_member_role(p_org_id uuid, p_user_id uuid, p_role text) returns void
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_actor_role text;
  v_target_role text;
begin
  if v_user is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  -- Serializa mudanças de equipe por organização (protege a regra do último owner).
  perform 1 from public.organizations o where o.id = p_org_id for update;

  select m.role into v_actor_role from public.memberships m where m.org_id = p_org_id and m.user_id = v_user;
  if v_actor_role is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if app.role_rank(v_actor_role) < app.role_rank('admin') then
    raise exception 'not_admin' using errcode = '42501';
  end if;
  if p_role is null or p_role not in ('owner', 'admin', 'operator', 'viewer') then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  if p_user_id = v_user then
    raise exception 'self_change' using errcode = '42501';
  end if;

  select m.role into v_target_role from public.memberships m where m.org_id = p_org_id and m.user_id = p_user_id;
  if v_target_role is null then
    raise exception 'member_not_found' using errcode = 'P0002';
  end if;
  if (v_target_role = 'owner' or p_role = 'owner') and v_actor_role <> 'owner' then
    raise exception 'owner_only' using errcode = '42501';
  end if;
  if v_target_role = 'owner' and p_role <> 'owner'
     and (select count(*) from public.memberships m where m.org_id = p_org_id and m.role = 'owner') <= 1 then
    raise exception 'last_owner' using errcode = '42501';
  end if;

  update public.memberships m set role = p_role where m.org_id = p_org_id and m.user_id = p_user_id;

  -- Quem deixa de administrar perde os convites pendentes que emitiu.
  if app.role_rank(p_role) < app.role_rank('admin') then
    update public.invitations i
      set status = 'revoked'
      where i.org_id = p_org_id and i.invited_by = p_user_id and i.status = 'pending';
  end if;
end;
$$;

create function public.remove_member(p_org_id uuid, p_user_id uuid) returns void
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_actor_role text;
  v_target_role text;
begin
  if v_user is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  perform 1 from public.organizations o where o.id = p_org_id for update;

  select m.role into v_actor_role from public.memberships m where m.org_id = p_org_id and m.user_id = v_user;
  if v_actor_role is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if app.role_rank(v_actor_role) < app.role_rank('admin') then
    raise exception 'not_admin' using errcode = '42501';
  end if;
  if p_user_id = v_user then
    raise exception 'self_change' using errcode = '42501';
  end if;

  select m.role into v_target_role from public.memberships m where m.org_id = p_org_id and m.user_id = p_user_id;
  if v_target_role is null then
    raise exception 'member_not_found' using errcode = 'P0002';
  end if;
  if v_target_role = 'owner' and v_actor_role <> 'owner' then
    raise exception 'owner_only' using errcode = '42501';
  end if;
  if v_target_role = 'owner'
     and (select count(*) from public.memberships m where m.org_id = p_org_id and m.role = 'owner') <= 1 then
    raise exception 'last_owner' using errcode = '42501';
  end if;

  -- Convites pendentes emitidos pela pessoa removida, ou endereçados a ela, deixam de valer.
  update public.invitations i
    set status = 'revoked'
    where i.org_id = p_org_id
      and i.status = 'pending'
      and (
        i.invited_by = p_user_id
        or i.email = (select p.email from public.profiles p where p.user_id = p_user_id)
      );

  delete from public.memberships m where m.org_id = p_org_id and m.user_id = p_user_id;
end;
$$;

revoke execute on function public.create_organization(text, text) from public, anon;
revoke execute on function public.create_invitation(uuid, text, text) from public, anon;
revoke execute on function public.accept_invitation(text) from public, anon;
revoke execute on function public.revoke_invitation(uuid, uuid) from public, anon;
revoke execute on function public.change_member_role(uuid, uuid, text) from public, anon;
revoke execute on function public.remove_member(uuid, uuid) from public, anon;

grant execute on function public.create_organization(text, text) to authenticated;
grant execute on function public.create_invitation(uuid, text, text) to authenticated;
grant execute on function public.accept_invitation(text) to authenticated;
grant execute on function public.revoke_invitation(uuid, uuid) to authenticated;
grant execute on function public.change_member_role(uuid, uuid, text) to authenticated;
grant execute on function public.remove_member(uuid, uuid) to authenticated;
