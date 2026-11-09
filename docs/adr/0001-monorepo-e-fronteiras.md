# ADR-0001 — Monorepo com fronteiras explícitas entre frontend, domínio, dados, integrações e agentes

- Status: **Proposto**
- Data: 2026-11-09

## Contexto

O briefing exige separar frontend, domínio, banco, integrações e execução de agentes, e permitir novas ofertas/serviços sem reconstruir módulos centrais. Equipe pequena, uma aplicação Next.js principal e workers assíncronos.

## Decisão

Monorepo **pnpm workspaces + Turborepo** com pacotes de responsabilidade única e regras de dependência verificadas por lint:

```
apps/
  web/                Next.js (App Router): UI, Server Actions, Route Handlers, webhooks
  worker/             Funções/tarefas do workflow engine (se o engine exigir runtime próprio)
packages/
  contracts/          Schemas Zod (fonte única de tipos e JSON Schema)
  domain/             Regras puras: score, gates, confiança, decaimento, dedupe, políticas. Sem IO.
  application/        Serviços de aplicação (casos de uso) + portas (interfaces) para dados e provedores
  db/                 Cliente Supabase, repositórios (implementam portas), tipos gerados
  integrations/       Adapters de provedores (CNPJ, Places, captura, busca, e-mail…) — implementam portas
  agents/             LLM gateway, capacidades, agentes, ferramentas, prompts versionados, evals
  workflows/          Definições de workflows (orquestram application + agents)
  ui/                 Tokens de design e componentes compartilhados (shadcn tematizado)
  config/             tsconfig, eslint, prettier compartilhados
supabase/
  migrations/  seed/  tests/
docs/
```

Regras de dependência (direção única):

```
web → application, contracts, ui
workflows → application, agents, contracts
agents → application (via portas/ferramentas), contracts
application → domain, contracts  (portas definidas aqui)
db, integrations → application (implementam portas), contracts
domain → contracts (apenas tipos)
```

- `domain` não importa Supabase, Next, SDKs de IA ou de provedores.
- Agentes acessam dados **apenas** por serviços de aplicação (as mesmas regras e permissões da UI).
- Nova oferta = dados (oferta, rubrica, ICP, sinais) — sem novo código; nova integração = novo adapter atrás de porta existente.

## Consequências

- (+) Testabilidade do núcleo sem infraestrutura; troca de provedores sem tocar no domínio.
- (+) Fronteiras verificáveis em CI (`eslint-plugin-boundaries` ou `dependency-cruiser`).
- (−) Mais cerimônia inicial que um app único; mitigado por skills de scaffolding.
- (−) Pastas no OneDrive: `node_modules` de monorepo gera milhares de arquivos — ver risco R-OPS-1 em [10-riscos-custos-decisoes.md](../10-riscos-custos-decisoes.md).

## Emenda — implementação na F1 (2026-11-09, revista pelo ADR-0007)

Ajustes feitos ao implementar a fundação, verificados por `pnpm lint` (`scripts/check-boundaries.mjs` + `no-restricted-imports` em `eslint.config.mjs`). A primeira versão (multiempresa, com login) está no commit `a5f6c51`; esta é a versão de uso interno local do [ADR-0007](0007-uso-interno-local-sem-login.md).

1. **web → db** permitido **apenas** em `apps/web/src/server/container.ts`, a raiz de composição que liga serviços a adaptadores. Qualquer outro import de `@prospector/db` na web falha no lint.
2. **Supabase não entra na web.** O cliente (`createServerSupabaseClient`, secret key, sem sessão) vive em `@prospector/db`; a web não declara `@supabase/*` no `package.json` nem o importa. As credenciais (`process.env.SUPABASE_*`) só são lidas em `apps/web/src/server/env.ts` (módulo `server-only`), e a web não usa variáveis `NEXT_PUBLIC_*`. O lint e `scripts/check-boundaries.mjs` barram o contorno.
3. **Sem autenticação nem porta de identidade.** O ator das chamadas da interface é sempre o usuário único (`{ type: 'user' }`); agentes e processos do sistema se identificam no `RequestContext` (`agent`/`runId`, `component`), e o `AuditService` grava ator e `traceId` no `audit_log`.
4. Pacotes internos são publicados como código-fonte TypeScript (`exports` → `src/index.ts`), sem etapa de build; o Next transpila via `transpilePackages`.
5. `contracts` e `application` só podem depender externamente de `zod`; `domain` de nada além de `contracts`. Em `domain` e `contracts`, o lint também proíbe globais de IO, relógio e aleatoriedade (`fetch`, `process`, `Date.now()`, `new Date()`, `Math.random()`…): esses valores entram por parâmetro.
6. Ferramenta adotada: `no-restricted-imports` + `no-restricted-globals` do ESLint e o script próprio `scripts/check-boundaries.mjs` (grafo de `package.json`, imports relativos, confinamentos dos itens 1 e 2), em vez de `eslint-plugin-boundaries` ou `dependency-cruiser`.
7. Tipos do banco ainda escritos à mão, validados com Zod em tempo de execução (`packages/db/src/audit-rows.ts`, KI-011). Um teste exige que toda chave `raise exception` do SQL tenha mensagem em `ERROR_MESSAGES` ou esteja na lista explícita de chaves internas (`packages/db/src/sql-errors.ts`).

O status deste ADR passa a "Aceito" quando o CI rodar pela primeira vez com estas regras.

## Emenda 2 — pacote `agents` e IA local (2026-11-09, [ADR-0008](0008-ia-local-com-ollama.md))

1. `packages/agents` existe e depende só de `@prospector/contracts` e `zod`. `scripts/check-boundaries.mjs` recusa qualquer outra dependência externa (`ALLOWED_EXTERNAL`); um SDK de IA novo precisa entrar nessa lista por decisão registrada. O ESLint proíbe nele `@prospector/db`, `@prospector/ui`, `@prospector/web`, Next e React. Quando os agentes precisarem de dados, a dependência será `@prospector/application` (serviços), nunca `@prospector/db`.
2. **web → agents** só pela raiz de composição (`apps/web/src/server/container.ts`, função `getLocalAi`), como já valia para `db` (item 1 da emenda anterior).
3. Endereços da API do Ollama (porta `11434`) só podem aparecer em arquivos de `packages/agents` (regra 7 de `scripts/check-boundaries.mjs`, que lê arquivos `.ts`, `.tsx`, `.mts` e `.mjs`). A web recebe a URL por `OLLAMA_BASE_URL`, lida em `src/server/env.ts`.
4. Contratos de IA (`AiTask`, `AiErrorCode`, `CopilotRequest`, `CopilotEvent`, `AiRuntimeStatus`) ficam em `packages/contracts/src/ai.ts`, compartilhados pela rota, pelo cliente e pelo gateway.
5. Avaliações (`packages/agents/evals/**`) e testes contra o Ollama real (`packages/agents/tests/live/**`) podem imprimir no console (exceção do ESLint) e ficam fora de `pnpm test`.

## Alternativas consideradas

- **App Next.js único com pastas**: mais rápido no início, fronteiras só por convenção; rejeitado pelo requisito explícito de separação.
- **Microsserviços**: desproporcional para o estágio; rejeitado.
