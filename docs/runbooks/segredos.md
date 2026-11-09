# Runbook — segredos e chaves

> Fatia F1 · 2026-11-09, revista pelo [ADR-0007](../adr/0007-uso-interno-local-sem-login.md). Complementa o [ADR-0006](../adr/0006-segredos-e-credenciais.md). Nenhuma conta de nuvem foi criada ainda; os procedimentos de rotação abaixo não foram executados.

## 1. Inventário (F1)

| Variável | Onde é lida | Sensível? | Onde guardar |
|---|---|---|---|
| `SUPABASE_URL` | servidor do app (`apps/web/src/server/env.ts`) | Baixa (identifica o projeto) | `apps/web/.env.local` |
| `SUPABASE_SECRET_KEY` | servidor do app (`apps/web/src/server/env.ts` → `container.ts`) | **Sim** — ignora o RLS, dá acesso total aos dados | `apps/web/.env.local` neste computador; secret do CI só para testes |
| `TEST_DATABASE_URL` | testes de banco | Sim (contém senha) | `.env.local`; gerado no CI. Só bancos descartáveis |

Sem login (ADR-0007), o app age sempre com a secret key, no servidor. Por isso: o app só escuta em `127.0.0.1`, recusa `Host` não local, não usa variáveis `NEXT_PUBLIC_*` e a secret key só é lida em um módulo `server-only` (verificado por `scripts/check-boundaries.mjs`). A publishable key não é usada.

## 2. Regras

1. Nada com prefixo `NEXT_PUBLIC_` (vai para o navegador). A web não usa nenhuma.
2. `.env*` fica fora do git (exceto `.env.example`, sem valores). Agentes não leem nem imprimem `.env.local`.
3. Logs registram nome do erro e `traceId`, nunca valores de variáveis, tokens ou e-mails.
4. Credenciais de terceiros (OAuth de e-mail etc.) ficam criptografadas no banco, fatias F9/F11 (ADR-0006).
5. Antes de publicar o app em qualquer host: adicionar autenticação (ADR-0007) e revisar este inventário.

## 3. Rotação (procedimento)

**Secret key do Supabase** (vazamento suspeito ou troca de pessoa com acesso):
1. No painel do Supabase → Settings → API Keys, crie uma nova secret key.
2. Atualize `apps/web/.env.local` (e o secret do CI, se houver).
3. Reinicie o app e confirme "Conectado" na tela inicial.
4. Revogue a chave antiga no painel.
5. Registre data, motivo e responsável (sem o valor) no log de operações.

## 4. Se um segredo vazar

1. Rotacione imediatamente (seção 3).
2. Verifique uso indevido: logs de API do Supabase no período.
3. Se houver acesso a dados pessoais, siga o item de incidentes de [12-seguranca-e-conformidade.md §3](../12-seguranca-e-conformidade.md) (avaliação de risco, comunicação à ANPD e aos titulares em 3 dias úteis quando aplicável, registro por 5 anos).
4. Remova o segredo do histórico do git se tiver sido commitado (a rotação é obrigatória mesmo assim).
