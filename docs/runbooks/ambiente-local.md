# Runbook — ambiente local

> Fatia F1 · 2026-11-09, revista pelo [ADR-0007](../adr/0007-uso-interno-local-sem-login.md) (uso interno, só neste computador, sem login). Estado: os passos sem banco (seção 2) foram executados nesta máquina; os passos com banco (seções 3 e 4) **ainda não foram executados**.

## 1. Pré-requisitos

| Ferramenta | Versão | Observação |
|---|---|---|
| Node.js | 24 (ver `.nvmrc`) | |
| pnpm | 11 (campo `packageManager` do `package.json`) | `corepack enable` ativa a versão certa |
| Git | qualquer recente | |
| Projeto Supabase de desenvolvimento | — | Opção recomendada sem Docker (seção 3) |
| Docker Desktop + Supabase CLI | recentes | Só para a opção de Supabase local (seção 4) |

O repositório fica **fora do OneDrive** (`C:\dev\prospector`, decisão R-OPS-1). Sincronizar `node_modules` trava arquivos e deixa tudo lento.

## 2. Primeira execução (sem banco)

```bash
pnpm install
pnpm typecheck
pnpm lint
pnpm test
pnpm test:db
pnpm --filter @prospector/web exec playwright install chromium
pnpm test:e2e
pnpm dev
```

- `pnpm dev` abre o app em **http://127.0.0.1:3000** (só este computador). Sem banco configurado, a tela inicial mostra "Banco de dados: Não configurado" e a auditoria avisa o mesmo; nada quebra.
- O app recusa com 403 qualquer `Host` que não seja `localhost`, `127.0.0.1` ou `[::1]`. Não exponha a porta na rede nem publique o app: não há login (ADR-0007).
- `pnpm test:db` usa **PGlite** (Postgres 18 em WebAssembly) com um shim dos papéis do Supabase (`packages/db/tests/support/supabase-shim.sql`). Não precisa de Docker. Aplica todas as migrações de `supabase/migrations` e roda os testes de catálogo e do `audit_log`.
- `pnpm test:e2e` faz `next build` + `next start` em `127.0.0.1:3100` com o banco **desligado de propósito** (variáveis vazias sobrepõem o `.env.local`) e roda o smoke: telas, estados sem banco, recusa de host externo, cabeçalhos e acessibilidade. `e2e/database.spec.ts` é pulado. Em seguida sobe o mesmo build em `127.0.0.1:3110` no **modo memória** e roda `e2e/strategy.spec.ts` (fluxo completo da F2). A porta 3110 precisa estar livre: esse servidor nunca é reaproveitado, para começar sem dados.

### Modo memória (experimentar as telas sem banco)

```bash
PROSPECTOR_STORAGE=memory pnpm dev
```

No PowerShell: `$env:PROSPECTOR_STORAGE = 'memory'; pnpm dev`. Prefira a variável na linha de comando a gravá-la no `.env.local`: com ela, o app ignora o banco configurado (e avisa no log do servidor).

- Estratégia, conformidade, abordagens e auditoria gravam na memória do servidor. **Tudo some quando o app reinicia.** Cada tela mostra esse aviso, e o estado do banco aparece como "Modo memória".
- **Abordar fica sempre bloqueado** nesse modo (item "Banco de dados persistente"): uma LIA aprovada que some ao reiniciar não pode liberar contato com pessoas.
- Não há dados de exemplo: o app começa vazio (ADR-0009).
- Use só para testar telas. Trabalho real precisa do banco (§3 ou §4).

## 3. Banco: projeto Supabase de desenvolvimento (recomendado)

> Não executado ainda. Criar o projeto é feito por você no painel (pode ter custo); o agente não cria contas nem projetos. Ao executar pela primeira vez, registre o resultado em `docs/known-issues.md`.

1. Crie um projeto em https://supabase.com (região `sa-east-1`, São Paulo). Use só para desenvolvimento.
2. Aplique a migração `supabase/migrations/20261109130000_foundation.sql`:
   - pelo **SQL Editor** do painel (cole o arquivo e execute), ou
   - pela CLI: `supabase link --project-ref <ref>` e `supabase db push`.

   Pelo agente, só com sua confirmação explícita (skill `migracao-supabase`).
3. Em Project Settings → API Keys, crie uma **secret key** (`sb_secret_…`). Ela ignora o RLS: trate como senha.
4. Crie `apps/web/.env.local` a partir de `apps/web/.env.example`:
   - `SUPABASE_URL` = Project URL (`https://<ref>.supabase.co`)
   - `SUPABASE_SECRET_KEY` = a secret key do passo 3
5. Reinicie `pnpm dev`. A tela inicial deve mostrar **Conectado**. Se mostrar "Migrações pendentes", volte ao passo 2.
6. A Data API do Supabase continua exposta na internet, mas o banco é fechado para ela: toda tabela tem RLS sem políticas e nenhum privilégio para `anon`/`authenticated` (teste de catálogo). Só a secret key, que fica neste computador, acessa os dados. Auth do Supabase não é usado; cadastros ficam desligados em `supabase/config.toml` e devem ficar desligados também no painel (Authentication → Sign In / Providers → desligar "Allow new users to sign up").
7. Testes contra o banco real:

   ```bash
   E2E_SUPABASE=1 pnpm test:e2e
   ```

   No PowerShell: `$env:E2E_SUPABASE = '1'` antes do comando. Esse teste só lê o banco.

   `pnpm test:db` em modo real (`TEST_DATABASE_URL`) cria e apaga tabelas: use só com um banco descartável (Supabase local da seção 4), **nunca** com o projeto da seção 3 que guarda seus dados.

## 4. Banco: Supabase local (alternativa com Docker)

> Não executado ainda (Docker não instalado — KI-002).

1. Instale Docker Desktop e a Supabase CLI.
2. Confira `supabase/config.toml` contra a versão da CLI (o arquivo foi escrito à mão — KI-013).
3. `supabase start` e `supabase db reset` (aplica as migrações).
4. Com `supabase status`, preencha `apps/web/.env.local`: `SUPABASE_URL` = API URL, `SUPABASE_SECRET_KEY` = secret key, `TEST_DATABASE_URL` = DB URL.
5. `pnpm test:db` passa a rodar contra esse Postgres (arquivos em série) e `E2E_SUPABASE=1 pnpm test:e2e` contra a API local.

## 5. Problemas comuns

| Sintoma | Causa provável | O que fazer |
|---|---|---|
| "Variáveis de ambiente ausentes ou inválidas: …" | Só uma das duas variáveis definida, ou URL inválida | Defina as duas em `apps/web/.env.local` (seção 3) ou nenhuma |
| Início mostra "Inacessível" | Rede, projeto pausado ou chave recusada | Confira URL e secret key; projetos gratuitos pausam após inatividade |
| Início mostra "Migrações pendentes" | Migração não aplicada | Seção 3, passo 2 |
| "Host não permitido" (403) | App aberto por IP da rede, nome de máquina ou túnel | Abra por http://127.0.0.1:3000 ou http://localhost:3000 |
| `pnpm install` lento ou com arquivos travados | Pasta sincronizada pelo OneDrive | Mova o repositório para fora do OneDrive |
