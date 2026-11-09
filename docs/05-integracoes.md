# Integrações externas — catálogo e decisões

> Versão 0.1 · 2026-11-09
> Síntese das pesquisas [research/01](research/01-dados-empresas-e-decisores.md), [research/02](research/02-pesquisa-web-visual-e-sinais.md), [research/03](research/03-canais-contato-e-conformidade.md) e [research/04](research/04-infraestrutura-e-execucao.md), todas com fontes oficiais consultadas em 2026-11-09. Preços e termos mudam: **reconfirme na documentação oficial antes de integrar** (skill `integracao-externa`). Itens [não verificado] permanecem hipóteses.

## 1. Princípios

1. **Só APIs oficiais/autorizadas.** Nada de scraping que viole termos (Google Maps, LinkedIn, Instagram, Reclame Aqui) nem burla de CAPTCHA/anti-bot. `web_fetch` da Claude respeita robots.txt.
2. **Separar dado do fornecedor de evidência própria.** Quando os termos proíbem armazenar (Google Places, Brave, Logo API da Brandfetch), persistimos apenas identificadores permitidos, URL, data, trecho curto citado e **nossa análise** — e exibimos o conteúdo do fornecedor ao vivo, com atribuição.
3. **Porta por capacidade, não por fornecedor.** Trocar de fornecedor não altera domínio nem workflows.
4. **Custo e limites explícitos.** Toda chamada registra unidades e custo em `provider_usage`; throttle por fornecedor.
5. **Multi-tenant muda os termos.** Vários provedores restringem disponibilizar dados/API a terceiros; no MVP de uso interno (D-PROD-1 a) os termos padrão bastam; para SaaS é preciso BYOK aceito pelo provedor ou acordo de parceria.

## 2. Catálogo por capacidade (MVP)

| Capacidade (porta) | MVP | Alternativas | Custo (referência) | Restrições de termos/limites | Status |
|---|---|---|---|---|---|
| **Base cadastral / descoberta** (`CompanyRegistrySearch`, `CompanyRegistryLookup`) | Dados abertos do CNPJ (ETL mensal, recorte por UF/CNAE, sem MEI) — **ou**, para começar, API comercial com busca por filtros (CNPJá / CNPJ.ws Premium) | BrasilAPI / OpenCNPJ (lookup grátis, sem SLA) | ETL: custo de infra; CNPJá a partir de R$ 24,99 por 1.000 créditos (pesquisa avançada: 1 crédito por 10 resultados) | Caminho dos arquivos mudou em 2026; CNPJ alfanumérico desde jul/2026; licença de redistribuição não verificada; e-mail/telefone cadastrais muitas vezes do contador | D-DATA-1 |
| **Presença local** (`PlacePresence`) | Google Places (New) Text Search, field mask mínimo | — | Text Search Enterprise US$ 35/mil (1.000 grátis/mês) | **Só `place_id` armazenável sem prazo**; lat/lng ≤ 30 dias; não copiar nome/endereço/avaliações; atribuição "Google Maps"; máx. 60 resultados por busca (não serve para varredura) | Adotar com restrições (D-DATA-4) |
| **Busca web para agentes** | Claude `web_search` (ferramenta de servidor) | Brave, Serper, Exa, Tavily (benchmark PT-BR antes) | US$ 10 por 1.000 buscas + tokens | Citações obrigatórias ao exibir; `allowed_domains` **ou** `blocked_domains`; `user_location` BR [não verificado — testar] | Adotar |
| **Leitura de páginas** | Claude `web_fetch` | Firecrawl (SPA/JS, crawl, `branding`), Jina Reader | Só tokens | Só URLs já presentes na conversa; sem JavaScript; respeita robots.txt | Adotar |
| **Crawl e identidade do site** | Firecrawl (formato `branding`: cores/fontes do CSS) | Extração própria do CSS | Standard US$ 99/mês (100k créditos) | Cláusula de "uso comercial" ambígua — confirmar por escrito | Avaliar na F5/F6 |
| **Captura de tela** (`ScreenCapture`) | ScreenshotOne (ou ApiFlash) | Playwright em worker dedicado (fase 2) | ~US$ 0,008 por imagem (ScreenshotOne Growth) / ~US$ 0,0035 (ApiFlash Medium) | Não usar recursos de burla de CAPTCHA; fatiar página inteira em blocos de viewport para visão | Adotar |
| **Ativos de marca** (`BrandAssets`) | Logo.dev Brand API | Brandfetch (cache 30 dias na Brand API; Logo API exige hotlink) | US$ 0,05 por requisição | Logo.dev permite armazenar o retorno | Adotar |
| **Qualidade técnica do site** | PageSpeed Insights API | Lighthouse em worker | Gratuito (cota oficial não confirmada) | — | Adotar |
| **Tecnologia do site** | Heurística própria sobre HTML | Wappalyzer (Pro US$ 250/mês) | — | — | Heurística no MVP |
| **Instagram** (`SocialProfile`) | Instagram Graph API — Business Discovery via conta profissional da agência | — | Gratuito | Standard Access sem App Review apenas para app de empresa própria; SaaS multiagência exige Advanced Access + App Review; ~200 chamadas/h × usuários ativos; scraping proibido; retenção de mídia [não verificado] | Adotar (uso interno) |
| **Histórico visual** | Wayback Machine CDX + capturas históricas | — | Gratuito + custo da captura | Throttle conservador (~24 req/min relatado); termos do archive.org [não verificado] | Adotar |
| **Decisores (PMEs)** | QSA da Receita (sócios-administradores) | Apollo People Search (piloto) | Gratuito | Dado pessoal: legítimo interesse + LIA, minimização, sem faixa etária, nunca reconstruir CPF | Adotar com salvaguardas |
| **E-mail profissional** (`EmailFinder`) | Hunter (Email Finder/Domain Search) | Snov.io, Apollo enrichment | Growth US$ 149/10k créditos; cobra só quando encontra | Proíbe serviço concorrente; código 451 = titular pediu não processamento → suprimir; cobertura BR não documentada (pilotar) | Adotar (D-DATA-3) |
| **Verificação de e-mail** | MillionVerifier | ZeroBounce, verificador do Hunter | ~US$ 0,0018 por e-mail (pacote 50k) | — | Adotar |
| **Telefone direto** | Lusha, sob demanda e com aprovação | — | ~US$ 0,58 por telefone (Pro) | Proíbe embutir dados em produto de terceiros sem consentimento | Avaliar (pós-MVP) |
| **Notícias** (`NewsSignals`) | GDELT DOC 2.0 | NewsData.io | Gratuito | Cobertura de veículos BR a medir; throttle | Fase 2 |
| **Sites/certificados novos** | crt.sh (Certificate Transparency) | — | Gratuito | ~5 req/min | Fase 2 |
| **Vagas** | Páginas públicas de carreira das empresas (via `web_fetch`) | API Gupy (escopo não verificado) | Tokens | Respeitar robots/termos | Fase 2 |
| **Mudanças em sites** | Diff próprio (hash + captura) | changedetection.io, Visualping | ~US$ 0,05–0,12 por empresa/mês | — | Fase 2 |
| **E-mail (envio/sync)** | Caixa do usuário: Gmail API (`gmail.send`) ou Microsoft Graph (`Mail.Send` delegado) | — | Licença da caixa | `gmail.send` é escopo sensível (verificação se app público); ler respostas no Gmail é escopo restrito (avaliação anual) → app interno no MVP; Workspace 2.000 msg/dia, Exchange 30 msg/min; políticas vedam "unsolicited commercial mail" → só 1:1, baixo volume | D-CHAN-1, D-CHAN-2 |
| **E-mail do sistema** (convites, notificações) | ESP transacional (Resend, Postmark ou SES) | — | Por volume | **Proibido para prospecção** pelas políticas de uso | Adotar só para o sistema |
| **Agenda** | Link do Cal.com/Calendly do usuário + webhook | Google Calendar API (fase 2) | Calendly: API em todos os planos; Cal.com [não verificado] | Links de uso único do Calendly expiram em 90 dias | F12 |
| **WhatsApp** | — | Cloud API (fase 2, só com opt-in) | Por mensagem entregue | Opt-in prévio obrigatório; bibliotecas não oficiais levam a banimento | Fase 2 |
| **LLM** | **Ollama local** (`qwen3.5:4b`, reserva `nemotron-3-nano:4b`) — [ADR-0008](adr/0008-ia-local-com-ollama.md) | Claude API (`@anthropic-ai/sdk`) como reserva por capacidade (D-AI-1) | Local: zero em dinheiro (energia e GPU); Claude: ver [10 §3](10-riscos-custos-decisoes.md) | Apache 2.0 (Qwen); NVIDIA Open Model License (Nemotron, só inglês segundo o cartão); Ollama só em loopback | **Adotado e em uso (IA-1)** |
| **Infraestrutura** | Vercel Pro · Supabase Pro · Trigger.dev v4 · Langfuse · Sentry | Vercel Workflows (plano B) | Ver [research/04](research/04-infraestrutura-e-execucao.md) | Vercel Hobby proíbe uso comercial; regiões BR não verificadas | Adotar (D-INFRA-1) |

> **Com IA local (2026-11-09):** `web_search` e `web_fetch` da Claude só funcionam com a Claude API. Com o Ollama como padrão, busca e leitura de páginas viram portas próprias (`WebSearch`, `PageFetcher`, `ScreenCapture`) com leitor próprio, Playwright e um provedor de busca a decidir (D-AI-4: Ollama Web Search ou Brave, ambos com termos e cotas **não verificados** em página oficial). Opções e fontes: [13 §6.7](13-auditoria-e-evolucao.md#67-pesquisa-externa).

## 3. Explicitamente evitados

| Fonte/serviço | Motivo |
|---|---|
| Scraping de Google Maps (ex.: atores Apify) | Proibido pelos termos; Google processou a SerpApi (dez/2025) |
| LinkedIn como fonte de dados ou canal automatizado | User Agreement proíbe scraping/automação; API de Sales Navigator fechada a novos parceiros; Proxycurl encerrou após processo |
| Kaspr e extensões que extraem do LinkedIn | Mesmo motivo |
| APIs públicas gratuitas de CNPJ em produção | 3–5 req/min por IP; sem SLA |
| Casa dos Dados (endpoint não documentado) | Sem API oficial/termos |
| Meta Ad Library para anúncios comerciais BR | Fora da UE só retorna anúncios políticos/temas sociais (gerar link para consulta manual) |
| Google Ads Transparency / TikTok Commercial Content | Sem API oficial para o Brasil |
| Chromium dentro de Vercel Functions | Frágil (tamanho, cold start); usar serviço ou worker |
| Recursos de resolução de CAPTCHA | Viola termos de terceiros e as regras do projeto |
| Clearbit Logo API | Desligada |

## 4. Canais de contato

Ver síntese em [12-seguranca-e-conformidade.md](12-seguranca-e-conformidade.md) e detalhes em [research/03](research/03-canais-contato-e-conformidade.md). Regra de produto: e-mail pela caixa autorizada do usuário (com aprovação por item); LinkedIn e telefone como **tarefas assistidas**; WhatsApp fora do MVP (exige opt-in e API oficial).

## 5. Checklist ao integrar

Skill [`integracao-externa`](../.claude/skills/integracao-externa/SKILL.md): termos (uso comercial, armazenamento, IA, dados pessoais), custo por unidade, limites, porta + adapter + validação Zod, throttle, `provider_usage`, segredos, testes com respostas reais gravadas, documentação.
