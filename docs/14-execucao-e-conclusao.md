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
| M0 | Estabilização: git, testes, app instalado, CI | Feito: CI verde no `main` (execução #2, `24a0f87`); a branch `conclusao-produto` ainda não passou pelo CI (bloqueio abaixo) |
| M1 | Copiloto operacional: histórico persistente, ferramentas de leitura, telemetria (`llm_calls`, `tool_calls`) | Feito e verificado (ressalvas no KI-076) |
| M2 | Empresas, consulta de CNPJ, evidências persistentes (ledger), dossiê | Feito e verificado: commit `bcd5444` enviado ao GitHub (branch `conclusao-produto`) |
| M3 | Fila persistente (`ai_jobs`) com worker, descoberta real, deduplicação, histórico de pesquisas; busca web Tavily (D-AI-4) | Feito com ressalvas: pesquisa na internet (D-AI-4) e Copiloto com `copilot-tools/v3` enviados; fila durável e Descoberta (Módulo 01) integradas em `conclusao-produto` (2026-11-11, sem push); migração aplicada; correções do KI-117 sem nova pesquisa real; prompts sem promoção formal (KI-115) |
| M4 | Investigação, auditoria visual, diagnóstico, concorrentes, qualificação | Feito com ressalvas: Módulo 02 ([ADR-0015](adr/0015-investigacao-de-empresas-e-brand-intelligence.md)) integrado em `conclusao-produto` (2026-11-11, sem push); migração aplicada; falta validação real com o banco (KI-135) e a pasta das capturas (KI-136); prompts sem avaliação (KI-131) |
| M5 | Estratégia de abordagem, rascunhos, aprovações, conversas, pipeline | Feito com ressalvas: Relacionamento integrado em `conclusao-produto` (2026-11-11, sem push); migração aplicada (KI-120 resolvido); prompts sem conjunto de avaliação (KI-124); ferramentas do Copiloto esperando o `copilot-tools/v4` (KI-121) |
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
| CI (GitHub Actions) | **Verde no `main`** (conferido pelo agente no Chrome do usuário em 2026-11-10): execução #2, commit `24a0f87`, 3 min 29 s; jobs `checks` e `supabase` passaram (`pnpm test:db` num Supabase local de verdade e e2e com banco). A execução #1 foi cancelada pela #2. A branch `conclusao-produto` só roda CI por pull request (o workflow dispara em push no `main` e em pull request): PR #1 aberto em 2026-11-10 com a autorização do usuário. Execução #3 (`b5501d9`): `checks` verde (um teste de acessibilidade instável passou na nova tentativa); no `supabase`, `pnpm test:db` 70 de 70 num Postgres real (as migrações do M1 ao M3 passaram), mas 2 testes de ponta a ponta do Copiloto falharam só com banco. Corrigido depois: o topo do painel deixava um título sem espaço (URL colada) alargar a página no celular (`PanelHeader`, com teste novo no modo memória); os testes do Copiloto que mandam pergunta não rodam com `E2E_SUPABASE=1` (gravariam no banco); o teste de acessibilidade espera o `<title>` voltar (KI-009) |
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

## Interface — menu lateral fixo, movimento e recursos de interface (2026-11-11)

Pedido do usuário: "Menus fixos, efeitos de motion sutis e recursos avançados de interface tecnológica. Todos os menus devem estar no canto esquerdo, com opção de abrir e esconder." Ele escolheu também a paleta Ctrl+K, os atalhos de teclado, os indicadores no rodapé e a linha de progresso entre telas. Feito numa sessão paralela, no worktree `ui-menu-lateral-52d404`, sem commit.

| Item | Resultado |
|---|---|
| Menu lateral | Um só menu, à esquerda e fixo ao rolar (`apps/web/src/components/shell/`), no lugar da pílula do topo e do trilho de ícones. Tem marca, "Buscar ou ir para…" (Ctrl+K), os grupos Fluxo, Apoio e Sistema, e o submenu da Configuração (Estratégia, Conformidade, Auditoria) dentro do próprio menu. Item ativo em pílula de tinta (`aria-current`), um só destacado. No rodapé ficam os indicadores, o botão Recolher e o tema |
| Recolher | O botão Recolher/Expandir (`aria-expanded`, `aria-controls`) e o Ctrl+B deixam só os ícones, com dica (que fecha com Esc e aceita o mouse em cima) e nome acessível. A escolha fica no cookie `sidebar`, lido no servidor, e a página já chega no estado certo, sem piscar. Recolhido, o tema vira um botão só, que alterna. O item da tela atual rola para a vista, e as bordas do menu ganham sombra quando há mais itens |
| Celular | Abaixo de 768 px o menu vira gaveta, aberta pelo topo (que fica fixo ao rolar). A gaveta é um diálogo modal: o foco vai para "Fechar menu", Tab e Shift+Tab ficam presos nela, e o conteúdo atrás fica `inert`. Esc ou clique fora fecham e devolvem o foco ao botão. Escolher uma tela fecha a gaveta e leva o foco ao conteúdo. A gaveta também fecha se a janela passar a desktop |
| Movimento | Só CSS, sem biblioteca. Painéis entram com deslize curto, em cascata. O menu recolhe com transição de largura. Gaveta, paleta e dicas surgem com um leve aumento. Os ícones crescem um pouco no hover. Com "reduzir movimento" no sistema, tudo é instantâneo (regra global em `tokens.css`, com duração 0s; 0,01ms deixava botões ocultos no instante do foco) |
| Paleta Ctrl+K | Diálogo nativo com combobox e lista (WAI-ARIA APG). Busca telas (inclusive Voz, Cases, LIA e opt-out), ações de criar e de interface (tema, recolher, atalhos) e empresas pela rota `GET /api/busca` (selo DEMO, legível também na opção ativa). A opção ativa é guardada pelo id e não troca quando as empresas chegam. Lista vazia oferece "Buscar “x” em Empresas". Sem banco, diz que não buscou. Anúncio para leitor de tela e botão de fechar visível no toque |
| Atalhos | Ctrl+K, Ctrl+B, "?" (lista de atalhos) e "g + letra" (Início, Descoberta, Empresas, Copiloto, Pipeline, Configuração). Os de uma tecla podem ser desligados na própria lista (WCAG 2.1.4, guardado no navegador). Não valem enquanto se digita nem com um diálogo aberto |
| Indicadores | "Estado deste computador" mostra IA local, pesquisa na internet e banco pela rota `GET /api/estado`, a cada 2 min com a janela visível e ao voltar à janela. Cada estado tem forma própria, não só cor. O detalhe vai como descrição acessível e na dica, com a hora da leitura. Cada indicador leva à tela que explica |
| Progresso | Linha laranja no topo entre telas. Aparece depois de 120 ms (navegação rápida não pisca) e desiste em 15 s |
| Rotas novas | `GET /api/estado` e `GET /api/busca`, só leitura. Contratos Zod nos dois lados. Pedido disparado por outro site é recusado (`Sec-Fetch-Site`, 403). O estado é reaproveitado por 15 s, e uma leitura que falha não derruba as outras (doc 13 §3.2) |
| Revisões | `revisor-arquitetura`: nada bloqueante; aplicados o motivo real da IA fora do ar, os contratos Zod, o cache, a checagem de origem, o aviso sem banco, o erro de configuração isolado e os testes de rota. `revisor-ux`: um bloqueante (selo DEMO invisível na opção ativa) e nove importantes, corrigidos: indicadores com forma, anúncios da paleta, seleção por id, fechar no toque, foco ao fechar a gaveta, item ativo à vista, topo fixo no celular, alvos de toque maiores e borda da caixa no escuro. Ficaram como pendência KI-097 a KI-101 |
| Testes | `pnpm typecheck`, `pnpm lint` e `pnpm format:check` verdes. `pnpm test`: web 133 (eram 116), demais pacotes iguais. `pnpm test:e2e` com `E2E_PORT=3140 E2E_MEMORY_PORT=3150`: 71 passaram e 3 foram pulados (banco real e Ollama real), 24 deles do menu novo (`e2e/shell.spec.ts`, com axe no claro, no escuro, recolhido, na gaveta e na paleta) |
| Verificado na tela | Capturas do Playwright: desktop expandido e recolhido com dica, Configuração em 1366×768, celular fechado e com a gaveta, escuro recolhido, paleta e paleta vazia no escuro. O foco da gaveta também foi conferido no navegador do app |
| Não verificado | Firefox e Safari, leitor de tela real, aparelho de toque de verdade (KI-098). O app instalado em `D:\Prospector` não foi atualizado (`pnpm app:install` não rodou, a pedido) |
| Atenção | Neste computador o navegador informou "reduzir movimento" ligado, provavelmente "Efeitos de animação" desligado no Windows. Por isso o app não anima aqui. Para ver o movimento, ligue esse ajuste do Windows; outra opção é decidir que, com "reduzir movimento", ainda valham esmaecimentos sem deslocamento |
| Commit | Feito na branch `claude/ui-menu-lateral-52d404` a pedido do usuário (sem push) |

## M3, parte 3 — Descoberta Inteligente (Módulo 01, 2026-11-11)

Worktree `C:\dev\prospector\.claude\worktrees\descoberta-m3-a3e577`, branch `claude/descoberta-m3-a3e577` (saiu de `conclusao-produto` em `0805512`). **Nada commitado** (espera a autorização do usuário). Migração aplicada no `prospector-dev` e pesquisa real feita em 2026-11-11, com a confirmação do usuário.

| Item | Resultado |
|---|---|
| Decisões | [ADR-0011](adr/0011-fila-duravel-no-postgres.md) (fila durável `ai_jobs` no Postgres, trabalhador dentro do app) e [ADR-0013](adr/0013-descoberta-inteligente.md) (Descoberta). Emendas: ADR-0002 (triagem fora do ledger até o Investigar), ADR-0004 (nota: para o uso local vale o ADR-0011), ADR-0008 (`format` e teto de tokens da Descoberta) |
| Banco | Migração `20261111120000_discovery.sql`: `ai_jobs`, `discovery_runs`, `discovery_run_queries`, `discovery_prospects`, `discovery_run_prospects`, `discovery_sources`, `discovery_signals`, `discovery_monitors`, RLS fechado, auditoria e guarda de 12 meses. Passou no PGlite e foi **aplicada no `prospector-dev` em 2026-11-11** com a confirmação do usuário (MCP do Supabase, versão alinhada ao nome do arquivo); catálogo conferido: RLS nas 8 tabelas, nenhuma política, nenhum privilégio para `anon`/`authenticated`, funções da fila só para `service_role` |
| Como funciona | Pedido em português → intérprete (`discovery-interpreter/v1`) → plano de buscas dentro do limite da profundidade (rápida 3 buscas, padrão 6, aprofundada 10) → Tavily com cache de 24 horas → filtro de instruções escondidas → extrator (`discovery-extractor/v2`, lote de 8) → conferência no servidor (nome e trecho literal no resultado, site só pelo endereço, data só se estiver no texto, CPF fora do nome, cidade e UF só se estiverem no pedido) → deduplicação (CNPJ, domínio, nome com cidade) → triagem por regras (`discovery-triage/v1`, pesos e portes da Estratégia). Roda na fila, em segundo plano, e retoma do ponto em que parou |
| Telas | `/descoberta` (nova pesquisa, rascunhos do Copiloto, histórico, radar de sinais), `/descoberta/pesquisas/[id]` (andamento, plano, buscas e créditos, empresas), `/descoberta/empresas` e `/descoberta/empresas/[id]` (motivos com fonte, sinais com trecho, Salvar, Ignorar, Investigar), `/descoberta/monitoramentos`. **Investigar** cria ou liga a empresa em Empresas e grava as evidências pelo `EvidenceService` (fato só com trecho literal; idempotente) |
| Monitoramentos | Diário, a cada 3 dias ou semanal, só com o app aberto (KI-109); teto diário de créditos automáticos (`DISCOVERY_DAILY_AUTO_CREDITS`, padrão 12) que conta o comprometido pelas pesquisas na fila; um agendador por vez no mesmo banco (`claimMonitor`) |
| Copiloto | Ferramentas `create_discovery_search` (só rascunho, auditado como do Copiloto, no máximo 3 abertos) e quatro de leitura, entregues só a um prompt da versão 4 em diante. O `copilot-tools/v4` não foi criado: por combinado entre as sessões, junta Descoberta, Empresas e Relacionamento depois da mesclagem; trecho e avaliação do rascunho em `docs/rascunhos/copilot-tools-v4-descoberta.md` (KI-110). O padrão continua `copilot-tools/v3` |
| Avaliação da IA | `packages/agents/evals/discovery` (casos SINTÉTICOS): intérprete v1 90/90, extrator v2 89/90, sem falha de tolerância zero. O `avaliador-ia` recomendou o extrator v2 com ressalvas e **não** recomendou o intérprete v1 (setor estreitado e UF inventada; a parte de região foi corrigida no servidor, KI-115). Sem promoção feita: os prompts estão no código como padrão da Descoberta, mas o módulo só roda com o banco migrado |
| Revisões | `revisor-arquitetura`, `revisor-seguranca`, `revisor-conformidade`, `revisor-ux` e `avaliador-ia` rodaram; os bloqueios corrigidos no código ganharam teste. O que ficou está nos KI-103 a KI-119 |
| Testes | `pnpm typecheck`, `pnpm lint` e `pnpm format:check` verdes; `pnpm test` 1.136 verdes (contracts 195, domain 287, application 155, agents 162, web 81, db 82, integrations 174); `pnpm test:db` (PGlite) 83 verdes. Prompts da Descoberta com sha fixado (`packages/agents/tests/units.test.ts`) e fora do Prettier |
| E2E | `E2E_PORT=3160 E2E_MEMORY_PORT=3170 pnpm test:e2e`: 55 passaram, 3 pulados (banco real e Ollama real). O projeto `descoberta-memoria` (porta 3175, buscador e IA SINTÉTICOS) cobre pesquisa, rascunho, cancelamento, Salvar, Ignorar, Investigar, monitoramento, anúncios e foco depois das ações, páginas 404 e celular sem rolagem lateral |
| Pesquisa real | 2026-11-11, app da worktree com o banco real (porta 3165): "Encontre 15 clínicas de saúde em Ribeirão Preto e região.", profundidade rápida. A IA entendeu setor, região (Ribeirão Preto/SP) e quantidade; planejou 1 busca ("clínica de saúde Ribeirão Preto"), 6 resultados, **1 crédito** (gravado em `provider_usage`); leu 3 páginas iniciais; concluiu em cerca de 1 minuto, tarefa da fila em 1 tentativa. Resultado: 6 empresas reais de Ribeirão Preto, cada uma com fonte e URL (3 com site conferido e prioridade média; 3 com informação insuficiente), 0 sinais (o pedido não pedia sinal), nada inventado. Auditoria `discovery.run.created` pela pessoa. Depois de reiniciar o app, a pesquisa e as 6 empresas continuam (cenário 4). Achados: plano de 1 busca para 15 empresas pedidas e um perfil do Instagram não juntado ao site da mesma clínica (KI-117, **os dois corrigidos no código no mesmo dia**, com testes: o plano completa as buscas de empresas com outras cidades e outros termos do setor, e a deduplicação tira a cidade do fim do nome; não houve nova pesquisa real para conferir, e as duas linhas da Quali Saúde já gravadas continuam separadas); chamadas da IA da Descoberta fora do `llm_calls` (KI-116). "Investigar" não foi usado com o banco real (criaria empresa no cadastro do usuário) |
| Pendências | KI-105 (guarda incompleta), KI-106 (injeção reescrita), KI-110 (Copiloto v4/v5), KI-111 (oferta nos prompts), KI-112 (apagar empresa encontrada), KI-113 (resultados brutos), KI-114 (trechos no ledger), KI-115 (intérprete v2), KI-116 (teto de chamadas), KI-117 (robustez), KI-118 (**decisão do usuário** sobre o alcance da emenda sem recusas, base legal e termos da Tavily), KI-119 (avaliação incompleta) |
| Mesclagem | Conflitos esperados com `claude/ui-menu-lateral-52d404` (`apps/web/src/lib/modules.ts`, `apps/web/e2e/smoke.spec.ts`) e com `claude/relacionamento-102b59` (KI-120 em diante são dela; `modules.ts`) |

## M5 — Relacionamento: abordagens, conversas, pipeline e aprovações (ADR-0014, 2026-11-11)

Feito na worktree `relacionamento-102b59` (branch `claude/relacionamento-102b59`), **sem commit**: commit, migração e instalação esperam a confirmação do usuário.

| Item | Resultado |
|---|---|
| O que existe | Módulo **Relacionamento** com as abas Abordagens, Conversas e Pipeline (quadro e lista), detalhe da oportunidade, fila **Aprovações** e painel no dossiê. Rotas antigas `/abordagens`, `/conversas` e `/pipeline` redirecionam. O app não envia nada: aprovar libera o texto por 72 horas, para um contato só; a pessoa envia por fora e registra |
| Regras | Estado do contato pelo que foi registrado; primeiro contato só por e-mail ou LinkedIn manual, com a agência identificada e o canal do titular; opt-out até a primeira resposta; WhatsApp só depois que a empresa escreveu por lá; rodapé garantido pelo sistema; pedido para parar honrado na hora (regra e IA), com follow-ups cancelados; etapas só mudam por decisão da pessoa |
| IA | Três prompts v1 (`relationship-approach`, `relationship-message`, `relationship-reply`), tarefa `copilot` sem raciocínio, JSON Schema com refs curtas, orçamento de contexto em níveis (`context_too_large` quando nada cabe), pedido de quem dirige a agência fora dos DADOS, resposta da empresa sem o texto citado. `pnpm ai:live` 3 de 3 antes da última revisão; o `avaliador-ia` deu "promover com ressalvas" na segunda revisão, com os ajustes pedidos feitos, e pediu conjunto de avaliação antes do uso real (KI-124) |
| Copiloto | Seis ferramentas só de leitura (agenda, oportunidades, detalhe, pipeline, sugestão de resposta, sugestão de etapa), testadas, atrás do portão `copilotPromptSupportsRelationshipTools` (v4 ou maior). Trecho do v4 em `docs/rascunhos/copilot-tools-v4-relacionamento.md`; o v4 não foi criado (KI-121) |
| Banco | Migração `20261111170000_relationship.sql` (8 tabelas, 2 views, 5 RPCs), RLS sem políticas, travas de colunas e de status final. Testada em PGlite; aplicada ao `prospector-dev` depois da integração (seção abaixo) |
| Testes | `pnpm typecheck`, `pnpm lint` e `pnpm format:check` verdes; `pnpm test` 1.177 verdes (contracts 195, domain 297, application 161, agents 173, web 84, db 93, integrations 174); `pnpm test:db` (PGlite) 93 verdes; `pnpm test:e2e` 55 passaram e 3 pulados (banco real e Ollama real), com `E2E_PORT=3220 E2E_MEMORY_PORT=3230`, incluindo os 9 cenários do Relacionamento (A, B e J, C, D, E, F, celular, pedido para parar) |
| Pendências | KI-120 a KI-128; KI-129 (diagnóstico de Empresas na abordagem) resolvido no código, falta validar com o modelo (KI-124) |

## M4 — Investigação de empresas e Brand Intelligence (Módulo 02, 2026-11-11)

| Item | Resultado |
|---|---|
| Onde foi feito | Sessão "Empresas e Brand Intelligence", worktree `claude/empresas-brand-714583`. A Descoberta (fila `ai_jobs`, ADR-0011 e ADR-0013) é de outra sessão: aqui não há segunda fila nem segunda tabela de empresas |
| Decisão | [ADR-0015](adr/0015-investigacao-de-empresas-e-brand-intelligence.md), Proposto |
| Migração `20261111150000_company_investigations` | Escrita e testada em PGlite; aplicada no `prospector-dev` depois da integração (seção abaixo). `company_investigations` (etapas, consumo, retrato da coleta, mudanças, composição do diagnóstico; uma ativa por empresa; dono e batimento), view `company_investigation_summaries`, `confirm_company_site`; auditoria na mesma transação; RLS sem acesso para `anon` e `authenticated` |
| Investigação | 11 etapas idempotentes (contexto, site, páginas, captura, negócio, marca, sinais, concorrentes, comparação, diagnóstico, qualificação), cada uma `done`, `reused`, `skipped` ou `failed` com o motivo em pt-BR; fila em processo com cancelamento e retomada (`interrupted` na subida); conclusões só no ledger (fato, inferência, hipótese) |
| Auditoria visual | Captura real com Playwright (computador 1280 px e celular 390 px, JPEG com altura limitada), medições no DOM e análise com visão pelo gateway (`qwen3.5:4b`, `num_ctx` 12.288, `keep_alive` 2 min) contra a rubrica da oferta. Imagens guardadas só com `PROSPECTOR_CAPTURES_DIR` (pasta local fora do C:, sem rede nem nuvem), uma por janela e por empresa; site que pede para não guardar cópia (`noarchive`) não tem imagem guardada |
| Qualificação | Domínio puro: Fit, Oportunidade e Confiança separados, gates, potencial, prioridade e recomendação por oferta ativa (doc 08 §3) |
| Telas | Dossiê com Diagnóstico, Marca e site, Investigação (etapas, custo, cancelar, investigar de novo) e Histórico de mudanças; lista de empresas com a última investigação; rota local das capturas |
| Copiloto | `get_company_investigation`, `list_company_opportunities`, `start_company_investigation` (põe na fila uma tarefa interna; não envia nada a ninguém). Registradas, mas fora do app até ser promovida uma versão de `copilot-tools` que as declare em `TOOLS_PROMPT_CAPABILITIES`. O trecho do prompt ficou em rascunho (`docs/rascunhos/copilot-tools-empresas.md`), não promovido: o `copilot-tools/v4` unificado é montado depois da mesclagem (KI-130) |
| Revisões (2026-11-11) | Arquitetura, segurança, conformidade, UX e IA. Corrigido com teste: leitura da IA por oferta como claim no ledger (`readingClaimId`); execução encerrada imutável no banco (`investigation_finished`); rota das capturas confere o Host local e lê pelo serviço, só imagem apontada por claim da própria empresa, `no-store`; captura antiga apagada quando entra a nova e quando o site passa a pedir `noarchive`; pasta das capturas recusa rede, nuvem e `..`; empresa arquivada não é investigada (`company_archived`); registros vindos da web marcados `fonte_externa`; resultados das ferramentas sem ordens ao modelo; gate do Copiloto por capacidade declarada; `qwen3-vl` fora da lista de visão; padrão de orçamento e sinais de prêmio e aniversário mais estreitos; decodificação de URL que não quebra com `%`. O que ficou aberto está nos KI-138 a KI-146 |

### Validação com empresas reais (2026-11-11)

Feita no app de desenvolvimento em **modo memória** (sem banco: a migração não está aplicada), porta 3196, com as 3 ofertas e os 3 ICPs reais do usuário recriados iguais na memória (lidos do `prospector-dev` só para leitura; rubrica e modelo de score iguais ao padrão). Sem banco a busca da Tavily fica desligada, então sinais e concorrentes não rodaram. Nenhum crédito gasto, nenhum contato, nada gravado no banco do usuário.

| Empresa | O que rodou | Resultado |
|---|---|---|
| Dpot (`dpot.com.br`, design de móveis, São Paulo/SP, cadastro manual sem CNPJ) | 1 página lida, 2 capturas, 16 fatos medidos, 3 análises da IA local (70 s de GPU), 0 buscas | "Concluída com lacunas". Recomendação **Sem base suficiente**, próximo passo "Investigar mais", confiança geral 44. Ofertas: Site institucional (prioridade 29; Fit 100 com 1 de 4 critérios conhecidos, Oportunidade 62, Confiança 44), Identidade visual (27) e Rebranding (25). Leitura central como inferência de confiança baixa (54%); 3 hipóteses "a verificar"; 4 conclusões da IA descartadas na verificação; lacunas listadas (sem concorrentes, sem sinais, sem decisor, sem CNPJ, poucas fontes) |
| Lattoog (`lattoog.com`, design autoral de móveis, Rio de Janeiro/RJ conforme o próprio site) | 2 páginas lidas, 2 capturas, 3 análises da IA local, 0 buscas | Recomendação **Acompanhar**, confiança geral 41. Identidade visual (prioridade 24; Fit 100 com 1 de 3, Oportunidade 42, Confiança 41; desqualificador "Já tem manual de marca recente" acionado sem fato que o sustente, KI-133); Rebranding e Site institucional "Sem base suficiente" (17). 4 hipóteses, uma interrompida no meio da frase |
| Dpot, reinvestigação | Páginas iguais; as 2 análises da IA foram recusadas pela admissão de memória de vídeo (precisava de 4,1 GB + 3 GB de reserva, havia 6,9 GB livres: a GPU estava em uso por outro programa do usuário) | "Concluída com lacunas" em cerca de 1 min; diagnóstico reaproveitado da anterior; Histórico: "Nenhuma mudança encontrada". Paradas aqui as rodadas de IA para não disputar a placa com o usuário |

O que a validação mostrou e foi corrigido na hora (com teste): a seleção de páginas não reconhecia "a dpot" (institucional) nem "coleção" (produtos); o contraste de texto sobre imagem de fundo contava como baixo (KI-137); afirmação interrompida pelo modelo virava claim (agora é descartada); o aviso de pasta das capturas dizia que a marca fora analisada só pelo texto (as imagens vão ao modelo, só não ficam guardadas).

O que continua (sem correção nesta entrega): o modelo de 4B exagera nas inferências e chegou a contradizer uma medição ("falta de imagens" com 5 imagens medidas) (KI-131); Fit 100 com um critério conhecido (KI-132, decisão de metodologia); desqualificador sustentado por fato sem relação (KI-133).

### Cenários da especificação

| Cenário | Situação |
|---|---|
| A — Investigação real | Parcial: duas empresas reais, fontes e síntese gravadas (na memória); sem Receita (cadastro manual) e sem busca |
| B — Auditoria visual | Feito com ressalvas: capturas reais, análise com visão e conclusões ligadas às medições e às imagens; qualidade do modelo em KI-131; imagens não guardadas na validação (sem pasta; guardar e apagar coberto por testes, KI-136) |
| C — Concorrência | Não verificado com empresa real (precisa de busca, logo de banco); coberto por testes com fixtures |
| D — Diagnóstico | Feito: fatos, inferências e hipóteses com fonte e confiança no dossiê |
| E — Serviço recomendado | Feito com ressalvas: recomendação conservadora e justificada, sem afirmação comercial inventada; KI-132 e KI-133 |
| F — Informações insuficientes | Feito: "Sem base suficiente", lacunas listadas, nada completado por imaginação; IA indisponível tratada sem quebrar |
| G — Persistência | Não verificado no app (modo memória); coberto por testes de banco (PGlite). Depende da migração |
| H — Atualização | Parcial: reinvestigação reaproveitou o diagnóstico e não achou mudança; mudança real não observada (coberta por testes, inclusive "cenário H" sem crédito nem GPU na segunda rodada) |
| I — Copiloto | Não verificado no app (o prompt com as ferramentas ficou em rascunho até o v4 unificado); coberto por testes das ferramentas (estado real da tarefa, nunca "concluída" ao pôr na fila) e por avaliações pequenas (KI-130) |
| J — Integração com a Descoberta | Não verificado no app (a Descoberta está em outra branch, sem botão ligando as duas telas); a investigação recebe o id da empresa já cadastrada (gatilho `discovery`), sem recadastro; teste "cenário J" |

### Testes e avaliação

| Item | Resultado |
|---|---|
| `pnpm typecheck`, `pnpm lint`, `pnpm format:check` | Verdes |
| `pnpm test` (fixtures, sem rede nem Ollama) | 1.148 verdes: contracts 195, domain 288, application 148, integrations 189 (inclui captura em Chromium real sem rede), agents 159, web 91, db 78 |
| `pnpm test:db` (PGlite) | 76 verdes, inclusive a guarda que recusa mudar execução encerrada |
| `pnpm test:e2e` (`E2E_PORT=3180 E2E_MEMORY_PORT=3190`, modo memória, sem Ollama) | 47 passaram, 3 pulados (precisam de banco real ou Ollama real); inclui investigar uma empresa pela tela até o fim |
| Avaliação do rascunho (avaliado com o id "v4", hoje em `docs/rascunhos/copilot-tools-empresas.md`) | Oito rodadas pequenas (`EVAL_WEB=1 EVAL_PROMPTS=3,4`, `qwen3.5:4b`, até 3 repetições), internet e empresas SINTÉTICAS, com 7 textos diferentes sob o id "v4". O texto que está no disco só foi avaliado numa rodada (17-33: comuns 4 de 9, investigação 7 de 9, `pedido-de-envio` 0 de 3) e depois ganhou uma correção de texto sem nova rodada. Melhor rodada dos comuns: 15/21 contra 18/21 do v3. Não promovido (KI-130). `pnpm evals` completo não rodou |
| Prompts das análises | v1, sem conjunto de avaliação (KI-131) |

| Pendências | KI-130 a KI-146 |
|---|---|

## Integração dos módulos em `conclusao-produto` (2026-11-11)

Pedido do usuário: "depois que todas essas tarefas que estão em execução terminarem […] você já implementa tudo, deixa tudo pronto […] para mim já testar aqui na minha máquina". Mesclagens e commits locais em `conclusao-produto` (sem push); migrações com a confirmação dele ("Sim, pode aplicar").

| Item | Resultado |
|---|---|
| Mesclagens | Interface (PR #2, `d2a985c`), Descoberta (Módulo 01, `85b3646`), Relacionamento (Módulo 03, `d60d08c`), registro do KI-129 (`e6e18f0`), Empresas (Módulo 02, `c6f4647`) e o diagnóstico de Empresas na abordagem do Relacionamento (KI-129, `82ad929`, feito pela sessão do Relacionamento depois da mesclagem) |
| Correções da integração | Links internos só com uma barra (`InternalHref`: `//site` e `/\site` não passam na busca da paleta nem no estado do sistema); erro inesperado do `/api/estado` não fica guardado no cache; tipo de referência novo `discovery_prospect` (a Descoberta reusava `opportunity`, que agora é do Relacionamento); portões das ferramentas do Copiloto por capacidade declarada (`TOOLS_PROMPT_CAPABILITIES`), com Descoberta, Relacionamento e investigação desligadas até um `copilot-tools/v4` avaliado; ferramentas `draft` e `queue` descritas nos fatos do sistema; nomes repetidos entre módulos renomeados (`parseDiscoveryModelJson`, `siteRegistrableDomain`); cartões da página inicial lidos do Relacionamento ("Aprovações pendentes", "Oportunidades abertas"); atalho `g r` (Relacionamento) no lugar do `g p`; menu, paleta e e2e com Descoberta e Relacionamento prontos e Inteligência e Monitoramento "em breve" |
| Migrações | `20261111150000_company_investigations` e `20261111170000_relationship` **aplicadas no `prospector-dev` em 2026-11-11** (MCP do Supabase; versões alinhadas aos nomes dos arquivos). Antes, conferido que as duas só criam objetos novos e que as tabelas novas não existiam. Depois: RLS nas 9 tabelas novas, nenhuma política, nenhum privilégio para `anon`/`authenticated`; alertas de segurança do Supabase só com o aviso informativo de RLS sem política, que é o desenho (regra 3) |
| Testes (em `82ad929`) | `pnpm typecheck`, `pnpm lint` e `pnpm format:check` verdes; `pnpm test` 1.483 verdes (contracts 195, domain 398, agents 201, application 230, web 155, db 115, integrations 189); `pnpm test:db` (PGlite) 112 verdes; `pnpm test:e2e` (`E2E_PORT=3120 E2E_MEMORY_PORT=3130`) 90 passaram e 3 pulados (banco real e Ollama real), nos projetos `estrategia-memoria`, `descoberta-memoria` e `relacionamento-memoria` |
| Prompts | Nenhum promovido na integração. Padrão do Copiloto continua `copilot-tools/v3`. Descoberta (`discovery-interpreter/v1`, `discovery-extractor/v2`), Relacionamento (três v1) e análises de Empresas (v1) rodam como padrão dos módulos, sem promoção formal do usuário (KI-115, KI-124, KI-131) |

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
| Fila durável no próprio Postgres (`ai_jobs`), trabalhador dentro do app, um por banco (`PROSPECTOR_JOB_WORKER`) | ADR-0011 |
| Descoberta pela internet (Tavily + IA local) em vez de base CNPJ por filtros; triagem fora do ledger até o Investigar | ADR-0013, emenda do ADR-0002 |

## Bloqueios externos

| Bloqueio | Quem resolve | Impacto |
|---|---|---|
| LIA v2 em rascunho | Usuário (Configurações > Conformidade) | Abordagens ficam bloqueadas (correto) |
| CI do PR #1 com a correção ainda não conferido | Usuário (autorizar commit e push da correção) | Nenhum no app; as migrações já passaram em Postgres real na execução #3 |
| D-EVID-2 (provedores de CNPJ como oficiais?) e parecer de LGPD (D-LGPD-1) | Usuário | Confiança dos fatos do registro fica em média; nenhum contato real |
| Alcance da emenda "sem recusas" na coleta recorrente da Descoberta, base legal para MEI e termos da Tavily (KI-118) | Usuário | Nenhum no app; decisão de conformidade |

## Próxima atividade exata

1. Teste do usuário no app instalado (`D:\Prospector`), com o banco real: uma pesquisa da Descoberta (confere o KI-117), uma investigação de empresa (KI-135) e uma abordagem até a aprovação, sem envio.
2. Push de `conclusao-produto` e PR, com autorização do usuário.
3. `copilot-tools/v4` unificado (Descoberta, Empresas e Relacionamento; KI-110, KI-121, KI-130), com `pnpm evals` e aprovação do usuário.
4. Decisões dos prompts dos módulos (KI-115, KI-124, KI-131) e o KI-118.
