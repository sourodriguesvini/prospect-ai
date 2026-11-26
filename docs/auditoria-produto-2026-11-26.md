# Auditoria do Prospector (26/11/2026)

> Retrato do produto na branch `conclusao-produto` (último commit `83c26c1`), mais as mudanças ainda sem commit do KI-187 (conferência das imagens da assinatura de e-mail) e do KI-188 (campos de seleção que voltavam ao valor inicial depois de um erro). A auditoria foi só de leitura: este é o único arquivo criado, nada foi enviado e nenhum dado foi gravado.

## Como esta auditoria foi feita

- **Código e documentos:** li `apps/web`, todos os `packages/*`, `supabase/migrations`, `scripts/app` e `docs/`.
- **App instalado:** abri as telas do app instalado (`D:\Prospector`, porta 3210) só para olhar. Não cliquei em salvar, aprovar, enviar, pesquisar nem investigar. Tudo o que aparece como "observado" vem dessas telas, em 26/11/2026.
- **Levantamentos e conferência:** fiz seis levantamentos em paralelo:
  - moldura e telas de apoio;
  - Descoberta e Empresas;
  - Relacionamento, Aprovações e e-mail;
  - IA;
  - banco e infraestrutura;
  - pendências e documentação.

  Antes de entrar neste documento, conferi de novo no código os achados mais fortes.
- **Fora do escopo:** o programa de desktop com Electron (`apps/desktop/`, ADR-0018). Ele existe só na árvore local, sem commit, e é trabalho de outra sessão.

**O que não verifiquei**

| Item | Por quê |
|---|---|
| Envio real de e-mail, incluindo o teste para a própria caixa | Não fazia parte desta auditoria; o comportamento descrito vem do código |
| Qualidade real das respostas da IA | Não rodei `pnpm evals` nem `pnpm ai:live`, que ocupam a GPU. As notas citadas vêm do `docs/14-execucao-e-conclusao.md` |
| Testes automatizados | Não rodei `pnpm test`, `pnpm test:db` nem o e2e |
| Banco real | Não consultei o Supabase direto; os dados reais citados vieram das telas |
| Cifra usada pelo Supabase Vault | A documentação do Supabase fala em AEAD da libsodium; o repositório não permite confirmar |
| Visibilidade do repositório no GitHub | O KI-009 registra que ele estava público em 10/11/2026; não conferi hoje |
| Agendador de monitoramentos ao longo de vários dias | Só lido no código |

## Resumo em dez pontos

1. **O Prospector é um app local, de uma pessoa só, que leva uma empresa de "encontrada na internet" até "conversa em andamento".** Usa IA local (Ollama, modelo `qwen3.5:4b`) e banco no Supabase. Descoberta, Empresas (investigação), Relacionamento, Aprovações, Copiloto, Monitoramento e Inteligência já rodam com dados reais.
2. **Não envia nada para as empresas.** O único envio real é o e-mail de teste para a própria caixa. Na prospecção, o usuário aprova o texto, copia, envia pelo webmail ou pelo LinkedIn e volta ao app para registrar. As respostas também são coladas à mão.
3. **Não existe cadastro de pessoas: nem contato, nem decisor, nem destinatário.** Isso tem três efeitos:
   - os e-mails começam com "Olá." sem nome;
   - a qualificação nunca recomenda "Abordar agora";
   - toda prioridade sai multiplicada por 0,8.
4. **As mensagens soam robóticas por causa de instruções concretas:**
   - o guia de voz gravado é um rascunho genérico que o próprio sistema criou;
   - os tons não têm definição;
   - o prompt tem 17 regras, quase todas proibições;
   - a abertura é obrigatória ("Sou da …");
   - a despedida é posta pelo código;
   - o rodapé legal vai em toda primeira mensagem;
   - o gancho costuma ser um defeito técnico do site.

   Detalhes na seção 6.
5. **Descoberta e investigação estão desligadas uma da outra.** "Investigar" na Descoberta cria a empresa e grava evidências, mas não investiga. A investigação de verdade exige um segundo clique, no dossiê, e nada avisa isso.
6. **A investigação roda numa fila em memória.** Reiniciar o app interrompe o que estava rodando, e a retomada é manual. A Descoberta, ao contrário, usa uma fila que fica no banco e sobrevive a reinícios.
7. **Algumas telas prometem o que o código não faz:**
   - a Estratégia diz que a Descoberta está "Bloqueada", e não está;
   - a tela de e-mail fala em "aprovação em lote" e "limite de envios por dia", que não existem;
   - o monitoramento diz mostrar "só o que é novo", mas mostra tudo;
   - o painel de IA diz "ainda não usado" para tarefas que estão em uso.
8. **Algumas configurações são gravadas e ninguém as lê:** o peso e as evidências exigidas da rubrica, os exemplos ruins do guia de voz, as categorias e origens da LIA, o limite diário da caixa de e-mail.
9. **O e-mail pela caixa da agência está pela metade.**
   - Prontos: identidade, caixa, senha no Vault, conferência de SPF/DKIM/DMARC, prévia e teste.
   - Não existem: destinatário, fila em lote, envio, leitura de respostas e servidor MCP.
   - Além disso, os termos do provedor de e-mail proíbem prospecção fria (KI-171).
10. **A documentação geral ficou para trás do código.** O README diz que só a F1 está pronta. A matriz do doc 13 marca Descoberta e Relacionamento como não implementados. ADRs já implementados continuam como "Proposto".

---

## 1. Visão geral do produto

**O que é.** Uma ferramenta interna de prospecção para uma agência de branding e identidade visual. Ela ajuda a responder, nesta ordem:
- quais empresas valem a pena;
- o que se sabe de verdade sobre cada uma;
- qual serviço faz sentido oferecer;
- o que escrever;
- em que pé está cada conversa.

**Para quem.** Uma pessoa, no próprio computador. Não tem login, equipe nem várias empresas no mesmo sistema (ADR-0007). O app só aceita conexões do próprio computador (`127.0.0.1`).

**Princípios que aparecem em todo o código**
- **Evidência antes de opinião.** Toda conclusão sobre uma empresa vira uma afirmação do tipo fato, inferência ou hipótese, com fonte, data e confiança calculada pelo servidor. Esse registro é o livro de evidências (ADR-0002). A IA não grava texto livre: uma afirmação dela só vira fato se a citação aparecer literalmente na fonte.
- **Nada sai sem aprovação humana.** Cada mensagem tem uma impressão digital do conteúdo (hash). A aprovação vale para aquele texto exato, por 72 horas e uma única vez.
- **IA local.** Toda chamada de modelo vai para o Ollama, no próprio computador, pelo gateway de `packages/agents`. A IA não custa dinheiro; o custo é GPU e tempo.
- **Pendências registradas.** Os problemas ficam em `docs/known-issues.md`; hoje são 108 não resolvidos.

**Os módulos, na ordem do trabalho**

| Módulo | O que faz | Estado |
|---|---|---|
| Estratégia e Conformidade | Ofertas, perfil de cliente ideal (ICP), voz da agência, cases, LIA e texto de opt-out | Funciona |
| Descoberta | Do pedido em linguagem natural às buscas na internet, e daí a empresas e sinais triados | Funciona |
| Empresas | Cadastro (pelo CNPJ ou manual), investigação em 11 etapas, dossiê com evidências e qualificação | Funciona, com fila frágil |
| Relacionamento | Estratégia de abordagem, mensagens com versões, registro de envios e respostas, pipeline, follow-ups e "Não contatar" | Funciona, com envio manual |
| Aprovações | Fila dos rascunhos esperando decisão | Funciona, uma aprovação por vez |
| E-mail | Quem assina, caixa de envio, conferência e prévia | Só a configuração |
| Copiloto | Conversa com a IA local, que consulta estratégia, empresas e internet sem alterar nada | Funciona, com menos ferramentas do que o app tem |
| Monitoramento | Empresas para olhar de novo e novidades | Primeira parte |
| Inteligência | Funil e consumo do mês | Primeira parte |
| Configuração › Auditoria | Últimas 100 ações registradas | Funciona |

**Infraestrutura**
- Next.js 16 rodando no computador: porta 3000 em desenvolvimento, 3210 no app instalado em `D:\Prospector`.
- Banco Postgres no Supabase gratuito (`prospector-dev`, em São Paulo).
- IA no Ollama local.
- Busca na internet pela Tavily; leitura de páginas e capturas de tela pelo Playwright.
- Dados de CNPJ pelo OpenCNPJ, com o Minha Receita de reserva.
- E-mail pela caixa SMTP/IMAP do usuário.

---

## 2. Mapa de funcionalidades

Legenda de estado:
- **Completa:** faz o que promete, com dados reais.
- **Parcial:** faz só uma parte, ou funciona só em alguns casos.
- **Só estrutura:** existe no código ou no banco, mas nada usa.
- **Não existe.**

### 2.1 Moldura do app

| Funcionalidade | Para que serve e o que o usuário faz | Por dentro | Estado |
|---|---|---|---|
| Menu lateral | Navegar entre os módulos; recolher com Ctrl+B | `lib/modules.ts` e `lib/navigation.ts`; estado no cookie `sidebar` | Completa |
| Paleta Ctrl+K | Ir a telas; criar oferta, empresa ou conversa; trocar o tema; buscar empresa | A busca chama `GET /api/busca` (até 6 resultados) | Completa |
| Atalhos "G + letra" | Navegar pelo teclado | `app-shell.tsx`. Aprovações, Monitoramento e Inteligência ficaram sem atalho | Completa |
| Estado do sistema (rodapé do menu) | Ver se a IA, a pesquisa e o banco estão no ar | `GET /api/estado`, lido a cada 2 minutos | Completa |
| Proteção local | Impedir acesso de fora do computador | `src/proxy.ts`: confere Host, Origin e Sec-Fetch-Site; CSP com nonce | Completa |

### 2.2 Estratégia e Conformidade

| Funcionalidade | O que o usuário faz | Onde fica | Quem usa | Estado |
|---|---|---|---|---|
| Ofertas (com versões) | Cria e edita nome, descrição, problemas, sinais, desqualificadores, entregáveis, propostas de valor e faixa de preço; ativa e arquiva | `offers` e `offer_versions` (versões imutáveis) | Investigação, Relacionamento, Copiloto | Completa. O preço é exigido para ativar, mas nada o usa |
| Rubrica de auditoria | Define os critérios da avaliação visual: identificador, nome, o que observar, peso, evidências exigidas | `audit_rubrics` | Análise visual da investigação, que usa só identificador, nome e descrição | Parcial: o peso e as evidências exigidas não são usados |
| Modelo de score | Pesos e limiares de prioridade | `scoring_models` | Qualificação (usa tudo); triagem da Descoberta (só os pesos, sem "Necessidade") | Completa |
| ICP (com versões) | CNAEs, UFs, municípios, porte, idade da empresa e exclusões | `icp_profiles` e versões | Descoberta: UF, município, porte, exclusões. Qualificação: CNAE, idade | Completa. A Descoberta usa o primeiro ICP ativo, sem deixar escolher |
| Voz da agência (com versões) | Resumo, princípios, o que evitar, exemplos bons e ruins | `voice_guides` | Relacionamento, que recebe tudo menos os exemplos ruins | Parcial |
| Cases | Título, segmento, resultados, autorização para citar | `proof_assets` (sem versões) | Relacionamento, só os cases autorizados | Completa. Hoje não há nenhum cadastrado |
| Prontidão ("Pode abordar?" e "Pode descobrir?") | Mostra o que falta configurar | `domain/strategy/readiness.ts` | Abordagem: bloqueia de verdade. Descoberta: só aparece na tela | Parcial (ver 9.2) |
| LIA (com versões) | Escreve, aprova com data de revisão, revoga | `legal_basis_assessments` | Libera a abordagem; só conta se está aprovada e dentro do prazo | Completa como documento |
| Texto de opt-out | Nome da agência, canal do titular e o texto | `contact_policies` | Prompt e rodapé de toda primeira mensagem | Completa |

### 2.3 Descoberta

| Funcionalidade | O que o usuário faz | Por dentro | Saída | Estado |
|---|---|---|---|---|
| Pesquisa por pedido | Escreve o pedido (8 a 500 caracteres) e, se quiser, usa filtros | Fila `ai_jobs` no banco; a IA interpreta; regras montam até 12 buscas; a Tavily busca; a IA extrai empresas e sinais; regras conferem; o site é lido; triagem | `discovery_runs`, `discovery_prospects`, `discovery_signals`, `discovery_sources` | Completa |
| Triagem | Nada; é automática | Regra `discovery-triage/v1`, com os pesos do modelo de score e bloqueios (órgão público, ensino, domínio estrangeiro, exclusões do ICP, já é cliente) | Prioridade alta, média ou baixa, com motivos e fontes | Completa |
| Decidir sobre a empresa encontrada | Salvar, Ignorar (com motivo), Voltar | Muda a situação da empresa | — | Completa. Não há como apagar (KI-112) |
| "Investigar" | Clica no cartão da empresa | Cria a empresa ou a liga a uma existente. Grava os resultados de busca como hipóteses; os sinais viram fato quando confirmados e hipótese quando não | Empresa em Empresas, marcada "em investigação" | **Parcial: não investiga** |
| Radar de sinais | Só lê | Sinais dos últimos 30 dias | — | Completa. Inclui empresas ignoradas |
| Monitoramentos | Cria um pedido recorrente (frequência, buscas, empresas); roda na hora; pausa | Agendador dentro do app, com teto diário de créditos automáticos (padrão 12) | Novas execuções | Parcial: só roda com o app aberto, e "só o que é novo" não se cumpre |
| Rascunhos vindos do Copiloto | — | As ferramentas existem, mas o prompt em uso não as liga | — | Só estrutura |

### 2.4 Empresas

| Funcionalidade | O que o usuário faz | Por dentro | Saída | Estado |
|---|---|---|---|---|
| Cadastro pelo CNPJ | Digita o CNPJ | OpenCNPJ, com o Minha Receita de reserva. Não guarda sócios, e-mail, telefone nem endereço | `companies` e evidências `registry.*` | Completa |
| Cadastro manual | Informa nome, CNPJ, site, cidade e UF | — | `companies` | Completa |
| Editar cadastro | — | — | — | **Não existe** (KI-081) |
| Ligar CNPJ depois | Digita o CNPJ e confirma o nome | Vira evidência, mas não preenche `companies.cnpj` (KI-160) | — | Parcial |
| Investigação | "Investigar empresa", "Investigar de novo", "Coletar tudo de novo", cancelar, retomar | 11 etapas (ver 4.2). Fila em memória: uma por vez, até 20 esperando | `company_investigations`, evidências, capturas em disco | Completa no que faz, mas frágil (KI-134) |
| Confirmar o site | Escolhe entre até 6 candidatos ou digita o endereço | — | Domínio da empresa | Completa |
| Análise de marca | Nada; faz parte da investigação | Capturas em computador e celular, medição de cores e tipografia, IA de visão | Evidências `visual.*` | Completa com a pasta de capturas configurada |
| Concorrentes e diagnóstico por oferta | Nada | Até 3 buscas e 3 concorrentes; IA de diagnóstico | Leitura por oferta, ângulo de abordagem, objeções | Completa; depende de oferta ativa |
| Qualificação | Nada | Regras: Fit, Necessidade, Força das evidências, Prioridade, Recomendação | Recomendação: "Abordar agora", "Preparar acesso", "Investigar mais" ou "Descartar" | Completa, mas "Abordar agora" nunca aparece |
| Etapa da empresa | Muda à mão | `companies.lifecycle` | — | Completa. Convive com a etapa do pipeline, um segundo sistema de etapas |
| Contatos e decisores | — | O banco aceita evidências do tipo `contact`, mas nada as grava | — | **Não existe** |

### 2.5 Relacionamento e Aprovações

| Funcionalidade | O que o usuário faz | Por dentro | Saída | Estado |
|---|---|---|---|---|
| Preparar abordagem | No dossiê, escolhe oferta, tipo de mensagem, tom e, se quiser, faz um pedido à IA | Confere prontidão e base de evidências; monta o contexto; IA (`relationship-approach/v3`); conferência automática com até uma correção | Oportunidade, plano de abordagem e mensagem versão 1 | Completa, mas sem transação (KI-127) |
| Abrir oportunidade sem IA | Clica | RPC `open_opportunity` | Oportunidade "identificada" | Completa |
| Mensagens | Nova com IA (tipo, tom, canal), escrever à mão, editar, reescrever com IA, descartar | `relationship-message/v3`; cada mudança cria uma versão | `outbound_messages` | Completa |
| Aprovação | Marca "Revisei este texto…" e aprova | Hash SHA-256 de canal, assunto e corpo. Confere supressão, conformidade e pendências do texto. Vale 72 h e uma vez | `approvals` | Completa, uma por vez |
| Envio | Copia o texto e envia por fora | — | — | **Não existe no app** |
| "Já enviei" | Informa data, função da pessoa e se quer mover a etapa | Consome a aprovação | `interactions`, registro de saída | Completa |
| Registrar resposta | Cola o texto recebido | Procura palavras de pedido para parar e, se achar, suprime a empresa | `interactions`, registro de entrada | Completa |
| Interpretar resposta | Clica "Interpretar com a IA" | `relationship-reply/v1`: classificação, objeções, próximo passo, resposta sugerida, dias até o follow-up | `interactions.analysis` | Completa. Suprime a empresa sozinha quando a confiança é média ou alta |
| Follow-ups | Cria, conclui, cancela, remarca | Tabela `tasks`; vencem às 9h | Lembretes na tela | Completa. Nada é enviado |
| Pipeline | Muda a etapa no detalhe; vê em kanban ou em lista | 10 etapas, com histórico | `opportunity_stage_changes` | Completa. O kanban não deixa arrastar |
| Não contatar (supressão) | Marca o motivo; retira com justificativa | Vale também para a mesma raiz de CNPJ e o mesmo domínio | `suppression_entries` | Completa |
| Fila em lote, envio agendado, limite diário | — | — | — | **Não existe** (ADR-0016, fatia E4) |

### 2.6 E-mail (Configuração › E-mail)

| Funcionalidade | O que o usuário faz | Por dentro | Estado |
|---|---|---|---|
| Quem assina | Nome, cargo, redes, imagens da faixa e dos ícones, cor | `sender_identities`, com versões. As imagens são baixadas e conferidas ao salvar (KI-187, sem commit) | Completa |
| Caixa de envio | Servidores SMTP e IMAP, usuário, limite diário | `mailboxes`, com configuração pronta da Hostinger | Completa, mas o limite diário não é usado |
| Senha | Digita uma vez | Guardada no Supabase Vault; nunca volta a aparecer | Completa |
| Testar conexão | Clica | Login SMTP e IMAP; consulta de SPF, DKIM e DMARC; no máximo um teste a cada 10 s | Completa |
| Prévia | Vê o modelo em HTML e em texto | `renderEmail` (`email-layout/v1`) com dados de exemplo | Completa |
| E-mail de teste | Envia para a própria caixa | Único envio SMTP real do app; no máximo 1 por minuto | Completa |
| Destinatário, fila, envio de prospecção, leitura de respostas, MCP | — | Planejados nas fatias E2, E4, E5, E6 e E7 | **Não existem** |

### 2.7 Copiloto, Monitoramento, Inteligência e Auditoria

| Funcionalidade | O que faz | Estado |
|---|---|---|
| Copiloto: conversa | Perguntas e respostas com a IA local, com a resposta aparecendo enquanto é gerada; histórico no banco; renomear e arquivar conversas | Completa |
| Copiloto: ferramentas | Lê estratégia, empresas e dossiês; pesquisa e lê páginas na internet | Parcial: as ferramentas de Descoberta, Investigação e Relacionamento existem, mas estão desligadas |
| Copiloto: painel IA local | Mostra GPU e modelos na memória; libera memória | Completa, mas marca como "ainda não usado" tarefas que estão em uso |
| Monitoramento: "Para olhar de novo" | Lista as empresas vencidas conforme a recomendação: 7 ou 30 dias | Parcial (KI-180): sem frequência própria e sem alerta |
| Monitoramento: Novidades | Mudanças entre investigações e empresas novas dos monitoramentos | Completa |
| Inteligência: funil | 7 etapas, do mês ou desde o início | Completa. Conta por período, não por grupo de empresas (KI-182) |
| Inteligência: consumo | Gasto, gerações da IA, créditos da Tavily, falhas | Parcial: as chamadas de IA da Descoberta não são registradas (KI-184) |
| Inteligência: aprendizados | — | Não existe (KI-181) |
| Auditoria | Mostra as 100 últimas ações | Completa, sem filtro nem paginação |

---

## 3. Telas e navegação

### 3.1 Estrutura

```
Menu lateral (fixo e recolhível; vira gaveta no celular)
├── Fluxo
│   ├── Início                (G I)   /
│   ├── Descoberta            (G D)   /descoberta
│   ├── Empresas              (G E)   /empresas
│   └── Relacionamento        (G R)   /relacionamento  [abas: Abordagens · Conversas · Pipeline]
├── Apoio
│   ├── Copiloto              (G C)   /copiloto
│   ├── Aprovações                    /aprovacoes
│   ├── Monitoramento                 /monitoramento
│   └── Inteligência                  /inteligencia
└── Sistema
    └── Configuração          (G S)   /configuracoes
        └── submenu (só aparece dentro de Configuração):
            Estratégia · Conformidade · E-mail · Auditoria
Rodapé do menu: IA local · Pesquisa na internet · Banco
```

- **Paleta (Ctrl+K):**
  - todas as telas, mais Voz da agência, Cases, LIA e Texto de opt-out;
  - criar empresa, oferta ou conversa;
  - tema claro, escuro ou do sistema;
  - busca de empresas.
- **Atalhos:** Ctrl+K, Ctrl+B, `?` (lista de atalhos) e "G + letra". Podem ser desligados.
- **Janelas de diálogo:** quase não há.
  - As confirmações usam caixas de marcar ou o `confirm()` do navegador, nas ações destrutivas: arquivar case, "Coletar tudo de novo", aprovar a LIA.
  - Os formulários longos ficam em seções recolhíveis na própria página.
- **Mensagens de retorno:** chegam pela URL (`?aviso=...`) e aparecem no topo da tela de destino.
- **Endereços antigos:** `/abordagens`, `/conversas` e `/pipeline` levam às abas novas do Relacionamento.
- **Erros:**
  - A página "não encontrada" fica fora da moldura, sem menu.
  - Um erro dentro do app mantém o menu e mostra "Tentar de novo", com um código para procurar no terminal.

### 3.2 Tela por tela

**Início (`/`)**
- **Para quê:** painel do dia.
- **Mostra:**
  - estado do banco;
  - proteções da instalação ("Só local" e "Aprovação: Obrigatória" são textos fixos);
  - quantos registros de demonstração existem;
  - quatro cartões: aprovações pendentes (leva a `/aprovacoes`), empresas consultadas (`/empresas`), oportunidades abertas (pipeline) e gasto no mês (`/inteligencia`);
  - funil resumido;
  - as 5 últimas ações da auditoria.
- **Ações:** "Auditoria" (botão principal do painel do banco) e "Configuração". Nada é gravado.
- **Depende de:** banco. Sem banco, os cartões mostram "—".
- **Observado em 26/11:** 3 aprovações pendentes, 8 empresas, 4 oportunidades abertas, US$ 0,00.

**Descoberta (`/descoberta`)**
- **Para quê:** começar uma pesquisa e ver o que apareceu.
- **Mostra:**
  - formulário "Nova pesquisa", com os créditos restantes da Tavily;
  - até 6 oportunidades de prioridade alta ou média;
  - radar com até 8 sinais dos últimos 30 dias;
  - 8 pesquisas recentes;
  - links para "Empresas encontradas" e "Monitoramentos".
- **Ação:** "Pesquisar", que cria a pesquisa e leva a `/descoberta/pesquisas/[id]`.
- **Depende de:** banco, chave da Tavily e Ollama. Sem busca configurada, o botão fica desativado e mostra o motivo.
- **Observado:** 67 de 900 créditos usados no mês.

**Pesquisa (`/descoberta/pesquisas/[id]`)**
- **Mostra:**
  - o estado: na fila, rodando (com a etapa e quantas buscas já foram), concluída, parcial, falhou ou cancelada;
  - "Como o pedido foi entendido": setor, região, sinais, quantidade, profundidade, o que foi preenchido por padrão e cada busca com resultados e créditos;
  - as empresas encontradas, em cartões.
- **Ações:**
  - "Cancelar pesquisa";
  - "Tentar de novo", escondido quando o problema é crédito ou configuração;
  - "Pesquisar de novo";
  - em cada cartão: Investigar, Salvar, Ignorar, Voltar;
  - "Monitorar este pedido", que abre o formulário de monitoramento já preenchido.
- **Atualização:** a cada 4 s enquanto a pesquisa roda.

**Empresas encontradas (`/descoberta/empresas`) e detalhe (`/descoberta/empresas/[id]`)**
- **Lista:** até 60 cartões, com filtros por situação, prioridade e sinal.
- **Detalhe:**
  - resumo da IA, marcado como "não é evidência";
  - CNPJ achado no site;
  - triagem com pontos, cobertura, bloqueios e motivos com fonte;
  - "O que falta saber";
  - sinais com confiança e fontes.
- **Ações:** as mesmas do cartão. Se a empresa já foi "investigada", o botão vira "Atualizar as evidências em Empresas".

**Monitoramentos (`/descoberta/monitoramentos`)**
- **Mostra:** cada monitoramento com frequência, limites, próxima execução, execuções perdidas e link para a última; um aviso sobre o teto diário.
- **Ações:** criar (nome, pedido, frequência, buscas, empresas), "Rodar agora", pausar, retomar, arquivar.

**Empresas (`/empresas`)**
- **Mostra:** tabela com recomendação, prioridade, oferta, última coleta e etapa; busca, filtros por etapa e por investigação, ordem por prioridade.
- **Ações:** "Adicionar empresa" leva a `/empresas/nova`; clicar na linha abre o dossiê.
- **Limite:** lê no máximo 100 empresas, e os filtros e a ordem valem só para elas.
- **Inconsistência:** a lista mostra "Sem CNPJ" olhando só o campo `cnpj`, enquanto o dossiê considera também o CNPJ ligado depois. A mesma empresa pode aparecer sem CNPJ na lista e com CNPJ no dossiê.

**Nova empresa (`/empresas/nova`)**
- Duas formas: pelo CNPJ (consulta a Receita) ou manual. Se a empresa já existe, abre o dossiê dela.

**Dossiê (`/empresas/[id]`)**
- **Para quê:** reunir tudo o que se sabe da empresa e o que fazer com ela.
- **Coluna principal:**
  - Diagnóstico: recomendação, confiança geral, leitura por oferta;
  - Marca e site: capturas, cores, tipografia, auditoria visual;
  - Negócio e concorrência;
  - Cadastro e identificadores;
  - Evidências, agrupadas por fonte, com histórico.
- **Coluna lateral:**
  - Etapa;
  - Investigação: andamento das 11 etapas, histórico e "O que mudou";
  - Relacionamento: preparar abordagem ou abrir oportunidade;
  - Receita Federal: consultar de novo ou ligar um CNPJ.
- **Ações:**
  - Investigação: "Investigar empresa", "Investigar de novo", "Coletar tudo de novo" (pede confirmação), cancelar e "Retomar de onde parou".
  - Site e etapa: "É este" (confirma o site) e mudar a etapa.
  - Relacionamento: "Preparar abordagem" (cria a oportunidade e leva a ela) e "Abrir oportunidade sem IA".
  - Receita Federal: "Consultar a Receita".
- **Atualização:** a cada 5 s durante a investigação.
- **Observado:** um dossiê real tinha cerca de 66 mil caracteres numa página só.

**Relacionamento › Abordagens (`/relacionamento`)**
- **Mostra:**
  - o checklist "Pode abordar?", com 10 itens e links para resolver cada um;
  - os rascunhos para revisar;
  - as abordagens preparadas.
- **Ações:** só links.

**Relacionamento › Conversas (`/relacionamento/conversas`)**
- **Mostra:**
  - contadores de follow-ups vencidos, follow-ups para hoje, rascunhos e oportunidades abertas;
  - "Para acompanhar hoje": follow-up vencido, sem resposta há 5 dias ou parada há 30;
  - "Em contato".
- Não é caixa de entrada: nenhum e-mail aparece aqui.

**Relacionamento › Pipeline (`/relacionamento/pipeline`)**
- Kanban ou lista (`?vista=lista`), com ou sem as oportunidades encerradas.
- A soma de valores conta só os que têm base declarada.
- Cada cartão leva ao detalhe. Não dá para arrastar.

**Oportunidade (`/relacionamento/oportunidades/[id]`)**
- **Mostra:**
  - estratégia: oportunidade, com quem falar (só a função), por que este canal, argumento, próximo passo, evidências que a sustentam, lacunas e riscos;
  - mensagens com versões, avisos da conferência automática e pendências que bloqueiam a aprovação;
  - linha do tempo da conversa;
  - etapa;
  - follow-ups;
  - detalhes: oferta, prioridade, valor, base do valor, próximo passo, prazo, motivo de perda;
  - "Não contatar".
- **Ações:**
  - estratégia: "Preparar de novo", "Descartar estratégia";
  - mensagens: "Nova mensagem com a IA", "Escrever à mão", "Editar o texto", "Reescrever com a IA";
  - aprovação: "Aprovar para uso", "Revogar a aprovação", "Preparar para aprovar de novo";
  - conversa: "Já enviei: registrar o contato feito", "Registrar resposta recebida", "Interpretar com a IA", "Usar como rascunho de resposta", "Marcar follow-up em N dias", "Registrar nota";
  - oportunidade: mudar a etapa, salvar os detalhes, marcar "Não contatar".
- **Não existem:** botão de copiar o texto, link `mailto:` e envio.

**Aprovações (`/aprovacoes`)**
- **Mostra:**
  - "Esperando sua decisão": cada rascunho com o mesmo cartão da oportunidade;
  - "Decisões recentes": as últimas 50, com estado e validade.
- **Ação:** aprovar. Para registrar o envio, é preciso ir até a oportunidade.
- **Observado:** 3 pendentes, uma aprovação revogada e uma vencida. Uma mensagem aparece com ponto duplo: "A aprovação venceu. Revise e aprove de novo..".

**Copiloto (`/copiloto`)**
- **Coluna esquerda:**
  - conversas: até 50, com as arquivadas recolhidas;
  - painel IA local: GPU, modelos na memória, "Liberar memória", modelo por tarefa, modelos instalados e limites.
- **Área principal:**
  - três sugestões de pergunta;
  - campo de até 8.000 caracteres e seletor de modelo;
  - "Pensar antes de responder" e enviar ou parar;
  - em cada resposta, as consultas feitas, o raciocínio (recolhível) e as métricas (tokens e tokens por segundo).
- **Observado:**
  - três modelos instalados;
  - "Análise" e "Imagens" aparecem como "ainda não usado";
  - a busca semântica aparece como "não instalado".

**Monitoramento (`/monitoramento`)**
- **"Para olhar de novo":** resumo de vencidas, em andamento e em dia.
- **"Novidades":** até 60 itens, com filtro por origem.
- **Única ação:** "Investigar de novo", só nas vencidas, que leva ao dossiê.

**Inteligência (`/inteligencia`)**
- **Mostra:** funil em 7 etapas ("Este mês" ou "Desde o início") e consumo do mês: gasto, gerações por modelo, créditos da Tavily, falhas.
- Só leitura.
- **Observado:**
  - Funil: 152 encontradas, 9 em Empresas, 7 investigadas, 4 com abordagem, 0 contatadas.
  - Uso da IA: 104 gerações, 8 com falha.

**Configuração (`/configuracoes`)**
- **Cartões:** Estratégia, Conformidade, E-mail, Auditoria.
- **"Em breve", sem link:** Tela de integrações, Agentes (F5), Pedidos de titulares (F9), Uso e orçamento (F13).

**Estratégia (`/configuracoes/estrategia/**`)**
- **Visão geral:** prontidão em duas listas, ofertas, voz, cases e conformidade.
- **Oferta:**
  - nova oferta;
  - detalhe: ativar, arquivar, voltar para rascunho, rubrica, modelo de score, ICPs e histórico;
  - editores de rubrica e de score.
- **ICP:** ativar, "Pausar" (que na verdade volta para rascunho) e arquivar.
- **Voz:** com versões.
- **Cases:** lista, novo, editar e arquivar com confirmação.

**Conformidade (`/configuracoes/conformidade/**`)**
- Situação da LIA e suas versões.
- Aprovar a última versão em rascunho, com data de revisão obrigatória, ou revogar.
- Opt-out com histórico.
- Formulários já preenchidos com o texto padrão.

**E-mail (`/configuracoes/email`)**
- **Seções:**
  - quem assina;
  - caixa de envio;
  - senha;
  - "Testar conexão": cada item aparece como "Bloqueia a prospecção:" ou "Aviso:";
  - "Enviar e-mail de teste para mim";
  - prévia num quadro isolado, mais a versão em texto.
- **Observado:** caixa conferida, com SMTP e IMAP ok, SPF ok, DKIM ok e DMARC com política `none`.
- Esta tela e o Relacionamento não têm nenhum link entre si.

**Auditoria (`/configuracoes/auditoria`)**
- Tabela das 100 últimas ações: quando, quem, ação e entidade.
- A entidade aparece como `tipo · uuid`, e 24 tipos de ação aparecem como código, sem tradução.

### 3.3 Rotas de API e de arquivos

| Rota | Para quê |
|---|---|
| `GET /api/estado` | Indicadores do rodapé do menu |
| `GET /api/busca?q=` | Busca de empresas da paleta |
| `POST /api/copiloto` | Conversa do Copiloto, com a resposta chegando aos poucos (NDJSON) |
| `GET /empresas/[id]/capturas/[arquivo]` | Imagem de uma captura de tela; só é servida se uma evidência da empresa apontar para ela |
| `GET /configuracoes/email/previa` | HTML da prévia do e-mail, com política de segurança restrita |

Todas as gravações passam por server actions (os arquivos `actions.ts` de cada tela), não por rotas de API.

---

## 4. Fluxo operacional completo

### 4.1 Visão geral

```
[0] Estratégia pronta (uma vez)
        │
[1] Pesquisa na Descoberta ──► [2] Triagem automática ──► usuário: Salvar / Ignorar / Investigar
                                                                         │
                                         (ou cadastro direto pelo CNPJ)  ▼
                                                            [3] Empresa criada em Empresas
                                                                         │  (segundo clique)
                                                                         ▼
                                                            [4] Investigação (11 etapas)
                                                                         │
                                                            [5] Dossiê e qualificação
                                                                         │
                                                            [6] Preparar abordagem (IA)
                                                                         │
                                                            [7] Revisar e aprovar
                                                                         │
                                         ┌───────────── fora do app ─────┤
                                         ▼                               │
                                 usuário envia pelo webmail ou LinkedIn  │
                                         │                               │
                                         └──► [8] "Já enviei" (registro) ◄┘
                                                                         │
                                                            [9] Resposta colada → IA interpreta → nova mensagem
                                                                         │
                                                            [10] Follow-ups, etapas, ganho ou perda, "Não contatar"
```

### 4.2 Etapa por etapa

**[0] Estratégia pronta**
- **Quando:** na primeira vez, ou quando a prontidão aponta o que falta.
- **O usuário informa:**
  - oferta, com preço, rubrica e score;
  - ICP;
  - voz da agência;
  - texto de opt-out e canal do titular;
  - LIA aprovada;
  - cases, que são opcionais.
- **Automático:** o sistema calcula a prontidão e oferece modelos-padrão de rubrica e de score.
- **Gera:** versões imutáveis de cada configuração.
- **Resultado:** "Pode abordar?" liberado. A Descoberta funciona mesmo sem nada disso.
- **Onde ver:** Configuração › Estratégia e Relacionamento › Abordagens.

**[1] Pesquisa**
- **Quando:** o usuário clica "Pesquisar" na Descoberta, ou um monitoramento chega à hora de rodar.
- **O usuário informa:** o pedido em texto livre e, se quiser, cidade, UF, quantidade, profundidade e sinais.
- **Automático:**
  - a IA interpreta o pedido;
  - regras corrigem a interpretação, tirando lugar ou sinal que não estava no pedido;
  - regras montam até 12 buscas, e a Tavily as executa;
  - a IA extrai empresas e sinais, em lotes de 8 resultados;
  - regras exigem que o nome da empresa apareça no texto e que o sinal cite o texto literalmente;
  - o site de cada empresa é lido para conferir nome, CNPJ e cidade.
- **Gera:** a pesquisa, as buscas, as empresas encontradas, as fontes e os sinais.
- **Resultado:** lista de empresas com prioridade.
- **Custo:** até 10 créditos por pesquisa; são 3, 6 ou 10 buscas, conforme a profundidade.
- **Onde ver:** `/descoberta/pesquisas/[id]`.

**[2] Triagem e decisão**
- **Automático:** a prioridade sai de regras.
  - Usa os pesos do score, sem "Necessidade".
  - Uma dimensão sem evidência vale 40.
  - Os bloqueios forçam prioridade baixa.
- **Manual:** Salvar, Ignorar ou Investigar.
- **Próxima:** "Investigar" leva a empresa para Empresas.

**[3] Empresa em Empresas**
- **Quando:** o usuário clica "Investigar" na Descoberta ou cadastra a empresa (pelo CNPJ ou à mão).
- **Automático, quando vem da Descoberta:**
  - cria a empresa ou a liga a uma existente;
  - grava os resultados de busca como hipóteses;
  - grava os sinais como fato quando confirmados e como hipótese quando não;
  - leva o domínio junto só se o site foi conferido.
- **O que não acontece:** a investigação não começa e a Receita não é consultada.
- **Resultado:** a empresa aparece em Empresas, ainda sem diagnóstico.
- **Próxima:** o usuário precisa abrir o dossiê e clicar "Investigar empresa". A tela não avisa isso.

**[4] Investigação**
- **Quando:** o usuário clica "Investigar empresa" no dossiê ou "Investigar de novo" no Monitoramento.
- **Automático, em 11 etapas:**

| # | Etapa | Quem faz | O que produz |
|---|---|---|---|
| 1 | Contexto | Regra | Carrega a empresa, as evidências e as ofertas ativas |
| 2 | Site | Regra e busca (1 crédito, só quando falta o domínio) | Site conhecido, ou até 3 candidatos e a pendência "sem site" |
| 3 | Páginas | Leitura | Página inicial e até mais 3; tenta achar o CNPJ e conferir na Receita |
| 4 | Captura | Playwright | Imagens em computador e celular; cores; tipografia |
| 5 | Negócio | IA (`company-business/v1`) | Fatos com citação (ofertas, públicos, diferenciais) e inferências (proposta de valor, tom) |
| 6 | Visual | IA de visão (`brand-visual/v1`) | Auditoria visual pela rubrica |
| 7 | Sinais | Busca (1 crédito) e regras | Troca de marca, expansão, lançamento, contratação e outros, como hipóteses |
| 8 | Concorrentes | Até 3 buscas e IA (`competitor-triage/v1`) | Até 3 concorrentes |
| 9 | Análise competitiva | IA (`competitive/v1`) | Comparação |
| 10 | Diagnóstico | IA (`diagnosis/v1`) | Síntese, hipóteses, leitura por oferta, ângulo de abordagem, objeções |
| 11 | Qualificação | Regra | Fit, Necessidade, Força das evidências, Prioridade, Recomendação |

- **Tempo:** num caso real, 1 min 39 s.
- **Gera:**
  - registro em `company_investigations` (andamento, diagnóstico, qualificação, retrato da empresa, mudanças);
  - evidências;
  - capturas em disco.
- **Resultado:** "completa", "parcial" (sobrou alguma pendência) ou "falhou".

**[5] Dossiê e qualificação**
- **O usuário lê:** o diagnóstico e a recomendação.
  - "Abordar agora" nunca aparece, porque depende de um contato conhecido, que não existe.
  - O mais alto possível é "Preparar acesso", e a tela não explica o que fazer com isso.
- **Manual:** decidir se aborda, confirmar o site, mudar a etapa da empresa.

**[6] Preparar abordagem**
- **Quando:** o usuário clica "Preparar abordagem" no painel de Relacionamento do dossiê.
- **O usuário informa:** oferta, tipo da primeira mensagem, tom (Consultivo, Direto, Próximo ou Formal) e, se quiser, um pedido para a IA.
- **Automático:**
  - confere a prontidão, se a empresa está arquivada ou suprimida, se a oferta está ativa e se há base mínima de evidências;
  - monta o contexto (ver 6.3) e chama a IA;
  - confere a resposta: fonte, nomes inventados, tom, proporção, nome da agência e formato;
  - se algo falhar, faz **uma** chamada de correção; o que continuar errado vira aviso para quem revisa;
  - o código acrescenta a despedida e o rodapé.
- **Gera:**
  - oportunidade na etapa "Abordagem preparada", com prioridade fixa "média";
  - plano de abordagem;
  - mensagem, versão 1.
- **Onde ver:** `/relacionamento/oportunidades/[id]`, Abordagens e Aprovações.

**[7] Revisar e aprovar**
- **Manual:**
  - ler o rascunho;
  - editar (cada edição cria uma versão nova);
  - reescrever com a IA, dizendo "O que mudar";
  - aprovar.
- **Automático:** a aprovação fica bloqueada se houver:
  - marcador entre colchetes;
  - e-mail sem assunto;
  - primeira mensagem sem o nome da agência, sem o canal de privacidade ou sem o opt-out.
- **Gera:** aprovação válida por 72 h, de uso único, presa ao hash do texto.

**[8] Envio e registro**
- **Fora do app (manual):**
  - selecionar o texto (não há botão de copiar);
  - descobrir o endereço da pessoa (o app não guarda);
  - colar no webmail ou no LinkedIn e enviar.
- **De volta ao app:** "Já enviei", com a data, a função da pessoa e, se quiser, a mudança para "Contatada".
- **Automático:** confere a aprovação e a consome.
- **Gera:** um registro de saída. Fica guardado só o assunto, não o corpo.

**[9] Resposta**
- **Manual:** copiar a resposta do webmail e colar em "Registrar resposta recebida".
- **Automático:** se o texto parece um pedido para parar, a empresa é suprimida na hora.
- **Com clique:**
  - "Interpretar com a IA" devolve classificação, objeções, próximo passo, resposta sugerida e sugestão de follow-up.
  - "Usar como rascunho de resposta" cria uma mensagem nova e volta ao passo [7].

**[10] Acompanhamento**
- Follow-ups criados à mão, ou pelo atalho da interpretação. Vencem às 9h e aparecem em Conversas.
- Etapas mudadas à mão no detalhe, até ganha ou perdida; perdida exige motivo.
- "Não contatar" a qualquer momento.

### 4.3 Caminhos alternativos

- **Entrar direto por Empresas:** cadastrar pelo CNPJ e investigar, sem passar pela Descoberta.
- **Abrir oportunidade sem IA:**
  - a oportunidade nasce como "Oportunidade identificada";
  - a mensagem pode ser escrita à mão ou pedida à IA depois;
  - se depois o usuário usar "Preparar abordagem", a etapa não muda (bug 2 da seção 9.3).
- **Monitoramento:** pedidos recorrentes geram pesquisas sozinhos, desde que o app esteja aberto e dentro do teto diário.
- **Copiloto:** consulta e explica, mas não age; não leva a nenhuma etapa do fluxo.

### 4.4 Interrupções

| Situação | O que acontece |
|---|---|
| Sem chave da Tavily, ou busca desligada | A Descoberta fica bloqueada. Na investigação, as etapas de site, sinais e concorrentes ficam sem resultado |
| Ollama fora do ar | A pesquisa falha antes de gastar crédito. Na investigação, as 5 etapas de IA falham. Abordagem e interpretação dão erro |
| Créditos do mês esgotados | A pesquisa falha ou termina parcial. "Tentar de novo" some sem dizer quando volta |
| App reiniciado | A pesquisa volta sozinha para a fila. A investigação fica "interrompida" e precisa de "Retomar de onde parou" |
| Sem banco | Quase nada funciona. No modo memória, a abordagem nunca é liberada |
| Aprovação vencida (72 h) | É preciso clicar "Preparar para aprovar de novo" e aprovar outra vez, mesmo com o texto igual |
| Pedido para parar | A empresa é suprimida na hora. As tarefas dela e das relacionadas (mesma raiz de CNPJ ou mesmo domínio) são canceladas |
| Falta de memória de vídeo | A IA recusa ou espera; a mensagem nem sempre é clara (KI-167) |

---

## 5. IA e automações

### 5.1 Provedor e modelo

- **Provedor:** Ollama, local, em `127.0.0.1:11434`. Nada de IA sai do computador. Não há provedor remoto; o Claude é só uma possibilidade futura (ADR-0008).
- **Modelo:** `qwen3.5:4b` para tudo, sem modelo reserva automático. Há outros dois modelos instalados, mas nenhum é padrão de tarefa nenhuma.
- **Política** (`packages/agents/src/model-policy.ts`):

| Tarefa do gateway | Contexto | Temperatura | Quem usa |
|---|---|---|---|
| `copilot` | 16.384 tokens | 0,4 | Copiloto e **todo o Relacionamento** |
| `reasoning` | 8.192 | 0,2 | Descoberta e as análises de texto da investigação |
| `vision` | 12.288 | 0,2 | Análise visual da investigação |
| `embedding` | — | — | Ninguém |

- **Limites de recurso:**
  - uma geração por vez, com fila de 3;
  - uma tarefa só começa se sobrar memória de vídeo, guardando 3 GB para os outros programas;
  - o modelo fica pouco tempo carregado depois de usado (`keep_alive` curto);
  - as variáveis `AI_NUM_CTX` e `AI_KEEP_ALIVE` valem para todas as tarefas.
- **Formato:**
  - as respostas estruturadas pedem um JSON Schema no campo `format` do Ollama e são validadas com Zod no servidor;
  - os erros saem sempre como `AiErrorCode`, com mensagem em português.

### 5.2 As 12 capacidades de IA

| Capacidade | Prompt em uso | Para quê | Avaliação registrada (doc 14) |
|---|---|---|---|
| Copiloto (conversa) | `copilot/v3` | Responder perguntas | — |
| Copiloto (com ferramentas) | `copilot-tools/v3` (v4 a v6 guardados) | Responder usando 9 ferramentas internas e 3 de internet | 65%, abaixo do limiar de 75%; a v6 teve 74% |
| Intérprete da Descoberta | `discovery-interpreter/v4` | Entender o pedido | 95,0% |
| Extrator da Descoberta | `discovery-extractor/v2` | Achar empresas e sinais nos resultados | 87,7% a 90,2% |
| Negócio | `company-business/v1` | Ofertas, público, proposta de valor | 91% |
| Visual | `brand-visual/v1` | Auditoria visual | 95% |
| Triagem de concorrentes | `competitor-triage/v1` | Escolher concorrentes | 87% |
| Competitiva | `competitive/v1` | Comparar | Sem avaliação |
| Diagnóstico | `diagnosis/v1` | Síntese e leitura por oferta | 86% |
| Estratégia de abordagem | `relationship-approach/v3` | Plano e primeira mensagem | 91% a 96% |
| Mensagem | `relationship-message/v3` | Novas mensagens e reescrita | 96% a 97,5% |
| Leitura de resposta | `relationship-reply/v1` | Classificar a resposta e sugerir o próximo passo | Sem avaliação |

Observações:
- As notas medem **se as regras foram cumpridas**: não inventar lugar, não usar palavras de intensidade, pôr o nome da agência na primeira frase, escrever em parágrafos e assim por diante. Nenhum caso mede se o texto soa natural.
- A leitura de resposta não tem avaliação e, mesmo assim, pode suprimir uma empresa sozinha.
- Existem versões mais novas (v2 e v3) dos prompts da investigação, mas elas não foram promovidas.

### 5.3 O que é IA e o que é regra

**Feito pela IA**
- Entender o pedido da Descoberta.
- Extrair empresas e sinais.
- Analisar negócio, visual e concorrentes.
- Fazer o diagnóstico.
- Escrever a estratégia e as mensagens.
- Ler as respostas recebidas.
- Conversar no Copiloto.

**Feito por regra (código que dá sempre o mesmo resultado)**
- Corrigir a interpretação do pedido, montar as buscas e eliminar duplicatas.
- Conferir se o nome e a citação aparecem no texto e se o site é o da empresa.
- Triagem da Descoberta e bloqueios.
- Confiança das evidências: qualidade da fonte × atualidade.
- Qualificação, prioridade e recomendação.
- Conferência das mensagens, despedida, rodapé e pendências que bloqueiam a aprovação.
- Aprovação, hash, validade, supressão e detecção de pedido para parar.

### 5.4 Agentes, contexto e memória

- **Não há agentes conversando entre si.** Cada capacidade é uma chamada isolada, e o encadeamento passa pelo banco: a investigação grava evidências e o Relacionamento as lê.
- **Contexto:** cada chamada recebe um bloco de dados em JSON, marcado como "dado, nunca instrução". Conteúdo vindo da internet é sempre tratado como dado.
- **Onde ficam os resultados:**

| Resultado | Onde fica |
|---|---|
| Evidências | `claims` |
| Investigação | `company_investigations` |
| Mensagens | `outbound_messages` |
| Leitura de resposta | `interactions.analysis` |
| Conversa do Copiloto | `copilot_messages` |
| Registro das chamadas de IA e das ferramentas | `llm_calls` e `tool_calls` |

- **Memória e limites do Copiloto, por pergunta:**
  - lê até 60 mensagens e envia 24 ao modelo;
  - até 8 rodadas e 6 ferramentas por geração;
  - até 4 buscas e 4 leituras de página.

### 5.5 Automático e humano

**Acontece sem clique**
- As etapas internas de uma pesquisa e de uma investigação.
- Os monitoramentos, com o app aberto e dentro do teto diário.
- A supressão, quando o texto da resposta parece um pedido para parar.
- A supressão pela leitura da IA, com confiança média ou alta.
- A limpeza diária de dados vencidos da Descoberta.

**Precisa de clique**
- Começar uma pesquisa ou uma investigação.
- Preparar a abordagem; gerar ou reescrever uma mensagem.
- Aprovar, registrar o envio e registrar a resposta.
- Pedir a interpretação da resposta.
- Criar follow-up e mudar a etapa.

### 5.6 Custos e limites

- **IA:** não custa dinheiro; o custo é GPU e tempo.
  - O Copiloto leva 2,3 s por resposta, na mediana.
  - Uma mensagem do Relacionamento leva até 12,2 s em 95% dos casos.
  - Uma investigação real levou 1 min 39 s.
  - O custo (`cost_usd`) é sempre 0 em `llm_calls`.
- **Tavily:**
  - 1 crédito por busca básica;
  - teto do app de 900 por mês (a cota gratuita é 1.000);
  - teto diário de 12 para os monitoramentos.
- **Sem teto de tempo** por etapa da investigação (KI-140) e **sem teto de uso** de IA (KI-116).
- **Registro incompleto:** a Descoberta não grava suas chamadas em `llm_calls`, então a Inteligência mostra menos uso do que o real.

---

## 6. Comunicação e geração de e-mails

Em resumo:

> O Prospector **escreve** mensagens, mas **não envia** nenhuma. O texto sai da IA local, passa por uma conferência automática, recebe despedida e rodapé pelo código e espera aprovação. Quem envia é o usuário, por fora do app. O modelo de e-mail em HTML, com a assinatura completa, só aparece na prévia e no teste para a própria caixa.

### 6.1 Onde nasce cada mensagem

| Situação | Como começa | Prompt |
|---|---|---|
| Primeira abordagem | "Preparar abordagem" no dossiê | `relationship-approach/v3`, que gera o plano e a mensagem |
| Nova mensagem na mesma oportunidade | "Nova mensagem com a IA" | `relationship-message/v3` |
| Reescrita | "Reescrever com a IA", com o campo "O que mudar" | `relationship-message/v3`, partindo da versão anterior |
| Resposta a quem respondeu | "Usar como rascunho de resposta", depois de "Interpretar" | `relationship-reply/v1` sugere e a sugestão vira mensagem |
| Escrita à mão | "Escrever à mão" | Nenhum |

**Tipos de mensagem** (`MessageKind`)

| Tipo | Limite |
|---|---|
| E-mail inicial | até 120 palavras |
| Mensagem curta | até 60 palavras |
| Apresentação | até 200 palavras |
| Follow-up | até 80 palavras |
| Reengajamento | até 80 palavras |
| Convite para reunião | sem dia nem hora |
| Resposta a objeção | — |
| Resposta | — |

**Canais**
- E-mail.
- LinkedIn.
- Telefone e presencial, com roteiro em tópicos.
- WhatsApp, só depois de a pessoa aceitar ser contatada por ali (opt-in).
- Outro.

Todos são manuais.

**Tons:** Consultivo (padrão), Direto, Próximo e Formal.

### 6.2 Como a IA decide o que escrever

1. O sistema escolhe a oferta, nesta ordem: a pedida pelo usuário, a da oportunidade, a recomendada pelo diagnóstico ou a única ativa.
2. Confere se há base mínima de evidências (`assessApproachBasis`). Sem base, recusa.
3. Monta o bloco de dados (ver 6.3) e o pedido.
4. A IA devolve, em JSON:
   - objetivo, canal e por que esse canal;
   - função da pessoa com quem falar;
   - argumento e próximo passo;
   - referências das evidências usadas;
   - lacunas e riscos;
   - a mensagem, com assunto e corpo.
5. O código ancora a estratégia: só ficam as referências a evidências que existem.
6. O código faz uma conferência automática (`reviewDraft`):
   - a fonte citada existe;
   - não há nomes inventados;
   - há um pedido só;
   - o tom está certo;
   - não exagera o que a evidência diz;
   - o nome da agência está na abertura;
   - o formato está certo.

   Se algo falha, **uma** segunda chamada pede a correção. O que continuar errado vira aviso no cartão.
7. O código tira as marcas de referência do texto, como "(C2)", e acrescenta a despedida e o rodapé.

### 6.3 Que dados entram

O bloco é montado por `contextData()`, em `packages/agents/src/relationship/relationship-ai.ts`:

| Bloco | Conteúdo | Observação |
|---|---|---|
| `hoje` | Data | — |
| `agencia` | Nome da agência | Vem do cadastro do opt-out |
| `empresa` | Nome, cidade, UF, atividade principal, porte, site e se é empresa individual | Se for empresa individual, o nome e o domínio não vão para a IA |
| `oferta` | Nome, descrição, problemas, sinais, entregáveis, propostas de valor | O preço não vai |
| `evidencias` | Referência, tipo (fato, inferência ou hipótese), confiança, fonte | Só as que podem ser citadas e têm fonte |
| `diagnostico` | Até 12 achados, marcados como "leitura interna" | O prompt proíbe revelar a leitura interna, mas o vocabulário dela aparece nas mensagens |
| `servico_recomendado`, `qualificacao` | Prioridade e recomendação | — |
| `cases` | Até 5, só os autorizados | Hoje não há nenhum |
| `voz` | Resumo, princípios, o que evitar, exemplos bons | **Os exemplos ruins não vão** |
| `lacunas`, `base` | O que falta saber | — |
| `mensagem` | Tipo, tom e se é primeiro contato | — |

Se o contexto não couber no limite do modelo, ele é encolhido em até 4 níveis (`CONTEXT_LEVELS`): os exemplos do guia de voz caem de 3 para 1 e depois para nenhum.

**O que não entra, porque não existe no sistema:**
- o nome da pessoa e o cargo real dela;
- o histórico da conversa por e-mail;
- qualquer coisa que a pessoa tenha publicado.

Por isso a mensagem é sempre escrita "para a empresa", nunca para alguém.

### 6.4 As regras que o prompt impõe

O `packages/agents/prompts/relationship-approach/v3.md` tem 17 regras inegociáveis. As que mais moldam o texto:

**Conteúdo**
- Não inventar nada sobre a empresa nem sobre a agência ("temos experiência" é proibido).
- Citar a fonte só quando ela sustenta a frase, sem exagerar o que a evidência diz.
- Não revelar as leituras internas.
- Inferência vai como pergunta ou com ressalva: "talvez", "pelo que vi", "parece que".

**Proibições**
- Palavras de intensidade, como "grave", "sério" e "crítico".
- Marcadores entre colchetes, exceto `[nome da agência]`.
- Frase de descadastro, assinatura de pessoa, anexo e link.
- Elogio genérico, urgência, familiaridade fingida e proposta de dia ou horário.

**Forma**
- Parágrafos corridos.
- **No primeiro contato, a primeira frase depois da saudação diz quem escreve, com o nome da agência, e por quê.**

**Tamanho**
- E-mail inicial: até 120 palavras.
- Nota do LinkedIn: até 300 caracteres.
- Assunto: até 60 caracteres.

Nenhum dos dois prompts do Relacionamento (`relationship-approach/v3` e `relationship-message/v3`) **define o que cada tom significa**. "Consultivo", "Direto", "Próximo" e "Formal" chegam à IA só como palavras.

### 6.5 O que o código acrescenta depois da IA

- **Despedida** (`closeDraft`): "Atenciosamente," no tom Formal e "Abraço," em todos os outros, seguida do **nome da agência**, nunca do nome de uma pessoa.
- **Rodapé** (`withContactFooter`, em `packages/domain/src/relationship/rules.ts`): entra no primeiro contato e em toda mensagem até a primeira resposta. Contém:
  - o texto de opt-out da Conformidade. O padrão é "Se não quiser receber novas mensagens nossas, é só responder dizendo isso (por exemplo, "remover") e não enviaremos mais nada.";
  - "Privacidade e dados pessoais: " seguido do canal do titular.

### 6.6 Exemplo com dados fictícios

**Cenário (tudo fictício)**
- Empresa: **Doceria Lua Cheia**, de Campinas/SP.
- Agência: **Estúdio Exemplo**.
- Evidências:
  - fato: "no celular, o logotipo do cabeçalho aparece em baixa resolução (captura de tela)";
  - inferência: "a identidade não acompanha a linha de produtos premium que a empresa divulga".

**Como a mensagem sai hoje.** Reproduz o padrão dos rascunhos reais, com os dados trocados:

```
Assunto: Identidade visual da Doceria Lua Cheia

Olá.

Sou do Estúdio Exemplo, uma agência de identidade visual, e escrevo porque
olhei o site de vocês.

No celular, o logotipo do cabeçalho aparece em baixa resolução, e as cores
do site parecem não acompanhar a linha premium que vocês divulgam. Pelo que
vi, talvez a marca ainda não traduza esse momento.

Faz sentido conversarmos 15 minutos sobre isso?

Abraço,
Estúdio Exemplo

Se não quiser receber novas mensagens nossas, é só responder dizendo isso
(por exemplo, "remover") e não enviaremos mais nada.
Privacidade e dados pessoais: (canal cadastrado em Conformidade)
```

**De onde vem cada parte**

| Trecho | Origem |
|---|---|
| "Olá." sem nome | Não existe contato; ninguém sabe o nome da pessoa |
| "Sou do Estúdio Exemplo… e escrevo porque…" | Regra do prompt: dizer quem escreve e por quê na primeira frase |
| Defeito técnico do site como gancho | O diagnóstico é a evidência mais concreta, e o prompt pede para citar o que se viu |
| "Pelo que vi, talvez…" | Regra: inferência vira pergunta ou ressalva |
| "Faz sentido conversarmos 15 minutos…?" | Guia de voz gravado: o princípio "um pedido só… como uma conversa de 15 minutos" e o exemplo bom |
| "Abraço, / Estúdio Exemplo" | Código (`closeDraft`) |
| Os dois parágrafos finais | Código (`withContactFooter`) |

**Follow-up fictício no mesmo padrão** (tipo follow-up, até 80 palavras):

```
Olá.

Retomo a mensagem que enviei na semana passada sobre a identidade visual da
Doceria Lua Cheia. Se fizer sentido, posso mostrar em 15 minutos o que
observei no site.

Abraço,
Estúdio Exemplo

Se não quiser receber novas mensagens nossas, …
```

Como ainda não houve resposta, o rodapé de opt-out continua.

### 6.7 Por que as mensagens soam robóticas

As causas vão da mais forte para a mais fraca, cada uma com o lugar onde está:

1. **O guia de voz em uso não é a voz da agência.**
   - A versão gravada no banco é a "Proposta inicial do Prospector (10/11/2026)": direta e concreta, "cita o que viu, diz em uma frase por que isso importa e faz uma pergunta aberta".
   - Os exemplos bons vêm cheios de colchetes: "Olá, [nome]. Sou [seu nome], da [agência]. Vi que o logo no site da [empresa]… Faz sentido conversarmos 15 minutos sobre isso?".
   - A IA copia essa estrutura quase ao pé da letra. Num dos rascunhos reais, copiou até o "[seu nome]", o que bloqueou a aprovação.
   - Onde mudar: Configuração › Estratégia › Voz.
2. **Não há destinatário.** Sem nome, a saudação vira "Olá." e o texto não se dirige a ninguém. Nenhuma regra de prompt resolve isso: falta o dado.
3. **A abertura é obrigatória e sempre igual.** A regra "a primeira frase depois da saudação diz quem escreve, com o nome da agência, e por quê" está no prompt v3 e é cobrada pela conferência `agencyReview`. Por isso todas as mensagens começam do mesmo jeito.
4. **O gancho é quase sempre um defeito técnico.**
   - O diagnóstico está cheio de medições: contraste, tamanho do logotipo em pixels, rolagem lateral, código de cor.
   - A IA usa o que tem de mais concreto, e o resultado parece um relatório automático de auditoria.
   - Um rascunho real cita o "capital social alto" da empresa, um dado do cadastro da Receita num e-mail de venda.
5. **Despedida e assinatura fixas, sem pessoa.** Toda mensagem que não é formal termina em "Abraço," seguido do nome da agência. Uma agência que assina sem o nome de quem escreve soa como sistema.
6. **Rodapé legal em toda primeira mensagem.** Os dois parágrafos de opt-out e privacidade dão ao e-mail cara de disparo em massa, embora sejam uma escolha de conformidade.
7. **Muitas proibições e pouca orientação de estilo.** São 17 regras inegociáveis, quase todas dizendo o que não fazer, mais lembretes no fim do pedido. Um modelo pequeno, de 4 bilhões de parâmetros, responde a isso ficando cauteloso e genérico.
8. **Tons sem definição.** "Próximo" e "Direto" chegam como uma palavra só. Na prática, os quatro tons produzem textos parecidos.
9. **Ressalvas obrigatórias nas inferências.** "Talvez", "pelo que vi" e "parece que" empilhados deixam o texto hesitante.
10. **A correção automática achata o texto.** Quando a conferência encontra um problema, a segunda chamada reescreve para cumprir a regra. Ela não tem como melhorar o estilo.
11. **Saída em JSON, temperatura 0,4 e modelo pequeno.** Escrever prosa dentro de um campo JSON, com temperatura moderada, num modelo de 4B, puxa para frases seguras e previsíveis.
12. **Limite de 120 palavras e um pedido só.** Ajuda a não cansar quem lê. Somado às regras acima, sobra espaço só para "quem sou, o que vi, 15 minutos?".
13. **Os exemplos ruins do guia de voz não chegam à IA.** O campo existe na tela, mas `contextData()` não o envia. A IA nunca vê exemplos do que evitar.
14. **As avaliações não medem naturalidade.** Os casos de `packages/agents/evals/relationship/cases.ts` só checam regras. Um prompt que soe mais humano mas tropece numa regra perderia nota; o contrário não é medido.

**As instruções responsáveis, em resumo**
- Guia de voz v1, gravado no banco.
- Regra de abertura e regras de inferência, em `relationship-approach/v3.md` e `relationship-message/v3.md`.
- Nenhuma definição de tom nos prompts.
- `closeDraft` e `withContactFooter`, no código.
- `agencyReview` e `toneReview`, dentro de `reviewDraft`.
- `contextData()`, que não envia os `badExamples`.

### 6.8 Envio, aprovação e HTML

- **Aprovação:**
  - é feita mensagem por mensagem, com um hash SHA-256 de `{v:1, canal, assunto normalizado, corpo}`;
  - vale 72 h e uma única vez, e o banco confere tudo de novo;
  - o hash ainda não cobre destinatário, identidade do remetente nem modelo HTML (KI-172). Isso só vai importar quando houver envio.
- **Envio:** nenhum para empresas. O usuário copia, envia e registra.
- **Modelo HTML (`email-layout/v1`):**
  - partes: cabeçalho com monograma, parágrafos, cartão opcional, assinatura com faixa e painel (nome, cargo, redes, estúdio, cidade, site, portfólio, WhatsApp, e-mail), rodapé com o opt-out e versão em texto;
  - é usado só na prévia e no teste;
  - `portfolioForService`, que escolhe o link de portfólio pelo serviço, existe e nunca é chamado.
- **Teste:**
  - é o único envio SMTP do app;
  - vai só para o endereço da própria caixa, no máximo 1 por minuto, com o cabeçalho `X-Prospector: teste`;
  - não tem List-Unsubscribe nem Reply-To.
- **Leitura de respostas:** não existe. O IMAP só confere o login.

### 6.9 O que está planejado (ADR-0016) e o que bloqueia

| Fatia | Conteúdo | Estado |
|---|---|---|
| E1 | Modelo de e-mail | Feita |
| E2 | Destinatário, com a origem registrada | Não feita |
| E3 | Caixa, identidade, conferência e teste | Feita |
| E4 | Fila de aprovação em lote, envio agendado, limite diário, List-Unsubscribe | Não feita |
| E5 | Leitura das respostas pelo IMAP | Não feita |
| E6 | Rascunhos gerados a partir dos monitoramentos | Não feita |
| E7 | Prospector como servidor MCP | Não feita |

**Bloqueio externo:** os termos da Hostinger só permitem mensagem comercial para quem deu opt-in e preveem bloqueio da caixa (KI-171). Enviar prospecção fria pela caixa atual tem risco real.

---

## 7. Banco de dados e integrações

### 7.1 Como os dados circulam

```
Navegador (127.0.0.1) ──► Next.js no computador (server actions, rotas /api)
                               │
                               ├─► packages/application (serviços) ─► packages/db ─► Supabase Postgres (São Paulo)
                               │                                                     (secret key só no servidor)
                               ├─► packages/agents (gateway) ─► Ollama 127.0.0.1:11434
                               ├─► packages/integrations ─► Tavily (busca)
                               │                          ─► Playwright/Chromium (páginas e capturas)
                               │                          ─► OpenCNPJ / Minha Receita (CNPJ)
                               │                          ─► SMTP/IMAP da caixa e DNS público
                               └─► disco local (capturas em PROSPECTOR_CAPTURES_DIR)
```

### 7.2 Tabelas (42), por módulo

| Módulo | Tabelas |
|---|---|
| Fundação | `audit_log` |
| Estratégia | `offers`, `offer_versions`, `audit_rubrics`, `scoring_models`, `icp_profiles`, `icp_profile_versions`, `voice_guides`, `contact_policies`, `proof_assets`, `legal_basis_assessments` |
| Copiloto e registro de uso da IA | `copilot_threads`, `copilot_messages`, `llm_calls`, `tool_calls` |
| Empresas e evidências | `companies`, `company_identifiers`, `sources`, `claims`, `claim_evidence`, `claim_dependencies` |
| Uso de provedores | `provider_usage` |
| Descoberta | `ai_jobs`, `discovery_monitors`, `discovery_runs`, `discovery_run_queries`, `discovery_prospects`, `discovery_run_prospects`, `discovery_sources`, `discovery_signals` |
| Investigação | `company_investigations` |
| Relacionamento | `opportunities`, `opportunity_stage_changes`, `approach_plans`, `outbound_messages`, `approvals`, `interactions`, `tasks`, `suppression_entries` |
| E-mail | `sender_identities`, `mailboxes`, `mailbox_checks`, mais a senha no Vault |

**Views (9):** `current_offer_versions`, `current_audit_rubrics`, `current_scoring_models`, `current_icp_profile_versions`, `current_outbound_messages`, `company_investigation_summaries`, `copilot_thread_summaries`, `opportunity_summaries`, `provider_usage_monthly`.

**Funções do banco chamadas pelo app (16):** `create_offer`, `create_icp_profile`, `create_company`, `record_evidence`, `confirm_company_site`, `claim_ai_job`, `heartbeat_ai_job`, `finish_ai_job`, `expire_ai_jobs`, `open_opportunity`, `change_opportunity_stage`, `approve_message`, `record_interaction`, `suppress_company`, `set_mailbox_password`, `mailbox_password`. Há mais 28 funções internas (`app.*`), que cuidam de auditoria, versões imutáveis, proteções e gatilhos.

**Relações principais**

| Tabela | Relaciona-se com |
|---|---|
| `offers` | Várias `offer_versions`. A rubrica e o score ficam presos à oferta; o ICP tem versões próprias |
| `companies` | Várias `company_identifiers`, `claims`, `company_investigations` e `opportunities` |
| `claims` | Várias `sources`, por meio de `claim_evidence`. Uma inferência se apoia em outras afirmações (`claim_dependencies`), e `supersedes` liga uma versão à anterior |
| `discovery_runs` | Várias `discovery_prospects`, por meio de `discovery_run_prospects`. Uma empresa encontrada pode apontar para uma `companies` |
| `opportunities` | Vários `approach_plans`, `outbound_messages` (versões), `interactions`, `tasks` e `opportunity_stage_changes`. Cada `approvals` fica presa a uma versão de mensagem |
| `suppression_entries` | Uma empresa; vale também para a mesma raiz de CNPJ e o mesmo domínio |

**Regras do banco**
- **Acesso:** toda tabela tem RLS ligado e nenhuma política, então só o servidor, com a secret key, acessa. Um teste de catálogo garante isso.
- **Auditoria:** gravada na mesma transação, pelo cabeçalho `x-prospector-audit` e um gatilho.
- **Imutabilidade:** as versões e várias tabelas só aceitam inclusão; uma mudança é uma linha nova.
- **Migrações:** 12, de `20261109130000_foundation` a `20261125120000_email_mailbox`.

**Citados nos documentos, mas inexistentes:** `agent_configs`, `model_pricing`, `watchlists`, `contacts` e o Supabase Storage.

### 7.3 Armazenamento fora do banco

| O quê | Onde fica |
|---|---|
| Capturas de tela | Arquivos JPEG em disco, na pasta `PROSPECTOR_CAPTURES_DIR` (fora do C: e fora de pasta de rede). Não há Storage |
| Senha da caixa | Supabase Vault, acessado por funções com privilégio próprio que só o servidor chama |
| Respostas em memória (cache) | Buscas por 24 h, páginas por 6 h, CNPJ por 1 dia |

### 7.4 Serviços externos

| Serviço | Para quê | Credencial (onde fica, sem o valor) | Limite ou custo | Se cair |
|---|---|---|---|---|
| Supabase (plano gratuito) | Banco e Vault | URL e secret key em `apps/web/.env.local` | O projeto gratuito pausa depois de um período sem uso | Quase nada funciona |
| Ollama (local) | Toda a IA | Nenhuma | GPU de 16 GB, uma geração por vez | Sem pesquisa, sem abordagem e com falhas na investigação |
| Tavily | Busca na internet | `TAVILY_API_KEY` no `.env.local` | 1 crédito por busca; 900 por mês no app | Sem Descoberta; investigação parcial |
| Playwright e Chromium | Ler páginas e capturar telas | Nenhuma | 30 s por captura | Investigação parcial |
| OpenCNPJ e Minha Receita | Dados cadastrais | Nenhuma | Serviços públicos | O cadastro pelo CNPJ falha |
| Caixa SMTP/IMAP (Hostinger) | Teste de envio e conferência | Senha no Vault | Termos antispam (KI-171) | Só a tela de e-mail para |
| DNS público | SPF, DKIM, DMARC | — | — | A conferência falha |
| GitHub | Código e download do Electron (fora do escopo) | — | — | — |

Não há servidor MCP, webhook, fila externa nem serviço de envio de e-mail.

### 7.5 Autenticação e segurança

- **Sem login** (ADR-0007). A proteção é dupla:
  - o app só aceita conexões em `127.0.0.1`;
  - o proxy recusa endereço (Host) que não seja local e gravação que não venha do próprio app.
- **Navegador:** política de segurança com nonce e cabeçalhos de segurança. As rotas de arquivos conferem se a captura pertence à empresa.
- **Segredos:** só no servidor (`server-only`), nunca em `NEXT_PUBLIC_*`.
- **Atenção:** o `pnpm app:install` copia o `.env.local` em texto puro para `D:\Prospector`. Quem tiver acesso ao disco tem a secret key do banco.
- **Atenção:** o KI-009 registra o repositório como **público** no GitHub, em observação de 10/11/2026. Não conferi hoje.

### 7.6 LGPD em uma tabela

| Tema | Como está |
|---|---|
| Base legal | LIA com versões e aprovada; o app só confere se está aprovada e no prazo |
| Minimização | Não guarda sócios, e-mail, telefone nem endereço; guarda só a função de quem respondeu |
| Opt-out | Rodapé obrigatório; supressão imediata, que vale também para empresas relacionadas |
| Retenção | Prazos gravados (`retention_until`), mas **sem apagamento automático** nas tabelas do Relacionamento e das evidências (KI-015, KI-078, KI-122). A Descoberta apaga diariamente o que passou de 12 meses |
| Pedidos de titulares | Só como motivo de supressão; não há fluxo de acesso nem de eliminação |
| Parecer jurídico | Em aberto (KI-005, KI-048, KI-051) |
| Trechos guardados | Fontes vindas de sites de consulta de CNPJ podem conter telefone e e-mail sem máscara (KI-114) |

---

## 8. Experiência de uso e pontos de complexidade

### 8.1 Problemas identificados

| Onde | Problema | Por que atrapalha |
|---|---|---|
| Descoberta → Empresas | "Investigar" não investiga; é preciso um segundo clique no dossiê, sem aviso | O usuário acha que a investigação está rodando, e a empresa fica "em investigação" sem nada acontecer |
| Dossiê | Página única, com 11 painéis e dezenas de milhares de caracteres | A decisão (abordar ou não) se perde no meio das evidências |
| Dossiê | Quatro "confianças" diferentes: da triagem, do sinal, a geral e a de cada evidência, às vezes contraditórias ("85 de 100" ao lado de "baixa (24%)") | O usuário não sabe em qual confiar |
| Dossiê | "Recomendação: Investigar mais / Próximo passo: Investigar mais" | Repete a mesma coisa e não ajuda a decidir |
| Dossiê | Jargão interno à vista: "(K31)", "nota M2", "#818181", "Raciocínio" | Parece tela de depuração |
| Qualificação | "Abordar agora" nunca aparece, e "Preparar acesso" não diz o que fazer | Falta um próximo passo claro depois da investigação |
| Empresas e Pipeline | A empresa tem uma etapa ("Candidata") e a oportunidade, outra ("Abordagem preparada") | Duas respostas diferentes para "em que pé está" |
| Empresas | "Sem CNPJ" na lista e CNPJ no dossiê, para a mesma empresa | Parece erro de dado |
| Empresas | Não dá para editar o cadastro | Um erro de digitação fica para sempre |
| Relacionamento | Aprovar e registrar são dois atos para um texto que o app não envia | Etapa burocrática sem efeito visível |
| Relacionamento | Não há botão de copiar nem `mailto:` | O passo mais repetido, copiar e enviar, é o mais manual |
| Aprovações | Depois de aprovar, o item some, e o "Já enviei" fica em outra tela | Perde-se o fio entre aprovar e registrar |
| Relacionamento | Uma aprovação vencida exige preparar e aprovar de novo, mesmo sem mudança no texto | Retrabalho |
| Relacionamento | Responder custa cerca de 5 cliques: registrar, interpretar, usar como rascunho, aprovar e "Já enviei" | Lento para o que deveria ser rápido |
| Relacionamento | "Nada sai do app" aparece cerca de 8 vezes | Ruído; o usuário já sabe |
| Pipeline | O kanban não deixa arrastar | Frustra quem espera poder arrastar |
| Pipeline | O erro de oportunidade fechada manda "reabrir no pipeline", que não muda etapa | Leva ao lugar errado |
| Estratégia | Selo "Bloqueado" para descobrir, embora a Descoberta funcione | Informação falsa na configuração |
| Estratégia | Campos que nada usa: peso da rubrica, exemplos ruins, categorias da LIA | O usuário preenche à toa |
| Estratégia | Identificadores em `snake_case`, CNAE de subclasse, raiz de CNPJ, pesos que somam 100, exemplos separados por "---" | Exige conhecimento técnico |
| Estratégia | "Tudo é versionado", mas os cases não são | Contradição |
| Estratégia | "Pausar" um ICP grava "Rascunho" | O nome do botão não corresponde ao que ele faz |
| E-mail | Fala em "aprovação em lote", "Limite de envios por dia" e "Bloqueia a prospecção:" | Sugere que a prospecção por e-mail está quase pronta |
| E-mail | Quatro salvamentos e um teste para um recurso que hoje não envia prospecção | Esforço sem retorno |
| Monitoramento | Diz mostrar "só o que é novo", mas mostra tudo | Promessa não cumprida |
| Monitoramento e Descoberta › Monitoramentos | Mesmo nome para coisas diferentes | Confunde a navegação |
| Rodapé do menu | O indicador "Pesquisa na internet" leva ao Copiloto, que não mostra créditos | Leva a uma tela que não resolve nada |
| Copiloto | O painel diz "ainda não usado" para tarefas em uso | Informação errada |
| Copiloto | O prompt diz que Aprovações está "em construção", e os fatos do sistema geram "Módulos ainda em construção…: ." | A IA explica o app de forma errada |
| Mensagens do sistema | Variáveis de ambiente e caminhos de arquivo na tela: `TAVILY_API_KEY`, `DISCOVERY_DAILY_AUTO_CREDITS=0`, `apps/web/.env.local`, "nvidia-smi" | Linguagem de desenvolvedor num app de uso diário |
| Auditoria | Ações em código e entidades como uuid | Ilegível |
| Voz da agência | "O redator (F10) segue esta voz" | Jargão de roadmap |
| Aprovações | "Revise e aprove de novo.." | Pontuação errada |
| Radar | Sinais de grandes plataformas (aplicativos de transporte e de entrega) vindos de fóruns, e de empresas estrangeiras | Ruído que desvia a atenção |
| Oportunidades de topo na Descoberta | "Site oficial não encontrado" em empresas de prioridade alta | A prioridade alta parece mal calibrada |

### 8.2 Oportunidades (não são defeitos)

São possibilidades levantadas na leitura; nenhuma foi implementada.

- **Um caminho só da Descoberta à investigação:** "Investigar" já disparar a investigação e a consulta à Receita.
- **Resumo de decisão no topo do dossiê:** recomendação, o porquê em duas linhas, o próximo passo e um botão; o resto recolhido.
- **Confiança:** uma só, explicada, ou nomes diferentes para coisas diferentes.
- **Envio manual mais fácil:**
  - botão "Copiar" e link `mailto:` nas mensagens aprovadas, com o "Já enviei" logo ao lado;
  - aprovar e registrar num passo só, enquanto o app não envia.
- **Etapas:** uma só entre Empresas e o pipeline, ou uma ligação explícita entre as duas.
- **Mensagens mais naturais:**
  - trocar a proposta inicial do guia de voz por textos que o usuário de fato escreveria;
  - mandar os exemplos ruins para a IA;
  - definir cada tom no prompt, com uma ou duas frases e um exemplo;
  - criar o destinatário (E2) antes de qualquer envio, que é o que mais mudaria a naturalidade;
  - incluir naturalidade nas avaliações do Relacionamento.
- **Mensagens do sistema:** trocar as variáveis de ambiente por instruções em português, com link para a tela certa.
- **Pipeline:** arrastar no kanban e ter um índice de oportunidades.

---

## 9. Estado atual e limitações

### 9.1 Por categoria

**Totalmente funcional**
- Moldura, paleta e estado do sistema.
- Estratégia e Conformidade, como cadastro.
- Pesquisa da Descoberta com triagem.
- Cadastro pelo CNPJ e livro de evidências.
- Investigação, quando não há reinício no meio.
- Relacionamento:
  - preparar abordagem e mensagens com versões;
  - aprovação de uso único;
  - registro manual de envio e de resposta, e interpretação da resposta;
  - follow-ups, pipeline e supressão.
- Configuração e teste de e-mail.
- Conversa do Copiloto.
- Inteligência (funil e consumo) e Auditoria.

**Funcional com limitações**
- Qualificação: "Abordar agora" nunca aparece.
- Triagem: ignora a "Necessidade".
- Monitoramentos: só com o app aberto; "só o que é novo" não se cumpre.
- Lista de Empresas: só as 100 primeiras.
- Copiloto: sem as ferramentas de três módulos.
- Monitoramento: a lista de acompanhamento é implícita.
- Inteligência: não conta as chamadas da Descoberta.

**Parcial**
- "Investigar" na Descoberta.
- Ligar o CNPJ à mão.
- Rubrica: peso e evidências exigidas são ignorados.
- Voz: exemplos ruins são ignorados.
- E-mail: só a configuração.
- IMAP: só o login.

**Depende de serviço externo**
- Descoberta: Tavily, Ollama e banco.
- Investigação: Ollama, Tavily, Playwright e consulta de CNPJ.
- Relacionamento: Ollama.
- Tudo: Supabase.

**Não implementado**
- Envio de mensagens, destinatário e contatos, fila em lote e leitura de respostas.
- Servidor MCP.
- Edição do cadastro.
- Aprendizados e calibração do score.
- Apagamento automático de dados no Relacionamento e nas evidências.
- Agentes configuráveis (`agent_configs`), pedidos de titulares e tela de integrações.

**Desconectado (existe, mas nada liga)**
- Funções: `assertReadyToDiscover`, `portfolioForService`, `suggestStage`.
- Copiloto: ferramentas para Descoberta, Investigação e Relacionamento.
- E-mail: o modelo HTML nas mensagens; o limite diário e o status "pausada" da caixa.
- Valores nunca usados: o motivo de cancelamento "opportunity_closed", o erro `discovery_blocked`, a tarefa `embedding`.
- Interface: o selo "em breve" do menu.
- A investigação iniciada pela Descoberta, que o banco aceita mas nada dispara.

### 9.2 Itens que aparecem na interface sem nada por trás

| Tela | O que aparece | O que acontece de fato |
|---|---|---|
| Estratégia | "Para descobrir empresas: Bloqueado · faltam N" | A Descoberta não confere isso |
| Configuração › E-mail | "aprovação em lote", "Limite de envios por dia", "Bloqueia a prospecção:" | Não existem fila, limite nem envio de prospecção |
| Descoberta › Monitoramentos | "Cada execução mostra só o que é novo" | Mostra todas, com o selo "Nova" |
| Descoberta | "Quantas empresas — Até 50" | O teto real é 15, 25 ou 40, conforme a profundidade |
| Copiloto | "ainda não usado" para Análise e Imagens | As duas estão em uso |
| Rubrica | Peso e "evidências exigidas" | A investigação ignora os dois |
| Voz | Exemplos ruins | Não vão para a IA |
| LIA | Categorias e origens de dados | Servem só de documento |
| Configuração | "Em breve": integrações, agentes, titulares, uso e orçamento | Não há tela |
| Inteligência | "Aprendizados… ainda não existem" | Só o texto |
| Início | "Aprovação: Obrigatória", "Só local" | Textos fixos: corretos, mas não lidos do sistema |
| `lib/modules.ts` | "Fila de decisões do dia" (Início) e "lista importada" (Descoberta) | Não existem |

### 9.3 Bugs confirmados no código

1. **"Investigar" na Descoberta não investiga** e deixa a empresa marcada como "em investigação" (`packages/application/src/services/discovery-service.ts:604-676`).
2. **Preparar abordagem numa oportunidade já aberta não muda a etapa.** A oportunidade some de "Abordagens preparadas" (`ensureOpportunity` em `relationship-service.ts`, perto da linha 819).
3. **A oferta da oportunidade pode divergir da oferta do plano.** A conformidade é conferida pela antiga, porque `setOffer` só age quando ainda não há oferta.
4. **A prioridade da oportunidade é sempre "média"** e ignora o diagnóstico (`ensureOpportunity`).
5. **Encerrar a oportunidade não cancela os follow-ups abertos.** `app.move_opportunity`, em `supabase/migrations/20261111170000_relationship.sql:600`, não mexe em `tasks`.
6. **Uma nota do próprio usuário pode suprimir a empresa.** `recordNote` passa o texto por `detectStopRequest`; uma nota como "expliquei como sair da lista" basta.
7. **A leitura da IA suprime sem confirmação** quando a confiança é média.
8. **"Vencido" diverge entre telas.** O detalhe marca como vencido depois das 9h, enquanto Conversas conta a mesma tarefa como "para hoje".
9. **O erro de oportunidade fechada manda "reabrir no pipeline"**, que não muda etapa (`packages/application/src/errors.ts:54`).
10. **O aviso de conformidade em /aprovacoes usa a oferta errada**: a do primeiro rascunho pendente ou a primeira ativa.
11. **"Escrever à mão" pede assunto em qualquer canal**, inclusive LinkedIn e telefone.
12. **O registro de IA do Relacionamento não tem proteção.** `recordAi` (`relationship-service.ts:649`) não tem `try/catch`: se a gravação em `llm_calls` falhar, a ação inteira falha depois de a IA já ter respondido. A investigação protege a mesma chamada (`investigation/run.ts:433`).
13. **Os dados da Receita aparecem com confiança só média.** `DEFAULT_EVIDENCE_CLASSIFICATION` (`evidence-service.ts:83`) tem as listas de fontes vazias, então OpenCNPJ e Minha Receita contam como agregador (0,6).
14. **O painel de IA marca tarefas em uso como "ainda não usado".** `IN_USE` contém só `copilot` (`apps/web/src/components/copilot/local-ai-status.tsx:20`).
15. **Lista e dossiê divergem sobre o CNPJ** (`empresas/page.tsx:115` e `empresas/[id]/page.tsx`).
16. **Pontuação dupla** na mensagem de aprovação vencida.
17. **O limite do e-mail de teste conta também as tentativas que falharam.**
18. **As dicas das imagens falam só de PNG e JPG**, mas GIF também é aceito.

### 9.4 Fragilidades

- **Fila da investigação em memória (KI-134).** Um reinício interrompe a investigação. Dois processos ligados ao mesmo banco (`pnpm dev` e o app instalado) podem rodar duas investigações ao mesmo tempo.
- **"Preparar abordagem" sem transação (KI-127).** Uma falha no meio deixa oportunidade sem plano, ou plano sem mensagem.
- **Cortes sem aviso:**
  - evidências por empresa (`claimsFor`): 1.000 linhas;
  - consultas do Relacionamento: 500 linhas;
  - fila de aprovações: 100 rascunhos e 50 decisões;
  - lista de Empresas: 100.
- **Consultas demais em `approvalQueue`.** São várias por aprovação, até 50 aprovações, e isso roda em duas telas.
- **Um trabalhador por processo.** O agendador só roda quando ele está livre, então uma pesquisa longa atrasa os monitoramentos.
- **O Supabase gratuito pausa** depois de alguns dias sem uso.
- **Os monitoramentos só rodam com o app aberto.**
- **Sem limite de tempo por etapa da investigação (KI-140).**
- **O pedido para parar é detectado por palavras-chave**, com falsos positivos.
- **A deduplicação falha em alguns casos (KI-147).**

### 9.5 Limites de escala

| Recurso | Limite atual |
|---|---|
| IA | Uma geração por vez, fila de 3 |
| Investigações | Uma por vez, 20 esperando |
| Pesquisas ativas | 5 |
| Créditos de busca | 900 por mês e 12 por dia em automático |
| Empresas por pesquisa | 15, 25 ou 40 |
| Lista de Empresas | 100 lidas |
| Fila de aprovação | 100 rascunhos e 50 decisões |
| Monitoramento | 200 empresas e 60 novidades |
| Auditoria na tela | 100 entradas, sem paginação |

Para uma pessoa prospectando dezenas de empresas por mês, esses limites bastam. Passando de algumas centenas, os cortes sem aviso começam a esconder dados.

### 9.6 Dependências de configuração

Várias funcionalidades somem ou mudam conforme variáveis de ambiente, e não há tela para mudá-las:

| Variável | O que controla |
|---|---|
| `PROSPECTOR_STORAGE` | Banco real ou dados só na memória |
| `PROSPECTOR_DISCOVERY`, `PROSPECTOR_WEB_SEARCH`, `PROSPECTOR_CNPJ_LOOKUP` | Ligam ou desligam a Descoberta, a busca na internet e a consulta de CNPJ |
| `PROSPECTOR_EMAIL` | Caixa real ou simulada |
| `PROSPECTOR_CAPTURES_DIR` | Pasta das capturas de tela |
| `TAVILY_API_KEY`, `WEB_SEARCH_MONTHLY_CREDITS`, `DISCOVERY_DAILY_AUTO_CREDITS` | Chave e limites de créditos da busca |
| `AI_*` | Comportamento da IA local |

No app instalado, mudar qualquer uma delas exige rodar `pnpm app:install` de novo.

### 9.7 Documentação desatualizada

- `docs/README.md` diz, no topo, que o estado é "F1 implementada… IA-1 entregue" (09/11/2026).
- A matriz de maturidade do doc 13 marca Descoberta e Relacionamento como não implementados e fala em 6 migrações; há 12.
- O doc 09 e a tabela de marcos do doc 14 trazem status antigos da F1 e da F3.
- Os ADRs 0014, 0015 e 0017 estão como "Proposto", mas foram implementados. O 0016 também está como "Proposto", com duas fatias feitas.
- O prompt do Copiloto e `copilot-context.ts` descrevem módulos prontos como "em construção".

### 9.8 Pendências registradas

O `docs/known-issues.md` tem:
- 108 itens não resolvidos: 92 abertos e 16 parciais;
- 32 resolvidos;
- 14 aceitos;
- 6 mitigados;
- 8 encerrados pelo ADR-0007.

Os de maior impacto no dia a dia:

| Pendência | Tema |
|---|---|
| KI-081 | Não dá para editar o cadastro |
| KI-131 | Análises da investigação ainda na v1 |
| KI-132 | Fit 100 com um critério só |
| KI-134 | Fila da investigação em memória |
| KI-168 | Só há ofertas de marca |
| KI-170 e KI-171 | E-mail: fatias que faltam e termos do provedor |
| KI-005, KI-048 e KI-051 | Parecer jurídico em aberto |
| KI-015, KI-078, KI-084 e KI-122 | Dados sem apagamento automático |

---

## 10. Referência técnica

### 10.1 Pastas

| Pasta | O que tem |
|---|---|
| `apps/web` | O app Next.js: telas em `src/app/(shell)/…`, componentes em `src/components/…`, ligação dos serviços em `src/server/container.ts`, proteção em `src/proxy.ts`, trabalhador da fila em `src/instrumentation.ts` |
| `packages/domain` | Regras puras: evidência e confiança, triagem, qualificação, prontidão, regras de relacionamento, modelo de e-mail |
| `packages/contracts` | Contratos Zod (tipos e JSON Schema) e mensagens de erro |
| `packages/application` | Serviços, o único caminho até os dados, e versões em memória |
| `packages/db` | Acesso ao Supabase (PostgREST) |
| `packages/agents` | Gateway do Ollama, política de modelos, prompts e avaliações |
| `packages/integrations` | Tavily, Playwright, CNPJ, SMTP, IMAP, DNS e imagens |
| `packages/ui` | Componentes visuais |
| `supabase/migrations` | As 12 migrações |
| `scripts/app` | Instalação do app em `D:\Prospector` |
| `apps/desktop` | Electron, sem commit e fora do escopo |

### 10.2 Onde fica cada coisa

| Assunto | Arquivo |
|---|---|
| Menu e módulos | `apps/web/src/lib/modules.ts`, `lib/navigation.ts` |
| Paleta e atalhos | `components/shell/command-palette.tsx`, `lib/commands.ts`, `components/shell/app-shell.tsx` |
| Estado do sistema | `app/api/estado/route.ts`, `lib/system-status.ts` |
| Ligação de tudo (contêiner) | `apps/web/src/server/container.ts` |
| Política de modelos | `packages/agents/src/model-policy.ts` |
| Copiloto | `packages/agents/src/copilot/copilot.ts`, `app/api/copiloto/route.ts`, `components/copilot/*` |
| IA da Descoberta | `packages/agents/src/discovery/discovery-ai.ts` |
| IA da investigação | `packages/agents/src/investigation/brand-analysis-ai.ts` |
| Motor da Descoberta | `packages/application/src/services/discovery-engine.ts`, `discovery-service.ts`, `job-worker.ts` |
| Triagem | `packages/domain/src/discovery/triage.ts` |
| Investigação | `packages/application/src/services/investigation-service.ts`, `services/investigation/*.ts` |
| Qualificação | `packages/domain/src/investigation/qualification.ts`, `application/.../investigation/qualify.ts` |
| Confiança | `packages/domain/src/evidence/confidence.ts`, `application/src/services/evidence-service.ts` |
| Relacionamento (serviço) | `packages/application/src/services/relationship-service.ts` |
| Relacionamento (IA) | `packages/agents/src/relationship/relationship-ai.ts` |
| Regras de mensagem e aprovação | `packages/domain/src/relationship/rules.ts` |
| Modelo de e-mail | `packages/domain/src/relationship/email-layout.ts` |
| Imagens da assinatura | `packages/domain/src/relationship/email-image.ts`, `packages/integrations/src/email/image.ts` |
| Configuração de e-mail | `packages/application/src/services/email-settings-service.ts` e, em `integrations/src/email/`, `smtp.ts`, `imap.ts`, `dns.ts`, `connection.ts` |
| Textos padrão (opt-out, rubrica, score, LIA) | `packages/domain/src/strategy/drafts.ts` |
| Prontidão | `packages/domain/src/strategy/readiness.ts` |
| Contratos | `packages/contracts/src/strategy.ts`, `discovery.ts`, `investigation.ts`, `relationship.ts`, `email.ts` |
| Erros | `packages/application/src/errors.ts` |
| Avaliações | `packages/agents/evals/` (`copilot`, `discovery`, `investigation`, `relationship`) |
| Instalação | `scripts/app/instalar.mjs` |
| CI | `.github/workflows/ci.yml` |

### 10.3 Prompts

Todos ficam em `packages/agents/prompts/<nome>/vN.md`.

| Prompt | Versões no repositório | Em uso |
|---|---|---|
| `copilot` | v1 a v3 | v3 |
| `copilot-tools` | v1 a v6 | v3 |
| `discovery-interpreter` | v1 a v4 | v4 |
| `discovery-extractor` | v1 a v4 | v2 |
| `company-business` | v1 a v3 | v1 |
| `brand-visual` | v1 a v3 | v1 |
| `competitor-triage` | v1 a v3 | v1 |
| `competitive` | v1 | v1 |
| `diagnosis` | v1 a v3 | v1 |
| `relationship-approach` | v1 a v3 | v3 |
| `relationship-message` | v1 a v3 | v3 |
| `relationship-reply` | v1 | v1 |

### 10.4 Rotas de tela

| Área | Rotas |
|---|---|
| Início | `/` |
| Descoberta | `/descoberta`, `/descoberta/pesquisas/[id]`, `/descoberta/empresas`, `/descoberta/empresas/[id]`, `/descoberta/monitoramentos` |
| Empresas | `/empresas`, `/empresas/nova`, `/empresas/[id]` |
| Relacionamento | `/relacionamento`, `/relacionamento/conversas`, `/relacionamento/pipeline`, `/relacionamento/oportunidades/[id]` |
| Aprovações | `/aprovacoes` |
| Copiloto | `/copiloto` |
| Monitoramento | `/monitoramento` |
| Inteligência | `/inteligencia` |
| Configuração | `/configuracoes`, `/configuracoes/estrategia/**`, `/configuracoes/conformidade/**`, `/configuracoes/email`, `/configuracoes/auditoria` |

### 10.5 Testes

| Pacote | Arquivos de teste |
|---|---|
| agents | 14 |
| application | 17 |
| contracts | 7 |
| db | 23 |
| domain | 22 |
| integrations | 12 |
| web | 44 |

Testes de ponta a ponta (Playwright): `companies`, `copilot`, `copilot-history`, `database`, `discovery`, `email`, `insights`, `relationship`, `shell`, `smoke`, `strategy`. Nenhum foi rodado nesta auditoria.

---

*Auditoria feita em 26/11/2026, só de leitura. Os números "observados" vêm das telas do app instalado nesse dia, e as notas da IA, do `docs/14-execucao-e-conclusao.md`. Nada foi executado contra o banco, a IA ou a internet.*
