-- =============================================================================
-- Auditoria: cabeçalho estrito (revisões de segurança e arquitetura de 2026-11-10, KI-041)
--
-- A versão anterior de `app.audit_write` ignorava a escrita (sem registrar e sem erro) quando o
-- registro não dizia a tabela, ou dizia outra: `{}` no cabeçalho deixava a escrita passar sem
-- auditoria. Agora:
--   * `table` é obrigatório. Se não for a tabela da linha, ela só pode estar em `covers`, a lista
--     explícita das outras tabelas que o mesmo pedido grava (ex.: a RPC `create_offer` registra
--     em `offers` e cobre `offer_versions`). Fora disso, `audit_invalid`.
--   * Registro que o `audit_log` recusa (ator, ação, traceId fora do formato) também vira
--     `audit_invalid`, com código P0001: é defeito do servidor, não erro de digitação, e a
--     aplicação o trata como erro inesperado (antes aparecia como "Revise os campos").
--
-- Só troca o corpo da função (os triggers continuam os mesmos); nenhum dado é alterado.
-- =============================================================================

create or replace function app.audit_write() returns trigger
  language plpgsql
  set search_path = ''
as $$
declare
  headers jsonb := nullif(current_setting('request.headers', true), '')::jsonb;
  encoded text;
  entry jsonb;
  covers jsonb;
  row_data jsonb := to_jsonb(new);
  entry_diff jsonb;
begin
  -- SQL direto (migrações, manutenção): não passa pelo PostgREST e não é auditado aqui.
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
    raise exception 'audit_invalid' using errcode = 'P0001';
  end;
  if jsonb_typeof(entry) is distinct from 'object'
    or jsonb_typeof(entry -> 'table') is distinct from 'string' then
    raise exception 'audit_invalid' using errcode = 'P0001';
  end if;

  if entry ->> 'table' <> tg_table_name then
    covers := coalesce(entry -> 'covers', '[]'::jsonb);
    if jsonb_typeof(covers) = 'array' and covers ? tg_table_name then
      return null;
    end if;
    raise exception 'audit_invalid' using errcode = 'P0001';
  end if;

  entry_diff := coalesce(entry -> 'diff', '{}'::jsonb);
  if jsonb_typeof(entry_diff) is distinct from 'object'
    or jsonb_typeof(coalesce(entry -> 'withVersion', 'false'::jsonb)) is distinct from 'boolean' then
    raise exception 'audit_invalid' using errcode = 'P0001';
  end if;
  if (entry -> 'withVersion')::boolean and row_data ? 'version' then
    entry_diff := entry_diff || jsonb_build_object('version', row_data -> 'version');
  end if;

  begin
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
  exception when check_violation or not_null_violation or invalid_text_representation
    or string_data_right_truncation then
    raise exception 'audit_invalid' using errcode = 'P0001';
  end;
  return null;
end;
$$;

comment on function app.audit_write() is
  'Grava no audit_log, na mesma transação, o registro que o servidor manda no cabeçalho '
  'x-prospector-audit (KI-041). Pelo PostgREST, escrita sem registro, com registro malformado '
  'ou de outra tabela (fora de covers) é recusada.';

revoke execute on function app.audit_write() from public, anon, authenticated;
