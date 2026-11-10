# ADR-0010 — Auditoria na mesma transação da escrita

- Status: **Aceito**
- Data: 2026-11-10
- Fatia: F2 (fechamento) — resolve o KI-041; vale para toda fatia que grava pelo PostgREST (F3 em diante)
- Emenda: [ADR-0001](0001-monorepo-e-fronteiras.md) item 3 e [ADR-0009](0009-versionamento-imutavel-da-estrategia.md) (Consequências)

## Contexto

Na F2, o serviço gravava a versão e, numa segunda chamada, o `audit_log` (`AuditService.record`). Se a segunda falhasse, a versão (ou a decisão da LIA) ficava salva sem registro, e a lacuna não se corrigia sozinha (KI-041).

O acesso ao banco é só pelo PostgREST com a secret key (ADR-0007, regra 3 do CLAUDE.md). Cada pedido ao PostgREST roda numa transação própria, e não há transação que atravesse dois pedidos. O registro precisa, então, chegar no mesmo pedido da escrita.

## Decisão

1. **O registro vai junto da escrita.** O serviço monta um `PendingAudit` (porta em `packages/application/src/ports/audit-repository.ts`: `NewAuditEntry` + `withVersion`) e o entrega ao repositório. Ator e `traceId` são validados antes de qualquer IO pelo contrato `AuditActorFields` (`packages/contracts`). O repositório nunca chama o `AuditService` para registrar escritas.
2. **No banco, o transporte é um cabeçalho.** O adaptador (`packages/db/src/strategy-repository.ts`) manda o registro em `x-prospector-audit` (JSON em base64, até 4 KB). O trigger AFTER `app.audit_write` lê `request.headers` e grava o `audit_log` na mesma transação: ou os dois ficam, ou nenhum.
3. **Tabela explícita.** O registro diz em que tabela vale (`table`). Numa RPC que grava mais de uma tabela auditada, as outras vão em `covers` (ex.: `create_offer` registra em `offers` e cobre `offer_versions`). Qualquer outra combinação é recusada.
4. **Recusas do banco** (migrações `20261110120000` e `20261110130000`):
   - escrita pelo PostgREST sem o cabeçalho: `audit_missing`;
   - cabeçalho malformado, sem `table`, com tabela fora de `covers`, ou com ator, ação ou `traceId` que o `audit_log` não aceita: `audit_invalid` (código P0001).

   As duas chaves são internas (`INTERNAL_DB_ERROR_KEYS`): a aplicação as trata como erro inesperado, nunca como "Revise os campos".
5. **Escrita que não muda nada não registra.** Atualização que não encontra a linha, ou LIA já decidida, não gera registro.
6. **O registro não leva conteúdo** (KI-015): ids, números de versão, status e datas de decisão. O trigger só acrescenta `id` e `version` da linha gravada.
7. **Modo memória** (ADR-0009): o repositório em memória recebe a trilha obrigatoriamente e aplica o mesmo preenchimento (id da linha, versão). A trilha em memória não falha, então gravar antes de registrar é seguro ali; uma trilha que possa falhar exigiria inverter a ordem.
8. **Tabela nova auditada** = trigger `app.audit_write` na migração, `AuditedTable` no adaptador e o teste que percorre todas as escritas (`strategy-repository.test.ts`, "registro de auditoria em todas as escritas").

## O que fica de fora

- **SQL direto não é auditado por este caminho:** migrações, manutenção e o editor SQL ou de tabelas do Studio do Supabase não passam pelo PostgREST e não têm `request.headers`.
- **Worker com conexão Postgres direta** (F4, ADR-0004, KI-024): não passa pelo trigger. Quem gravar assim precisa levar o registro de outro jeito (por exemplo, `set_config('request.headers', …, true)` na mesma transação, como fazem os testes) antes de existir.

## Consequências

- (+) Escrita e auditoria são atômicas no banco real (verificado no Supabase de desenvolvimento em 2026-11-10: 17 escritas pelo app, 17 registros). As recusas da migração `20261110130000` também foram conferidas lá, numa transação desfeita no fim: RPC com `covers` grava 1 registro; sem `covers` ou com registro vazio, `audit_invalid` (P0001); nenhuma linha de teste ficou.
- (+) Um erro de código (tabela trocada, registro vazio) falha alto em vez de gravar sem registro.
- (−) Toda escrita nova precisa do par tabela/registro; o teste de percurso e o trigger pegam o esquecimento, mas só para tabelas já auditadas.
- (−) O `AuditService.record` continua existindo para ações sem escrita própria; usá-lo depois de uma escrita reabre o KI-041.

## Alternativas consideradas

- **RPC por escrita** (toda gravação vira função SQL que também grava o registro): atômico, mas duplica no SQL as ~15 escritas do adaptador e espalha a regra. Rejeitada.
- **Verificação no commit** (constraint trigger `deferrable initially deferred` que exige uma linha de auditoria por transação com cabeçalho): mais forte contra escritas extras, mas mais difícil de testar em PGlite. Fica como opção se aparecer gravação em tabela não auditada no mesmo pedido.
