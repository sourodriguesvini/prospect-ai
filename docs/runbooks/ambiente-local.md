# Runbook — ambiente local

> Fatia F1 · 2026-11-09. Estado: os passos sem Supabase foram executados nesta máquina; os passos com Supabase local **ainda não foram executados** (Docker não instalado — KI-002).

## 1. Pré-requisitos

| Ferramenta | Versão | Observação |
|---|---|---|
| Node.js | 24 (ver `.nvmrc`) | |
| pnpm | 11 (campo `packageManager` do `package.json`) | `corepack enable` ativa a versão certa |
| Git | qualquer recente | |
| Docker Desktop | recente | Só para Supabase local (D-INFRA-2) |
| Supabase CLI | recente | `npm i -g supabase` ou instalador oficial; só para Supabase local |

O repositório fica **fora do OneDrive** (`C:\dev\prospector`, decisão R-OPS-1). Sincronizar `node_modules` trava arquivos e deixa tudo lento.

## 2. Primeira execução (sem Supabase)

```bash
pnpm install
pnpm typecheck
pnpm lint
pnpm test
pnpm test:db
pnpm --filter @prospector/web exec playwright install chromium
pnpm test:e2e
```

- `pnpm test:db` usa **PGlite** (Postgres 18 em WebAssembly) com um shim dos papéis e do schema `auth` do Supabase (`packages/db/tests/support/supabase-shim.sql`). Não precisa de Docker. Aplica todas as migrações de `supabase/migrations` e roda os testes de catálogo, isolamento e papéis.
- `pnpm test:e2e` faz `next build` + `next start` na porta 3100 com variáveis de placeholder e roda o **smoke** (telas públicas, redirecionamentos, cabeçalhos de segurança, acessibilidade). O fluxo completo (`e2e/tenancy.spec.ts`) é pulado sem Supabase.

## 3. Supabase local (fluxo completo)

> Não executado ainda. Ao executar pela primeira vez, registre o resultado em `docs/known-issues.md`.

1. Instale Docker Desktop e a Supabase CLI.
2. Confira `supabase/config.toml` contra a versão da CLI: rode `supabase init` em uma pasta temporária e compare (o arquivo do projeto foi escrito à mão).
3. Suba o ambiente e aplique as migrações:

   ```bash
   supabase start
   supabase db reset
   ```

4. Pegue os valores locais com `supabase status` e crie `apps/web/.env.local` a partir de `apps/web/.env.example`:
   - `NEXT_PUBLIC_SUPABASE_URL` = API URL
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` = publishable key
   - `NEXT_PUBLIC_SITE_URL` = `http://localhost:3000`
   - `SUPABASE_SECRET_KEY` = secret key (**só** para os testes E2E; a aplicação web não lê)
   - `TEST_DATABASE_URL` = DB URL
5. Rode o app: `pnpm dev` → http://localhost:3000. E-mails de confirmação chegam na caixa local (http://127.0.0.1:54324).
6. Testes contra o Supabase real:

   ```bash
   pnpm test:db
   ```

   ```bash
   E2E_SUPABASE=1 pnpm test:e2e
   ```

   Com `TEST_DATABASE_URL` definido, `pnpm test:db` roda contra o Postgres local em vez do PGlite (arquivos em série). No PowerShell, defina as variáveis com `$env:E2E_SUPABASE = '1'` antes do comando.

## 4. Projeto Supabase na nuvem (desenvolvimento)

Alternativa ao Docker (D-INFRA-2 b). Criar o projeto custa dinheiro e é feito pela pessoa responsável pela conta, não pelo agente.

- Região: `sa-east-1` (São Paulo). Modelo novo de chaves (publishable/secret) e JWT assimétrico (ADR-0006).
- Auth → URL Configuration: `Site URL` = URL do ambiente; `Redirect URLs` com URLs **exatas** (ex.: `<site>/auth/confirm`). O curinga `/**` de `supabase/config.toml` vale só para o ambiente local.
- O link do e-mail abre a página `/auth/confirm`, que pede um clique em "Confirmar e entrar": a sessão só é criada nesse POST (impede login forçado por link de terceiros e antivírus de e-mail que consomem o token).
- Antes de abrir o cadastro ao público: CAPTCHA, limites de taxa e SMTP próprio (KI-018).
- Auth → Email Templates → Confirm signup: use o conteúdo de `supabase/templates/confirmation.html` (link com `token_hash`, funciona em qualquer navegador).
- Auth → Providers → Email: senha mínima 10 caracteres; confirmação de e-mail ligada.
- Migrações em projeto remoto de desenvolvimento só com confirmação explícita; nunca em produção a partir do agente (skill `migracao-supabase`).

## 5. Problemas comuns

| Sintoma | Causa provável | O que fazer |
|---|---|---|
| "Variáveis de ambiente ausentes ou inválidas: …" | `.env.local` faltando ou incompleto | Copie `apps/web/.env.example` e preencha (seção 3) |
| Login retorna "Não foi possível falar com o serviço de autenticação" | Supabase parado ou URL errada | `supabase status`; confira `NEXT_PUBLIC_SUPABASE_URL` |
| Link de confirmação volta para "/entrar?erro=link" | Template padrão (PKCE) aberto em outro navegador, ou link expirado | Use o template do projeto (seção 4) ou abra no mesmo navegador |
| `pnpm install` lento ou com arquivos travados | Pasta sincronizada pelo OneDrive | Mova o repositório para fora do OneDrive |
