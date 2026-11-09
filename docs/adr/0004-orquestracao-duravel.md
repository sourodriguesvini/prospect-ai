# ADR-0004 — Orquestração durável: Trigger.dev v4 (Cloud), com Vercel Workflows como plano B

- Status: **Proposto** (requer aceite do dono do produto — envolve novo fornecedor e custo)
- Data: 2026-11-09
- Base: [research/04 §C](../research/04-infraestrutura-e-execucao.md) (fontes oficiais consultadas em 2026-11-09)

## Contexto

Pipelines do produto: investigações de 2–12 min, fan-out por empresa e por concorrente, espera por aprovação humana (horas/dias), agendamento por tenant (monitoramento), concorrência limitada por tenant e throttle por provedor. Captura de telas exige navegador headless — no MVP, terceirizada a um serviço de screenshot por API ([research/02](../research/02-pesquisa-web-visual-e-sinais.md), [05](../05-integracoes.md)). Funções da Vercel têm duração máxima (800 s no Pro, conforme a pesquisa); Supabase Edge Functions, 400 s de wall clock e 2 s de CPU.

## Decisão

Adotar **Trigger.dev v4 Cloud** como workflow engine:
- tasks com compute próprio, sem duração máxima por run;
- `batchTrigger` para fan-out; `concurrencyKey = org_id` para que um tenant não monopolize capacidade;
- `wait.forToken` para aprovação humana (token completado pela UI ao aprovar);
- schedules imperativas por tenant para monitoramento;
- `idempotencyKey` nos gatilhos (ex.: `org:{orgId}:investigation:{id}`), **mais** idempotência própria dentro dos passos (a chave do engine não torna o código interno idempotente);
- capturas de tela no MVP via serviço externo (ScreenshotOne/ApiFlash) chamado pela task; navegador próprio (Playwright no container do Trigger.dev) fica como opção da fase 2 se custo ou controle justificarem [suporte a Chromium no container a confirmar].

Regras:
- Estado de negócio **sempre** no Postgres; o engine guarda só estado de execução.
- Workers usam a secret key do Supabase (ignora RLS) → repositórios exigem `orgId` e testes verificam filtro.
- Gatilhos leves podem vir do `pg_cron` ou de Server Actions.

## Plano B

**Vercel Workflows** (GA segundo a pesquisa): menos um fornecedor, custo por evento baixo; exige que cada passo caiba no limite de duração da função e capturas em outro serviço. A camada `packages/workflows` define os workflows atrás de uma interface fina para manter a troca viável.

## Consequências

- (+) Cobre todos os requisitos de execução sem contornos.
- (+) Custo baixo em pequena escala (estimativa da pesquisa: US$ 10–50/mês + compute).
- (−) Mais um fornecedor e um ambiente de deploy (tasks são deployadas separadamente do Next.js).
- (−) Residência de dados/regiões não verificada (ver D-LGPD-2 em [10-riscos-custos-decisoes.md](../10-riscos-custos-decisoes.md)).

## Alternativas

| Opção | Por que não agora |
|---|---|
| Inngest + Vercel | Steps herdam limite de duração da Vercel; captura de tela exigiria outro host. Boa opção se controle de fluxo (debounce/prioridade) pesar mais. |
| Supabase Queues (pgmq) + worker | Estágio "Public Alpha" segundo a pesquisa; worker e orquestração ficariam por nossa conta. |
| pg-boss + container | Barato, mas tudo de orquestração (espera humana, fan-out, painel) seria construído por nós. |
| Temporal | Poderoso e pesado demais para o estágio. |
