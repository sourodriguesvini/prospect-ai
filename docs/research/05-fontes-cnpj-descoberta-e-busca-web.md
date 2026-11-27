# Fontes para CNPJ, descoberta de empresas e busca web (2026-11-10)

> Pesquisa feita por subagente para o M2/M3 (doc 14) e a decisão D-AI-4. Todas as páginas foram consultadas em **10/11/2026**. Nenhuma conta foi criada, nenhuma chave usada e nenhum CNPJ de empresa consultado: só documentação, termos, preços e leituras públicas sem chave (listagem da Receita, taginfo, IBGE). **[não verificado]** marca o que não foi confirmado em fonte oficial (KI-004). Fontes numeradas no fim.

## 0. Achados que mudam o desenho

- **CNPJ alfanumérico existe desde 31/07/2026.** Os numéricos continuam válidos; o formato das APIs é `[A-Z0-9]{12}[0-9]{2}` [1][2][10]. Contratos Zod e adaptadores precisam aceitar os dois.
- **BrasilAPI e Minha Receita são a mesma fonte** (a BrasilAPI declara a Minha Receita como origem [4]): uma não é reserva da outra. A Minha Receita saiu do GitHub (arquivado em 04/01/2026) para o Codeberg [13].
- **Google Programmable Search JSON API** fechada a novos clientes, encerra em 01/01/2027 [43].
- **Brave Search API** sem plano grátis (só créditos) e termos proíbem armazenar resultados além do transitório [36].
- **OpenStreetMap tem pouca cobertura em nichos**: 2.964 `amenity=dentist` no Brasil inteiro [25]. Complemento, não fonte principal.
- **Casa dos Dados**: só API paga; o endpoint "público" usado por terceiros não é documentado [28][29].

## 1. Consulta por CNPJ

Todas derivam da base da Receita (cobertura igual); mudam atualização, limites e termos.

| Opção | Exemplo | Chave | Limite | Atualização | Termos |
|---|---|---|---|---|---|
| **OpenCNPJ** | `GET https://api.opencnpj.org/{cnpj}?datasets=receita` | Não | Sem cota fixa; 429 sob volume alto contínuo [10] | Mensal; campo `updated_at` | Sem termos publicados [não verificado]; código MIT [11]; remove CPF do nome de MEI e anonimiza a pedido [10] |
| **Minha Receita** | `GET https://minhareceita.org/{cnpj}` | Não | Consulta por CNPJ sem limite declarado; busca paginada dá 429 [12] | `/updated` informa a extração | Sem garantia de serviço; licença dos dados [não verificado] |
| **BrasilAPI** | `GET https://brasilapi.com.br/api/cnpj/v1/{cnpj}` | Não | Volume humano; veda crawling [5] | = Minha Receita | Projeto se diz experimental [5] |
| **ReceitaWS (pública)** | `GET https://receitaws.com.br/v1/cnpj/{cnpj}` | Não | 3/min [2] | Só o que está no cache deles (senão 504) [2] | Uso em benefício próprio, sem revenda [3] |
| **CNPJ.ws (pública)** | `GET https://publica.cnpj.ws/cnpj/{cnpj}` | Não | 3/min por IP; abuso bloqueia 1 h [6] | Até 45 dias de defasagem [8] | Uso em benefício próprio [8] |
| **CNPJá Open** | `GET https://open.cnpja.com/office/{cnpj}` | Não | 5/min por IP [14] | [não verificado] | Termos não lidos (site bloqueia leitura automatizada) |
| **Dados Abertos da Receita** | pasta `Dados/Cadastros/CNPJ/2026-10/` [15] | Não | Download | Mensal (última: 2026-10) | Uso livre com citação (Decreto 8.777/2016) [17]; 37 zips, 7,81 GB [15] |

## 2. Descoberta por segmento e cidade

| Opção | Cobertura | Limites | Custo | Termos |
|---|---|---|---|---|
| **Base da Receita importada localmente** | Todos os estabelecimentos; filtro por CNAE principal/secundário, UF, município, situação [16] | Nenhum | Grátis; ~8 GB compactados [15] | Uso livre com citação [17] |
| **Minha Receita, busca paginada** | Mesma base; filtros `uf`, `cnae_fiscal`, `cnae`, `municipio` (IBGE ou SIAFI), `natureza_juridica` [12] | Até 1.024/página com cursor; em testes, 429 [12] | Grátis | Sem garantia |
| **Overpass (OSM)** | Baixa em nichos (dentistas: 82% com nome, 47% com rua, 17% com telefone) [25] | < 10 mil consultas/dia em uso eventual; sem paralelismo; User-Agent do app; 429 → esperar [20][21] | Grátis | ODbL; uso comercial deve ir para instância própria [20] |
| **Extrato Geofabrik** | OSM offline | — | Brasil 2,0 GB; Sudeste 823 MB [24] | ODbL |
| **Nominatim** | Geocodificação, não descoberta | 1 req/s; cache obrigatório [23] | Grátis | Proíbe varredura sistemática [23] |
| **CNES (Ministério da Saúde)** | Só saúde; filtro por município, tipo, UF [27] | 20/página | Grátis | MIT na especificação; presença de CNPJ [não verificado] |
| **Casa dos Dados / CNPJ.ws Premium** | Mesma base com filtros | 1.000 / 100 por página | **Pagos** (preço [não verificado]) | — |

## 3. Busca web (D-AI-4)

| Opção | Conta/chave | Grátis | Pode armazenar? |
|---|---|---|---|
| **Ollama Web Search/Fetch** | Conta gratuita + chave [31] | Cota "generosa" sem número [32] [não verificado] | Termos não proíbem [34]; consultas vão para a nuvem |
| **Brave Search API** | Conta + cartão [35] | US$ 5/mês em créditos | **Não** (só transitório) [36] |
| **Tavily** | Conta + chave | 1.000 créditos/mês sem cartão [37] | Termos silenciam; pode treinar modelos com as consultas [38] |
| **Exa** | Conta + chave | US$ 10/mês em créditos [39] | **Risco**: veda copiar o obtido sem permissão [39] |
| **SearXNG próprio** | Nenhuma | AGPL [40] | Depende de raspar buscadores (conflita com termos do Google [41] e a regra 6) |
| **DuckDuckGo** | — | Sem API oficial de busca web [42] | — |
| **Google PSE JSON API** | — | Fechada a novos clientes; fim em 01/01/2027 [43] | — |

## 4. Recomendação

- **CNPJ:** OpenCNPJ como padrão (sem chave, aceita alfanumérico, remove CPF de MEI), com cache por CNPJ e `updated_at`; Minha Receita como reserva (BrasilAPI é a mesma fonte). Médio prazo: o importador local da base da Receita também enriquece por CNPJ.
- **Descoberta:** importar a base da Receita (mensal), processar fora do Supabase (DuckDB no disco D:, KI-017) e carregar só o recorte. Até o importador existir: busca paginada da Minha Receita (ex.: `?uf=SP&municipio=3543402&cnae_fiscal=8630504&limit=100`, que não filtra situação cadastral: descartar inativas do lado do app). Overpass/Geofabrik e CNES como complementos.
- **Busca web:** antes de qualquer buscador, ir direto ao site oficial quando conhecido (tag `website` do OSM, domínio do e-mail). Buscador padrão: Ollama Web Search (gratuito, sem proibição de armazenar), **mas exige conta e chave: decisão do usuário**. Evitar Brave, Exa, SearXNG, DuckDuckGo e Google.
- **No ledger:** URL, título, trecho curto e data como evidência; nunca a página inteira.

## 5. Campos para os adaptadores

**OpenCNPJ** [10]: `updated_at`, `cnpj`, `razao_social`, `nome_fantasia`, `situacao_cadastral` (texto), `data_situacao_cadastral`, `matriz_filial`, `data_inicio_atividade`, `cnae_principal` (7 dígitos, sem descrição), `cnaes_secundarios`, `natureza_juridica`, `capital_social` (texto com vírgula), `porte_empresa`, endereço (`tipo_logradouro`, `logradouro`, `numero`, `complemento`, `bairro`, `cep`, `uf`, `municipio`), contato (`email`, `telefones`), Simples/MEI, `QSA`, `lgpd_anonimizado`. Aninhamento e grafia exatos [não verificado]: confirmar com uma chamada real antes de fechar o contrato Zod.

**Minha Receita / BrasilAPI** [4]: `cnpj`, `razao_social`, `nome_fantasia`, `cnae_fiscal`, `cnae_fiscal_descricao`, `cnaes_secundarios[{codigo, descricao}]`, `situacao_cadastral` (código), `descricao_situacao_cadastral`, `data_situacao_cadastral`, `data_inicio_atividade`, endereço com `codigo_municipio_ibge`, `ddd_telefone_1`, `ddd_telefone_2`, `email`, `identificador_matriz_filial`, `natureza_juridica`, `porte`, `capital_social`, `opcao_pelo_simples`, `opcao_pelo_mei`, `qsa[]`. Busca paginada: `{"data":[...], "cursor":"..."}` [12].

**Base da Receita, Estabelecimentos** (CSV `;`) [16]: `cnpj_basico`, `cnpj_ordem`, `cnpj_dv`, `identificador_matriz_filial`, `nome_fantasia`, `situacao_cadastral` (01 nula, 02 ativa, 03 suspensa, 04 inapta, 08 baixada), `data_situacao_cadastral`, `motivo_situacao_cadastral`, …, `cnae_fiscal_principal`, `cnae_fiscal_secundaria`, endereço, `municipio` (código da tabela `Municipios.zip`, não IBGE [não verificado]: precisa de tabela de correspondência), `ddd1`, `telefone1`, …, `correio_eletronico`. Razão social no arquivo Empresas (`cnpj_basico`). Encoding (ISO-8859-1) e formato de datas [não verificado]; o layout é de 2021 e não trata o CNPJ alfanumérico.

## 6. Riscos

- Overpass público: uso comercial deve ir para instância própria; poucas consultas, com cache.
- ODbL: uso interno não obriga a compartilhar; guardar dados do OSM separados e com fonte.
- Nominatim: só geocodificação pontual.
- BrasilAPI veda crawling; Minha Receita sem garantia e com busca em testes.
- ReceitaWS e CNPJ.ws: uso em benefício próprio (compatível com uso interno); CNPJ.ws até 45 dias atrasada.
- CNPJá: termos não lidos; não adotar sem lê-los.
- Ollama Web Search: consultas vão para a nuvem; **nunca enviar nomes de sócios nem dados pessoais**.
- LGPD: e-mail e telefone de MEI são dados pessoais; o nome empresarial do MEI contém o CPF (descartar); QSA traz nomes de pessoas (minimizar, regra 7). Contatos da base às vezes são do contador [29] [não verificado].
- Licença específica da base CNPJ não confirmada [18]: citar o Decreto 8.777/2016 e registrar a fonte em cada registro [17].

## Fontes (consultadas em 10/11/2026)

[1] gov.br/receitafederal — notícia do primeiro CNPJ alfanumérico (31/07/2026) · [2] developers.receitaws.com.br/receitaws.yaml · [3] receitaws.com.br/terms.pdf · [4] github.com/BrasilAPI/BrasilAPI (pages/docs/doc/cnpj.json) · [5] github.com/BrasilAPI/BrasilAPI (README) · [6] docs.cnpj.ws — limitações da API pública · [7] docs.cnpj.ws — consultando CNPJ · [8] cnpj.ws/pt-BR/termos-de-uso · [9] docs.cnpj.ws — pesquisa de empresas (comercial) · [10] opencnpj.org · [11] github.com/hitmasu/opencnpj · [12] docs.minhareceita.org · [13] github.com/cuducos/minha-receita (arquivado) e codeberg.org/cuducos/minha-receita · [14] cnpja.com/api/open (trecho do buscador) · [15] arquivos.receitafederal.gov.br (listagem pública) · [16] gov.br/receitafederal/dados/cnpj-metadados.pdf · [17] planalto.gov.br — Decreto 8.777/2016 · [18] dados.gov.br — conjunto CNPJ (não carregou) · [19] tabnews.com.br (secundária) · [20] wiki.openstreetmap.org/wiki/Overpass_API · [21] dev.overpass-api.de/overpass-doc · [22] openstreetmap.org/copyright · [23] operations.osmfoundation.org/policies/nominatim · [24] download.geofabrik.de/south-america/brazil.html · [25] taginfo.geofabrik.de/south-america:brazil · [26] wiki.openstreetmap.org — Overpass QL e OSM JSON · [27] apidadosabertos.saude.gov.br/v1 · [28] docs.casadosdados.com.br · [29] tabnews.com.br (secundária) · [30] servicodados.ibge.gov.br (CNAE 8630504, município 3543402) · [31] docs.ollama.com/capabilities/web-search · [32] ollama.com/blog/web-search · [33] ollama.com/pricing · [34] ollama.com/terms · [35] brave.com/search/api · [36] api-dashboard.search.brave.com/terms-of-service · [37] tavily.com/pricing e docs.tavily.com · [38] tavily.com/terms · [39] exa.ai/pricing e exa.ai/terms · [40] docs.searxng.org · [41] policies.google.com/terms · [42] duckduckgo.com/api · [43] developers.google.com/custom-search/v1/overview
