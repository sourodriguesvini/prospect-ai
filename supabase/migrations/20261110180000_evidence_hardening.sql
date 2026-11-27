-- =============================================================================
-- M2 — Endurecimento do Evidence Ledger (revisões de arquitetura e segurança de 2026-11-10).
-- Só aditiva: nenhuma tabela, coluna ou dado muda; as RPCs mantêm a assinatura.
--
-- 1. claims: o conteúdo nunca muda, nem para o dono do banco (antes só o privilégio de coluna do
--    servidor barrava). Só status e reviewed_at mudam, e 'superseded' e 'rejected' são finais.
--    Truncate bloqueado nas quatro tabelas do ledger.
-- 2. RPCs: o banco confere o lote como o EvidenceService confere: claims novos são da empresa do
--    pedido e nascem em vigor; evidências e dependências só dos claims do lote; dependência só de
--    claim do lote ou da mesma empresa; a lista de substituídos sai dos próprios claims (mesma
--    empresa, mesma chave) e p_supersede, quando vem, precisa bater com ela.
-- 3. create_company: a chave conferida (CNPJ da consulta) aponta para a fonte (source_id).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Imutabilidade do conteúdo dos claims
-- -----------------------------------------------------------------------------

create function app.guard_claim_update() returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  if (to_jsonb(new) - 'status' - 'reviewed_at')
    is distinct from (to_jsonb(old) - 'status' - 'reviewed_at') then
    raise exception 'append_only' using errcode = '42501';
  end if;
  if old.status in ('superseded', 'rejected') and new.status is distinct from old.status then
    raise exception 'claim_final_status' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger claims_guard_update
  before update on public.claims
  for each row execute function app.guard_claim_update();

create trigger sources_no_truncate
  before truncate on public.sources
  for each statement execute function app.forbid_append_only_mutation();
create trigger claims_no_truncate
  before truncate on public.claims
  for each statement execute function app.forbid_append_only_mutation();
create trigger claim_evidence_no_truncate
  before truncate on public.claim_evidence
  for each statement execute function app.forbid_append_only_mutation();
create trigger claim_dependencies_no_truncate
  before truncate on public.claim_dependencies
  for each statement execute function app.forbid_append_only_mutation();

-- -----------------------------------------------------------------------------
-- 2. Lote conferido no banco
-- -----------------------------------------------------------------------------

create function app.insert_evidence_checked(
  p_company_id uuid,
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
  claims_in jsonb := coalesce(p_claims, '[]');
  evidence_in jsonb := coalesce(p_evidence, '[]');
  dependencies_in jsonb := coalesce(p_dependencies, '[]');
  derived uuid[];
  replacing integer;
  superseded integer;
begin
  -- Claims novos: desta empresa, em vigor.
  if exists (
    select 1 from jsonb_populate_recordset(null::public.claims, claims_in) as r
    where r.subject_type is distinct from 'company'
      or r.subject_id is distinct from p_company_id
      or coalesce(r.status, '') not in ('active', 'stale', 'disputed')
  ) then
    raise exception 'invalid_input' using errcode = '22023';
  end if;

  -- Evidência só de claim do lote.
  if exists (
    select 1 from jsonb_populate_recordset(null::public.claim_evidence, evidence_in) as e
    where not exists (
      select 1 from jsonb_array_elements(claims_in) as c where (c ->> 'id')::uuid = e.claim_id
    )
  ) then
    raise exception 'invalid_input' using errcode = '22023';
  end if;

  -- Dependência: de claim do lote, para claim do lote ou já gravado da mesma empresa.
  if exists (
    select 1 from jsonb_populate_recordset(null::public.claim_dependencies, dependencies_in) as d
    where not exists (
        select 1 from jsonb_array_elements(claims_in) as c where (c ->> 'id')::uuid = d.claim_id
      )
      or not (
        exists (
          select 1 from jsonb_array_elements(claims_in) as c
          where (c ->> 'id')::uuid = d.depends_on_claim_id
        )
        or exists (
          select 1 from public.claims as x
          where x.id = d.depends_on_claim_id
            and x.subject_type = 'company'
            and x.subject_id = p_company_id
        )
      )
  ) then
    raise exception 'invalid_input' using errcode = '22023';
  end if;

  -- Substituição: sai dos próprios claims; mesmo claim antigo uma vez só; mesma empresa e chave.
  select coalesce(array_agg(distinct r.supersedes_id), '{}'), count(r.supersedes_id)
  into derived, replacing
  from jsonb_populate_recordset(null::public.claims, claims_in) as r
  where r.supersedes_id is not null;
  if replacing <> coalesce(array_length(derived, 1), 0) then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  if coalesce(array_length(p_supersede, 1), 0) > 0
    and not (p_supersede @> derived and derived @> p_supersede) then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_populate_recordset(null::public.claims, claims_in) as n
    left join public.claims as o on o.id = n.supersedes_id
    where n.supersedes_id is not null
      and (
        o.id is null
        or o.subject_type <> 'company'
        or o.subject_id <> p_company_id
        or o.key <> n.key
      )
  ) then
    raise exception 'invalid_input' using errcode = '22023';
  end if;

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
  from jsonb_populate_recordset(null::public.claims, claims_in) as r;

  insert into public.claim_evidence (
    claim_id, source_id, quote, locator, stance, reliability_tier, quote_verified
  )
  select r.claim_id, r.source_id, r.quote, r.locator, coalesce(r.stance, 'supports'),
    r.reliability_tier, r.quote_verified
  from jsonb_populate_recordset(null::public.claim_evidence, evidence_in) as r;

  insert into public.claim_dependencies (claim_id, depends_on_claim_id)
  select r.claim_id, r.depends_on_claim_id
  from jsonb_populate_recordset(null::public.claim_dependencies, dependencies_in) as r;

  -- Nova versão: os substituídos saem de cena na mesma transação. Se algum já tinha saído (duas
  -- atualizações ao mesmo tempo), nada é gravado.
  if coalesce(array_length(derived, 1), 0) > 0 then
    update public.claims set status = 'superseded'
    where id = any (derived) and status in ('active', 'stale', 'disputed');
    get diagnostics superseded = row_count;
    if superseded <> array_length(derived, 1) then
      raise exception 'concurrent_change' using errcode = '40001';
    end if;
  end if;
  return jsonb_array_length(claims_in);
end;
$$;

create or replace function public.create_company(
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
  registry_source uuid;
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
  exception when unique_violation then
    -- CNPJ ou domínio já cadastrado (o serviço confere antes; isto cobre a corrida).
    raise exception 'company_duplicate' using errcode = '23505';
  end;

  perform app.insert_evidence_checked(new_id, p_sources, p_claims, p_evidence, '[]', null);

  -- Chave conferida aponta para a fonte da consulta que a conferiu.
  select r.id into registry_source
  from jsonb_populate_recordset(null::public.sources, coalesce(p_sources, '[]')) as r
  where r.kind = 'api_record'
  limit 1;

  begin
    insert into public.company_identifiers (
      company_id, kind, value_normalized, strength, verified, source_id
    )
    select new_id, r.kind, r.value_normalized, r.strength, coalesce(r.verified, false),
      case when coalesce(r.verified, false) then registry_source end
    from jsonb_populate_recordset(null::public.company_identifiers, coalesce(p_identifiers, '[]'))
      as r;
  exception when unique_violation then
    raise exception 'company_duplicate' using errcode = '23505';
  end;
  return new_id;
end;
$$;

create or replace function public.record_evidence(
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

  perform app.insert_evidence_checked(
    p_company_id, p_sources, p_claims, p_evidence, p_dependencies, p_supersede
  );
end;
$$;

-- O auxiliar antigo fica sem uso e sem privilégio (as RPCs usam o conferido).
revoke execute on function app.insert_evidence(jsonb, jsonb, jsonb, jsonb, uuid[])
  from service_role;
revoke execute on function
  app.insert_evidence_checked(uuid, jsonb, jsonb, jsonb, jsonb, uuid[]),
  app.guard_claim_update()
  from public, anon, authenticated;
grant execute on function app.insert_evidence_checked(uuid, jsonb, jsonb, jsonb, jsonb, uuid[])
  to service_role;
