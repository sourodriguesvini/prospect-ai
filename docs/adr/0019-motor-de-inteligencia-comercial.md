# ADR-0019 — Motor de inteligência comercial: perfis, acontecimentos e tese

- **Status:** Aceito (2026-11-27, pelo usuário, com os modos de entrega e os dados da Blummy como propostos; refinamento segue na KI-207)
- **Contexto da decisão:** diretriz do responsável pelo produto de 2026-11-26 ([texto](../diretrizes/2026-11-26-evolucao-do-motor-de-inteligencia.md)), Fases 2 a 4; diagnóstico em [doc 15](../15-motor-de-inteligencia.md).
- **Relaciona-se com:** ADR-0001 (fronteiras), ADR-0008 (IA local), ADR-0012 (pesquisa na internet), ADR-0015 (investigação).

## Contexto

O doc 15 mostrou que a tese comercial nunca é construída:
- o catálogo eram três entregáveis de marca (D1);
- os acontecimentos ficavam no título de uma busca (D2);
- a notícia lida pela busca tinha confiança de agregador (D3);
- a ponte para a abordagem punha as medições do site na frente (D4 e D5).

No caso real da Flash, uma Série D de R$ 150 milhões virou "fato, confiança baixa". A mensagem gerada abriu com o contraste do site.

## Decisão

1. **Perfil comercial como dado versionado no código** (`packages/domain/src/commercial/profiles.ts`), validado pelo contrato `CommercialProfile` (`packages/contracts/src/commercial.ts`).
   - **Found Studio:** famílias A a F com a hierarquia capacidade → problema → serviço → solução → entregável.
   - **Blummy:** produto SaaS, com o que falta em `unknowns`.
   - **Modo de entrega:** provisório e conservador. "Direto" vale só onde há portfólio publicado; o usuário confirma o resto.
   - **Identificação do perfil pelo pedido:** `identifyCommercialProfile`. O nome decide; depois contam as palavras do público. Empate dá `null`, e quem chama pergunta.
   - **Migração:** a tabela `commercial_profiles` com `profile_id` nas tabelas da Estratégia fica para quando a migração for autorizada.

2. **Acontecimento empresarial no ledger, sem tabela nova.** Continua sendo um claim `signal.web.<tipo>_<host>`, com o acontecimento estruturado em `value.event` (contrato `BusinessEvent`):
   - tipo e data, com a base da data;
   - título e host;
   - categoria da fonte;
   - republicações, confirmações independentes e divergências;
   - se a página foi lida;
   - num investimento: valor, rodada, investidores, modalidade, finalidade declarada (ou `unknown`) e contexto, cada um com trecho literal.

3. **A investigação lê a matéria de origem** (etapa `signals`):
   - **Agrupamento:** as matérias do mesmo acontecimento viram um grupo (`groupEventReports`). A origem é a melhor fonte (site da empresa > imprensa reconhecida > outras) e, no empate, a mais antiga.
   - **Republicação não confirma:** título quase igual ou "segundo o X" é republicação. Apuração própria é confirmação. Valores diferentes ficam como divergência.
   - **Leitura:** até 2 matérias por investigação, pelo leitor do Prospector, sem crédito de busca. Só dos tipos que mudam a leitura comercial: investimento, aquisição, fusão, novo mercado, expansão, lançamento, liderança, reestruturação e parceria.
   - **Matéria lida que cita a empresa:** vira **fato** ("a matéria informa…"). A fonte guarda só o título e os trechos citados. O ledger aceita uma evidência por fonte, então vai o trecho mais forte; os outros ficam todos na fonte, ao lado de cada campo.
   - **Só o que fala da empresa:** valor e rodada saem de frases que citam a empresa; investidores, finalidade e contexto, das frases seguintes no corpo da matéria (`extractCompanyFunding`). Menu, "leia também" e chamadas de outras matérias da mesma página não entram.
   - **Confirmações no ledger:** cada site com apuração própria entra como evidência do mesmo claim (o resultado de busca dele, uma fonte por evidência). Republicação não entra.
   - **Texto externo fora do enunciado quando se dirige a máquinas:** o enunciado do fato chega às capacidades de IA; se título, investidores ou finalidade trazem ordem para sistemas automatizados (`looksLikeInjection`), o enunciado fica só com o que o sistema escreve.
   - **Sem leitura** (página fora do ar, tela anti-robô, `noarchive`, não cita a empresa): continua **hipótese** a partir do título, com o motivo no raciocínio. Com `noarchive`, a fonte guarda só o título do resultado, sem o trecho do buscador.
   - **Chave e duplicidade:** a chave junta tipo, site e começo do título (`signal.web.<tipo>_<site>_<título>`), e a tese conta cada acontecimento uma vez (`dedupeEventEvidence`), mesmo se análises diferentes gravaram a origem em sites diferentes.

4. **Imprensa reconhecida** (`RECOGNIZED_PRESS_HOSTS`, proposta editável) alimenta `pressHosts` do ledger.
   - A página lida dessas redações vale `recognized_press` (0,8).
   - O resultado de busca continua no máximo agregador (0,6), como manda o docs/08 §2.5.

5. **Motor de compatibilidade como regra pura** (`buildCommercialThesis`). Sinais levam a problemas do catálogo, que levam a capacidades, soluções e à tese.
   - **Seis dimensões qualitativas:** alto, médio, baixo ou indeterminado, cada uma com motivo e claims. Sem número de falsa precisão (Parte 4.2).
   - **Ângulos:** um principal e até duas alternativas com solução diferente. A tese diz o que **não** oferecer e o que confirmar antes.
   - **Recomendação:** "vale preparar a abordagem", "aprofundar a pesquisa antes" ou "não priorizar agora".
   - **Proteções dos casos da Parte 8, garantidas por teste:**
     - medição do site não disputa o ângulo quando há acontecimento (Caso 1);
     - só medição do site leva a "não priorizar" (Caso 4);
     - fontes divergentes levam a "aprofundar" e à confirmação da versão (Caso 6);
     - acontecimento sem data conferida (ex.: vagas citadas no próprio site) leva a "aprofundar": sem data não há momento;
     - investimento nunca vira orçamento: sem finalidade documentada, ela fica "não documentada".
   - **"Acesso a quem decide" nunca "alto"** enquanto não houver entidade de pessoa (decisores, doc 15 §6).
   - **Regras de cada perfil ficam no perfil:** a área de que a conversa trata (`openingArea` do problema) e o que não oferecer depois de certos acontecimentos (`avoidAfterEvents`, ex.: rebranding depois de troca de marca na Found Studio) são dados do catálogo, não código.

6. **A tese fica no diagnóstico** (`Diagnosis.thesis`, JSON já existente em `company_investigations.diagnosis`).
   - Não há migração. Investigações antigas não têm tese.
   - O painel "Oportunidade" mostra a tese acima dos serviços, com as evidências de cada ângulo.

## O que a IA faz e o que não faz

Nada desta decisão chama modelo:
- detecção de acontecimento, extração com trecho literal, agrupamento, hierarquia, dimensões e tese são regras testáveis;
- o modelo entra depois (Fase 5), escrevendo a narrativa e a mensagem **a partir da tese aprovada**, com prompt novo avaliado por `pnpm evals` antes de ser promovido (ADR-0008).

## Consequências

- **Primeira análise depois da mudança:** pode ler até duas páginas de notícia a mais, alguns segundos cada. O consumo de busca não muda (continua uma busca de sinais).
- **Qualificação:** os fatos de acontecimento entram no diagnóstico como fatos (`signal.` já estava em `FACT_PREFIXES`) e passam a contar na Opportunity.
- **Limitações registradas** em `docs/known-issues.md`:
  - KI-207: perfis no código e modos de entrega provisórios;
  - KI-208: validade de 30 dias do sinal e corroboração só dentro da mesma busca;
  - KI-209: a mensagem ainda não usa a tese;
  - KI-210: sem decisores;
  - KI-211: lista de imprensa e fontes antigas;
  - KI-212: nomes de pessoas em fatos de acontecimento, sem prazo até existir o expurgo (KI-084);
  - KI-213: termos de uso dos veículos e base legal para nomes de terceiros, pendentes de validação jurídica.
