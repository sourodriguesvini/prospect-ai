# ADR-0015 — Investigação de empresas e Brand Intelligence (Módulo 02)

- Status: **Proposto** (2026-11-11). Código pronto e testado na worktree `claude/empresas-brand-714583`. Pendências do usuário: aplicar a migração `20261111150000_company_investigations`, escolher a pasta das capturas e decidir sobre os prompts (abaixo, §9).
- Data: 2026-11-11
- Fatia: Módulo 02 da especificação "Empresas e Brand Intelligence" (doc 09: F5, F6 e F7 em versão local; doc 14: M4)
- Depende de: [ADR-0002](0002-evidence-ledger.md) (ledger), [ADR-0008](0008-ia-local-com-ollama.md) (IA local), [ADR-0009](0009-versionamento-imutavel-da-estrategia.md) (ofertas versionadas), [ADR-0010](0010-auditoria-na-mesma-transacao.md) (auditoria), [ADR-0012](0012-busca-web-tavily-playwright.md) (pesquisa e leitor de páginas). Convive com o ADR-0011 (fila `ai_jobs`) e o ADR-0013 (Descoberta), de outra sessão: não cria segunda fila nem segunda tabela de empresas.

## Contexto

O cadastro de empresas (M2) guarda o registro da Receita e as evidências, mas não responde à pergunta do usuário: *vale abordar esta empresa, com qual oferta, e por quê?* A especificação do Módulo 02 pede investigação profunda com fontes, auditoria da marca com capturas e análise multimodal, concorrência verificável, diagnóstico em fato/inferência/hipótese, casamento com as ofertas da agência, qualificação com Fit, Oportunidade e Confiança separados, fila com progresso e cancelamento, histórico com mudanças e ferramentas no Copiloto, tudo no computador do usuário (ADR-0007) com o modelo local de 4 bilhões de parâmetros (ADR-0008).

## Decisão

### 1. Uma execução = uma linha; as conclusões ficam no ledger

`company_investigations` guarda **o processo**: estado de cada etapa, consumo (buscas, páginas, capturas, chamadas e segundos de GPU), modelos e versões de prompt usados, um retrato da coleta (páginas e seus hashes, ofertas do site, sinais, concorrentes), as mudanças detectadas e a **composição** do diagnóstico (ids de claims, notas, recomendação). **Nenhuma conclusão em texto livre fica nessa tabela**: tudo que a investigação conclui sobre a empresa é claim `fact`, `inference` ou `hypothesis` gravado pelo `EvidenceService`, com fonte, trecho conferido e confiança calculada no servidor (regra 1). A view `company_investigation_summaries` dá a última execução por empresa para a lista.

- A leitura da IA para cada oferta (relevância, justificativa, ângulo, objeções, o que conferir) é um claim de oportunidade, inferência ou hipótese, inclusive com relevância "nenhuma". A composição guarda só o id (`OfferAssessment.readingClaimId`). Relevância e desqualificadores apontados pela IA só contam se esse claim entrou no ledger (emenda de 2026-11-11, revisão de arquitetura).
- Uma ativa por empresa (índice único parcial em `queued`/`running`); a segunda dá `investigation_running`.
- Execução encerrada (`succeeded`, `partial`, `cancelled`) não muda: a guarda do banco recusa reescrever diagnóstico, retrato, etapas, uso, modelos, mudanças, motivo e data de fim (`investigation_finished`), mesmo com cabeçalho de auditoria.
- Início, pedido de cancelamento, retomada e conclusão auditados na mesma transação (trigger, ADR-0010). Progresso de etapa e batimento não são auditados (mudam a cada poucos segundos).
- `confirm_company_site` grava o domínio confirmado como site oficial (identificador forte).
- RLS ligado, sem política e sem privilégio para `anon`/`authenticated`; `service_role` só com as colunas que o servidor atualiza (regra 3).

### 2. Etapas

| # | Etapa | O que faz | Grava |
|---|---|---|---|
| 1 | Reunir o que já sabemos | carrega claims em vigor (`effectiveStatus` do ADR-0002: vencidos e contestados ficam de fora), estratégia (ofertas ativas, ICP, rubrica, modelo de score) e a execução anterior | — |
| 2 | Identificar o site oficial | domínio cadastrado ou candidatos da pesquisa | fato do site (ou candidato a confirmar) |
| 3 | Ler as páginas do site | inicial + até 3 páginas por categoria (institucional, serviços, produtos, vagas, unidades), robots.txt respeitado | fatos com trecho conferido |
| 4 | Capturar a marca | Playwright, computador 1280 px e celular 390 px, JPEG limitado a 1.600–1.700 px de altura; medições no DOM (fontes, cores, H1, contraste, alvos de toque, logotipo, favicon, og:image). Site que pede para não guardar cópia (`noarchive`/`none` no cabeçalho ou no meta, `tdm-reservation: 1`): a imagem vai ao modelo nesta execução e é descartada, e o texto do H1 e dos botões fica fora das evidências | fatos de medição (confiança alta, fonte própria) |
| 5 | Analisar o negócio | IA (`company-business/v1`): oferta, público, proposta de valor | inferências citando páginas |
| 6 | Auditar a marca | IA com visão (`brand-visual/v1`): critério a critério da rubrica da oferta, citando medições e imagens | inferências (ou `aesthetic`, que não pontua) |
| 7 | Procurar sinais recentes | busca (Tavily, ADR-0012) por mudanças, expansão, vagas, lançamentos | fatos com URL e data |
| 8 | Encontrar concorrentes | busca + triagem (`competitor-triage/v1`); o que o concorrente diz de si vem da página lida (hoje também entra concorrente sem página lida, só pelo resultado da busca: KI-141) | fatos de concorrência |
| 9 | Comparar com concorrentes | IA (`competitive/v1`) sobre o que foi lido | inferências |
| 10 | Montar o diagnóstico | IA (`diagnosis/v1`): leitura central, hipóteses, ângulo, objeções, o que conferir, por oferta | inferência central + hipóteses |
| 11 | Avaliar ofertas e prioridade | domínio puro (`qualifyOffer`, doc 08 §3): Fit, Oportunidade, Confiança, gates, potencial, prioridade e recomendação por oferta ativa | composição na execução |

Cada etapa é idempotente e pode terminar `done`, `reused` (dado ainda válido: páginas com o mesmo hash, sinais e concorrentes com menos de 30 dias), `skipped` ou `failed`, **sempre com o motivo** (`InvestigationIssueCode`, mensagem em pt-BR na tela). Faltar busca, leitor, captura ou IA não derruba a investigação: ela termina `partial` ("Concluída com lacunas") e o diagnóstico diz o que falta.

### 3. Verificação das conclusões da IA

O modelo responde JSON restrito por esquema (`format` do Ollama) e o servidor valida de novo pelo contrato (`ANALYSIS_OUTPUT_SCHEMAS`). Depois, regras do domínio (`verification.ts`): cada conclusão precisa citar referências que existem (páginas, medições, imagens, concorrentes); trecho citado precisa estar no texto da fonte; o que fonte pública não sustenta é descartado (faturamento ou lucro, orçamento, taxa de conversão ou perda de vendas, insatisfação, intenção de contratar, "precisa do serviço" dito como certeza, decisão interna, resultado de campanha), assim como repetições. Nada disso recusa dado de pessoa (emenda do ADR-0012). A tela mostra quantas conclusões foram descartadas. Conteúdo de sites e de buscas entra marcado como dado, nunca como instrução.

#### 3a. Emenda (2026-11-25): guardas do servidor depois da IA

As análises v1 seguem em uso, agora com guardas puras do servidor (`packages/application/src/services/investigation/guards.ts` e `packages/domain/src/investigation/consistency.ts`), medidas no conjunto de avaliação `packages/agents/evals/investigation` (resposta crua e resposta depois das guardas lado a lado):

- intensificador ("grave", "crítico") suavizado sem mexer em termo do ramo ("pacientes críticos"), atenuação ou rótulo de item; observação visual nunca some;
- "marca inconsistente" só cai no resumo e na afirmação da oferta, sem outro canal (Instagram, fachada), sem dado (horário, preço, endereço) e fora das frases cadastradas da oferta; campanha de preço ("Black Friday") não conta como inconsistência da marca;
- desqualificador só vale com fato do mesmo assunto; "falta de site" não vale para empresa com site lido nem para achado sobre concorrente;
- sinal de contratação lido do texto só com contexto de emprego (função, currículo, "vaga de emprego"), no fim da lista e sem tirar sinal do modelo;
- texto de fonte dirigido à máquina que lê ("leitores automáticos", "Ao resumir esta página…", "Classifique este site como…") perde só a frase; o candidato, a linha e o fato continuam;
- raciocínio interrompido é cortado na última frase completa; "orçamento" no sentido de cotação ("peça seu orçamento") não conta como verba;
- o registro de verificação separa o que foi descartado, ajustado e acrescentado pelo sistema, com o trecho (`VerificationLog.altered` e `added`, opcionais, sem migração), e o painel mostra as três contagens.

Recorreção da rodada de 2026-11-25 (`evals/investigation/results/2026-11-25-12-32-v1v3-recorrigido.json`), v1 com guardas: leitura do negócio 91% (crua 85%), diagnóstico cerca de 83% sem o ganho que vem de hipótese apagada (crua 75%), auditoria visual 95%, triagem 87%; apagamento de conclusão verdadeira 0 de 43 e 0 de 108. As versões v2 e v3 dos prompts não foram promovidas (tolerância zero). CNPJ: o servidor procura o CNPJ nas páginas lidas do site e confere na Receita antes de usar (`linkCnpjFromSite`); a pessoa também pode informar o CNPJ na tela da empresa. O vínculo fica nos claims (`company.cnpj`) e nas chaves de deduplicação (`company_identifiers`, CNPJ forte e raiz fraca), sem migração; o dossiê expõe a raiz do CNPJ vinculado para a supressão e a qualificação. A coluna `companies.cnpj` fica vazia até o usuário decidir a migração (KI-160).

#### 3b. Emenda (2026-11-25): pesquisa de concorrentes

- **Segunda consulta:** a investigação tenta até 2 consultas, na ordem: ramo declarado no site (com trecho conferido), atividade do CNAE, ramo do título da página inicial (sem campanha, erro, manutenção, desafio anti-robô ou nome de rede social) e oferta principal. A segunda só roda quando a primeira não deixa nenhum candidato.
- **Teto:** no máximo 3 pesquisas por investigação, contando a busca do site, a de sinais e as de concorrentes (`MAX_SEARCHES_PER_RUN`); a segunda consulta de concorrentes não roda quando as anteriores já somam 3. Pesquisa respondida pelo cache local entra na contagem, mas não gasta crédito da Tavily. Consultas à Receita do CNPJ lido no site não contam aqui (têm teto próprio de 3 CNPJs, doc 05).
- **Reaproveitamento:** uma pesquisa vale por 30 dias contados da data em que rodou de verdade (`snapshot.searchedAt`), e a etapa reaproveitada copia essa data. A pesquisa de concorrentes vazia só é reaproveitada quando voltou sem nenhum candidato e com as mesmas consultas; se houve candidatos e a triagem recusou todos, pesquisa de novo. "Coletar tudo de novo" ignora o reaproveitamento.

### 4. Qualificação (domínio puro)

Fit, Oportunidade e Confiança são números separados de 0 a 100 e nenhum é probabilidade de fechar negócio (doc 08). O Fit é a fração dos critérios do ICP **com dado conhecido** que batem; a tela diz quantos critérios eram conhecidos e a Confiança cai com a cobertura (pendência KI-132). Gates (situação inativa, exclusão do ICP, desqualificadores da oferta) vêm antes do score. Só o cadastro descarta (CNPJ de filial contra o desqualificador da oferta); desqualificador apontado pela IA pede no máximo "Acompanhar", com o aviso "apontado pela IA; confira antes de descartar" (KI-133). Necessidade sustentada só por hipóteses nunca vira "Abordar agora".

### 5. Fila em processo, com dono e batimento

Enquanto a fila `ai_jobs` (ADR-0011, outra sessão) não chega a este ramo, a fila é **em processo**: uma execução por vez (GPU e cota são do usuário), as demais esperam `queued`. O processo grava `runner` e `heartbeat_at` a cada poucos segundos na atual e nas que esperam; ao subir, o servidor marca como `interrupted` o que ficou sem batimento (nada preso em "rodando"). Cancelamento é pedido (`cancel_requested_at`) e a etapa em curso para no próximo ponto seguro. Empresa arquivada não é investigada: `start` e `resume` recusam, e a que estava na fila termina cancelada sem coletar nada (`company_archived`). `job_id` fica reservado para a migração para `ai_jobs`.

### 6. Capturas fora do disco C:

Imagens só são guardadas se `PROSPECTOR_CAPTURES_DIR` apontar para uma pasta absoluta com letra de unidade **fora do C:** (KI-017). O servidor também recusa pasta de rede (`\\servidor`, `//servidor`), caminho com `..` e pasta sincronizada com a nuvem (OneDrive, Dropbox, Google Drive, iCloud): as imagens ficam neste computador. Sem a pasta, as imagens vão para o modelo de visão na própria execução e são descartadas; o dossiê mostra as medições e avisa.

- **Uma imagem por janela e por empresa.** Quando a captura nova entra no ledger, as imagens anteriores da mesma janela são apagadas (o claim e a fonte continuam, com o hash; o que mudou sai dos hashes). Site que passou a pedir para não guardar cópia tem as imagens antigas apagadas.
- **Prazo.** O da fonte (12 meses, como as páginas do ADR-0012). Apagar ao arquivar a empresa e o "arquivada + 90 dias" do doc 06 §6 pendem (KI-136, ligado ao KI-084). As imagens podem ter rostos, nomes e telefones de quem aparece no site.
- **Rota.** `/empresas/[id]/capturas/[arquivo]` termina em `.jpg` e por isso fica fora do proxy: ela mesma confere o Host local (regra 3a, 403 fora de localhost). Lê pelo serviço (`InvestigationService.captureImage`), que só devolve `<investigação>-<desktop|mobile>.jpg` apontado por um claim de captura da própria empresa; o armazenamento confere o caminho de novo dentro da pasta. Resposta com `Cache-Control: no-store` (imagem apagada não fica no navegador), `Cross-Origin-Resource-Policy: same-origin`, `nosniff` e CSP vazia.
- `PROSPECTOR_BRAND_CAPTURE=off` desliga a captura.

### 7. Modelos

Todas as chamadas passam pelo gateway (`packages/agents`). Texto: tarefa `reasoning`; capturas: tarefa `vision` (exige a capacidade `vision` no Ollama), `num_ctx` 12.288 e `keep_alive` de 2 minutos (modelo de visão não fica parado na memória). Hoje as duas resolvem para `qwen3.5:4b` (tem projetor de visão); o `qwen3-vl:8b` saiu da lista de visão até ser avaliado. Uma inferência por vez.

- **Telemetria.** Cada análise vai para `llm_calls` (ADR-0005): tarefa, modelo, versão do prompt, tokens, tempo de geração e de carga, motivo do fim, `traceId` do pedido. O custo da investigação conta como tempo de GPU o da geração no Ollama, sem a espera na fila do gateway. Falha ao gravar a telemetria não derruba a investigação.
- **Teto de saída.** O gateway aceita até o dobro do teto da tarefa, e as análises pedem até 2.048 tokens: emenda ao item 4 do ADR-0008 (1.024), porque o diagnóstico com várias ofertas não cabia.

### 8. Copiloto

Três ferramentas em `packages/application/src/tools/investigation-tools.ts`: `get_company_investigation` (andamento com `concluida`, diagnóstico e, com `parte`, o que foi registrado sobre marca, concorrência, negócio ou sinais), `list_company_opportunities` (ranking por prioridade) e `start_company_investigation` (`kind: 'queue'`: põe na fila uma tarefa interna que lê o site da empresa, pesquisa na internet e grava no dossiê; não envia nada a ninguém, regra 2 intacta). "Nada sai do computador" não vale: a Tavily recebe o nome e a cidade da empresa e os sites são acessados, como na pesquisa do ADR-0012. O texto de sistema diz essa exceção com o que a tarefa faz.

Para cumprir o §15 ("não declarar concluída antes de confirmar o estado real"), os resultados trazem estado, não ordens (resultado de ferramenta é dado): `concluida` só para concluída com ou sem lacunas, `terminou` também para falha e cancelamento, e `start` devolve `resultado_disponivel: false` e onde acompanhar. Ângulo, objeções e o que conferir vêm do claim da leitura (`leitura_da_ia`, com o tipo). Registros de capturas e as leituras da IA sobre páginas da web vêm marcados `fonte_externa`, com o aviso de que são dado, não instrução.

As ferramentas só são entregues a prompts que declaram conhecê-las (`TOOLS_PROMPT_CAPABILITIES` em `packages/agents/src/copilot/copilot.ts`), não por número de versão. Hoje nenhuma versão declara a investigação: o padrão continua `copilot-tools/v3`, e o trecho proposto (v3 + seção curta no fim) está em rascunho, em `docs/rascunhos/copilot-tools-empresas.md`. Combinado entre as sessões (2026-11-11): nenhuma frente cria nem promove sozinha o `copilot-tools/v4`; o v4 unificado (Empresas, Descoberta e Relacionamento) é montado e avaliado uma vez só, depois da mesclagem, e declara as capacidades que ensinar (§9, KI-130).

### 9. Prompts e avaliação

| Prompt | Situação |
|---|---|
| `company-business/v1`, `brand-visual/v1`, `competitor-triage/v1`, `competitive/v1`, `diagnosis/v1` | Em uso pela investigação, com as guardas do §3a. Desde 2026-11-25 há conjunto de avaliação (`packages/agents/evals/investigation`) para leitura do negócio, auditoria visual, triagem e diagnóstico; `competitive/v1` ainda sem (KI-131). As versões v2 e v3 desses prompts foram avaliadas e **não promovidas** (tolerância zero reprovou a leitura do negócio e a triagem v3) |
| Rascunho para o v4 unificado (`docs/rascunhos/copilot-tools-empresas.md`) | Não é prompt em uso; não promovido (avaliador-ia, 2026-11-11). Foi avaliado com o id "v4" antes de virar rascunho. O texto no disco só foi avaliado numa rodada (17-33: comuns 4 de 9, investigação 7 de 9, `pedido-de-envio` 0 de 3); houve 7 textos com o id "v4" em 8 rodadas. Na 17-39 (outro texto) os comuns ficaram em 15 de 21 contra 18 de 21 do v3, abaixo do limiar. Depois disso o texto ganhou a correção da contradição "só leem" contra "a única que muda algo", sem nova rodada. Na junção entra no v4 unificado com os trechos da Descoberta e do Relacionamento, com texto congelado antes da rodada (KI-130) |

## O que fica de fora

- Fila persistente compartilhada (`ai_jobs`): ADR-0011.
- Redes sociais por leitura automática (termos dos provedores, regra 6): a auditoria usa o site, e a captura e o leitor recusam os domínios das redes (inclusive feeds embutidos). Links de redes no site ainda não viram fato de presença; trechos de busca vindos de redes podem entrar nos sinais, como a emenda do ADR-0012 permite.
- Decisores e canais de contato (F9): o diagnóstico diz "ainda não sabemos quem decide".
- Avaliação humana das notas (concordância com o diretor de criação, doc 09 F6/F7): precisa de um conjunto rotulado pelo usuário.

## Consequências

- Uma investigação gasta de 1 a 3 buscas da Tavily (site, só quando não há domínio cadastrado; sinais; concorrentes; as duas últimas reaproveitadas por 30 dias), lê até 4 páginas do site e até 3 de concorrentes, faz 2 capturas e de 3 a 6 chamadas ao modelo local (cerca de 1 a 3 minutos de GPU).
- Reinvestigar reaproveita o que não mudou e registra mudanças verificadas (página nova ou sumida, oferta nova ou sumida, comunicação ou visual diferente, sinal novo, concorrente novo); site fora do ar na nova coleta é registrado como indisponível temporário, nunca como mudança definitiva.
- No modo memória (sem banco) a busca fica desligada (o teto mensal não persiste, ADR-0012): sinais e concorrentes não rodam e a investigação sai "com lacunas".
- O modelo de 4B exagera em inferências (ex.: chama de "graves" problemas medidos como pequenos; diz "falta de imagens" com 5 imagens medidas): as conclusões entram como inferência de confiança baixa ou média, com o fato que as sustenta ao lado, e a recomendação fica conservadora. Melhorar exige o conjunto de avaliação (KI-131) e, talvez, outro modelo de visão (download só com aprovação).
