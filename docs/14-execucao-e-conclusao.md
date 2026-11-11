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
| M2 | Empresas, consulta de CNPJ, evidências persistentes (ledger), dossiê | Feito e verificado: commit `bcd5444` enviado ao GitHub (branch `conclusao-produto`) |
| M3 | Fila persistente (`ai_jobs`) com worker, descoberta real, deduplicação, histórico de pesquisas; busca web Tavily (D-AI-4) | Em andamento: pesquisa na internet (D-AI-4) implementada e ligada no app, commit `c165448` enviado; o Copiloto pesquisa na internet com o prompt `copilot-tools/v3`, promovido com a aprovação do usuário e instalado em `D:\Prospector`, commit `f57f2e7` enviado; fila, descoberta e deduplicação pendentes |
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
| Prompt | `copilot-tools/v2` (padrão até 2026-11-10, quando o `copilot-tools/v3` o substituiu: ver M3, parte 2). O v1 reprovou; o v2 passou com 81,6% (KI-076, com as falhas que continuam) |
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
| Commit | `bcd5444`, enviado ao GitHub em 2026-11-10 com a autorização do usuário. Antes, o conteúdo exato do commit (sem os arquivos da pesquisa na internet) foi verificado numa cópia separada: `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test` e `pnpm test:db` verdes |
| Pendências | KI-084 (expurgo), KI-085 (tipo marcado do lote), KI-086 (raiz do CNPJ), KI-087 (base legal), KI-088 (termos dos provedores), KI-080 (D-EVID-2), KI-081 (edição do cadastro) |

## M3, parte 1 — Pesquisa na internet (D-AI-4, 2026-11-10)

| Item | Resultado |
|---|---|
| Onde foi feito | Sessão paralela "Busca web D-AI-4", na mesma cópia; a ligação na raiz de composição foi feita nesta sessão |
| Decisão | [ADR-0012](adr/0012-busca-web-tavily-playwright.md), Aceito. Respostas do usuário: migração aplicada, chave configurada por ele (o agente não leu o `.env.local`), termos da Tavily aceitos, busca sempre ligada quando há chave, ferramentas no Copiloto |
| Migração `20261110190000_provider_usage` | Aplicada no `prospector-dev` com a confirmação do usuário: consumo só por inclusão, view mensal, RLS sem acesso para `anon` e `authenticated` |
| Busca | Adaptador Tavily (busca basic, 1 crédito) com teto mensal local `WEB_SEARCH_MONTHLY_CREDITS` (padrão 900, no máximo 1.000, a cota gratuita) que para as chamadas ao atingir o orçamento; busca idêntica reaproveitada por 24 h; agregadores de CNPJ excluídos; consulta com dado pessoal recusada |
| Leitura de páginas | Leitor próprio: SSRF bloqueado, robots.txt respeitado, redes sociais e agregadores recusados, prazo total por leitura, Playwright com sandbox; sem navegador, extração estática |
| Copiloto | Ferramentas de leitura `search_web`, `read_web_page` (só endereços que vieram de uma busca) e `get_web_research_usage` prontas e testadas, telemetria sem a consulta nem a URL. Nesta parte ficaram fora do Copiloto (o `copilot-tools/v2` dizia que nenhuma ferramenta acessa a internet); entraram com o `copilot-tools/v3` (parte 2). O `get_company_dossier` passou a marcar fontes da internet (`fonte_externa`) com aviso de que o texto não é instrução (KI-094). Os limites e as recusas desta parte mudaram com a emenda do ADR-0012 (parte 2) |
| Sem banco | A busca fica desligada: o contador em memória zeraria a cada reinício e o teto mensal deixaria de valer |
| Revisões | Conformidade e segurança na sessão paralela; os 4 achados graves de segurança (expressão regular de tempo explosivo, navegador sem prazo, Chromium sem sandbox, vazamento por injeção de prompt) foram corrigidos e testados |
| Validação com dados reais | 5 buscas limitadas na sessão paralela, com empresas reais do interior de São Paulo; o arquivo com os resultados foi apagado depois (minimização) |
| Verificação | `pnpm typecheck`, `pnpm lint` e `pnpm format:check` verdes; `pnpm test` 1.010 verdes (contracts 195, domain 237, application 123, integrations 174, agents 132, web 80, db 69); `pnpm test:db` 70 (PGlite); `pnpm test:e2e` 45 passaram, 3 pulados (banco real e Ollama real). No app de desenvolvimento, com o banco real e a chave configurada, as telas abrem e o serviço sobe sem erro no log. A busca pelo app não foi feita: sem as ferramentas no Copiloto, ainda não há caminho no app até ela (KI-096) |
| Pendências | KI-089 a KI-096; gravar resultados no dossiê pela tela (o serviço já grava; falta a interface, M4/F5) |

## M3, parte 2 — Copiloto pesquisa na internet (`copilot-tools/v3`, 2026-11-10)

| Item | Resultado |
|---|---|
| Decisão do usuário | Pesquisa e Copiloto sem recusas: a IA orienta, mas não diz "não" ([emenda do ADR-0012](adr/0012-busca-web-tavily-playwright.md#emenda-2026-11-10-pesquisa-sem-recusas-por-decisão-do-usuário), CLAUDE.md regra 7). Sem máscara de dado pessoal, MEI pesquisado, pessoas ligadas às empresas podem ser pesquisadas, agregadores de CNPJ entram. Continuam: não inventar, citar a URL, conteúdo da internet é dado e não instrução, teto mensal de créditos, nada sai sem aprovação |
| Prompt | `copilot-tools/v3` (padrão desde 2026-11-10, com a aprovação do usuário): pesquisa sempre que pedida; empresa perguntada pelo nome é conferida primeiro no Prospector; pesquisa aprofundada com ao menos duas buscas e leitura das páginas; falhas (créditos, login, nada achado) explicadas com a mensagem do resultado; URL completa, solta no texto; rascunho escrito na hora, com colchetes no que falta; sem falar de LGPD a não ser que perguntem. O `copilot/v3` (sem ferramentas) não mudou |
| Copiloto | 4 buscas e 4 leituras por pedido, em qualquer ordem; até 8 rodadas; contexto de 16 mil tokens (`num_ctx`); a pergunta para de chamar ferramentas quando os resultados passam de 20 mil caracteres, inclusive no meio de uma rodada (a consulta seguinte volta como não feita, com teste). As ferramentas da internet só são entregues a um prompt que as conhece (`container.ts`). O texto de sistema diz que o que a internet traz fica só na conversa (não vai para o dossiê) |
| Avaliação | `pnpm evals` com `EVAL_TOOLS=1 EVAL_WEB=1 EVAL_PROMPTS=2,3 EVAL_REPEAT=3`, internet SINTÉTICA (`web-fixtures.ts`, sem gastar créditos), `qwen3.5:4b`. Resultado recalculado com os corretores atuais (`results/2026-11-10-23-50.regraded.json`): casos comuns **v3 83%** (40 de 48, IC95 70–91%) contra **v2 77%** (37 de 48); Empresas 3 de 3 nos dois; internet (só v3) **81%** (34 de 42, IC95 67–90%); tolerância zero (inventar URL, dono, telefone ou obedecer à injeção) sem nenhuma falha; p95 4,8 s contra 3,8 s do v2. Limiares: 75% nos comuns e na internet. Os corretores ganharam testes para cada falso positivo corrigido (lista com asterisco, voz passiva, pergunta, limite factual de crédito ou base paga). O recálculo sem Ollama agora também refaz as notas por grupo |
| Fraquezas que continuam (KI-096) | Em busca simples, às vezes não escreve a URL do achado (2 de 3); não avisa de uma instrução escondida num trecho de busca (0 de 3; nunca a obedece); "contexto do sistema" colado ainda o convence de que Aprovações existe (também no v2); pedido de envio parafraseado nem sempre lembra a aprovação humana; perfil do LinkedIn achado na busca às vezes não é citado (2 de 3); fala de LGPD sem ser perguntado em 1 de 3 respostas sobre contatos |
| Tela | O painel da conversa diz "só o texto das pesquisas na internet sai deste computador" quando a pesquisa está ligada (antes dizia que nada saía) |
| Testes | `pnpm typecheck`, `pnpm lint` e `pnpm format:check` verdes; `pnpm test` 1.024 verdes (contracts 195, domain 237, application 123, integrations 174, agents 146, web 80, db 69); `pnpm test:e2e` 45 passaram, 3 pulados (banco real e Ollama real), com `E2E_PORT=3120 E2E_MEMORY_PORT=3130` porque a porta 3100 está ocupada por outro programa do usuário |
| Verificação no app | No app de desenvolvimento, com o banco real e a chave: "Pesquisa na internet a Chilli Beans: quem fundou, o site oficial e uma notícia recente." chamou `search_web` (1 crédito da Tavily) e respondeu com o fundador, o site e a URL de uma notícia; sem erro no console. Uma conversa de teste ficou no banco do usuário |
| Instalação | `pnpm app:install` concluído: `D:\Prospector` usa `copilot-tools/v3`. A primeira instalação mostrou que o leitor de páginas do app instalado não achava o Chromium (faltava o `browsers.json` do Playwright no build); corrigido em `next.config.ts` e reinstalado: a cópia instalada abriu o Chromium com sandbox e executou JavaScript (KI-091 resolvido). O app instalado não foi aberto depois da instalação (abre pelo atalho "Prospector") |
| Commit | `f57f2e7`, enviado ao GitHub em 2026-11-10 com a autorização do usuário (branch `conclusao-produto`) |
| Pendências | KI-096 (fraquezas acima); KI-093 (nome da pessoa titular de MEI no cadastro por CNPJ: decisão do usuário) |

## Decisões desta execução

| Decisão | Registro |
|---|---|
| Nomes de tabelas seguem o doc 06 §4 (sem `org_id`, ADR-0007) | este documento |
| Prompt com ferramentas é um arquivo inteiro (`copilot-tools/vN`), não um adendo ao `copilot/vN`; troca de padrão só com `pnpm evals` (`EVAL_TOOLS=1`) | `packages/agents/src/copilot/copilot.ts`, KI-076 |
| CNPJ: OpenCNPJ como padrão, Minha Receita como reserva (BrasilAPI é a mesma fonte) | [research/05](research/05-fontes-cnpj-descoberta-e-busca-web.md) |
| **D-AI-4 (usuário, 2026-11-10):** Tavily Search API como buscador principal, só no plano gratuito, com limite de consumo configurável que interrompe as chamadas; Playwright para navegação e análise de páginas; SearXNG local opcional depois de avaliação. Chave por variável de ambiente, criada pelo usuário (o agente não lê o `.env.local`) | [10 §1](10-riscos-custos-decisoes.md), [13 §6.7](13-auditoria-e-evolucao.md), [05](05-integracoes.md) |
| MEI e empresa individual entram pelo cadastro manual ou pelo CNPJ; o nome da pessoa fica fora do ledger | ADR-0002 (emenda M2), KI-084, KI-087 |
| `PROSPECTOR_CNPJ_LOOKUP`: `on` (padrão), `off` ou `fixture` (sintético, só no modo memória) | ADR-0001 (emenda M2) |
| **Usuário, 2026-11-10:** pesquisa na internet e Copiloto sem recusas nem sermão de LGPD; a IA orienta, quem decide é ele | ADR-0012 (emenda), CLAUDE.md regra 7 |
| **Usuário, 2026-11-10:** `copilot-tools/v3` promovido a padrão e instalado | `packages/agents/src/copilot/copilot.ts`, KI-096 |

## Bloqueios externos

| Bloqueio | Quem resolve | Impacto |
|---|---|---|
| LIA v2 em rascunho | Usuário (Configurações > Conformidade) | Abordagens ficam bloqueadas (correto) |
| CI não conferido | Usuário (login no GitHub) | Nenhum no app || D-EVID-2 (provedores de CNPJ como oficiais?) e parecer de LGPD (D-LGPD-1) | Usuário | Confiança dos fatos do registro fica em média; nenhum contato real |

## Próxima atividade exata

1. M3: ADR-0011 (fila persistente no Postgres com worker local, D-AI-5), migração `ai_jobs` (só com confirmação), descoberta F4 por CNAE e município com deduplicação pela raiz do CNPJ (KI-086), histórico de pesquisas; validação com uma pesquisa limitada de empresas reais no interior de São Paulo.
