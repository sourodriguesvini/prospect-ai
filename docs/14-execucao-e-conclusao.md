# Execução e conclusão do produto (registro de continuidade)

> Criado em 2026-11-10 para o pedido "Execução integral de conclusão do produto". **Antes de retomar o trabalho, leia este arquivo**, o `CLAUDE.md` e o [doc 13](13-auditoria-e-evolucao.md). Este registro diz em que marco estamos, o que foi feito e verificado, o que falta e qual é a próxima atividade exata. Atualize-o ao fim de cada entrega.

## Autorização do usuário (2026-11-10)

O usuário saiu e autorizou o agente a seguir sem pedir aprovação a cada passo ("tudo que você puder fazer agora automático sem eu, já faz"). Interpretação registrada:

- **Autorizado:** migrações **aditivas** no `prospector-dev` (criar tabelas, funções, triggers e views, sem alterar ou apagar dados existentes), commits por marco na branch `conclusao-produto` e envio dessa branch ao GitHub, `pnpm app:install`, avaliações locais da IA.
- **Continua bloqueado** (decisão ou declaração do usuário, ou custo): aprovar a LIA v2, enviar qualquer mensagem comercial, criar contas, usar chaves de API ou serviços pagos, promover o prompt `copilot/v4` da outra sessão, migrações destrutivas, ler o `.env.local`.

**Revisão da autorização (2026-11-10, mensagem da D-AI-4).** O usuário escreveu: "Não execute migrações sem confirmação e não faça commit ou push sem minha autorização explícita." A partir daí **nenhuma migração** (nem aditiva) é aplicada no `prospector-dev` sem confirmação, e **nenhum commit ou push** é feito sem autorização explícita. O restante continua como acima. Na mesma mensagem: preservar o prompt `copilot/v3` e não promover o `v4` sem nova avaliação e aprovação; usar a Tavily só no plano gratuito.

## Marcos

| Marco | Conteúdo | Situação |
|---|---|---|
| M0 | Estabilização: git, testes, app instalado, CI | Feito, exceto o CI (bloqueio abaixo) |
| M1 | Copiloto operacional: histórico persistente, ferramentas de leitura, telemetria (`llm_calls`, `tool_calls`) | Feito e verificado (ressalvas no KI-076) |
| M2 | Empresas, consulta de CNPJ, evidências persistentes (ledger), dossiê | Implementado e testado; migrações aplicadas no `prospector-dev`; falta o commit e o push (autorização) |
| M3 | Fila persistente (`ai_jobs`) com worker, descoberta real, deduplicação, histórico de pesquisas; busca web Tavily (D-AI-4) | Pendente; o adaptador da Tavily está sendo preparado numa sessão paralela |
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

## M2 — Empresas, CNPJ, evidências e dossiê (2026-11-10)

| Item | Resultado |
|---|---|
| Migração `20261110170000_companies_evidence` | Aplicada no `prospector-dev` (só aditiva, sob a autorização anterior): `companies`, `company_identifiers`, `sources`, `claims`, `claim_evidence`, `claim_dependencies`, RPCs `create_company` e `record_evidence` com a auditoria na mesma transação (ADR-0010). Avisos do Supabase: só INFO (KI-082) |
| Migração `20261110180000_evidence_hardening` | **Aplicada no `prospector-dev` em 2026-11-10, com a confirmação do usuário** (KI-083): conteúdo do claim imutável no banco, `superseded` e `rejected` finais, `truncate` bloqueado no ledger, lote conferido pelo banco nas RPCs, chave conferida ligada à fonte. Conferida no banco real num bloco que se desfaz sozinho (alterar o texto de um claim dá `append_only`; reativar um substituído dá `claim_final_status`; o `service_role` chega à função conferida). Versão do histórico alinhada ao nome do arquivo. Avisos do Supabase: só INFO (KI-082) |
| Consulta de CNPJ | `packages/integrations/src/cnpj`: OpenCNPJ com a Minha Receita de reserva, sem chave; HTTPS só para os hosts dos provedores, tempo limite, corpo até 256 KB, tipo de conteúdo conferido, registro do CNPJ pedido (outro CNPJ é resposta inválida), CPF no nome recusado, empresa anonimizada (LGPD) não importada, cache de um dia; a nova consulta pedida no dossiê ignora o cache |
| Ledger | `EvidenceService` confere cada trecho no texto da fonte, calcula a confiança no servidor (provedores de CNPJ como agregador, 0,6: KI-080, D-EVID-2) e grava nova versão com `supersedes_id`; dado que sumiu vira fato de ausência; nova consulta com o mesmo conteúdo não grava nada ("nada mudou"); a fonte guarda a data da coleta do provedor e o prazo de guarda (12 meses) |
| MEI e empresa individual | Importação liberada (o "sem MEI" do doc 05 vale para a varredura do M3). O nome da pessoa titular fica só em `companies`; o texto da fonte e os fatos dizem "nome da pessoa titular"; o dossiê mostra o selo "Empresa individual: contém dado pessoal" e explica |
| Telas | Empresas (busca sem acento, filtro por etapa, estado vazio com caminho), Adicionar (pelo CNPJ ou à mão, aviso de MEI), dossiê (cadastro conforme a origem; evidências agrupadas por fonte, com a fonte e os selos uma vez por grupo, data da base da Receita, link para os dados atuais e texto guardado; fatos na ordem do registro; histórico; etapa só por decisão do usuário; nova consulta com aviso de quantos dados mudaram), "Empresa não encontrada" |
| Copiloto | Ferramentas de leitura `list_companies` e `get_company_dossier`; a telemetria grava só o tipo da referência e contagens, sem nome de empresa (KI-078) |
| Testes de ponta a ponta | Consulta SINTÉTICA (`PROSPECTOR_CNPJ_LOOKUP=fixture`, só no modo memória; o container recusa com banco), com registros marcados DEMO: importação, fonte única, nova consulta sem mudança, MEI sem o nome nas evidências, tema escuro, celular de 375 px sem rolagem lateral, acessibilidade (axe) |
| Revisões | `revisor-arquitetura`, `revisor-seguranca`, `revisor-conformidade` e `revisor-ux` rodaram; os achados críticos foram corrigidos nesta rodada; o que ficou está nos KI-083 a KI-088 |
| Verificação | `pnpm typecheck`, `pnpm lint` e `pnpm format:check` verdes nos arquivos do M2 (a sessão paralela da busca web tinha arquivos em andamento); `pnpm test` verde (contracts 191, domain 237, application 113, integrations 22, agents 132, web 80, db 66); `pnpm test:db` 66 (PGlite); `pnpm test:e2e` (`E2E_PORT=3120 E2E_MEMORY_PORT=3130`) 45 passaram, 3 pulados (banco real e Ollama real). No navegador, o dossiê de uma empresa já gravada no banco real mostrou a fonte única, a data da base e os fatos na ordem do registro (só leitura) |
| Dados no banco do usuário | Uma empresa real consultada ao vivo na verificação anterior (PETROBRAS - EDISE), arquivada |
| Pendências | KI-084 (expurgo), KI-085 (tipo marcado do lote), KI-086 (raiz do CNPJ), KI-087 (base legal), KI-088 (termos dos provedores), KI-080 (D-EVID-2), KI-081 (edição do cadastro) |

## Decisões desta execução

| Decisão | Registro |
|---|---|
| Nomes de tabelas seguem o doc 06 §4 (sem `org_id`, ADR-0007) | este documento |
| Prompt com ferramentas é um arquivo inteiro (`copilot-tools/vN`), não um adendo ao `copilot/vN`; troca de padrão só com `pnpm evals` (`EVAL_TOOLS=1`) | `packages/agents/src/copilot/copilot.ts`, KI-076 |
| CNPJ: OpenCNPJ como padrão, Minha Receita como reserva (BrasilAPI é a mesma fonte) | [research/05](research/05-fontes-cnpj-descoberta-e-busca-web.md) |
| **D-AI-4 (usuário, 2026-11-10):** Tavily Search API como buscador principal, só no plano gratuito, com limite de consumo configurável que interrompe as chamadas; Playwright para navegação e análise de páginas; SearXNG local opcional depois de avaliação. Chave por variável de ambiente, criada pelo usuário (o agente não lê o `.env.local`) | [10 §1](10-riscos-custos-decisoes.md), [13 §6.7](13-auditoria-e-evolucao.md), [05](05-integracoes.md) |
| MEI e empresa individual entram pelo cadastro manual ou pelo CNPJ; o nome da pessoa fica fora do ledger | ADR-0002 (emenda M2), KI-084, KI-087 |
| `PROSPECTOR_CNPJ_LOOKUP`: `on` (padrão), `off` ou `fixture` (sintético, só no modo memória) | ADR-0001 (emenda M2) |

## Bloqueios externos

| Bloqueio | Quem resolve | Impacto |
|---|---|---|
| LIA v2 em rascunho | Usuário (Configurações > Conformidade) | Abordagens ficam bloqueadas (correto) |
| CI não conferido | Usuário (login no GitHub) | Nenhum no app |
| Commit e push do M2 | Usuário (autorização explícita) | Trabalho só na cópia local, branch `conclusao-produto` |
| Chave da Tavily | Usuário (criar a conta gratuita e pôr a chave no `.env.local`) | Sem chave, a busca web fica desligada |
| D-EVID-2 (provedores de CNPJ como oficiais?) e parecer de LGPD (D-LGPD-1) | Usuário | Confiança dos fatos do registro fica em média; nenhum contato real |

## Próxima atividade exata

1. Com a autorização do usuário: commit do M2 na branch `conclusao-produto` e push (a migração `20261110180000_evidence_hardening` já foi aplicada e conferida em 2026-11-10).
2. Integrar o resultado da sessão paralela da busca web (porta `WebSearch`, adaptador Tavily com teto de consumo, leitor de páginas com Playwright): ligar na raiz de composição, variáveis em `env.ts`, docs.
3. M3: ADR-0011 (fila persistente no Postgres com worker local, D-AI-5), migração `ai_jobs` (só com confirmação), descoberta F4 por CNAE e município com deduplicação pela raiz do CNPJ (KI-086), histórico de pesquisas; validação com uma pesquisa limitada de empresas reais no interior de São Paulo.
