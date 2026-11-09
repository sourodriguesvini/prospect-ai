# ADR-0003 — Runtime de agentes: Claude Messages API + Tool Runner dentro de workflows duráveis

- Status: **Proposto**
- Data: 2026-11-09
- Fonte: referência oficial do SDK da Claude API consultada em 2026-11-09 (superfícies disponíveis, modelos, recursos).

## Contexto

O produto precisa executar 2 agentes com ferramentas (Investigador, Copiloto) e ~12 capacidades de chamada única com saída estruturada, com:
- ferramentas que são **serviços do nosso domínio** (gravar claims, propor contatos, criar aprovação);
- aprovação humana, auditoria e custos sob nosso controle;
- dados de tenant isolados por RLS no nosso banco;
- execução assíncrona e retomável.

Opções avaliadas (conforme a documentação da Anthropic):

| Opção | O que fornece | Avaliação para este produto |
|---|---|---|
| **Messages API — loop manual** | Tudo é nosso | Controle total; mais código. Usado onde o Tool Runner não servir. |
| **Messages API — Tool Runner** (`client.beta.messages.toolRunner` + `betaZodTool`) | Loop agêntico sobre **ferramentas que definimos**, com ganchos por turno | **Escolhido.** Ferramentas tipadas com Zod (mesmos contratos do app), ganchos para aprovação, auditoria e custo. Aceita ferramentas de servidor (`web_search`, `web_fetch`). Beta no SDK TS — encapsulado no gateway. |
| **Claude Agent SDK** (`@anthropic-ai/claude-agent-sdk`) | Harness do Claude Code: ferramentas de arquivo/bash, subagentes, sessões | Pensado para agentes de código/filesystem; exige processo hospedado com ambiente de execução. Nossas ferramentas são serviços de domínio, não arquivos/shell. Não adotado no runtime; **usado no desenvolvimento** (Claude Code). |
| **Claude Managed Agents** (beta) | Loop + sandbox hospedados pela Anthropic, agentes versionados, agendamento, multiagente | Atraente para pesquisa longa agendada, mas: beta; sessões e workspace fora do nosso banco; aprovações e ferramentas de domínio exigiriam ida-e-volta de eventos. **Reavaliar na fase 3** para monitoramento/pesquisa profunda agendada. |

## Decisão

1. Todas as chamadas passam por um **LLM Gateway** em `packages/agents` usando o SDK oficial `@anthropic-ai/sdk`.
2. Agentes usam o **Tool Runner** com ferramentas Zod (`strict` quando aplicável) + ferramentas de servidor `web_search_20260209` / `web_fetch_20260209`; capacidades de chamada única usam `messages.parse` com `zodOutputFormat`.
3. Cada execução de agente roda **dentro de um passo do workflow durável** ([ADR-0004](0004-orquestracao-duravel.md)) com timeout, orçamento e idempotência; claims são gravados incrementalmente.
4. Modelo padrão `claude-opus-5-5`; modelos por capacidade em `agent_configs` (decisão de custo do dono do produto, validada por evals).
5. Recursos usados: thinking adaptativo + `effort`; prompt caching; streaming para saídas longas; Message Batches para lotes não urgentes; tratamento de `stop_reason` (incl. `refusal` com fallback de servidor); registro de `usage` para custos.

## Consequências

- (+) Controle total de permissões, aprovações, dados e custos; ferramentas = serviços já testados.
- (+) Contratos únicos (Zod) entre UI, workflows e agentes.
- (−) Dependência de API beta (Tool Runner); mitigação: gateway isola o uso e há fallback para loop manual.
- (−) Somos responsáveis pela hospedagem do loop (dentro do workflow engine).

## Restrições técnicas anotadas (verificar a cada upgrade de modelo/SDK)

- Opus 5.5: thinking não desligável; `effort` padrão `medium`; `tool_choice` forçado retorna 400; sem prefill.
- `web_fetch` só busca URLs já presentes na conversa; erros de ferramentas de servidor voltam como blocos de resultado (HTTP 200), não exceções.
- Preços e IDs de modelos vêm de `model_pricing`/`agent_configs`, nunca hard-coded.
