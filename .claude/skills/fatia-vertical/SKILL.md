---
name: fatia-vertical
description: Processo para implementar uma fatia vertical do Prospector (spec → migração → domínio → serviço → workflow/agente → UI → testes → docs). Use ao iniciar qualquer entrega do roadmap (F1, F2…) ou funcionalidade que atravesse banco, backend e interface.
---

# Fatia vertical

Uma fatia entrega valor verificável de ponta a ponta. Pequena o bastante para revisar em uma sessão; completa o bastante para ser usada.

## 1. Preparar (antes de escrever código)

1. Localize a fatia em `docs/09-mvp-e-roadmap.md` e copie seus critérios de aceite para o plano de trabalho.
2. Leia os documentos que ela toca: domínio em `docs/02-dominios.md`, tabelas em `docs/06-modelo-de-dados.md`, contratos em `docs/contracts/README.md`, ADRs relevantes.
3. Liste o que **não** está claro. Decisão de produto pendente → pergunte ao usuário; decisão técnica → proponha e registre ADR.
4. Escreva o plano em passos (banco → domínio → aplicação → integração/agente → workflow → UI → testes → docs).

## 2. Implementar, de dentro para fora

1. **Banco**: skill `migracao-supabase` (RLS + teste de isolamento obrigatórios).
2. **Contratos**: Zod em `packages/contracts` com exemplos válidos e inválidos testados.
3. **Domínio**: regras puras em `packages/domain` com testes unitários primeiro.
4. **Aplicação**: serviço em `packages/application` recebendo `ctx { orgId, actor, traceId }`; portas para IO.
5. **Integrações/agentes**: skills `integracao-externa` e `capacidade-ia`.
6. **Workflow**: passos idempotentes com chave determinística; timeouts; erros classificados (ver `docs/04-arquitetura-de-agentes.md` §10).
7. **UI**: Server Components por padrão; estados carregando/vazio/erro/parcial/sem permissão/demo; explicabilidade (claims) onde houver conclusão; acessível por teclado.

## 3. Verificar

- `pnpm typecheck && pnpm lint && pnpm test` (e `pnpm test:db` se tocou banco).
- Teste E2E do caminho feliz e do principal caminho de bloqueio.
- Rode os subagentes: `engenheiro-testes`, `revisor-arquitetura`, `revisor-seguranca`; `revisor-conformidade` se envolver dados pessoais/contato; `revisor-ux` se houver UI; `avaliador-ia` se houver prompt.
- Verifique manualmente na interface (abra o app e use a funcionalidade) quando houver UI.

## 4. Fechar

- Marque cada critério de aceite como atendido **com evidência** (teste, captura, comando executado).
- Atualize docs afetados e `docs/known-issues.md` com o que ficou pendente.
- Resumo final: o que foi feito, o que foi testado (comandos e resultados), o que **não** foi feito/testado e por quê.

Nunca declare a fatia concluída com testes falhando, pulados sem justificativa ou critérios não verificados.
