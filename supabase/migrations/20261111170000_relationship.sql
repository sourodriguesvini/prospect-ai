-- =============================================================================
-- Relacionamento (ADR-0014): oportunidades, estratégia de abordagem, rascunhos versionados,
-- aprovação de uso, interações, follow-ups e supressão (opt-out). docs/06 §4.8 e §4.9, enxuto.
-- Uso local sem login (ADR-0007): sem org_id. Só aditiva: nenhum dado existente é alterado.
--
-- opportunities              o "fio" do relacionamento com uma empresa: etapa, prioridade, valor
--                            (só com base informada), próximo passo. Uma aberta por empresa.
-- opportunity_stage_changes  histórico das movimentações (só inclusão).
-- approach_plans             estratégia gerada pela IA local; conteúdo imutável, nova versão = nova
--                            linha (a mais recente vale).
-- outbound_messages          rascunhos versionados. Conteúdo imutável: editar cria nova versão na
--                            mesma linha (`thread_id`), e a versão anterior deixa de valer, junto com
--                            a aprovação dela. NADA é enviado pelo app: o envio é manual.
-- approvals                  decisão humana sobre o conteúdo exato (`payload_hash`), o canal e a
--                            validade (regra 2 do CLAUDE.md). Uso = conferido de novo no momento.
-- interactions               contato feito (só com aprovação válida), resposta recebida e nota.
-- tasks                      follow-ups e demais lembretes.
-- suppression_entries        opt-out e pedidos para parar; valem para a empresa, a raiz do CNPJ e o
--                            domínio, e cancelam os follow-ups abertos.
--
-- Toda escrita pelo PostgREST é auditada na mesma transação (ADR-0010). Escritas de várias tabelas
-- passam por RPCs atômicas, com uma linha de auditoria por operação.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Utilitário: só as colunas listadas em tg_argv podem mudar num update
-- -----------------------------------------------------------------------------

create function app.guard_mutable_columns() returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  if (to_jsonb(new) - tg_argv) is distinct from (to_jsonb(old) - tg_argv) then
    raise exception 'append_only' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- Decisão final: a linha só muda enquanto está na situação tg_argv[0] (rascunho, aprovada).
-- Descartada, aprovada (mensagem) e revogada são finais.
create function app.guard_final_status() returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  if old.status::text <> tg_argv[0] then
    raise exception 'append_only' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- Oportunidades
-- -----------------------------------------------------------------------------

create table public.opportunities (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id),
  offer_id uuid references public.offers (id),
  stage text not null check (
    stage in (
      'identified', 'qualified', 'approach_ready', 'contacted', 'in_conversation', 'meeting',
      'proposal', 'negotiation', 'won', 'lost'
    )
  ),
  priority text not null default 'medium' check (priority in ('high', 'medium', 'low')),
  value_estimate_cents bigint check (
    value_estimate_cents is null or value_estimate_cents between 0 and 10000000000
  ),
  value_basis text check (value_basis is null or char_length(btrim(value_basis)) between 1 and 300),
  next_action text check (next_action is null or char_length(btrim(next_action)) between 1 and 300),
  next_action_due_at timestamptz,
  lost_reason text check (lost_reason is null or char_length(btrim(lost_reason)) between 1 and 300),
  source text not null check (source in ('company', 'discovery', 'copilot')),
  closed_at timestamptz,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Valor só com a base que o justifica (nunca inventado).
  check ((value_estimate_cents is null) = (value_basis is null)),
  check ((stage in ('won', 'lost')) = (closed_at is not null))
);
comment on table public.opportunities is
  'Oportunidade comercial com uma empresa (Relacionamento, ADR-0014). Uma aberta por empresa.';

create unique index opportunities_open_company_key on public.opportunities (company_id)
  where closed_at is null;
create index opportunities_stage_idx on public.opportunities (stage, updated_at desc);
create index opportunities_company_idx on public.opportunities (company_id, created_at desc);

create trigger opportunities_updated_at
  before update on public.opportunities
  for each row execute function app.set_updated_at();
create trigger opportunities_audit
  after insert or update on public.opportunities
  for each row execute function app.audit_write();
-- Empresa, origem, criação e marca de demonstração não mudam.
create trigger opportunities_guard_update
  before update on public.opportunities
  for each row execute function app.guard_mutable_columns(
    'offer_id', 'stage', 'priority', 'value_estimate_cents', 'value_basis', 'next_action',
    'next_action_due_at', 'lost_reason', 'closed_at', 'updated_at'
  );

create table public.opportunity_stage_changes (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references public.opportunities (id),
  from_stage text check (
    from_stage is null or from_stage in (
      'identified', 'qualified', 'approach_ready', 'contacted', 'in_conversation', 'meeting',
      'proposal', 'negotiation', 'won', 'lost'
    )
  ),
  to_stage text not null check (
    to_stage in (
      'identified', 'qualified', 'approach_ready', 'contacted', 'in_conversation', 'meeting',
      'proposal', 'negotiation', 'won', 'lost'
    )
  ),
  note text check (note is null or char_length(btrim(note)) between 1 and 300),
  created_at timestamptz not null default now(),
  check (from_stage is distinct from to_stage)
);
comment on table public.opportunity_stage_changes is
  'Movimentações da oportunidade entre etapas (só inclusão; a auditoria guarda quem e quando).';
create index opportunity_stage_changes_idx
  on public.opportunity_stage_changes (opportunity_id, created_at);

create trigger opportunity_stage_changes_audit
  after insert on public.opportunity_stage_changes
  for each row execute function app.audit_write();
create trigger opportunity_stage_changes_append_only
  before update or delete on public.opportunity_stage_changes
  for each row execute function app.forbid_append_only_mutation();

-- -----------------------------------------------------------------------------
-- Supressão (opt-out)
-- -----------------------------------------------------------------------------

create table public.suppression_entries (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id),
  -- Copiados da empresa no momento: a supressão vale mesmo se ela for cadastrada de novo.
  cnpj_root text check (cnpj_root is null or cnpj_root ~ '^[0-9A-Z]{8}$'),
  domain text check (domain is null or char_length(domain) <= 253),
  reason text not null check (reason in ('opt_out', 'refused', 'legal_request', 'manual')),
  source text not null check (source in ('reply_rule', 'reply_ai', 'user')),
  interaction_id uuid,
  lifted_at timestamptz,
  lift_reason text check (lift_reason is null or char_length(btrim(lift_reason)) between 10 and 300),
  created_at timestamptz not null default now(),
  check ((lifted_at is null) = (lift_reason is null))
);
comment on table public.suppression_entries is
  'Opt-out e pedidos para parar o contato (regra 7). Valem para a empresa, a raiz do CNPJ e o '
  'domínio. Só o levantamento (com motivo) muda a linha, uma vez.';
create index suppression_entries_company_idx on public.suppression_entries (company_id)
  where lifted_at is null;
create index suppression_entries_cnpj_root_idx on public.suppression_entries (cnpj_root)
  where lifted_at is null and cnpj_root is not null;
create index suppression_entries_domain_idx on public.suppression_entries (domain)
  where lifted_at is null and domain is not null;

create trigger suppression_entries_audit
  after insert or update on public.suppression_entries
  for each row execute function app.audit_write();
create trigger suppression_entries_guard_update
  before update on public.suppression_entries
  for each row execute function app.guard_mutable_columns('lifted_at', 'lift_reason');

-- Retirada uma vez só, com motivo; pedido de titular (LGPD) não é retirado pelo app.
create function app.guard_suppression_update() returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  if old.lifted_at is not null or new.lifted_at is null then
    raise exception 'append_only' using errcode = '42501';
  end if;
  if old.reason = 'legal_request' then
    raise exception 'suppression_locked' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger suppression_entries_guard_final
  before update on public.suppression_entries
  for each row execute function app.guard_suppression_update();
create trigger suppression_entries_no_delete
  before delete on public.suppression_entries
  for each row execute function app.forbid_append_only_mutation();

-- Empresa suprimida: pela própria empresa, pela raiz do CNPJ ou pelo domínio.
create function app.company_suppressed(p_company_id uuid) returns boolean
  language sql
  stable
  set search_path = ''
as $$
  select exists (
    select 1
    from public.companies c
    join public.suppression_entries s
      on s.lifted_at is null
      and (
        s.company_id = c.id
        or (s.cnpj_root is not null and s.cnpj_root = c.cnpj_root)
        or (s.domain is not null and s.domain = c.primary_domain)
      )
    where c.id = p_company_id
  );
$$;

-- -----------------------------------------------------------------------------
-- Interações (criada antes das mensagens; as chaves cruzadas entram depois)
-- -----------------------------------------------------------------------------

create table public.interactions (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references public.opportunities (id),
  company_id uuid not null references public.companies (id),
  direction text not null check (direction in ('outbound', 'inbound', 'note')),
  channel text not null check (
    channel in ('email', 'linkedin_manual', 'phone', 'in_person', 'whatsapp_optin', 'other')
  ),
  occurred_at timestamptz not null,
  summary text check (summary is null or char_length(btrim(summary)) between 1 and 500),
  body text check (body is null or char_length(btrim(body)) between 1 and 8000),
  message_id uuid,
  approval_id uuid,
  counterpart_role text check (
    counterpart_role is null or char_length(btrim(counterpart_role)) between 1 and 120
  ),
  analysis jsonb check (
    analysis is null or (jsonb_typeof(analysis) = 'object' and pg_column_size(analysis) <= 16384)
  ),
  analysis_prompt_id text check (analysis_prompt_id is null or char_length(analysis_prompt_id) <= 80),
  analysis_model text check (analysis_model is null or char_length(analysis_model) <= 120),
  analyzed_at timestamptz,
  retention_until timestamptz not null,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  -- Contato feito só com a mensagem aprovada; resposta recebida sempre com o texto.
  check (direction <> 'outbound' or (message_id is not null and approval_id is not null)),
  check (direction = 'outbound' or (message_id is null and approval_id is null)),
  check (direction <> 'inbound' or body is not null),
  check (direction <> 'note' or summary is not null),
  check ((analysis is null) = (analyzed_at is null)),
  check (retention_until > created_at)
);
comment on table public.interactions is
  'Contato feito (manual, com aprovação válida), resposta recebida e nota. Só a interpretação da '
  'IA pode ser gravada depois. O texto recebido tem prazo de guarda (retention_until).';
create index interactions_opportunity_idx on public.interactions (opportunity_id, occurred_at desc);
-- Uma aprovação vale para um contato feito só (record_interaction confere; o índice fecha a corrida).
create unique index interactions_outbound_approval_key on public.interactions (approval_id)
  where direction = 'outbound';
create index interactions_company_idx on public.interactions (company_id, occurred_at desc);

create trigger interactions_audit
  after insert or update on public.interactions
  for each row execute function app.audit_write();
create trigger interactions_guard_update
  before update on public.interactions
  for each row execute function app.guard_mutable_columns(
    'analysis', 'analysis_prompt_id', 'analysis_model', 'analyzed_at'
  );
create trigger interactions_no_delete
  before delete on public.interactions
  for each row execute function app.forbid_append_only_mutation();

alter table public.suppression_entries
  add constraint suppression_entries_interaction_fkey
  foreign key (interaction_id) references public.interactions (id);

-- -----------------------------------------------------------------------------
-- Estratégia de abordagem
-- -----------------------------------------------------------------------------

create table public.approach_plans (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references public.opportunities (id),
  company_id uuid not null references public.companies (id),
  offer_id uuid not null references public.offers (id),
  offer_version_id uuid not null references public.offer_versions (id),
  version integer not null,
  status text not null default 'draft' check (status in ('draft', 'approved', 'discarded')),
  basis text not null check (basis in ('sufficient', 'limited')),
  content jsonb not null check (
    jsonb_typeof(content) = 'object' and pg_column_size(content) <= 16384
  ),
  claim_ids uuid[] not null default '{}' check (cardinality(claim_ids) <= 60),
  prompt_id text check (prompt_id is null or char_length(prompt_id) <= 80),
  model text check (model is null or char_length(model) <= 120),
  decided_at timestamptz,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  unique (opportunity_id, version),
  check ((status = 'draft') = (decided_at is null))
);
comment on table public.approach_plans is
  'Estratégia de abordagem (IA local). Conteúdo imutável; outra versão = nova linha. Só a situação '
  'muda, e descartada é final.';

create trigger approach_plans_assign_version
  before insert on public.approach_plans
  for each row execute function app.assign_version('opportunity_id');
create trigger approach_plans_audit
  after insert or update on public.approach_plans
  for each row execute function app.audit_write();
create trigger approach_plans_guard_update
  before update on public.approach_plans
  for each row execute function app.guard_mutable_columns('status', 'decided_at');
create trigger approach_plans_guard_final
  before update on public.approach_plans
  for each row execute function app.guard_final_status('draft');
create trigger approach_plans_no_delete
  before delete on public.approach_plans
  for each row execute function app.forbid_append_only_mutation();

-- -----------------------------------------------------------------------------
-- Mensagens (rascunhos) e aprovações
-- -----------------------------------------------------------------------------

create table public.outbound_messages (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references public.opportunities (id),
  plan_id uuid references public.approach_plans (id),
  reply_to_interaction_id uuid references public.interactions (id),
  kind text not null check (
    kind in (
      'initial_email', 'short_message', 'presentation', 'meeting_invite', 'follow_up',
      'objection_reply', 'reengagement', 'reply'
    )
  ),
  channel text not null check (
    channel in ('email', 'linkedin_manual', 'phone', 'in_person', 'whatsapp_optin', 'other')
  ),
  tone text check (tone is null or tone in ('consultative', 'direct', 'warm', 'formal')),
  subject text check (subject is null or char_length(btrim(subject)) between 1 and 200),
  body text not null check (char_length(btrim(body)) between 1 and 6000),
  thread_id uuid not null,
  version integer not null,
  origin text not null check (origin in ('ai', 'user', 'copilot')),
  status text not null default 'draft' check (status in ('draft', 'approved', 'discarded')),
  payload_hash text not null check (payload_hash ~ '^[a-f0-9]{64}$'),
  approval_id uuid,
  claim_ids uuid[] not null default '{}' check (cardinality(claim_ids) <= 60),
  prompt_id text check (prompt_id is null or char_length(prompt_id) <= 80),
  model text check (model is null or char_length(model) <= 120),
  decided_at timestamptz,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  unique (thread_id, version),
  check ((status = 'approved') = (approval_id is not null)),
  check ((status = 'draft') = (decided_at is null))
);
comment on table public.outbound_messages is
  'Rascunhos versionados (nada é enviado pelo app). Conteúdo imutável; a versão mais recente da '
  'linha (thread_id) é a que vale, e a aprovação de uma versão anterior deixa de valer.';
create index outbound_messages_opportunity_idx
  on public.outbound_messages (opportunity_id, created_at desc);

create trigger outbound_messages_assign_version
  before insert on public.outbound_messages
  for each row execute function app.assign_version('thread_id');
create trigger outbound_messages_audit
  after insert or update on public.outbound_messages
  for each row execute function app.audit_write();
create trigger outbound_messages_guard_update
  before update on public.outbound_messages
  for each row execute function app.guard_mutable_columns('status', 'approval_id', 'decided_at');
create trigger outbound_messages_guard_final
  before update on public.outbound_messages
  for each row execute function app.guard_final_status('draft');
create trigger outbound_messages_no_delete
  before delete on public.outbound_messages
  for each row execute function app.forbid_append_only_mutation();

create table public.approvals (
  id uuid primary key default gen_random_uuid(),
  action_type text not null check (action_type = 'message.use'),
  entity_type text not null check (entity_type = 'outbound_message'),
  entity_id uuid not null references public.outbound_messages (id),
  opportunity_id uuid not null references public.opportunities (id),
  payload_hash text not null check (payload_hash ~ '^[a-f0-9]{64}$'),
  channel text not null check (
    channel in ('email', 'linkedin_manual', 'phone', 'in_person', 'whatsapp_optin', 'other')
  ),
  status text not null default 'approved' check (status in ('approved', 'revoked')),
  -- Versões que a barreira de abordagem conferiu (oferta, LIA, política de contato, voz).
  clearance jsonb not null check (
    jsonb_typeof(clearance) = 'object' and pg_column_size(clearance) <= 2048
  ),
  decided_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  revoke_reason text check (revoke_reason is null or char_length(btrim(revoke_reason)) between 3 and 300),
  created_at timestamptz not null default now(),
  -- 72 horas (docs/12 §2), com folga para a diferença de relógio entre o app e o banco.
  check (expires_at > decided_at and expires_at <= decided_at + interval '3 days 1 hour'),
  check ((status = 'revoked') = (revoked_at is not null))
);
comment on table public.approvals is
  'Aprovação de uso de uma mensagem (regra 2): conteúdo exato (payload_hash), canal e validade. '
  'Não envia nada; o uso é conferido de novo (versão, hash, supressão, conformidade).';
create index approvals_entity_idx on public.approvals (entity_id);
create index approvals_opportunity_idx on public.approvals (opportunity_id, decided_at desc);

create trigger approvals_audit
  after insert or update on public.approvals
  for each row execute function app.audit_write();
create trigger approvals_guard_update
  before update on public.approvals
  for each row execute function app.guard_mutable_columns('status', 'revoked_at', 'revoke_reason');
create trigger approvals_guard_final
  before update on public.approvals
  for each row execute function app.guard_final_status('approved');
create trigger approvals_no_delete
  before delete on public.approvals
  for each row execute function app.forbid_append_only_mutation();

alter table public.outbound_messages
  add constraint outbound_messages_approval_fkey
  foreign key (approval_id) references public.approvals (id);
alter table public.interactions
  add constraint interactions_message_fkey
  foreign key (message_id) references public.outbound_messages (id);
alter table public.interactions
  add constraint interactions_approval_fkey
  foreign key (approval_id) references public.approvals (id);

-- -----------------------------------------------------------------------------
-- Follow-ups
-- -----------------------------------------------------------------------------

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references public.opportunities (id),
  company_id uuid not null references public.companies (id),
  kind text not null check (kind in ('follow_up', 'meeting', 'proposal', 'research', 'other')),
  title text not null check (char_length(btrim(title)) between 3 and 200),
  notes text check (notes is null or char_length(btrim(notes)) between 1 and 1000),
  due_at timestamptz not null,
  status text not null default 'open' check (status in ('open', 'done', 'cancelled')),
  origin text not null check (origin in ('user', 'suggested', 'copilot')),
  completed_at timestamptz,
  cancel_reason text check (
    cancel_reason is null or cancel_reason in ('opt_out', 'user', 'opportunity_closed')
  ),
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'open') = (completed_at is null)),
  check ((status = 'cancelled') = (cancel_reason is not null))
);
comment on table public.tasks is
  'Follow-ups e lembretes. Concluído ou cancelado é final; opt-out cancela os abertos da empresa.';
create index tasks_open_idx on public.tasks (due_at) where status = 'open';
create index tasks_opportunity_idx on public.tasks (opportunity_id, due_at);
create index tasks_company_open_idx on public.tasks (company_id) where status = 'open';

create function app.guard_task_update() returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  if old.status <> 'open' then
    raise exception 'append_only' using errcode = '42501';
  end if;
  if (to_jsonb(new) - array['status', 'completed_at', 'cancel_reason', 'due_at', 'title', 'notes', 'updated_at'])
    is distinct from
    (to_jsonb(old) - array['status', 'completed_at', 'cancel_reason', 'due_at', 'title', 'notes', 'updated_at']) then
    raise exception 'append_only' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger tasks_updated_at
  before update on public.tasks
  for each row execute function app.set_updated_at();
create trigger tasks_guard_update
  before update on public.tasks
  for each row execute function app.guard_task_update();
create trigger tasks_audit
  after insert or update on public.tasks
  for each row execute function app.audit_write();
create trigger tasks_no_delete
  before delete on public.tasks
  for each row execute function app.forbid_append_only_mutation();

-- Nada some por truncate.
create trigger opportunities_no_truncate before truncate on public.opportunities
  for each statement execute function app.forbid_append_only_mutation();
create trigger opportunity_stage_changes_no_truncate before truncate on public.opportunity_stage_changes
  for each statement execute function app.forbid_append_only_mutation();
create trigger suppression_entries_no_truncate before truncate on public.suppression_entries
  for each statement execute function app.forbid_append_only_mutation();
create trigger interactions_no_truncate before truncate on public.interactions
  for each statement execute function app.forbid_append_only_mutation();
create trigger approach_plans_no_truncate before truncate on public.approach_plans
  for each statement execute function app.forbid_append_only_mutation();
create trigger outbound_messages_no_truncate before truncate on public.outbound_messages
  for each statement execute function app.forbid_append_only_mutation();
create trigger approvals_no_truncate before truncate on public.approvals
  for each statement execute function app.forbid_append_only_mutation();
create trigger tasks_no_truncate before truncate on public.tasks
  for each statement execute function app.forbid_append_only_mutation();

-- -----------------------------------------------------------------------------
-- Resumo para a lista, o kanban e a central (security_invoker: respeita o RLS de quem lê)
-- -----------------------------------------------------------------------------

create view public.opportunity_summaries
  with (security_invoker = on)
as
select
  o.id, o.company_id, o.offer_id, o.stage, o.priority, o.value_estimate_cents, o.value_basis,
  o.next_action, o.next_action_due_at, o.lost_reason, o.source, o.closed_at, o.is_demo,
  o.created_at, o.updated_at,
  c.display_name as company_name,
  c.is_demo as company_is_demo,
  i.last_interaction_at, i.last_inbound_at, i.last_outbound_at,
  coalesce(t.open_tasks, 0)::integer as open_tasks,
  t.next_task_due_at,
  app.company_suppressed(o.company_id) as suppressed
from public.opportunities o
join public.companies c on c.id = o.company_id
left join lateral (
  select
    max(x.occurred_at) filter (where x.direction in ('outbound', 'inbound')) as last_interaction_at,
    max(x.occurred_at) filter (where x.direction = 'inbound') as last_inbound_at,
    max(x.occurred_at) filter (where x.direction = 'outbound') as last_outbound_at
  from public.interactions x
  where x.opportunity_id = o.id
) i on true
left join lateral (
  select count(*) as open_tasks, min(k.due_at) as next_task_due_at
  from public.tasks k
  where k.opportunity_id = o.id and k.status = 'open'
) t on true;
comment on view public.opportunity_summaries is
  'Oportunidade com empresa, últimos contatos, follow-ups abertos e supressão (Relacionamento).';

-- Versão vigente de cada linha de mensagens (a mais recente); as anteriores valem como substituídas.
create view public.current_outbound_messages
  with (security_invoker = on)
as
select distinct on (m.thread_id) m.*
from public.outbound_messages m
order by m.thread_id, m.version desc;
comment on view public.current_outbound_messages is
  'Versão mais recente de cada mensagem (thread_id). Aprovação de versão anterior não vale.';

-- -----------------------------------------------------------------------------
-- RPCs atômicas (o PostgREST não tem transação entre chamadas). O registro de auditoria vem no
-- cabeçalho; as demais tabelas gravadas no mesmo pedido vão em `covers`.
--   open_opportunity          table 'opportunities', covers opportunity_stage_changes
--   change_opportunity_stage  table 'opportunities', covers opportunity_stage_changes
--   approve_message           table 'approvals', covers outbound_messages
--   record_interaction        table 'interactions', covers opportunities,
--                             opportunity_stage_changes, suppression_entries, tasks
--   suppress_company          table 'suppression_entries', covers tasks
-- -----------------------------------------------------------------------------

create function public.open_opportunity(p_opportunity jsonb) returns uuid
  language plpgsql
  set search_path = ''
as $$
declare
  r public.opportunities;
  new_id uuid;
begin
  r := jsonb_populate_record(null::public.opportunities, p_opportunity);
  if r.stage not in ('identified', 'qualified', 'approach_ready') then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  begin
    insert into public.opportunities (
      id, company_id, offer_id, stage, priority, source, is_demo
    ) values (
      coalesce(r.id, gen_random_uuid()), r.company_id, r.offer_id, r.stage,
      coalesce(r.priority, 'medium'), r.source, coalesce(r.is_demo, false)
    )
    returning id into new_id;
  exception when unique_violation then
    raise exception 'opportunity_open_exists' using errcode = '23505';
  end;
  insert into public.opportunity_stage_changes (opportunity_id, from_stage, to_stage)
  values (new_id, null, r.stage);
  return new_id;
end;
$$;

-- Move a oportunidade da etapa que a tela mostrava (p_from) para p_to. Se a etapa mudou nesse
-- meio-tempo, nada é gravado (concurrent_change). Encerrar preenche closed_at; reabrir limpa.
create function app.move_opportunity(
  p_id uuid,
  p_from text,
  p_to text,
  p_note text
) returns void
  language plpgsql
  set search_path = ''
as $$
begin
  if p_from is not distinct from p_to then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  begin
    update public.opportunities set
      stage = p_to,
      closed_at = case
        when p_to in ('won', 'lost') then coalesce(closed_at, now())
        else null
      end,
      lost_reason = case
        when p_to = 'lost' then coalesce(nullif(btrim(coalesce(p_note, '')), ''), lost_reason)
        else null
      end
    where id = p_id and stage = p_from;
  exception when unique_violation then
    -- Reabrir com outra oportunidade já aberta para a mesma empresa.
    raise exception 'opportunity_open_exists' using errcode = '23505';
  end;
  if not found then
    if exists (select 1 from public.opportunities where id = p_id) then
      raise exception 'concurrent_change' using errcode = '40001';
    end if;
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  insert into public.opportunity_stage_changes (opportunity_id, from_stage, to_stage, note)
  values (p_id, p_from, p_to, nullif(btrim(coalesce(p_note, '')), ''));
end;
$$;

create function public.change_opportunity_stage(
  p_id uuid,
  p_from text,
  p_to text,
  p_note text
) returns void
  language plpgsql
  set search_path = ''
as $$
begin
  perform app.move_opportunity(p_id, p_from, p_to, p_note);
end;
$$;

-- Aprovação do conteúdo exato da versão mais recente (regra 2). O banco confere de novo: rascunho,
-- mesma oportunidade, mesmo hash e canal, nenhuma versão mais nova e empresa sem supressão.
create function public.approve_message(p_approval jsonb) returns uuid
  language plpgsql
  set search_path = ''
as $$
declare
  a public.approvals;
  m public.outbound_messages;
  o public.opportunities;
  new_id uuid;
begin
  a := jsonb_populate_record(null::public.approvals, p_approval);
  select * into m from public.outbound_messages where id = a.entity_id for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  select * into o from public.opportunities where id = m.opportunity_id;
  if m.status <> 'draft'
    or m.opportunity_id <> a.opportunity_id
    or m.payload_hash <> a.payload_hash
    or m.channel <> a.channel
    or exists (
      select 1 from public.outbound_messages n
      where n.thread_id = m.thread_id and n.version > m.version
    ) then
    raise exception 'concurrent_change' using errcode = '40001';
  end if;
  if o.closed_at is not null then
    raise exception 'opportunity_closed' using errcode = 'P0001';
  end if;
  if app.company_suppressed(o.company_id) then
    raise exception 'company_suppressed' using errcode = 'P0001';
  end if;
  insert into public.approvals (
    id, action_type, entity_type, entity_id, opportunity_id, payload_hash, channel, status,
    clearance, expires_at
  ) values (
    coalesce(a.id, gen_random_uuid()), 'message.use', 'outbound_message', m.id, m.opportunity_id,
    m.payload_hash, m.channel, 'approved', a.clearance, a.expires_at
  )
  returning id into new_id;
  update public.outbound_messages
    set status = 'approved', approval_id = new_id, decided_at = now()
    where id = m.id;
  return new_id;
end;
$$;

-- Supressão + cancelamento dos follow-ups abertos da empresa (e das que dividem raiz ou domínio).
create function app.apply_suppression(p_entry jsonb, p_interaction_id uuid) returns uuid
  language plpgsql
  set search_path = ''
as $$
declare
  s public.suppression_entries;
  c public.companies;
  new_id uuid;
begin
  s := jsonb_populate_record(null::public.suppression_entries, p_entry);
  select * into c from public.companies where id = s.company_id;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  -- A interação que originou o pedido é da mesma empresa.
  if p_interaction_id is not null and not exists (
    select 1 from public.interactions i where i.id = p_interaction_id and i.company_id = c.id
  ) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  insert into public.suppression_entries (
    id, company_id, cnpj_root, domain, reason, source, interaction_id
  ) values (
    coalesce(s.id, gen_random_uuid()), c.id, c.cnpj_root, c.primary_domain, s.reason, s.source,
    p_interaction_id
  )
  returning id into new_id;
  update public.tasks t
    set status = 'cancelled', cancel_reason = 'opt_out', completed_at = now()
    where t.status = 'open'
      and t.company_id in (
        select x.id from public.companies x
        where x.id = c.id
          or (c.cnpj_root is not null and x.cnpj_root = c.cnpj_root)
          or (c.primary_domain is not null and x.primary_domain = c.primary_domain)
      );
  return new_id;
end;
$$;

create function public.suppress_company(p_entry jsonb) returns uuid
  language plpgsql
  set search_path = ''
as $$
begin
  return app.apply_suppression(p_entry, nullif(p_entry ->> 'interaction_id', '')::uuid);
end;
$$;

-- Contato feito, resposta recebida ou nota; opcionalmente a mudança de etapa marcada pelo usuário
-- no mesmo formulário e a supressão pelo pedido para parar (regra determinística).
-- Contato feito: o banco confere a aprovação (vigente, mesmo hash, versão mais recente) e a
-- supressão no momento do registro.
create function public.record_interaction(
  p_interaction jsonb,
  p_stage jsonb,
  p_suppression jsonb
) returns uuid
  language plpgsql
  set search_path = ''
as $$
declare
  r public.interactions;
  o public.opportunities;
  m public.outbound_messages;
  a public.approvals;
  new_id uuid;
begin
  r := jsonb_populate_record(null::public.interactions, p_interaction);
  select * into o from public.opportunities where id = r.opportunity_id;
  if not found or o.company_id <> r.company_id then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  if r.direction = 'outbound' then
    if o.closed_at is not null then
      raise exception 'opportunity_closed' using errcode = 'P0001';
    end if;
    select * into m from public.outbound_messages where id = r.message_id;
    select * into a from public.approvals where id = r.approval_id;
    if m.id is null or a.id is null
      or m.opportunity_id <> o.id
      or m.channel <> r.channel
      or a.channel <> r.channel
      or m.status <> 'approved'
      or m.approval_id <> a.id
      or a.entity_id <> m.id
      or a.opportunity_id <> o.id
      or a.status <> 'approved'
      or a.expires_at <= now()
      or a.payload_hash <> m.payload_hash
      or exists (
        select 1 from public.outbound_messages n
        where n.thread_id = m.thread_id and n.version > m.version
      ) then
      raise exception 'approval_invalid' using errcode = 'P0001';
    end if;
    if app.company_suppressed(o.company_id) then
      raise exception 'company_suppressed' using errcode = 'P0001';
    end if;
    -- Uma aprovação vale para um contato só: registrar de novo pede outra mensagem.
    if exists (
      select 1 from public.interactions i
      where i.approval_id = a.id and i.direction = 'outbound'
    ) then
      raise exception 'approval_used' using errcode = 'P0001';
    end if;
  end if;

  insert into public.interactions (
    id, opportunity_id, company_id, direction, channel, occurred_at, summary, body, message_id,
    approval_id, counterpart_role, retention_until, is_demo
  ) values (
    coalesce(r.id, gen_random_uuid()), r.opportunity_id, r.company_id, r.direction, r.channel,
    r.occurred_at, r.summary, r.body, r.message_id, r.approval_id, r.counterpart_role,
    r.retention_until, coalesce(r.is_demo, false)
  )
  returning id into new_id;

  if p_stage is not null and jsonb_typeof(p_stage) = 'object' then
    perform app.move_opportunity(
      o.id, p_stage ->> 'from', p_stage ->> 'to', p_stage ->> 'note'
    );
  end if;

  if p_suppression is not null and jsonb_typeof(p_suppression) = 'object' then
    perform app.apply_suppression(p_suppression || jsonb_build_object('company_id', o.company_id), new_id);
  end if;
  return new_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Acesso: só o servidor do app (ADR-0007)
-- -----------------------------------------------------------------------------

alter table public.opportunities enable row level security;
alter table public.opportunity_stage_changes enable row level security;
alter table public.suppression_entries enable row level security;
alter table public.interactions enable row level security;
alter table public.approach_plans enable row level security;
alter table public.outbound_messages enable row level security;
alter table public.approvals enable row level security;
alter table public.tasks enable row level security;

revoke all on
  public.opportunities, public.opportunity_stage_changes, public.suppression_entries,
  public.interactions, public.approach_plans, public.outbound_messages, public.approvals,
  public.tasks, public.opportunity_summaries, public.current_outbound_messages
  from anon, authenticated, service_role;

grant select, insert on
  public.opportunities, public.opportunity_stage_changes, public.suppression_entries,
  public.interactions, public.approach_plans, public.outbound_messages, public.approvals,
  public.tasks
  to service_role;
grant select on public.opportunity_summaries, public.current_outbound_messages to service_role;

grant update (
  offer_id, stage, priority, value_estimate_cents, value_basis, next_action, next_action_due_at,
  lost_reason, closed_at
) on public.opportunities to service_role;
grant update (lifted_at, lift_reason) on public.suppression_entries to service_role;
grant update (analysis, analysis_prompt_id, analysis_model, analyzed_at)
  on public.interactions to service_role;
grant update (status, decided_at) on public.approach_plans to service_role;
grant update (status, approval_id, decided_at) on public.outbound_messages to service_role;
grant update (status, revoked_at, revoke_reason) on public.approvals to service_role;
grant update (status, completed_at, cancel_reason, due_at, title, notes) on public.tasks to service_role;

revoke execute on function
  public.open_opportunity(jsonb),
  public.change_opportunity_stage(uuid, text, text, text),
  public.approve_message(jsonb),
  public.suppress_company(jsonb),
  public.record_interaction(jsonb, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function
  public.open_opportunity(jsonb),
  public.change_opportunity_stage(uuid, text, text, text),
  public.approve_message(jsonb),
  public.suppress_company(jsonb),
  public.record_interaction(jsonb, jsonb, jsonb)
  to service_role;

revoke execute on all functions in schema app from public, anon, authenticated;
-- As RPCs e a view rodam com o papel de quem chama (service_role), que executa os auxiliares.
grant execute on function
  app.company_suppressed(uuid),
  app.move_opportunity(uuid, text, text, text),
  app.apply_suppression(jsonb, uuid)
  to service_role;
