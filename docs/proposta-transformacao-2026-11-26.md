# Proposta de simplificação e reestruturação do Prospector (26/11/2026)

> **Proposta para aprovação.** Nada foi implementado: nenhum código, prompt, banco ou configuração mudou. Baseia-se na [auditoria de 26/11](auditoria-produto-2026-11-26.md), e cada ponto usado aqui foi conferido de novo no código.

## Ponto de partida

**Estado conferido antes da análise**
- Branch `conclusao-produto`, último commit `83c26c1` (25/11/2026).
- Há três grupos de mudanças sem commit na árvore de trabalho. Todos foram preservados e nenhum foi tocado:
  1. **E-mail:** KI-187 (conferência das imagens da assinatura, com `email-image.ts` no domínio e nas integrações e os testes correspondentes) e KI-188 (`SelectField`).
  2. **Programa de desktop, ainda interrompido:**
     - `apps/desktop/` e ADR-0018;
     - `scripts/app`, com o `iniciar.ps1` removido;
     - `turbo.json`, `pnpm-lock.yaml`, `eslint.config.mjs` e `scripts/check-boundaries.mjs`.
  3. **A auditoria:** `docs/auditoria-produto-2026-11-26.md`.
- Esta proposta é o único arquivo novo.

**Divergências entre a auditoria e o código**

| # | O que a auditoria disse | O que o código mostra | Efeito na proposta |
|---|---|---|---|
| 1 | A abertura obrigatória ("quem escreve, na primeira frase") é cobrada pela conferência `agencyReview` | Quem cobra é a `formatReview`, com o achado `opening`, marcado como menor (sozinho, não provoca correção). A `agencyReview` confere outra coisa: frases sobre experiência ou clientes da agência que os dados não sustentam | Mudar a abertura mexe na `formatReview` e no prompt. A `agencyReview` continua como está |
| 2 | (implícito) O nome da agência precisa estar no começo da mensagem para a aprovação passar | `messageIssues` exige o nome da agência **em qualquer ponto** do corpo do primeiro contato, e a assinatura já cumpre isso | Tirar a abertura obrigatória não esbarra na regra de aprovação |
| 3 | As recomendações eram quatro | São seis: Abordar agora, Preparar acesso, Investigar mais, Acompanhar, Descartar por enquanto, Sem base suficiente (`packages/contracts/src/investigation.ts:276`) | O glossário (C.22) cobre as seis |
| 4 | O KI-171 foi descrito como conflito com a prospecção automática | O KI-171 registra que os termos da Hostinger não têm exceção para mensagem individual. O conflito que ele descreve é com o envio automático (E4), mas, pelo mesmo texto, a prospecção fria enviada à mão pela mesma caixa também pode estar coberta | Vira a decisão D1, que afeta o botão "Abrir no e-mail" |
| 5 | O rodapé de opt-out foi tratado como coisa do e-mail | O rodapé vale para **todo** primeiro contato, inclusive pelo LinkedIn (`withContactFooter` não olha o canal). Numa nota de conexão de 300 caracteres, ele ocupa metade do espaço | Entra na decisão D2 (texto curto para o LinkedIn) |

**Fatos do código que definem o que exige banco e o que não exige**
- `approve_message` só aprova mensagem em rascunho. Por isso, reaprovar hoje exige uma versão nova.
- O app calcula o `payload_hash` e o grava em `outbound_messages`; o banco só compara. Mudar o que entra no hash não exige migração.
- `llm_calls.task` só aceita as quatro tarefas atuais: criar uma tarefa de IA nova exige migração. Ajustar a temperatura em cada chamada não exige.
- `claims.subject_type` já aceita `contact`. `company_identifiers` já aceita `phone`, `instagram` e `linkedin_url`.
- `tasks.cancel_reason` já aceita `opportunity_closed`.
- `outbound_messages.tone` só aceita os quatro tons atuais. Por isso, manter os identificadores e mudar só os nomes na tela não exige migração.
- A tabela `company_investigations` já aceita investigações com gatilho `discovery`.

## Decisões que precisam ser suas

Algumas partes dependem destas escolhas. Até elas serem tomadas, essas partes ficam paradas, e o resto do plano segue normalmente.

| # | Decisão | Por que importa | O que fica parado |
|---|---|---|---|
| D1 | Por qual caixa e provedor sai a prospecção, mesmo enviada à mão | Termos da Hostinger (KI-171) | O botão "Abrir no e-mail" apontando para a caixa da agência (fase 3) e qualquer envio futuro |
| D2 | Texto de opt-out e de privacidade, incluindo uma versão curta para o LinkedIn | Base legal e parecer jurídico em aberto (KI-005, KI-048, KI-051) | O rodapé novo (fase 5) |
| D3 | De onde os contatos podem vir: site da empresa, quadro de sócios da Receita, resultados de busca pública ou informação digitada por você | LGPD (regra 7: base legal e origem de cada contato) e termos de uso (regra 6: do LinkedIn, só o endereço do perfil, sem ler a página) | O módulo de contatos (fase 6) |
| D4 | 10 a 20 mensagens reais suas, boas e ruins, para o guia de voz | Sem elas, o guia novo seria outra invenção | O guia de voz novo (fase 5) |
| D5 | Assinar as mensagens com o nome de quem escreve, usando a identidade de Configurações › E-mail | Hoje a assinatura é só o nome da agência | A assinatura nova (fase 5) |
| D6 | Interpretar a resposta automaticamente quando ela é colada (gasta alguns segundos de GPU) | Tira um clique de cada resposta | O "colar e já interpretar" (fase 3) |

---

## Parte A: nova experiência

**A ideia central:** o Prospector passa a conduzir. Cada tela responde a três perguntas: onde estou, o que posso fazer e qual é o próximo passo. O próximo passo é sempre um botão, nunca uma instrução escrita.

### A.1 O uso de ponta a ponta

**1. Hoje (tela inicial)**

Mostra uma lista do que precisa de você, nesta ordem:
1. respostas recebidas, para tratar;
2. mensagens aprovadas esperando envio, com a validade;
3. rascunhos para revisar;
4. follow-ups de hoje e atrasados;
5. empresas já analisadas que esperam a sua decisão ("Vale abordar?");
6. empresas para rever, cuja análise ficou velha;
7. pesquisas que trouxeram empresas novas.

Cada item tem um botão que leva direto à ação. O estado do banco e da IA só aparece quando algo está errado.

**2. Descobrir**
- **Pedido:** um campo grande, "Que tipo de empresa você procura?". Os filtros (cidade, estado, quantidade, profundidade) ficam recolhidos.
- **Andamento:** a pesquisa avisa o que está fazendo, em frases: "Procurando na internet (4 de 6 buscas)", "Conferindo os sites encontrados".
- **Cada resultado mostra:**
  - nome e cidade;
  - se o site foi conferido;
  - potencial (Alto, Médio ou Baixo);
  - "Por que apareceu", numa frase com a fonte;
  - dois botões: **Analisar empresa** e **Descartar**. "Salvar para depois" fica no menu do cartão.

**"Analisar empresa" faz o que o nome diz.** Cria a empresa, grava as evidências e começa a análise na hora. Você vai para a página da empresa, que mostra o andamento ("Lendo o site", "Olhando a marca", "Procurando concorrentes", cerca de 2 minutos) e preenche cada seção quando ela fica pronta. Se você sair da tela, a análise continua, e Hoje avisa quando terminar.

**3. Página da empresa (análise)**

No topo vem a resposta à pergunta **"Vale abordar?"**: o potencial, a segurança da análise e o porquê em três linhas. Logo abaixo, o próximo passo como botão:

| Situação | Botão |
|---|---|
| Vale abordar e já se sabe com quem falar | Preparar mensagem |
| Vale abordar, mas falta o contato (hoje, "Preparar acesso") | Encontrar com quem falar |
| Falta informação | Completar a análise (dizendo o que falta) |
| Ainda não é a hora | Acompanhar |
| Não vale a pena agora | Deixar de lado |

Embaixo, nesta ordem de relevância:
1. a oportunidade;
2. o diagnóstico de marca;
3. os problemas e oportunidades;
4. os serviços que fazem sentido;
5. os concorrentes;
6. com quem falar;
7. as conversas.

Evidências, capturas, cadastro da Receita, histórico e detalhes técnicos ficam em seções recolhidas.

**4. Com quem falar (contatos)**
- É uma seção dentro da página da empresa.
- Lista as pessoas cadastradas, cada uma com: cargo, e-mail, LinkedIn, telefone, de onde veio a informação e quando foi conferida.
- Quando ainda não há ninguém, a tela diz isso claramente: "Ainda não sabemos com quem falar nesta empresa", com o botão [Adicionar contato].
- Nada é inventado: nenhum e-mail é deduzido a partir do nome.

**5. Preparar mensagem**

Um painel com cinco escolhas, quase todas já preenchidas:

| Escolha | Opções |
|---|---|
| Para quem | Uma pessoa da lista de contatos, ou "Escrever para a empresa" |
| Serviço | Vem pré-selecionado o que a análise recomendou |
| Canal | E-mail ou LinkedIn, conforme o que se sabe da pessoa |
| Objetivo | Abrir uma conversa, Apresentar a agência, Convidar para conversar, Pedir indicação de quem cuida da marca, Retomar contato |
| Ajustes (recolhido) | O tom e um pedido livre para a IA |

O resultado é uma mensagem pronta para revisar, com a fonte de cada observação ao lado.

**6. Revisar, aprovar e enviar**

Tudo acontece num único cartão, que muda de botões conforme o estado:

| Estado da mensagem | Botões |
|---|---|
| Rascunho | Editar, Pedir outra versão, Aprovar |
| Aprovada | Copiar; Abrir no e-mail ou Abrir LinkedIn; Marquei como enviada |
| Aprovação vencida, texto sem mudança | Aprovar de novo |

"Marquei como enviada" registra na hora, com a data de agora, o destinatário escolhido e a etapa "Contatada". Um link "ajustar" deixa trocar a data.

**7. Conversas**
- Uma lista única do que está em andamento, com o que pede ação primeiro.
- Ao abrir uma conversa, você vê a linha do tempo e, no topo, o botão [Colar resposta recebida].
- Ao colar a resposta, a IA lê, resume e sugere o próximo passo. Também deixa pronto um rascunho de resposta e uma data de follow-up para você aceitar.
- Responder fica assim: colar a resposta, revisar o rascunho, aprovar e copiar, marcar como enviada.

**8. Funil:** kanban por etapa, com arrastar. Para marcar ganha ou perdida, o sistema pede o motivo.

### A.2 Antes e depois, em passos

| Tarefa | Hoje | Depois |
|---|---|---|
| Da empresa encontrada ao diagnóstico | Investigar na Descoberta, abrir o dossiê, clicar Investigar empresa | Analisar empresa |
| Da mensagem aprovada ao registro do envio | Aprovar, ir à oportunidade, abrir a seção recolhida, preencher data e função, Já enviei | Aprovar, Copiar ou Abrir, Marquei como enviada |
| Responder a uma pessoa | Registrar resposta, Interpretar, Usar como rascunho, Aprovar, Já enviei, mais a navegação entre telas | Colar resposta, revisar, Aprovar, Marquei como enviada |
| Reaprovar um texto sem mudanças | Preparar para aprovar de novo, Aprovar | Aprovar de novo |

### A.3 O que não muda por baixo

- Evidências com tipo, fonte e confiança calculada no servidor (regra 1).
- Aprovação humana do texto exato, com `payload_hash`, válida por 72 h e usada uma vez só (regra 2).
- Nenhum envio automático de prospecção.
- IA local, com um gateway único e prompts versionados.
- Auditoria gravada na mesma transação.
- Supressão imediata, que vale também para empresas relacionadas, e opt-out obrigatório até a primeira resposta.

---

## Parte B: nova arquitetura de navegação

### B.1 Menu proposto

```
JORNADA
  Hoje             /
  Descobrir        /descoberta        abas: Pesquisar · Salvas · Buscas automáticas
  Empresas         /empresas          lista; página da empresa com Análise · Com quem falar · Conversas
  Conversas        /relacionamento    abas: Para enviar · Em andamento · Funil

APOIO (menor, abaixo)
  Copiloto         /copiloto
  Resultados       /inteligencia
  Configurações    /configuracoes
```

**Regras do menu**
- **Endereços:** o menu muda os nomes, mas os endereços continuam os mesmos sempre que possível. Isso evita quebrar links, testes e favoritos. Só as páginas que forem juntadas a outras ganham redirecionamento.
- **Rodapé do menu:** em vez de três indicadores, um só: "Tudo funcionando" ou "Algo precisa de atenção". Ele leva a Configurações › Avançado › Estado do sistema.
- **Atalhos de teclado:**
  - G H vai para Hoje, G D para Descobrir, G E para Empresas e G C para Conversas.
  - O Copiloto passa para G I (de IA), atalho que fica livre porque Início vira Hoje.
  - G S abre Configurações.

### B.2 Telas e responsabilidades

| Tela | Para que serve | Junta o que hoje está em |
|---|---|---|
| Hoje | Mostrar o que fazer agora | Início, contadores de Conversas, "Para olhar de novo" do Monitoramento, pendências de Aprovações |
| Descobrir › Pesquisar | Pedir uma pesquisa, acompanhar e ver os resultados | `/descoberta` e `/descoberta/pesquisas/[id]` |
| Descobrir › Salvas | Empresas encontradas que você guardou para depois | `/descoberta/empresas` |
| Descobrir › Buscas automáticas | Pesquisas que se repetem e o que cada uma trouxe | `/descoberta/monitoramentos` e as "Novidades" que vêm de buscas |
| Empresas (lista) | Todas as empresas e em que pé está cada uma | `/empresas`, com o filtro novo "Precisa de nova análise" |
| Página da empresa | Decidir e agir sobre uma empresa | Dossiê, painel de relacionamento e (novo) contatos |
| Conversas › Para enviar | Rascunhos para revisar e mensagens aprovadas esperando envio | `/aprovacoes`, mais rascunhos e abordagens preparadas da aba Abordagens |
| Conversas › Em andamento | Quem respondeu, quem está sendo esperado, follow-ups | `/relacionamento/conversas` |
| Conversas › Funil | Etapas, valores, ganhas e perdidas | `/relacionamento/pipeline` |
| Oportunidade | Uma conversa inteira: mensagens, respostas e próximos passos | `/relacionamento/oportunidades/[id]` (continua) |
| Copiloto | Perguntar sobre os dados e pesquisar na internet | `/copiloto`, sem o painel técnico de IA |
| Resultados | Funil e consumo do mês | `/inteligencia` |
| Configurações | Agência, clientes ideais, contato e privacidade, e-mail e área avançada | `/configuracoes/**` |

### B.3 Configurações reorganizadas

| Seção | Conteúdo | Onde está hoje |
|---|---|---|
| Agência | Serviços (ofertas), voz da agência, cases | Estratégia |
| Clientes ideais | Perfis de cliente ideal (ICP) | Estratégia › ICP |
| Contato e privacidade | Nome da agência, texto de opt-out, canal do titular, LIA | Conformidade |
| E-mail | Quem assina, caixa de envio, conferência | E-mail |
| Avançado | Critérios de avaliação da marca (rubrica), pesos da prioridade (score), IA local, estado do sistema e do banco, histórico de ações | Estratégia, painel do Copiloto, rodapé do menu, Início e Auditoria |

O checklist "Pode abordar?" sai da aba Abordagens e passa a aparecer em dois lugares:
- como aviso nas telas que ele bloqueia, dizendo o item que falta e trazendo o link para resolver;
- no topo de Configurações.

### B.4 O que deixa de ser página própria

| Página de hoje | Para onde vai | O que precisa ser ajustado |
|---|---|---|
| `/aprovacoes` | Conversas › Para enviar (com redirecionamento) | `revalidatePath`, links do Início, paleta, 2 testes de ponta a ponta |
| `/relacionamento` (aba Abordagens) | Conversas › Para enviar, mais o aviso de prontidão | `lib/relationship-routes.ts`, 5 testes de ponta a ponta |
| `/monitoramento` | Hoje (empresas para rever) e Descobrir › Buscas automáticas (novidades), com redirecionamento | Início, paleta, 2 testes de ponta a ponta |
| `/descoberta/empresas/[id]` | Painel lateral no resultado da pesquisa. A rota continua existindo como página de apoio | Links do radar |
| `/configuracoes/auditoria` | Configurações › Avançado › Histórico de ações (com redirecionamento) | 5 testes de ponta a ponta |

**O que fica fora do menu principal e por quê**
- **Copiloto:** é útil, mas não é etapa da jornada. Fica no grupo de apoio e continua com atalho.
- **Resultados (Inteligência):** consulta de vez em quando, não é trabalho diário.
- **Monitoramento:** some como página. A parte que pede ação vai para Hoje; o resto vai para Descobrir.
- **Auditoria:** registro técnico. Vai para Avançado.
- **Painel de IA local:** informação técnica. Sai do Copiloto e vai para Avançado.

Nenhuma funcionalidade é removida: as que saem do menu continuam acessíveis por Configurações, pela paleta (Ctrl+K) e por links de contexto.

---

## Parte C: mudanças por funcionalidade

Cada item segue o mesmo formato: como é hoje, qual é o problema, como deveria ser, o que muda na interface, o que muda na lógica e se o banco muda.

### C.1 Hoje (o atual Início)
- **Hoje:** o painel mostra o estado do banco, proteções escritas fixas, quatro cartões, um funil curto e a atividade recente.
- **Problema:**
  - não diz o que fazer;
  - o botão principal leva à Auditoria;
  - repete o que já está em Resultados.
- **Como deveria:** uma lista de próximos passos, como descrito em A.1.
- **Interface:** a página `app/(shell)/page.tsx` é refeita com componentes de "item de ação".
- **Lógica:** um serviço de leitura novo em `packages/application` (por exemplo, `agendaService`), que junta:
  - `relationship.overview()`: itens de atenção e rascunhos;
  - as aprovações válidas ainda não usadas;
  - as empresas com análise concluída e sem oportunidade;
  - a lista de empresas vencidas do monitoramento;
  - as pesquisas dos últimos 7 dias que trouxeram empresas novas.
- **Banco:** não muda.

### C.2 Descobrir: pesquisa e resultados
- **Hoje:** a página da pesquisa é técnica (plano, créditos por busca, padrões aplicados). Cada cartão tem quatro ações, e "Investigar" não investiga.
- **Problema:**
  - o passo mais importante, analisar a empresa, exige dois cliques em telas diferentes e não avisa;
  - a tela expõe o funcionamento interno.
- **Como deveria:** como em A.1, passo 2.
- **Interface:**
  - `discovery-forms.tsx`: filtros recolhidos; "Quantas empresas" passa a oferecer o teto real (15, 25 ou 40, conforme a profundidade).
  - `pesquisas/[id]`: o andamento aparece em frases. "Como o pedido foi entendido" vira uma linha, e o plano e os créditos vão para "Detalhes".
  - Cartão de resultado: "Analisar empresa" e "Descartar"; "Salvar" vai para o menu; a justificativa vira uma frase com a fonte.
- **Lógica:**
  - `investigateProspectAction` passa a chamar `discovery.investigate` e, em seguida, `investigations.start({ companyId, trigger: 'discovery' })`. O banco já aceita esse gatilho.
  - Se o site não foi conferido, a análise começa mesmo assim, e a etapa "site" faz a procura (1 crédito).
  - Se a fila de análises estiver cheia, a empresa é criada do mesmo jeito, e a tela avisa: "A análise entrou na fila".
  - Antes de começar, o botão avisa o custo: "usa até 5 buscas na internet".
- **Banco:** não muda.

### C.3 Buscas automáticas (os atuais monitoramentos)
- **Hoje:** a tela promete "só o que é novo", mas mostra tudo. As buscas só rodam com o app aberto.
- **Como deveria:**
  - cada execução mostra primeiro as empresas novas e deixa as já vistas recolhidas;
  - a tela diz a verdade: "Roda quando o Prospector está aberto".
- **Lógica:** filtrar pela marcação `is_new` de `discovery_run_prospects`, que já existe.
- **Banco:** não muda.

### C.4 Página da empresa (o atual dossiê)
- **Hoje:** cerca de 11 painéis numa página só, quatro indicadores de confiança diferentes e jargão interno à vista ("K31", "nota M2", códigos de cor como "#818181").
- **Problema:** a decisão de abordar ou não se perde no meio da evidência.
- **Como deveria:** a página fica dividida em blocos.
  1. **Cabeçalho:** nome, cidade, site, etapa e o botão principal, que muda conforme o contexto.
  2. **Vale abordar?:**
     - o potencial comercial;
     - a segurança da análise (um indicador só);
     - o porquê, em até três frases;
     - o botão do próximo passo (tabela abaixo).
  3. **A oportunidade:** o ângulo de abordagem que o diagnóstico encontrou.
  4. **Marca e posicionamento:** de 3 a 5 achados em linguagem de cliente, cada um com "ver de onde vem".
  5. **Serviços que fazem sentido:** um cartão por oferta, com o encaixe e o motivo.
  6. **Concorrentes:** até 3, uma linha cada.
  7. **Com quem falar:** os contatos (ver C.7).
  8. **Conversas:** o painel atual de relacionamento, simplificado.
  9. **Seções recolhidas:**
     - de onde vem cada informação (as evidências);
     - capturas de tela e medidas do site;
     - cadastro da Receita;
     - histórico de análises;
     - detalhes técnicos: modelos, tempos, versões de prompt, conclusões descartadas.
- **Interface:**
  - `empresas/[id]/page.tsx` é reorganizada;
  - `investigation-panels.tsx` (32 KB) é dividido em componentes menores: resumo da decisão, oportunidade, achados de marca, serviços, concorrentes e detalhes;
  - as marcas de referência ("(K31)") são tiradas do texto, como `stripRefs` já faz nas mensagens;
  - a confiança de cada evidência só aparece dentro da seção de evidências.
- **Lógica:** a frase da recomendação e o porquê vêm dos campos que a qualificação e a síntese do diagnóstico já produzem. Não há chamada nova à IA.
- **Banco:** não muda.

**Da recomendação ao próximo passo**

| Valor interno | Rótulo de hoje | Rótulo proposto | Botão |
|---|---|---|---|
| `pursue` | Abordar agora | Vale abordar agora | Preparar mensagem |
| `prepare_access` | Preparar acesso | Vale abordar; falta saber com quem falar | Adicionar contato |
| `investigate_more` | Investigar mais | Falta informação para decidir: (o que falta) | Completar a análise |
| `monitor` | Acompanhar | Ainda não é o momento; revemos em (data) | Acompanhar |
| `discard` | Descartar por enquanto | Não parece uma boa oportunidade agora | Deixar de lado |
| `insufficient_evidence` | Sem base suficiente | Não achamos informação suficiente: (o que falta) | Confirmar o site ou Completar a análise |

### C.5 A análise por trás da tela (investigação)
- **Hoje:**
  - a fila fica na memória do app;
  - depois de um reinício, a retomada é manual;
  - nenhuma etapa tem limite de tempo.
- **Curto prazo, sem mexer no banco:**
  - Quando o app abre, as análises interrompidas são retomadas sozinhas, uma por vez, com as mesmas regras de memória de vídeo.
  - Uma opção em Avançado permite desligar isso.
  - A página da empresa mostra "Análise interrompida; continuando".
- **Médio prazo, com banco (fase 7):**
  - mover a análise para a fila `ai_jobs` (KI-134), com um tipo novo de tarefa;
  - isso exige mudar a restrição de tipos da tabela, ou seja, uma migração.
- **Junto:** quando a empresa veio da Descoberta com CNPJ conferido no site, consultar a Receita no começo da análise.

### C.6 Potencial comercial (a atual qualificação)
- **Hoje:** "Abordar agora" nunca aparece, porque depende de evidência de contato, e nenhum código grava contato.
- **Até existir o módulo de contatos:**
  - o rótulo de `prepare_access` passa a dizer a verdade: "falta saber com quem falar";
  - esse rótulo vira o gancho para o botão "Adicionar contato".
- **Depois do módulo de contatos:** `accessKnown` (`qualify.ts:110`) passa a consultar os contatos da empresa. Conta como acesso conhecido um contato ativo, com e-mail ou LinkedIn, conferido nos últimos 90 dias. A redução de 20% na prioridade sem contato continua, agora aplicada com razão.
- **Dados da Receita:**
  - Proposta: preencher `DEFAULT_EVIDENCE_CLASSIFICATION` (`evidence-service.ts:83`) para que OpenCNPJ e Minha Receita contem como registro oficial. Os dois republicam os dados abertos da Receita.
  - Só vale para consultas novas; consultar a Receita de novo atualiza as antigas.
  - Sem banco.

### C.7 Com quem falar (módulo de contatos, novo)

Funcionalidade estrutural. Ela fica para a fase 6, depois da decisão D3.

**Modelo de dados proposto: tabela de contatos mais evidências**

Uma tabela só não basta. Pela regra 1, cargo e e-mail de uma pessoa são afirmações que precisam de fonte e confiança. Só evidências também não bastam: elas não servem para listar, escolher destinatário, ligar a mensagens nem apagar dados por pessoa. A proposta combina as duas:
- uma tabela `contacts` guarda a pessoa e os valores em uso;
- cada valor importante (cargo, e-mail, LinkedIn, telefone) é gravado também como evidência com `subject_type = 'contact'`, que o banco já aceita. A evidência tem fonte, data e a confiança calculada pelo servidor (o assunto `contact` já tem validade de 90 dias).

| Coluna de `contacts` | Tipo | Regra |
|---|---|---|
| `id` | uuid | Chave |
| `company_id` | uuid, referência a `companies` | Obrigatória. Uma empresa pode ter vários contatos |
| `full_name` | texto, de 2 a 160 caracteres | Obrigatório. Nome profissional, sem apelido nem dado pessoal extra |
| `role_title` | texto, até 120, opcional | Cargo ou função como a fonte diz |
| `email` | texto, opcional, em minúsculas e com formato conferido | Só e-mail publicado pela empresa ou pela pessoa, ou informado por você. **Nunca deduzido** (nada de "nome@dominio") |
| `linkedin_url` | texto, opcional, só `https://www.linkedin.com/in/…` | Guardamos só o endereço; a página não é lida (regra 6) |
| `phone` | texto, opcional, no formato internacional | Só telefone comercial publicado ou informado |
| `origin` | `user`, `company_site`, `registry_partners`, `web_search` ou `reply` | Obrigatória. A lista final sai da decisão D3 |
| `source_id` | uuid, referência a `sources`, opcional | A página ou resultado de onde veio, com o trecho guardado |
| `legal_basis` e `lia_version_id` | texto e uuid | Base legal (legítimo interesse) e a versão da LIA em vigor quando o contato foi gravado (regra 7) |
| `last_verified_at` | data e hora | Última conferência |
| `status` | `active`, `left_company`, `do_not_contact` ou `archived` | — |
| `retention_until` | data e hora | Prazo de guarda, com apagamento automático |
| `is_demo`, `created_at`, `updated_at` | — | Padrão do projeto |

- **Unicidade:** não pode haver dois contatos na mesma empresa com o mesmo e-mail (comparado em minúsculas), nem com o mesmo LinkedIn.
- **Segurança:** RLS ligado e nenhuma política, como em todas as tabelas. Gatilho de auditoria. O teste de catálogo (`pnpm test:db`) passa a cobrir a tabela.
- **Confiança:** não é um número digitado. O servidor calcula a partir das evidências da pessoa:
  - informado por você: 0,7;
  - site da empresa: 0,85;
  - resultado de busca: 0,4.

  Na tela aparece uma etiqueta: Confirmado, Provável ou A conferir.

**Ligações com as tabelas que já existem (todas opcionais, para não quebrar o histórico)**

| Tabela | Coluna nova | Para quê |
|---|---|---|
| `outbound_messages` | `contact_id` | Destinatário da mensagem |
| `interactions` | `contact_id` | Quem respondeu, ou para quem foi o envio |
| `opportunities` | `primary_contact_id` | Contato principal da oportunidade |
| `suppression_entries` | `contact_id` | "Não contatar" de uma pessoa só |

**Impactos no que já existe**

| Onde | Mudança |
|---|---|
| Hash da aprovação | `messagePayload` passa para a versão 2 e inclui o destinatário (`contact_id` e endereço) quando houver. É o primeiro pré-requisito do KI-172. As aprovações antigas, na versão 1, continuam válidas até vencer. Sem migração, porque o hash é calculado no app |
| Qualificação | `accessKnown` passa a ler os contatos (C.6) |
| Supressão | O pedido de uma pessoa para parar suprime **a pessoa**. Por prudência, a empresa também continua suprimida por padrão quando a resposta é uma recusa da empresa; mudar isso é decisão sua |
| Preparar mensagem | Ganha o campo "Para quem". O prompt recebe o primeiro nome e o cargo, nunca o e-mail |
| Envio manual | "Abrir no e-mail" preenche o destinatário |
| Apagamento | É a primeira tabela do Relacionamento com apagamento automático (KI-015, KI-122). Apagar um contato deixa `contact_id` vazio nas mensagens; o hash fica, mas o endereço some |
| Pedidos de titulares | Com as pessoas cadastradas, ficam possíveis "Exportar os dados desta pessoa" e "Apagar esta pessoa" (KI-126, F9) |
| Cadastro pela Receita | Hoje o quadro de sócios é descartado de propósito. Se a decisão D3 permitir, os sócios podem aparecer como **sugestões** a confirmar, com a origem `registry_partners` |
| Copiloto | Pela exceção da regra 7, a pesquisa e o Copiloto não recusam dados de pessoas. Mais tarde, uma ferramenta pode **sugerir** contatos achados em busca pública, e gravar continua dependendo de você confirmar. Essa ferramenta exige um prompt avaliado, que fica fora desta proposta |
| Descoberta | Não muda. Contatos não entram na pesquisa de empresas |

**Interface:**
- Na página da empresa:
  - a seção "Com quem falar", com a lista e um formulário de contato (nome, cargo, e-mail, LinkedIn, telefone e "de onde veio", que é obrigatório);
  - as ações "Marcar como conferido hoje" e "Saiu da empresa".
- Em "Preparar mensagem", o seletor "Para quem".
- Sem contato, a tela diz isso claramente e oferece "Escrever para a empresa".

### C.8 Preparar mensagem
- **Hoje:** o usuário escolhe oferta, tipo (entre 8), tom (entre 4) e pode escrever um pedido livre. O plano aparece com campos técnicos.
- **Como deveria:** como em A.1, passo 5.
- **Interface:** `components/relationship/forms.tsx` (o formulário de abordagem) e `company-panel.tsx`. O tom e o pedido livre vão para "Ajustes".
- **Lógica:** o objetivo escolhido é traduzido, em `packages/application`, para os tipos que já existem. O contrato não muda.

| Objetivo (tela) | E-mail | LinkedIn |
|---|---|---|
| Abrir uma conversa | `initial_email` | `short_message` |
| Apresentar a agência | `presentation` | `short_message` |
| Convidar para conversar | `meeting_invite` | `meeting_invite` |
| Pedir indicação de quem cuida da marca | `short_message`, com instrução pronta | `short_message`, com instrução pronta |
| Retomar contato | `follow_up` (enquanto se espera a primeira resposta) ou `reengagement` (conversa parada) | igual |

- **Plano de abordagem:** só "Por que esta abordagem" (o argumento) e "Em que se apoia" (as fontes) ficam à vista; o resto vai para os detalhes.
- **Banco:** não muda até existirem os contatos.

### C.9 Geração das mensagens
Detalhada na Parte D. As mudanças de código ficam todas em `packages/agents/src/relationship/relationship-ai.ts`, mais um ajuste no gateway, sem banco:
- `contextData()`:
  - passa a enviar os exemplos ruins do guia de voz;
  - deixa de enviar medidas técnicas cruas (`visual.measure.*`) e dados financeiros do cadastro (como o capital social);
  - inclui o destinatário: primeiro nome e cargo.
- A conferência automática só pede correção por problema de **fato**: fonte, nome inventado, marcador entre colchetes, afirmação sobre a agência, proporção ou intensidade. Problemas de forma, como tamanho ou lista, viram aviso.
- `formatReview` deixa de cobrar a abertura com o nome da agência nas versões novas do prompt.
- Conferências determinísticas novas: jargão técnico e frases feitas (ver D.6).
- `closeDraft`:
  - a despedida passa a variar com o tom;
  - a assinatura passa a usar a identidade de Configurações › E-mail (D5): nome, cargo e agência.
- O gateway passa a aceitar a temperatura **em cada chamada**. Hoje ela é fixa por tarefa, e criar uma tarefa nova exigiria migração em `llm_calls`.

### C.10 Aprovar e enviar
- **Hoje:**
  - aprovar e registrar ficam em lugares diferentes;
  - não há como copiar com um clique nem abrir o e-mail;
  - uma aprovação vencida exige preparar uma versão nova.
- **Interface:** `message-thread.tsx` ganha os estados de A.1, passo 6.
  - **Copiar:** usa a área de transferência do navegador, que funciona em `127.0.0.1`. Copia assunto e corpo da versão aprovada, vindos do servidor.
  - **Abrir no e-mail:** um link `mailto:` com o assunto e o corpo e, quando já houver contato, o destinatário.
  - **Abrir LinkedIn:** abre o perfil do contato. O texto é copiado antes.
  - **WhatsApp:** continua só depois do opt-in, apenas com copiar.
  - **Aprovar e copiar:** existe como um botão só.
  - **Nota pequena no cartão:** "Se mudar o texto no e-mail, ele deixa de ser o aprovado." Hoje o app não tem como impedir isso.
- **Lógica:**
  - "Marquei como enviada" chama `recordOutbound` com valores já preenchidos: agora, o cargo do contato (ou a função do plano) e a mudança para "Contatada".
  - "Aprovar de novo", quando o texto não mudou, é um método novo que cria uma versão idêntica e a aprova em seguida. O hash é o mesmo e o histórico fica. São duas chamadas ao banco; se a segunda falhar, sobra um rascunho, como acontece hoje.
  - As regras de aprovação não mudam: hash, 72 h, uso único e as conferências de supressão e de conformidade.
- **Dependência:** a decisão D1. Enquanto ela não sai, o botão "Abrir no e-mail" mostra o aviso: "Confira se a sua caixa permite mensagens de prospecção (termos do provedor)".
- **Banco:** não muda. O destinatário no hash entra na fase 6.

### C.11 Conversas e respostas
- **Interface:**
  - **Em andamento:** uma lista só, em quatro grupos: Responderam; Follow-up hoje ou atrasado; Esperando resposta (há N dias); Paradas há mais de 30 dias.
  - **Colar resposta recebida:** fica no topo da oportunidade.
- **Lógica:**
  - **Interpretação automática (se a decisão D6 for sim):** ao gravar a resposta, `analyzeReply` roda sozinho. Quando a leitura indicar que cabe responder (e não for recusa nem pedido para parar), `draftSuggestedReply` cria o rascunho, e a data de follow-up vem sugerida para aceitar com um clique.
  - **Sugestão de etapa:** `suggestStage`, que já existe e não é usado, passa a sugerir a etapa ("parece que avançou para Reunião").
  - **Supressão:**
    - a regra por palavras-chave continua imediata;
    - a leitura da IA com confiança média continua suprimindo, porque o opt-out deve ser honrado na hora. A diferença é que a tela passa a mostrar isso com destaque e oferece [Não era pedido para parar], que retira a supressão com a justificativa já preenchida;
    - notas do próprio usuário deixam de passar por `detectStopRequest` (bug 6 da auditoria).
- **Banco:** não muda.

### C.12 Follow-ups
- **"Vencido" com uma regra só:** o follow-up aparece como "para hoje" durante o dia e como "atrasado" a partir do dia seguinte. Hoje o detalhe e Conversas divergem (`lib/relationship-dates.ts` e `oportunidades/[id]/page.tsx:440`).
- **Encerrar a oportunidade cancela os follow-ups abertos**, com o motivo `opportunity_closed`, que o banco já aceita.
  - Recomendação: fazer isso dentro da função `change_opportunity_stage`, numa migração (fase 7), para ficar na mesma transação.
  - Alternativa sem migração: fazer no serviço logo depois da mudança de etapa. É mais simples, mas não fica na mesma transação.

### C.13 Funil (pipeline)
- **Kanban:** passa a deixar arrastar o cartão, usando o mesmo `change_opportunity_stage`. "Perdida" pede o motivo numa janela.
- **Uma etapa só na lista de Empresas:** com oportunidade aberta, a lista mostra a etapa da oportunidade; sem oportunidade, a etapa da empresa.
- **Etapa da empresa automática:** contatada vira "Em conversa"; ganha vira "Cliente". Hoje isso é manual. A mudança é na lógica de aplicação, sem banco.
- **Bugs corrigidos sem banco:**
  - preparar uma abordagem numa oportunidade aberta em etapa anterior passa a movê-la para "Mensagem pronta";
  - a prioridade passa a vir da análise, em vez de ser sempre "média";
  - quando a oferta do plano for diferente da oferta da oportunidade, o sistema pergunta se deve atualizar a oportunidade.

### C.14 Agência e clientes ideais (a atual Estratégia)
- **"Bloqueado" para descobrir:** a Descoberta foi feita para funcionar sem estratégia (`discovery-engine.ts:1304`). Proposta: tirar o selo e a lista "Para descobrir empresas" e explicar que "A pesquisa usa o seu perfil de cliente ideal ativo, se houver". `assertReadyToDiscover` continua no código, sem uso. Alternativa, caso você prefira bloquear de verdade: ligar a checagem.
- **Escolha do perfil na pesquisa:** passa a existir em Descobrir, como filtro opcional. Hoje o motor pega o primeiro perfil ativo.
- **Rubrica:** vai para Avançado com o nome "Critérios de avaliação da marca".
  - "Peso" e "evidências exigidas" ficam escondidos até serem usados.
  - Os dados continuam no banco.
  - O identificador passa a ser gerado automaticamente a partir do nome.
- **Pesos da prioridade (modelo de score):** vão para Avançado, com uma explicação curta.
- **Preço da oferta:** hoje é exigido para ativar, mas nada o usa. Proposta: torná-lo opcional (`domain/src/strategy/rules.ts:94`). Sem banco.
- **Campos técnicos:**
  - exemplos: um campo por exemplo, com botão "Adicionar", no lugar das linhas com "---";
  - CNPJ: "Empresas do mesmo grupo a excluir (CNPJ)" no lugar de "Raízes de CNPJ";
  - CNAE: busca por nome da atividade, numa fase posterior, porque depende de uma lista de CNAE no código.
- **Textos:** "Tudo é versionado" passa a dizer "exceto cases". O botão "Pausar" do ICP passa a se chamar "Voltar para rascunho".

### C.15 Contato e privacidade (a atual Conformidade)
- **LIA:** as categorias e origens de dados passam a ter a legenda "registro para a sua avaliação; não muda o funcionamento do app".
- **Opt-out:** o texto continua sendo seu, em Configurações. A proposta de um texto mais curto, que também diga de onde veio o contato, está em D.5 e depende da decisão D2.

### C.16 E-mail
- **Textos que prometem o que não existe:**
  - "Os envios de prospecção chegam depois, com aprovação em lote" passa a ser "O Prospector ainda não envia mensagens de prospecção; esta caixa é usada no e-mail de teste";
  - "Bloqueia a prospecção:" passa a ser "Precisa de ajuste:".
- **Campos e verificações sem uso:**
  - "Limite de envios por dia": o campo some até existir envio; o dado continua no banco;
  - IMAP: a falha deixa de bloquear o status "caixa conferida" e passa a aparecer como "Leitura de respostas: ainda não usada" (`domain/relationship/mailbox.ts`).
- **Assinatura nas mensagens (D5):** a identidade de "Quem assina" passa a assinar as mensagens copiadas. Hoje a tela de e-mail e o Relacionamento não se conversam.
- **Banco:** não muda.

### C.17 Copiloto
- **Painel técnico de IA:** sai da tela do Copiloto e vai para Avançado. O erro de "ainda não usado" é corrigido: `IN_USE` em `local-ai-status.tsx:20` passa a incluir `reasoning` e `vision`.
- **Prompt:** continua o `copilot/v3` e o `copilot-tools/v3`. Nenhum outro é promovido sem avaliação (o v6 teve 74%, abaixo do limiar de 75%).
  - O texto do v3 que diz que Aprovações está "em construção" só muda com uma versão nova avaliada, fora desta proposta.
  - O que dá para corrigir agora, sem mexer no prompt: os fatos do sistema geram "Módulos ainda em construção…: ." quando a lista está vazia. A linha deixa de aparecer nesse caso (`system-facts.ts:119`).
- **Ferramentas:** as de Descoberta, Investigação e Relacionamento continuam desligadas.

### C.18 Resultados (a atual Inteligência)
- Muda de nome.
- A frase "Aprendizados… ainda não existem" sai.
- As chamadas de IA da Descoberta passam a ser registradas em `llm_calls`, com a tarefa `reasoning`, que já é aceita (KI-184). Só código.

### C.19 Monitoramento
Deixa de ser página própria (ver B.4). As partes vão para outros lugares:
- "Para olhar de novo" vira o item "Empresas para rever" em Hoje e o filtro "Precisa de nova análise" em Empresas;
- "Novidades" vai para Descobrir › Buscas automáticas (empresas novas) e para a página de cada empresa ("O que mudou").

O serviço `monitoring-service.ts` continua o mesmo.

### C.20 Histórico de ações (a atual Auditoria)
- Ganha rótulos em português para as 24 ações que hoje aparecem como código.
- A entidade passa a aparecer pelo nome (por exemplo, "Oferta Identidade visual"), e não mais como `offer · uuid`.
- Ganha filtro por tipo de ação.
- Sem banco.

### C.21 Mensagens de erro e estado do sistema
- **Variáveis de ambiente e comandos** (`TAVILY_API_KEY`, `DISCOVERY_DAILY_AUTO_CREDITS=0`, `ollama pull …`, `apps/web/.env.local`) somem das telas do dia a dia. Em seu lugar, uma frase sobre o problema e um link para Configurações › Avançado, onde ficam o detalhe e o passo a passo.
- **Código de rastreio e sufixos como "(HTTP 503)":** vão para "Detalhes técnicos", uma seção recolhida.
- **Painel "Proteções desta instalação" do Início:** vai para Avançado, mostrando os dados reais do sistema em vez de texto fixo.

### C.22 Linguagem e microcopy

**Princípios**
- Dizer o que aconteceu, por que importa e o que fazer, nesta ordem.
- Nada de nome interno, sigla de roadmap (F5, F10), variável de ambiente, identificador ou código de cor fora de Avançado.
- Quando faltar algo, dizer exatamente o quê ("Não encontramos o site oficial"), e não a categoria ("Evidências insuficientes").
- Uma palavra para cada conceito, a mesma em todas as telas.
- Frases curtas. A IA é "a IA", não "a IA local". "Leitura interna" não aparece.

**Glossário proposto.** Os textos finais devem ser conferidos tela a tela na implementação.

| Onde | Hoje | Proposta |
|---|---|---|
| Menu | Início | Hoje |
| Menu | Descoberta | Descobrir |
| Menu | Relacionamento | Conversas |
| Menu | Abordagens (aba) | Para enviar |
| Menu | Pipeline | Funil |
| Menu | Inteligência | Resultados |
| Menu | Monitoramentos (na Descoberta) | Buscas automáticas |
| Menu | Configuração | Configurações |
| Configurações | Estratégia | Agência; Clientes ideais |
| Configurações | Conformidade | Contato e privacidade |
| Configurações | Auditoria | Histórico de ações |
| Configurações | ICP | Perfil de cliente ideal |
| Configurações | Rubrica de auditoria | Critérios de avaliação da marca |
| Configurações | Modelo de score | Pesos da prioridade |
| Configurações | "Cobertura mínima de evidência (%)" | "Quanto precisamos saber antes de recomendar (%)" |
| Configurações | "Raízes de CNPJ excluídas" | "Empresas do mesmo grupo a excluir (CNPJ)" |
| Configurações | "Separe exemplos com uma linha contendo só ---" | Um campo por exemplo, com "Adicionar exemplo" |
| Configurações | "O redator (F10) segue esta voz." | "A IA segue esta voz ao escrever as mensagens." |
| Configurações | "Pausar" (ICP) | "Voltar para rascunho" |
| Descobrir | Investigar | Analisar empresa |
| Descobrir | Ignorar | Descartar |
| Descobrir | Salvar | Salvar para depois |
| Descobrir | Triagem | Por que apareceu |
| Descobrir | Sinais / Radar de sinais | Movimentos recentes |
| Descobrir | "cobertura de X% das dimensões" | "Analisamos X de 4 critérios" |
| Descobrir | "Resumo da IA local (não é evidência)" | "Resumo feito pela IA (sem fonte)" |
| Descobrir | "(regra do sistema)" | "critério do Prospector" |
| Descobrir | "Preenchido por padrão:" | "Também consideramos:" |
| Descobrir | "Créditos da Tavily neste mês: X de Y" | "Buscas na internet neste mês: X de Y" |
| Empresa | Dossiê | Página da empresa (aba Análise) |
| Empresa | Qualificação | Potencial comercial |
| Empresa | Confiança geral | Segurança da análise |
| Empresa | Fato / Inferência / Hipótese | Confirmado na fonte / Conclusão da análise / A confirmar |
| Empresa | Evidências | De onde vem cada informação |
| Empresa | Raciocínio | Como chegamos a isso |
| Empresa | Força das evidências | Quanto já sabemos |
| Empresa | Desqualificadores acionados | Motivos para não oferecer |
| Empresa | Medições técnicas | Medidas do site (em Detalhes) |
| Empresa | Investigar empresa / Investigar de novo / Coletar tudo de novo | Analisar / Atualizar a análise / Refazer a análise do zero |
| Empresa | Retomar de onde parou | Continuar a análise |
| Empresa | "Verificação: N conclusões da IA descartadas" | Em Detalhes: "N conclusões da IA foram descartadas por não terem fonte" |
| Empresa | Etapas: Candidata / Em investigação | Nova / Em análise |
| Conversas | Oportunidade identificada | Nova |
| Conversas | Abordagem preparada | Mensagem pronta |
| Conversas | Preparar abordagem | Preparar mensagem |
| Conversas | Abrir oportunidade sem IA | Começar sem a IA |
| Conversas | "Revisei este texto e aprovo o uso dele, exatamente como está, por e-mail." | "Li e aprovo este texto para envio por e-mail." |
| Conversas | Aprovar para uso | Aprovar |
| Conversas | Preparar para aprovar de novo | Aprovar de novo (texto igual) ou Revisar e aprovar (texto mudou) |
| Conversas | Já enviei: registrar o contato feito | Marquei como enviada |
| Conversas | Registrar resposta recebida | Colar resposta recebida |
| Conversas | Interpretar com a IA | Automático; o botão "Ler de novo" fica em Detalhes |
| Conversas | Usar como rascunho de resposta | Responder com esta sugestão |
| Conversas | "rascunho da IA local" | "Sugestão da IA" |
| Conversas | "Rascunhos versionados. Cada versão precisa da sua aprovação…" | "Cada mudança no texto pede uma nova aprovação." |
| Conversas | "Conformidade atendida: mensagens revisadas podem ser aprovadas…" | "Tudo certo para abordar." |
| Conversas | "A conformidade para abordar não está atendida (veja acima)." | "Falta configurar: (item), com link." |
| Conversas | "Cita N evidência(s) do dossiê que não está mais em vigor." | "Esta mensagem usa N informação(ões) desatualizada(s). Atualize a análise ou revise o texto." |
| Conversas | "WhatsApp (só se o prospect pediu)" | "WhatsApp (só se a empresa escreveu por lá)" |
| Conversas | "Reabra-a no pipeline" | "Para voltar a falar com esta empresa, reabra a oportunidade" (com botão na própria tela) |
| Conversas | "Lido em…" em todo painel | Sai dos painéis; aparece só em Detalhes |
| Conversas | "Outra alteração foi salva ao mesmo tempo…" | "Esta tela estava desatualizada. Mostramos agora a versão atual." |
| E-mail | "Bloqueia a prospecção:" / "Aviso:" | "Precisa de ajuste:" / "Atenção:" |
| E-mail | "Caixa simulada (PROSPECTOR_EMAIL=fixture)" | "Modo de demonstração: nenhuma caixa real está ligada." |
| E-mail | "Só monitora (p=none)" | "Proteção do domínio contra falsificação: só observação" |
| Sistema | "Defina TAVILY_API_KEY em apps/web/.env.local…" | "A pesquisa na internet não está ligada nesta instalação. Veja como ligar em Configurações › Avançado." |
| Sistema | "Monitoramentos não rodam sozinhos nesta instalação (DISCOVERY_DAILY_AUTO_CREDITS=0)" | "As buscas automáticas estão desligadas. Use Rodar agora ou ligue em Configurações › Avançado." |
| Sistema | "Instale com "ollama pull qwen3.5:4b" e clique em Atualizar." | "O modelo de IA não está instalado. Veja como instalar em Configurações › Avançado › IA local." |
| Sistema | "A conexão com o Prospector caiu. O app ainda está rodando no terminal?" | "Perdemos a conexão com o Prospector. Feche e abra o app de novo." |
| Sistema | "Sem base suficiente" | "Falta: (lista do que falta), por exemplo o site oficial ou uma oferta ativa" |
| Aprovações | "Revise e aprove de novo.." | Pontuação corrigida |

### C.23 O que aparece na interface sem funcionar

A regra combinada:
- o que funciona é apresentado do jeito certo;
- o que funciona em parte mostra a limitação;
- o que não funciona não aparece como se funcionasse;
- configuração sem uso é integrada ou sai da tela, mas os dados no banco ficam.

| # | Elemento | Onde | Situação | Decisão | Fase |
|---|---|---|---|---|---|
| 1 | "Para descobrir empresas: Bloqueado" | Estratégia | Não bloqueia nada | Tirar o bloqueio da tela e explicar o uso do perfil ativo | 1 |
| 2 | "aprovação em lote" | E-mail | Não existe | Tirar o texto | 1 |
| 3 | "Limite de envios por dia" e status "pausada" | E-mail | Gravados e nunca usados | Esconder; os dados ficam | 1 |
| 4 | "Bloqueia a prospecção:" | E-mail | Não há envio de prospecção para bloquear | Trocar por "Precisa de ajuste:" | 1 |
| 5 | IMAP exigido para "caixa conferida" | E-mail | A leitura de respostas não existe | Passa a ser só aviso | 1 |
| 6 | "Cada execução mostra só o que é novo" | Buscas automáticas | Mostra tudo | Corrigir o texto (fase 1) e mostrar as novas primeiro (fase 2) | 1 e 2 |
| 7 | "Quantas empresas: até 50" | Descobrir | O teto real é 15, 25 ou 40 | Oferecer o teto real | 1 |
| 8 | "ainda não usado" para Análise e Imagens | Painel de IA | As duas estão em uso | Corrigir `IN_USE` | 1 |
| 9 | Peso e "evidências exigidas" da rubrica | Estratégia | A investigação ignora os dois | Esconder até serem usados; os dados ficam | 1 |
| 10 | Exemplos ruins da voz | Voz | Não vão para a IA | Integrar: passam a ir para a IA | 5 (legenda na fase 1) |
| 11 | Categorias e origens da LIA | LIA | Só documentação | Legenda dizendo isso | 1 |
| 12 | Preço exigido para ativar a oferta | Ofertas | Nada o usa | Tornar opcional | 1 |
| 13 | Lista "Em breve" (integrações, agentes, titulares, uso e orçamento) | Configurações | Não há tela | Tirar a lista | 1 |
| 14 | "Aprendizados… ainda não existem" | Resultados | Só a frase | Tirar a frase | 1 |
| 15 | "Só local" e "Aprovação: Obrigatória" | Início | Texto fixo | Ir para Avançado, com dados reais | 4 |
| 16 | "Fila de decisões do dia" e "lista importada" | `lib/modules.ts` | Não existem | A primeira passa a existir (Hoje); a segunda sai | 4 e 1 |
| 17 | Selo "em breve" do menu | Menu | Código sem uso | Remover o código | 4 |
| 18 | "Investigar" na Descoberta | Descobrir | Funciona em parte | Integrar (C.2) | 2 |
| 19 | Modelo HTML de e-mail | E-mail | Usado só na prévia e no teste | Legenda: "Modelo do e-mail de teste; as mensagens copiadas saem em texto" | 1 |
| 20 | `suggestStage` | Código | Sem uso | Integrar ao "Colar resposta" (C.11) | 3 |
| 21 | Tarefa `embedding` / "Busca semântica não instalado" | Painel de IA | Sem uso | Esconder; aparece em Avançado como "não usada" | 1 |
| 22 | Erro `discovery_blocked` | Código | Nunca usado | Fica no código (inofensivo); sai junto com o item 1, se você preferir | 1 |
| 23 | Indicador "Pesquisa na internet" leva ao Copiloto | Rodapé do menu | Leva a uma tela que não resolve nada | Indicador único que leva a Avançado | 4 |
| 24 | Evidência de contato e identificadores de telefone e redes | Banco | Aceitos, mas nada os grava | Integrar com o módulo de contatos | 6 |
| 25 | `portfolioForService` | Código | Sem uso | Fica para o envio futuro (fase 8) | — |

---

## Parte D: reestruturação da comunicação

### D.1 Objetivo e o que não muda

**Objetivo.** A IA deve escrever como um profissional experiente de uma agência de branding, alguém que pesquisou a empresa e encontrou um motivo real para conversar. Para isso, a mensagem precisa ser:
- natural, com personalidade e sem estrutura repetida;
- específica sobre a empresa;
- sem elogio genérico e sem cara de relatório.

**O que continua obrigatório:**
- nada sobre a empresa sem fonte e nada inventado sobre a agência;
- a agência identificada no primeiro contato (na assinatura, pelo menos);
- o opt-out até a primeira resposta e o canal do titular no primeiro contato, conforme a decisão D2;
- aprovação humana com `payload_hash` (regra 2);
- nenhum envio automático.

A exceção da regra 7 (a pesquisa e o Copiloto não recusam dados de pessoas) vale para pesquisar, não para escrever: a mensagem ao contato continua seguindo a minimização da LGPD.

### D.2 Guia de voz: como reconstruir

1. **Coleta (decisão D4).** Você junta:
   - de 10 a 20 mensagens reais que escreveu, de preferência as que tiveram resposta;
   - de 5 a 10 mensagens que não gosta, incluindo rascunhos atuais do Prospector;
   - trechos do site e do portfólio que mostram como a agência fala.
2. **Leitura dos padrões**, numa sessão de trabalho com você:
   - como abre;
   - como fala do que viu;
   - tamanho;
   - como pede a conversa;
   - como assina;
   - palavras próprias da agência;
   - o que nunca diz.
3. **Nova versão do guia**, gravada pela tela de Voz, no formato que já existe (resumo, princípios, o que evitar, bons exemplos, maus exemplos). O histórico fica. Não muda o banco.
4. **Exemplos completos:**
   - sem colchetes;
   - com nomes claramente fictícios. A conferência de "nome inventado" já impede que a IA copie um nome que não está nos dados;
   - cada bom exemplo acompanhado de um princípio que diga por que ele funciona.
5. **Os maus exemplos passam a ir para a IA** como "não escreva assim" (`contextData()`, fase 5).

**Formato sugerido para o guia novo** (conteúdo fictício, só para mostrar a forma):

> **Resumo:** Escrevemos como quem já olhou o trabalho da empresa com atenção. Falamos de uma coisa concreta que vimos, do que ela pode significar para o negócio, e convidamos para uma conversa sem pressão.
>
> **Princípios:**
> - Comece pelo que é deles, não por nós.
> - Uma observação bem escolhida vale mais que três.
> - Fale de efeito no cliente deles, não de detalhe técnico.
> - Peça uma coisa só, de um jeito fácil de aceitar ou recusar.
> - Assine com o seu nome.
>
> **Evitar:** "Espero que esteja bem", "gostaria de apresentar", "soluções", "agregar valor", medidas em pixels, códigos de cor, dados financeiros da empresa.

### D.3 Os quatro tons, agora diferentes de verdade

Os identificadores (`consultative`, `direct`, `warm`, `formal`) e os nomes na tela ficam iguais: o banco não muda. O que muda é que cada tom ganha uma definição no prompt novo e uma explicação de uma linha na tela.

| Tom | Para quem e quando | Como soa | Abertura | Pedido | Despedida | Tamanho do e-mail |
|---|---|---|---|---|---|---|
| Consultivo (padrão) | Quem decide sobre marca numa empresa média | Observa, explica por que importa, pergunta | "Oi, Marina, tudo bem?" | "Faz sentido conversarmos uns 20 minutos?" | "Abraço," | 80 a 120 palavras |
| Direto | Fundadores com pouco tempo; LinkedIn; follow-up | Vai ao ponto na primeira frase; 3 ou 4 frases | "Marina," | "Topa uma conversa rápida?" | "Abraço," | 40 a 70 palavras |
| Próximo | Negócios pequenos e criativos; quem já trocou mensagens | Coloquial, em primeira pessoa; comenta um trabalho deles de forma específica | "Oi, Marina!" | "Bora conversar sobre isso?" | "Um abraço," | 60 a 100 palavras |
| Formal | Empresas grandes, setores regulados, diretoria | Frases completas, sem gíria nem exclamação | "Prezada Marina," | "Teria disponibilidade para uma conversa?" | "Atenciosamente," | 90 a 130 palavras |

### D.4 Prompts novos: `relationship-approach/v4` e `relationship-message/v4`

Os arquivos são novos. A v3 fica intacta e continua em uso até a v4 passar na avaliação (D.6). O Copiloto não muda.

**Estrutura da v4**
1. **Quem você é:** um profissional de agência de branding que pesquisou a empresa. Escreve em português do Brasil, com naturalidade, para uma pessoa.
2. **O que faz uma boa mensagem** (orientação positiva, com dois exemplos do guia de voz):
   - parte de uma observação concreta sobre a empresa;
   - traduz essa observação em efeito para o negócio;
   - faz um pedido leve;
   - usa a voz da agência.
3. **Como usar as evidências:**
   - só o que tem fonte;
   - uma ou duas observações, não todas;
   - em linguagem de cliente ("o logotipo some no celular"), nunca a medida ("170 × 40 px");
   - inferência dita como impressão de quem olhou ("me chamou a atenção que…"), nunca como fato.
4. **Os tons:** a tabela de D.3, em texto.
5. **Limites inegociáveis.** Hoje são 17 regras; passam a ser sete:
   1. não inventar fato sobre a empresa nem sobre a agência;
   2. não revelar a leitura interna nem notas técnicas;
   3. sem marcadores entre colchetes;
   4. sem links nem anexos no corpo;
   5. sem urgência falsa, sem familiaridade fingida, sem elogio genérico;
   6. sem dia ou horário de reunião;
   7. sem assinatura: o sistema assina.
6. **Formato de saída.**

**O que muda em relação à v3**

| Regra na v3 | Na v4 | Onde fica a garantia |
|---|---|---|
| Primeira frase depois da saudação diz quem escreve, com o nome da agência | Abertura livre. A agência aparece na assinatura e, se ficar natural, no texto | `messageIssues` continua exigindo o nome da agência no primeiro contato; `formatReview` deixa de cobrar a abertura na v4 |
| Inferência sempre como pergunta ou ressalva ("talvez", "pelo que vi") | Inferência como impressão de quem olhou, com no máximo uma pergunta | Avaliação (D.6) conta as ressalvas |
| 17 regras inegociáveis, quase todas proibições | 7 limites e orientação positiva | As conferências determinísticas continuam no código |
| Despedida fixa ("Abraço" ou "Atenciosamente") e assinatura com o nome da agência | Despedida conforme o tom; assinatura com nome, cargo e agência (D5) | `closeDraft` |
| Saudação sem nome ("Olá.") | Primeiro nome quando há contato; sem contato, "Olá, pessoal da (empresa)" | Dados do destinatário em `contextData()` |
| Medidas técnicas e dados do cadastro aparecem nos dados | Saem dos dados da mensagem | `contextData()` e a conferência nova de jargão |
| Exemplos ruins não chegam à IA | Chegam como "não escreva assim" | `contextData()` |
| Temperatura 0,4 | Testar 0,5 e 0,7 na avaliação | Temperatura em cada chamada, no gateway |
| Mensagem escrita dentro de um campo JSON | Testar duas formas: tudo em JSON, ou a estratégia em JSON e a mensagem em texto puro, numa segunda chamada | A avaliação decide, pesando naturalidade e tempo de resposta |
| A correção automática reescreve por qualquer problema | Só reescreve por problema de fato; problema de forma vira aviso | `reviewDraft` |

### D.5 Rodapé de opt-out e privacidade

O rodapé continua obrigatório: `messageIssues` continua exigindo o texto de opt-out e o canal do titular. O que muda:
- o rodapé fica **depois da assinatura**, separado por uma linha;
- o texto fica mais curto e diz de onde veio o contato, o que atende à transparência da LGPD e ao KI-126.

Esta é só uma candidata para o parecer jurídico (decisão D2), não uma decisão:

> Se não fizer sentido para você, é só responder "remover" que eu não escrevo mais. Seu contato profissional veio do site da empresa; mais sobre privacidade em (canal).

No LinkedIn, a nota de conexão tem 300 caracteres, e o rodapé atual ocupa cerca de metade. É preciso uma versão curta específica, aprovada no mesmo parecer, como "Se preferir que eu não escreva mais, é só avisar." O canal do titular iria no perfil ou na primeira resposta, se o parecer aceitar.

O texto continua sendo seu, em Configurações › Contato e privacidade. A conferência compara a mensagem com o texto que estiver cadastrado.

### D.6 Como avaliar a naturalidade

**1. As checagens de hoje continuam,** como regressão de tolerância zero: nada inventado, fonte, proporção, intensidade.

**2. Métricas determinísticas novas** em `packages/agents/evals/relationship`:

| Métrica | Meta |
|---|---|
| Jargão técnico no texto: px, código de cor, "contraste", "CNAE", "capital social", "rolagem" | 0 |
| Frases feitas: "espero que esteja bem", "venho por meio desta", "gostaria de apresentar", "soluções", "agregar valor", "alavancar", "no mercado atual", "fortalecer sua presença" | 0 |
| Mensagens do conjunto que abrem com a mesma estrutura (por exemplo, "Sou da…") | menos de 20% |
| Ressalvas por mensagem ("talvez", "pelo que vi", "parece") | no máximo 1 |
| Saudação com o nome quando há contato | 100% |
| Pelo menos uma observação específica da empresa, com fonte | 100% |
| Diferença entre tons: o mesmo caso em dois tons difere em pelo menos 3 de 5 marcas (tamanho, saudação, despedida, gíria, formalidade) | 100% |

**3. Revisão às cegas, feita por você.**
- Um script gera uma página local (HTML) com pares A e B. Cada par traz a mesma situação escrita pela v3 e pela v4, em ordem sorteada: 15 casos fictícios, em 2 tons.
- Você escolhe a melhor de cada par.
- O resultado vai para os resultados da avaliação.

**4. Critério para promover a v4:**
- você prefere a v4 em pelo menos 70% dos pares;
- falhas de tolerância zero menores ou iguais às da v3;
- 95% das respostas em até 20 s;
- revisão do subagente `avaliador-ia`.

**5. Fica de fora:** um juiz automático feito pelo próprio modelo de 4B, que não é confiável para julgar estilo.

As avaliações ocupam a GPU e só rodam com o seu OK.

### D.7 Exemplos: antes e depois

Todos os dados são fictícios.
- **Empresa:** Doceria Lua Cheia, de Campinas/SP.
- **Contato:** Marina Souza, sócia, conforme a página "Quem somos" do site.
- **Agência e assinatura:** Estúdio Exemplo; quem assina é Rafael Lima, diretor de criação.
- **Evidências:**
  - fato: a empresa lançou uma linha de bolos de casamento (página "Casamentos", publicada há 3 semanas);
  - fato: o logotipo do site é o mesmo da fachada de 2015 (página "Nossa história" e captura de tela);
  - fato: as embalagens novas da loja online usam outra tipografia (página "Loja");
  - inferência: a marca convive com duas identidades.

**Exemplo 1: e-mail inicial, tom Consultivo**

*Antes (padrão atual):*
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
Privacidade e dados pessoais: (canal cadastrado)
```

*Depois (objetivo):*
```
Assunto: A linha de casamentos da Lua Cheia

Oi, Marina, tudo bem?

Vi que a Lua Cheia começou a fazer bolos de casamento. É um passo grande:
quem escolhe o bolo do casamento compara muito antes de decidir, e a marca
pesa bem mais do que numa compra de balcão.

Uma coisa me chamou a atenção. As embalagens novas da loja já têm uma
tipografia mais delicada, mas o logotipo do site ainda é o da fachada de
2015. Quem chega pela página de casamentos acaba encontrando duas Lua Cheia
diferentes.

Trabalho com identidade visual e gostaria de entender como vocês estão
pensando essa fase. Faz sentido conversarmos uns 20 minutos?

Abraço,
Rafael Lima
Diretor de criação · Estúdio Exemplo

—
Se não fizer sentido para você, é só responder "remover" que eu não escrevo
mais. Seu contato profissional veio do site da empresa; mais sobre
privacidade em (canal).
```

O que mudou:
- saudação com nome;
- a abertura parte da empresa, não da agência;
- uma observação concreta, traduzida em efeito para o cliente;
- a inferência aparece como impressão, sem ressalva empilhada;
- assinatura de pessoa;
- rodapé mais curto, que diz de onde veio o contato (candidato a parecer).

**Exemplo 2: mesmo caso, tom Direto**

*Depois:*
```
Assunto: Duas Lua Cheia no site

Marina,

as embalagens novas da loja já têm outra tipografia, mas o logotipo do site
ainda é o de 2015. Agora que vocês entraram em casamentos, isso fica mais
visível. Trabalho com identidade visual no Estúdio Exemplo. Topa uma
conversa rápida sobre isso?

Abraço,
Rafael Lima · Estúdio Exemplo

—
(rodapé)
```

**Exemplo 3: sem contato identificado (objetivo "Pedir indicação de quem cuida da marca")**

*Antes:* igual ao exemplo 1, sempre com "Olá." e endereçado a ninguém.

*Depois:*
```
Assunto: Quem cuida da marca da Lua Cheia?

Olá, pessoal da Lua Cheia,

acompanhei o lançamento da linha de casamentos e queria falar com quem
cuida da marca e da comunicação de vocês. Notei que o site e as embalagens
novas estão contando histórias visuais diferentes e tenho algumas ideias
sobre isso.

Podem me dizer com quem devo conversar?

Obrigado,
Rafael Lima
Diretor de criação · Estúdio Exemplo

—
(rodapé)
```

**Exemplo 4: follow-up (cerca de uma semana depois, sem resposta)**

*Antes:*
```
Olá.

Retomo a mensagem que enviei na semana passada sobre a identidade visual da
Doceria Lua Cheia. Se fizer sentido, posso mostrar em 15 minutos o que
observei no site.

Abraço,
Estúdio Exemplo

(rodapé)
```

*Depois:*
```
Oi, Marina,

sei que a semana deve estar corrida com os casamentos. Deixo só uma ideia
concreta: dá para alinhar o logotipo às embalagens novas sem perder o que as
clientes antigas já reconhecem. Se quiser, mostro como em uma conversa curta.

Abraço,
Rafael

—
(rodapé, ainda obrigatório até a primeira resposta)
```

**Exemplo 5: resposta a "agora não é prioridade"**

*Antes (pelo prompt de hoje, o risco é voltar a argumentar):*
```
Olá. Entendo. Ainda assim, a inconsistência entre o site e as embalagens
pode afetar a percepção da marca. Faz sentido conversarmos 15 minutos?
```

*Depois:*
```
Oi, Marina,

entendi, obrigado por responder. Fica o contato para quando fizer sentido.
Boa sorte com a linha de casamentos!

Abraço,
Rafael
```

Com a resposta, o opt-out deixa de ser exigido. A IA sugere marcar a oportunidade como "Acompanhar" e criar um follow-up para daqui a 90 dias.

---

## Parte E: plano de implementação

### E.1 Princípios do plano
- Mudanças de interface e de texto não vão na mesma entrega que mudanças de banco.
- Cada fase termina com o app funcionando, os testes verdes e os subagentes revisores relevantes rodados.
- Prompt novo só vira padrão com a avaliação melhor que a anterior. Avaliações ocupam a GPU e só rodam com o seu OK.
- Migração só com a sua confirmação, seguindo a skill `migracao-supabase`, e nunca com `test:db` real contra o `prospector-dev`.
- As mudanças sem commit do desktop e do e-mail (KI-187 e KI-188) ficam como estão. A fase 1 só começa depois que elas forem resolvidas (commit ou decisão sua), para não misturar trabalhos.

### E.2 Fases

```
F0 Decisões ──► F1 Interface honesta ──► F2 Da descoberta à decisão ──► F3 Enviar e acompanhar ──► F4 Navegação
      │                                                                          │
      ├──(D2, D4, D5)──► F5 Comunicação (pode correr junto com F2 a F4) ─────────┤
      │                                                                          ▼
      └──(D3)───────────────────────────────────────────────────────► F6 Contatos (banco)
                                                                     F7 Correções com banco (depois da F1, em qualquer ordem)
                                                                     F8 Envio pela caixa (fora desta proposta)
```

---

**F0: decisões e insumos (sem código)**
- **Escopo:** decisões D1 a D6; parecer sobre o rodapé; coleta dos exemplos reais para o guia de voz.
- **Prioridade:** alta. **Complexidade:** baixa.
- **Risco:** a parte de comunicação atrasa se os exemplos não vierem.
- **Pronto quando:** as decisões estiverem registradas (emenda de ADR ou KI) e os exemplos estiverem numa pasta combinada.

---

**F1: interface honesta e linguagem**
- **Banco:** não. **Prompts:** não.
- **Escopo:**
  - os itens de C.23 marcados para a fase 1;
  - o glossário de C.22, nas telas que já existem;
  - mensagens de erro sem variáveis de ambiente (C.21);
  - rótulos da auditoria (C.20);
  - `IN_USE`, a linha vazia dos fatos do sistema e a pontuação dupla;
  - preço da oferta opcional e "Pausar" renomeado.
- **Arquivos:**
  - telas em `apps/web/src/app/(shell)/**`;
  - componentes em `apps/web/src/components/**`;
  - em `apps/web/src/lib/`: `*-labels.ts`, `audit-format.ts`, `system-status.ts`, `database-status.ts`, `modules.ts`;
  - rótulos e mensagens em `packages/contracts/src/*.ts`;
  - `packages/application/src/errors.ts` e `packages/agents/src/copilot/system-facts.ts`;
  - `packages/domain/src/strategy/rules.ts` (preço) e `packages/domain/src/relationship/mailbox.ts` (IMAP como aviso).
- **Dependências:** F0, só para os textos que dependem de decisão.
- **Riscos:** testes de ponta a ponta que conferem textos quebram e precisam ser atualizados. Risco baixo.
- **Pronto quando:**
  - nenhuma tela promete o que não faz (checklist de C.23);
  - nenhuma variável de ambiente, código interno ou sigla de roadmap aparece fora de Avançado ou de Detalhes técnicos;
  - os testes passam;
  - o `revisor-ux` aprovou.
- **Testes:** testes de unidade dos rótulos e da regra de prontidão (preço); testes de ponta a ponta atualizados; `pnpm typecheck`, `pnpm lint`, `pnpm test` e `pnpm test:e2e` (em memória, `E2E_PORT=3120 E2E_MEMORY_PORT=3130`).

---

**F2: da descoberta à decisão**
- **Banco:** não.
- **Escopo:**
  - "Analisar empresa" começa a análise de verdade (C.2);
  - andamento em frases;
  - página da empresa reorganizada (C.4), com a tabela de recomendação e próximo passo;
  - indicador único de segurança;
  - classificação da Receita (C.6);
  - buscas automáticas mostrando as novas primeiro (C.3);
  - retomada automática das análises interrompidas (C.5);
  - registro das chamadas de IA da Descoberta em `llm_calls`.
- **Arquivos:**
  - `apps/web/src/app/(shell)/descoberta/actions.ts`, `components/discovery/*`, `descoberta/pesquisas/[id]/page.tsx`;
  - `empresas/[id]/page.tsx` e, em `components/companies/`, `investigation-panels.tsx` (dividido), `evidence-groups.tsx` e `claim-card.tsx`;
  - em `packages/application/src/services/`: `investigation-service.ts`, `evidence-service.ts`, `discovery-engine.ts`;
  - `apps/web/src/server/container.ts`.
- **Dependências:** F1, por causa do glossário.
- **Riscos:**
  - uma análise disparada por engano gasta GPU e até 5 buscas. Mitigação: o botão diz o custo;
  - fila cheia;
  - a retomada ao abrir o app ocupa a GPU. Mitigação: uma análise por vez, com a opção de desligar.
- **Pronto quando:**
  - um clique leva da empresa encontrada à análise em andamento;
  - a página da empresa mostra a decisão sem rolar a tela;
  - há um indicador de segurança só;
  - os detalhes técnicos estão em seções recolhidas;
  - nenhuma regra de evidência mudou.
- **Testes:**
  - de aplicação (em memória): `investigate` seguido de `start`;
  - de domínio: classificação de fontes;
  - de ponta a ponta: Descoberta até a empresa, sem Ollama;
  - estrutura da página da empresa;
  - revisões do `revisor-arquitetura` e do `revisor-ux`.

---

**F3: enviar e acompanhar sem atrito**
- **Banco:** não.
- **Escopo:**
  - cartão único de mensagem: aprovar e copiar, abrir o e-mail ou o LinkedIn, marquei como enviada (C.10);
  - "Aprovar de novo";
  - abas "Para enviar" e "Em andamento", ainda nos endereços atuais;
  - colar a resposta e já ter a interpretação e o rascunho (C.11, decisão D6);
  - sugestão de etapa;
  - kanban com arrastar e uma etapa só na lista (C.13);
  - regra única de "vencido" (C.12);
  - bugs sem banco: suprimir por nota, mensagem de "reabrir", aviso com a oferta errada, assunto pedido fora do e-mail, `recordAi` sem proteção, etapa ao preparar, prioridade e oferta divergente.
- **Arquivos:**
  - em `components/relationship/`: `message-thread.tsx`, `forms.tsx`, `timeline.tsx`, `parts.tsx`;
  - telas em `app/(shell)/relacionamento/**` e `app/(shell)/aprovacoes/page.tsx`;
  - `packages/application/src/services/relationship-service.ts`;
  - `packages/domain/src/relationship/rules.ts`;
  - `apps/web/src/lib/relationship-dates.ts`.
- **Dependências:**
  - F1;
  - D1, para o "Abrir no e-mail" sem aviso;
  - D6.
- **Riscos:**
  - **Regras de aprovação:** uma mudança no cartão pode afrouxar a aprovação. O hash e as conferências não mudam, e o `revisor-seguranca` revisa.
  - **Envio:** "Marquei como enviada" pode ser registrado duas vezes; o índice único de aprovação já impede.
  - **Texto do e-mail:** o `mailto:` pode cortar um corpo longo, problema que não aparece nos tamanhos atuais.
- **Pronto quando:**
  - responder a uma pessoa leva no máximo 4 ações, na mesma tela;
  - nenhuma aprovação passa sem hash;
  - a aprovação vencida com o texto igual volta com um clique;
  - os testes passam.
- **Testes:**
  - **Aplicação:** reaprovar gera o mesmo hash; `recordOutbound` com os valores padrão; a nota não suprime.
  - **Domínio:** as datas de vencimento.
  - **Ponta a ponta:** o fluxo completo do Relacionamento.
  - **Revisores:** `revisor-seguranca` e `revisor-conformidade`.

---

**F4: navegação enxuta**
- **Banco:** não.
- **Escopo:**
  - menu novo (B.1);
  - tela Hoje (C.1);
  - junção de páginas, com redirecionamentos (B.4);
  - Configurações reorganizadas, com a área Avançado (B.3);
  - indicador único do sistema;
  - atalhos e paleta.
- **Arquivos:**
  - em `apps/web/src/lib/`: `modules.ts`, `navigation.ts`, `commands.ts`, `entity-links.ts`, `relationship-routes.ts`;
  - `components/shell/*`;
  - `next.config.ts` (redirecionamentos);
  - `app/(shell)/page.tsx`;
  - o serviço novo `agendaService`, em `packages/application`;
  - testes de ponta a ponta `shell` e `smoke`.
- **Dependências:** F2 e F3, porque Hoje mostra os estados novos.
- **Riscos:** links quebrados em `revalidatePath`, nos links do Copiloto, na paleta e nos testes de ponta a ponta.
- **Pronto quando:**
  - o menu tem 4 itens de jornada e 3 de apoio;
  - todas as rotas antigas redirecionam;
  - cada tela responde às três perguntas (onde estou, o que posso fazer, qual o próximo passo);
  - o `revisor-ux` aprovou.
- **Testes:** testes de ponta a ponta de navegação, atalhos e redirecionamentos; teste de unidade dos comandos.

---

**F5: comunicação**
- **Banco:** não.
- **Escopo:** o que está em D.2 a D.6:
  - `contextData()`: exemplos ruins, filtro de medidas e dados financeiros, destinatário;
  - temperatura em cada chamada, no gateway;
  - prompts novos `relationship-approach/v4` e `relationship-message/v4`;
  - `formatReview` sem a abertura obrigatória na v4;
  - conferências novas de jargão e frases feitas;
  - `closeDraft` com a despedida conforme o tom e a assinatura com a identidade (D5);
  - métricas novas e a página de revisão às cegas.
- **Arquivos:**
  - `packages/agents/src/relationship/relationship-ai.ts`;
  - `packages/agents/src/gateway.ts` e `model-policy.ts`;
  - `packages/agents/prompts/relationship-*/v4.md` (arquivos novos);
  - `packages/agents/evals/relationship/*`;
  - `relationship-service.ts`, que passa a ler a identidade do e-mail por porta, com a ligação no `container.ts`.
- **Dependências:**
  - D2, D4 e D5;
  - corre junto com F2 a F4, porque mexe em outros pacotes. Exceção: a assinatura mexe em `relationship-service.ts` e precisa de coordenação com F3.
- **Riscos:**
  - **Invenção:** pode crescer com a temperatura mais alta. Mitigação: as checagens de tolerância zero continuam e decidem.
  - **Tempo de resposta:** a geração em duas chamadas demora mais. A avaliação decide se compensa.
  - **GPU:** as avaliações ocupam a placa. Só rodam com o seu OK.
- **Pronto quando:**
  - os critérios de D.6 forem cumpridos;
  - o `avaliador-ia` aprovou;
  - a v3 continua disponível;
  - o Copiloto continua na v3.
- **Testes:** testes de unidade das conferências novas e de `closeDraft`; avaliações (com o seu OK); revisão às cegas feita por você.

---

**F6: contatos (banco)**
- **Banco:** sim.
- **Escopo:**
  - migração de `contacts` e das quatro colunas `contact_id` (C.7);
  - evidências de contato;
  - seção "Com quem falar" e seletor "Para quem";
  - `accessKnown`;
  - hash na versão 2, com o destinatário;
  - supressão por pessoa;
  - prazo de guarda e apagamento automático dos contatos;
  - exportar e apagar uma pessoa;
  - `mailto:` com o destinatário;
  - saudação com o nome.
- **Arquivos:**
  - `supabase/migrations/2026…_contacts.sql` (novo);
  - `packages/contracts/src/contacts.ts` (novo);
  - `packages/domain` (validação; nenhum e-mail deduzido);
  - `packages/db` (repositório);
  - `packages/application` (`contact-service.ts` novo, `evidence-service`, `relationship-service`, `qualify.ts`);
  - telas da empresa e do Relacionamento;
  - `packages/domain/src/relationship/rules.ts` (`messagePayload` v2).
- **Dependências:**
  - D3;
  - F3, por causa do cartão;
  - F5, porque o prompt usa o nome.
- **Riscos:**
  - **LGPD:** origem e base legal são obrigatórias em cada contato.
  - **Qualidade dos dados.**
  - **Hashes antigos e novos convivendo:** as versões de hash ficam explícitas.
  - **Migração em banco real:** só com a sua confirmação.
- **Pronto quando:**
  - nenhum contato existe sem origem e base legal;
  - nenhum e-mail foi deduzido;
  - a aprovação cobre o destinatário;
  - "Abordar agora" passa a aparecer quando há contato conferido;
  - `pnpm test:db` (PGlite) confirma RLS sem políticas;
  - o `revisor-conformidade` e o `revisor-seguranca` aprovaram.
- **Testes:**
  - catálogo e RLS no `test:db`;
  - domínio: formatos e a proibição de deduzir e-mail;
  - aplicação: hash v2, supressão por pessoa, apagamento;
  - ponta a ponta: adicionar contato, preparar, aprovar, copiar, registrar.

---

**F7: correções que exigem banco**

Cada item é uma migração separada, com confirmação.
1. **Encerrar a oportunidade cancela os follow-ups** (C.12), dentro de `change_opportunity_stage`.
2. **"Preparar abordagem" numa transação só** (KI-127): uma função no banco que cria a oportunidade, o plano e a mensagem juntos.
3. **Análise na fila `ai_jobs`** (KI-134): tipo novo de tarefa e trabalhador comum. É a mudança estrutural maior, com justificativa: evita perder análises em reinícios e duas análises ao mesmo tempo.
4. **Apagamento automático** das interações, mensagens e evidências vencidas (KI-015, KI-078, KI-122). Antes disso, você precisa confirmar a política de guarda, porque apagar não tem volta.

- **Dependências:** F1. A ordem entre os itens é livre.
- **Riscos:** migração em banco real; apagamento irreversível.
- **Pronto quando:** cada item tiver o seu teste no `test:db` e a revisão do `revisor-seguranca`.

---

**F8: envio pela caixa (fora desta proposta)**

As fatias E2, E4 e E5 do ADR-0016 (destinatário, envio em lote e leitura de respostas) só voltam à mesa depois da decisão D1 e do parecer jurídico. Esta proposta não prevê nenhum disparo automático.

### E.3 O que a arquitetura preserva e o que muda, com justificativa

**Não muda**
- Fronteiras entre pacotes (ADR-0001): a interface só chega aos dados pelos serviços de `packages/application`.
- Contratos Zod como fonte única dos tipos.
- Gateway único de IA.
- Livro de evidências.
- Aprovação com hash.
- Auditoria na mesma transação.
- Versões imutáveis.
- RLS sem políticas.
- Endereços das telas, sempre que possível.

**Muda, com justificativa**

| Mudança estrutural | Por que é necessária |
|---|---|
| Tabela `contacts` e as quatro colunas `contact_id` | Sem pessoas, não há destinatário, saudação com nome, recomendação "Abordar agora" nem direito de titular por pessoa. Só evidências não bastam para listar, ligar e apagar |
| `messagePayload` versão 2 | A aprovação precisa cobrir para quem a mensagem vai (KI-172). É feito no app, sem migração |
| Temperatura em cada chamada, no gateway | Permite ajustar a escrita sem criar uma tarefa nova, o que exigiria migração em `llm_calls` |
| Análise na fila `ai_jobs` (F7) | Durabilidade e uma análise só por vez, mesmo com dois processos |
| Funções do banco para encerrar oportunidade e preparar abordagem (F7) | Integridade: hoje são passos soltos, que podem deixar dados pela metade |
| Serviço `agendaService` (F4) | A tela Hoje junta dados de vários módulos, e só um serviço de aplicação pode fazer isso sem furar as fronteiras |

**Dados que não são apagados:** nenhuma coluna nem tabela sai. As configurações escondidas (peso da rubrica, evidências exigidas, limite diário da caixa) continuam no banco.

### E.4 Sugestão de primeira entrega

Para ver resultado rápido sem mexer no banco: **F1 completa, mais o núcleo da F2** ("Analisar empresa" iniciando a análise e o topo "Vale abordar?" na página da empresa). Em paralelo, a coleta dos exemplos reais (D4), para a F5 começar logo em seguida.

---

*Proposta escrita em 26/11/2026, só com leitura do código e dos documentos. Não foi implementada e aguarda a sua aprovação. Nenhuma avaliação de IA foi rodada; as notas citadas vêm do `docs/14-execucao-e-conclusao.md`.*
