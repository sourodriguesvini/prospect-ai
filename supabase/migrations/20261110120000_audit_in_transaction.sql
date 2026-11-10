-- =============================================================================
-- Auditoria na mesma transação da escrita (KI-041)
--
-- Antes, o app gravava a versão e, numa segunda chamada, o `audit_log`: se a segunda falhasse,
-- a versão (ou a decisão da LIA) ficava salva sem registro. Agora o servidor manda o registro
-- junto da escrita, no cabeçalho `x-prospector-audit` (JSON em base64), e o trigger AFTER
-- `app.audit_write` grava o `audit_log` na mesma transação: ou os dois ficam, ou nenhum.
--
-- Pelo PostgREST (o caminho do app), toda escrita nas tabelas da estratégia precisa do cabeçalho;
-- sem ele, a escrita é recusada (`audit_missing`). SQL direto (migrações, manutenção) não passa
-- pelo PostgREST, não tem `request.headers` e não é auditado por este trigger.
-- O registro diz em que tabela vale (`table`): numa RPC que grava cabeçalho e versão
-- (`create_offer`, `create_icp_profile`), só a tabela indicada registra.
-- Preenchimento: `entityId` nulo vira o id da linha gravada; `withVersion` acrescenta ao diff o
-- número da versão atribuído pelo banco. O registro não leva conteúdo da estratégia (KI-015).
--
-- Só aditiva: cria uma função e triggers; nenhum dado existente é alterado.
-- =============================================================================

create function app.audit_write() returns trigger
  language plpgsql
  set search_path = ''
as $$
declare
  headers jsonb := nullif(current_setting('request.headers', true), '')::jsonb;
  encoded text;
  entry jsonb;
  row_data jsonb := to_jsonb(new);
  entry_diff jsonb;
begin
  if headers is null then
    return null;
  end if;

  encoded := headers ->> 'x-prospector-audit';
  if encoded is null then
    raise exception 'audit_missing' using errcode = '42501';
  end if;

  begin
    entry := convert_from(decode(encoded, 'base64'), 'UTF8')::jsonb;
  exception when others then
    raise exception 'audit_invalid' using errcode = '22023';
  end;
  if jsonb_typeof(entry) is distinct from 'object' then
    raise exception 'audit_invalid' using errcode = '22023';
  end if;

  if entry ->> 'table' is distinct from tg_table_name then
    return null;
  end if;

  entry_diff := coalesce(entry -> 'diff', '{}'::jsonb);
  if jsonb_typeof(entry_diff) is distinct from 'object'
    or jsonb_typeof(coalesce(entry -> 'withVersion', 'false'::jsonb)) is distinct from 'boolean' then
    raise exception 'audit_invalid' using errcode = '22023';
  end if;
  if (entry -> 'withVersion')::boolean and row_data ? 'version' then
    entry_diff := entry_diff || jsonb_build_object('version', row_data -> 'version');
  end if;

  insert into public.audit_log (
    actor_type, actor_label, action, entity_type, entity_id, diff, trace_id
  ) values (
    entry ->> 'actorType',
    entry ->> 'actorLabel',
    entry ->> 'action',
    entry ->> 'entityType',
    coalesce(entry ->> 'entityId', row_data ->> 'id'),
    entry_diff,
    (entry ->> 'traceId')::uuid
  );
  return null;
end;
$$;

comment on function app.audit_write() is
  'Grava no audit_log, na mesma transação, o registro que o servidor manda no cabeçalho '
  'x-prospector-audit (KI-041). Pelo PostgREST, escrita sem o cabeçalho é recusada.';

-- Cabeçalhos: inclusão e troca de status.
create trigger offers_audit
  after insert or update on public.offers
  for each row execute function app.audit_write();
create trigger icp_profiles_audit
  after insert or update on public.icp_profiles
  for each row execute function app.audit_write();

-- Versões: só inclusão (update/delete já são recusados).
create trigger offer_versions_audit
  after insert on public.offer_versions
  for each row execute function app.audit_write();
create trigger audit_rubrics_audit
  after insert on public.audit_rubrics
  for each row execute function app.audit_write();
create trigger scoring_models_audit
  after insert on public.scoring_models
  for each row execute function app.audit_write();
create trigger icp_profile_versions_audit
  after insert on public.icp_profile_versions
  for each row execute function app.audit_write();
create trigger voice_guides_audit
  after insert on public.voice_guides
  for each row execute function app.audit_write();
create trigger contact_policies_audit
  after insert on public.contact_policies
  for each row execute function app.audit_write();

-- Cases (edição e arquivamento) e LIA (aprovação e revogação).
create trigger proof_assets_audit
  after insert or update on public.proof_assets
  for each row execute function app.audit_write();
create trigger legal_basis_assessments_audit
  after insert or update on public.legal_basis_assessments
  for each row execute function app.audit_write();

revoke execute on function app.audit_write() from public, anon, authenticated;
