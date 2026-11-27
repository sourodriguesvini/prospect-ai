# ADR-0011 — Fila durável no Postgres com trabalhador local

- Status: **Aceito** (implementado na M3; migração aplicada no `prospector-dev` em 2026-11-11, com a confirmação do usuário)
- Data: 2026-11-11
- Fatia: M3 / F4 (Descoberta). Resolve a decisão D-AI-5 do doc 14.
- Emenda: [ADR-0004](0004-orquestracao-duravel.md) (orquestração durável) para o uso local, sem serviço externo.

## Contexto

Uma pesquisa da Descoberta leva de dezenas de segundos a alguns minutos: interpreta o pedido na IA local, faz várias buscas na Tavily, lê páginas e organiza os resultados. Não cabe numa requisição HTTP, e o app roda neste computador (ADR-0007): o usuário fecha o navegador, o `pnpm dev` reinicia a cada mudança de código e o computador desliga. A pesquisa precisa sobreviver a isso sem repetir buscas já pagas e sem ficar "rodando" para sempre.

O ADR-0004 previa um orquestrador durável. Para um app local de uma pessoa, um serviço à parte (Temporal, Inngest, Redis) é peso e mais um processo para manter de pé. O Postgres já existe e já guarda tudo.

## Decisão

1. **Tabela `ai_jobs`** (migração `20261111120000_discovery.sql`): tipo (`kind`), `payload` JSON, estado (`queued`, `running`, `succeeded`, `failed`, `cancelled`), tentativas (`attempts`/`max_attempts`, padrão 3), `run_after` (espera entre tentativas), `lease_owner`/`lease_expires_at`, código do último erro e `trace_id`. É registro de execução, não dado de negócio: sem auditoria por linha (as ações da pessoa ficam no `audit_log` das tabelas da Descoberta).
2. **Quatro RPCs, só para o servidor** (`execute` revogado de `public`, `anon` e `authenticated`; `search_path` fixo):
   - `claim_ai_job(worker, kinds, lease)` pega a próxima tarefa pronta, ou uma `running` com lease vencido (quem a pegou caiu), com `FOR UPDATE SKIP LOCKED`, soma uma tentativa e marca o lease;
   - `heartbeat_ai_job` renova o lease; `false` = a tarefa foi perdida ou o cancelamento foi pedido, e o trabalhador para;
   - `finish_ai_job` encerra (sucesso, falha, cancelada) ou devolve à fila com `run_after` (nova tentativa); só quem tem o lease encerra;
   - `expire_ai_jobs` marca como `failed` o que esgotou as tentativas e devolve essas linhas para o app encerrar o domínio (a pesquisa vira "interrompida").
3. **Enfileirar é do banco.** Um trigger em `discovery_runs` cria a tarefa quando a pesquisa entra em `queued` (criada pela tela ou confirmada depois de rascunho) e outro cancela a tarefa quando a pessoa cancela. A aplicação nunca grava uma pesquisa "na fila" sem tarefa.
4. **Trabalhador local** (`packages/application/src/services/job-worker.ts`): um por processo do servidor, guardado em `globalThis` (o Next carrega módulos mais de uma vez), iniciado pelo `apps/web/src/instrumentation.ts` ao abrir o app e, por garantia, na primeira chamada a `getServices`. Uma tarefa por vez (a GPU também é uma só, ADR-0008), lease de 120 s renovado a cada 15 s, espera de 10 s ociosa no app (5 s é o padrão do serviço) e espera crescente (até 60 s) quando o banco falha. Na volta ociosa, o agendador dos monitoramentos confere o que venceu (no máximo uma vez por minuto). `poke()` acorda o trabalhador logo depois de uma ação da pessoa.
5. **Retomar sem pagar de novo.** O motor da Descoberta grava cada busca feita (`discovery_run_queries`) antes de seguir; numa nova tentativa ele reaproveita o que já tem. Falha passageira (buscador fora, IA local ocupada) vira nova tentativa com espera; falha definitiva (orçamento acabou, sem chave) encerra com o motivo em pt-BR.
6. **Fechar o app não cancela.** `stop()` para de pegar tarefas; a que está rodando termina ou, se o processo cair, o lease vence e ela é retomada na próxima abertura.
7. **Modo memória**: a mesma porta `JobQueue` tem uma implementação em memória (`packages/application/src/memory/discovery.ts`) com as mesmas regras, usada nos testes e no modo de demonstração.

## O que fica de fora

- Mais de um trabalhador ao mesmo tempo (o `SKIP LOCKED` já permite, mas a GPU não).
- Prioridade entre tarefas, painel da fila e limpeza das tarefas antigas (ficam como histórico; KI-104).
- Outras tarefas longas (investigação aprofundada, abordagens) usam a mesma tabela quando chegarem, com um `kind` novo e um `JobHandler`.

## Consequências

- A pesquisa continua depois de fechar o navegador, de reiniciar o `pnpm dev` ou de desligar o computador.
- Num banco sem a migração, o trabalhador registra o erro no log a cada volta (com espera crescente) e a Descoberta mostra a mensagem de banco sem as tabelas (KI-103, resolvido no `prospector-dev`).
- O app instalado (`D:\Prospector`) e o `pnpm dev` no mesmo banco teriam dois trabalhadores: correto (o lease impede a mesma tarefa em dois), mas os dois disputam a GPU (KI-095 já registra a disputa de créditos).
