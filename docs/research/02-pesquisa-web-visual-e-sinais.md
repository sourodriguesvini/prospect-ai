# 02 — Pesquisa web para agentes, auditoria visual de marca e fontes de sinais comerciais

> Pesquisa técnica de viabilidade de integrações. Não contém código.
> Data de consulta de todas as fontes: **2026-11-09**. Preços em **USD**, salvo indicação. Converta pelo câmbio do dia.
> Convenções: `[não verificado]` = não confirmado em fonte oficial nesta pesquisa (o motivo vem ao lado). `[secundária]` = número tirado de blog, agregador ou fórum, sem confirmação oficial. Os códigos entre colchetes (ex.: [A1]) remetem à seção 5, onde estão as URLs.
> Infraestrutura (Supabase, Vercel, filas, workers) está no doc `04-infraestrutura-e-execucao.md`. Aqui ela só aparece quando afeta a captura de páginas e screenshots.

---

## Resumo executivo

1. **Busca e leitura para os agentes:** use as ferramentas nativas da Claude API como base. `web_search` custa US$ 10 por 1.000 buscas mais tokens e sempre devolve citações. `web_fetch` não cobra nada além dos tokens, respeita robots.txt e não renderiza JavaScript [A1][A2]. Para descoberta em volume ou crawl de sites, complemente com **Firecrawl** (scrape, crawl, `branding` e screenshot) [A21][A23]. Para buscas baratas em massa, Brave ou Serper. Exa e Tavily ficam para avaliação comparativa em português.
2. **Auditoria visual:** no MVP, compre screenshots de um serviço (**ScreenshotOne** ou ApiFlash), que já bloqueiam banners de cookies e anúncios [B6][B8]. Evite rodar Chromium dentro de Vercel Functions: o limite padrão é 250 MB, a duração vai até 300 s no Hobby e 800 s no Pro, e o plano Hobby proíbe uso comercial [B1][B2]. Some a isso o **PageSpeed Insights** (gratuito; cota oficial não confirmada), o **Instagram Business Discovery** (por uma conta profissional da própria agência, com Standard Access e sem App Review [B23]), o **Logo.dev** para ativos de marca (permite armazenar o retorno [B17]) e o **Wayback CDX** para o histórico visual [B31].
3. **Sinais comerciais:** são viáveis e baratos o dump de CNPJ da Receita, o GDELT (notícias), o Google Places (nota e número de avaliações), o crt.sh (novos certificados e sites) e páginas públicas de carreira (Gupy etc.). Ficam inviáveis ou caros: API do LinkedIn Jobs (não aceita novos parceiros [C4]), Crunchbase (só com licença enterprise [C20]), API do Reclame Aqui (nenhuma API pública encontrada), Meta Ad Library para anúncios comerciais no Brasil (fora da UE, a API só devolve anúncios políticos ou de temas sociais [B28]) e TikTok Commercial Content API (só UE [B30]).
4. **Custo estimado por empresa** (detalhe na seção 3.3): triagem ≈ US$ 0,01–0,03; investigação profunda com auditoria visual ≈ US$ 0,77 (Sonnet 5.5) a US$ 1,27 (Opus 5.5); análise de 3 concorrentes ≈ US$ 0,66. O dossiê completo fica em ≈ **US$ 1,5–2,0 por empresa**, sem contar assinaturas fixas.
5. **Maiores riscos:** termos que **proíbem armazenar resultados** (Brave [A14], reviews e dados do Google Places [C17], Logo API da Brandfetch [B16]). Isso obriga a guardar como evidência só URL, data, trecho citado e a análise própria, nunca o dado bruto do fornecedor. Além disso: proibição de scraping no Instagram [B26], disputa judicial Google × SerpApi sobre raspagem de SERP [A20] e cláusula ambígua de "uso comercial" no Firecrawl [A22].

---

## 1. Tabela-resumo

Legenda do veredito: **Adotar** = entra no MVP · **Avaliar** = fazer prova de conceito ou benchmark antes · **Evitar** = fora do MVP (custo, termos ou inviabilidade).

| Integração | Propósito | Autenticação | Modelo de custo | Limites | Riscos | Veredito MVP |
|---|---|---|---|---|---|---|
| Claude `web_search` [A1] | Busca com citações dentro do agente | Chave da Claude API | US$ 10/1.000 buscas + tokens dos resultados | `max_uses` por turno; domínios permitidos/bloqueados; `user_location` | Citações obrigatórias ao exibir saída ao usuário final; filtragem dinâmica não é elegível para ZDR | **Adotar** |
| Claude `web_fetch` [A2] | Ler página ou PDF citado | Chave da Claude API | Só tokens (sem taxa) | Só busca URLs que já apareceram no contexto; sem JavaScript; URL ≤ 250 caracteres; respeita robots.txt | Cache pode devolver conteúdo antigo (`use_cache:false` contorna); risco de exfiltração com entrada não confiável | **Adotar** |
| Claude Vision [A4] | Auditoria visual de screenshots, posts e materiais | Chave da Claude API | Tokens: ⌈l/28⌉×⌈a/28⌉ por imagem | 600 imagens/req (100 em modelos de 200k); 10 MB/imagem; 8000×8000 px; req ≤ 128 MB | Downscale para lado longo de 2.576 px (Claude 4.7+): screenshot de página inteira perde legibilidade | **Adotar** |
| Exa [A5][A6] | Busca semântica e descoberta de empresas similares | API key | Search US$ 4–7/1k; contents US$ 1/1k páginas; deep US$ 12–15/1k | US$ 10 grátis/mês; QPS não publicado (Enterprise 25 QPS) | Termos dão à Exa licença perpétua sobre input e output; ZDR só no Enterprise; qualidade em PT sem benchmark | **Avaliar** |
| Tavily [A8][A9][A11] | Busca e extração para agentes | API key | US$ 0,008/crédito; busca básica = 1 crédito | 1.000 créditos grátis/mês; 100 RPM (dev) / 1.000 RPM (prod) | Termos limitam a "internal business purposes"; aquisição pela Nebius anunciada [A12] | **Avaliar** |
| Brave Search API [A13][A14] | Busca barata, índice independente | API key | US$ 5/1k (Search); Answers US$ 4/1k + tokens | 50 QPS (Search); US$ 5 de crédito/mês | **ToS proíbe armazenar, fazer cache ou montar base com os resultados** (só armazenamento transitório) | **Avaliar** (só descoberta) |
| Serper [A16][A17] | SERP do Google (web, news, maps, places) | API key | US$ 1,00/1k → US$ 0,30/1k em pacote | 2.500 consultas grátis; 50–300 QPS; créditos valem 6 meses | Raspagem do Google; não afiliado ao Google; contexto do processo Google × SerpApi | **Avaliar** |
| SerpApi [A18][A19] | SERP, Google Jobs, Maps Reviews | API key | US$ 25/mês (1k buscas) a US$ 150/mês (15k) | 250 buscas grátis/mês; throughput por hora; cache gratuito | Processo Google × SerpApi em andamento [A20]; "Legal Shield" só a partir do Production | **Avaliar** (Jobs/Reviews) |
| Firecrawl [A21][A22][A23] | Scrape, crawl, JSON, `branding`, screenshot | API key | Standard US$ 99/mês = 100k créditos (1 crédito/página; JSON +4) | Free: 1.000 créditos, 10 req/min; Standard: 25 concorrentes, 500 req/min | ToS 5.d.1 veta "commercial purposes except as expressly authorized"; cache padrão de 2 dias cobra crédito; política de robots.txt não documentada | **Adotar** (esclarecer termos) |
| Jina Reader [A25][A26] | URL → markdown; screenshot ou pageshot | Opcional (sem chave: 20 RPM) | Tokens (10M grátis por chave nova); preço dos pacotes não visível | Reader: 500 RPM (free/paid), 5.000 (premium); Search: 100 RPM | Agora parte da Elastic [A27]; não contorna anti-bot | **Avaliar** (alternativa barata) |
| Playwright/Chromium em Vercel Functions [B1][B3] | Screenshots próprios | — | CPU ativa + memória (Pro) | 250 MB por bundle (5 GB em beta); 300 s (Hobby), 800 s (Pro); 2–4 GB de RAM; 4,5 MB de payload | Hobby proíbe uso comercial [B2]; cold start; manutenção do binário | **Evitar** no MVP |
| Browserless [B4] | Navegador remoto (CDP), screenshot/PDF | API token | US$ 25/mês por 20k unidades (1 unidade = até 30 s) | 2–100 navegadores concorrentes conforme o plano | Oferece resolução de CAPTCHA: **não usar** (burla anti-bot) | **Avaliar** (fase 2) |
| Browserbase [B5] | Navegador remoto gerenciado | API key | US$ 20/mês (100 h); excedente US$ 0,10–0,12/h | Free: 1 h, sessões de 15 min | Custo de proxy à parte (US$ 10–12/GB) | **Avaliar** (fase 2) |
| ScreenshotOne [B6] | Screenshot por API | Access key | US$ 17 (2k) / US$ 79 (10k) / US$ 259 (50k) por mês | 40–150 req/min; 100 grátis/mês | Dependência de fornecedor | **Adotar** |
| Urlbox [B7] | Screenshot por API | API key | US$ 19 (2k) a US$ 99 (15k) por mês | 30–250 req/min | Mais caro por imagem | **Avaliar** |
| ApiFlash [B8] | Screenshot por API | Access key | US$ 7 (1k) / US$ 35 (10k) / US$ 180 (100k) por mês | Rate limit não publicado | Excedente não publicado | **Avaliar** (mais barato) |
| PageSpeed Insights API [B9][B10] | Lighthouse + CrUX (performance, acessibilidade, boas práticas, SEO) | API key (recomendada) | Gratuito `[não verificado em página de preço]` | 25.000/dia e 400/100 s `[secundária]` [B11] | Cota oficial não confirmada | **Adotar** |
| Wappalyzer API [B12] | Detectar tecnologias do site | API key | Pro US$ 250/mês; Business US$ 450; Enterprise US$ 850+ | 50 buscas grátis/mês; créditos vencem em 60 dias | Créditos por plano não confirmados (tabela ilegível) | **Avaliar** |
| BuiltWith API [B13][B14] | Tecnologia, histórico, listas | API key | Planos US$ 295–995/mês; preço por consulta não publicado | Free API e MCP com 1 req/s | Caro para MVP | **Evitar** no MVP |
| Brandfetch [B15][B16] | Logo, cores e fontes da marca | Client ID / API key | Brand API: 100 grátis (uma vez); US$ 129/mês por 2.500; excedente US$ 0,10 | Logo API: free com quota (1M na página de preço; 500k na doc) | Logo API exige hotlink, sem cache; Brand API com cache de 30 dias; não pode sublicenciar | **Avaliar** |
| Logo.dev [B17] | Logo por CDN + Brand API (cores, redes) | Token | Free: 500k req de CDN + US$ 5 de créditos/mês; Brand API US$ 0,05/req | CDN com limite rígido no free | Atribuição obrigatória no free para uso comercial | **Adotar** |
| Clearbit Logo API [B18] | — | — | — | Desligada em 8/12/2025 | Morta | **Evitar** |
| Instagram Business Discovery [B19]–[B24] | Bio, seguidores, posts e mídia de contas profissionais | Token de usuário (Facebook Login) da conta profissional da agência | Gratuito | Platform Rate Limit: 200 × usuários/hora; sem contas com restrição de idade | Exige conta profissional + Página; vira Tech Provider (com App Review) se atender outras empresas | **Adotar** |
| Instagram Basic Display API [B25] | — | — | — | Encerrada em 4/12/2024 | Morta | **Evitar** |
| Scraping do Instagram [B26] | — | — | — | — | Termos proíbem coleta automatizada sem permissão expressa | **Evitar** |
| Facebook Pages (PPCA) [B27] | Ler posts de Páginas públicas de terceiros | App + App Review + verificação da empresa | Gratuito | Uso permitido: "analisar e/ou exibir publicações" | Aprovação incerta; contratos adicionais | **Evitar** no MVP |
| Meta Ad Library API [B28] | Anúncios de concorrentes | Token + verificação de identidade `[secundária]` | Gratuito | Fora da UE, só anúncios sociais, eleitorais ou políticos | **Não cobre anúncios comerciais no Brasil** | **Evitar** (link manual) |
| Google Ads Transparency Center [B29] | Anúncios Google de concorrentes | — | — | Sem API oficial; dataset BigQuery cobre EEE + Turquia `[secundária]` | Scraping de terceiros fora dos termos | **Evitar** (link manual) |
| TikTok Commercial Content API [B30] | Anúncios no TikTok | Conta dev + candidatura | Gratuito | Só dados da UE nesta fase | Não cobre o Brasil | **Evitar** |
| Wayback Machine CDX [B31][B32] | Histórico de capturas e detecção de rebranding | Nenhuma | Gratuito | Limite não publicado; ~24 req/min na prática `[secundária]` | 429 e bloqueios por volume; termos do archive.org `[não verificado]` | **Adotar** (com throttle) |
| Gupy (páginas de carreira) [C1][C3] | Vagas publicadas = sinal de crescimento | Público (portal); API oficial só para clientes `[não verificado]` | Gratuito | Portal sem API documentada; endpoints não oficiais | Endpoints podem mudar; termos do portal não localizados | **Avaliar** |
| LinkedIn Jobs [C4] | Vagas | Programa de parceiros | — | Não aceita novos parceiros; API é de publicação, não de busca | Scraping fora dos termos | **Evitar** |
| Indeed [C5] | Vagas | — | — | API de busca (Publisher) aposentada `[secundária]` | — | **Evitar** |
| Google Jobs via SerpApi [A29] | Vagas agregadas (gl=br) | API key SerpApi | Conforme plano SerpApi | Idem SerpApi | Idem SerpApi | **Avaliar** |
| GDELT DOC 2.0 [C6] | Notícias globais com filtro de país e idioma | Nenhuma | Gratuito | Últimos 3 meses; até 250 artigos por chamada; ~1 req/5 s `[secundária]` | Recebemos HTTP 429 no teste; qualidade em PT não medida | **Adotar** |
| Google News RSS [C8] | Notícias | Nenhuma | Gratuito | Endpoint não documentado | Termos: "personal use (i.e., non-commercial use)" e proibição de robôs | **Evitar** |
| NewsAPI.org [C9] | Notícias | API key | Dev grátis só em desenvolvimento; Business US$ 449/mês | Dev: 100 req/dia, atraso de 24 h | Plano grátis proíbe produção | **Evitar** |
| NewsData.io [C10] | Notícias (com filtro BR/PT `[não verificado]`) | API key | Free: 200 créditos/dia; pagos a partir de US$ 199,99/mês `[secundária]` | Free: atraso de 12 h, só 48 h de histórico | Uso comercial no free não declarado | **Avaliar** |
| Mediastack [C11] | Notícias | API key | Free (100 chamadas/mês, não comercial); US$ 24,99 (10k) | 13 idiomas (PT `[não verificado]`) | Cobertura BR incerta | **Evitar** |
| Receita Federal: dados abertos CNPJ [C12][C13] | Base de empresas, CNAE, situação, sócios | Nenhuma | Gratuito | Download em lote; periodicidade mensal `[secundária]` | Layout e caminho mudaram em jan/2026; CNPJ alfanumérico desde 31/7/2026; LGPD (sócios) | **Adotar** |
| crt.sh (Certificate Transparency) [C14] | Novos domínios e subdomínios com HTTPS | Nenhuma | Gratuito | 5 req/min por IP; 5 conexões no Postgres | Frequentemente sobrecarregado; sem SLA | **Avaliar** |
| registro.br RDAP/WHOIS [C15] | Titular e datas de domínio .br | Nenhuma | Gratuito | Rate limit existe, sem número publicado | Não há feed de domínios novos | **Avaliar** (consulta pontual) |
| Google Places API (New) [C16]–[C18] | Nota, nº de avaliações, até 5 reviews, site e telefone | API key (GCP) | Details Enterprise US$ 20/1k; + Atmosphere US$ 25/1k; 1.000 grátis/mês por SKU | Máx. 5 reviews | **Proíbe armazenar** reviews, nomes e endereços (só place ID) | **Adotar** (sem armazenar) |
| Reclame Aqui [C19] | Reputação de consumo | — | — | Nenhuma API pública para consultar terceiros | Scraping fora dos termos `[não verificado]` | **Evitar** (link manual / parceria) |
| Crunchbase API [C20] | Rodadas de investimento | Chave REST com licença | Só sob contrato (US$ 30–70k+/ano `[secundária]`) | 200 req/min e 3 concorrentes por chave | Proíbe repassar dados a terceiros; atribuição com link | **Evitar** |
| Fontes BR de investimento (Sling Hub, CVM) [C21][C22] | Rodadas e eventos de companhias | — | Sling Hub por assinatura; CVM grátis | Sling Hub: API não encontrada | — | **Avaliar** (CVM para S.A. abertas) |
| Querido Diário [C23] | Diários oficiais municipais (licitações, contratos) | `[não verificado]` | `[não verificado]` | Página da API devolveu HTTP 520 | — | **Avaliar** |
| Visualping [C24] | Monitorar mudanças em sites | API (todos os planos) | Business 20K US$ 140/mês (20.000 checagens) | Até a cada 2 min | Custo por checagem alto em escala | **Avaliar** |
| changedetection.io (self-host) [C25] | Monitorar mudanças, com screenshot e API | Própria | Apache-2.0 (gratuito) ou hospedado US$ 8,99/mês | Infra própria | Operar o serviço | **Adotar** (ou diff próprio) |
| Diff próprio (hash + screenshot) | Monitoramento integrado ao Supabase | — | Custo de fetch/screenshot | — | Esforço de desenvolvimento | **Adotar** (fase 1 simples) |

---

## 2. Seções por integração

### A. Busca e extração web para agentes

#### A.1 Claude API: `web_search` (ferramenta de servidor) [A1][A3]
- **Versões:** `web_search_20250305` (básica), `web_search_20260209` (filtragem dinâmica: Claude escreve código que filtra os resultados antes de entrarem no contexto) e `web_search_20260318` (acrescenta `response_inclusion`). A filtragem dinâmica exige Claude 4.6 ou posterior. A execução de código que ela usa sai sem custo extra além dos tokens [A1][A3].
- **Preço:** "**$10 USD per 1,000 searches**, plus standard token costs". Os resultados contam como tokens de entrada no turno e nos turnos seguintes. Busca que falha não é cobrada [A1].
- **Parâmetros:** `max_uses`; `allowed_domains` **ou** `blocked_domains` (os dois juntos dão erro 400); `user_location` com `country` em ISO 3166-1 alfa-2. Código não suportado devolve 400, e **não confirmamos se `BR` é aceito** `[não verificado — testar]` [A1].
- **Citações:** sempre ativas. Cada citação traz `url`, `title`, `encrypted_index` e `cited_text` (até 150 caracteres), e esses campos não contam como tokens. Os resultados trazem `encrypted_content`, que precisa voltar intacto nos turnos seguintes [A1].
- **Exigência de exibição:** "When displaying API outputs directly to end users, citations must be included to the original source" [A1]. Isso combina com a camada de validação de evidências (seção 3).
- **Limites operacionais:** erros vêm dentro de uma resposta 200 (`too_many_requests`, `max_uses_exceeded`, `query_too_long`, `request_too_large`, `unavailable`). O Batch API aceita a ferramenta com o mesmo preço, mas com throttling por organização [A1].
- **Dados:** elegível para ZDR, exceto a filtragem dinâmica, que não é elegível para ZDR nem HIPAA [A1].
- **Veredito:** **Adotar** como motor da investigação profunda. A rastreabilidade das citações vale o preço maior que o de Brave ou Serper.

#### A.2 Claude API: `web_fetch` [A2]
- **Preço:** "no additional cost". Paga só os tokens do conteúdo. Referências: página média de 10 kB ≈ 2.500 tokens; PDF de 500 kB ≈ 125.000 tokens. Use `max_content_tokens` para limitar [A2].
- **Restrições importantes:**
  - Só busca URLs que **já apareceram na conversa**: mensagens do usuário, resultados de ferramentas do cliente ou resultados anteriores de `web_search`/`web_fetch`. URLs que aparecem só na saída do próprio Claude ou só no system prompt são recusadas (`url_not_in_prior_context`) [A2].
  - **Não renderiza JavaScript**. Para isso, a doc indica a *browser use tool* (ferramenta de cliente) [A2][B33].
  - Retorna `url_not_allowed` para endereços privados, **robots.txt** e URLs com credenciais. Ou seja, respeita robots.txt [A2].
  - Só texto, HTML e PDF (`unsupported_content_type` para o resto). URL de até 250 caracteres [A2].
  - Tem cache: versões a partir de `web_fetch_20260309` aceitam `use_cache:false` [A2].
- **Citações:** opcionais (`citations.enabled`), com a mesma recomendação de exibição [A2].
- **Segurança:** a doc alerta para risco de exfiltração quando há entrada não confiável junto de dados sensíveis. `allowed_domains` e `url_sources` mitigam [A2].
- **Veredito:** **Adotar** para ler páginas institucionais, cases e PDFs. Para sites montados em SPA, use Firecrawl, Jina ou um serviço de screenshot.

#### A.3 Exa [A5][A6][A7]
- **Preço (pay-as-you-go):** `/search` lite e instant US$ 4/1k; auto e fast US$ 7/1k (até 10 resultados); `/contents` US$ 1/1k páginas por tipo de conteúdo; `/answer` US$ 5/1k; deep US$ 12–15/1k; resultados acima de 10 a US$ 1/1k. US$ 10 de crédito grátis por mês. Enterprise anual de US$ 12.000 com ZDR e 25 QPS [A5].
- **PT-BR:** desde 5/11/2025 a Exa "detects your query language and returns results only in that language" [A7]. Não há benchmark público de qualidade em português (busca sem resultado relevante).
- **Termos (PDF em exa.ai/terms):** o cliente concede à Exa licença "nonexclusive, royalty-free … perpetual and irrevocable" para usar User Input e Output a fim de melhorar os serviços. Proíbe revender ou sublicenciar sem consentimento e usar os serviços para "develop any competitive product". Não encontramos proibição explícita de armazenar resultados [A6].
- **Risco:** as consultas sobre prospects vão para a Exa sob licença perpétua. Só o Enterprise tem ZDR.
- **Veredito:** **Avaliar** para descoberta semântica ("empresas parecidas com X em SP"). Rodar benchmark próprio em PT.

#### A.4 Tavily [A8]–[A12]
- **Preço:** 1.000 créditos grátis/mês; pay-as-you-go a US$ 0,008/crédito; Project a US$ 30/mês por 4.000 créditos [A8]. Custos por chamada [A9]: busca básica 1 crédito, avançada 2; extract 1 crédito por 5 URLs (2 no modo avançado); map 1 crédito por 10 páginas; research de 4 a 250 créditos.
- **Limites:** 100 RPM com chave de desenvolvimento e 1.000 RPM com chave de produção (search/extract); crawl a 100 RPM [A10].
- **Termos:** uso restrito a "Customer's internal business purposes". Proíbe construir produto concorrente. A Tavily tem licença ampla sobre Input e Output (seção 9.2) [A11].
- **Corporativo:** a Nebius anunciou acordo para adquirir a Tavily em 10/2/2026; a marca continua [A12].
- **PT-BR:** nenhuma evidência encontrada.
- **Veredito:** **Avaliar**. É prático (search + extract num lugar só), mas vale confirmar se "internal business purposes" cobre um SaaS.

#### A.5 Brave Search API [A13][A14][A15]
- **Preço:** Search US$ 5/1k requisições, 50 QPS. Answers US$ 4/1k mais US$ 5 por milhão de tokens, 2 QPS. US$ 5 de crédito grátis por mês por plano. A página também fala em "Up to $20 in free calls" (inconsistência da própria página) [A13].
- **Termos (críticos):** §3(b)(i) proíbe "store, cache, or create a database of Search Results, in whole or in part", exceto o armazenamento transitório necessário. §3(b)(xiii) proíbe usar os resultados para treinar ou avaliar modelos. Direitos de armazenamento só existem em plano que os inclua, sem nome nem preço publicados [A13][A14].
- **PT-BR:** `search_lang=pt-br` aparece na tabela oficial de códigos [A15]. `country=BR` só em fonte de terceiros `[não verificado]`.
- **Veredito:** **Avaliar** só para descoberta (gerar URLs candidatas). **Não guardar** resultados brutos. A evidência passa a ser a página buscada depois.

#### A.6 Serper [A16][A17]
- **Preço:** 2.500 consultas grátis. Pacotes: Starter US$ 50 por 50k (US$ 1,00/1k, 50 QPS), Standard US$ 375 por 500k (US$ 0,75/1k), Scale US$ 1.250 por 2,5M (US$ 0,50/1k), Ultimate US$ 3.750 por 12,5M (US$ 0,30/1k, 300 QPS). Créditos valem 6 meses [A16].
- **Endpoints:** Search, Images, News, Maps, Places, Videos, Shopping, Scholar, Patents, Autocomplete [A16].
- **Termos:** serviço B2B; proíbe "Mirror the materials on any other server as-is"; "Serper is not affiliated with or endorsed by Google" [A17].
- **Risco jurídico do segmento:** o Google processou a SerpApi em 19/12/2025 com base na DMCA. Em 20/7/2026 a ação foi extinta com possibilidade de emenda, e há relatos de complaint emendada [A20] `[secundária]`. O Serper não é parte, mas faz a mesma atividade.
- **Veredito:** **Avaliar**. É o mais barato para SERP e Maps. Usar com moderação e sem depender dele em funções críticas.

#### A.7 SerpApi [A18][A19][A29]
- **Preço:** Free com 250 buscas/mês; Starter US$ 25 (1k); Developer US$ 75 (5k); Production US$ 150 (15k); Big Data US$ 275 (30k). Buscas em cache, com erro ou que falham não são cobradas [A18].
- **US Legal Shield:** cobertura de até US$ 2 milhões a partir do Production, só para a coleta (não para o uso que se faz dos dados) e só nos EUA [A19].
- **Retenção:** dados de busca guardados por 31 dias; o modo ZeroTrace evita o armazenamento [A19].
- **Útil aqui:** `engine=google_jobs` com `gl` de país (há exemplo com `gl=br`) e `engine=google_maps_reviews`, que pagina todas as reviews por `next_page_token` [A29]. Isso supera o limite de 5 reviews da API oficial, mas raspa o Google.
- **Veredito:** **Avaliar** para Jobs e Reviews. O processo do Google é o maior risco [A20].

#### A.8 Firecrawl [A21]–[A24]
- **Planos:** Free com 1.000 créditos e 10 req/min; Hobby US$ 19 (5k); **Standard US$ 99 (100k, 25 concorrentes, 500 req/min)**; Growth US$ 399 (500k); Scale US$ 749 (1M). Créditos não acumulam, exceto no Scale [A21].
- **Custos:** scrape ou crawl = 1 crédito por página; JSON = +4 créditos por página; search = 2 créditos por 10 resultados; map = 1 crédito [A21]. Custo de `screenshot` e `branding` **não publicado** `[não verificado]`. Um comparativo da Brandfetch (concorrente) diz 1 crédito.
- **Formatos:** markdown, HTML, screenshot (URL expira em 24 h), links, JSON, imagens e **`branding`**, que extrai cores, fontes, tipografia, espaçamento e estilos de componentes, com versão 2 do logo [A23][A24]. É muito útil para a auditoria de identidade visual.
- **Cache:** `maxAge` padrão de 2 dias, e resultado em cache também cobra 1 crédito [A23].
- **Termos:** 5.d.1 proíbe "Use the Services for any commercial purposes except as expressly authorized by Firecrawl" (supõe-se que o plano pago autoriza, **confirmar por escrito**). A 8.d dá ao Firecrawl licença irrevogável sobre o conteúdo enviado. O usuário assume os riscos sobre conteúdo de terceiros. Os termos não falam de robots.txt [A22].
- **Veredito:** **Adotar** no MVP para crawl de sites (home, sobre, serviços, cases) e `branding`. Pedir confirmação de uso comercial e do custo por formato.

#### A.9 Jina Reader [A25]–[A28]
- **Cobrança:** por tokens de saída no Reader; a Search custa a partir de 10.000 tokens por requisição; chave nova vem com 10M de tokens grátis; falhas não são cobradas [A25]. Preço dos pacotes não visível na página `[não verificado]` [A26].
- **Limites:** Reader com 20 RPM sem chave, 500 RPM com chave gratuita ou paga e 5.000 RPM no premium. Search com 100 RPM (free/paid) e 1.000 RPM (premium) [A26].
- **Recursos:** cache de 5 min (`X-No-Cache` para pular); `X-Robots-Txt` para checar robots; screenshot e pageshot (página inteira) pelo cabeçalho `X-Return-Format` [A25][A28].
- **Corporativo:** a Elastic concluiu a aquisição da Jina AI (anúncio de 9/10/2025) [A27].
- **Veredito:** **Avaliar** como alternativa barata ao Firecrawl para HTML → markdown e para screenshots simples.

### B. Auditoria visual de marca

#### B.1 Playwright/Chromium em Vercel × serviços de navegador e screenshot
- **Limites do Vercel Functions** [B1]: bundle de **250 MB** descompactado ("Large functions" em beta vai até 5 GB e fica habilitado por padrão em projetos novos); duração de **300 s no Hobby** e **800 s no Pro** (1.800 s em beta); memória de 2 GB no Hobby e 4 GB no Pro; payload de 4,5 MB; 1.024 descritores de arquivo compartilhados. A própria doc cita "Puppeteer with its bundled Chromium" como causa típica de função grande. O guia oficial do Vercel usa `puppeteer-core` com `@sparticuz/chromium-min` [B3].
- **Uso comercial:** "Hobby teams are restricted to non-commercial personal use only" [B2]. O SaaS precisa do plano Pro ou superior.
- **Conclusão:** é tecnicamente possível, mas frágil (versões do Chromium, cold start, memória). **No MVP, terceirize screenshots.** Na fase 2, se o volume justificar, rode Playwright num worker dedicado (ver doc 04).
- **Comparativo de serviços** (custo por imagem no plano indicado):

| Serviço | Plano | Preço/mês | Volume | Custo por imagem | Destaques | Fonte |
|---|---|---|---|---|---|---|
| ScreenshotOne | Growth | US$ 79 | 10.000 | ≈ US$ 0,0079 | Bloqueia anúncios e banners de cookies, página inteira, upload para S3, cache, "stealth" (todos os planos); 80 req/min | [B6] |
| ApiFlash | Medium | US$ 35 | 10.000 | ≈ US$ 0,0035 | Página inteira, mobile, bloqueio de anúncios e banners de cookies, S3 | [B8] |
| Urlbox | Hi-Fi | US$ 49 | 5.000 | ≈ US$ 0,0098 | Cache de 30 dias em render links; S3 próprio | [B7] |
| Browserless | Prototyping | US$ 25 | 20.000 unidades (30 s cada) | ≈ US$ 0,00125 por unidade | Navegador completo (CDP); proxy cobrado em unidades | [B4] |
| Browserbase | Developer | US$ 20 | 100 h | US$ 0,20/h | Sessões gerenciadas; excedente US$ 0,12/h | [B5] |

- **Atenção:** Browserless anuncia "automatic CAPTCHA solving" [B4]. **Não use** esse recurso: burlar CAPTCHA ou anti-bot viola termos de sites e as regras deste projeto.
- **Veredito:** **Adotar ScreenshotOne** (ou ApiFlash, se o custo pesar). Browserless e Browserbase ficam para fluxos interativos na fase 2.

#### B.2 PageSpeed Insights API / Lighthouse [B9][B10][B11]
- Devolve dados de laboratório do Lighthouse nas categorias Performance, Accessibility, Best Practices e SEO, e dados de campo do CrUX (atualizados diariamente no PSI) [B10].
- A chave de API é anexada como `key=`. A página de início rápido não declara cota nem preço [B9]. Fontes secundárias citam **25.000 consultas/dia e 400 a cada 100 s** por projeto `[secundária]` [B11].
- Se a resposta traz o screenshot final (`final-screenshot`) é `[não verificado]`.
- **Veredito:** **Adotar**. Indicadores objetivos ("site lento e com acessibilidade ruim") reforçam o argumento comercial de redesign.

#### B.3 Detecção de tecnologia
- **Wappalyzer** [B12]: Free com 50 buscas e 50 verificações de e-mail por mês; Pro US$ 250/mês; Business US$ 450; Enterprise US$ 850+. Créditos de plano vencem em 60 dias (pacotes avulsos, em 365). Normalmente 1 crédito por site. Os créditos de API por plano (aparentemente 5.000, 20.000 e 200.000+) estão ilegíveis na tabela `[não verificado]`. **Status:** API comercial ativa. **Avaliar.** Para o MVP, uma heurística própria sobre o HTML (meta generator, scripts conhecidos) pode bastar.
- **BuiltWith** [B13][B14]: planos de US$ 295, 495 e 995 por mês. A página de APIs lista Domain, Lists, Relationships, Trends e Free API (MCP gratuito a 1 req/s), sem preço por consulta. **Evitar** no MVP.

#### B.4 Ativos de marca
- **Brandfetch** [B15][B16]: Brand API com 100 consultas grátis (uma única vez), Starter a US$ 129/mês (ou US$ 99 no anual) por 2.500 e excedente de US$ 0,10. "Brand API responses can be cached for 30 days". Logo API gratuita, mas a doc pede **hotlink**, não cache ("contact us for a custom setup"), e sublicenciar exige acordo. Há divergência de quota: 1M renders na página de preço contra 500k na doc. **Avaliar.**
- **Logo.dev** [B17]: Community (grátis) com 500k requisições de CDN e US$ 5 de créditos/mês; Startup US$ 33; Pro US$ 150. **Brand API a US$ 0,05 por requisição** (nome, logos, cores, redes sociais), e repetir a mesma marca é grátis por 24 h. **Permite armazenar** tudo o que a API devolve, em qualquer plano. Atribuição só é exigida no plano gratuito para uso comercial. **Adotar.**
- **Clearbit Logo API** [B18]: desligada. O changelog da HubSpot marca 8/12/2025 (há fontes que citam 1/12). **Evitar.**
- **Firecrawl `branding`** [A23][A24]: extrai cores e fontes direto do CSS do site. Complementa o Logo.dev e é mais fiel à identidade aplicada no site.

#### B.5 Instagram [B19]–[B26]
- **Business Discovery** (Instagram API with Facebook Login): consulta outra conta profissional pelo `username` a partir da conta profissional **do próprio app user** [B19].
  - **Permissões:** `instagram_basic`, `instagram_manage_insights` e `pages_read_engagement`. Se o papel na Página veio do Business Manager, também `ads_management` ou `ads_read` [B20].
  - **App Review:** a doc de App Review diz que, para "My app is only for a business I own or manage", basta **Standard Access, sem App Review**. Para "Tech Provider" que atende várias empresas, é preciso Advanced Access **com** App Review [B23]. Com uma única agência usando a própria conta, App Review não é necessário. Num SaaS multiagência, passa a ser.
  - **Campos públicos:** de IG User, `biography`, `followers_count`, `media_count`, `username`, `website`, `id` e `alt_text` [B21]. De IG Media, `caption`, `comments_count`, `media_type`, `media_product_type`, **`media_url`**, `permalink`, `timestamp`, `thumbnail_url`, `view_count` e `total_like_count`, entre outros [B22]. **Inconsistência:** os exemplos de Business Discovery mostram `like_count` [B19], mas a referência de IG Media não o marca como Public [B22]. `profile_picture_url` não aparece como Public `[testar]`.
  - **Limitações:** não devolve contas com restrição de idade. `media_url` é omitido em vídeos com áudio licenciado e em reels com download desativado. GET direto na mídia devolvida falha [B19][B20].
  - **Rate limit:** Business Discovery segue os Platform Rate Limits: "Calls within one hour = 200 * Number of Users" (usuários ativos diários do app) [B24]. Com 1–3 usuários, isso dá ≈ 200–600 chamadas/hora: suficiente para o MVP, mas é um teto real.
  - **Uso na auditoria:** `media_url` dos últimos N posts → Claude Vision avalia consistência de grid, paleta e tipografia. Termos da Meta sobre retenção de Platform Data `[não verificado]` (revisar antes de guardar mídia).
- **Basic Display API:** encerrada em **4/12/2024**. A URL antiga da doc oficial hoje redireciona para a visão geral da Instagram Platform [B25].
- **Scraping:** os termos do Instagram proíbem "collecting information in an automated way without our express permission" [B26] (texto obtido de resultado de busca, porque a página não renderizou no fetch). **Evitar** scrapers (Apify etc.).
- **Facebook Pages públicas:** o recurso *Page Public Content Access* exige App Review **e** verificação da empresa, pode exigir contratos adicionais e lista como uso permitido apenas "analisar e/ou exibir publicações e interações nas Páginas" [B27]. **Evitar** no MVP. *Page Public Metadata Access* é a alternativa mais leve (não detalhada aqui).

#### B.6 Bibliotecas de anúncios
- **Meta Ad Library API (`ads_archive`)** [B28]: `ad_type=ALL` existe, mas a doc diz: "**Ads that did not reach any location in the EU will only return if they are about social issues, elections or politics.**" Para anúncios comerciais veiculados só no Brasil, a API **não devolve nada**. A exigência de verificação de identidade (facebook.com/ID) vem de fontes secundárias. **Evitar.** Alternativa: gerar o link da Ad Library web para o usuário abrir manualmente.
- **Google Ads Transparency Center:** **não existe API oficial** (nenhuma encontrada). O dataset público no BigQuery (`google_ads_transparency_center`) cobre o EEE e a Turquia, segundo a descrição citada no fórum do Google Cloud, onde também há relato de acesso negado `[secundária]` [B29]. Os scrapers de terceiros (Apify, SerpApi) raspam o site. **Evitar** (link manual).
- **TikTok Commercial Content API** [B30]: "will include ads data from EU to begin with". Nesta fase só traz dados da UE e não menciona o Brasil. **Evitar.**

#### B.7 Wayback Machine (CDX) [B31][B32]
- **Endpoint:** `web.archive.org/cdx/search/cdx`, com `url`, `matchType`, `from`/`to`, `filter`, `collapse` (por exemplo `collapse=timestamp:6` dá uma captura por mês), `limit`, `output=json` e `fl`; paginação por `page`/`showNumPages` (página de 50) e `resumeKey` [B31].
- **Rate limit:** o README não publica nenhum [B31]. A biblioteca Python `wayback` reduziu o padrão para **24 req/min** "to match the actual hard limits" (release de 2026) `[secundária]` [B32]. Há relatos de 429 e bloqueios por volume.
- **Uso:** listar capturas por mês da home → renderizar 3 a 4 marcos históricos (URL `web.archive.org/web/<timestamp>/<url>`) no serviço de screenshot → Claude compara logo, paleta e layout. Isso **detecta rebranding** recente (sinal de que a empresa já investiu ou de que a marca está datada).
- **Termos do archive.org:** a página não renderizou no fetch `[não verificado]`. Use com throttle (≤ 1 req/3 s), cache local dos índices CDX e User-Agent identificado.
- **Veredito:** **Adotar.**

#### B.8 Limites de imagem para visão na Claude API [A4]
- **Quantidade:** **600 imagens por requisição na API** (100 em modelos com contexto de 200k tokens); 20 por mensagem no claude.ai [A4].
- **Tamanho:** **8000×8000 px** no máximo. Acima de 20 imagens numa requisição vale um limite mais estrito por imagem; a doc recomenda manter cada lado ≤ **3.000 px** ou ficar em ≤ 20 imagens [A4].
- **Peso:** **10 MB por imagem** (base64) na Claude API; requisição total ≤ **128 MB**. O Files API (`file_id`) evita reenviar base64 a cada turno [A4].
- **Formatos:** JPEG, PNG, GIF (só o primeiro quadro) e WebP [A4].
- **Custo em tokens:** ⌈largura/28⌉ × ⌈altura/28⌉. Modelos **Claude 4.7+** (tier alta resolução) usam lado longo de **2.576 px** e até **4.784 tokens visuais**; os demais modelos, 1.568 px e 1.568 tokens. Exemplo: 1920×1080 ≈ 2.691 tokens no tier alta resolução [A4].
- **Implicação de design:** screenshot de página inteira (por exemplo 1440×9000) é reduzido e o texto fica ilegível. **Fatie em blocos do tamanho da viewport** (por exemplo 1440×900 ≈ 1.716 tokens cada) e mande só os blocos relevantes (hero, menu, rodapé, seções de produto).

### C. Sinais comerciais

#### C.1 Vagas
- **Gupy** [C1][C2][C3]: a API oficial (`https://api.gupy.io/api/v2`, com operação `/jobs`) é documentada no portal de desenvolvedores [C1]. Autenticação e escopo não aparecem na página consultada; a expectativa é que seja só para empresas clientes `[não verificado]`. As vagas ficam públicas no portal e nas páginas de carreira (`<empresa>.gupy.io`). Atores do Apify descrevem uma "public portal API" sem login, com paginação de 50 a 100 itens `[secundária]` [C3]. Os termos para candidatos (versão de 20/3/2024) não trazem cláusula explícita sobre coleta automatizada [C2], mas os termos de uso do portal para visitantes não foram localizados `[não verificado]`. **Avaliar:** ler a página de carreira da empresa (pública, baixo volume) como sinal ("abriu vaga de designer ou marketing" e "expansão de equipe").
- **LinkedIn Jobs** [C4]: "We are currently not accepting new partnerships for LinkedIn's Job Posting API". A API é de **publicação** de vagas por ATS, não de busca. **Evitar.**
- **Indeed** [C5]: a API pública de busca (Publisher) foi aposentada (2023 ou 2024, conforme a fonte) `[secundária]`. As APIs atuais (Sponsored Jobs, Job Sync) atendem empregadores e ATS. **Evitar.**
- **Outras fontes BR:** Google Jobs via SerpApi (`gl=br`) [A29] agrega Gupy, Vagas, Catho e InfoJobs pelo Google, com o risco SerpApi. Outras plataformas de carreira (Solides/Kenoby, Recrutei, Inhire) não foram pesquisadas `[não verificado]`.

#### C.2 Notícias
- **GDELT DOC 2.0** [C6]: gratuito; busca na janela móvel dos **últimos 3 meses**; `maxrecords` até 250; filtros `sourcecountry:` (código FIPS ou nome) e `sourcelang:`, que cobre "All 65 machine translated languages" (o post não lista PT explicitamente). Modos `ArtList`, `TimelineVol` e `ToneChart`; saída em JSON e RSS. **Teste em 2026-11-09:** uma consulta com `sourcecountry:BR` voltou vazia e a seguinte levou **HTTP 429**. Fontes secundárias citam 1 req a cada 5 s. **Adotar**, com fila, throttle e benchmark de cobertura PT.
- **Google News RSS** [C8]: os termos do Google News (última atualização em 17/1/2006, ainda no ar) dizem "You may only display the content of the Service for your own personal use (i.e., non-commercial use)" e proíbem "any robot, spider…". O endpoint RSS de busca não tem documentação. **Evitar.**
- **NewsAPI.org** [C9]: o Developer é grátis, mas "for development and testing in a development environment only", com 100 req/dia, atraso de 24 h e artigos de até 1 mês. Business sai por US$ 449/mês (250k requisições). **Evitar.**
- **NewsData.io** [C10]: Free com 200 créditos/dia (1–10 artigos por crédito), atraso de 12 h e 48 h de histórico. Os preços dos planos pagos não renderizaram na página oficial; o blog do fornecedor cita Basic a US$ 199,99/mês (20k créditos) `[secundária]`. O uso comercial no plano grátis não é declarado. **Avaliar.**
- **Mediastack** [C11]: Free com 100 chamadas/mês, **uso não comercial** e dados com atraso; Standard US$ 24,99 (10k); 13 idiomas sem citar PT. **Evitar.**

#### C.3 Novas empresas e alterações cadastrais
- **Dados abertos do CNPJ (Receita Federal)** [C12][C13]: tabelas de Empresas, Estabelecimentos, Sócios e Simples, mais as auxiliares (CNAE, natureza jurídica). Ficam no repositório de dados abertos da RFB (`gov.br/receitafederal/dados`) e catalogadas no dados.gov.br. A periodicidade mensal só foi confirmada em fontes secundárias (uma delas fala em trimestral) `[não verificado — páginas oficiais não renderizaram no fetch]`. Um projeto open source registra que "ao final de janeiro/2026, a RFB alterou o layout da página e caminho dos arquivos" [C12]. O **CNPJ alfanumérico** começou a ser implantado em 31/7/2026 [C13], então o schema precisa aceitar 14 caracteres alfanuméricos. A tabela de Sócios tem **dados pessoais**: tratar com base legal e minimização (LGPD [C26]).
  - **Uso:** diff mensal entre dumps → empresas novas por CNAE e município, mudança de razão social ou nome fantasia, troca de endereço e alteração de capital. Todos são gatilhos de "nova marca", "reposicionamento" ou "expansão".
- **Certificate Transparency (crt.sh)** [C14]: segundo um representante da Sectigo (fórum oficial, 9/6/2023), "The current per-IP address rate limit is 5 requests per minute", com 5 conexões simultâneas no Postgres público. O serviço vive sobrecarregado. Uso: detectar novos subdomínios e sites (`loja.`, `novo.`, domínio novo) de empresas monitoradas. **Avaliar.** Em escala, considerar ler logs de CT direto (certspotter `[não verificado]`).
- **registro.br** [C15]: oferece RDAP público (`rdap.registro.br`) e WHOIS que "só aceita consultas diretas". Há rate limit, mas nenhum número publicado foi encontrado. **Não foi encontrado nenhum feed ou lista pública de domínios .br recém-registrados.** **Avaliar** só para consulta pontual (domínio → titular e datas). Para descobrir domínios novos, o caminho é o CT log.

#### C.4 Reputação
- **Google Places API (New)** [C16][C17][C18]:
  - `rating` e `userRatingCount` disparam o SKU **Place Details Enterprise** (US$ 20/1k, 1.000 grátis/mês). `reviews` e `reviewSummary` disparam **Enterprise + Atmosphere** (US$ 25/1k, 1.000 grátis/mês). **Máximo de 5 reviews** por lugar [C16][C18].
  - Text Search Pro custa US$ 32/1k (5.000 grátis); Enterprise, US$ 35/1k [C18].
  - **Política:** "You can therefore store place ID values indefinitely". Lat/long podem ficar em cache por até 30 dias. "Don't pre-fetch, index, store, or redistribute Google Maps Content" e não "copy and save business names, addresses, or user reviews". Exibir reviews exige atribuição do autor e link para o Google Maps [C17].
  - **Implicação:** guardar só `place_id` e métricas derivadas da análise (por exemplo "nota abaixo de 4,0, tendência negativa"), sem salvar texto de review. Para tendência histórica, guardar só o que a política permite `[revisar com jurídico se nota e contagem são "Content"]`.
  - **Adotar.**
- **Reclame Aqui** [C19]: em 2017 a empresa anunciou que abriria uma API. Hoje as integrações oficiais encontradas (Zendesk, Zoho, Salesforce) servem para a **própria empresa** atender suas reclamações. **Nenhuma API pública para consultar a reputação de terceiros foi encontrada.** Os scrapers do Apify são não oficiais. **Evitar** no MVP: gerar link para consulta manual ou negociar parceria B2B.

#### C.5 Investimentos e eventos
- **Crunchbase** [C20]: acesso REST só com chave provisionada por licença. Os pacotes são Fundamentals, Insights e Predictions. Limite de **200 req/min e 3 requisições simultâneas** por chave. Sem licença específica, proíbe "license, sublicense, sell, offer to sell, distribute" os dados a terceiros e exige link de atribuição visível e sem `nofollow`. Preço só sob contrato: estimativas de US$ 30–70k+/ano e fim do Basic gratuito em 2025 `[secundária]`. **Evitar.**
- **Fontes brasileiras:** a Sling Hub ("o Crunchbase brasileiro") vende por contratos anuais e não teve API encontrada [C21]. O portal de dados abertos da CVM tem datasets de companhias (documentos IPE, recompra, ofertas e crowdfunding planejados para 2026) [C22], útil para S.A. abertas. O Querido Diário (diários oficiais municipais: contratos e licitações) devolveu HTTP 520 na consulta `[não verificado]` [C23]. Notícias via GDELT cobrem rodadas divulgadas na imprensa.

#### C.6 Monitoramento de mudanças em sites
- **Visualping** [C24]: "REST API and MCP server access come with every plan, including the free one", e a API consome a quota de checagens. Business 20K custa US$ 140/mês por 20.000 checagens (≈ US$ 0,007 por checagem), com frequência de até 2 min. **Avaliar.**
- **changedetection.io** [C25]: Apache-2.0, roda em Docker; Visual Selector e browser steps (com Playwright), screenshot na notificação, REST API completa, webhooks e notificações via apprise. A versão hospedada custa US$ 8,99/mês. **Adotar** se a equipe topar operar um container (ver doc 04).
- **Diff próprio:** guardar hash do texto normalizado, título, meta tags e lista de links, e um screenshot semanal (com comparação de pixels em biblioteca open source). Isso é suficiente para sinais de marca: nova logo, nova paleta, novo site, nova página de "trabalhe conosco". Custa só o fetch e o screenshot. **Adotar** no MVP pela simplicidade e integração com o Supabase.

---

## 3. Stack recomendada em camadas

### 3.1 Visão geral

| # | Camada | Objetivo | Ferramenta principal (MVP) | Alternativa / fase 2 | O que persistir como evidência |
|---|---|---|---|---|---|
| 1 | **Descoberta** | Gerar a lista de empresas candidatas | Dump CNPJ da Receita (filtro por CNAE e UF) [C12] + Google Places Text Search para negócios locais [C18] | Exa (busca semântica) [A5]; Brave/Serper [A13][A16]; crt.sh para sites novos [C14] | CNPJ, `place_id`, URL do site, fonte e data. Nunca o resultado bruto da Brave [A14] |
| 2 | **Verificação** | Confirmar a identidade (CNPJ ↔ domínio ↔ Instagram ↔ Places) | `web_fetch` do site (rodapé com CNPJ) [A2]; RDAP registro.br [C15]; Instagram BD pelo `username` encontrado no site [B19] | Haiku 5.5 para fazer o match difuso | Tabela de vínculos com `confidence`, URL de prova e `retrieved_at` |
| 3 | **Enriquecimento** | Métricas objetivas e baratas | PSI [B9]; Places Details Enterprise (nota e contagem) [C16]; Logo.dev Brand API [B17]; Firecrawl `branding` [A23]; Instagram BD (seguidores, frequência de posts) | Wappalyzer [B12]; Brandfetch [B15] | Scores PSI, seguidores, data do último post, paleta e fontes extraídas (dados próprios derivados) |
| 4 | **Investigação profunda** | Narrativa: momento da empresa, posicionamento, dores | Claude `web_search` + `web_fetch` com citações [A1][A2] (Sonnet 5.5; Opus 5.5 para leads de alto valor) | Exa deep, Tavily research | `cited_text`, URL, título e data por afirmação. Citações exibidas ao usuário [A1] |
| 5 | **Visual** | Auditoria da identidade aplicada | ScreenshotOne (desktop e mobile, banners bloqueados) [B6] → blocos de viewport → Claude Vision [A4]; mídia do Instagram via `media_url` [B22]; Wayback CDX para histórico [B31] | Playwright em worker dedicado; Jina pageshot [A28] | Screenshots próprios (bucket privado) com hash e data; checklist de auditoria (coerência, legibilidade, contraste, consistência entre canais) |
| 6 | **Competitivo** | Comparar com 3 concorrentes | Mesma pipeline das camadas 3 e 5 em versão enxuta; descoberta de concorrentes via `web_search` e Places Nearby/Text | Exa (similaridade) | Matriz comparativa com as fontes |
| 7 | **Validação de evidências** | Bloquear alucinação e afirmação sem fonte | Regra "toda afirmação factual exige `source_url` + `retrieved_at` + `cited_text` ou screenshot"; segunda passada com Haiku 5.5 checando afirmação × trecho citado | Amostragem humana | Status de validação por afirmação (`ok`, `fraca`, `sem fonte`) |
| 8 | **Monitoramento** | Detectar gatilhos ao longo do tempo | Diff próprio semanal (hash + screenshot); diff mensal do CNPJ; GDELT diário por nome e marca [C6]; página de carreira; crt.sh | changedetection.io [C25]; Visualping [C24] | Eventos (`tipo`, `antes/depois`, URL e data) → alertas no CRM |

### 3.2 Regras transversais (derivadas dos termos)
1. **Separar "dado do fornecedor" de "evidência própria".** Guardar URL, data, trecho curto citado (`cited_text` ≤ 150 caracteres [A1]) e a análise do agente. **Não** guardar resultados brutos da Brave [A14], reviews ou nomes de empresas vindos do Places [C17] nem logos da Brandfetch Logo API [B16]. O Logo.dev permite armazenar [B17].
2. **Respeitar robots.txt e não burlar anti-bot.** `web_fetch` já respeita robots [A2]. Nenhum recurso de resolução de CAPTCHA (Browserless) deve ser ativado [B4]. Sem scraping de Instagram, LinkedIn ou Reclame Aqui [B26][C4].
3. **Citações visíveis ao usuário final** sempre que a saída do Claude com `web_search` for exibida [A1].
4. **Throttle por fonte** (fila com controle de taxa): crt.sh 5/min [C14]; Wayback ≤ 24/min [B32]; GDELT ~1/5 s [C6]; Instagram 200 × usuários/hora [B24].
5. **Jobs longos fora de request HTTP:** investigação profunda passa fácil de 300 s. Use execução durável (ver doc 04; o Vercel recomenda Workflows para execução sem limite [B1]).
6. **LGPD:** os dados de sócios (dump CNPJ) e qualquer dado de pessoa física exigem base legal (legítimo interesse documentado), minimização e retenção definida [C26].

### 3.3 Estimativa de custo por empresa investigada

Premissas: preços unitários das fontes citadas; Claude Sonnet 5.5 a US$ 2/MTok de entrada e US$ 10/MTok de saída; Opus 5.5 a US$ 4/US$ 20; Haiku 5.5 a US$ 0,10/US$ 0,50 (prompts ≤ 100k) [A3]. Os volumes de tokens são **estimativas de projeto**, a calibrar no piloto. Batch API dá 50% de desconto nos tokens [A3].

**Nível 1: triagem (todas as candidatas)**

| Item | Qtde | Preço unitário | Custo |
|---|---|---|---|
| Busca (Brave Search) [A13] | 2 | US$ 0,005 | US$ 0,010 |
| Scrape da home (Firecrawl Standard, US$ 99/100k) [A21] | 2 créditos | US$ 0,00099 | US$ 0,002 |
| PSI [B9] | 1 | US$ 0 | US$ 0 |
| Places Details Enterprise (nota e contagem) [C18] | 1 | US$ 0,020 (após 1.000 grátis/mês) | US$ 0,020 |
| Classificação com Haiku 5.5 (15k entrada / 1k saída) [A3] | — | — | US$ 0,002 |
| **Total** | | | **≈ US$ 0,01 (sem Places) a US$ 0,03** |

**Nível 2: investigação profunda + auditoria visual (leads qualificados)**

| Item | Qtde | Preço unitário | Custo |
|---|---|---|---|
| Claude `web_search` [A1] | 10 | US$ 0,01 | US$ 0,100 |
| Tokens Sonnet 5.5 (≈ 200k entrada com buscas, fetches e ~10 imagens; 10k saída) [A3][A4] | — | US$ 2 / US$ 10 por MTok | US$ 0,500 |
| Screenshots (3 páginas × desktop e mobile) ScreenshotOne Growth [B6] | 6 | US$ 0,0079 | US$ 0,047 |
| Brand API (Logo.dev) [B17] | 1 | US$ 0,05 | US$ 0,050 |
| Wayback: CDX grátis + 3 screenshots históricos [B31][B6] | 3 | US$ 0,0079 | US$ 0,024 |
| Tecnologia (Wappalyzer Pro, ≈ US$ 250/5.000 créditos) `[estimado]` [B12] | 1 | ≈ US$ 0,05 | US$ 0,050 |
| Instagram BD, PSI, GDELT | — | US$ 0 | US$ 0 |
| **Total Sonnet 5.5** | | | **≈ US$ 0,77** |
| **Total Opus 5.5** (tokens: US$ 0,80 + US$ 0,20) | | | **≈ US$ 1,27** |
| Total Sonnet 5.5 via Batch API (tokens −50%) | | | ≈ US$ 0,52 |

**Nível 3: competitivo (3 concorrentes, versão enxuta)**: por concorrente, 3 `web_search` (US$ 0,03) + 4 screenshots (US$ 0,032) + Sonnet 5.5 com 60k de entrada e 4k de saída (US$ 0,16) ≈ US$ 0,22. **Para 3 concorrentes: ≈ US$ 0,66.**

**Validação de evidências:** Haiku 5.5 com 30k de entrada e 2k de saída ≈ **US$ 0,004** por dossiê.

**Monitoramento (por empresa, por mês):** diff próprio de 3 URLs por dia (≈ 90 scrapes = US$ 0,09 no Firecrawl, ou ≈ US$ 0 com fetch direto) + 4 screenshots semanais (US$ 0,03) + GDELT e crt.sh (US$ 0) ≈ **US$ 0,05–0,12/mês**. Com Visualping, ≈ US$ 0,63/mês (90 checagens × US$ 0,007) [C24].

**Dossiê completo (N1 + N2 + N3 + validação): ≈ US$ 1,47 (Sonnet 5.5) a ≈ US$ 1,97 (Opus 5.5) por empresa**, ou seja, ≈ US$ 1,5–2,0.

**Custos fixos mensais de referência (MVP):** Firecrawl Standard US$ 99 [A21]; ScreenshotOne Growth US$ 79 [B6]; Logo.dev Startup US$ 33 (opcional) [B17]; Wappalyzer Pro US$ 250 (opcional) [B12]. Vercel Pro e Supabase estão no doc 04. Claude, Brave e Places são pay-as-you-go.

---

## 4. Lacunas e perguntas abertas

1. **Claude `web_search` e Brasil:** a doc diz que um código de país não suportado devolve 400, mas não lista os países. **Testar `user_location.country = "BR"`** e medir a qualidade das buscas em PT [A1].
2. **Benchmark PT-BR:** não há evidência pública de qualidade em português para Exa, Tavily, Brave ou Serper. Proposta: 50 consultas reais (empresas de SP, BH, POA) avaliadas por precisão@5 e frescor antes de escolher o provedor secundário.
3. **Firecrawl:** (a) confirmar por escrito que o plano pago autoriza "commercial purposes" (ToS 5.d.1); (b) custo em créditos de `screenshot` e `branding`; (c) política de robots.txt [A22][A23].
4. **Brave:** preço e escopo do plano com "storage rights" [A13][A14].
5. **PageSpeed Insights:** a cota oficial (25k/dia `[secundária]`) não foi confirmada em página do Google. Conferir no console do GCP [B11].
6. **Wappalyzer:** créditos de API por plano (tabela ilegível) [B12].
7. **Instagram:** (a) se `like_count` e `profile_picture_url` voltam no Business Discovery hoje [B19][B22]; (b) termos da Meta sobre retenção de dados (mídia e métricas de terceiros); (c) se um SaaS multiagência exigirá Advanced Access e verificação da empresa [B23].
8. **Meta Ad Library:** confirmar na prática que anúncios comerciais BR voltam vazios. Acompanhar mudanças regulatórias que possam estender a transparência ao Brasil [B28].
9. **Receita Federal:** URL oficial atual dos arquivos (mudou em jan/2026), periodicidade (mensal ou trimestral) e efeito do CNPJ alfanumérico no layout [C12][C13]. As páginas oficiais não renderizaram no fetch.
10. **registro.br:** existe acesso a zona .br ou lista de novos registros para terceiros? Nada encontrado. Confirmar com o NIC.br [C15].
11. **Gupy:** termos de uso do portal para visitantes e o escopo da API oficial (só clientes?) [C1].
12. **Reclame Aqui:** existe programa B2B de dados de reputação? Contatar a área de parcerias [C19].
13. **NewsData.io:** preços oficiais (não renderizaram), uso comercial no free e cobertura `country=br`/`language=pt` [C10].
14. **GDELT:** medir a cobertura de veículos brasileiros e regionais. O teste de 2026-11-09 voltou vazio e depois 429 [C6].
15. **Querido Diário:** a API estava fora (HTTP 520). Reavaliar disponibilidade, autenticação e limites [C23].
16. **Google × SerpApi:** acompanhar o desfecho da complaint emendada, que pode afetar todo o segmento de APIs de SERP [A20].
17. **Jurídico:** guardar screenshots de sites de terceiros para análise interna e exibir trechos citados no SaaS. Validar com advogado (direito autoral, LGPD e termos de cada fonte).
18. **Termos do archive.org:** a página não renderizou. Revisar antes de uso em escala [B31].

---

## 5. Fontes (todas consultadas em 2026-11-09)

**A — Busca e extração**
- [A1] Claude API: Web search tool. https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool
- [A2] Claude API: Web fetch tool. https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-fetch-tool
- [A3] Claude API: Pricing. https://platform.claude.com/docs/en/about-claude/pricing
- [A4] Claude API: Vision. https://platform.claude.com/docs/en/build-with-claude/vision
- [A5] Exa: Pricing. https://exa.ai/pricing
- [A6] Exa: Terms of Service (PDF servido em) https://exa.ai/terms
- [A7] Exa: changelog "Language filtering default". https://docs.exa.ai/changelog/language-filtering-default
- [A8] Tavily: Pricing. https://www.tavily.com/pricing
- [A9] Tavily: API credits. https://docs.tavily.com/documentation/api-credits
- [A10] Tavily: Rate limits. https://docs.tavily.com/documentation/rate-limits
- [A11] Tavily: Terms. https://www.tavily.com/terms
- [A12] Nebius: anúncio de aquisição da Tavily. https://nebius.com/newsroom/nebius-announces-agreement-to-acquire-tavily-to-add-agentic-search-to-its-ai-cloud-platform
- [A13] Brave Search API: planos. https://brave.com/search/api/
- [A14] Brave Search API: Terms of Service. https://api-dashboard.search.brave.com/terms-of-service
- [A15] Brave Search API: códigos de idioma e país. https://api-dashboard.search.brave.com/app/documentation/web-search/codes
- [A16] Serper: home e preços. https://serper.dev/
- [A17] Serper: Terms. https://serper.dev/terms
- [A18] SerpApi: Pricing. https://serpapi.com/pricing
- [A19] SerpApi: Legal (Terms e Privacy). https://serpapi.com/legal
- [A20] Google × SerpApi `[secundária]`: https://news.bloomberglaw.com/ip-law/google-lawsuit-against-data-scraper-tossed-over-authority-issue ; https://www.theregister.com/2026/02/21/serpapi_google_scraping_lawsuit/ ; https://ppc.land/google-loses-dmca-bid-to-treat-search-scraping-like-dvd-piracy/
- [A21] Firecrawl: Pricing. https://www.firecrawl.dev/pricing
- [A22] Firecrawl: Terms of Service. https://www.firecrawl.dev/terms-of-service
- [A23] Firecrawl: Scrape (formatos e cache). https://docs.firecrawl.dev/features/scrape
- [A24] Firecrawl: Branding Format v2. https://www.firecrawl.dev/blog/branding-format-v2
- [A25] Jina Reader. https://jina.ai/reader/
- [A26] Jina: API pricing e rate limits. https://jina.ai/api-dashboard/pricing
- [A27] Elastic conclui a aquisição da Jina AI (BusinessWire). https://www.businesswire.com/news/home/20251009619654/en/Elastic-Completes-Acquisition-of-Jina-AI-a-Leader-in-Frontier-Models-for-Multimodal-and-Multilingual-Search
- [A28] Jina Reader (GitHub; screenshot e pageshot). https://github.com/jina-ai/reader
- [A29] SerpApi: Google Jobs API e Google Maps Reviews API. https://serpapi.com/google-jobs-api ; https://serpapi.com/google-maps-reviews-api

**B — Auditoria visual**
- [B1] Vercel Functions Limits. https://vercel.com/docs/functions/limitations
- [B2] Vercel Fair Use Guidelines (uso comercial no Hobby). https://vercel.com/docs/limits/fair-use-guidelines
- [B3] Vercel: Deploying Puppeteer with Next.js on Vercel. https://vercel.com/kb/guide/deploying-puppeteer-with-nextjs-on-vercel
- [B4] Browserless: Pricing. https://www.browserless.io/pricing
- [B5] Browserbase: Pricing. https://www.browserbase.com/pricing
- [B6] ScreenshotOne: Pricing. https://screenshotone.com/pricing/
- [B7] Urlbox: Pricing. https://urlbox.com/pricing
- [B8] ApiFlash (planos na home). https://apiflash.com/
- [B9] PageSpeed Insights API: Get started. https://developers.google.com/speed/docs/insights/v5/get-started
- [B10] PageSpeed Insights: About. https://developers.google.com/speed/docs/insights/v5/about
- [B11] Cota PSI `[secundária]`. https://unlighthouse.dev/learn-lighthouse/pagespeed-insights-api/rate-limits
- [B12] Wappalyzer: Pricing. https://www.wappalyzer.com/pricing/
- [B13] BuiltWith: APIs. https://api.builtwith.com/
- [B14] BuiltWith: Plans. https://builtwith.com/plans
- [B15] Brandfetch: Developer pricing. https://brandfetch.com/developers/pricing
- [B16] Brandfetch: Logo API guidelines. https://docs.brandfetch.com/logo-api/guidelines
- [B17] Logo.dev: Pricing. https://www.logo.dev/pricing
- [B18] HubSpot: Sunset do Clearbit Logo API. https://developers.hubspot.com/changelog/upcoming-sunset-of-clearbits-free-logo-api
- [B19] Meta: Business Discovery (Instagram API with Facebook Login). https://developers.facebook.com/docs/instagram-platform/instagram-api-with-facebook-login/business-discovery
- [B20] Meta: referência IG User / business_discovery. https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/business_discovery
- [B21] Meta: referência IG User (campos Public). https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user
- [B22] Meta: referência IG Media (campos Public). https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-media
- [B23] Meta: App Review for Instagram API. https://developers.facebook.com/docs/instagram-platform/app-review
- [B24] Meta: Graph API Rate Limiting. https://developers.facebook.com/docs/graph-api/overview/rate-limiting
- [B25] Basic Display API encerrada: https://developers.facebook.com/docs/instagram-basic-display-api (hoje redireciona para a visão geral da Instagram Platform) ; Zapier `[secundária]` https://help.zapier.com/hc/en-us/articles/32429170578317-Instagram-app-deprecation-on-Dec-4-2024
- [B26] Instagram: Termos e Central de Ajuda sobre scraping. https://help.instagram.com/581066165581870 ; https://help.instagram.com/740480200552298 (texto obtido via resultado de busca; a página não renderizou no fetch)
- [B27] Meta: Page Public Content Access. https://developers.facebook.com/docs/features-reference/page-public-content-access
- [B28] Meta: Ads Archive (Ad Library API). https://developers.facebook.com/docs/graph-api/reference/ads_archive/
- [B29] Google Cloud Community: dataset `google_ads_transparency_center` `[secundária]`. https://www.googlecloudcommunity.com/gc/Data-Analytics/Querying-public-google-ads-transparency-center-table-doesn-t/m-p/856073
- [B30] TikTok: Commercial Content API. https://developers.tiktok.com/products/commercial-content-api
- [B31] Internet Archive: Wayback CDX Server README. https://github.com/internetarchive/wayback/blob/master/wayback-cdx-server/README.md
- [B32] Biblioteca `wayback`: release history (limite de 24 req/min) `[secundária]`. https://wayback.readthedocs.io/en/latest/release-history.html
- [B33] Claude API: Browser use tool (citada na doc do web fetch). https://platform.claude.com/docs/en/agents-and-tools/tool-use/browser-use-tool

**C — Sinais comerciais**
- [C1] Gupy Developers: Conventions. https://developers.gupy.io/v2.0/reference/conventions
- [C2] Gupy: Termos de Uso, pessoa candidata (v. 20/03/2024, PDF). https://www.gupy.io/hubfs/%5BJur%C3%ADdico%5D%20Time%20de%20Contratos/Termos%20de%20Uso%20do%20Gupy%20Recrutamento%20e%20Sele%C3%A7%C3%A3o%20-%20Pessoa%20Candidata%2020.03.2024.pdf
- [C3] Apify: atores Gupy (API pública do portal) `[secundária]`. https://apify.com/datahamster/gupy-br-jobs
- [C4] LinkedIn: Job Posting API Overview (Microsoft Learn). https://learn.microsoft.com/en-us/linkedin/talent/job-postings/api/overview
- [C5] Indeed: Publisher API aposentada `[secundária]` https://jobspipe.dev/blog/indeed-publisher-api ; Sponsored Jobs API (oficial) https://docs.indeed.com/sponsored-jobs-api/start-here/get-started
- [C6] GDELT: DOC 2.0 API debuts. https://blog.gdeltproject.org/gdelt-doc-2-0-api-debuts/ (teste próprio em https://api.gdeltproject.org/api/v2/doc/doc retornou vazio e depois HTTP 429; o limite de 1 req/5 s vem de fontes secundárias como https://apify.com/glitchbound/gdelt-scraper)
- [C8] Google News: Terms of Service. https://www.google.com/intl/en_us/terms_google_news.html
- [C9] NewsAPI.org: Pricing. https://newsapi.org/pricing
- [C10] NewsData.io: Pricing https://newsdata.io/pricing ; preços via blog do fornecedor `[secundária]` https://newsdata.io/blog/?p=6514
- [C11] Mediastack: Product/Pricing. https://mediastack.com/product
- [C12] Receita Federal: Repositório de Dados Abertos https://www.gov.br/receitafederal/dados ; dados.gov.br (CNPJ) https://dados.gov.br/dados/conjuntos-dados/cadastro-nacional-da-pessoa-juridica---cnpj ; mudança de layout em jan/2026 `[secundária]` https://github.com/rictom/cnpj-sqlite
- [C13] CNPJ alfanumérico a partir de 31/07/2026 `[secundária]`. https://coad.com.br/home/noticias-detalhe/138435/implantacao-do-cnpj-alfanumerico-ocorrera-a-partir-de-31-de-julho
- [C14] crt.sh: fórum oficial (limites, Sectigo, 09/06/2023). https://groups.google.com/g/crtsh/c/QXQFoy331pE
- [C15] registro.br: RDAP https://registro.br/rdap/ ; ferramenta WHOIS https://registro.br/tecnologia/ferramentas/whois/
- [C16] Google Places API (New): Place Details. https://developers.google.com/maps/documentation/places/web-service/place-details
- [C17] Google Places API: Policies (cache, armazenamento, atribuição). https://developers.google.com/maps/documentation/places/web-service/policies
- [C18] Google Maps Platform: Pricing. https://developers.google.com/maps/billing-and-pricing/pricing
- [C19] Reclame Aqui: anúncio de API (2017) https://www.meioemensagem.com.br/marketing/reclame-aqui-abre-api-e-mira-o-mercado-americano ; app oficial para Zendesk https://www.zendesk.com/apps/support/1020838/reclame-aqui-oficial-by-droz
- [C20] Crunchbase Data: API essentials https://data.crunchbase.com/docs/api-essentials ; API packages https://data.crunchbase.com/docs/api-packages-overview ; estimativa de preço `[secundária]` https://www.vendr.com/marketplace/crunchbase
- [C21] Brazil Journal: Sling Hub `[secundária]`. https://braziljournal.com/a-sling-hub-quer-ser-o-crunchbase-brasileiro
- [C22] CVM: Portal de Dados Abertos. https://dados.cvm.gov.br/
- [C23] Querido Diário: API (HTTP 520 na consulta). https://queridodiario.org.br/api
- [C24] Visualping: Pricing. https://visualping.io/pricing
- [C25] changedetection.io (GitHub). https://github.com/dgtlmoon/changedetection.io
- [C26] LGPD, Lei 13.709/2018 (referência geral, não analisada em detalhe nesta pesquisa). https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm
