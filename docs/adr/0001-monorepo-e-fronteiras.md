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

## Emenda — implementação na F1 (2026-11-09)

Ajustes feitos ao implementar a fundação, verificados por `pnpm lint` (`scripts/check-boundaries.mjs` + `no-restricted-imports` em `eslint.config.mjs`):

1. **web → domain** permitido, provisoriamente, para funções puras usadas só para exibir ou ocultar controles (ex.: `canManageMembers`). A autorização efetiva continua no serviço de aplicação e no banco (RLS + RPCs). Antes da F8, `TenancyService` passa a devolver as permissões prontas e web → domain fica restrito a auxiliares de UX puros como `suggestSlug` (KI-023).
2. **web → db** permitido **apenas** em `apps/web/src/server/container.ts`, a raiz de composição que liga serviços a adaptadores. Qualquer outro import de `@prospector/db` na web falha no lint.
3. **Supabase na web** fica confinado a `src/server/supabase.ts` (cliente da requisição), `src/server/auth.ts` (fachada de autenticação: entrar, cadastrar, confirmar e-mail, sair), `src/server/session.ts`, `src/server/container.ts` e `src/proxy.ts`. Páginas e Server Actions não importam `@supabase/*` nem o cliente; o lint (`no-restricted-imports`) e `scripts/check-boundaries.mjs` (que também resolve imports relativos) barram o contorno.
4. **Autenticação** fica na camada web, atrás da fachada do item 3. Ainda não há porta de identidade em `application`. O gatilho para criá-la é o **MFA obrigatório para owner/admin** (D-AUTH-1, KI-010), que depende do papel do usuário; também o registro de consentimento no cadastro e a auditoria de login.
5. Pacotes internos são publicados como código-fonte TypeScript (`exports` → `src/index.ts`), sem etapa de build; o Next transpila via `transpilePackages`.
6. `contracts` e `application` só podem depender externamente de `zod`; `domain` de nada além de `contracts`. Em `domain` e `contracts`, o lint também proíbe globais de IO, relógio e aleatoriedade (`fetch`, `process`, `Date.now()`, `new Date()`, `Math.random()`…): esses valores entram por parâmetro.
7. Ferramenta adotada: `no-restricted-imports` + `no-restricted-globals` do ESLint e o script próprio `scripts/check-boundaries.mjs` (grafo de `package.json`, imports relativos, confinamentos dos itens 2 e 3), em vez de `eslint-plugin-boundaries` ou `dependency-cruiser`.
8. Tipos do banco ainda escritos à mão, validados com Zod (KI-011). Para compensar, as RPCs são chamadas só pelo mapa `RPC_SIGNATURES` (`packages/db/src/rpc.ts`), que um teste de catálogo compara com `pg_proc`, e um teste exige que toda chave `raise exception` do SQL tenha mensagem em `ERROR_MESSAGES`.

Pendente antes da F4: ADR sobre como workers e agentes acessam o banco (service role com `org_id` obrigatório ou JWT em nome do usuário) e como ator e trace chegam ao `audit_log` (KI-024). O status deste ADR passa a "Aceito" quando o CI rodar pela primeira vez com estas regras.

## Alternativas consideradas

- **App Next.js único com pastas**: mais rápido no início, fronteiras só por convenção; rejeitado pelo requisito explícito de separação.
- **Microsserviços**: desproporcional para o estágio; rejeitado.
