# Execução e conclusão do produto (registro de continuidade)

> Criado em 2026-11-10 para o pedido "Execução integral de conclusão do produto". **Antes de retomar o trabalho, leia este arquivo**, o `CLAUDE.md` e o [doc 13](13-auditoria-e-evolucao.md). Este registro diz em que marco estamos, o que foi feito e verificado, o que falta e qual é a próxima atividade exata. Atualize-o ao fim de cada entrega.

## Autorização do usuário (2026-11-10)

O usuário saiu e autorizou o agente a seguir sem pedir aprovação a cada passo ("tudo que você puder fazer agora automático sem eu, já faz"). Interpretação registrada:

- **Autorizado:** migrações **aditivas** no `prospector-dev` (criar tabelas, funções, triggers e views, sem alterar ou apagar dados existentes), commits por marco na branch `conclusao-produto` e envio dessa branch ao GitHub, `pnpm app:install`, avaliações locais da IA.
- **Continua bloqueado** (decisão ou declaração do usuário, ou custo): aprovar a LIA v2, enviar qualquer mensagem comercial, criar contas, usar chaves de API ou serviços pagos, promover o prompt `copilot/v4` da outra sessão, migrações destrutivas, ler o `.env.local`.

## Marcos

| Marco | Conteúdo | Situação |
|---|---|---|
| M0 | Estabilização: git, testes, app instalado, CI | Feito, exceto o CI (bloqueio abaixo) |
| M1 | Copiloto operacional: histórico persistente, ferramentas de leitura, telemetria (`llm_calls`, `tool_calls`) | Feito e verificado (ressalvas no KI-076) |
| M2 | Empresas, consulta de CNPJ, evidências persistentes (ledger), dossiê | Em andamento |
| M3 | Fila persistente (`ai_jobs`) com worker, descoberta real, deduplicação, histórico de pesquisas | Pendente |
| M4 | Investigação, auditoria visual, diagnóstico, concorrentes, qualificação | Pendente |
| M5 | Estratégia de abordagem, rascunhos, aprovações, conversas, pipeline | Pendente |
| M6 | Métricas reais, aprendizado, memória semântica | Pendente |
| M7 | Testes completos, revisão de segurança, app instalado, relatório de aceite | Pendente |

## M0 — Estabilização (2026-11-10)

| Item | Resultado |
|---|---|
| Git | Branch `main` igual ao `origin/main` (`24a0f87`); alterações locais só da instalação no disco D (doc 13 §11). Trabalho novo na branch `conclusao-produto` |
| `pnpm lint`, `pnpm typecheck`, `pnpm format:check` | Verdes |
| `pnpm test` | Verde (unitários e contrato de todos os pacotes) |
| `pnpm test:db` | Verde (PGlite) |
| `pnpm test:e2e` (`E2E_PORT=3120 E2E_MEMORY_PORT=3130`) | 30 passaram, 3 pulados |
| App instalado | `pnpm app:install` instala e atualiza; o Copiloto instalado não achava o prompt (KI-035): corrigido, o instalador copia `packages/agents/prompts` e o `pnpm-workspace.yaml`; busca conferida a partir de `D:\Prospector\app\apps\web` |
| CI (GitHub Actions) | **Bloqueado:** o `gh` não está instalado e o Chrome não está logado no GitHub; o repositório é privado. Conferir em https://github.com/sourodriguesvini/prospect-ai/actions (KI-009) |
| Prompt `copilot/v4` | Avaliado numa sessão separada (worktree `claude/hopeful-leavitt-bec23b`); revisão do `avaliador-ia` em andamento lá. **Não promovido** |

## M1 — Copiloto operacional (2026-11-10)

| Item | Resultado |
|---|---|
| Migração `20261110150000_copilot_operational` | Aplicada no `prospector-dev` (só aditiva): `copilot_threads` (auditada na mesma transação), `copilot_messages`, `llm_calls` e `tool_calls` (só inclusão, protegidas por privilégio e por trigger), view `copilot_thread_summaries`. Avisos de segurança do Supabase: só o INFO `rls_enabled_no_policy`, proposital |
| Histórico persistente | O servidor monta o histórico a partir do banco (KI-032 resolvido); conversas com endereço próprio (`/copiloto?conversa=…`), renomear e arquivar auditados; lista de conversas com a ativa marcada |
| Ferramentas de leitura | Registro central em `packages/application/src/tools` (argumentos validados no servidor, limite de tempo e de saída, telemetria). Sete ferramentas da estratégia: prontidão, ofertas, oferta, ICPs, cases, conformidade, atividade recente. Nenhuma escreve nem age fora |
| Laço do Copiloto | Até 4 rodadas, a última sem ferramentas; consultas repetidas reaproveitadas; indicadores de ferramenta e links internos na tela; cancelamento grava a resposta como interrompida |
| Prompt | `copilot-tools/v2` (padrão). O v1 reprovou; o v2 passou com 81,6% (KI-076, com as falhas que continuam) |
| Testes | `pnpm test` 717 verdes; `pnpm test:db` 52 (PGlite); e2e do Copiloto (inclui `copilot-history.spec.ts`) verdes com `E2E_PORT=3120 E2E_MEMORY_PORT=3130` |
| Verificação manual | No app com o banco real: perguntas sobre ofertas, ICPs e prontidão responderam com os dados salvos e mostraram os links; conversa reaberta pela URL. **Ficaram 4 conversas de teste no banco do usuário** ("Quais ofertas eu tenho…", "O que falta para eu começar…", "Quais são as cinco empresas…", "Quais ICPs eu tenho…"): podem ser arquivadas na tela do Copiloto |
| Pendências | KI-076 (v3 do prompt), KI-077 (links ao reabrir), KI-078 (retenção, M7), KI-079 (aceito) |

## Decisões desta execução

| Decisão | Registro |
|---|---|
| Nomes de tabelas seguem o doc 06 §4 (sem `org_id`, ADR-0007) | este documento |
| Prompt com ferramentas é um arquivo inteiro (`copilot-tools/vN`), não um adendo ao `copilot/vN`; troca de padrão só com `pnpm evals` (`EVAL_TOOLS=1`) | `packages/agents/src/copilot/copilot.ts`, KI-076 |
| CNPJ: OpenCNPJ como padrão, Minha Receita como reserva (BrasilAPI é a mesma fonte) | [research/05](research/05-fontes-cnpj-descoberta-e-busca-web.md) |

## Bloqueios externos

| Bloqueio | Quem resolve | Impacto |
|---|---|---|
| LIA v2 em rascunho | Usuário (Configurações > Conformidade) | Abordagens ficam bloqueadas (correto) |
| CI não conferido | Usuário (login no GitHub) | Nenhum no app |

## Próxima atividade exata

M2: contratos de empresa e CNPJ (aceitar o alfanumérico), adaptador OpenCNPJ com reserva Minha Receita em `packages/integrations`, migração aditiva `companies`, `company_identifiers`, `sources`, `claims`, `claim_evidence`, `claim_dependencies`, serviços de empresas e evidências, telas Empresas e dossiê, ferramentas do Copiloto para empresas.
