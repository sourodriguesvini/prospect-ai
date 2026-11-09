---
name: migracao-supabase
description: Criar ou alterar tabelas no Postgres/Supabase do Prospector com RLS multi-tenant, índices, auditoria e testes de isolamento. Use sempre que um arquivo em supabase/migrations for criado ou alterado.
---

# Migração Supabase com RLS

## Checklist por tabela de tenant

1. `org_id uuid not null references organizations(id) on delete cascade` (exceto catálogos globais documentados).
2. `id uuid primary key default gen_random_uuid()`, `created_at`, `updated_at` + trigger `set_updated_at`.
3. `is_demo boolean not null default false` em entidades de negócio.
4. Enums como `text` + `check` (salvo justificativa).
5. `alter table … enable row level security;` — **sempre**.
6. Políticas separadas por operação usando `(select app.is_member(org_id, '<papel>'))`:
   - `select`: `viewer`; `insert/update`: `operator`; `delete`: `admin` (ou nenhuma, se soft delete).
   - Tabelas append-only (`audit_log`, `llm_calls`): nenhuma política de update/delete.
7. Índice começando por `org_id` + índices das consultas reais documentadas.
8. Trigger de auditoria se a tabela guarda ação sensível.
9. Nada de `security definer` sem `set search_path = ''` e justificativa em comentário.

## Testes obrigatórios (supabase/tests ou packages/db/tests)

- Usuário de org A **não** lê, insere, atualiza nem apaga linhas de org B.
- Papel `viewer` não escreve; `operator` escreve; `admin` apaga (se aplicável).
- O teste global de catálogo continua passando (toda tabela com `org_id` tem RLS).

## Procedimento

1. Nome: `supabase/migrations/<timestamp>_<descricao_curta>.sql` (gerado pela CLI quando disponível).
2. Migração aditiva e reversível quando possível; mudança destrutiva exige plano de dados e aviso explícito ao usuário.
3. Atualize `docs/06-modelo-de-dados.md` se o modelo mudou.
4. Regenere tipos (`supabase gen types typescript`) para `packages/db`.
5. Nunca aplique migração em projeto remoto de produção a partir do agente. Em projeto de desenvolvimento remoto, só com confirmação do usuário.

## Antipadrões

- `auth.uid()` sem `(select …)` em políticas (perde cache por linha).
- Política `using (true)` em tabela de tenant.
- Confiar em filtro de `org_id` apenas no código do app.
- JSONB para campos usados em filtro/ordenação frequente.
