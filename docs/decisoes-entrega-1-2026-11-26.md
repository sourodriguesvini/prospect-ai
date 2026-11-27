# Entrega 1 da reestruturação: decisões e estado (26/11/2026)

Registro do que foi feito na primeira entrega da reestruturação aprovada em 26/11/2026. O escopo veio do item 18 da aprovação:
- **Frente 1:** só as mudanças que não exigem migração e não dependem de decisões pendentes.
- **Frente 2:** só a preparação experimental, sem ativar nada.

Proposta completa: `docs/proposta-transformacao-2026-11-26.md`. Auditoria de partida: `docs/auditoria-produto-2026-11-26.md`. Frente 2 em detalhe: `docs/comunicacao-frente-2-experimental.md`.

## 1. Isolamento e limites respeitados

- **Branch:** `conclusao-produto`. Nada foi commitado e nada foi enviado ao GitHub.
- **Trabalho de outras sessões preservado:** o do e-mail (KI-187/188: `email-forms.tsx`, `forms/fields.tsx`, `server/container.ts`, `email-fixture.ts`, `e2e/email.spec.ts`, `ports/email.ts`, `email-settings-service.ts`, `email-image`) e o do programa de desktop (`apps/desktop/`, ADR-0018, `scripts/app/*`, `turbo.json`, `pnpm-lock.yaml`, `eslint.config.mjs`, `check-boundaries.mjs`, `docs/README.md`, ADR-0001). Nenhum desses arquivos foi editado, exceto o acréscimo em `docs/known-issues.md`, que preservou o conteúdo existente.
- **Banco:** nenhuma migração e nenhuma escrita no banco real. Testes e capturas de tela foram feitos no modo memória.
- **IA:** nenhuma avaliação com modelo e nenhum uso de GPU. `copilot/v3`, `relationship-*/v3` e os padrões da `model-policy` não mudaram.
- **Envio e conformidade:** nenhum envio. Aprovação com `payload_hash`, supressão, opt-out e auditoria continuam como estavam.
- **App instalado:** `D:\Prospector` não foi atualizado e só recebe estas mudanças com `pnpm app:install`, que não foi rodado.
- **Configuração local:** `.claude/launch.json` ganhou a configuração `dev-demonstracao` (porta 3140, modo memória), usada só para as capturas de tela.

## 2. O que mudou na Frente 1

### Navegação

**Menu**
- **Antes:** Início, Descoberta, Empresas, Relacionamento, Aprovações, Monitoramento, Inteligência, Copiloto e Configuração.
- **Agora:**
  - jornada: **Hoje, Descobrir, Empresas e Conversas**;
  - apoio: **Copiloto e Resultados**;
  - sistema: **Configurações**, com o submenu Estratégia, Conformidade, E-mail e Histórico de ações.

**Telas fora do menu.** Aprovações e Monitoramento continuam nos mesmos endereços e seguem acessíveis por três caminhos:
- a paleta (Ctrl+K);
- a aba Aprovações dentro de Conversas;
- os links de Hoje.

Nessas telas, o menu acende o item de onde elas saíram: Aprovações acende Conversas e Monitoramento acende Empresas (a trilha do Monitoramento também começa em Empresas).

**Atalhos e endereços**
- Os atalhos seguem as iniciais: G H, G D, G E, G C, G I (Copiloto), G R e G S. **Três mudaram de destino:** G I abria o Início e agora abre o Copiloto, G C agora abre Conversas e G R agora abre Resultados. Quem usava os atalhos antigos precisa se acostumar.
- Na paleta, os nomes antigos (Início, Descoberta, Relacionamento, Inteligência, Configuração, Auditoria) continuam achando as telas.
- Os endereços não mudaram (`/descoberta`, `/relacionamento`, `/inteligencia`, `/configuracoes/auditoria`). Assim, favoritos, o programa de desktop e os links antigos continuam funcionando.

**Nomes alinhados**
- As abas de Conversas passaram a ser Para enviar, Em andamento, Funil e Aprovações.
- O título de cada tela e o título da janela acompanham o nome do menu (Resultados, Histórico de ações, Configurações).

### Hoje (a antiga Início)

A tela lista o que pede ação, na ordem em que vale olhar:
1. empresas prontas para abordar;
2. respostas recebidas;
3. mensagens para revisar ou já aprovadas;
4. follow-ups;
5. pesquisas concluídas com empresas novas;
6. oportunidades da Descoberta, com o botão "Analisar empresa";
7. empresas para rever.

Ao lado ficam o resumo comercial (conversas abertas, valor em negociação com base, prontas para abordar) e o que está em andamento.

O "por quê" de cada oportunidade é, em ordem de preferência:
1. o sinal confirmado mais forte (por exemplo, "Abriu vaga de Analista de Marketing.");
2. o primeiro motivo da triagem que tenha fonte;
3. o primeiro motivo.

Antes era sempre o primeiro motivo da triagem, que às vezes era uma lacuna.

Estados da tela:
- Sem nada pendente, a tela diz que não há nada pedindo atenção e oferece "Nova prospecção".
- Se uma das fontes de dados falhar, avisa qual e mostra o resto.
- O estado do banco e as proteções foram para Configurações › Sistema. Hoje só mostra um aviso quando o banco não está pronto ou no modo de teste.

"Prontas para abordar" deixa de fora:
- empresas com opt-out ou supressão ativa (por id, raiz do CNPJ ou domínio);
- empresas que já têm conversa, aberta ou encerrada.

Se não der para conferir isso (Conversas indisponível), a lista fica vazia e o contador mostra "—": a tela nunca sugere abordar sem ter conferido a supressão. A recomendação vem da última análise que montou diagnóstico; uma atualização cancelada depois não tira a empresa da lista.

Em Mensagens, a tela diz o que o app faz: você revisa e aprova aqui, envia por fora do app pelo canal aprovado e registra o envio. O link "Ver aprovações" aparece sempre.

Implementação: o serviço `TodayService` fica em `packages/application`, com 14 testes. Quando uma parte falha, o servidor registra qual (`[hoje] parte "…" indisponível`) sem detalhe interno na tela.

### Descobrir ligado à análise

- **Um clique.** "Analisar empresa" (antes "Investigar") leva a empresa para Empresas com as fontes da pesquisa **e já começa a análise**. Antes eram dois passos.
- **Aviso na página da empresa.** Diz o que aconteceu, sem afirmar o que não houve: análise iniciada, já em andamento, já analisada, fila cheia, empresa arquivada ou análise indisponível. Essa lógica fica no serviço `analyzeProspect`, com testes.
- **Pesquisa repetida.** Pedir de novo a mesma pesquisa enquanto a primeira está na fila ou rodando abre a que já existe, sem gastar crédito de novo. A comparação considera:
  - o pedido e a cidade, sem acento, maiúsculas ou espaços repetidos;
  - a UF;
  - o alcance: a profundidade e o teto real de empresas que ela permite (pedir 50 numa profundidade que entrega 20 é o mesmo que pedir 20);
  - ICP;
  - sinais.

  Uma pesquisa com cancelamento pedido não é reaproveitada. Dois pedidos iguais ao mesmo tempo viram uma pesquisa só (os pedidos são atendidos um por vez no servidor).
- **Análise sem repetição.** "Analisar empresa" olha as 10 últimas análises da empresa: se uma está rodando, abre a página com o aviso "em andamento"; se alguma terminou, avisa "já analisada", mesmo que uma atualização depois tenha sido cancelada.
- **Ajustes de texto.**
  - A dica de quantidade usa os tetos reais de cada profundidade.
  - As buscas automáticas dizem que marcam as empresas que ainda não tinham aparecido.
  - "Regra do sistema" virou "critério do Prospector".
  - "Salvar" virou "Salvar para depois".
- **Prontidão da Estratégia.** Para descobrir empresas, ela é só orientação (Completo / Incompleto), porque o ICP é opcional. Para abordar pessoas, continua bloqueando, porque ali a regra é de conformidade.

### Página da empresa como relatório comercial

**Topo: "Vale abordar?"** Três dimensões, sem misturar:
- potencial comercial, em linguagem de negócio;
- segurança da análise (o quanto as evidências cobrem);
- com quem falar.

O próximo passo é um só, em destaque, e considera a situação de contato:
- empresa com opt-out ou supressão: **"Não contatar"**, com o motivo e a data, sem botão de mensagem;
- conversa aberta: "Abrir a conversa";
- empresa arquivada ou desqualificada: um aviso no lugar do botão;
- senão, o que a análise recomenda: Preparar mensagem, Confirmar o site (quando falta o site oficial), Atualizar a análise, Continuar a análise (quando a última parou no meio) ou Analisar empresa, com o custo dito antes do clique.

Durante uma atualização, o diagnóstico anterior continua na tela com o aviso "Atualizando a análise". Os avisos que só fazem sentido enquanto a análise roda somem quando ela termina.

**Ordem do conteúdo:** diagnóstico, marca, mercado e "Com quem falar". O painel "Com quem falar" é honesto: o Prospector ainda não guarda contatos de pessoas.

**Cadastro e evidências** ficam recolhidos quando já existe análise. Sem análise, abrem, porque são o que há para ler.

**Painel Análise** (antes Investigação):
- "Analisar empresa" e "Atualizar a análise";
- etapas e uso recolhidos depois de terminar;
- créditos sem o nome do fornecedor.

### Promessas de funções que não existem, removidas

- O painel "Em breve" das Configurações.
- A frase de envios em lote no E-mail.
- Os aprendizados e a calibração em Resultados.
- A tarefa `embedding`, que ninguém usa, no estado da IA local.
- Duas dicas corrigidas:
  - "exemplos ruins": a IA não os recebe;
  - categorias e fontes da LIA: são só registro.

### Textos

- "Preparar abordagem" virou "Preparar mensagem".
- "Abrir oportunidade sem IA" virou "Escrever sem a IA".
- "Pipeline" virou "Funil", também na trilha da oportunidade.
- "Modo memória" virou "Modo de teste" nos avisos, com link para Configurações › Sistema.
- Nos cartões da Descoberta, "Confiança da análise" virou "Confiança da triagem" (é da triagem da pesquisa, não da análise completa).
- A lista de Empresas e o Monitoramento usam os mesmos nomes de recomendação do topo da empresa; o filtro passou a se chamar "Análise" ("Sem análise", "Análise em andamento").
- O painel do dossiê passou a se chamar "Conversas".
- "Bloqueia a prospecção" no E-mail virou "Precisa de ajuste".

## 3. Decisões tomadas nesta entrega

| # | Decisão | Por quê |
|---|---|---|
| D1 | `TodayService` é montado em `apps/web/src/server/today.ts`, fora de `container.ts` | `container.ts` tem mudanças não commitadas do e-mail. Mover para o container depois desse commit (KI-189) |
| D2 | Endereços mantidos e só os nomes mudam | Não quebra favoritos, o programa de desktop nem os testes; renomear rotas pode ser feito depois, com redirecionamento |
| D3 | Aprovações e Monitoramento fora do menu, sem perder acesso | A proposta concentra a ação em Hoje e Conversas; as telas continuam pela paleta, pela aba e pelos links |
| D4 | `prepare_access` aparece como "Vale abordar", com a falta de contato na dimensão "Com quem falar" | Uma boa oportunidade não parece pior só porque o decisor não foi achado. O modelo gravado e o multiplicador 0,8 não mudaram (análise de impacto pendente) |
| D5 | Cadastro e evidências recolhidos só quando existe análise | O relatório vem primeiro; sem análise, o cadastro é o conteúdo útil |
| D6 | A prontidão para descobrir é orientação, não bloqueio | O ICP é opcional e a pesquisa já funcionava sem ele. Abordar pessoas continua bloqueado (conformidade) |
| D7 | Pesquisa igual em andamento é reaproveitada; pesquisa igual já terminada cria outra | Evita gasto duplicado sem impedir de repetir uma pesquisa de propósito |
| D8 | `RECOMMENDATION_LABELS` e o texto das declarações de aprovação ficaram como estavam | O Copiloto usa os rótulos; as declarações fazem parte da conformidade |
| D9 | Na Frente 2, a estratégia aparece no começo do `argument` ("Estratégia consultiva: …") | Sem mudar contrato nem banco enquanto a v4 é experimental |
| D10 | Os exemplos do guia de voz experimental são fictícios e sem nome de pessoa | Regra 4 (sem dado fictício que pareça real) e regra da v4 (sem nome de pessoa) |
| D11 | Em Hoje, "prontas para abordar" falha fechado: sem conferir a supressão, a lista fica vazia | Regra 2 e opt-out: a tela não pode sugerir contato com quem pediu para não receber |
| D12 | Empresa com conversa encerrada também sai de "prontas para abordar" | Quem já recebeu contato não é empresa nova para abordar; retomar é decisão na própria conversa |
| D13 | A recomendação de Hoje e do topo vem da última análise com diagnóstico | Uma atualização cancelada ou sem conclusão não apaga o que já foi analisado |
| D14 | O Copiloto passou a receber os nomes novos das telas (vêm de `modules.ts`) | Ele precisa dizer à pessoa o nome que ela vê no menu. A mudança altera a entrada do modelo e não foi avaliada (KI-194) |
| D15 | Telas fora do menu acendem o item de onde saíram (Aprovações → Conversas, Monitoramento → Empresas) | A pessoa sabe onde está sem que as telas voltem para o menu |
| D16 | "Modo de teste" no lugar de "Modo memória" nos avisos das telas | O nome técnico não dizia que os dados somem ao reiniciar. Ele continua no painel Sistema e no indicador do menu, onde fica o detalhe técnico |
| D17 | Pesquisa igual: comparação pelo alcance, sem reaproveitar a cancelada, um pedido por vez no servidor | Corrige três casos achados na revisão: dois cliques ao mesmo tempo criavam duas pesquisas, uma cancelada era reaproveitada e quantidades diferentes com o mesmo teto contavam como pedidos diferentes |
| D18 | Os atalhos G I, G C e G R mudaram de destino | Seguem as iniciais dos nomes novos; a paleta continua achando os nomes antigos |

## 4. O que ficou de fora e por quê

| Item | Motivo |
|---|---|
| Esconder o limite diário, IMAP só como aviso, legenda do modelo HTML (E-mail) | Mexem em `email-forms.tsx` e `email-settings-service.ts`, com trabalho não commitado de outra sessão (KI-191) |
| Peso da rubrica e "evidências exigidas" | Muda o formulário e o contrato da rubrica; precisa de decisão sobre o que acontece com as versões salvas |
| Preço da oferta opcional | Muda o contrato da oferta e o cálculo do valor em negociação |
| Mensagens de erro que citam variáveis de ambiente | Muda contratos e as mensagens da IA. O detalhe técnico já está em Configurações › Sistema |
| "Descoberta" na frase das ferramentas de rascunho (`system-facts.ts`) e "Descoberta bloqueada" em `strategy-tools.ts` | Mudam o texto que o Copiloto recebe; exigem avaliação (KI-194). A lista de telas que ele recebe já usa os nomes novos (D14) |
| Cartão "Pronto para aprovar mensagens?" em Hoje | A prontidão para abordar fica na aba Conversas; levar para Hoje fica para depois (KI-197) |
| Fonte do "por quê" de cada oportunidade em Hoje | Hoje mostra o motivo, mas não a fonte nem a data dele (KI-197) |
| Teste de ponta a ponta do topo da empresa com diagnóstico | Precisa de uma análise de IA gravada para o modo de teste; o topo está coberto por testes unitários (KI-198) |
| "Investigação" nas telas do Monitoramento, no histórico de ações, na etapa "Em investigação" e nos contratos | Muda contrato, auditoria e e2e; fica para uma entrega própria (KI-196) |
| Demanda explícita × potencial | Exige uma categoria nova de sinal, mudança no prompt do extrator e talvez migração |
| Módulo de contatos | Só planejado (proposta C.7). Envolve dados pessoais e base legal (LGPD) |
| Impacto do multiplicador 0,8 do `prepare_access` | Precisa de análise com dados reais antes de mudar o modelo (KI-190) |
| "Investigação" nos textos que chegam à IA (`NO_SUMMARY_NOTICE`, `NO_READING_NOTICE`) e nos casos da avaliação do Copiloto | Mudar altera a entrada dos modelos; fica para a próxima avaliação (KI-194) |

## 5. Decisões que dependem do usuário

1. Ativar os prompts v4 da estratégia e da mensagem. Antes, é preciso autorizar a avaliação na GPU, seguindo os critérios de `docs/comunicacao-frente-2-experimental.md` §7.
2. Construir o guia de voz real com mensagens e notas suas (§8 do mesmo documento).
3. Implementar a edição assistida (§9), que depende da decisão 1.
4. Escolher os modelos candidatos para a comparação (§10) e autorizar o download.
5. Os itens da seção 4: o que entra na próxima entrega.
6. Renomear também os endereços (`/relacionamento` para `/conversas` etc.), com redirecionamento.
7. Instalar a versão nova no app de `D:\Prospector` (`pnpm app:install`).
8. Pontos de conformidade levantados na revisão, que pedem decisão (e, se for o caso, validação jurídica):
   - **J1.** O opt-out de contato também deve impedir continuar analisando a empresa (B2B)? Hoje a análise continua permitida; só o contato é bloqueado, e a empresa sai de "prontas para abordar".
   - **J2.** O descadastro vai em toda mensagem só até a empresa responder (regra do sistema), enquanto `docs/12` §3 pede "opt-out em toda mensagem". Os textos da tela agora dizem a regra real.
   - **J3.** A origem do contato entra na mensagem só quando a fonte mostra (v3 e v4). Se isso não bastar, a origem deveria ir num rodapé fixo do sistema, sem depender da IA.
   - **J4.** A LIA declara "sem contato pessoal", mas a pesquisa e o Copiloto não filtram dados de pessoas (decisão de 10/11, emenda do ADR-0012). Falta decidir se a LIA deve descrever o uso real. Nenhuma recusa foi reintroduzida.
   - **J5.** Os termos da Hostinger para e-mail comercial (KI-171) continuam pendentes; esta entrega não mexeu nisso.
9. Parecer do `avaliador-ia` sobre a Frente 2: **não ativar a v4 ainda**. Os problemas que ele apontou nos prompts, no guia de voz e nas medidas foram corrigidos (detalhes em `docs/comunicacao-frente-2-experimental.md` §4, §5 e §8); a ativação depende da rodada na GPU e dos critérios do §7.

## 6. Próxima entrega recomendada

1. Commit do trabalho do e-mail e do programa de desktop (outras sessões), seguido do commit desta entrega.
2. `TodayService` para dentro de `container.ts` e os três itens do E-mail adiados.
3. Com autorização, avaliação da v4 contra a v3 (`EVAL_HOLDOUT=1`) e leitura às cegas. Se passar nos critérios, ativação e edição assistida.
4. Módulo de contatos, começando pela revisão de conformidade (base legal e origem de cada contato).
