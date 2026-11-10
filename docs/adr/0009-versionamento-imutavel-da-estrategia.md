# ADR-0009 — Versionamento imutável da estratégia e modo memória

- Status: **Proposto**
- Data: 2026-11-09
- Fatia: F2 (estratégia: ofertas, rubrica, ICP, voz, LIA e opt-out)

## Contexto

O critério 2 da F2 exige que a versão de oferta, rubrica ou modelo de score usada por uma avaliação fique imutável, e que editar crie uma nova versão. As avaliações que vão referenciar essas versões (auditoria visual, qualificação) só chegam na F6 e na F7, então "versão usada" ainda não pode ser consultada.

A LIA (docs/12 §4) e o texto de opt-out são condições de LGPD para abordar pessoas: precisam de histórico confiável de quem aprovou o quê e quando.

Não há banco real configurado nesta máquina (KI-002, KI-008) e o Docker não está instalado. Ainda assim as telas da F2 precisam ser usadas e testadas de ponta a ponta.

## Decisão

1. **Toda versão é imutável, usada ou não.** `offer_versions`, `audit_rubrics`, `scoring_models`, `icp_profile_versions`, `voice_guides` e `contact_policies` são somente de inclusão. Um trigger por instrução (`before update or delete or truncate`) recusa qualquer alteração com `version_immutable`, inclusive para o dono das tabelas. O `service_role` só tem `select` e `insert` nelas. Isso cumpre o critério 2 antes de existirem avaliações e dispensa decidir "quando uma versão passou a ser usada".
2. **Número e data da versão vêm do banco.** O trigger `app.assign_version()` calcula `max(version) + 1` por pai com um advisory lock da transação e grava `created_at = now()`; `unique (pai, version)` é a segunda barreira. O que o app envia nessas colunas é ignorado. Duas gravações simultâneas nunca repetem número: em geral as duas entram, em sequência, e **a última vence** (vira a versão atual); `concurrent_change` (23505) só aparece se o lock falhar. Não há detecção de edição concorrente (versão-base no formulário): ver KI-049. Cabeçalhos (`offers`, `icp_profiles`) sempre nascem em `draft`, com datas do banco.
3. **Cabeçalho mutável, conteúdo versionado.** `offers` e `icp_profiles` guardam só `status`, `is_demo` e datas; o conteúdo fica nas versões. O `service_role` só pode alterar a coluna `status`. Views `current_*` (`security_invoker = true`) devolvem a versão mais recente.
4. **Criação atômica por RPC.** `create_offer(jsonb)` e `create_icp_profile(uuid, jsonb)` criam o cabeçalho e a versão 1 na mesma transação. Só o `service_role` pode executá-las.
5. **LIA: conteúdo imutável, decisões únicas, regras no banco.** Cada versão de `legal_basis_assessments` tem texto imutável e nasce rascunho (trigger `lia_new_draft` zera as decisões e fixa `created_at`). A aprovação (`approved_at` e `review_due_on`) e a revogação (`revoked_at`) acontecem uma vez cada: trigger `app.guard_lia_decision()` mais privilégio só nessas colunas. O mesmo trigger impõe as regras do domínio, para que um bug no app não as contorne: só a versão mais recente pode ser aprovada (`lia_not_latest`), aprovar e revogar na mesma instrução é recusado, a data de revisão fica entre amanhã e 24 meses no fuso `America/Sao_Paulo` (`review_date_out_of_range`), e os instantes de aprovação e revogação são `now()` do banco. Vale a última versão aprovada; se ela for revogada ou passar da data de revisão, a abordagem fica bloqueada. Não se volta a uma aprovação antiga: para renovar, salva-se uma nova versão (pode ter o mesmo texto) e aprova-se de novo. A sugestão é revisar em 12 meses; o teto de 24 é técnico, não jurídico (KI-046).
6. **Pesos inteiros que somam 100.** Rubrica e modelo de score usam pontos percentuais inteiros (docs/02 D2 fala em somar 1; 100 pontos evita erro de arredondamento). A regra está no domínio e num check do banco.
7. **Barreiras por oferta e ICP, com comprovante.** `StrategyService.readiness()` calcula a prontidão para descobrir e para abordar a partir de um retrato do banco (a tela mostra a oferta mais adiantada). As barreiras recebem o escopo da ação e conferem **aquela** oferta e **aquele** ICP:
   - `assertReadyToApproach(ctx, { offerId, icpId? })` devolve um `ApproachClearance` com os ids das versões em vigor (oferta, rubrica, score, ICP, voz, política de contato, LIA) ou lança `AppError('conflict', 'approach_blocked')` com a lista do que falta.
   - `assertReadyToDiscover(ctx, { icpId })` devolve um `DiscoveryClearance` (oferta do ICP, rubrica, score, versão do ICP) ou lança `discovery_blocked`.
   - Escopo malformado é erro de validação; id inexistente bloqueia com explicação.
   Quem chama grava os ids do comprovante na avaliação ou no envio (F4, F7, F10): é isso que liga a avaliação à versão usada. Dados de demonstração e itens arquivados nunca contam. Ofertas ou ICPs de outra oferta não liberam a ação. **Em modo memória a abordagem nunca é liberada** (item "Banco de dados persistente"): a LIA aprovada e a auditoria sumiriam ao reiniciar.
8. **Modo memória (`PROSPECTOR_STORAGE=memory`).** Adaptadores em memória dos repositórios de estratégia e auditoria vivem em `@prospector/application/memory` (sem IO, reaproveitam as regras do domínio). Na web, só a raiz de composição (`apps/web/src/server/container.ts`) pode importá-los (ESLint e `check-boundaries.mjs`). Com essa variável, a web usa esses adaptadores, mesmo que haja credenciais do banco (o servidor avisa no log). O estado do banco aparece como "Modo memória" e as telas da estratégia, da conformidade, das abordagens e da auditoria mostram um aviso permanente de que os dados somem ao reiniciar. Serve para testes E2E e para experimentar as telas sem banco. Nunca semeia dados: a tela começa vazia. O seed de demonstração vive só nos testes (`packages/application/tests/support/demo-seed.ts`).

9. **Um modelo de score por oferta.** O modelo de score (pesos e limiares) é versionado junto da oferta, como a rubrica. Os limiares que a F7 vai aplicar (perseguir, preparar acesso, descartar, cobertura mínima de evidência) ficam guardados como dados nesta fatia; nenhuma regra os usa ainda.
10. **Evolução dos contratos de leitura.** Os tipos de leitura (`OfferVersion`, `LiaVersion`…) só ganham campos opcionais ou anuláveis; renomear ou remover campo exige nova migração e atualização dos mapeadores `packages/db/src/strategy-rows.ts` no mesmo pacote de mudanças (teste de ida e volta em `strategy-rows.test.ts`).

## Consequências

- (+) O critério 2 vale para qualquer avaliação futura, sem depender de F6/F7.
- (+) Números de versão, datas, imutabilidade e as regras de decisão da LIA são garantidos pelo banco, não só pelo app.
- (+) Fluxo completo testado em E2E sem banco (`apps/web/e2e/strategy.spec.ts`).
- (−) Versões acumulam linhas (uma por gravação com mudança). Gravar sem mudança não cria versão.
- (+) Escrita e auditoria são atômicas desde 2026-11-10: o registro vai no mesmo pedido e o trigger o grava na mesma transação ([ADR-0010](0010-auditoria-na-mesma-transacao.md), KI-041 resolvido).
- (+) O adaptador Supabase da estratégia foi exercitado no banco real de desenvolvimento em 2026-11-10 (KI-042 resolvido); o modo memória continua sem exercitar o PostgREST.
- (−) O banco aceita alguns conteúdos que o contrato recusa (ex.: descrição de critério da rubrica vazia). O contrato é a regra; o banco é a barreira mínima (KI-045).

## Alternativas consideradas

- **Imutável só depois de usada** (trigger que consulta as avaliações): depende de tabelas que ainda não existem e abre uma janela em que a versão muda sem histórico. Rejeitada.
- **Número de versão calculado no app:** sujeito a corrida entre duas abas. Rejeitada.
- **Seed de demonstração no modo memória:** a tela inicial afirma "Dados demo: Nenhum"; semear contradiria isso. Seeds ficam só em teste (`seedStrategyDemo`, marcada com `is_demo`).
- **Mock do Supabase para E2E:** testaria um falso PostgREST, não o app. O modo memória usa os mesmos serviços e regras.
