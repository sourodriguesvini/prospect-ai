-- =============================================================================
-- ADR-0016, fatia E3: identidade de quem envia e caixa de e-mail (SMTP/IMAP), com a senha no
-- Supabase Vault (ADR-0006). Uso local sem login (ADR-0007): sem org_id. Só aditiva: nenhum dado
-- existente é alterado. NADA é enviado por esta migração; o envio de prospecção é a fatia E4.
--
-- sender_identities  versões da identidade do remetente (assinatura do modelo email-layout/v1).
--                    Somente inclusão: nova versão = nova linha; a mais recente vale.
-- mailboxes          a caixa que envia (uma só por enquanto). Servidores, limite e situação
--                    mudam; a senha NUNCA fica aqui: `secret_id` aponta para o Vault, gravado só
--                    pela RPC `set_mailbox_password`. Mudar servidor, usuário ou senha desfaz a
--                    verificação (trigger), para nada sair por uma caixa que não foi conferida.
-- mailbox_checks     resultado de cada "Testar conexão" (login SMTP e IMAP, SPF, DKIM, DMARC).
--                    Somente inclusão; nunca guarda senha nem conteúdo de e-mail.
--
-- Toda escrita pelo PostgREST é auditada na mesma transação (ADR-0010), exceto as conferências,
-- que são registro de execução com trace_id (como provider_usage).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Identidade do remetente (versionada)
-- -----------------------------------------------------------------------------

create table public.sender_identities (
  id uuid primary key default gen_random_uuid(),
  version integer not null unique check (version >= 1),
  sender_name text not null check (char_length(btrim(sender_name)) between 1 and 80),
  role text not null check (char_length(btrim(role)) between 1 and 80),
  studio text not null check (char_length(btrim(studio)) between 1 and 80),
  location text check (location is null or char_length(btrim(location)) between 1 and 80),
  website text check (
    website is null or (char_length(website) <= 300 and website ~ '^https://[^[:space:]"''<>`]+$')
  ),
  whatsapp text check (whatsapp is null or char_length(btrim(whatsapp)) between 1 and 40),
  email text not null check (
    char_length(email) between 3 and 254 and email = lower(email)
    and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
  ),
  banner_url text check (
    banner_url is null
    or (char_length(banner_url) <= 300 and banner_url ~ '^https://[^[:space:]"''<>`]+$')
  ),
  banner_alt text check (banner_alt is null or char_length(btrim(banner_alt)) between 1 and 160),
  -- [{ network, url, iconUrl }] validado no app (contrato SenderIdentityContent); aqui, só o formato.
  socials jsonb not null default '[]'::jsonb check (
    jsonb_typeof(socials) = 'array' and jsonb_array_length(socials) <= 5
  ),
  accent text not null default '#fa4e3e' check (accent ~ '^#[0-9a-fA-F]{6}$'),
  created_at timestamptz not null default now(),
  check ((banner_url is null) = (banner_alt is null))
);
comment on table public.sender_identities is
  'Identidade de quem assina os e-mails (ADR-0016, modelo email-layout/v1). Somente inclusão; a versão mais recente vale.';

create trigger sender_identities_assign_version
  before insert on public.sender_identities
  for each row execute function app.assign_version();
create trigger sender_identities_immutable
  before update or delete or truncate on public.sender_identities
  for each statement execute function app.forbid_version_mutation();
create trigger sender_identities_audit
  after insert on public.sender_identities
  for each row execute function app.audit_write();

-- -----------------------------------------------------------------------------
-- Caixa de e-mail
-- -----------------------------------------------------------------------------

create table public.mailboxes (
  id uuid primary key default gen_random_uuid(),
  address text not null check (
    char_length(address) between 3 and 254 and address = lower(address)
    and address ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
  ),
  display_name text not null check (char_length(btrim(display_name)) between 1 and 80),
  -- Nome de host público (o app recusa IP e nomes locais antes de conectar).
  smtp_host text not null check (
    char_length(smtp_host) <= 253 and smtp_host = lower(smtp_host)
    and smtp_host ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'
  ),
  smtp_port integer not null check (smtp_port in (465, 587)),
  imap_host text not null check (
    char_length(imap_host) <= 253 and imap_host = lower(imap_host)
    and imap_host ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'
  ),
  imap_port integer not null check (imap_port = 993),
  username text not null check (char_length(btrim(username)) between 1 and 254),
  -- Referência ao segredo no Vault; só a RPC set_mailbox_password grava.
  secret_id uuid,
  password_set_at timestamptz,
  -- docs/12 §5: bem abaixo dos tetos do provedor; ponto de partida 20, teto 50 por dia.
  daily_limit integer not null default 20 check (daily_limit between 1 and 50),
  status text not null default 'unverified' check (status in ('unverified', 'verified', 'paused')),
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((secret_id is null) = (password_set_at is null)),
  check (status <> 'verified' or (verified_at is not null and secret_id is not null)),
  -- O login prova o usuário, não o endereço digitado: o remetente fica no domínio da conta (um
  -- apelido, como fala@, continua valendo). Sem isso o teste "para mim" sairia para terceiros.
  check (
    position('@' in username) = 0
    or substring(address from '@([^@]+)$') = lower(substring(username from '@([^@]+)$'))
  )
);
comment on table public.mailboxes is
  'Caixa de e-mail que envia (ADR-0016). Uma só por enquanto. A senha fica no Vault (secret_id), nunca aqui.';

-- Uma caixa só nesta fase: a segunda exige decisão (e migração).
create unique index mailboxes_single_key on public.mailboxes ((true));
create unique index mailboxes_address_key on public.mailboxes (address);

-- Servidor, porta, usuário, endereço ou senha mudaram: a conferência anterior não vale mais.
-- E a senha vale para o servidor e o usuário em que foi digitada: se um deles muda, ela deixa de
-- ser usada (o app não a entrega a outro servidor) e precisa ser digitada de novo.
create function app.mailbox_reset_verification() returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  if new.secret_id is not null and (
    new.smtp_host is distinct from old.smtp_host
    or new.imap_host is distinct from old.imap_host
    or new.username is distinct from old.username
  ) then
    new.secret_id := null;
    new.password_set_at := null;
  end if;
  if new.status = 'verified' and (
    new.address is distinct from old.address
    or new.smtp_host is distinct from old.smtp_host
    or new.smtp_port is distinct from old.smtp_port
    or new.imap_host is distinct from old.imap_host
    or new.imap_port is distinct from old.imap_port
    or new.username is distinct from old.username
    or new.secret_id is distinct from old.secret_id
    or new.password_set_at is distinct from old.password_set_at
  ) then
    new.status := 'unverified';
    new.verified_at := null;
  end if;
  if new.status <> 'verified' then
    new.verified_at := null;
  end if;
  return new;
end;
$$;

create trigger mailboxes_updated_at
  before update on public.mailboxes
  for each row execute function app.set_updated_at();
create trigger mailboxes_guard_update
  before update on public.mailboxes
  for each row execute function app.guard_mutable_columns(
    'address', 'display_name', 'smtp_host', 'smtp_port', 'imap_host', 'imap_port', 'username',
    'secret_id', 'password_set_at', 'daily_limit', 'status', 'verified_at', 'updated_at'
  );
-- Depois da guarda (ordem alfabética dos triggers "before"): zera a verificação quando preciso.
create trigger mailboxes_reset_verification
  before update on public.mailboxes
  for each row execute function app.mailbox_reset_verification();
create trigger mailboxes_audit
  after insert or update on public.mailboxes
  for each row execute function app.audit_write();
create trigger mailboxes_no_delete
  before delete on public.mailboxes
  for each row execute function app.forbid_append_only_mutation();
create trigger mailboxes_no_truncate
  before truncate on public.mailboxes
  for each statement execute function app.forbid_append_only_mutation();

-- -----------------------------------------------------------------------------
-- Conferências da caixa
-- -----------------------------------------------------------------------------

create table public.mailbox_checks (
  id uuid primary key default gen_random_uuid(),
  mailbox_id uuid not null references public.mailboxes (id),
  smtp text not null check (smtp in ('ok', 'auth_failed', 'unreachable', 'tls_failed', 'not_tested')),
  imap text not null check (imap in ('ok', 'auth_failed', 'unreachable', 'tls_failed', 'not_tested')),
  spf text not null check (spf in ('ok', 'missing', 'multiple', 'permissive', 'without_provider', 'unknown')),
  dkim text not null check (dkim in ('ok', 'missing', 'unknown')),
  dmarc text not null check (dmarc in ('enforced', 'monitoring', 'missing', 'unknown')),
  -- Registros públicos do DNS e seletores encontrados; nunca senha, nunca conteúdo de e-mail.
  details jsonb not null default '{}'::jsonb check (
    jsonb_typeof(details) = 'object' and pg_column_size(details) <= 8192
  ),
  trace_id uuid not null,
  checked_at timestamptz not null,
  created_at timestamptz not null default now()
);
comment on table public.mailbox_checks is
  'Resultado de cada conferência da caixa (login SMTP/IMAP, SPF, DKIM, DMARC). Somente inclusão; sem segredos.';
create index mailbox_checks_mailbox_idx on public.mailbox_checks (mailbox_id, checked_at desc);

create trigger mailbox_checks_append_only
  before update or delete on public.mailbox_checks
  for each row execute function app.forbid_append_only_mutation();
create trigger mailbox_checks_no_truncate
  before truncate on public.mailbox_checks
  for each statement execute function app.forbid_append_only_mutation();

-- -----------------------------------------------------------------------------
-- Senha no Vault (ADR-0006). Só o servidor do app (service_role) executa.
-- -----------------------------------------------------------------------------

-- Grava ou troca a senha. A conferência anterior deixa de valer (trigger acima). A auditoria
-- registra só que a senha mudou, nunca o valor.
create function public.set_mailbox_password(p_mailbox_id uuid, p_password text) returns void
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_secret uuid;
begin
  if p_password is null or char_length(p_password) not between 1 and 256 then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  select secret_id into v_secret from public.mailboxes where id = p_mailbox_id for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  -- Senha desligada por troca de servidor ou usuário: o segredo (pelo nome) é reaproveitado.
  if v_secret is null then
    select id into v_secret from vault.secrets
     where name = 'prospector_mailbox_' || p_mailbox_id::text;
  end if;
  if v_secret is null then
    v_secret := vault.create_secret(
      p_password,
      'prospector_mailbox_' || p_mailbox_id::text,
      'Senha da caixa de e-mail do Prospector (ADR-0016)'
    );
  else
    perform vault.update_secret(v_secret, p_password);
  end if;
  -- Pausada continua pausada (disjuntor da E4); verificada volta a "não conferida".
  update public.mailboxes
     set secret_id = v_secret,
         password_set_at = now(),
         status = case when status = 'paused' then 'paused' else 'unverified' end
   where id = p_mailbox_id;
end;
$$;

-- Lida só no servidor, na hora de conectar; nunca vai para a tela, log ou trace.
create function public.mailbox_password(p_mailbox_id uuid) returns text
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
declare
  v_password text;
begin
  select ds.decrypted_secret into v_password
    from public.mailboxes m
    join vault.decrypted_secrets ds
      on ds.id = m.secret_id and ds.name = 'prospector_mailbox_' || m.id::text
   where m.id = p_mailbox_id;
  return v_password;
end;
$$;

-- -----------------------------------------------------------------------------
-- Acesso: só o servidor do app (ADR-0007)
-- -----------------------------------------------------------------------------

alter table public.sender_identities enable row level security;
alter table public.mailboxes enable row level security;
alter table public.mailbox_checks enable row level security;

revoke all on public.sender_identities, public.mailboxes, public.mailbox_checks
  from anon, authenticated, service_role;
grant select, insert on public.sender_identities, public.mailbox_checks to service_role;
grant select on public.mailboxes to service_role;
-- secret_id, password_set_at, status e verified_at nunca na inclusão; os dois primeiros só pela
-- RPC (security definer).
grant insert (
  address, display_name, smtp_host, smtp_port, imap_host, imap_port, username, daily_limit
) on public.mailboxes to service_role;
grant update (
  address, display_name, smtp_host, smtp_port, imap_host, imap_port, username, daily_limit,
  status, verified_at
) on public.mailboxes to service_role;

revoke execute on function
  public.set_mailbox_password(uuid, text),
  public.mailbox_password(uuid),
  app.mailbox_reset_verification()
  from public, anon, authenticated;
grant execute on function
  public.set_mailbox_password(uuid, text),
  public.mailbox_password(uuid)
  to service_role;
