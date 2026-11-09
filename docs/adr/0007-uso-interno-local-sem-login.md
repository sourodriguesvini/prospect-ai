# ADR-0007 — Uso interno, local, sem login e sem multiempresa

- Status: **Aceito** (decisão do usuário em 2026-11-09)
- Data: 2026-11-09
- Substitui: as partes de autenticação, organizações, convites, papéis e isolamento entre organizações dos docs 01, 02, 03, 06, 09, 11, 12 e dos ADRs 0001, 0005 e 0006. Onde houver conflito, vale este ADR.

## Contexto

O briefing descrevia uma plataforma SaaS multi-tenant. O usuário esclareceu que o Prospector é **para uso interno dele**, não será publicado nem vendido como SaaS, e que **não precisa de login**. Ele escolheu rodar o app **só no próprio computador**.

A F1 já tinha sido implementada no modelo SaaS (Supabase Auth, organizações, convites, papéis, RLS por membro). Essa versão foi preservada no commit `a5f6c51` antes da simplificação.

## Decisão

1. **Sem login e sem multiempresa.** Não há cadastro, sessão, organizações, convites nem papéis. Existe um único espaço de trabalho. As tabelas não têm `org_id`.
2. **Só localhost.** O app escuta apenas em `127.0.0.1` (`next dev`/`next start` com `--hostname 127.0.0.1`). O proxy recusa com 403 qualquer requisição cujo cabeçalho `Host` não seja `localhost`, `127.0.0.1` ou `[::1]`, o que também bloqueia ataques de DNS rebinding. As Server Actions mantêm a checagem de origem do Next, que barra envios de outros sites abertos no navegador.
3. **Banco fechado para a API pública.** O Supabase expõe a API REST com a chave pública. Por isso toda tabela de `public` tem RLS habilitado e **nenhuma** política nem privilégio para `anon` ou `authenticated`. O servidor do app acessa o banco com a secret key (que ignora o RLS), lida só em módulos `server-only` e nunca em `NEXT_PUBLIC_*`. O teste de catálogo garante isso para tabelas futuras.
4. **Auditoria continua.** O `audit_log` segue somente de inclusão e passa a receber ator e `traceId` explícitos da aplicação (`user`, `agent` ou `system`), o que resolve a lacuna de rastreio de agentes apontada na revisão de arquitetura da F1.
5. **Regras que não mudam.** Nada sai sem aprovação explícita (agora sempre do usuário). LGPD continua valendo para os dados dos prospects: base legal, origem, minimização, opt-out e supressão. Evidência tipada, LLM Gateway e fronteiras entre pacotes continuam como antes.

## Consequências

- (+) Menos código, menos superfície de ataque e nenhuma conta de terceiros para login (Google OAuth, MFA e CAPTCHA deixam de ser necessários).
- (+) Critério "preview deploy" deixa de existir; não há deploy.
- (−) **Não é seguro publicar o app** (Vercel ou qualquer host) sem antes adicionar autenticação. Se um dia isso for necessário, a versão com login está no commit `a5f6c51` como referência.
- (−) Acesso de outros aparelhos (celular) exigiria uma proteção de rede (VPN privada) e revisão deste ADR.
- (−) Qualquer processo local com acesso a `127.0.0.1` pode usar o app; o computador do usuário passa a ser o perímetro de segurança.
- A escolha de orquestração (ADR-0004, Trigger.dev em nuvem) deve ser reavaliada na F4: workers em nuvem acessariam o banco com a secret key fora do computador do usuário.

## Alternativas consideradas

- **Manter a fundação multiempresa escondida** (uma organização fixa): custo de código e testes sem benefício para um único usuário; rejeitada.
- **Login simples por senha local**: desnecessário com o app restrito ao próprio computador; pode voltar se o app for acessado de outros aparelhos.
