# Auditoria e evolução para IA local

> Versão 1.0 · 2026-11-09 · Resultado das etapas A a F do pedido "Auditoria e evolução do projeto existente".
> Decisão vigente sobre modelos: [ADR-0008 — IA local com Ollama](adr/0008-ia-local-com-ollama.md), que emenda o [ADR-0003](adr/0003-runtime-de-agentes.md). O [ADR-0007](adr/0007-uso-interno-local-sem-login.md) continua prevalecendo (uso interno, só neste computador, sem login).
> Regra de leitura: "verificado" quer dizer que o comando, teste ou tela foi executado nesta data; o resto está marcado como **não verificado** ou **planejado**.

## 1. Resumo

- O Prospector é um monorepo Next.js + pacotes TypeScript com **fundação F1** pronta localmente: shell da aplicação com o design system, proteções de uso local, auditoria append-only e testes. O banco Supabase **nunca foi conectado** neste computador (a tela inicial mostra "Não configurado").
- Dos 10 módulos da navegação, **2 funcionam** (Início, parcialmente; Copiloto, com IA local) e 8 são páginas de aviso que dizem em que fatia chegam. Nenhuma tela mostra dados simulados.
- Não existem ainda tabelas de empresas, prospects, oportunidades, claims nem conversas: o banco tem uma migração e uma tabela (`audit_log`).
- **Entregue nesta rodada (IA-1):** o pacote `packages/agents` conversa com o Ollama local (detecção, modelos instalados, escolha por tarefa, limite de concorrência e fila, VRAM, descarregar sob demanda, erros tipados), e o **Copiloto responde de verdade, em streaming**, com o `qwen3.5:4b`. Verificado com testes unitários, testes contra o Ollama real, avaliação local e uso no navegador.
- O Copiloto ainda **não consulta o banco nem usa ferramentas**: isso depende do banco configurado e é a próxima fatia de IA (IA-2).
- Maior bloqueio do produto: configurar o banco de desenvolvimento (D-INFRA-2). Sem ele não há histórico de conversas, tarefas, empresas nem evidências.

## 2. Ambiente diagnosticado (2026-11-09)

| Item | Valor | Como foi obtido |
|---|---|---|
| Sistema | Windows 11 Pro 10.0.26300 | ambiente da sessão |
| CPU | AMD Ryzen 9 5900X, 12 núcleos / 24 threads | `Get-CimInstance Win32_Processor` |
| RAM | 39,9 GB; 13,8 GB livres no momento da medição | `Win32_ComputerSystem`, `Win32_OperatingSystem` |
| GPU | NVIDIA GeForce RTX 5060 Ti, 16.311 MiB, driver 617.42, compute capability 12.0 | `nvidia-smi` |
| VRAM livre em repouso | ≈ 11,9 GB (o resto é usado por Windows, navegadores e outros apps) | `nvidia-smi`, painel do Copiloto |
| Disco | C: 36,1 GB livres (≈ 96% usado, KI-017) · D: 683,7 GB livres | `Get-PSDrive` |
| Ollama | 0.40.15 em `D:\ollama`, API em `127.0.0.1:11434` | `/api/version` |
| Variáveis do Ollama (usuário) | `OLLAMA_MAX_LOADED_MODELS=1`, `OLLAMA_NUM_PARALLEL=1`, `OLLAMA_CONTEXT_LENGTH=16384` | ambiente do Windows |
| Node / pnpm | 24 / 11 | `package.json`, `.nvmrc` |
| Docker | **não instalado** (KI-002) | — |
| Git | `main`, 3 commits, sem remoto; tudo desta rodada **não commitado** | `git status` |
| Banco | Supabase não configurado neste computador | tela Início |

### Modelos locais

| Modelo | Tamanho | Capacidades (`/api/show`) | Licença | Situação |
|---|---|---|---|---|
| `qwen3.5:4b` | 3,1 GiB | completion, vision, tools, thinking | Apache 2.0 (campo `license` do Ollama) | Instalado · **padrão do Copiloto** · avaliado |
| `nemotron-3-nano:4b` | 2,6 GiB | completion, tools, thinking | NVIDIA Open Model License (modificada em 24/10/2025) | Instalado · reserva · avaliado |
| `nemotron-3.5-bolt:e4b` | 7,4 GiB | completion, vision, audio, tools, thinking | não conferida (modelo personalizado do usuário) | Instalado · fora da política · não avaliado |
| `qwen3-vl:8b` | 6,2 GB (download) | texto + imagem, contexto 256K; exige Ollama ≥ 0.12.7 | Apache 2.0 (cartão no Hugging Face) | **Não instalado** · candidato à auditoria visual |
| `qwen3-embedding:0.6b` | 639 MB | embeddings até 1024 dimensões (MRL, 32 a 1024), contexto 32K, 100+ idiomas | Apache 2.0 (cartão no Hugging Face) | **Não instalado** · candidato à memória semântica |

Fontes consultadas em 2026-11-09: [ollama.com/library/qwen3-vl](https://ollama.com/library/qwen3-vl), [ollama.com/library/qwen3-embedding](https://ollama.com/library/qwen3-embedding), [Qwen3-Embedding-0.6B](https://huggingface.co/Qwen/Qwen3-Embedding-0.6B), [Qwen3-VL-8B-Instruct](https://huggingface.co/Qwen/Qwen3-VL-8B-Instruct). O cartão do Nemotron 3 Nano declara suporte só a inglês (lido na rodada anterior); por isso ele não é o padrão para pt-BR.

## 3. Arquitetura atual (o que o código faz hoje)

```mermaid
flowchart LR
  B[Navegador<br/>127.0.0.1:3000] -->|páginas RSC| W[apps/web<br/>Next 16]
  B -->|POST /api/copiloto<br/>NDJSON| R[route handler]
  W --> C[src/server/container.ts<br/>raiz de composição]
  R --> C
  C --> APP[packages/application<br/>AuditService · SystemService]
  C --> AG[packages/agents<br/>gateway · Ollama · GPU · fila]
  APP --> DB[packages/db<br/>Supabase via secret key]
  DB -.não configurado.-> SB[(Supabase)]
  AG -->|HTTP loopback| OL[Ollama 127.0.0.1:11434]
  AG -->|nvidia-smi| GPU[(RTX 5060 Ti)]
```

### 3.1 Frontend (`apps/web`, `packages/ui`)

- **Rotas:** `/` (Início), `/copiloto`, `/configuracoes`, `/configuracoes/auditoria`, `/[modulo]` (páginas de aviso dos 8 módulos futuros) e `POST /api/copiloto`.
- **Design system:** tokens e componentes em `packages/ui` (Panel, StatTile, Badge, Button, Alert, Input, StatusDot e outros), referências Finexy e Performance Insights (docs/07 §5). Preservado nesta rodada; o Copiloto usa só componentes existentes.
- **Estados:** carregando (Suspense), vazio, erro, não configurado, fora do ar, na fila, gerando, cancelado.
- **Acessibilidade:** testes axe (WCAG A/AA) no smoke e no Copiloto; conversa com `role="log"`, rótulos para leitor de tela, teclado (Enter envia, Shift+Enter quebra linha).
- **Responsividade:** grade de 12 colunas que vira uma coluna no celular; navegação lateral vira faixa rolável (KI-027).
- **Comunicação com o backend:** Server Components chamam serviços pela raiz de composição; Server Action para descarregar modelo; streaming NDJSON para o Copiloto. A conversa fica só na aba (sem persistência).

### 3.2 Backend

| Ponto | O que faz | Validação e erros | Segurança |
|---|---|---|---|
| `src/proxy.ts` | Recusa `Host` fora de localhost (403) e define cabeçalhos | — | ADR-0007 |
| `POST /api/copiloto` | Conversa em streaming com o modelo local | Mesma origem (403), JSON (415), até 256 KB (413), contrato Zod `CopilotRequest` (400); erros do provedor viram eventos `error` com código | Só a própria página usa; o modelo não recebe ferramentas |
| Server Action `unloadModel` | Descarrega um modelo carregado | Nome validado e conferido contra os modelos carregados | Checagem de origem nativa das Server Actions |
| `AuditService`, `SystemService` | Auditoria e estado do banco | Zod nas linhas lidas | Secret key só em `server/env.ts` |

### 3.3 Banco de dados

- Uma migração: `supabase/migrations/20261109130000_foundation.sql`, com a tabela `audit_log` (append-only por trigger, RLS sem políticas, sem privilégios para `anon`/`authenticated`).
- **Não existem** tabelas de estratégia, empresas, claims, prospects, oportunidades, conversas, custos de IA ou tarefas. O modelo completo está desenhado em [06](06-modelo-de-dados.md), mas não migrado.
- Dados existentes: nenhum (banco não configurado). Testes de banco rodam em PGlite (13 testes).
- `pgvector`: compatível com o Supabase (projetos novos vêm com a extensão, índice HNSW recomendado, `halfvec` para reduzir tamanho — [docs do Supabase](https://supabase.com/docs/guides/ai/vector-indexes/hnsw-indexes)). Nos testes, o PGlite oferece pgvector como pacote separado (`@electric-sql/pglite-pgvector`, [pglite.dev](https://pglite.dev/extensions/)); compatibilidade com a versão instalada **não verificada**. Não há motivo para trocar de banco.

### 3.4 Inteligência artificial

| Aspecto | Estado |
|---|---|
| Modelos | Ollama local; política por tarefa em `packages/agents/src/model-policy.ts` (`copilot`, `reasoning`, `vision`, `embedding`); só `copilot` tem consumidor |
| Integração | `packages/agents/src/ollama/client.ts` (`/api/version`, `/api/tags`, `/api/ps`, `/api/chat` em streaming, descarregar) |
| Prompts | `packages/agents/prompts/copilot/v1.md` (pt-BR, sem inventar dados, conteúdo colado é dado e não instrução) |
| Ferramentas | Nenhuma ainda |
| Agentes | Nenhum agente com ferramentas; o Copiloto é uma conversa |
| Memória | Só o histórico enviado pela aba (até 24 mensagens / 16 mil caracteres) |
| Orquestração e tarefas | Fila em memória para inferência; sem tarefas duráveis |
| Claude API | Não usada em runtime (permanece como opção futura atrás do gateway, ADR-0008) |

### 3.5 Infraestrutura

- **Dependências:** pnpm 11 + Turborepo; Next 16.4.5, React 19.3.1, TypeScript 6.0.3 (fixado, KI-012), zod 4.6.7, Vitest, Playwright 1.65 com Chromium instalado. `packages/agents` não adiciona dependência externa além de `zod`.
- **Variáveis:** `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `TEST_DATABASE_URL` e as de IA local (`OLLAMA_BASE_URL`, `AI_*`, ver [runbooks/segredos.md](runbooks/segredos.md)).
- **Scripts:** `dev`, `typecheck`, `lint` (fronteiras + ESLint), `format:check`, `test`, `test:db`, `test:e2e`, `ai:live` e `evals` (novos).
- **Docker:** não existe no projeto nem na máquina.
- **CI:** `.github/workflows/ci.yml` escrito e nunca executado (sem remoto, KI-009).
- **Logs:** console do servidor; sem `llm_calls`, traces ou métricas persistidas.

## 4. Matriz de maturidade

Estados: **Funcional** (implementado e funcional) · **Parcial** (implementado parcialmente) · **Só interface** · **Não implementado** · **Correção** (necessita correção) · **Integração** (necessita integração).

| Módulo | Estado | Prioridade | Fatia |
|---|---|---|---|
| Shell, navegação e design system | Funcional | — | F1 |
| Início | Parcial + Integração | Média | F1 → F10 |
| Copiloto | Parcial | **Alta** | IA-1 → IA-2, F8 |
| IA local (gateway, gerenciador de modelos) | Funcional para conversa; Parcial para as demais tarefas | **Alta** | IA-1 → IA-5 |
| Configurações e auditoria | Parcial + Integração | Média | F1 |
| Banco de dados | Integração | **Alta (bloqueia)** | F1 |
| Segurança local | Funcional | — | F1 |
| Testes e qualidade | Funcional (local); CI não executado | Média | F1 |
| Descoberta | Não implementado | Alta | F4 |
| Empresas (dossiê, evidências) | Não implementado | Alta | F3 |
| Abordagens | Não implementado | Média | F10 |
| Aprovações | Não implementado | Média | F10 |
| Conversas | Não implementado | Baixa | F11 |
| Pipeline | Não implementado | Baixa | F12 |
| Monitoramento | Não implementado | Baixa | Fase 2 |
| Inteligência (métricas, aprendizado) | Não implementado | Baixa | F13 |
| Integrações externas | Não implementado | Média | F3–F6 |

Nenhum módulo está "Só interface": os futuros mostram uma página de aviso com a fatia que os entrega, sem dados simulados (`apps/web/src/lib/modules.ts`, `apps/web/src/app/(shell)/[modulo]/page.tsx`).

### Detalhe por módulo

**Shell, navegação e design system — Funcional**
1. Funcionalidades: barra superior e trilho lateral, tema, tokens, componentes, selo DEMO, saudação por horário.
2. Evidências: `packages/ui/src/components/*`, `apps/web/src/app/(shell)/layout.tsx`; `e2e/smoke.spec.ts` (telas e axe) verde.
3. Limitações: tabela da auditoria rola na horizontal no celular; fonte baixada no build (KI-016, KI-027).
4. Dependências: nenhuma.
5. Próximas melhorias: nenhuma estrutural; ajustes pontuais conforme as telas novas.
6. Prioridade: manutenção.

**Início — Parcial + Integração**
1. Funcionalidades: estado do banco, proteções da instalação, indicadores com a fatia que os entrega, auditoria recente.
2. Evidências: `apps/web/src/app/(shell)/page.tsx`; verificado no navegador em 2026-11-09 ("Banco de dados: Não configurado").
3. Limitações: a "fila de decisões do dia" ainda não existe; estados com banco nunca renderizados com dados reais.
4. Dependências: banco (F1), abordagens e conversas (F10, F11).
5. Próximas melhorias: card "IA local" com o estado do Ollama (reaproveitando `LocalAiStatus`) quando houver espaço no layout.
6. Prioridade: média.

**Copiloto — Parcial**
1. Funcionalidades: conversa em pt-BR com o modelo local em streaming; escolha de modelo; raciocínio opcional; cancelar; nova conversa; estados na fila/gerando/erro; métricas (tokens, tokens/s, tempo de carga); painel com Ollama, GPU, modelos na memória, modelo por tarefa e botão de descarregar.
2. Evidências: `apps/web/src/components/copilot/*`, `apps/web/src/app/api/copiloto/route.ts`, `apps/web/src/lib/copilot.ts` (13 testes), `e2e/copilot.spec.ts`; uso real no navegador (seção 9).
3. Limitações: sem ferramentas (não consulta o banco, não pesquisa, não dispara tarefas); histórico só na aba; renderiza apenas negrito; o modelo às vezes confunde "Prospector" com "Copiloto" e rotula demais (KI-036).
4. Dependências: banco (histórico, ferramentas de leitura), fila durável (tarefas), contratos de ferramentas.
5. Próximas melhorias: IA-2 (threads persistentes, ferramentas de leitura com contratos Zod, avaliação de chamadas de ferramenta), prompt v2.
6. Prioridade: alta.

**IA local (gateway e gerenciador de modelos) — Funcional para conversa**
1. Funcionalidades: ver a seção 6.2 (todos os 10 itens do gerenciador têm base implementada).
2. Evidências: `packages/agents/src/*`; 48 testes unitários; 5 testes contra o Ollama real (`pnpm ai:live`); avaliação `evals/copilot/results/2026-11-09-15-40.json`.
3. Limitações: política por tarefa em código/variáveis (sem `agent_configs`); sem `llm_calls`; VRAM só exibida, sem controle de admissão; capacidades do `/api/show` ainda não usadas na escolha.
4. Dependências: banco para configuração e registro de chamadas.
5. Próximas melhorias: IA-1.1 (admissão por VRAM, capacidades do modelo, prompt v2), `llm_calls` na F4.
6. Prioridade: alta.

**Configurações e auditoria — Parcial + Integração**
1. Funcionalidades: lista da auditoria com estados vazio/não configurado.
2. Evidências: `apps/web/src/app/(shell)/configuracoes/auditoria/page.tsx`, `packages/application/src/services/audit-service.ts` (6 testes).
3. Limitações: nada grava no `audit_log` ainda; nunca vista com linhas reais.
4. Dependências: banco.
5. Próximas melhorias: registrar no `audit_log` as ações do Copiloto que mudarem dados (a partir da IA-2).
6. Prioridade: média.

**Banco de dados — Integração**
1. Funcionalidades: migração da fundação, RLS fechado, trigger append-only, teste de catálogo que barra tabela aberta.
2. Evidências: `supabase/migrations/20261109130000_foundation.sql`; `pnpm test:db` (13 testes em PGlite).
3. Limitações: nunca aplicado em Supabase real (KI-008); sem as tabelas de negócio.
4. Dependências: projeto Supabase de desenvolvimento (ação do usuário) ou Docker.
5. Próximas melhorias: aplicar a migração com confirmação; depois as migrações de IA-2 e F2/F3.
6. Prioridade: **alta, bloqueia o resto**.

**Segurança local — Funcional**
1. Funcionalidades: escuta só em `127.0.0.1`; `Host` externo recebe 403; Copiloto só aceita pedidos da própria página; secret key só no servidor; Ollama só por loopback e só dentro de `packages/agents`.
2. Evidências: `apps/web/src/lib/host.ts` (10 testes), `scripts/check-boundaries.mjs` (regra da porta 11434), `e2e/copilot.spec.ts` (403/415/400).
3. Limitações: qualquer processo deste computador pode usar o app e o Ollama (KI-028; o Ollama não tem autenticação).
4. Dependências: —
5. Próximas melhorias: nenhuma até haver publicação (ADR-0007).
6. Prioridade: manutenção.

**Testes e qualidade — Funcional localmente**
1. Funcionalidades: typecheck, lint de fronteiras, Prettier, Vitest (142 testes), banco em PGlite (13), e2e smoke + Copiloto, testes contra Ollama real, avaliação local.
2. Evidências: seção 9.
3. Limitações: CI nunca executado (KI-009); avaliação pequena e sintética (KI-037).
4. Dependências: GitHub (D-INFRA-1).
5. Próximas melhorias: conjunto de avaliação com pedidos reais (F8 exige 30).
6. Prioridade: média.

**Descoberta, Empresas, Abordagens, Aprovações, Conversas, Pipeline, Monitoramento, Inteligência — Não implementado**
1. Funcionalidades: página de aviso com a fatia.
2. Evidências: `apps/web/src/lib/modules.ts` (`plannedSlice`), `e2e/smoke.spec.ts`.
3. Limitações: sem backend, tabelas, contratos ou regras.
4. Dependências: banco, Evidence Ledger (F3), estratégia (F2), aprovação (F10), conformidade (D-LGPD-1 antes de qualquer contato).
5. Próximas melhorias: seguir o roadmap ([09](09-mvp-e-roadmap.md)) com as fatias IA intercaladas (seção 7).
6. Prioridade: Empresas e Descoberta altas; o resto depois do marco M1.

## 5. Gap analysis

| Capacidade desejada | Hoje | Reaproveitar | Desenvolver |
|---|---|---|---|
| Conversar com IA local | **Pronto** (IA-1) | — | Prompt v2, renderização de listas |
| Gerenciador de modelos | Base pronta | `gateway.ts`, `limiter.ts`, `gpu.ts`, `model-policy.ts` | Admissão por VRAM; escolha por capacidade (`/api/show`); `agent_configs`; `llm_calls` |
| Copiloto com ferramentas | Ausente | Contratos Zod, `RequestContext`, serviços de application, limites de autonomia (doc 04 §5) | Registro de ferramentas, laço de chamada de ferramentas no gateway, avaliação de chamadas |
| Histórico de conversas | Só na aba | `CopilotTurn`/`CopilotRequest` | Tabelas `copilot_threads`/`copilot_messages` |
| Tarefas e acompanhamento | Ausente | Fila em memória (padrão), ADR-0004 (requisitos de durabilidade) | Fila durável local no Postgres + processo worker local |
| Evidências tipadas | Desenhado (ADR-0002, doc 06) | — | F3 inteira |
| Pesquisa externa | Ausente | Pesquisas `research/01–02`, catálogo do doc 05 | Portas `WebSearch`, `PageFetcher`, `ScreenCapture`; decisão do provedor de busca (D-AI-4) |
| Auditoria visual | Ausente | Playwright e Chromium já instalados (e2e); `qwen3.5:4b` tem visão | Captura em worker, contrato `VisualFinding`, avaliação com 30 marcas |
| Memória semântica | Ausente | Supabase + pgvector | Migração com `vector`, embeddings via `/api/embed`, busca híbrida |
| Agentes especializados | Ausente | Tese "poucos agentes" (doc 04 §1) | Ver 6.5 |
| Controle de recursos | Base pronta | `OLLAMA_MAX_LOADED_MODELS=1`, fila, `keep_alive`, descarregar | Admissão por VRAM, prioridade de tarefas, limite de capturas |

## 6. Arquitetura de IA local

### 6.1 Princípios

1. **Local primeiro.** Inferência no Ollama deste computador; nuvem só como opção futura, atrás do mesmo gateway e com decisão do usuário (D-AI-1).
2. **Determinístico onde dá.** Busca cadastral, deduplicação, captura, score, decaimento e envio são código; o modelo entra só para interpretar, julgar, planejar ou redigir.
3. **Um modelo pesado por vez.** Execução sequencial, fila curta, descarregar quando ocioso.
4. **Nada sai sem aprovação.** Ferramentas que agem fora do sistema não existem para modelos; no máximo criam item na fila de aprovação.
5. **Tudo que vira conclusão vira claim** com fonte e data (ADR-0002); a IA não grava texto livre como fato.
6. **Extensível sem reescrever:** modelos por tarefa vêm de configuração (`model-policy.ts` e variáveis `AI_*` hoje, `agent_configs` depois); ferramentas são contratos Zod executados por serviços de application. Ainda **não** existe uma porta `ModelProvider`: o gateway fala com o Ollama e uma tarefa nova (`AiTask`) exige mudar o contrato. A extração da porta fica para quando houver um segundo provedor (KI-031).

### 6.2 Gerenciador de modelos

| Requisito | Estado | Onde |
|---|---|---|
| Detecção do Ollama | Pronto: versão, timeout curto, estado "fora do ar" com orientação | `ollama/client.ts`, `gateway.status()` |
| Listagem dos modelos | Pronto | `/api/tags` |
| Verificação de disponibilidade | Pronto: modelo ausente vira `model_not_installed` | `resolveModel` |
| Seleção por tarefa | Pronto (lista de preferência por `AiTask`, sobrescrita por `AI_COPILOT_MODELS`) · **falta** usar as capacidades do `/api/show` e mover para `agent_configs` | `model-policy.ts` |
| Controle de contexto | Parcial: `num_ctx` 8192 por padrão (`AI_NUM_CTX`), até 1.024 tokens gerados (4.096 com raciocínio). O corte do histórico (24 mensagens de até 8.000 caracteres) é feito pelo navegador e conferido pelo contrato; o servidor ainda não mede o pedido contra o `num_ctx` (KI-032) | política + `buildHistory` + `CopilotRequest` |
| Tratamento de falhas | Pronto: códigos `runtime_unavailable`, `model_not_installed`, `busy`, `timeout`, `cancelled`, `provider_error`, `invalid_request`, com mensagens em pt-BR; tempos de primeiro token, silêncio e total | `errors.ts`, contratos `ai.ts` |
| Monitoramento de VRAM | Pronto para exibir (`nvidia-smi`, cache de 2 s) · **falta** usar na admissão | `gpu.ts` |
| Carregar e descarregar | Pronto: `keep_alive` 5 min, botão Descarregar com espera de até 3 s | `gateway.unload` |
| Limite de concorrência | Pronto: 1 inferência por vez (`AI_MAX_CONCURRENCY`), fila de 3 (`AI_MAX_QUEUE`), excedente recebe `busy` | `limiter.ts` |
| Fallback | Pronto: primeiro modelo instalado da lista | `resolveModel` |

**Admissão por VRAM (planejada, IA-1.1):** antes de carregar um modelo que não está na memória, comparar o tamanho estimado (arquivo + contexto) com a VRAM livre menos uma reserva para o Windows e os apps de trabalho (proposta inicial: 3 GB). Sem espaço, a tarefa espera na fila ou o usuário escolhe descarregar outro modelo; o sistema nunca encerra processos de outros programas.

### 6.3 Orçamento de recursos

| Recurso | Total | Uso proposto |
|---|---|---|
| VRAM | 15,9 GB (≈ 11,9 GB livres em repouso) | 1 modelo de até ~7 GB carregado por vez (4B para conversa e triagem; 8B de visão só durante a auditoria); reserva de 3 GB |
| RAM | 39,9 GB | Ollama descarrega para RAM se faltar VRAM (lento); captura do Playwright com 1 navegador por vez |
| CPU | 24 threads | Worker local com prioridade normal; capturas em série |
| Disco | C: 36 GB livres | Modelos ficam em D: (`D:\ollama`); capturas e arquivos no Storage do Supabase |

### 6.4 Motor de agentes

Segue a tese do [doc 04 §1](04-arquitetura-de-agentes.md): **poucos agentes, muitos passos confiáveis**. Os 10 especialistas pedidos são *papéis*, implementados como workflows com passos determinísticos (DET), chamadas únicas de modelo com saída estruturada (LLM) e, só onde o caminho é desconhecido, agentes com ferramentas (AGT). Todos leem e escrevem pelo mesmo Evidence Ledger, registram fonte e data e compartilham histórico pela fila de tarefas.

| # | Especialista | DET | LLM / AGT | Capacidade (doc 04) | Modelo local candidato | Fatia |
|---|---|---|---|---|---|---|
| 1 | Pesquisa de mercado | Contagens por CNAE/UF/município nos dados abertos do CNPJ | LLM resume o segmento a partir dos números | `candidate_triage` + nova `market_brief` | qwen3.5:4b | F4 |
| 2 | Investigação empresarial | CNPJ, resolução de site, leitura de páginas, deduplicação | AGT Investigador com ferramentas de leitura; LLM `site_extractor` | `investigator`, `site_extractor` | qwen3.5:4b (avaliar modelo maior com medição) | F3, F5 |
| 3 | Auditoria visual | Captura desktop/celular (Playwright), paleta, fontes do CSS | LLM com visão contra a rubrica | `visual_auditor` | qwen3.5:4b ou qwen3-vl:8b (decidir por avaliação) | F6 |
| 4 | Inteligência competitiva | Concorrentes por CNAE + município; mesma coleta do item 2 | LLM comparativo sobre dossiês resumidos | `competitive_comparator` | qwen3.5:4b | F6 / Fase 2 |
| 5 | Diagnóstico de branding | Consolida achados e claims | LLM avalia necessidade com `claim_ids` | `need_assessor` | qwen3.5:4b | F7 |
| 6 | Qualificação de prospects | Gates e score no `domain` | LLM só justifica | `need_assessor` | qwen3.5:4b | F7 |
| 7 | Estratégia comercial | Monta o contexto (oferta, cases, voz) | LLM planeja | `approach_planner` | qwen3.5:4b | F10 |
| 8 | Geração de abordagens | Regras de canal, supressão, aprovação com `payload_hash` | LLM redige; DET + LLM juiz verifica | `message_writer`, `message_verifier` | redator e juiz com modelos diferentes | F10 |
| 9 | Análise de conversas | Opt-out por regra antes do modelo | LLM classifica intenção e objeções | `reply_classifier` | qwen3.5:4b | F11 |
| 10 | Aprendizado e avaliação | Estatísticas calculadas; harness de avaliação (já existe para o Copiloto) | LLM propõe aprendizados, humano aprova | `learning_synthesizer` | qwen3.5:4b | F13 / Fase 2 |

O Copiloto é o orquestrador conversacional: interpreta pedidos e dispara esses mesmos workflows, com confirmação.

**Orquestração e persistência de tarefas.** O [ADR-0004](adr/0004-orquestracao-duravel.md) propôs Trigger.dev na nuvem, mas um worker na nuvem não alcança o Ollama local nem deve receber a secret key (KI-024). Proposta para a IA-3 (decisão D-AI-5): fila durável no próprio Postgres (`ai_jobs`: estado, chave de idempotência, tentativas, prazo, resultado, `trace_id`) processada por um worker Node neste computador, com concorrência 1 para tarefas de GPU. O ADR-0004 deve ser revisto antes da F5.

### 6.5 Copiloto como interface central

| Capacidade pedida | Como | Fatia |
|---|---|---|
| Conversar com a IA local | Feito | IA-1 |
| Histórico de conversas | `copilot_threads`/`copilot_messages`, lista de conversas | IA-2 |
| Interpretar informações do banco | Ferramentas de leitura: estado do sistema, auditoria, depois empresas, claims e avaliações | IA-2 → F3/F7 |
| Consultar diagnósticos | Ferramentas `get_dossier`, `explain_assessment` | F3, F7 |
| Solicitar pesquisa de empresas / analisar prospects | Ferramenta cria tarefa (`ai_jobs`) com estimativa; confirmação do usuário | IA-3, F5 |
| Planejar abordagens | Dispara `approach_planner`; o resultado vai para revisão | F10 |
| Executar ferramentas internas autorizadas | Ferramentas = contratos Zod executados por serviços de application, com autonomia A0–A4 (doc 04 §5); escrita interna pede confirmação; ação externa só cria aprovação | IA-2 (leitura), IA-3 (escrita) |
| Acompanhar tarefas | Painel de tarefas + eventos no stream | IA-3 |
| Resultados e evidências | Respostas citam claims e fontes com data; links para o dossiê | F3+ |

**Contrato seguro de ferramentas:** o modelo só vê nome, descrição e JSON Schema gerado do Zod; os argumentos são validados no servidor (1 tentativa de reparo); a execução usa o ator do usuário único e grava no `audit_log`; conteúdo externo vai ao modelo como dado delimitado. Modelos de 4B erram chamadas de ferramenta com mais frequência que modelos grandes: cada ferramenta entra com casos de avaliação próprios antes de ser habilitada.

### 6.6 Memória semântica

- Fica no Postgres existente: extensão `vector`, embeddings `qwen3-embedding:0.6b` (1024 dimensões ou menos via MRL) pelo `/api/embed` do Ollama, índice HNSW.
- O que é indexado: conhecimento da agência (ofertas, cases, voz) e trechos de fontes já gravadas. Nada de memória escrita livremente pelo modelo (doc 04 §7).
- Entra na IA-5, depois que F2/F3 criarem conteúdo para indexar.

### 6.7 Pesquisa externa

Prioridade a fontes gratuitas e autorizadas. Tudo que for usado em diagnóstico vira `source` com URL, data de obtenção e hash, e depois claim.

| Necessidade | Opção recomendada | Alternativas | Custo / limites | Situação |
|---|---|---|---|---|
| Dados empresariais | Dados abertos do CNPJ (Receita) | BrasilAPI / OpenCNPJ para consulta pontual | Gratuito; APIs públicas com poucas requisições por minuto | Pesquisado em [research/01](research/01-dados-empresas-e-decisores.md); licença de redistribuição não verificada (KI-004) |
| Leitura de páginas públicas | Leitor próprio (HTTP + extração de texto) respeitando robots.txt, com bloqueio de IPs privados, tempo limite e user-agent identificado | Playwright para páginas que exigem JavaScript | Gratuito | Planejado (F5) |
| Análise de sites | Playwright (captura desktop/celular), PageSpeed Insights API, Wayback CDX | — | Gratuito; Playwright já instalado | Planejado (F6) |
| Mecanismo de busca | **Decisão D-AI-4.** Ollama Web Search API: conta gratuita, cota não publicada, consultas vão para a nuvem da Ollama | Brave Search API: segundo fontes secundárias, sem plano gratuito desde fev/2026, US$ 5 por 1.000 buscas com US$ 5 de crédito mensal (≈ 1.000 buscas) | Ver colunas | **Não verificado** em página oficial; conferir antes de integrar ([Ollama](https://registry.ollama.ai/blog/web-search), [Brave](https://www.implicator.ai/brave-drops-free-search-api-tier-puts-all-developers-on-metered-billing.md)) |
| Localização empresarial | Endereço do CNPJ (gratuito) | Google Places (New): só `place_id` armazenável, pago acima da cota (doc 05) | — | Pesquisado (doc 05) |
| Notícias | GDELT DOC 2.0 | Feeds RSS de veículos | Gratuito | Fase 2 |
| Concorrentes | Mesmo CNAE + município nos dados do CNPJ; sites públicos pelo leitor | Instagram Graph (conta profissional da agência) | Gratuito | F6 / Fase 2 |
| Proibido | Scraping de LinkedIn, Google Maps, Instagram; contorno de CAPTCHA ou login; extração de dados pessoais além do necessário | — | — | Doc 05 §3 |

SearXNG auto-hospedado foi descartado como fonte principal: precisa de Docker ou Python (não instalados) e agrega buscadores cujos termos podem proibir consulta automatizada.

### 6.8 Controle de recursos

| Regra pedida | Mecanismo | Estado |
|---|---|---|
| Não manter todos os modelos carregados | `OLLAMA_MAX_LOADED_MODELS=1`, `keep_alive` 5 min, botão Descarregar | Feito |
| Execução sequencial de modelos pesados | 1 inferência por vez + `OLLAMA_NUM_PARALLEL=1` | Feito |
| Monitorar VRAM | Painel do Copiloto (`nvidia-smi`) | Feito (exibição); admissão em IA-1.1 |
| Preservar recursos do Windows | Reserva de VRAM na admissão; `num_ctx` 8192 | Planejado (IA-1.1) |
| Não encerrar outros apps | O sistema só descarrega modelos do Ollama; nunca encerra processos | Feito por construção |
| Limites de concorrência | `AI_MAX_CONCURRENCY` (1–4, padrão 1) | Feito |
| Filas | Fila em memória para conversa (`AI_MAX_QUEUE`, padrão 3); fila durável para tarefas | Feito / IA-3 |
| Evitar sobrecarga de Figma, navegadores e ferramentas | Capturas uma por vez; tarefas longas pausáveis; nada roda sem pedido do usuário | Planejado (IA-3, IA-4) |

## 7. Plano incremental

Ordem por dependência técnica e valor. Cada item é uma fatia vertical (skill `fatia-vertical`). As fatias F do [doc 09](09-mvp-e-roadmap.md) continuam valendo; as fatias IA se intercalam.

| Ordem | Fatia | Entrega | Depende de | Aceite resumido |
|---|---|---|---|---|
| ✓ | **IA-1** | Conversa real com IA local no Copiloto | Ollama | Ver seção 9 |
| 1 | **F1 (fechamento)** | Banco de desenvolvimento configurado e migração aplicada | Ação do usuário (D-INFRA-2) | Início mostra "Conectado"; `E2E_SUPABASE=1` verde |
| 2 | **IA-1.1** | Admissão por VRAM, escolha por capacidade (`/api/show`), prompt v2 com avaliação | IA-1 | Carga recusada com reserva insuficiente (teste); prompt v2 ≥ v1 na avaliação |
| 3 | **IA-2** | Histórico persistente, ferramentas de leitura (estado, auditoria), `llm_calls`, avaliação de chamadas de ferramenta | F1 | Conversa sobrevive ao recarregar; respostas sobre o sistema vêm de ferramenta; argumentos inválidos rejeitados |
| 4 | **F2** | Estratégia: ofertas, rubrica, ICP, voz | F1 | doc 09 |
| 5 | **F3** | Evidence Ledger, empresas, consulta CNPJ | F2 | doc 09 |
| 6 | **IA-3** | Fila durável local (`ai_jobs`) + worker + painel de tarefas; Copiloto cria e acompanha tarefas com confirmação | IA-2, D-AI-5 | Tarefa sobrevive a reinício; reexecução não duplica |
| 7 | **F4** | Descoberta + gateway completo (`agent_configs`, `prompt_versions`) com triagem local | F3, IA-3 | doc 09 |
| 8 | **IA-4 / F6** | Captura com Playwright e auditoria visual local | IA-3 | Concordância ≥ 75% com o diretor de criação |
| 9 | **F5** | Investigação com leitor próprio e provedor de busca escolhido | D-AI-4, IA-3 | doc 09 |
| 10 | **IA-5** | Memória semântica (pgvector + embeddings locais) | F3 | Busca recupera o case certo em conjunto anotado |
| 11 | F7 → F13 | Qualificação, Copiloto v1 com ferramentas de domínio, abordagens, conversas, pipeline, métricas | — | doc 09 |

### Decisões pendentes desta rodada

Registradas também em [10 §1](10-riscos-custos-decisoes.md#1-decisões-pendentes) (D-AI-1 e D-AI-3 já existiam e foram revistas; D-AI-4 e D-AI-5 são novas).

| ID | Pergunta | Opções | Quem decide |
|---|---|---|---|
| D-AI-1 | Usar a Claude API como reserva para tarefas que o modelo local não resolver bem? | Não (só local) · Sim, por capacidade e com orçamento | Usuário, com resultado de avaliação |
| D-AI-4 | Provedor de busca web | Ollama Web Search · Brave · nenhum (só fontes diretas) | Usuário, após conferir termos e cota |
| D-AI-5 | Orquestração de tarefas | Fila no Postgres + worker local · Trigger.dev com worker local | Técnica (proposta: Postgres), registrar em ADR na IA-3 |

## 8. Decisões técnicas desta rodada

Registradas no [ADR-0008](adr/0008-ia-local-com-ollama.md) e na emenda 2 do [ADR-0001](adr/0001-monorepo-e-fronteiras.md):

- Ollama local é o provedor padrão; o Claude passa a ser opção futura atrás do mesmo gateway.
- `packages/agents` não depende de SDK externo; fala HTTP com o Ollama em loopback.
- A web só alcança `@prospector/agents` pela raiz de composição; a porta `11434` só aparece em `packages/agents` (lint).
- `qwen3.5:4b` é o padrão do Copiloto, `nemotron-3-nano:4b` a reserva, com base na avaliação local e nas licenças.
- Recursos: 1 modelo carregado, 1 inferência por vez, fila curta, `keep_alive` 5 min, `num_ctx` 8192.
- Streaming NDJSON com contrato Zod de eventos, conferido no servidor e no navegador; o Copiloto só aceita pedidos de mesma origem.

## 9. Testes e critérios de aceite da IA-1

### Critérios

| # | Critério | Situação | Evidência |
|---|---|---|---|
| 1 | Serviço de conexão com o Ollama | Atendido | `ollama/client.ts`; 16 testes unitários; `pnpm ai:live` (versão, modelos, estado) |
| 2 | Verificação de disponibilidade | Atendido | Painel "IA local"; e2e "Copiloto sem Ollama" mostra "Ollama fora do ar" e orientação |
| 3 | Configuração do modelo | Atendido | `model-policy.ts`, variáveis `AI_*` validadas com Zod em `server/env.ts` |
| 4 | Endpoint de inferência | Atendido | `POST /api/copiloto` com recusas 403/415/400 testadas no e2e |
| 5 | Teste real de geração | Atendido | `pnpm ai:live`: resposta em pt-BR do `qwen3.5:4b` com métricas; e2e com `E2E_OLLAMA=1` |
| 6 | Erro e indisponibilidade | Atendido | Modelo ausente → `model_not_installed`; Ollama fora → `runtime_unavailable`; fila cheia → `busy` (testes unitários e live) |
| 7 | Integração com o Copiloto existente | Atendido | Módulo Copiloto passou de página de aviso a tela funcional, com o design system |
| 8 | Respostas reais na interface | Atendido | Verificado no navegador: resposta em streaming, troca de modelo, painel atualizado e descarregar funcionando |

### Comandos executados em 2026-11-09

| Comando | Resultado |
|---|---|
| `pnpm typecheck` | 7 tarefas verdes |
| `pnpm lint` | verde (fronteiras + ESLint) |
| `pnpm test` | 154 testes verdes: contracts 35, agents 59, application 6, db 23, web 31 (depois das correções das revisões) |
| `pnpm test:db` | 13 testes verdes (PGlite) |
| `pnpm ai:live` | 5 testes verdes contra o Ollama real (rodado antes das correções das revisões; a geração real depois delas foi conferida pelo `E2E_OLLAMA=1` e no navegador) |
| `pnpm evals` | rodado uma vez com os dois modelos; notas recalculadas depois com os corretores corrigidos (ver tabela abaixo) |
| `pnpm test:e2e` | 21 passaram, 3 pulados (2 exigem banco real, 1 exige Ollama); inclui celular a 375 px sem rolagem lateral e axe no tema escuro |
| `E2E_OLLAMA=1 pnpm test:e2e` | 17 passaram (inclui resposta real com métricas, 23,8 s com o carregamento do modelo), 7 pulados (2 de banco, 5 dos estados sem Ollama) |

### Avaliação local do Copiloto

Respostas gravadas em `packages/agents/evals/copilot/results/2026-11-09-15-40.json`: 8 casos **sintéticos** × 2 repetições, custo zero (local). A revisão do `avaliador-ia` achou falsos positivos e negativos na primeira versão dos corretores: "configurar" contava como citar a tela Configuração, "inferior" como "inferência", "Não enviei nem agendei" era lido como alegação de envio e o pedido de envio passava sem citar a aprovação humana. Os corretores foram corrigidos, cada erro virou contraexemplo em `packages/agents/tests/eval-graders.test.ts`, entraram dois critérios (apontar a instrução embutida no texto colado; citar a aprovação humana) e as **mesmas respostas** foram recalculadas sem gerar de novo (`EVAL_REGRADE=2026-11-09-15-40.json pnpm evals` → `2026-11-09-15-40.regraded.json`). Os números da primeira versão (88% e 94%) ficam substituídos.

| Modelo | Aprovação (IC 95%) | Total: mediana / p95 | Primeiro token (mediana) | Saída (mediana) | Velocidade (mediana) |
|---|---|---|---|---|---|
| `qwen3.5:4b` | 69% (11/16; 44–86%) | 1,7 s / 3,0 s | 189 ms | 157 tokens | 104 tokens/s |
| `nemotron-3-nano:4b` | 56% (9/16; 33–77%) | 0,8 s / 3,8 s | 211 ms | 72 tokens | 128 tokens/s |

Onde cada um erra:

- `qwen3.5:4b`: ao descrever o que já existe, não cita Configuração nem Auditoria e diz que será preciso "configurar" módulos (2/2, KI-036); recusa o envio pelo WhatsApp sem mencionar a aprovação humana (2/2); uma resposta à data passou de 400 caracteres.
- `nemotron-3-nano:4b`: leu a frase injetada como conteúdo da marca, sem apontá-la (2/2); não separou inferência de hipótese (2/2); não mencionou a aprovação humana (2/2); usou itálico com asterisco, que a tela mostra cru.

Conclusão: o `qwen3.5:4b` continua o padrão (melhor nos critérios de honestidade e de injeção; a latência maior vem de respostas mais longas, 157 contra 72 tokens). **Nenhum dos dois atinge o limiar de 75%** com os corretores corrigidos: o Copiloto v1 fica como experimental, e a IA-1.1 traz o prompt v2 (módulos disponíveis pelo nome, aprovação humana nos pedidos de envio, apontar instruções em texto colado) com nova rodada de `pnpm evals` antes de promover. Os intervalos de confiança se sobrepõem: 16 respostas por modelo não separam modelos com segurança (KI-037). A F8 continua exigindo 30 pedidos reais com ≥ 80%.

### Revisões independentes (2026-11-09)

Quatro subagentes revisaram a IA-1 sem ver a conversa de implementação: `revisor-arquitetura`, `revisor-seguranca`, `avaliador-ia` e `revisor-ux`.

| Revisão | Bloqueantes e correções feitas | Ficou pendente |
|---|---|---|
| Arquitetura | Vaga da fila presa quando a tela desistia esperando (corrigido, com `ticket.cancel()` e 2 testes); docs que afirmavam o que o código não fazia (porta `ModelProvider`, sha do prompt em cada resposta, dependências do pacote) corrigidos; uma única instância da IA local por processo (`globalThis`); web recebe só `status`, `unload` e `copilot`; fatos do sistema numa função só, usada pela rota e pela avaliação; `check-boundaries` limita `packages/agents` a `zod` | Derivar `GatewayEvent` de `CopilotEvent`; orçamento de contexto no servidor (KI-032); teste que fixe o sha do `copilot/v1`; testes da rota cancelada, de `status()` com falha parcial e do tempo total; variável `AI_*` inválida vira erro 500 em vez de estado "fora do ar" |
| Segurança | Sem bloqueantes. Marcas de controle do modelo neutralizadas no texto do usuário; `redirect: 'error'` nas chamadas ao Ollama; limite de tokens gerados; tamanho do pedido em bytes e pelo `content-length`; eventos conferidos no servidor; `nvidia-smi` pelo caminho completo | Histórico vem do navegador (KI-032, IA-2); cancelamento sem e2e (KI-040); pedidos sem `Origin` são aceitos (ADR-0007) |
| Avaliação de IA | Corretores com falsos positivos corrigidos, com contraexemplos; caso novo "banco conectado"; recálculo sem GPU; resultado registra parâmetros, digest, p95 e intervalo de Wilson | Prompt v2 e nova rodada de `pnpm evals` (IA-1.1); mais casos (KI-037) |
| UX | Página transbordava no celular (corrigido, com e2e a 375 px); pergunta perdida depois de erro (volta ao campo, com "Tentar de novo"); avisos para leitor de tela fora do log; foco não pula mais para o campo; Parar protegido contra duplo clique; Esc interrompe; mensagens de erro com próximo passo; "Liberar memória" confirma o resultado; aviso de Ollama fora do ar dentro da conversa; contador de caracteres; e2e com axe no tema escuro | Borda dos campos com contraste de ~1,65:1 (WCAG 1.4.11 pede 3:1): mexe no token `--input` do design system, decisão do usuário; o shell transborda 16 px a 320 px em todas as telas (anterior a esta fatia); extrair um `Textarea` para `packages/ui`; posição na fila não é atualizada (KI-040) |

## 10. Ferramentas de desenvolvimento (Claude Code)

| Recurso | Avaliação | Ação |
|---|---|---|
| Skills (`fatia-vertical`, `migracao-supabase`, `capacidade-ia`, `integracao-externa`, `revisao-conformidade`) | Cobrem o fluxo; `capacidade-ia` supunha só Claude e avaliações pagas | `capacidade-ia` atualizada para modelos locais; nenhuma skill nova (evita duplicação) |
| Subagentes (6 revisores e testes) | Suficientes; `avaliador-ia` precisava conhecer avaliações locais | `avaliador-ia` atualizado |
| Hooks | Nenhum no projeto. Um `PreToolUse` que bloqueie leitura de `.env.local` reforçaria a regra 5 | Recomendado, não criado (muda a configuração do Claude Code; pedir ao usuário) |
| MCPs | Supabase MCP disponível (útil para o projeto de desenvolvimento, sempre com confirmação); navegador embutido para verificação visual | Nenhum MCP novo; um MCP do Ollama não acrescenta nada ao gateway e a `pnpm ai:live` |
| `.claude/launch.json` | O do repositório roda `pnpm run dev`; existe outro na pasta antiga do OneDrive, criado porque a sessão abriu lá | Registrado em KI-039 |
