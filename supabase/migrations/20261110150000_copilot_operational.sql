-- =============================================================================
-- IA-2 — Copiloto operacional: conversas persistentes e telemetria da IA local
-- (docs/06 §4.11, docs/14 M1). Uso local sem login (ADR-0007): sem org_id nem user_id.
--
-- copilot_threads   conversas; título editável e arquivamento (nada é apagado). Auditadas na
--                   mesma transação (ADR-0010): criar, renomear e arquivar.
-- copilot_messages  mensagens da conversa, SOMENTE INCLUSÃO (o histórico nunca é reescrito).
--                   Guarda modelo, versão do prompt, traceId, chamadas e resultados de ferramentas.
-- llm_calls         uma linha por geração do modelo local (tokens, tempos, motivo de parada).
-- tool_calls        uma linha por execução de ferramenta pedida pelo modelo (entrada sem conteúdo
--                   sensível, resumo do resultado, status, duração).
--
-- As três últimas são registros de execução: só inclusão, sem auditoria por linha (o próprio
-- registro é a trilha, com trace_id). job_id fica sem chave estrangeira até a fila (M3).
-- Só aditiva: nenhum dado existente é alterado.
-- =============================================================================

create function app.forbid_append_only_mutation() returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  raise exception 'append_only' using errcode = '42501';
end;
$$;

-- -----------------------------------------------------------------------------
-- Conversas
-- -----------------------------------------------------------------------------

create table public.copilot_threads (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(btrim(title)) between 1 and 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);
comment on table public.copilot_threads is
  'Conversas do Copiloto (IA-2). Renomear e arquivar são as únicas mudanças; nada é apagado.';

create trigger copilot_threads_updated_at
  before update on public.copilot_threads
  for each row execute function app.set_updated_at();
create trigger copilot_threads_audit
  after insert or update on public.copilot_threads
  for each row execute function app.audit_write();

create table public.copilot_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.copilot_threads (id),
  -- Ordem de inclusão (a data pode empatar dentro do mesmo pedido).
  seq bigint generated always as identity,
  role text not null check (role in ('user', 'assistant', 'tool')),
  content text not null check (char_length(content) <= 32000),
  -- interrupted = resposta parcial (cancelada ou conexão caiu); failed = erro antes do texto.
  status text not null default 'complete' check (status in ('complete', 'interrupted', 'failed')),
  model text check (model is null or char_length(model) between 1 and 120),
  prompt_version text check (prompt_version is null or char_length(prompt_version) between 1 and 60),
  trace_id uuid not null,
  -- Mensagem do assistente que pediu ferramentas: [{id, name, arguments}].
  tool_calls jsonb check (
    tool_calls is null
    or (jsonb_typeof(tool_calls) = 'array' and pg_column_size(tool_calls) <= 16384)
  ),
  -- Mensagem de resultado de ferramenta.
  tool_call_id text check (tool_call_id is null or char_length(tool_call_id) between 1 and 80),
  tool_name text check (tool_name is null or tool_name ~ '^[a-z][a-z0-9_]{1,63}$'),
  tool_status text check (tool_status is null or tool_status in ('ok', 'error', 'denied')),
  error_code text check (error_code is null or char_length(error_code) between 1 and 60),
  usage jsonb check (usage is null or jsonb_typeof(usage) = 'object'),
  created_at timestamptz not null default now(),
  check ((role = 'tool') = (tool_name is not null and tool_status is not null))
);
comment on table public.copilot_messages is
  'Mensagens do Copiloto, somente inclusão. O servidor monta o histórico enviado ao modelo a partir '
  'daqui (KI-032), não do navegador.';

create index copilot_messages_thread_idx on public.copilot_messages (thread_id, seq);

create trigger copilot_messages_append_only
  before update or delete on public.copilot_messages
  for each row execute function app.forbid_append_only_mutation();
create trigger copilot_messages_no_truncate
  before truncate on public.copilot_messages
  for each statement execute function app.forbid_append_only_mutation();

-- Resumo para a lista de conversas: última atividade e número de mensagens.
create view public.copilot_thread_summaries with (security_invoker = true) as
  select
    t.id,
    t.title,
    t.created_at,
    t.updated_at,
    t.archived_at,
    coalesce(max(m.created_at), t.created_at) as last_activity_at,
    count(m.id) filter (where m.role in ('user', 'assistant')) as message_count
  from public.copilot_threads t
  left join public.copilot_messages m on m.thread_id = t.id
  group by t.id;

-- -----------------------------------------------------------------------------
-- Telemetria da IA local
-- -----------------------------------------------------------------------------

create table public.llm_calls (
  id uuid primary key default gen_random_uuid(),
  task text not null check (task in ('copilot', 'reasoning', 'vision', 'embedding')),
  provider text not null default 'ollama' check (provider in ('ollama', 'anthropic')),
  model text not null check (char_length(model) between 1 and 120),
  prompt_version text check (prompt_version is null or char_length(prompt_version) between 1 and 60),
  trace_id uuid not null,
  thread_id uuid references public.copilot_threads (id),
  job_id uuid,
  status text not null check (status in ('ok', 'error', 'cancelled')),
  error_code text check (error_code is null or char_length(error_code) between 1 and 60),
  done_reason text check (done_reason is null or char_length(done_reason) <= 40),
  input_tokens integer check (input_tokens is null or input_tokens >= 0),
  output_tokens integer check (output_tokens is null or output_tokens >= 0),
  total_ms numeric(12, 1) check (total_ms is null or total_ms >= 0),
  load_ms numeric(12, 1) check (load_ms is null or load_ms >= 0),
  -- Modelos locais não têm custo em dinheiro (ADR-0008): fica zerado.
  cost_usd numeric(12, 6) not null default 0 check (cost_usd >= 0),
  created_at timestamptz not null default now()
);
comment on table public.llm_calls is
  'Uma linha por geração de modelo (somente inclusão). Base das métricas de uso da IA local.';
create index llm_calls_created_idx on public.llm_calls (created_at desc);

create table public.tool_calls (
  id uuid primary key default gen_random_uuid(),
  trace_id uuid not null,
  thread_id uuid references public.copilot_threads (id),
  job_id uuid,
  tool text not null check (tool ~ '^[a-z][a-z0-9_]{1,63}$'),
  -- Argumentos validados, sem texto livre longo (KI-015): limite de tamanho.
  input_redacted jsonb not null default '{}'::jsonb check (
    jsonb_typeof(input_redacted) = 'object' and pg_column_size(input_redacted) <= 4096
  ),
  output_summary text check (output_summary is null or char_length(output_summary) <= 500),
  status text not null check (status in ('ok', 'error', 'denied')),
  error_code text check (error_code is null or char_length(error_code) between 1 and 60),
  duration_ms integer not null check (duration_ms >= 0),
  created_at timestamptz not null default now()
);
comment on table public.tool_calls is
  'Uma linha por ferramenta executada a pedido de um modelo (somente inclusão).';
create index tool_calls_created_idx on public.tool_calls (created_at desc);

create trigger llm_calls_append_only
  before update or delete on public.llm_calls
  for each row execute function app.forbid_append_only_mutation();
create trigger llm_calls_no_truncate
  before truncate on public.llm_calls
  for each statement execute function app.forbid_append_only_mutation();
create trigger tool_calls_append_only
  before update or delete on public.tool_calls
  for each row execute function app.forbid_append_only_mutation();
create trigger tool_calls_no_truncate
  before truncate on public.tool_calls
  for each statement execute function app.forbid_append_only_mutation();

-- -----------------------------------------------------------------------------
-- Acesso: só o servidor do app (ADR-0007)
-- -----------------------------------------------------------------------------

alter table public.copilot_threads enable row level security;
alter table public.copilot_messages enable row level security;
alter table public.llm_calls enable row level security;
alter table public.tool_calls enable row level security;

revoke all on
  public.copilot_threads, public.copilot_messages, public.copilot_thread_summaries,
  public.llm_calls, public.tool_calls
  from anon, authenticated, service_role;

grant select, insert on
  public.copilot_threads, public.copilot_messages, public.llm_calls, public.tool_calls
  to service_role;
grant update (title, archived_at) on public.copilot_threads to service_role;
grant select on public.copilot_thread_summaries to service_role;

revoke execute on all functions in schema app from public, anon, authenticated;
