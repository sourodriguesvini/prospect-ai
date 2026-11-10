-- =============================================================================
-- M2 — Empresas e Evidence Ledger (docs/06 §4.3 e §4.4, contratos da F3a, docs/14 M2).
-- Uso local sem login (ADR-0007): sem org_id. Só aditiva: nenhum dado existente é alterado.
--
-- companies            projeção para listagem; a verdade detalhada está nos claims. CNPJ sempre
--                      texto (existe CNPJ alfanumérico desde jul/2026). Nada é apagado: arquivar é
--                      o ciclo de vida 'archived'.
-- company_identifiers  chaves de deduplicação (CNPJ, domínio…); fortes são únicas.
-- sources              fontes coletadas pelo sistema (registro de API, página, nota do usuário).
-- claims               afirmações tipadas (fato, inferência, hipótese) com confiança calculada no
--                      servidor (@prospector/domain). Conteúdo nunca muda: nova versão = novo claim
--                      com supersedes_id; só status e reviewed_at são atualizáveis.
-- claim_evidence       trecho/região de cada fonte que sustenta ou contradiz o claim.
-- claim_dependencies   inferência → fatos de que depende.
--
-- Toda escrita pelo PostgREST é auditada na mesma transação (ADR-0010). Gravações de várias
-- tabelas passam por RPCs (create_company, record_evidence), atômicas, com uma linha de auditoria
-- por operação.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Empresas
-- -----------------------------------------------------------------------------

create table public.companies (
  id uuid primary key default gen_random_uuid(),
  display_name text not null check (char_length(btrim(display_name)) between 2 and 160),
  legal_name text check (legal_name is null or char_length(legal_name) between 1 and 300),
  cnpj text check (cnpj is null or cnpj ~ '^[0-9A-Z]{12}[0-9]{2}$'),
  cnpj_root text generated always as (left(cnpj, 8)) stored,
  primary_domain text check (
    primary_domain is null
    or (char_length(primary_domain) <= 253 and primary_domain ~ '^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$')
  ),
  city text check (city is null or char_length(city) between 1 and 120),
  uf text check (uf is null or uf ~ '^[A-Z]{2}$'),
  cnae_main text check (cnae_main is null or cnae_main ~ '^[0-9]{4}-[0-9]/[0-9]{2}$'),
  size_band text check (size_band is null or size_band in ('me', 'epp', 'demais')),
  lifecycle text not null default 'candidate' check (
    lifecycle in (
      'candidate', 'investigating', 'qualified', 'disqualified', 'engaged', 'customer', 'archived'
    )
  ),
  origin text not null check (origin in ('manual', 'cnpj_lookup', 'discovery')),
  last_investigated_at timestamptz,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Busca da lista sem acento nem maiúsculas (translate é imutável; unaccent não pode ser usado em
  -- coluna gerada). O app dobra o termo do mesmo jeito (packages/db/src/company-repository.ts).
  search_text text generated always as (
    translate(
      lower(
        display_name || ' ' || coalesce(legal_name, '') || ' ' || coalesce(primary_domain, '')
        || ' ' || coalesce(cnpj, '')
      ),
      'áàâãäéèêëíìîïóòôõöúùûüçñ',
      'aaaaaeeeeiiiiooooouuuucn'
    )
  ) stored
);
comment on table public.companies is
  'Empresas acompanhadas (M2). Projeção para listagem; conclusões ficam em claims.';

create unique index companies_cnpj_key on public.companies (cnpj) where cnpj is not null;
create unique index companies_domain_key on public.companies (primary_domain)
  where primary_domain is not null;
create index companies_lifecycle_idx on public.companies (lifecycle, updated_at desc);

create trigger companies_updated_at
  before update on public.companies
  for each row execute function app.set_updated_at();
create trigger companies_audit
  after insert or update on public.companies
  for each row execute function app.audit_write();

-- -----------------------------------------------------------------------------
-- Fontes
-- -----------------------------------------------------------------------------

create table public.sources (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (
    kind in (
      'web_page', 'api_record', 'screenshot', 'document', 'social_post', 'user_note',
      'search_result'
    )
  ),
  url text check (url is null or (char_length(url) <= 2048 and url ~ '^https?://')),
  provider text check (provider is null or char_length(provider) between 1 and 80),
  external_ref text check (external_ref is null or char_length(external_ref) between 1 and 200),
  captured_at timestamptz not null,
  content_hash text check (content_hash is null or content_hash ~ '^[a-f0-9]{64}$'),
  storage_path text check (storage_path is null or char_length(storage_path) between 1 and 500),
  mime text check (mime is null or char_length(mime) between 1 and 120),
  http_status integer check (http_status is null or http_status between 100 and 599),
  title text check (title is null or char_length(title) <= 300),
  excerpt_text text check (excerpt_text is null or char_length(excerpt_text) <= 100000),
  license_note text check (license_note is null or char_length(license_note) <= 500),
  retention_until timestamptz,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  -- Toda fonte se deixa localizar de novo (mesmas regras do contrato SourceInput).
  check (
    kind not in ('web_page', 'screenshot', 'social_post', 'search_result') or url is not null
  ),
  check (kind <> 'api_record' or provider is not null),
  check (kind = 'user_note' or url is not null or external_ref is not null)
);
comment on table public.sources is
  'Fontes do Evidence Ledger (M2). Somente inclusão; conteúdo bruto no Storage, texto normalizado '
  'em excerpt_text para conferir trechos.';
create index sources_external_ref_idx on public.sources (provider, external_ref);

create trigger sources_audit
  after insert on public.sources
  for each row execute function app.audit_write();

create table public.company_identifiers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id),
  kind text not null check (
    kind in ('cnpj', 'cnpj_root', 'domain', 'place_id', 'instagram', 'phone', 'linkedin_url')
  ),
  value_normalized text not null check (char_length(value_normalized) between 1 and 300),
  strength text not null check (strength in ('strong', 'weak')),
  verified boolean not null default false,
  source_id uuid references public.sources (id),
  created_at timestamptz not null default now()
);
comment on table public.company_identifiers is
  'Chaves de deduplicação de empresas (M2). Fortes (CNPJ, domínio, place_id) são únicas.';
create unique index company_identifiers_strong_key on public.company_identifiers (kind, value_normalized)
  where strength = 'strong';
create index company_identifiers_company_idx on public.company_identifiers (company_id);

create trigger company_identifiers_audit
  after insert on public.company_identifiers
  for each row execute function app.audit_write();

-- -----------------------------------------------------------------------------
-- Claims
-- -----------------------------------------------------------------------------

create table public.claims (
  id uuid primary key default gen_random_uuid(),
  subject_type text not null check (subject_type in ('company', 'contact', 'competitor_link')),
  subject_id uuid not null,
  domain text not null check (
    domain in (
      'firmographic', 'digital_presence', 'visual', 'positioning', 'signal', 'contact',
      'competitive', 'financial_proxy'
    )
  ),
  key text not null check (
    char_length(key) <= 120 and key ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$'
  ),
  statement text not null check (char_length(btrim(statement)) between 5 and 500),
  value jsonb check (
    value is null or (jsonb_typeof(value) = 'object' and pg_column_size(value) <= 8192)
  ),
  epistemic_type text not null check (epistemic_type in ('fact', 'inference', 'hypothesis')),
  confidence numeric(3, 2) check (confidence is null or confidence between 0 and 1),
  status text not null check (status in ('active', 'stale', 'disputed', 'rejected', 'superseded')),
  valid_until timestamptz not null,
  reasoning text check (reasoning is null or char_length(reasoning) <= 800),
  reasoning_factor numeric(3, 2),
  produced_by_run_id uuid,
  prompt_version_id uuid,
  supersedes_id uuid references public.claims (id),
  reviewed_at timestamptz,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  -- Mesmas regras do contrato Claim (packages/contracts/src/evidence.ts).
  check ((epistemic_type = 'hypothesis') = (confidence is null)),
  check (
    epistemic_type <> 'inference'
    or (reasoning_factor between 0.5 and 0.9 and confidence <= 0.9)
  ),
  check (epistemic_type = 'inference' or reasoning_factor is null),
  check (supersedes_id is null or supersedes_id <> id)
);
comment on table public.claims is
  'Afirmações tipadas sobre empresas e contatos (Evidence Ledger, ADR-0002). Confiança calculada '
  'no servidor; conteúdo imutável, só status e reviewed_at mudam.';
create index claims_subject_idx on public.claims (subject_type, subject_id, key);
create index claims_supersedes_idx on public.claims (supersedes_id) where supersedes_id is not null;

create trigger claims_audit
  after insert or update on public.claims
  for each row execute function app.audit_write();

create table public.claim_evidence (
  claim_id uuid not null references public.claims (id),
  source_id uuid not null references public.sources (id),
  quote text check (quote is null or char_length(btrim(quote)) between 1 and 1200),
  locator jsonb check (
    locator is null or (jsonb_typeof(locator) = 'object' and pg_column_size(locator) <= 2048)
  ),
  stance text not null default 'supports' check (stance in ('supports', 'contradicts')),
  reliability_tier text not null check (
    reliability_tier in (
      'official_registry', 'company_owned', 'recognized_press', 'aggregator', 'user_reported',
      'unknown'
    )
  ),
  quote_verified boolean,
  created_at timestamptz not null default now(),
  primary key (claim_id, source_id),
  check (quote is not null or locator is not null)
);
comment on table public.claim_evidence is
  'Trecho ou região de uma fonte que sustenta ou contradiz um claim (uma vez por fonte).';
create index claim_evidence_source_idx on public.claim_evidence (source_id);

create trigger claim_evidence_audit
  after insert on public.claim_evidence
  for each row execute function app.audit_write();

create table public.claim_dependencies (
  claim_id uuid not null references public.claims (id),
  depends_on_claim_id uuid not null references public.claims (id),
  created_at timestamptz not null default now(),
  primary key (claim_id, depends_on_claim_id),
  check (claim_id <> depends_on_claim_id)
);
comment on table public.claim_dependencies is 'Inferência → claims de que ela depende.';

create trigger claim_dependencies_audit
  after insert on public.claim_dependencies
  for each row execute function app.audit_write();

-- Fonte, evidência e dependência nunca mudam; claim só muda status e revisão.
create trigger sources_append_only
  before update or delete on public.sources
  for each row execute function app.forbid_append_only_mutation();
create trigger claim_evidence_append_only
  before update or delete on public.claim_evidence
  for each row execute function app.forbid_append_only_mutation();
create trigger claim_dependencies_append_only
  before update or delete on public.claim_dependencies
  for each row execute function app.forbid_append_only_mutation();

-- -----------------------------------------------------------------------------
-- RPCs atômicas (o PostgREST não tem transação entre chamadas). Os ids de fontes e claims vêm do
-- app (as evidências e dependências se referem a eles). O registro de auditoria vem no cabeçalho e
-- vale para a empresa: uma linha no audit_log por operação, com as demais tabelas em `covers`.
--   create_company   table 'companies', covers company_identifiers, sources, claims, claim_evidence
--   record_evidence  table 'companies', covers sources, claims, claim_evidence, claim_dependencies
-- -----------------------------------------------------------------------------

create function app.insert_evidence(
  p_sources jsonb,
  p_claims jsonb,
  p_evidence jsonb,
  p_dependencies jsonb,
  p_supersede uuid[]
) returns integer
  language plpgsql
  set search_path = ''
as $$
declare
  superseded integer;
begin
  insert into public.sources (
    id, kind, url, provider, external_ref, captured_at, content_hash, storage_path, mime,
    http_status, title, excerpt_text, license_note, retention_until, is_demo
  )
  select r.id, r.kind, r.url, r.provider, r.external_ref, r.captured_at, r.content_hash,
    r.storage_path, r.mime, r.http_status, r.title, r.excerpt_text, r.license_note,
    r.retention_until, coalesce(r.is_demo, false)
  from jsonb_populate_recordset(null::public.sources, coalesce(p_sources, '[]')) as r;

  insert into public.claims (
    id, subject_type, subject_id, domain, key, statement, value, epistemic_type, confidence,
    status, valid_until, reasoning, reasoning_factor, produced_by_run_id, prompt_version_id,
    supersedes_id, is_demo
  )
  select r.id, r.subject_type, r.subject_id, r.domain, r.key, r.statement, r.value,
    r.epistemic_type, r.confidence, r.status, r.valid_until, r.reasoning, r.reasoning_factor,
    r.produced_by_run_id, r.prompt_version_id, r.supersedes_id, coalesce(r.is_demo, false)
  from jsonb_populate_recordset(null::public.claims, coalesce(p_claims, '[]')) as r;

  insert into public.claim_evidence (
    claim_id, source_id, quote, locator, stance, reliability_tier, quote_verified
  )
  select r.claim_id, r.source_id, r.quote, r.locator, coalesce(r.stance, 'supports'),
    r.reliability_tier, r.quote_verified
  from jsonb_populate_recordset(null::public.claim_evidence, coalesce(p_evidence, '[]')) as r;

  insert into public.claim_dependencies (claim_id, depends_on_claim_id)
  select r.claim_id, r.depends_on_claim_id
  from jsonb_populate_recordset(null::public.claim_dependencies, coalesce(p_dependencies, '[]'))
    as r;

  -- Nova versão: os claims substituídos saem de cena na mesma transação. Se algum já tinha sido
  -- substituído (duas atualizações ao mesmo tempo), nada é gravado.
  if coalesce(array_length(p_supersede, 1), 0) > 0 then
    update public.claims set status = 'superseded'
    where id = any (p_supersede) and status in ('active', 'stale', 'disputed');
    get diagnostics superseded = row_count;
    if superseded <> array_length(p_supersede, 1) then
      raise exception 'concurrent_change' using errcode = '40001';
    end if;
  end if;
  return jsonb_array_length(coalesce(p_claims, '[]'));
end;
$$;

create function public.create_company(
  p_company jsonb,
  p_identifiers jsonb,
  p_sources jsonb,
  p_claims jsonb,
  p_evidence jsonb
) returns uuid
  language plpgsql
  set search_path = ''
as $$
declare
  new_id uuid;
begin
  begin
    insert into public.companies (
      id, display_name, legal_name, cnpj, primary_domain, city, uf, cnae_main, size_band, origin,
      last_investigated_at, is_demo
    )
    select coalesce(r.id, gen_random_uuid()), r.display_name, r.legal_name, r.cnpj,
      r.primary_domain, r.city, r.uf, r.cnae_main, r.size_band, r.origin,
      r.last_investigated_at, coalesce(r.is_demo, false)
    from jsonb_populate_record(null::public.companies, p_company) as r
    returning id into new_id;

    insert into public.company_identifiers (company_id, kind, value_normalized, strength, verified)
    select new_id, r.kind, r.value_normalized, r.strength, coalesce(r.verified, false)
    from jsonb_populate_recordset(null::public.company_identifiers, coalesce(p_identifiers, '[]'))
      as r;
  exception when unique_violation then
    -- CNPJ ou domínio já cadastrado (o serviço confere antes; isto cobre a corrida).
    raise exception 'company_duplicate' using errcode = '23505';
  end;

  perform app.insert_evidence(p_sources, p_claims, p_evidence, '[]', null);
  return new_id;
end;
$$;

create function public.record_evidence(
  p_company_id uuid,
  p_company_patch jsonb,
  p_sources jsonb,
  p_claims jsonb,
  p_evidence jsonb,
  p_dependencies jsonb,
  p_supersede uuid[]
) returns void
  language plpgsql
  set search_path = ''
as $$
declare
  patch jsonb := coalesce(p_company_patch, '{}');
begin
  -- Fonte sem claim não é registrada sozinha.
  if jsonb_array_length(coalesce(p_claims, '[]')) = 0 then
    raise exception 'invalid_input' using errcode = '22023';
  end if;

  -- A projeção da empresa acompanha os claims novos; é este update que grava a auditoria.
  update public.companies c set
    legal_name = case when patch ? 'legal_name' then patch ->> 'legal_name' else c.legal_name end,
    city = case when patch ? 'city' then patch ->> 'city' else c.city end,
    uf = case when patch ? 'uf' then patch ->> 'uf' else c.uf end,
    cnae_main = case when patch ? 'cnae_main' then patch ->> 'cnae_main' else c.cnae_main end,
    size_band = case when patch ? 'size_band' then patch ->> 'size_band' else c.size_band end,
    last_investigated_at = case
      when patch ? 'last_investigated_at' then (patch ->> 'last_investigated_at')::timestamptz
      else c.last_investigated_at
    end
  where c.id = p_company_id;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  perform app.insert_evidence(p_sources, p_claims, p_evidence, p_dependencies, p_supersede);
end;
$$;

-- -----------------------------------------------------------------------------
-- Acesso: só o servidor do app (ADR-0007)
-- -----------------------------------------------------------------------------

alter table public.companies enable row level security;
alter table public.company_identifiers enable row level security;
alter table public.sources enable row level security;
alter table public.claims enable row level security;
alter table public.claim_evidence enable row level security;
alter table public.claim_dependencies enable row level security;

revoke all on
  public.companies, public.company_identifiers, public.sources, public.claims,
  public.claim_evidence, public.claim_dependencies
  from anon, authenticated, service_role;

grant select, insert on
  public.companies, public.company_identifiers, public.sources, public.claims,
  public.claim_evidence, public.claim_dependencies
  to service_role;
-- Empresa: dados de projeção e ciclo de vida; nunca CNPJ, origem nem is_demo.
grant update (
  display_name, legal_name, primary_domain, city, uf, cnae_main, size_band, lifecycle,
  last_investigated_at
) on public.companies to service_role;
-- Claim: só estado e revisão.
grant update (status, reviewed_at) on public.claims to service_role;

revoke execute on function
  public.create_company(jsonb, jsonb, jsonb, jsonb, jsonb),
  public.record_evidence(uuid, jsonb, jsonb, jsonb, jsonb, jsonb, uuid[])
  from public, anon, authenticated;
grant execute on function
  public.create_company(jsonb, jsonb, jsonb, jsonb, jsonb),
  public.record_evidence(uuid, jsonb, jsonb, jsonb, jsonb, jsonb, uuid[])
  to service_role;

revoke execute on all functions in schema app from public, anon, authenticated;
-- As RPCs rodam com o papel de quem chama (service_role), que precisa executar o auxiliar.
grant execute on function app.insert_evidence(jsonb, jsonb, jsonb, jsonb, uuid[]) to service_role;
