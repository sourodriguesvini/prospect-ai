# Riscos, custos, dependências e pontos de decisão

> Versão 0.2 · 2026-11-10
> Fontes: [research/01](research/01-dados-empresas-e-decisores.md) · [research/02](research/02-pesquisa-web-visual-e-sinais.md) · [research/03](research/03-canais-contato-e-conformidade.md) · [research/04](research/04-infraestrutura-e-execucao.md) · preços da Claude API conforme referência oficial do SDK (cache de 2026-10-06, consultada em 2026-11-09).

## 1. Decisões pendentes

Ordenadas pelo momento em que bloqueiam o trabalho. **Recomendação** é a sugestão técnica; a decisão é do dono do produto.

| ID | Decisão | Opções | Recomendação | Bloqueia |
|---|---|---|---|---|
| **R-OPS-1** | Onde fica o código | (a) manter no OneDrive · (b) mover para pasta local fora do OneDrive (ex.: `C:\dev\prospector`) com repositório git remoto como backup | **(b)** — OneDrive sincronizando `node_modules` causa lentidão e travas | F1 |
| **D-OPS-2** | Repositório e CI | GitHub privado + Actions · outro | GitHub privado (a conexão MCP do GitHub falhou nesta sessão; criar pelo navegador/CLI) | F1 |
| **D-INFRA-1** | Contas e fornecedores | Vercel Pro, Supabase Pro, Trigger.dev, Langfuse, Sentry, Anthropic API | Criar contas da agência (faturamento próprio); começar em planos gratuitos/baixos onde o uso comercial for permitido (Vercel Hobby **não** permite uso comercial) | F1 |
| **D-INFRA-2** | Banco no desenvolvimento | (a) Docker Desktop + Supabase local · (b) projeto Supabase de desenvolvimento na nuvem | **Decidido em 2026-11-09: (b)**, porque o Docker não está instalado: projeto `prospector-dev` (gratuito, `sa-east-1`). (a) continua útil para `pnpm test:db` em modo real, que é destrutivo | F1 |
| **D-PROD-1** | Escopo de tenancy no MVP | (a) uso interno da agência (1 tenant), arquitetura multi-tenant pronta · (b) SaaS para terceiros desde o início | **(a)** — termos de provedores de contato (Apollo, Lusha, Hunter) restringem disponibilizar dados/API a terceiros; licença de redistribuição dos dados da Receita não verificada | F3/F9 |
| **D-PROD-2** | Valores padrão da estratégia (F2, KI-046) | Rubrica, pesos e limiares do score, cobertura mínima, prazo de revisão da LIA, texto de opt-out, case citável | **Decidido em 2026-11-10, por delegação do usuário:** rubrica de branding com 7 critérios (consistência 20, sistema visual 15, logotipo 15, legibilidade 15, celular 15, imagens 10, acabamento 10); score com fit 25, need 30, signal 20, capacity 15 e timing 10, limiares 70/70/40 e cobertura mínima de 50%; LIA revista em 12 meses (o teto técnico continua 24; até haver parecer, no máximo 12); opt-out "responda pedindo para remover"; case citável recomendado, sem bloquear. Valores em `packages/domain/src/strategy/drafts.ts`. **Completado em 2026-11-10, com os textos aprovados pelo usuário:** faixas de investimento estimadas pelo agente (identidade visual R$ 6.000–25.000; rebranding R$ 20.000–80.000; site institucional R$ 8.000–30.000); CNAEs dos ICPs escolhidos pelo agente (doc 09, F2); agência Found Studio e canal do titular informados pelo usuário. O usuário revisa quando quiser: cada mudança vira versão nova. Calibrar com desfechos ([08 §3.5](08-metodologia-comercial.md)) | F2 |
| **D-EVID-1** | Valores do Evidence Ledger (F3a, KI-072) | Confiabilidade da anotação do usuário, validade por domínio, peso da fonte desconhecida, busca e hipótese | **Decidido em 2026-11-10, por delegação do usuário:** valem as propostas de [08 §2.5](08-metodologia-comercial.md#25-regras-implementadas-e-valores-decididos-f3a): anotação do usuário 0,7; validades de 30 a 180 dias por domínio; fonte desconhecida pode contestar mas não soma concordância (conservador: fonte fraca só pede revisão); busca nunca passa de agregador; hipótese sem confiança. Calibrar com desfechos | F3 |
| **D-EVID-2** | Peso dos provedores de CNPJ (M2, KI-080) | (a) manter OpenCNPJ e Minha Receita como agregadores (0,6, confiança média) · (b) tratá-los como registro oficial (0,95), já que republicam a base aberta da Receita sem alterar | **(b)** quando você confirmar que confia nesses dois serviços; até lá vale (a), mais conservador | Nada (só a faixa de confiança dos fatos do registro) |
| **D-DATA-1** | Fonte de descoberta no MVP | (a) ETL mensal dos dados abertos do CNPJ (grátis, job pesado, gera sinais por diff) · (b) API comercial de busca (CNPJá/CNPJ.ws) para começar rápido, ETL depois | **(b) → (a)**: integrar busca comercial atrás da porta `CompanyRegistrySearch` na F4; spike do ETL em paralelo e troca quando estável | F4 |
| **D-DATA-2** | Licença dos dados da Receita para redistribuição | Validar com jurídico | Necessário antes de SaaS (D-PROD-1 b) | Fase 3 |
| **D-DATA-3** | Provedores de contato | Hunter + MillionVerifier · Apollo (piloto) · Lusha (telefone, sob demanda) | Hunter + MillionVerifier no MVP; piloto de cobertura com ~100–200 empresas reais antes de assinar planos maiores | F9 |
| **D-DATA-4** | Google Places | Usar só para verificação de presença, persistindo apenas `place_id` e exibindo conteúdo ao vivo com atribuição | Adotar assim; levar ao jurídico a questão de sinais derivados | F5 |
| **D-CHAN-1** | Caixa de envio | Gmail API (`gmail.send`, escopo sensível) · Microsoft Graph (`Mail.Send` delegado) | Conforme o provedor de e-mail da agência; envio 1:1 pela caixa do usuário. ESPs transacionais e ferramentas de cold email ficam fora (políticas proíbem prospecção fria) — [12 §5](12-seguranca-e-conformidade.md) | F11 |
| **D-CHAN-2** | Detecção de respostas | (a) app **interno** no Workspace da agência (sem verificação) · (b) marcação manual · (c) app público com escopo restrito + avaliação de segurança anual (CASA) | **(a)** se Google Workspace; `Mail.Read` se Microsoft 365; (c) só antes de abrir o SaaS | F11 |
| **D-LGPD-1** | Encarregado (DPO) e validação jurídica | LIA, política de privacidade, texto de opt-out, retenção, 14 pontos de [12 §7](12-seguranca-e-conformidade.md) | Validar com advogado antes de qualquer contato real (M2); ponto crítico: legítimo interesse para prospecção fria sem relação prévia | F10 |
| **D-LGPD-2** | Residência de dados / transferência internacional | Supabase tem região `sa-east-1` (São Paulo); demais provedores (Vercel, Trigger.dev, Langfuse, Anthropic, Hunter etc.) nos EUA ou sem região BR verificada | Supabase em `sa-east-1`; mapa de suboperadores ([12 §6](12-seguranca-e-conformidade.md)); cláusulas-padrão da ANPD (Res. 19/2024) ou outro mecanismo do art. 33 | F1 (escolha de região) |
| **D-LGPD-3** | Retenção de traces com conteúdo | 30 · 60 · 90 dias | 30 dias com redação de PII | F4 |
| **D-AI-1** | Modelo por capacidade | Só modelos locais (Ollama) · local + Claude API como reserva nas capacidades em que o local não atingir o limiar | **Decidido em parte (ADR-0008, 2026-11-09):** local por padrão (`qwen3.5:4b`). Reserva na nuvem só com resultado de avaliação e decisão do usuário. **2026-11-10 (KI-034):** o `nemotron-3-nano:4b` deixa de ser reserva automática do Copiloto (orientou guardar CPF e endereço na avaliação); sem o `qwen3.5:4b`, o Copiloto pede para instalá-lo | F4–F7 |
| **D-AI-2** | Orçamento de IA | Teto mensal por tenant e por investigação | Definir teto mensal inicial e alvo por investigação L1 (ver §3) | F4 |
| **D-AI-3** | Embeddings (busca semântica de cases) | Provedor externo de embeddings · busca textual (`pg_trgm`/FTS) · embeddings locais (Ollama) + pgvector | **Revista em 2026-11-09:** embeddings locais (`qwen3-embedding:0.6b`, Apache 2.0) + pgvector no Supabase existente, na IA-5 ([13 §6.6](13-auditoria-e-evolucao.md#66-memória-semântica)) | IA-5 |
| **D-AI-4** | Provedor de busca web com IA local | Ollama Web Search API · Brave Search API · Tavily Search API · nenhum (só fontes diretas e dados abertos) | **Decidido pelo usuário em 2026-11-10:** buscador principal **Tavily Search API**, só no plano gratuito (sem plano pago nem cobrança automática), com limite de consumo configurável que interrompe as chamadas ao atingir o orçamento; chave em variável de ambiente, criada e configurada pelo próprio usuário. Navegação e análise de páginas com **Playwright**. **SearXNG local** como buscador secundário opcional, só depois de avaliação. Implementação no M3 — [13 §6.7](13-auditoria-e-evolucao.md#67-pesquisa-externa), [14](14-execucao-e-conclusao.md) | M3 (F4/F5) |
| **D-AI-5** | Orquestração de tarefas com IA local | Fila durável no Postgres + worker local · Trigger.dev com worker local | Fila no Postgres (um worker na nuvem não alcança o Ollama local nem deve receber a secret key, KI-024); registrar em ADR na IA-3 e rever o [ADR-0004](adr/0004-orquestracao-duravel.md) | IA-3, F5 |
| **D-UX-1** | Direção visual e tipografia | Famílias e licenças; exploração com a equipe de criação | Workshop curto com a direção de criação antes da F1 terminar o shell | F1 |
| **D-AUTH-1** | Login | E-mail (link mágico/senha) · Google · MFA | E-mail + Google; MFA obrigatório para owner/admin | F1 |

## 2. Registro de riscos

Probabilidade (P) e impacto (I): A alto · M médio · B baixo.

| ID | Risco | P | I | Mitigação |
|---|---|---|---|---|
| R-DATA-1 | PMEs com pouca presença digital geram evidência insuficiente com frequência | A | A | ICP com filtro de presença digital; triagem L0 barata; recomendação `insufficient_evidence` honesta; medir a taxa e ajustar ICP |
| R-DATA-2 | Mudança de termos/preços de provedores (Google, Apollo, Hunter) | M | M | Portas/adapters; cache conforme termos; alternativas mapeadas por capacidade |
| R-DATA-3 | Caminho/formato dos arquivos da Receita muda (já mudou em 2026; CNPJ alfanumérico) | A | M | Descoberta dinâmica do caminho; validação de layout; alerta; fallback por API |
| R-DATA-4 | E-mail/telefone cadastrais pertencem ao contador | A | M | Tratar como chave fraca; detectar domínios repetidos em muitos CNPJs; não usar como canal |
| R-AI-1 | Alucinação de evidência (citação inexistente) | M | A | Verificação determinística de trechos; validação de evidências; avaliações com claims proibidos |
| R-AI-2 | Inferências superconfiantes | M | A | Confiança calculada no servidor; tetos por tipo; verificador nas mensagens |
| R-AI-3 | Prompt injection via sites/e-mails | M | A | Conteúdo externo como dado; agentes de leitura sem ações externas; aprovação humana |
| R-AI-4 | Mudanças de API/modelos e recursos beta (Tool Runner, fallbacks, task budgets) | M | M | LLM Gateway isola; SDK fixado; testes de contrato; fallback para loop manual |
| R-AI-5 | Custo de IA acima do esperado | M | A | Investigação em camadas; cache; Batches; orçamentos com corte; painel de custos desde F4 |
| R-CHAN-1 | Entregabilidade/reputação de domínio | M | A | Envio pela caixa do usuário em baixo volume; autenticação de domínio; limites; opt-out; ver research/03 |
| R-LGPD-1 | Reclamação de titular ou fiscalização | M | A | Controles de [12](12-seguranca-e-conformidade.md); LIA; supressão; DSR; validação jurídica antes de M2 |
| R-LGPD-2 | Transferência internacional sem base adequada | M | M | Mapeamento de suboperadores e cláusulas; minimização em traces |
| R-LGPD-3 | Legítimo interesse não sustentar prospecção fria sem relação prévia (o guia da ANPD não traz esse caso) | M | A | LIA forte (dados profissionais, oferta ligada ao cargo, aviso de origem, opt-out imediato); parecer jurídico antes de M2; plano B: inbound e indicações |
| R-LGPD-4 | IA + escala enquadrarem o tratamento como "alto risco" e retirarem benefícios de pequeno porte | M | M | RIPD voluntário; prazos sem depender do dobro; validação jurídica |
| R-CHAN-2 | Políticas do Gmail/Workspace e do Exchange vedam "unsolicited commercial mail" → limitação ou suspensão da caixa | M | A | Só 1:1, revisado por humano, baixo volume, limites e disjuntores; leitura jurídica das políticas |
| R-DATA-5 | Cláusula de "uso comercial" ambígua nos termos da Firecrawl | M | B | Confirmar por escrito antes de assinar; `web_fetch` e extração própria como alternativa |
| R-OPS-1 | OneDrive + `node_modules` | A | M | Mover o projeto (decisão R-OPS-1) |
| R-OPS-2 | Dependência do Trigger.dev | B | M | `packages/workflows` atrás de interface; plano B Vercel Workflows |
| R-PROD-1 | Baixa adoção pela equipe | M | A | Fila diária de decisões; Copiloto; medir tempo por decisão; sessões de feedback por marco |
| R-PROD-2 | Falta de dados rotulados para avaliações | A | A | Reservar tempo da direção de criação e do comercial para anotar conjuntos (estimativa: 6–10 h no M1) |
| R-PROD-3 | Metas de conversão sem linha de base | A | M | Fase 1 mede linha de base; metas recalibradas no M3 |

## 3. Custos estimados

### 3.1 Infraestrutura (sem LLM e sem dados)
Conforme [research/04 §3.1](research/04-infraestrutura-e-execucao.md): **~US$ 55–115/mês** (1 tenant, ~500 empresas/mês) · **~US$ 210–440/mês** (20 tenants, ~10.000 empresas/mês).

### 3.2 Dados por empresa
Conforme [research/01 §3.3](research/01-dados-empresas-e-decisores.md): **≈ US$ 0,07 + ~R$ 0,03** por empresa no cenário base (presença no Google, 2 e-mails de decisores, verificação), sem assinaturas fixas (ex.: Hunter Growth US$ 149/mês). Telefone direto opcional: **+US$ 0,58**.

### 3.2.1 Web, visual e sinais por empresa
Conforme [research/02 §3.3](research/02-pesquisa-web-visual-e-sinais.md): triagem ≈ US$ 0,01–0,03; investigação com auditoria visual ≈ US$ 0,77 (investigador em Sonnet 5.5) a US$ 1,27 (Opus 5.5), **incluindo os tokens de IA** (por isso não somar com §3.3); 3 concorrentes ≈ US$ 0,66; dossiê completo ≈ **US$ 1,5–2,0**. Monitoramento ≈ US$ 0,05–0,12 por empresa/mês.

**Assinaturas fixas de referência (MVP):** ScreenshotOne US$ 17–79/mês (2k–10k capturas) · Hunter Growth US$ 149/mês · Firecrawl Standard US$ 99/mês (só se `web_fetch` não bastar — avaliar na F5/F6) · opcionais: Logo.dev US$ 33, Wappalyzer US$ 250.

### 3.3 IA por operação — estimativa de ordem de grandeza

Premissas (a medir na F5): preços por MTok — Opus 5.5 US$ 4 entrada / US$ 20 saída; Sonnet 5.5 US$ 2 / US$ 10; Haiku 5.5 US$ 0,10 / US$ 0,50 (referência oficial do SDK). Tokens de saída incluem raciocínio (thinking). Busca web cobrada à parte conforme [research/02](research/02-pesquisa-web-visual-e-sinais.md).

| Operação | Composição (tokens aprox.) | Custo estimado |
|---|---|---|
| Triagem L0 (Haiku 5.5, lote) | ~2k entrada + 200 saída por candidato | < US$ 0,001 por candidato |
| `site_extractor` (Sonnet 5.5) | 15k / 1,5k | ~US$ 0,05 |
| `visual_auditor` (Opus 5.5) | 9k (3 imagens + rubrica) / 8k | ~US$ 0,20 |
| `investigator` L1 (Opus 5.5) | ~120k acumulados nos turnos / 15k + ~6 buscas | ~US$ 0,80–0,90 |
| `need_assessor` + validação | 20k / 5k | ~US$ 0,15 |
| **Investigação L1 total** | | **~US$ 1,20–1,30** (incerteza ±50%) |
| Abordagem (planejar + redigir + verificar) | 28k / 9k | ~US$ 0,25–0,30 por empresa |
| Copiloto | ~20k (maior parte em cache) / 1,5k por interação | ~US$ 0,05–0,10 |

**Cenário mensal ilustrativo (1 tenant):** 2.000 candidatos triados + 300 investigações L1 + 30 L2 + 80 abordagens + 800 interações de Copiloto ≈ **US$ 500–650/mês de IA**. A IA domina o custo total; por isso:

- **Alavancas, em ordem:** triagem melhor (investigar menos e melhor) → cache de prompt → Batches para lotes não urgentes (50% de desconto) → esforço menor onde a avaliação permitir → modelo mais barato no investigador (decisão D-AI-1, só com evidência).
- Métrica de gestão: **custo por reunião qualificada**, não custo por chamada.

### 3.4 Total mensal ilustrativo (1 tenant, cenário acima)

| Item | US$/mês |
|---|---|
| Infraestrutura (§3.1) | 55–115 |
| Assinaturas de dados/web (ScreenshotOne + Hunter; Firecrawl se necessário) | 166–327 |
| Dados variáveis (≈ 300 empresas × US$ 0,07) | ~21 |
| IA (§3.3) | 500–650 |
| **Total** | **≈ 750–1.100** |

Não inclui honorários jurídicos (D-LGPD-1), avaliação de segurança do Google (não necessária no MVP interno — D-CHAN-2) nem horas da equipe. Incerteza alta até a medição real na F5.

## 4. Dependências externas e de pessoas

| Dependência | Para quê | Quando |
|---|---|---|
| Direção de criação da agência | Rubrica visual, rotular 30 auditorias, direção visual do produto | F2, F6, F1 (UX) |
| Comercial da agência | ICP inicial, clientes atuais (CSV), rotular recomendações, revisar mensagens | F2, F7, F10 |
| Advogado/DPO | LIA, aviso de privacidade, opt-out, retenção, transferência internacional | antes de M2 |
| Dono do produto | Decisões da seção 1, orçamento | contínuo |
