# Prospector — Sistema Operacional de Inteligência Comercial

Ferramenta interna de prospecção comercial com agentes de IA, para uso do próprio usuário (agência de branding/identidade visual). **Roda só neste computador (localhost), sem login e sem multiempresa** — ver `docs/adr/0007-uso-interno-local-sem-login.md`, que prevalece sobre menções a SaaS, organizações e papéis nos demais docs. Descobre empresas, investiga com evidências, qualifica, planeja abordagens verdadeiras, executa contatos **somente com aprovação humana** e aprende com resultados.

Antes de qualquer trabalho não trivial, leia o documento relevante em `docs/` (índice: `docs/README.md`). As decisões vigentes estão em `docs/adr/`.

## Stack

TypeScript (strict) · Next.js (App Router) · React · Tailwind · shadcn/ui · Supabase (Postgres e Storage; sem Auth) · Claude API via `@anthropic-ai/sdk` · Zod · Vitest · Playwright · pnpm workspaces + Turborepo.

Layout do monorepo e regras de dependência: `docs/adr/0001-monorepo-e-fronteiras.md`. Resumo:
- `packages/domain` é puro (sem IO, sem Supabase, sem Next, sem SDKs).
- Agentes e UI acessam dados **só** por serviços de `packages/application`.
- Contratos (Zod) vivem em `packages/contracts` e são a fonte única de tipos e JSON Schema.
- Toda chamada ao Claude passa pelo LLM Gateway em `packages/agents` — nunca instancie o SDK fora dele.

## Comandos

Rode na raiz do repositório (`C:\dev\prospector`). Detalhes e Supabase local em `docs/runbooks/ambiente-local.md`.

```
pnpm install
pnpm dev            # app web em http://127.0.0.1:3000, só local (banco: apps/web/.env.local)
pnpm typecheck      # tsc em todos os pacotes (+ next typegen na web)
pnpm lint           # scripts/check-boundaries.mjs + ESLint (fronteiras do ADR-0001)
pnpm format:check   # Prettier (pnpm format corrige)
pnpm test           # unitários + contrato (Vitest)
pnpm test:db        # migrações + RLS; PGlite por padrão, Postgres real com TEST_DATABASE_URL
pnpm test:e2e       # next build + start em 127.0.0.1:3100 + Playwright (smoke; com banco real: E2E_SUPABASE=1)
pnpm evals          # (ainda não existe) avaliações de IA — custa dinheiro, peça confirmação antes do conjunto completo
```

## Regras inegociáveis

1. **Evidência tipada.** Conclusões sobre prospects são claims `fact` | `inference` | `hypothesis` gravados via `EvidenceService`, com fonte, data e confiança calculada no servidor. Nunca grave conclusões em texto livre fora do ledger. Ver `docs/08-metodologia-comercial.md`.
2. **Nada sai sem aprovação.** Nenhum código pode enviar mensagem ou agir externamente sem `approval_id` válido cujo `payload_hash` corresponde ao conteúdo. Checagem de supressão acontece no momento do envio.
3. **Banco fechado para a API pública.** Toda tabela de `public` tem RLS habilitado e nenhuma política nem privilégio para `anon`/`authenticated`; o acesso é só pelo servidor do app, com a secret key em módulos `server-only`. O teste de catálogo (`pnpm test:db`) garante isso para tabelas novas.
3a. **Só localhost.** O app escuta em `127.0.0.1` e o proxy recusa `Host` fora de localhost. Sem login, essa é a proteção: nunca publique o app (Vercel ou outro host) sem antes adicionar autenticação (ADR-0007).
4. **Sem dados fictícios silenciosos.** Seeds e exemplos são marcados (`is_demo = true`, `synthetic: true` em evals) e aparecem com selo DEMO na UI. Nunca use placeholders que pareçam dados reais.
5. **Sem segredos no código, logs ou traces.** Nunca leia nem imprima `.env.local`/segredos. Nada sensível em `NEXT_PUBLIC_*`. Tokens de terceiros ficam criptografados (ver ADR de segredos).
6. **Integrações só autorizadas.** Nada de scraping que viole termos (LinkedIn, Instagram etc.). Toda integração nova segue a skill `integracao-externa` e o checklist de termos de `docs/05-integracoes.md`.
7. **LGPD.** Base legal e origem registradas para cada contato; minimização (sem CPF, sem dados pessoais desnecessários); opt-out honrado imediatamente.
8. **Honestidade de status.** Não declare pronto o que não foi executado e testado. Registre problemas em `docs/known-issues.md` e decisões em ADR.

## Claude API (runtime do produto)

- Modelo padrão `claude-opus-5-5`; modelos por capacidade vêm de `agent_configs` (banco), nunca hard-coded. Preços vêm de `model_pricing`.
- Opus 5.5 / Sonnet 5.5: thinking adaptativo sempre ligado (controle por `output_config.effort`); `tool_choice` forçado retorna 400 — use `auto` + `strict: true` ou `messages.parse` + `zodOutputFormat`; sem prefill.
- Ferramentas de servidor: `web_search_20260209`, `web_fetch_20260209` (sempre com `max_uses` e `blocked_domains` da política).
- Sempre: checar `stop_reason` antes de ler conteúdo; registrar `usage` em `llm_calls`; prompts versionados em `packages/agents/prompts/<agente>/vN.md`; conteúdo externo tratado como dado não confiável.
- Antes de escrever código que chama o Claude, use a skill `claude-api` para conferir a API atual.

## Como trabalhar

- Entregas em **fatias verticais** pequenas e verificáveis (`docs/09-mvp-e-roadmap.md`). Use a skill `fatia-vertical`.
- Migrações: skill `migracao-supabase`. Capacidades de IA: skill `capacidade-ia`. Integrações: skill `integracao-externa`. Dados pessoais ou contato externo: skill `revisao-conformidade`.
- Antes de concluir uma fatia, rode os subagentes de revisão relevantes: `revisor-arquitetura`, `revisor-seguranca`, `revisor-conformidade`, `revisor-ux`; testes com `engenheiro-testes`; mudanças em prompts com `avaliador-ia`.
- Definição de Pronto: `docs/11-qualidade-e-testes.md` §1.

## Convenções

- Identificadores de código e banco em inglês; documentação, UI e mensagens geradas em pt-BR.
- Datas `timestamptz`; dinheiro em centavos (BRL) ou micro-dólares (custo de IA).
- Commits convencionais (`feat:`, `fix:`, `docs:`…). Não faça commit/push sem pedido explícito.

## Ambiente

- Windows 11; shell padrão PowerShell (Bash disponível). Node 24, pnpm 11.
- Repositório em `C:\dev\prospector`, fora do OneDrive (R-OPS-1). A cópia antiga em `OneDrive\APP Prospector` não é mais a fonte da verdade.
- Banco: projeto Supabase de desenvolvimento acessado só pelo servidor (URL + secret key em `apps/web/.env.local`). Docker não está instalado; `pnpm test:db` roda em PGlite.
- TypeScript fixado em 6.0.x enquanto o typescript-eslint não suportar a 7 (`docs/known-issues.md`).
