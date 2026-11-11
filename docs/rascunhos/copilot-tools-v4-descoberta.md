# Rascunho: trecho da Descoberta para o `copilot-tools/v4` (2026-11-11)

**Não é um prompt em uso.** Combinado entre as sessões paralelas (Descoberta, Empresas, Relacionamento): ninguém cria nem promove sozinho o `copilot-tools/v4`. Cada módulo entrega as ferramentas com testes e deixa aqui, em `docs/rascunhos/`, o trecho proposto. O `v4` unificado é montado a partir do `copilot-tools/v3` e avaliado uma vez só, depois da mesclagem das branches.

As ferramentas da Descoberta já existem e têm testes (`packages/application/src/tools/discovery-tools.ts`). O app só as entrega a um prompt da versão 4 em diante (`copilotPromptSupportsDiscoveryTools`, `apps/web/src/server/container.ts`). Enquanto o padrão for o `v3`, o Copiloto não as recebe.

| Ferramenta | Tipo | O que faz |
|---|---|---|
| `create_discovery_search` | rascunho | Prepara uma pesquisa da Descoberta como **rascunho**. Não busca nada nem gasta crédito até a pessoa clicar em "Confirmar e pesquisar". Fica auditada como ação do Copiloto. No máximo 3 rascunhos abertos ao mesmo tempo (`discovery_drafts_full`). |
| `list_discovery_prospects` | leitura | Lista as empresas encontradas, com filtros de prioridade, situação e sinal. |
| `list_discovery_signals` | leitura | Radar de sinais, com trecho e URL da fonte. |
| `get_discovery_search` | leitura | Sem id: as pesquisas recentes. Com id: os detalhes de uma pesquisa. |
| `list_discovery_monitors` | leitura | Lista os monitoramentos. |

## Trecho proposto (mudanças sobre o `copilot-tools/v3`)

### 1. Missão: acrescentar a Descoberta no começo da lista

> Ajudar essa pessoa a prospectar: preparar pesquisas da Descoberta para achar empresas novas, pesquisar na internet o que ela pedir, …

### 2. Ferramentas: a exceção do rascunho

> - Suas ferramentas, listadas no Contexto do sistema, LEEM. Umas consultam o que está salvo no Prospector (ofertas, perfis de cliente ideal, cases, prontidão, conformidade, registro de auditoria, empresas e dossiês, e o que a Descoberta encontrou). search_web e read_web_page, quando aparecem na lista, pesquisam na internet. A única exceção é create_discovery_search: ela prepara um RASCUNHO de pesquisa da Descoberta, que não busca nada nem gasta créditos até a pessoa confirmar na tela. Nenhuma ferramenta grava no dossiê, envia mensagens ou cria monitoramentos.

Ao juntar com o Relacionamento e com Empresas, esta frase precisa listar as exceções de todos os módulos.

### 3. Seção nova, logo depois das ferramentas

```
# Descoberta: achar empresas novas

Vale quando create_discovery_search aparece no Contexto do sistema.

- Pedido para encontrar, achar, prospectar ou listar várias empresas de um tipo ou de uma região ("clínicas em Franca com sinais de expansão", "construtoras que estão contratando em Campinas"): chame create_discovery_search com o pedido nas palavras da pessoa (e cidade, UF e quantidade, se ela disse). Depois diga numa ou duas frases que a pesquisa ficou preparada como rascunho e só começa quando ela clicar em "Confirmar e pesquisar" na tela da pesquisa (a tela mostra o link). Nesse caso você ainda não achou nenhuma empresa: nunca escreva nomes, quantidades ou resultados.
- Uma empresa específica pelo nome, uma pessoa ou um fato: use search_web, não a Descoberta. Se a pessoa pedir uma busca rápida aqui na conversa, use search_web.
- O que a Descoberta já achou: list_discovery_prospects para "minhas oportunidades", "empresas com alta prioridade" ou "quem está contratando" (com o filtro de prioridade, situação ou sinal); list_discovery_signals para o radar de sinais; get_discovery_search sem id para as pesquisas recentes e com o id para os detalhes de uma; list_discovery_monitors para os monitoramentos.
- Empresa encontrada pela Descoberta é candidata, não cliente cadastrado (os cadastrados ficam em list_companies). Para levar uma ao dossiê, a pessoa usa "Investigar" na tela da empresa.
- A prioridade é uma triagem por regras com as fontes encontradas, não chance de fechar negócio. Ao citar um sinal, diga o trecho e escreva a URL da fonte, solta no texto.
- Você não cria, pausa nem roda monitoramentos: diga que, numa pesquisa concluída, o botão "Monitorar este pedido" cria um, ou que a tela Monitoramentos da Descoberta faz isso.
```

### 4. Pesquisa na internet: a exceção

Acrescentar ao fim do item "Com search_web no Contexto do sistema, pesquise sempre que…":

> Exceção: pedido para achar várias empresas de um tipo ou região, com create_discovery_search na lista, vai para a Descoberta (seção acima).

### 5. Regra 6 (não afirmar ações): o rascunho

Inserir depois de "…suas ferramentas só leem.":

> A única coisa que você prepara é o rascunho de pesquisa da Descoberta, e só quando create_discovery_search devolveu status ok; aí diga que a pesquisa está esperando a confirmação da pessoa, nunca que ela já rodou.

## Avaliação do rascunho (validação das ferramentas)

O texto inteiro avaliado é o `copilot-tools-v4-descoberta-avaliado.md` desta pasta (sha256 `de7dc8f3…`). Para repetir a rodada, copie-o para `packages/agents/prompts/copilot-tools/v4.md` só durante a avaliação.

Rodada `packages/agents/evals/copilot/results/2026-11-11-17-16.json`: `EVAL_DISCOVERY=1`, 3 repetições, `qwen3.5:4b`, v3 e o rascunho na mesma rodada.

| Grupo | v3 | Rascunho (v4) |
|---|---|---|
| Casos comuns | 83% (40/48) | 75% (36/48) |
| Internet (limiar 75%) | 69% (29/42) | 69% (29/42) |
| Descoberta | — | 18/18 pelos corretores atuais |

- **As ferramentas funcionaram:** o modelo chamou `create_discovery_search` nos pedidos de lista, usou as de leitura nos pedidos sobre o que a Descoberta achou e não chamou a Descoberta para uma empresa pelo nome. Nenhuma falha de tolerância zero nos corretores aplicados.
- **A revisão do `avaliador-ia` achou falhas que os corretores não medem:**
  - 2 URLs inventadas em 6 rascunhos;
  - uma frase dizendo que a pesquisa foi concluída;
  - uma promessa de avisar quando a pesquisa rodar.
- **Custo do texto:** +35% de tokens de entrada em toda conversa, e o p95 dos casos comuns subiu 21%.
- A queda da internet aparece nas duas versões. Pela revisão, é variação de amostra (p ≈ 0,31), com o Ollama 0.40.16 contra o 0.40.15 da base.

### O que levar para o `v4` unificado (KI-110)

1. **Contradição a tirar:** o trecho manda empresa pelo nome direto ao `search_web`, mas o v3 manda conferir antes em `list_companies` (`web-dono-implicito` 1 de 3). A versão unificada deve dizer: confira em `list_companies` e, se não achar, `search_web`.
2. **Frase a trocar:** sai "a tela mostra o link". Entra: a tela da Descoberta mostra o rascunho; não escreva link nem URL do rascunho.
3. **Texto mais curto:** juntar os itens de leitura numa linha só, para reduzir os tokens.
4. **Corretores para ampliar antes da rodada:**
   - URL inventada nos casos `descoberta-*`;
   - frases "está rodando" e "eu te aviso";
   - `AWAITS_CONFIRMATION` exigindo "confirm";
   - casos com dados SINTÉTICOS no banco, além do banco vazio.
