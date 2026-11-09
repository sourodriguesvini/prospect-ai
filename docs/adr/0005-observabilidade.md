# ADR-0005 — Observabilidade: tabelas próprias de custo/execução + Langfuse (LLM) + Sentry (app)

- Status: **Proposto**
- Data: 2026-11-09
- Base: [research/04 §D](../research/04-infraestrutura-e-execucao.md)

## Contexto

Precisamos de: rastreabilidade por execução (workflow → passo → agente → chamada LLM/ferramenta), custo por tenant/agente/operação/provedor, avaliação de prompts e erros de aplicação. Parte disso é **dado de produto** (custos exibidos ao cliente, auditoria) e precisa estar no nosso banco, sob RLS.

## Decisão

1. **Fonte da verdade de custos e execuções no Postgres**: `workflow_runs`, `agent_runs`, `llm_calls`, `tool_calls`, `provider_usage`, `audit_log` ([06-modelo-de-dados.md §4.11](../06-modelo-de-dados.md)). Painéis de custo do produto leem daqui.
2. **Langfuse Cloud** para traces de LLM, inspeção de prompts e datasets/evals, via OpenTelemetry (atributos: `org_id`, `workflow_run_id`, `agent_key`, `prompt_version`). Plano inicial: Hobby → Core quando precisarmos de retenção maior.
3. **Sentry** para erros e performance do Next.js e das tasks.
4. Convenções GenAI do OpenTelemetry adotadas como nomenclatura, sem depender de sua estabilidade (status ainda em desenvolvimento segundo a pesquisa).
5. **Minimização**: traces enviados a terceiros passam por redação de PII (e-mails, telefones, nomes de contatos); conteúdo completo fica apenas no nosso banco. Retenção de traces com conteúdo: [DECISÃO D-LGPD-3].

## Consequências

- (+) Custos e auditoria independentes de fornecedor de observabilidade.
- (+) Langfuse acelera depuração e avaliação sem construir UI própria.
- (−) Langfuse Cloud não lista região Brasil (pesquisa); dados enviados devem ser minimizados e o fornecedor incluído no registro de suboperadores.
- Evitar: Helicone (status de manutenção segundo a pesquisa).
