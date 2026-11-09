# Runbook — segredos e chaves

> Fatia F1 · 2026-11-09. Complementa o [ADR-0006](../adr/0006-segredos-e-credenciais.md). Nenhuma conta de nuvem foi criada ainda (D-INFRA-1); os procedimentos de rotação abaixo não foram executados.

## 1. Inventário (F1)

| Variável | Onde é lida | Sensível? | Onde guardar |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | app web (servidor e proxy) | Não (pública por desenho) | `.env.local`; variável de ambiente na Vercel |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | app web | Não (pública; o acesso é limitado pelo RLS) | idem |
| `NEXT_PUBLIC_SITE_URL` | app web (links de confirmação e convite) | Não | idem |
| `SUPABASE_SECRET_KEY` | **somente** testes E2E e, no futuro, workers | **Sim** — ignora o RLS | `.env.local` de quem roda E2E; secret do CI; Vercel/Trigger.dev só quando houver worker que precise |
| `TEST_DATABASE_URL` | testes de banco | Sim (contém senha, ainda que local) | `.env.local`; gerado no CI |

A aplicação web **não** usa a secret key: toda leitura e escrita acontece com o JWT do usuário, sob RLS e RPCs que checam papel.

## 2. Regras

1. Nada sensível com prefixo `NEXT_PUBLIC_` (vai para o navegador).
2. `.env*` fica fora do git (exceto `.env.example`, sem valores). Agentes não leem nem imprimem `.env.local`.
3. Logs registram nome do erro e `traceId`, nunca valores de variáveis, tokens ou e-mails (`apps/web/src/server/action-errors.ts`).
4. Token de convite: aparece uma única vez para o administrador; o banco guarda só o SHA-256. O token não entra no `audit_log`.
5. Credenciais de terceiros por organização (OAuth de e-mail etc.) vão para o Supabase Vault, fatias F9/F11 (ADR-0006).

## 3. Rotação (procedimento)

**Secret key do Supabase** (vazamento suspeito ou troca de pessoa com acesso):
1. No painel do Supabase → Settings → API Keys, crie uma nova secret key.
2. Atualize o valor nos ambientes que a usam (CI, workers).
3. Faça deploy/reexecute e confirme que os jobs funcionam.
4. Revogue a chave antiga no painel.
5. Registre data, motivo e responsável (sem o valor) no log de operações.

**Publishable key**: mesma sequência; como é pública, a troca é de higiene, não de emergência.

**Chave de assinatura JWT** (JWT assimétrico): rotacione pelo painel (Settings → JWT Keys), mantendo a anterior como verificadora até expirarem as sessões ativas (`jwt_expiry` = 1 h). [Procedimento não executado — validar no primeiro projeto.]

## 4. Se um segredo vazar

1. Rotacione imediatamente (seção 3).
2. Verifique uso indevido: logs de API do Supabase no período.
3. Se houver acesso a dados pessoais, siga o item de incidentes de [12-seguranca-e-conformidade.md §3](../12-seguranca-e-conformidade.md) (avaliação de risco, comunicação à ANPD e aos titulares em 3 dias úteis quando aplicável, registro por 5 anos).
4. Remova o segredo do histórico do git se tiver sido commitado (a rotação é obrigatória mesmo assim).
