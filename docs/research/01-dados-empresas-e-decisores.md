# 01 — Fontes de dados de empresas brasileiras (descoberta) e de decisores/contatos (enriquecimento)

> Pesquisa técnica de viabilidade de integrações. Data de referência: **2026-11-09**.
> Convenções: `[Fn]` remete à lista de fontes da seção 5 (todas consultadas em 2026-11-09). **[não verificado]** = não confirmado em fonte oficial; o motivo vem logo depois. **[terceiros]** = só confirmado em fonte secundária (blog, agregador, projeto open source). Preços em USD, salvo indicação. Nenhum valor foi convertido para BRL, porque o câmbio não foi verificado.

---

## 1. Tabela-resumo

| Integração | Propósito | Autenticação | Modelo de custo | Limites | Riscos principais | Veredito MVP |
|---|---|---|---|---|---|---|
| **Dados abertos do CNPJ (RFB)** | Base-mestra de descoberta (empresas, estabelecimentos, CNAE, porte, endereço, QSA) | Nenhuma (download público) | Gratuito; o custo é de infra (armazenamento e ETL) | Atualização mensal; cerca de 8 GB zip / 25–27 GB CSV [terceiros] | Caminho de download mudou em 2026; CNPJ alfanumérico desde jul/2026; e-mail e telefone muitas vezes são do contador; QSA tem dado pessoal | **Adotar** (núcleo) |
| BrasilAPI `/cnpj/v1` | Consulta pontual por CNPJ (fallback) | Nenhuma | Gratuito | Limites não documentados [não verificado] | Sem SLA; projeto comunitário | **Avaliar** (fallback) |
| CNPJá (API comercial) | Atualização em tempo real e pesquisa avançada (mais de 50 filtros) | Chave de API | Créditos; plano BASIC 1.000 créditos por R$ 24,99/mês; pesquisa avançada cobra 1 crédito a cada 10 resultados [F16, via trechos de busca] | Limite/min por plano; plano grátis: 50 créditos, 10 req/min [F16] | ToS proíbe recriar serviço concorrente [F16] | **Avaliar** |
| CNPJá / ReceitaWS / CNPJ.ws (APIs públicas) | Lookup gratuito | Nenhuma | Gratuito | 3–5 req/min por IP [F13][F16] | Inviável em escala; bloqueio de IP | **Evitar** em produção |
| CNPJ.ws (comercial, Premium) | Pesquisa por UF, cidade, CNAE, porte e situação | Header `x_api_token` | Assinatura mensal; preços não publicados no material lido [não verificado] | 2.000 req/min; cota mensal [F15]; dados com até 45 dias de atraso [F14] | Defasagem; preço desconhecido | **Avaliar** |
| OpenCNPJ | Lookup por CNPJ (projeto aberto, licença MIT) | Nenhuma | Gratuito | Não documentados [não verificado] | Sem SLA; só consulta por CNPJ | **Avaliar** (fallback) |
| Casa dos Dados | Busca por CNAE/cidade | API oficial não verificada | Não verificado | O endpoint "público" devolve cerca de 20 resultados por filtro [terceiros] | Uso de endpoint não documentado; ToS desconhecido | **Evitar** |
| Econodata / Speedio / Neoway | Bases B2B comerciais (decisores, faturamento estimado) | Token (Neoway: Bearer [F22]) | Sob consulta [F20][F22] | Não verificado | Custo enterprise; ToS de revenda desconhecido | **Avaliar** pós-MVP |
| **Google Places API (New)** | Presença física/digital (site, telefone, nota, avaliações, status) e chave `place_id` | API key (header `X-Goog-Api-Key`) + field mask obrigatório | Por SKU: Text Search Enterprise US$ 35/mil, com 1.000 grátis/mês [F23] | Text Search: máx. 20 por página e 60 no total [F28] | Proíbe copiar e salvar nome, endereço e reviews; só `place_id` é armazenável sem prazo [F27] | **Adotar com restrições** |
| Foursquare Places API | POI alternativo | API key | Pro: US$ 15 CPM depois da faixa grátis [F31] | PAYG: sem cache além de IDs [F35, terceiros/indexado] | Cache muito restrito | **Evitar** no MVP |
| FSQ OS Places (dataset aberto) | POIs com tel, site, e-mail e redes sociais | Token do portal (Iceberg) / Snowflake / HF com aprovação [F34] | Gratuito, Apache 2.0 com atribuição [F32][F34] | Cobertura do Brasil não verificada | Qualidade e cobertura no BR desconhecidas | **Avaliar** |
| OpenStreetMap / Overpass | POIs abertos | Nenhuma | Gratuito (ODbL) | Instância pública: uso comercial deve ser self-hosted ou pago [F37] | Share-alike da ODbL em base derivada [F36]; dados de contato esparsos [não verificado] | **Avaliar** (complemento) |
| Atores de scraping do Google Maps (Apify) | Extração em massa do Google Maps | Token Apify | A partir de US$ 1,50 por mil lugares [F38] | — | Viola os termos do Google; Google processou a SerpApi em dez/2025 [F39] | **Evitar** |
| **QSA da Receita** (nos dados abertos) | Sócios e administradores = decisores em PMEs | — | Gratuito | CPF mascarado (`***XXXXXX**`) [F1][F11] | Dado pessoal: exige base legal (legítimo interesse), transparência e opt-out | **Adotar com salvaguardas** |
| Apollo.io API | Busca de pessoas por cargo, enriquecimento de e-mail, URL do LinkedIn | API key (master key em alguns endpoints) [F45] | Créditos: 1 por pessoa (e-mail), +8 para celular; People Search custa 0 crédito [F44][F45] | 50.000 registros por busca; 100 por página [F45] | ToS proíbe revenda e disponibilização a terceiros [F47]; fontes oficiais divergem sobre quais planos têm API | **Avaliar** (forte candidato) |
| Lusha API | E-mail e telefone de decisores | Header `api_key` [F49] | E-mail = 1 crédito; telefone = 5 créditos; Pro US$ 69,90 por 600 créditos/mês [F48] | 25 req/s por conta [F49] | Proíbe embutir os dados em produto de terceiros sem consentimento [F50] | **Avaliar** (só telefone) |
| **Hunter.io** | Domain Search, Email Finder, Verifier | `api_key` (query, header ou Bearer) [F52] | Growth US$ 149 por 10 mil créditos; Finder = 1 crédito por e-mail encontrado; Verifier = 0,5 crédito [F51] | 15 req/s / 500 req/min (Finder e Domain); 10/s (Verifier) [F52] | Proíbe construir serviço concorrente [F53]; cobertura do BR não documentada | **Adotar** |
| Snov.io API | Alternativa ao Hunter | OAuth client credentials [F55] | Starter US$ 39 por 1.000 créditos; 1 crédito por e-mail/verificação [F54] | 60 req/min [F55] | ToS não verificado | **Avaliar** |
| RocketReach | Contatos | API key [F56] | Preço oficial não verificado [terceiros] | 429 sob carga [F56] | Preço e plano com API divergentes entre fontes | **Evitar** no MVP |
| Cognism | Contatos (foco EMEA) | — | Preço sob consulta [terceiros] | — | Cobertura LATAM limitada, segundo terceiros | **Evitar** no MVP |
| Kaspr | Contatos via extensão LinkedIn | API "sob solicitação" [F58] | €45–79/usuário/mês [F58] | — | Depende do LinkedIn (risco frente ao User Agreement §8.2) | **Evitar** |
| LinkedIn (APIs oficiais) | — | OAuth 2.0 | — | Só Sign-in/Share são self-service; SNAP não aceita novos parceiros [F60][F61] | Scraping proibido [F59]; Proxycurl encerrou após processo [F62] | **Evitar** como fonte de dados |
| **MillionVerifier** | Verificação de e-mail | API key | US$ 89 por 50 mil; US$ 449 por 1 milhão; créditos não expiram [F65] | "Generous rate limits" (sem número) | Política de reembolso de catch-all não está clara | **Adotar** |
| ZeroBounce | Verificação de e-mail | API key | PAYG a partir de US$ 39 por 2.000; Freemium com 100/mês [F63] | — | Mais caro | **Avaliar** |
| NeverBounce | Verificação de e-mail | API key | Cerca de US$ 0,008/e-mail [terceiros; página oficial retornou 403] | — | Preço não verificado | **Avaliar** |

---

## 2. Seções por integração

### A. Descoberta de empresas no Brasil

#### A1. Dados abertos do CNPJ (Receita Federal) — **ADOTAR (núcleo)**

**Onde ficam hoje**
- A página oficial da RFB (`gov.br/receitafederal/.../dados-abertos/cadastros/cnpj`) redireciona (HTTP 302) para o conjunto no Portal de Dados Abertos: `dados.gov.br/dados/conjuntos-dados/cadastro-nacional-da-pessoa-juridica---cnpj` [F2]. O portal é uma SPA e a ferramenta de consulta não conseguiu ler o conteúdo dele.
- Os arquivos ficam no repositório "Arquivos da Receita Federal – SERPRO+" (`https://arquivos.receitafederal.gov.br/`, caminho Dados > Cadastros > CNPJ) [F3][F4]. Segundo projetos open source, o acesso passou a ser por compartilhamento público WebDAV/Nextcloud do SERPRO+ [F5]. Antes disso, os arquivos ficavam em pastas mensais de `dadosabertos.rfb.gov.br/CNPJ/dados_abertos_cnpj/` [F9]. **[parcialmente verificado]**: a URL exata do compartilhamento (token WebDAV) não foi confirmada em fonte oficial, e a mudança de caminho no início de 2026 só aparece em projetos de terceiros [F4][F5]. O script de ingestão precisa descobrir o caminho dinamicamente e tolerar novas mudanças.

**Formato** (layout oficial [F1])
- CSV, separador `;`, "padrão de carga automática em RDBMS" [F1]. Os arquivos grandes (Empresas, Estabelecimentos, Sócios) vêm em cerca de 10 partes zipadas cada [F4]. O encoding e o formato de data não aparecem no layout **[não verificado]**; a prática dos projetos de terceiros é latin-1 e datas `AAAAMMDD`.
- Tabelas:
  - **Empresas**: CNPJ básico (8 primeiros caracteres), razão social, natureza jurídica, qualificação do responsável, **capital social**, **porte** (00 não informado, 01 ME, 03 EPP, 05 demais), ente federativo responsável.
  - **Estabelecimentos**: CNPJ básico, ordem e DV; matriz/filial; nome fantasia; **situação cadastral** (01 nula, 2 ativa, 3 suspensa, 4 inapta, 08 baixada), data e motivo da situação; **data de início de atividade**; **CNAE fiscal principal**; **CNAE secundária** (lista separada por vírgula); endereço completo (tipo de logradouro, logradouro, número ou "S/N", complemento, bairro, CEP, UF, código do município); **DDD 1, telefone 1, DDD 2, telefone 2, fax**; **correio eletrônico**; situação especial.
  - **Simples**: opção pelo Simples e pelo MEI, com datas de opção e exclusão.
  - **Sócios (QSA)**: identificador (1 PJ, 2 PF, 3 estrangeiro), nome, CNPJ/CPF do sócio, qualificação, data de entrada, país, CPF e nome do representante legal, qualificação do representante, **faixa etária** (0–9) [F1].
  - **Domínios**: Países, Municípios, Qualificações, Naturezas Jurídicas, CNAEs, Motivos [F1].
- **CPF mascarado**: o layout manda "descaracterizar" o CPF do sócio e do representante "por meio da ocultação dos três primeiros dígitos e dos dois dígitos verificadores" (LDO 2018, art. 129 §2º) [F1]. Na prática aparece como `***682847**` [F11].
- **Mudança de ago/2026** [terceiros]: no CSV de sócios, a coluna `cnpj_cpf_socio` passou a trazer só o radical (8 dígitos) quando o sócio é empresa [F4].
- **CNPJ alfanumérico**: o primeiro foi gerado em 31/07/2026 (exemplo `00.000.000/E08G-12`), só para novas inscrições. Os CNPJs existentes não mudam [F7]. **Implicação**: armazenar CNPJ como `text` e nunca como número, e revisar a validação do DV. O impacto no layout dos dados abertos não foi documentado pela RFB **[não verificado]**.

**Frequência e volume**
- Atualização mensal [F4][F2, via F4].
- Volume [terceiros]: cerca de 73 milhões de estabelecimentos, dos quais cerca de 28 milhões ativos; 37 zips, quase 8 GB compactados e cerca de 27 GB de CSV [F6]. Outra fonte fala em cerca de 25 GB e "mais de 60 milhões de registros" nas tabelas grandes [F4].

**Licença**
- O campo de licença do conjunto em dados.gov.br não pôde ser lido **[não verificado]**. O rodapé do site da RFB declara CC BY-ND 3.0 para "todo o conteúdo deste site" [F8], o que é um aviso geral do site e não necessariamente a licença do dataset. **Ação**: confirmar a licença no dados.gov.br antes de redistribuir dados a clientes.

**Armadilhas de qualidade** [terceiros, F6]
- O e-mail cadastral muitas vezes é do escritório contábil; um único escritório aparece como contato de 438 CNPJs. Não use o domínio desse e-mail como "site da empresa" sem checar se ele bate com o nome.
- Telefones também podem ser do contador. Use-os como chave de deduplicação **fraca**.
- No MEI/empresário individual (natureza 2135) a razão social contém nome e CPF da pessoa física [F6][F5]. É dado pessoal: recomendo excluir MEI por padrão ou remover o CPF na ingestão.
- A situação cadastral pode levar semanas para refletir uma baixa [terceiros, F19].
- O código de município da RFB é uma tabela própria. A BrasilAPI devolve `codigo_municipio` e `codigo_municipio_ibge` separados [F11], o que indica a necessidade de uma tabela de-para (inferência).

**Ingestão prática em Postgres (Supabase), com recorte por UF/CNAE** (abordagem, sem código)
1. **Worker mensal fora do Supabase** (VM pequena ou container com mais de 60 GB de disco temporário [F4]): descobre a pasta do mês mais recente no repositório da RFB, baixa os zips e confere tamanho e integridade. Edge Functions não são adequadas para esse volume (inferência).
2. **Passada 1, Estabelecimentos**: descompactar em streaming e filtrar por UF ∈ alvo, CNAE principal ou secundário ∈ alvo e situação = 02 (ativa). Gera o conjunto de `cnpj_basico` relevantes.
3. **Passada 2, Empresas, Simples e Sócios**: filtrar pelo conjunto da passada 1 (join por `cnpj_basico`).
4. `COPY` para tabelas de *staging* `UNLOGGED`, depois `INSERT ... ON CONFLICT` nas tabelas finais com `snapshot_mes`. Guardar o diff entre meses: ele gera **sinais comerciais gratuitos** relevantes para uma agência de branding, como empresa recém-aberta (`data_inicio_atividade`), mudança de nome fantasia ou razão social, mudança de endereço, aumento de capital e abertura de filial.
5. Índices: `(uf, cnae_principal, situacao)`; GIN em array de CNAEs secundários; `pg_trgm` em razão social e nome fantasia para casar com Google Places e domínios.
6. **Dimensionamento**: o plano Free do Supabase tem 500 MB, insuficiente. O Pro custa US$ 25/mês com 8 GB incluídos e US$ 0,125/GB extra [F66]. Um recorte por poucas UFs e CNAEs cabe nos 8 GB (estimativa). A base nacional completa com índices provavelmente passa de 30 GB (estimativa a partir de [F4]); nesse caso, avaliar compute Medium ou Large (US$ 60 ou 110/mês) [F66].

---

#### A2. APIs sobre os dados do CNPJ

**BrasilAPI — AVALIAR (fallback)**
- Endpoint `GET https://brasilapi.com.br/api/cnpj/v1/{cnpj}`. Devolve 46 campos, entre eles `cnae_fiscal`, `cnaes_secundarios`, `porte`, `capital_social`, `email`, `ddd_telefone_1`, `regime_tributario` e `qsa[]` com CPF mascarado [F11].
- Projeto MIT, comunitário [F10]. Limites de taxa e SLA não documentados no material lido **[não verificado]**. A fonte de dados que o projeto usa não foi confirmada **[não verificado]**. O projeto Minha Receita, frequentemente citado como base, foi arquivado no GitHub em 04/01/2026 e migrou para o Codeberg [F12].
- Não oferece busca por filtros (só lookup).

**CNPJá — AVALIAR (API comercial); EVITAR a API pública em produção**
- A fonte oficial foi consultada só por trechos indexados, porque o acesso direto retornou HTTP 429 várias vezes [F16].
- API pública: cerca de 5 consultas/min por IP [F16].
- Comercial: chave de API; plano grátis com 50 créditos e 10 req/min; planos mensais de "BASIC 1.000" a R$ 24,99 até "VIP 1.000.000" a R$ 7.799,99. Consultas que vêm do cache não consomem crédito; consultas em tempo real consomem crédito por fonte [F16]. **Pesquisa avançada** de estabelecimentos com mais de 50 filtros (data de abertura, regime tributário, endereço, CNAE etc.) a 1 crédito a cada 10 resultados [F16]. Há divergência no preço de entrada (R$ 19,99 vs R$ 24,99) entre páginas.
- ToS: proíbe usar a API para recriar serviço ou produto concorrente da CNPJá [F16]. Cláusulas sobre armazenamento e revenda não foram lidas na íntegra **[não verificado]**.
- Uso sugerido: atualizar em tempo real situação, Simples e inscrições estaduais de um lead antes da abordagem, e prototipar filtros sem a ETL.

**ReceitaWS — EVITAR (sem fonte oficial)**
- A página de preços não renderizou. O único dado obtido é de terceiros: o plano grátis teria 3 chamadas/min [F17, terceiros] **[não verificado]**.

**CNPJ.ws — EVITAR a pública; AVALIAR a comercial**
- Pública: 3 requisições/min por IP. Ao exceder retorna 429; mais de 360 respostas 429 em 1 hora bloqueiam o IP por 1 hora [F13].
- Comercial: header `x_api_token`; 2.000 req/min mais uma cota mensal; depois da cota, 4 req/min [F15]. **Pesquisa de empresas (só no plano Premium)**: `GET https://comercial.cnpj.ws/v2/pesquisa` com filtros de CNAE (principal, secundária ou ambos), `estado_id` e `cidade_id` (IBGE), porte, situação, faixa de data de abertura, nome do sócio e outros. Paginação por cursor de 1 a 100 itens. Os dados podem ter **até 45 dias de defasagem** em relação à RFB [F14]. Já está preparada para o CNPJ alfanumérico [F15]. Preços não publicados no material lido **[não verificado]**.

**OpenCNPJ — AVALIAR (fallback)**
- Projeto MIT que baixa, processa e publica os dados da RFB a partir do WebDAV do SERPRO+ e serve consultas por CNPJ via Cloudflare Worker. Remove o CPF do MEI (natureza 2135) e permite esvaziar o QSA a pedido (`lgpd.json`) [F5].
- Sem busca por filtros. Limites de taxa e termos não documentados **[não verificado]**; o site [F18] não renderizou.

**Casa dos Dados — EVITAR**
- Não encontrei a documentação oficial da API, nem planos ou termos; `docs.casadosdados.com.br` só tem a introdução [F19].
- Um artigo de terceiros usa `POST https://api.casadosdados.com.br/v5/public/cnpj/pesquisa` com filtros de CNAE, UF, município etc. e relata um teto de cerca de 20 resultados por combinação de filtros, com telefone e e-mail nulos [F19, terceiros]. Usar esse endpoint não documentado em produção traz risco contratual e operacional.

**Bases comerciais B2B — AVALIAR pós-MVP**
- **Econodata**: API REST/JSON com consulta por CNPJ, enriquecimento e servidor MCP; exige plano com API; preço "sob consulta" [F20]. A página oficial retornou 403, então os detalhes vêm do índice de busca.
- **Speedio**: documentação pública com endpoints "Buscar Preview de Leads", "Buscar Leads Enriquecidos por CNPJ" e "Buscar Tomadores de Decisão" [F21]. Preços não publicados **[não verificado]**.
- **Neoway**: API com token Bearer e soluções B2B Intelligence (CNAE, porte, faturamento estimado, funcionários) [F22]. Preço enterprise sob consulta **[não verificado]**.
- Para as três, os termos de armazenamento e revenda não foram verificados. Pedir contrato e DPA antes de integrar.

---

#### A3. Google Places API (New) — **ADOTAR COM RESTRIÇÕES**

**Modelo de preço atual** (vigente desde 01/03/2025)
- O crédito mensal de US$ 200 foi substituído por uma **cota gratuita mensal por SKU**. Os SKUs passaram a ser agrupados em Essentials, Pro e Enterprise. Há descontos por volume até mais de 5 milhões de eventos/mês. A Places API "legada" só tem desconto até 100 mil ou mais [F24].
- Preços por 1.000 eventos [F23]:

| SKU | Grátis/mês | até 100 mil | 100.001–500 mil | 500.001–1 mi | 1–5 mi | 5 mi+ |
|---|---|---|---|---|---|---|
| Text Search Essentials (IDs Only) | Ilimitado | — | — | — | — | — |
| Text Search Pro | 5.000 | 32,00 | 25,60 | 19,20 | 9,60 | 2,40 |
| Text Search Enterprise | 1.000 | 35,00 | 28,00 | 21,00 | 10,50 | 2,63 |
| Text Search Enterprise + Atmosphere | 1.000 | 40,00 | 32,00 | 24,00 | 12,00 | 3,40 |
| Nearby Search Pro / Enterprise / +Atmosphere | 5.000 / 1.000 / 1.000 | 32 / 35 / 40 | — | — | — | — |
| Place Details Essentials | 10.000 | 5,00 | 4,00 | 3,00 | 1,50 | 0,38 |
| Place Details Pro | 5.000 | 17,00 | 13,60 | 10,20 | 5,10 | 1,28 |
| Place Details Enterprise | 1.000 | 20,00 | 16,00 | 12,00 | 6,00 | 1,51 |
| Place Details Enterprise + Atmosphere | 1.000 | 25,00 | 20,00 | 15,00 | 7,50 | 2,28 |

- As faixas somam o uso de todos os projetos da conta de faturamento no mês [F23].

**Field masks e SKU**
- O header `X-Goog-FieldMask` é **obrigatório**; sem ele a chamada dá erro, e `*` é desaconselhado em produção [F28][F29]. A cobrança é feita pelo **SKU mais alto** entre os campos pedidos [F26].
- Mapeamento em Text Search e Nearby Search [F25]:
  - **IDs Only**: `id`, `name` (só na Text Search).
  - **Pro**: `displayName`, `formattedAddress`, `addressComponents`, `location`, `types`, `primaryType`, `businessStatus`, `googleMapsUri`, `photos`.
  - **Enterprise**: `websiteUri`, `nationalPhoneNumber`, `internationalPhoneNumber`, `rating`, `userRatingCount`, `regularOpeningHours`, `priceLevel`.
  - **Enterprise + Atmosphere**: `reviews`, `editorialSummary`.
  - O mapeamento específico de Place Details não foi conferido campo a campo **[não verificado]**.

**Text Search vs Nearby Search**
- Text Search: `pageSize` de 1 a 20; **máximo de 60 resultados somando todas as páginas**; `pageToken` exige parâmetros idênticos; `includedType` aceita um tipo; `locationRestriction` só retangular; `regionCode` e `languageCode` [F28]. Não está documentado se cada página é cobrada como requisição separada **[não verificado]**.
- Nearby Search: `maxResultCount` de 1 a 20, sem paginação documentada; até 50 `includedTypes`; círculo de até 50 km [F29].
- **Consequência**: Places não serve para varrer o mercado em massa (tetos de 20 e 60 resultados). Serve para **verificar a presença** de uma empresa que já veio da base do CNPJ: busca por "nome fantasia + cidade".

**Armazenamento, cache e atribuição** (política oficial [F27])
- `place_id`: "You can store place ID values indefinitely."
- Latitude/longitude: cache de até 30 dias corridos; depois disso, apagar.
- Outros conteúdos: só onde os Service Specific Terms permitirem expressamente. "Don't export, extract, or scrape Google Maps Content for use outside the Services." "Don't copy and save business names, addresses, or user reviews." "Don't create content based on Google Maps Content."
- Atribuição: logo "Google Maps" (ou o texto "Google Maps" sem tradução nem alteração) no mesmo contêiner visual do conteúdo. Fotos e reviews exigem crédito ao autor e link via `googleMapsUri` [F27].
- **Uso fora de mapa Google**: a página de políticas não trata disso diretamente. O texto integral dos Termos (seção 3.2.3) e dos Service Specific Terms não pôde ser lido, porque a página foi truncada [F30] **[não verificado]**.
- **Uso para prospecção/marketing**: não encontrei proibição explícita na página de políticas **[não verificado nos ToS completos]**. A restrição que pesa na prática é a de **não persistir conteúdo**. Uma base de leads montada com nome, telefone ou site vindos do Google viola [F27].

**Desenho compatível com os termos (recomendação)**
- Persistir apenas `place_id` e metadados próprios (data da checagem, score de match). Exibir nota, contagem de avaliações, site e telefone **ao vivo**, com atribuição, quando o usuário abre o lead.
- Guardar sinais derivados (por exemplo, "tem site no GBP" ou "nota < 4") é **zona cinzenta** diante de "Don't create content based on Google Maps Content". Leve a questão ao jurídico (seção 4).
- Custo de verificação por empresa: uma Text Search Enterprise com `pageSize` pequeno sai por US$ 0,035 (1.000 grátis/mês) [F23]. A alternativa em duas etapas (Text Search Pro mais Details Enterprise) custa mais (US$ 0,052).

---

#### A4. Alternativas de POI

**Foursquare Places API — EVITAR no MVP**
- Pro (Search, Details, Autocomplete, Place Match, com campos padrão): US$ 0 até 500 chamadas, US$ 15 CPM de 501 a 100 mil, US$ 12 até 500 mil, US$ 9 acima. Premium (Tips, Photos e campos premium): US$ 18,75 / 15 / 11,25 CPM [F31]. A própria página fala também em "até 10.000 chamadas grátis" em Pro, o que conflita com a faixa de 500 [F31].
- Cache: as diretrizes indexadas dizem que `fsq_id` pode ser guardado sem prazo; nos planos Pay-as-you-go e Sandbox, nenhum outro atributo pode ser cacheado; no Enterprise, só 24 h no dispositivo [F35]. A página retornou 404/redirect na consulta direta **[parcialmente verificado]**. Com isso, a Foursquare fica pior que o Google para o caso de uso.

**FSQ OS Places (dataset aberto) — AVALIAR**
- Licença Apache 2.0 com atribuição obrigatória via NOTICE.txt [F32][F34]. Desde out/2025 o acesso é pelo Places Portal (token, catálogo Iceberg), pelo Snowflake Marketplace ou pelo Hugging Face com aprovação. O S3 público ficou só para releases antigos [F34].
- Esquema com `tel`, `website`, `email`, `facebook_id`, `instagram`, `twitter`, categorias, `date_refreshed` e `date_closed` [F33]. É útil para descobrir site e Instagram sem as restrições de armazenamento do Google.
- Cobertura e atualidade no Brasil não verificadas **[não verificado]**. Ação: fazer um teste de match contra uma amostra de CNPJs de uma capital.

**OpenStreetMap / Overpass — AVALIAR (complemento)**
- ODbL: atribuição obrigatória; quem altera ou constrói sobre os dados só pode distribuir o resultado sob a mesma licença [F36]. Misturar OSM na base de leads pode contaminar a base derivada com share-alike. Mantenha os dados OSM em tabela separada e consulte o jurídico antes de redistribuir.
- Instância pública do Overpass: menos de 10 mil consultas/dia e menos de 1 GB/dia para uso pontual, ou 1/100 disso para uso regular. "Commercial use should use self-hosted or paid Overpass servers." Para volume, a recomendação é extrair um recorte regional (por exemplo, Geofabrik) e filtrar com osmium [F37].
- A cobertura de telefone, site e e-mail no BR não foi verificada **[não verificado]**.

**Scraping do Google Maps via Apify — EVITAR**
- O ator `compass/crawler-google-places` custa "from $1.50 / 1,000 scraped places", com cobrança extra para detalhes, contatos e leads. A própria página avisa que algumas funções devolvem dados pessoais e que o usuário é responsável pela base legal [F38].
- Os Termos do Google proíbem acesso automatizado contra as instruções legíveis por máquina (robots.txt) [F40]. O Google processou a SerpApi em 19/12/2025 por scraping e evasão de proteções (DMCA e ToS) [F39]. A própria política de Places proíbe "scrape Google Maps Content" [F27]. Risco jurídico alto para um SaaS.

---

### B. Decisores e contatos

#### B1. QSA da Receita — **ADOTAR COM SALVAGUARDAS LGPD**
- O QSA vem nos dados abertos com nome, qualificação (sócio-administrador etc.), data de entrada, faixa etária e CPF mascarado [F1]. Em PMEs, o sócio-administrador costuma ser o decisor da contratação de branding (inferência de negócio).
- **Natureza pública e LGPD**:
  - Dado de acesso público deve ser tratado considerando "a finalidade, a boa-fé e o interesse público" que justificaram sua disponibilização (art. 7º §3º).
  - O §4º dispensa consentimento para dados **tornados manifestamente públicos pelo titular**, o que não é exatamente o caso do QSA, publicado pelo Estado.
  - O tratamento posterior para nova finalidade é possível nas condições do §7º [F41].
  - A base legal mais defensável é o **legítimo interesse** (art. 10), com transparência (§2º). A ANPD pode exigir relatório de impacto (§3º) [F41]. O Guia de Legítimo Interesse da ANPD (fev/2024) traz um modelo de teste de balanceamento [F42].
- **Salvaguardas recomendadas**:
  - Registrar o LIA (teste de balanceamento).
  - Minimização: não usar faixa etária para segmentação e não tentar "desmascarar" CPF.
  - Excluir MEI por padrão.
  - Aviso de privacidade (art. 9), canal de opt-out e de direitos (art. 18), lista de supressão global e retenção limitada.
  - Registrar a **fonte** de cada contato.

#### B2. Provedores de contatos B2B

**Apollo.io — AVALIAR (forte candidato para pessoas e cargos)**
- Autenticação por API key. O People API Search exige uma chave com o endpoint habilitado ou uma Master API key (OAuth scope `mixed_people_api_search`) [F45].
- Créditos: **People API Search = 0 crédito**, mas não devolve e-mail nem telefone; o teto é de 50.000 registros por busca, com 100 por página e até 500 páginas. Filtros incluem `person_locations[]`, `organization_locations[]`, `person_seniorities[]` (owner, founder, c_suite...) e `person_titles[]` [F45]. Enriquecimento de pessoa: 1 a 9 créditos (1 para e-mail e dados demográficos, +8 para celular). Organização: 1 crédito [F44].
- **Planos com API: as fontes oficiais divergem.** A página de preços diz "API access is available on Custom plans" [F43]; a landing page da API diz "All plans include API access" [F46]. Preços e preço por crédito não aparecem na página de preços [F43] **[não verificado]**.
- **Termos (atualizados em 10/08/2026)** [F47]:
  - Proibido revender, distribuir ou "make available" a base ou os serviços a terceiros (§3(d)(ii)).
  - Proibido usar Business Contact Information para criar base ou serviço concorrente (§3(e)).
  - Proibido vender ou dar acesso à API a terceiros e usar a API com automações do LinkedIn (§3(g)).
  - Após o término, o cliente pode manter os contatos já incorporados aos próprios registros, sujeitos às restrições do §3(e).
  - A conformidade legal é responsabilidade do cliente (§6(c)). A LGPD não é mencionada.
- Cobertura do Brasil: não há número oficial. Um comparativo de terceiros cita Apollo como forte no BR/MX [F57, terceiros] **[não verificado]**.

**Lusha — AVALIAR (só para telefone, de forma pontual)**
- Preços: Free com 40 créditos/mês; Starter US$ 49,90 por 400/mês; Pro US$ 69,90 por 600/mês; Premium US$ 399,90 por 3.400/mês. **E-mail = 1 crédito, telefone = 5 créditos** [F48].
- API em todos os planos; Free e Starter têm limites estritos e o acesso pleno começa no Pro [F50].
- Auth por header `api_key`; base `https://api.lusha.com/v3/`; 25 req/s por conta [F49].
- **Termos**: os dados obtidos via API ou MCP não podem treinar modelos de IA/ML nem ser **revendidos ou embutidos em produto de terceiros** sem consentimento escrito [F50]. O cliente declara que não é data broker [F50].
- Cobertura: diz cobrir LATAM, com precisão de e-mail declarada de 95%, mas sem número específico do Brasil. LGPD não citada [F50].

**Hunter.io — ADOTAR (e-mail a partir do domínio)**
- Planos [F51]:
  - Free: 50 créditos.
  - Starter: US$ 49/mês por 2.000 créditos.
  - Growth: US$ 149/mês por 10.000.
  - Scale: US$ 299/mês por 25.000.
  - Desconto no plano anual.
- Consumo [F51]: Email Finder cobra 1 crédito por e-mail encontrado (não cobra se não achar). Domain Search cobra 1 crédito por e-mail encontrado (no bulk, 1 crédito por até 10). Verifier cobra 0,5 crédito. Repetir a mesma busca no mesmo período não é cobrado de novo.
- API: `api_key` via query, `X-API-KEY` ou Bearer. Domain Search e Finder: 15 req/s e 500 req/min; Verifier: 10 req/s e 300 req/min. Retorna 451 `claimed_email` quando o titular pediu para não ser processado. Nesse caso o cliente "shouldn't process it yourself in any way" [F52].
- Termos (23/05/2024): proíbe "Build a similar or competitive service"; o uso via produto de terceiros tem de cumprir o contrato; o cliente é controlador dos dados pessoais [F53].
- Cobertura do Brasil não documentada **[não verificado]**. Fazer um piloto com cerca de 200 domínios .com.br.

**Snov.io — AVALIAR (alternativa mais barata)**
- Starter US$ 39 por 1.000 créditos; Pro S US$ 99 por 5.000; Pro M US$ 189 por 20.000; Pro L US$ 369 por 50.000. Busca de e-mail e verificação custam 1 crédito cada. API e webhooks a partir do Starter [F54].
- OAuth client credentials (token de 3.600 s); 60 req/min; Email Finder cobra 1 crédito por e-mail válido ou *unknown* [F55]. ToS não verificado **[não verificado]**.

**RocketReach — EVITAR no MVP**
- A documentação oficial lista API key, "Universal Credits" e respostas 429, mas não traz preços [F56]. Preços e planos com API vêm só de terceiros e divergem entre si [F56, terceiros] **[não verificado]**.

**Cognism — EVITAR no MVP**
- Preço sob consulta; a API seria um add-on de US$ 5–15 mil/ano, segundo terceiros. Foco em EMEA com cobertura LATAM limitada [F57, terceiros] **[não verificado]**.

**Kaspr — EVITAR**
- Free, Starter (€45–59), Business (€79–99) e Enterprise. "Access Kaspr's API ... available only upon request" [F58]. O produto é centrado em extensão para o LinkedIn, o que conflita com a proibição de "browser plugins and add-ons" para scraping [F59]. Cobertura do BR não informada [F58].

#### B3. LinkedIn — **EVITAR como fonte de dados**
- **APIs oficiais**: só são self-service o "Sign in with LinkedIn using OpenID Connect" (perfil e e-mail do próprio usuário autenticado) e o "Share on LinkedIn". Marketing, Sales (SNAP), Talent e Compliance exigem aprovação ou estão fechados [F60].
- **SNAP (Sales Navigator Application Platform)**: "We are not currently accepting new partners for access to the LinkedIn Sales Navigator API". O que existe são Display Services (iframe/SDK), Analytics e CRM Sync. Não há exportação em massa de perfis [F61].
- **User Agreement (vigente desde 03/11/2025), §8.2**: proíbe software, scripts, robôs, crawlers e "browser plugins and add-ons" para "scrape or copy the Services, including profiles"; proíbe bots e métodos automatizados não autorizados; proíbe copiar ou distribuir informação obtida dos Serviços [F59].
- **Proxycurl**: encerrou em 04/07/2025, após processo do LinkedIn movido em jan/2025, "to comply with the legal settlement with LinkedIn" [F62]. Serviços parecidos ("LinkedIn data APIs") carregam o mesmo risco.
- **Uso permitido na plataforma**: guardar a URL do LinkedIn quando ela vier de um provedor contratado (por exemplo, Apollo) ou for colada manualmente pelo usuário, e abrir o perfil no navegador do próprio usuário (ação humana). Não automatizar nada no LinkedIn; os termos da Apollo também vedam isso [F47].

#### B4. Verificação de e-mail
- **MillionVerifier — ADOTAR**: 50 mil por US$ 89 (US$ 0,00178 cada); 1 milhão por US$ 449. "Credits never expire". API REST; reembolso total de e-mails que não consegue verificar com certeza e dos "risky". Catch-all sem custo extra, mas a política de reembolso de catch-all/unknown não está clara [F65].
- **ZeroBounce — AVALIAR**: PAYG a partir de US$ 39 por 2.000; assinatura ZeroBounce ONE a partir de US$ 99/mês com no mínimo 10 mil créditos; Freemium com 100 verificações/mês; várias API keys [F63].
- **NeverBounce — AVALIAR**: cerca de US$ 0,008/verificação em PAYG, créditos expiram em 12 meses [F64, terceiros; página oficial retornou 403] **[não verificado]**.
- Observação: o Email Finder do Hunter já devolve status de verificação, e o Verifier dele custa 0,5 crédito [F51]. No MVP, verificação externa só é necessária para e-mails de outras fontes (CNPJ, site, Apollo).

---

## 3. Recomendação de stack (MVP)

### 3.1 Camada de dados

```
[RFB dados abertos (mensal)] ──ETL──► companies / establishments / partners (Postgres/Supabase)
                                         │  recorte: UFs + CNAEs-alvo + situação ativa, sem MEI
                                         │  diff mensal ► sinais (abertura, mudança de nome/endereço/capital)
                                         ▼
[Google Places (New) Text Search Enterprise] ──► persistir só place_id + match_score + checked_at
                                         │       (conteúdo exibido ao vivo, com atribuição "Google Maps")
                                         ▼
[Descoberta de domínio]  e-mail cadastral (filtrando contadores/provedores) · FSQ OS Places (avaliar) · Apollo org enrichment
                                         ▼
[Decisores]  QSA (sócios-administradores)  +  Apollo People Search (0 crédito) p/ cargos (marketing, CEO)
                                         ▼
[Contato]   Hunter Email Finder (nome + domínio)  →  MillionVerifier p/ e-mails de outras fontes
            Lusha só para telefone, sob demanda e com aprovação humana
                                         ▼
[Gate humano + LGPD]  LIA registrado · supressão/opt-out · fonte de cada dado · retenção
```

- **Fallback de lookup por CNPJ**: BrasilAPI ou OpenCNPJ (grátis, sem SLA) → CNPJá comercial para atualização em tempo real antes do contato.
- **Não usar**: scraping de Google Maps ou LinkedIn, provedores "LinkedIn data API", Casa dos Dados via endpoint não documentado, Kaspr.
- **Se o produto for SaaS multi-tenant**: Apollo [F47], Lusha [F50] e Hunter [F53] restringem disponibilizar dados ou API a terceiros e construir serviços concorrentes. Duas saídas:
  - **BYOK**: cada cliente conecta a própria chave e conta. Ainda não confirmei, com nenhum dos três provedores, se o BYOK é aceito **[não verificado]**.
  - Contrato de parceria ou revenda.
  - Para uso interno da agência, os termos padrão bastam.

### 3.2 Chaves de deduplicação

| Entidade | Chave forte | Chaves auxiliares / observações |
|---|---|---|
| Empresa (grupo) | `cnpj_basico` (8 caracteres, `text`, pode ser alfanumérico desde jul/2026 [F7]) | — |
| Estabelecimento | `cnpj` completo (14 caracteres, `text`) = básico + ordem + DV | `identificador_matriz_filial`; usar a matriz como "conta" |
| Local Google | `place_id` (armazenável sem prazo [F27]) | Revalidar periodicamente; lat/lng no máximo 30 dias [F27] |
| Local Foursquare | `fsq_place_id` / `fsq_id` | — |
| Local OSM | `osm_type` + `osm_id` | Tabela isolada por causa da ODbL [F36] |
| Domínio | eTLD+1 normalizado (minúsculas, sem `www`, respeitando `.com.br` via Public Suffix List) | **Lista de exclusão**: provedores gratuitos (gmail, hotmail, uol, bol etc.) e domínios de escritórios contábeis (detectar o mesmo domínio em mais de N CNPJs) [F6] |
| Telefone | E.164 (`+55` + DDD + número) | **Chave fraca**: o telefone cadastral muitas vezes é do contador [F6]; só confirma match com nome e CEP |
| Pessoa (QSA) | `cnpj_basico` + nome normalizado (sem acentos, maiúsculas) + miolo do CPF mascarado | Não tentar reconstruir o CPF |
| Pessoa (provedores) | e-mail normalizado; URL do LinkedIn normalizada (`/in/slug`) | `apollo_person_id`; registrar a fonte |
| Match CNPJ ↔ Place | Score: similaridade de nome (trigram com nome fantasia ou razão social) + CEP/logradouro + telefone + distância | Persistir só `place_id` e score |

### 3.3 Custo estimado por empresa enriquecida (premissas explícitas)

Cenário base: empresa vinda da base do CNPJ, uma verificação no Google, dois decisores com e-mail.

| Etapa | Fonte | Custo unitário | Por empresa |
|---|---|---|---|
| Descoberta e firmografia | Dados abertos RFB | US$ 0 marginal (infra Supabase Pro US$ 25/mês + US$ 0,125/GB acima de 8 GB [F66]) | ~US$ 0 |
| Presença no Google | Text Search Enterprise (site, telefone, nota) | US$ 35/mil; 1.000 grátis/mês [F23] | US$ 0,035 |
| Decisores (cargos) | Apollo People API Search | 0 crédito [F45] | US$ 0 (exige plano com API; custo do plano não verificado) |
| E-mail de 2 decisores | Hunter Email Finder, plano Growth | US$ 149 / 10.000 = US$ 0,0149 por crédito; cobra só quando acha [F51] | até US$ 0,030 |
| Verificação de e-mails de outras fontes (2) | MillionVerifier, pacote de 50 mil | US$ 0,00178 [F65] | US$ 0,004 |
| Atualização em tempo real antes do contato | CNPJá BASIC | R$ 24,99 / 1.000 créditos [F16]; créditos por fonte não verificados | ~R$ 0,025 ou mais |
| **Total cenário base** | | | **≈ US$ 0,07 + ~R$ 0,03 por empresa** |
| Opcional: 1 telefone direto | Lusha Pro (US$ 69,90 / 600 = US$ 0,1165 por crédito × 5) [F48] | | **+ US$ 0,58** |
| Alternativa ao Hunter | Snov.io Pro S (US$ 99 / 5.000 = US$ 0,0198 por crédito) [F54] | | US$ 0,040 para 2 e-mails |
| Alternativa via Apollo enrichment | 1 crédito por pessoa (e-mail) [F44] | Preço do crédito não publicado [F43] | **[não verificado]** |

- Os custos fixos (assinaturas mensais) ficam de fora. Exemplo: Hunter Growth custa US$ 149/mês mesmo se usar menos.
- Também ficam de fora LLM/IA para análise de marca, crawling do site e envio de e-mail.
- Com 1.000 empresas/mês, a cota grátis do Google cobre a etapa de presença (1.000 Enterprise grátis [F23]).

---

## 4. Lacunas e perguntas abertas

1. **URL atual dos arquivos do CNPJ**: confirmar o caminho e o token do compartilhamento SERPRO+/Nextcloud em `arquivos.receitafederal.gov.br` e o campo de licença do conjunto em dados.gov.br (SPA ilegível pela ferramenta) [F2][F3].
2. **Layout pós-CNPJ alfanumérico**: a RFB não documentou como os CNPJs com letras aparecem nos CSVs [F7]. Confirmar também o encoding e o formato de data do arquivo (não constam do layout [F1]).
3. **Google Maps Platform ToS §3.2.3 e Service Specific Terms**: não foi possível ler o texto integral [F30]. Pontos para o jurídico:
   - É permitido usar `websiteUri` vindo do Places para descobrir o domínio e depois persistir esse domínio, obtido por outras vias?
   - Sinais derivados (nota, "tem GBP") podem ser persistidos?
   - Há restrição para exibir Places fora de mapa Google?
4. **Cobrança por página na Text Search (New)**: cada `pageToken` é cobrado como uma requisição? [F28] não diz.
5. **Apollo**: qual plano libera a API? As fontes oficiais divergem [F43][F46]. Qual o preço por crédito? Qual a cobertura real de decisores em PMEs brasileiras? Sugestão: piloto com 100 CNPJs.
6. **Hunter / Snov / Lusha no Brasil**: nenhuma cobertura documentada para `.com.br`. Medir a taxa de acerto em um piloto.
7. **Multi-tenant e BYOK**: Apollo, Lusha e Hunter aceitam que cada cliente do SaaS use a própria chave dentro da nossa plataforma? Ou exigem acordo de parceiro [F47][F50][F53]?
8. **Preços não publicados**: CNPJ.ws comercial, Econodata, Speedio, Neoway, Cognism, RocketReach e ReceitaWS. Pedir cotação.
9. **CNPJá**: os ToS não puderam ser lidos na íntegra (HTTP 429). Falta confirmar as regras de armazenamento e redistribuição dos dados retornados e o custo em créditos por fonte [F16].
10. **FSQ OS Places**: cobertura e atualidade no Brasil. Fazer um teste de match contra uma amostra de CNPJs [F33][F34].
11. **LGPD**:
    - Validar com o DPO o LIA para tratar QSA e e-mails corporativos nominais em prospecção.
    - Validar o texto do aviso de privacidade e o mecanismo de opt-out (art. 9, 10 §2º, 18 [F41]).
    - Confirmar o que diz a Nota Técnica RFB/Cocad nº 47/2024 sobre sigilo nos dados abertos, citada por terceiros e não lida **[não verificado]**.
12. **Licença dos dados da RFB para redistribuição a clientes do SaaS**: CC BY-ND (rodapé do site [F8]) ou licença aberta do dataset? Ainda não definido.

---

## 5. Fontes (todas consultadas em 2026-11-09)

| # | Fonte | URL | Observação |
|---|---|---|---|
| F1 | RFB — Layout dos Dados Abertos do CNPJ (PDF) | https://www.gov.br/receitafederal/dados/cnpj-metadados.pdf | Oficial; lido na íntegra |
| F2 | Portal de Dados Abertos — conjunto CNPJ | https://dados.gov.br/dados/conjuntos-dados/cadastro-nacional-da-pessoa-juridica---cnpj | Oficial; SPA não renderizada; destino do 302 de https://www.gov.br/receitafederal/pt-br/acesso-a-informacao/dados-abertos/cadastros/cnpj |
| F3 | Arquivos da Receita Federal (SERPRO+) | https://arquivos.receitafederal.gov.br/ | Oficial; só a página inicial foi lida |
| F4 | rictom/cnpj-sqlite (README) | https://github.com/rictom/cnpj-sqlite | Terceiros (volume, mudança de ago/2026 nos sócios) |
| F5 | hitmasu/opencnpj | https://github.com/hitmasu/opencnpj | Terceiros (WebDAV SERPRO+/Nextcloud, LGPD) |
| F6 | TabNews — "Transformei a base aberta do CNPJ (73 milhões...)" | https://www.tabnews.com.br/jeffev/transformei-a-base-aberta-do-cnpj-73-milhoes-de-estabelecimentos-em-buscas-de-segundos-sem-servidor-e-sem-banco-de-dados | Terceiros (volume, e-mail de contador, MEI) |
| F7 | RFB — Primeiro CNPJ alfanumérico (jul/2026) | https://www.gov.br/receitafederal/pt-br/assuntos/noticias/2026/julho/receita-federal-gera-o-primeiro-cnpj-em-formato-alfanumerico | Oficial |
| F8 | RFB — Dados Abertos / Cadastros | https://www.gov.br/receitafederal/pt-br/acesso-a-informacao/dados-abertos/cadastros | Oficial (rodapé CC BY-ND 3.0 do site) |
| F9 | jonathands/dados-abertos-receita-cnpj | https://github.com/jonathands/dados-abertos-receita-cnpj | Terceiros (caminho legado dadosabertos.rfb.gov.br) |
| F10 | BrasilAPI (GitHub) | https://github.com/BrasilAPI/BrasilAPI | Oficial do projeto |
| F11 | BrasilAPI — resposta de exemplo do endpoint CNPJ | https://brasilapi.com.br/api/cnpj/v1/19131243000197 | Chamada pública de leitura |
| F12 | cuducos/minha-receita | https://github.com/cuducos/minha-receita | Arquivado em 04/01/2026 |
| F13 | CNPJ.ws — Limitações da API pública | https://docs.cnpj.ws/referencia-de-api/api-publica/limitacoes | Oficial |
| F14 | CNPJ.ws — Pesquisa de empresas (API comercial) | https://docs.cnpj.ws/en/referencia-de-api/api-comercial/pesquisa-de-empresas | Oficial |
| F15 | CNPJ.ws — llms.txt | https://cnpj.ws/llms.txt | Oficial |
| F16 | CNPJá — planos, API pública/comercial, ToS, FAQ | https://cnpja.com/subscription ; https://cnpja.com/en/pricing ; https://cnpja.com/en/api/open ; https://cnpja.com/en/subscription/tos ; https://cnpja.com/en/subscription/faq | Oficial, mas lido **via trechos de busca** (acesso direto retornou HTTP 429) |
| F17 | ReceitaWS — preços / plugin Bubble | https://receitaws.com.br/pricing ; https://bubble.io/plugin/receitaws-free-plan-1579426636037x605773075952959500 | Página oficial não renderizou; plugin é de terceiros |
| F18 | OpenCNPJ — site | https://opencnpj.org/ | Não renderizou |
| F19 | Casa dos Dados — docs / artigo TabNews | https://docs.casadosdados.com.br/ ; https://www.tabnews.com.br/antoniorincon/prospeccao-b2b-com-dados-publicos-de-cnpj-achar-enriquecer | Docs só com introdução; artigo de terceiros |
| F20 | Econodata — API / B2B Stack | https://www.econodata.com.br/api ; https://www.b2bstack.com.br/compare/leadgenius-vs-econodata | Página oficial retornou 403 (lida via índice de busca) |
| F21 | Speedio — índice da documentação | https://docs.speedio.com.br/llms.txt | Oficial |
| F22 | Neoway — portal do desenvolvedor / B2B Intelligence | https://developer.neoway.com.br/en ; https://www.neoway.com.br/en/solutions/b2b-intelligence | Oficial (via índice de busca) |
| F23 | Google Maps Platform — Pricing | https://developers.google.com/maps/billing-and-pricing/pricing | Oficial |
| F24 | Google Maps Platform — Mudanças de março/2025 | https://developers.google.com/maps/billing-and-pricing/march-2025 | Oficial |
| F25 | Places API (New) — Data fields / SKUs | https://developers.google.com/maps/documentation/places/web-service/data-fields | Oficial |
| F26 | Places API (New) — Usage and billing | https://developers.google.com/maps/documentation/places/web-service/usage-and-billing | Oficial |
| F27 | Places API — Policies and attributions | https://developers.google.com/maps/documentation/places/web-service/policies | Oficial |
| F28 | Places API — Text Search (New) | https://developers.google.com/maps/documentation/places/web-service/text-search | Oficial |
| F29 | Places API — Nearby Search (New) | https://developers.google.com/maps/documentation/places/web-service/nearby-search | Oficial |
| F30 | Google Maps Platform Terms / Service Specific Terms | https://cloud.google.com/maps-platform/terms ; https://cloud.google.com/maps-platform/terms/maps-service-terms | Oficial; **conteúdo truncado, não lido** |
| F31 | Foursquare — Pricing | https://foursquare.com/pricing/ | Oficial |
| F32 | Foursquare — FSQ OS Places (licença) | https://docs.foursquare.com/data-products/docs/fsq-places-open-source | Oficial |
| F33 | Foursquare — Places OS Data Schema | https://docs.foursquare.com/data-products/docs/places-os-data-schema | Oficial |
| F34 | Foursquare — "Evolving FSQ Open Source Places" (08/10/2025) | https://foursquare.com/resources/blog/data/evolving-fsq-open-source-places/ | Oficial |
| F35 | Foursquare — Usage Guidelines (cache, QPS) | https://developer.foursquare.com/docs/usage-guidelines | Oficial, lido via índice de busca (fetch direto: redirect/404) |
| F36 | OpenStreetMap — Copyright and License | https://www.openstreetmap.org/copyright | Oficial |
| F37 | OSM Wiki — Overpass API (política de uso) | https://wiki.openstreetmap.org/wiki/Overpass_API | Oficial (wiki) |
| F38 | Apify — Google Maps Scraper (compass) | https://apify.com/compass/crawler-google-places | Página do fornecedor |
| F39 | Google vs SerpApi (dez/2025) | https://ipwatchdog.com/2025/12/26/google-sues-serpapi-parasitic-scraping-circumvention-protection-measures/ ; https://searchengineland.com/google-sues-serpapi-466541 | Imprensa (via índice de busca) |
| F40 | Google Terms of Service (arquivo 22/05/2024) | https://policies.google.com/terms/archive/20240522 | Oficial, via índice de busca |
| F41 | Lei 13.709/2018 (LGPD) — Planalto | https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm | Oficial |
| F42 | ANPD — Guia de Legítimo Interesse (fev/2024), resumo | https://www.mattosfilho.com.br/unico/anpd-legitimo-interesse-lgpd/ | Secundária; o PDF da ANPD não foi lido |
| F43 | Apollo — Pricing | https://www.apollo.io/pricing | Oficial |
| F44 | Apollo — API pricing (créditos) | https://docs.apollo.io/docs/api-pricing | Oficial |
| F45 | Apollo — People API Search | https://docs.apollo.io/reference/people-api-search.md | Oficial |
| F46 | Apollo — API landing page | https://www.apollo.io/lp/api | Oficial |
| F47 | Apollo — Terms of Service (10/08/2026) | https://www.apollo.io/terms | Oficial |
| F48 | Lusha — Pricing | https://www.lusha.com/pricing/ | Oficial |
| F49 | Lusha — API docs / rate limiting | https://docs.lusha.com/apis/openapi ; https://docs.lusha.com/apis/openapi/section/rate-limiting | Oficial |
| F50 | Lusha — fatos para assistentes de IA (out/2026), FAQ, T&C | https://www.lusha.com/ai-assistants/ ; https://www.lusha.com/faq/ ; https://www.lusha.com/legal/terms_and_conditions-2/ | Oficial (T&C via índice de busca) |
| F51 | Hunter — Pricing | https://hunter.io/pricing | Oficial |
| F52 | Hunter — API v2 docs | https://hunter.io/api-documentation/v2 | Oficial (lidos os primeiros 100 mil caracteres) |
| F53 | Hunter — Terms of Service (23/05/2024) | https://hunter.io/terms-of-service | Oficial |
| F54 | Snov.io — Pricing | https://snov.io/pricing | Oficial |
| F55 | Snov.io — API | https://snov.io/api | Oficial (parcial) |
| F56 | RocketReach — API docs / preços (terceiros) | https://docs.rocketreach.co/ ; https://prospeo.io/s/rocketreach-pricing | Docs oficiais sem preço; preço só em terceiros |
| F57 | Cognism — preços/cobertura (terceiros) | https://www.zeliq.com/blog/cognism-pricing ; https://syncgtm.com/blog/best-b2b-database-latin-america | Terceiros (concorrentes) |
| F58 | Kaspr — Pricing | https://www.kaspr.io/pricing | Oficial |
| F59 | LinkedIn — User Agreement (03/11/2025) | https://www.linkedin.com/legal/user-agreement | Oficial |
| F60 | LinkedIn — Getting Access to LinkedIn APIs | https://learn.microsoft.com/en-us/linkedin/shared/authentication/getting-access | Oficial |
| F61 | LinkedIn — Sales Navigator Application Platform | https://learn.microsoft.com/en-us/linkedin/sales/ | Oficial |
| F62 | Proxycurl — "Goodbye Proxycurl" (04/07/2025) / Social Media Today | https://nubela.co/blog/goodbye-proxycurl/ ; https://www.socialmediatoday.com/news/linkedin-wins-legal-case-data-scrapers-proxycurl/756101/ | Oficial do fundador / imprensa |
| F63 | ZeroBounce — Pricing | https://www.zerobounce.net/email-validation-pricing | Oficial |
| F64 | NeverBounce — Pricing (403) / terceiros | https://neverbounce.com/pricing ; https://www.activepieces.com/blog/neverbounce-pricing-in-2026-credits-plans-costs | Página oficial inacessível |
| F65 | MillionVerifier — site | https://www.millionverifier.com/ | Oficial |
| F66 | Supabase — Pricing | https://supabase.com/pricing | Oficial |
