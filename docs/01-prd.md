# PRD — Sistema Operacional de Inteligência Comercial

> Nome de trabalho: **Prospector** (provisório).
> Status: rascunho para revisão · Versão 0.1 · 2026-11-09
> Dono do documento: produto. Decisões em aberto estão marcadas com **[DECISÃO]** e consolidadas em [10-riscos-custos-decisoes.md](10-riscos-custos-decisoes.md).

---

## 1. Problema

Agências de branding vendem um serviço de ticket médio-alto, consultivo e de baixa recorrência. O gargalo comercial não é volume de contatos — é **encontrar empresas que de fato têm um problema de marca, no momento certo, e conseguir falar com quem decide usando um argumento verdadeiro**.

Hoje esse trabalho é feito de três formas, todas ruins:

| Abordagem atual | Falha |
|---|---|
| Pesquisa manual (Google, Instagram, site) | Lenta, não escala, não deixa registro reutilizável, depende de quem pesquisa. |
| Listas compradas + disparo em massa | Baixa relevância, risco LGPD e de reputação de domínio, queima mercado. |
| CRM genérico | Organiza o que já existe; não descobre, não investiga, não explica. |

Ferramentas de "IA para vendas" disponíveis tendem a gerar personalização superficial ("vi que vocês são referência em…") sem evidência e sem reconhecer quando **não há oportunidade**.

## 2. Visão

Um sistema que trabalha como um bom analista comercial sênior: **descobre, investiga, diagnostica, decide, planeja, executa com autorização e aprende** — e mostra o porquê de cada conclusão.

Princípios do produto (inegociáveis):

1. **Evidência antes de opinião.** Toda conclusão sobre um prospect é um *claim* tipado — **fato**, **inferência** ou **hipótese** — com fonte, data de coleta e nível de confiança. Ver [08-metodologia-comercial.md](08-metodologia-comercial.md).
2. **"Não abordar" é um resultado válido.** O sistema precisa declarar quando a oportunidade não está sustentada, e bloquear a geração de abordagem nesses casos.
3. **Humano aprova o que sai.** Nenhuma mensagem ou ação externa sensível é executada sem aprovação registrada.
4. **Conformidade por padrão.** Base legal registrada, opt-out em todo canal, lista de supressão global, minimização e retenção.
5. **Explicável e auditável.** Cada score, recomendação e mensagem pode ser rastreado até dados, versão de prompt, modelo e custo.
6. **Núcleo genérico, conhecimento configurável.** Branding é a primeira *oferta*; rubricas, ICPs, sinais e argumentos são dados configuráveis, não código.
7. **Custo consciente.** Investigação em camadas: gasto proporcional ao potencial demonstrado.

## 3. Usuários e papéis

| Persona | Contexto | O que precisa |
|---|---|---|
| **Sócio(a)/Diretor(a) da agência** (dono) | Define ofertas, preço, ICP, aprova abordagens de alto valor | Pipeline confiável, previsibilidade, controle de marca e risco |
| **Executivo(a) comercial / SDR** (operador) | Executa descoberta, revisa dossiês, aprova e envia mensagens, conduz reuniões | Menos pesquisa manual, argumentos prontos e verdadeiros, prioridade clara do dia |
| **Estrategista/Diretor(a) de criação** (colaborador) | Valida diagnósticos visuais e argumentos de marca | Auditoria visual fundamentada, comparação com concorrentes |
| **Administrador(a) do tenant** | Integrações, equipe, conformidade, orçamento | Permissões, custos, trilha de auditoria |

Papéis de sistema (RBAC por organização): `owner`, `admin`, `operator`, `viewer`. Ver [12-seguranca-e-conformidade.md](12-seguranca-e-conformidade.md).

## 4. Objetivos e métricas

O critério principal (do briefing): **encontrar oportunidades relevantes, fundamentar recomendações, reduzir esforço operacional e contribuir para negócios reais.**

### North Star
**Reuniões qualificadas geradas por mês a partir de oportunidades descobertas pelo sistema** (reunião realizada com decisor, de empresa recomendada como "abordar").

### Métricas de resultado (outcome)
| Métrica | Definição | Meta inicial (hipótese a calibrar) |
|---|---|---|
| Taxa de resposta positiva | respostas classificadas como interesse ÷ primeiras abordagens enviadas | ≥ 8% (benchmark a validar com histórico da agência) |
| Reuniões por 100 abordagens | reuniões realizadas ÷ abordagens × 100 | ≥ 3 |
| Precisão da recomendação | % de empresas "abordar agora" que o humano concorda após revisar o dossiê | ≥ 80% |
| Oportunidades no pipeline originadas pelo sistema | contagem e valor estimado | crescente mês a mês |

### Métricas de qualidade (guardrails)
| Métrica | Meta |
|---|---|
| Afirmações factuais em mensagens sem claim de suporte | **0** (bloqueio automático) |
| Claims "fato" com fonte inválida na auditoria amostral | < 2% |
| Opt-outs honrados em < 24h | 100% |
| Taxa de reclamação de spam (e-mail) | < 0,1% (limite de provedores é maior; a meta é conservadora) |
| Envios sem aprovação registrada | **0** |

### Métricas de eficiência
| Métrica | Meta |
|---|---|
| Tempo humano por empresa até decisão (abordar/descartar) | de ~40 min (manual, estimativa) para ≤ 5 min |
| Custo de IA + dados por empresa investigada (camada padrão) | orçamento definido por tenant; meta inicial ≤ US$ 1,50 [DECISÃO] |
| Custo por reunião qualificada | medido e exibido |

> As metas numéricas são **hipóteses iniciais**. A fase 1 do MVP mede a linha de base com dados reais da agência; nenhuma meta deve ser comunicada como benchmark de mercado sem fonte.

## 5. Escopo funcional (17 domínios)

Detalhamento completo de cada domínio — responsabilidades, entradas, saídas, dados, dependências, integrações, regras e critérios de qualidade — em [02-dominios.md](02-dominios.md).

| # | Domínio | Resumo |
|---|---|---|
| D1 | Estratégia e ofertas | Catálogo de ofertas, proposta de valor, provas (cases), tom de voz da agência |
| D2 | ICP | Perfis de cliente ideal por oferta, critérios, exclusões, pesos, versões e calibração |
| D3 | Descoberta | Encontrar empresas candidatas a partir de ICP, listas, buscas e sinais |
| D4 | Enriquecimento | Completar dados cadastrais, digitais e de presença |
| D5 | Auditoria visual | Diagnóstico multimodal da marca contra rubrica da oferta |
| D6 | Competitivo | Identificar concorrentes e comparar posicionamento e expressão |
| D7 | Sinais | Detectar eventos que indicam momento de compra |
| D8 | Decisores e canais | Identificar quem decide e por qual canal autorizado falar |
| D9 | Qualificação | Score multidimensional com confiança e recomendação explícita |
| D10 | Planejamento de abordagem | Tese, ângulo, argumentos sustentados, canal, sequência |
| D11 | Personalização | Redação adaptada ao interlocutor, verificada contra evidências |
| D12 | Contatos e cadências | Execução autorizada, supressão, limites, rastreio |
| D13 | Conversas e objeções | Classificação de respostas, objeções, opt-out automático |
| D14 | CRM | Oportunidades, reuniões, propostas, negociação |
| D15 | Monitoramento | Vigilância periódica de empresas e detecção de mudanças |
| D16 | Analytics e aprendizado | Funil, atribuição, calibração de ICP/score, aprendizados aprovados |
| D17 | Copiloto | Interface conversacional capaz de operar todos os módulos com permissões |

## 6. Jornadas principais (resumo)

Fluxos detalhados em [07-fluxos.md](07-fluxos.md).

1. **Configurar** — cadastrar oferta "Branding/Identidade Visual", rubrica de auditoria, ICP inicial, tom de voz, integrações e base legal (LIA).
2. **Descobrir** — "Encontre clínicas odontológicas premium em Curitiba com presença digital fraca" → candidatos deduplicados com triagem rápida.
3. **Investigar** — dossiê com claims tipados: cadastro, site, redes, auditoria visual, concorrentes, sinais, decisores.
4. **Qualificar** — score por dimensão + confiança + recomendação (`abordar agora`, `preparar acesso`, `investigar mais`, `monitorar`, `descartar`), com motivos.
5. **Planejar e redigir** — tese de abordagem e mensagens que só usam argumentos sustentados; verificador bloqueia afirmações sem evidência.
6. **Aprovar e executar** — fila de aprovação; envio pelo canal autorizado; tarefas manuais para canais sem API permitida (ex.: LinkedIn).
7. **Conversar e avançar** — respostas classificadas; objeções mapeadas; opt-out automático; oportunidade criada no CRM.
8. **Monitorar e aprender** — mudanças e sinais reabrem oportunidades; resultados alimentam calibração (sempre com aprovação humana).

## 7. Requisitos não funcionais

| Área | Requisito |
|---|---|
| Multi-tenant | Isolamento por organização via RLS em 100% das tabelas de dados de tenant; testes automatizados de isolamento. |
| Segurança | Segredos de terceiros criptografados (nunca em texto puro no banco ou logs); princípio do menor privilégio; MFA para owner/admin [DECISÃO]. |
| Auditoria | Log append-only de toda ação de usuário e agente que altera estado ou age externamente. |
| Explicabilidade | Todo score/recomendação/mensagem exibe os claims de suporte e suas fontes. |
| Confiabilidade | Execuções idempotentes; retomada após falha sem duplicar efeitos externos; nenhum envio duplicado. |
| Desempenho | UI interativa < 200 ms p95 para leituras comuns; investigação padrão concluída em ≤ 5 min p90 (assíncrona, com progresso). |
| Custo | Rastreamento por tenant, agente, operação e provedor; orçamentos com corte rígido opcional. |
| LGPD | Base legal por contato, origem do dado, atendimento a direitos do titular em ≤ 15 dias, retenção e expurgo automatizados. |
| Acessibilidade | WCAG 2.2 AA nas telas principais. |
| Idioma | pt-BR na interface e nas mensagens geradas; arquitetura pronta para i18n. |
| Responsivo | Desktop como ambiente principal de trabalho; revisão/aprovação e copiloto plenamente usáveis em mobile. |

## 8. Fora de escopo (MVP)

- Disparo em massa / automação sem aprovação por mensagem.
- Automação de LinkedIn (envio de convites/mensagens por robô) — viola os termos da plataforma; ver [research/03](research/03-canais-contato-e-conformidade.md).
- WhatsApp para primeiro contato sem opt-in.
- Compra/revenda de bases de dados pessoais.
- Discador/telefonia integrada.
- Geração de propostas comerciais completas (MVP registra e anexa; geração vem depois).
- App mobile nativo.

## 9. Premissas e restrições

- Stack obrigatória: TypeScript, Next.js, React, Tailwind, shadcn/ui, Supabase. Ver [03-arquitetura-tecnica.md](03-arquitetura-tecnica.md).
- Agentes executados via Claude API (Messages API + tool use); Claude Code é a ferramenta de desenvolvimento. Ver [04-arquitetura-de-agentes.md](04-arquitetura-de-agentes.md) e [ADR-0003](adr/0003-runtime-de-agentes.md).
- Integrações externas apenas por APIs oficiais/autorizadas; nada de scraping que viole termos. Ver [05-integracoes.md](05-integracoes.md).
- Dados de demonstração sempre marcados (`is_demo = true`) e sinalizados na interface.

## 10. Riscos principais (resumo)

Detalhe em [10-riscos-custos-decisoes.md](10-riscos-custos-decisoes.md).

1. Qualidade de evidência insuficiente para PMEs com pouca presença digital → sistema recomenda "investigar mais" com frequência demais.
2. Restrições de termos de provedores (Google Places, Instagram, LinkedIn) limitam dados disponíveis.
3. Entregabilidade de e-mail e reputação de domínio.
4. Custo de investigação profunda se aplicado sem triagem.
5. Alucinação ou superconfiança em inferências — mitigado por tipagem de claims, verificador e avaliações.
6. Exposição LGPD de dados de pessoas físicas (sócios, decisores).

## 11. Critérios de sucesso do MVP

O MVP é considerado bem-sucedido quando, com dados reais da agência e durante 4 semanas de uso:

1. ≥ 100 empresas investigadas com dossiês que o time considera úteis (avaliação ≥ 4/5 em ≥ 70% das amostras).
2. 0 mensagens enviadas com afirmação factual sem evidência (verificado por auditoria amostral).
3. ≥ 30 abordagens aprovadas e enviadas pelo sistema, com resultado rastreado.
4. Tempo humano médio por empresa até decisão ≤ 10 min.
5. Custo médio por empresa investigada conhecido e dentro do orçamento definido.

Plano de entregas e critérios de aceite por fatia: [09-mvp-e-roadmap.md](09-mvp-e-roadmap.md).
