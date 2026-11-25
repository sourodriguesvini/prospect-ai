# ADR-0017 — Monitoramento e Inteligência sobre os dados que já existem

- Status: **Proposto** (2026-11-25). Código e testes no commit `d148c73` (branch `claude/monitoramento-inteligencia-305023`), mesclado na `conclusao-produto` em 2026-11-25. Sem migração.
- Data: 2026-11-25
- Fatia: primeira parte do Monitoramento (D15; doc 09, Fase 2) e da Inteligência (D16; doc 09, F13)
- Depende de: [ADR-0001](0001-monorepo-e-fronteiras.md) (fronteiras), [ADR-0007](0007-uso-interno-local-sem-login.md) (uso local), [ADR-0013](0013-descoberta-inteligente.md) (monitoramentos da Descoberta), [ADR-0014](0014-relacionamento-abordagens-conversas-pipeline.md) (abordagens, interações e oportunidades), [ADR-0015](0015-investigacao-de-empresas-e-brand-intelligence.md) (investigação, recomendação e `changes`).

## Contexto

As telas Monitoramento e Inteligência eram cartões "Em breve". Os docs 02 e 06 previam tabelas próprias (`watchlists`, `monitor_runs`, `change_events`) e um módulo de aprendizado com calibração. Boa parte do que essas telas precisam mostrar já é gravada por outros módulos:

- cada investigação concluída guarda em `company_investigations.changes` o que mudou em relação à anterior (`detectChanges`, ADR-0015), e a empresa guarda `last_investigated_at`;
- a view `company_investigation_summaries` traz a recomendação e a prioridade do último diagnóstico;
- os monitoramentos da Descoberta (ADR-0013) gravam execuções com `newProspects` (empresas que nenhuma pesquisa tinha visto);
- cada etapa do funil tem data própria (`discovery_prospects.first_seen_at`, `companies.created_at`, `company_investigations.finished_at`, `approach_plans.created_at`, `interactions.occurred_at`, `opportunities.closed_at`);
- `llm_calls`, `tool_calls` e `provider_usage` registram o uso da IA local e da busca na internet.

## Decisão

Decisões de produto tomadas pelo usuário em 2026-11-25.

1. **Lista de acompanhamento implícita, pela recomendação.** Não há tabela `watchlists`. Toda empresa em acompanhamento (não arquivada) com diagnóstico entra na lista com a frequência da recomendação: "Abordar agora" e "Preparar acesso" a cada 7 dias; "Acompanhar", "Investigar mais" e "Sem base suficiente" a cada 30; "Descartar por enquanto" fica de fora (a tela conta quantas). O prazo vence `n` dias depois da última investigação concluída (`finished_at` dela; `companies.last_investigated_at` só entra quando a última investigação ainda roda ou falhou, porque essa coluna também muda quando o CNPJ é consultado); data ilegível conta como vencida. Ordem: vencidas (mais atrasadas, depois maior prioridade), em andamento, em dia. Regras puras em `packages/domain/src/monitoring/watch.ts`.
2. **Reinvestigação só com o clique.** Nada é agendado. A empresa vencida ganha "Investigar de novo", que usa a mesma ação do dossiê (`startInvestigation`, `trigger: 'user'`, sem refazer o que ainda vale) e leva ao dossiê, onde o andamento aparece.
3. **Feed único de novidades.** Um só feed, mais recentes primeiro, com dois tipos de item: o que cada investigação concluída encontrou de diferente da anterior (`company_investigations.changes`, com link para o histórico no dossiê) e execuções concluídas das buscas recorrentes da Descoberta que acharam empresas novas (com link para a execução). "Fora do ar nesta coleta" aparece à parte, nunca como mudança. Filtro na URL: `?origem=empresas` ou `?origem=buscas`; a web filtra com `filterMonitoringFeed`, função pura do domínio (emenda F2 do ADR-0001). Cada parte do feed degrada sozinha: se a leitura das mudanças falhar (`companyChanges: 'unavailable'`) ou a da Descoberta falhar, a tela avisa e mostra o resto. Com a Descoberta desligada, o filtro some. O feed mostra 60 itens e avisa quando há mais (`feedTruncated`). Entre as buscas recorrentes, entram no teto primeiro as ativas e as pausadas, depois as arquivadas, as que rodaram por último antes.
4. **Inteligência, primeira parte: funil e consumo.**
   - Funil por período ("Este mês", no mês civil de Brasília, ou "Desde o início"; `?periodo=total`). Cada etapa conta **empresas distintas**, pela data da própria etapa: não é coorte. A razão em relação à etapa anterior só aparece quando a anterior tem empresas e a razão não passa de 100%; com menos de 20 empresas na anterior, vem marcada como amostra pequena (doc 02, D16). Registros DEMO são contados e mostrados com selo.
   - Consumo do mês civil: gerações da IA local por modelo, tokens, tempo de processamento, falhas e ferramentas do Copiloto (`llm_calls`, `tool_calls`); créditos da Tavily do mês contra o orçamento e a cota gratuita (`research.status()`); gasto em dinheiro, que é a soma de `cost_usd > 0` em `llm_calls` e `provider_usage`.
   - Aprendizados e calibração do modelo de score ficam para depois.
5. **Início.** Os cartões "Gasto no mês" (antes "Custo de IA no mês": o valor soma tudo o que foi cobrado em dinheiro, não só a IA) e "Funil de prospecção" (só as contagens) usam a mesma leitura, com link para a Inteligência. Se a leitura falhar, os dois cartões dizem que não leram, sem derrubar a Início.

Etapas do funil:

| Etapa | Fonte | Data |
|---|---|---|
| Encontradas | `discovery_prospects` | `first_seen_at` |
| Em Empresas | `companies` | `created_at` |
| Investigadas | `company_investigations` (concluída ou parcial) | `finished_at` |
| Com abordagem | `approach_plans` | `created_at` |
| Contatadas | `interactions` de saída | `occurred_at` |
| Responderam | `interactions` de entrada | `occurred_at` |
| Ganhas | `opportunities` ganhas | `closed_at` |

Camadas: contratos em `packages/contracts/src/monitoring.ts` e `intelligence.ts`; regras em `packages/domain/src/monitoring` e `intelligence`; `MonitoringService` e `IntelligenceService` em `packages/application`, com portas próprias (`ports/monitoring.ts`) e leitura em memória; leitura PostgREST em `packages/db/src/monitoring-repository.ts`. O pacote db não importa o domínio: a contagem de empresas distintas é repetida lá, em poucas linhas.

## Limites aceitos

- Leituras com teto, para não varrer o banco a cada visita: 1.000 linhas por etapa do funil, por soma de gasto e por leitura do uso da IA local (`llm_calls` e `tool_calls` do mês), 200 empresas na lista, 200 investigações recentes para o feed (60 itens mostrados), 20 buscas recorrentes × 10 execuções. Quando uma etapa, o gasto ou o número de gerações bate no teto, a tela mostra "+"; a razão do funil some quando uma das duas etapas bateu no teto. Uma contagem exata que o banco não devolve vira erro, nunca zero.
- As chamadas da IA da Descoberta ainda não vão para `llm_calls` (KI-116): o consumo de IA fica menor que o real, e a tela diz isso.
- No modo memória não há registro de gasto: o valor é sempre zero.

## Alternativas consideradas

- **Tabela `watchlists` com escolha manual e frequência por empresa** (docs 02 e 06): adiada. Pede migração e mais uma decisão por empresa; a recomendação do diagnóstico já diz com que frequência olhar.
- **Reinvestigação automática pela fila** (ADR-0011): recusada pelo usuário. Gastaria créditos da Tavily e a placa de vídeo sem pedido.
- **Feeds separados por origem**: recusados. Um feed com filtro mostra tudo o que mudou num lugar só.
- **Funil por coorte** (empresas encontradas no mês e até onde chegaram): mais fiel para taxa de conversão, mas pede ligar cada etapa à primeira descoberta da empresa, o que os dados ainda não fazem de forma confiável. Fica como evolução (KI-182).

## Consequências

- Monitoramento e Inteligência funcionam sem migração nova, com banco real ou em memória.
- A rota genérica de módulo "em breve" (`[modulo]`) foi removida: um módulo futuro sem tela precisa de página própria. O menu lateral continua aceitando `plannedSlice`.
- Pendências registradas de KI-180 a KI-186 em `docs/known-issues.md`.
