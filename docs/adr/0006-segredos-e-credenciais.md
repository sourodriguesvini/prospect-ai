# ADR-0006 — Segredos da plataforma e credenciais por tenant

- Status: **Proposto**
- Data: 2026-11-09
- Base: [research/04 §F e §A.7](../research/04-infraestrutura-e-execucao.md)

## Contexto

Há dois tipos de segredo:
1. **Da plataforma**: chave da Claude API, chaves de provedores contratados pela plataforma, secret key do Supabase, chaves do Trigger.dev/Sentry/Langfuse.
2. **Por tenant**: tokens OAuth de caixas de e-mail (Gmail/Microsoft), chaves de provedores que o próprio tenant contrata.

## Decisão

- Segredos da plataforma: variáveis de ambiente de servidor na Vercel e no Trigger.dev; nunca com prefixo `NEXT_PUBLIC_`; `.env.local` fora do git; `.env.example` sem valores.
- Credenciais por tenant: **Supabase Vault** (criptografia autenticada, chave raiz fora do banco). Tabelas de domínio guardam só `secret_ref`. Leitura via função `security definer` restrita ao papel do worker; nunca exposta ao cliente nem a agentes (ferramentas recebem clientes já autenticados, não tokens).
- `pgsodium`/criptografia transparente de colunas: **não usar** (em deprecação segundo a pesquisa).
- Projeto Supabase nasce com o **modelo novo de chaves** (publishable/secret) e JWT assimétrico — chaves legadas estão em deprecação.
- Rotação: tokens OAuth renovados pelo fluxo do provedor; chaves de plataforma com procedimento documentado em `docs/runbooks/` (fatia F1). Rotação da chave raiz do Vault: [não verificado — investigar antes de produção].
- Logs/traces: redator de segredos (padrões de chaves/tokens) aplicado a toda saída de log.

## Consequências

- (+) Sem segredos de tenant em texto puro; trilha clara de quem lê.
- (−) Quem tem acesso à view de segredos decriptados vê tudo → acesso restrito e auditado.
- Pós-MVP: avaliar gerenciador central (Doppler/Infisical) quando houver mais ambientes/equipe.
