# ADR-0013 — Descoberta inteligente: pedido em linguagem natural, sinais com trecho conferido e triagem por regras

- Status: **Aceito** (implementado na M3; migração aplicada no `prospector-dev` em 2026-11-11, com a confirmação do usuário; prompts `discovery-interpreter/v1` e `discovery-extractor/v2` esperando a promoção pelo usuário). Emenda o [ADR-0002](0002-evidence-ledger.md) e o [doc 06](../06-modelo-de-dados.md) §4.3 (ver §6)
- Data: 2026-11-11
- Fatia: M3 / F4 (Módulo 01 — Descoberta Inteligente)
- Depende de: [ADR-0002](0002-evidence-ledger.md) (evidências), [ADR-0008](0008-ia-local-com-ollama.md) (IA local), [ADR-0011](0011-fila-duravel-no-postgres.md) (fila), [ADR-0012](0012-busca-web-tavily-playwright.md) (busca e leitura de páginas)

## Contexto

O usuário quer escrever o que procura ("clínicas em Ribeirão Preto com sinais de expansão") e receber empresas reais, com a fonte de cada conclusão, sem lista inventada e sem gastar créditos à toa. A pesquisa na internet (Tavily + leitor de páginas) já existe (ADR-0012) e o Copiloto já pesquisa na conversa, mas o resultado da conversa não fica guardado, não é deduplicado e não vira candidata a cliente. O modelo local é pequeno (`qwen3.5:4b`): erra, inventa nome e pode obedecer a texto escrito numa página.

## Decisão

### 1. Fluxo

Pedido → **interpretar** (IA local, saída estruturada `InterpreterOutput`) → **completar com padrões do servidor** (região, quantidade, profundidade, sinais; o que foi preenchido aparece na tela) → **plano de buscas** (`buildPlan`: o do modelo, conferido e completado pelo servidor, dentro do limite da profundidade; quando as buscas de empresas não bastam para a quantidade pedida, o servidor completa com as outras cidades da região e os outros termos do setor) → **buscar** (`WebResearchService`, cache de 24 h sem crédito) → **filtrar** resultados com cara de instrução (`looksLikeInstruction`, no domínio) → **extrair** empresas e sinais (IA local, `ExtractorOutput`) → **conferir** (nome presente no texto do resultado, trecho de cada sinal copiado literalmente da fonte, site oficial lido e com o nome) → **deduplicar** → **triagem** → guardar. Cada etapa grava o progresso; a pesquisa roda na fila (ADR-0011) e é retomada sem repetir buscas.

### 2. Limites e créditos

Profundidade rápida (3 buscas, 3 páginas, 15 empresas), padrão (6, 6, 25) e aprofundada (10, 10, 40). Uma busca nova = 1 crédito da Tavily; a mesma busca em 24 h vem do cache. O orçamento mensal (`WEB_SEARCH_MONTHLY_CREDITS`, ADR-0012) vale para tudo; acabou no meio, a pesquisa termina como **parcial** com o que achou. A tela mostra os créditos gastos em cada busca.

### 3. O modelo só propõe; o servidor decide

- Empresa sem o nome no texto do resultado é descartada; sinal sem o trecho literal na fonte é descartado (mesma conferência do Evidence Ledger).
- **Site oficial só pelo endereço:** um resultado só vale como site da empresa quando o domínio confere com o nome (`nameMatchesHost`). A palavra do modelo, ou de uma página que se diz "site oficial", não basta: sem isso não há domínio para deduplicar, leitura da página inicial, CNPJ achado nem ligação com Empresas.
- **CPF fora do nome:** sites de dados de CNPJ mostram o nome do MEI com o CPF; o servidor tira o CPF do nome antes de guardar (`withoutCpf`, regra 7). A empresa continua entrando: é minimização, não recusa.
- Datas, recência, confiança do sinal (0 a 1) e prioridade são calculadas no servidor, nunca copiadas do modelo.
- Duas camadas contra injeção: o filtro do servidor tira o resultado antes do extrator, e o prompt `discovery-extractor/v2` manda tratar resultado com ordens como fonte inválida. A avaliação (`packages/agents/evals/discovery`) mede o caso com tolerância zero para sinal criado pela injeção.

### 4. Deduplicação

Na ordem: raiz do CNPJ achado no site oficial (dígitos conferidos), domínio do site (`hosts.ts`, sem diretórios e redes sociais), nome com cidade/UF compatíveis (comparado sem a cidade ou a UF da empresa no fim e admitindo palavras de segmento a mais no começo de um lado ou, de uma lista curta como "pet shop" e "serviços", no fim, `sameCompanyNameAt`; nomes só parecidos continuam separados). **Emenda de 2026-11-24 (KI-147):** as palavras do ramo pet contam como segmento só na deduplicação e na conferência do site, não para saber se um nome aparece numa fonte; a chave de busca gravada antes (`name_key`) continua sendo procurada (`companyNameCore` com `legacy`), e as chaves antigas não foram recalculadas. Resultado sem cidade herda a cidade do pedido quando o texto a cita (`regionPlace`), para a notícia e o site da mesma empresa não virarem duas. A mesma empresa em outra pesquisa é atualizada, não duplicada; o mesmo acontecimento (impressão digital do sinal) não aparece de novo como novidade.

### 5. Triagem por regras

`assessProspect` (domínio, rubrica `discovery-triage/v1`) dá pontos de 0 a 100 em quatro dimensões (aderência ao perfil, sinais comerciais, atualidade, porte e capacidade), com pesos do modelo de pontuação ativo da Estratégia quando existe. Quando o ICP lista portes, o porte pontua pela aderência a eles (dado da Estratégia), não pela regra fixa "maior é melhor". Faixas: alta a partir de 70, média a partir de 50, baixa abaixo disso ou quando uma barreira do ICP falha, e **informações insuficientes** quando a aderência não pôde ser avaliada ou a cobertura não chega a 50%. **Emenda de 2026-11-24 (KI-148):** além das barreiras do ICP, órgão público e instituição de ensino viram barreira com motivo (`institutionKind`: domínio `.gov.br`, `.edu.br` e afins, ou nome e segmento como "municipal", "prefeitura", "universidade", "clínica-escola"), a menos que o próprio pedido procure esse tipo de instituição. A rubrica continua `discovery-triage/v1`; avaliações já gravadas não são recalculadas. Devolve também confiança, motivos com as fontes e o que falta saber. A tela diz que não é probabilidade de fechar negócio.

### 6. Decisões da pessoa e ida para Empresas

Salvar, ignorar (com motivo opcional) e voltar para a lista ficam auditados. **Investigar** cria a empresa em Empresas com origem Descoberta (ou liga a uma existente pelo CNPJ ou domínio) e grava as evidências pelo `EvidenceService`: menção numa página como hipótese, sinal com trecho conferido como fato, sem trecho conferido como hipótese, sempre com fonte e data.

- **Enunciado do servidor:** o fato do sinal é montado por modelo de frase com a citação literal ("Expansão, segundo jornal.com.br (02/09/2026): «…»"). O resumo do modelo vai só para a justificativa, identificado como "Resumo da IA local (não é citação)". O valor guarda a pesquisa (`discoveryRunId`), o sinal (`discoverySignalId`) e os prompts usados (`promptIds`).
- **Idempotente:** a empresa encontrada é ligada logo depois de criada (se gravar as evidências falhar, a nova tentativa reaproveita a empresa); o que já está no dossiê não é gravado de novo (mesmo sinal, mesma página na mesma coleta) e a mesma página coletada de novo vira nova versão (`supersedes`).
- **Site próprio:** o domínio só vai para a empresa nova quando o site foi conferido, e a origem "da própria empresa" das fontes é o domínio gravado em Empresas, nunca o palpite do modelo.
- **Emenda ao ADR-0002 e ao doc 06 §4.3:** a Descoberta guarda conclusões de triagem fora do ledger (sinais com verificação e confiança próprias em `discovery_signals`; prioridade, motivos e descrição em `discovery_prospects`, com motivos apontando para `discovery_sources`). Elas servem só para escolher quem investigar; nada delas é usado como conhecimento sobre a empresa (dossiê, qualificação, abordagem) antes de passar por **Investigar**, que grava claims tipados com fonte. O doc 06 previa `signals.claim_id` e `discovery_candidates`; ficou assim para não encher o ledger de empresas que a pessoa vai ignorar.

### 7. Monitoramentos

Um pedido salvo com frequência (diária, a cada 3 dias, semanal) e limites próprios (até 6 buscas, até 30 empresas). Rodam sozinhos com o app aberto, até `DISCOVERY_DAILY_AUTO_CREDITS` créditos por dia no total (padrão 12; 0 = só "Rodar agora"). Com o computador desligado, a execução perdida é recuperada **uma vez** ao abrir, e as perdidas ficam contadas. Só a tela cria, pausa, retoma ou arquiva.

- **Teto que segura a volta inteira:** a conta do teto usa os créditos comprometidos nas últimas 24 horas, gastos pelas pesquisas encerradas mais o teto (`maxSearches`) das que ainda estão na fila ou rodando, inclusive as criadas na mesma volta do agendador.
- **Um agendador por vez:** antes de criar a pesquisa, o agendador "pega" o monitoramento mudando `next_run_at` só se ele ainda estiver vencido (`claimMonitor`); um segundo processo no mesmo banco (pnpm dev e o app instalado) não cria a mesma execução de novo.
- **`PROSPECTOR_JOB_WORKER=off`** deixa as telas funcionando sem trabalhador da fila nem agendador neste processo: usado nos servidores de teste e para ter um só trabalhador por banco.

### 8. Copiloto

`create_discovery_search` cria só um **rascunho** (`status: draft`, ferramenta `kind: 'draft'`): nada busca nem gasta crédito até a pessoa clicar em "Confirmar e pesquisar". O rascunho fica auditado como ação do agente (`actor: agent/copilot`), a confirmação como ação da pessoa; no máximo 3 rascunhos esperam confirmação ao mesmo tempo (uma injeção lida pelo Copiloto não enche a tela de pedidos de terceiros), e a telemetria nunca guarda o texto do pedido, nem quando os argumentos vêm inválidos. As demais ferramentas (`get_discovery_search`, `list_discovery_prospects`, `list_discovery_signals`, `list_discovery_monitors`) só leem e marcam nomes e trechos da web como dado, não instrução. Elas só entram com um prompt da versão 4 em diante. O `copilot-tools/v4` ainda não existe: por combinado entre as sessões paralelas, ele junta Descoberta, Empresas e Relacionamento e é montado e avaliado uma vez só, depois da mesclagem; o trecho da Descoberta e a avaliação dele estão em [`docs/rascunhos/copilot-tools-v4-descoberta.md`](../rascunhos/copilot-tools-v4-descoberta.md) (KI-110).

#### 8a. Catálogos no banco

Tipos de sinal e serviços relacionados vêm dos contratos (`packages/contracts`); o banco só confere o formato (`^[a-z][a-z0-9_]{1,39}$`), para um catálogo novo não exigir migração. Alimentar o intérprete e o extrator com a oferta ativa (entregáveis e sinais de necessidade) em vez dos rótulos fixos de serviço fica no KI-111.

### 8b. Dados pessoais

A Descoberta usa a mesma pesquisa na internet do ADR-0012, sem máscara de dado pessoal nos trechos. O que ela faz por conta própria: tira CPF do nome das empresas encontradas, não tem campos de contato, guarda trechos curtos (até 300 caracteres) com prazo de 12 meses e apaga sinais vencidos (`purgeExpired`, uma vez por dia com o app aberto). **Pendente de decisão do usuário (KI-118):** se a emenda "sem recusas" do ADR-0012, escrita para a pesquisa e o Copiloto, vale também para esta coleta recorrente com guarda persistente; a base legal para empresas individuais (dado pessoal) e os itens dos termos da Tavily ainda não conferidos (guarda de resultados, uso contínuo).

## 9. Modos

`PROSPECTOR_DISCOVERY` = `on` (padrão), `off` (desliga o módulo e o trabalhador) ou `fixture` (buscador e IA SINTÉTICOS, só com `PROSPECTOR_STORAGE=memory`; tudo com selo DEMO; usado no e2e e na demonstração).

## O que fica de fora

- Busca por CNAE e município na base da Receita (lista oficial de empresas abertas): precisa de fonte autorizada de dados em massa (doc 05). A Descoberta acha empresas pela internet aberta.
- Importar lista, enriquecer com redes sociais (termos do LinkedIn e do Instagram, regra 6) e contato com a empresa (Abordagens, F10).
- Prazo de guarda completo: a limpeza diária esvazia trechos e resultados de busca vencidos e apaga sinais vencidos, mas título e URL das fontes, descrição e motivos da empresa encontrada e o pedido de cada pesquisa ficam (KI-105). Também não há como apagar os dados de uma empresa encontrada (KI-112).

## Consequências

- Cada empresa e cada sinal na tela têm a fonte e o trecho; nada aparece sem passar pela conferência do servidor.
- Uma pesquisa custa de 3 a 10 créditos na primeira vez e zero se repetida em 24 h; monitoramentos têm teto diário.
- A qualidade depende do modelo local: a avaliação sintética mede o que dá para medir, e a validação real com poucas buscas fica registrada no doc 14.
