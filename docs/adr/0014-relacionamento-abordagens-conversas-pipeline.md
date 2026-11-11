# ADR-0014 — Relacionamento: abordagens, conversas, pipeline e aprovações

- Status: **Proposto** (migração escrita e testada em PGlite; ainda não aplicada ao `prospector-dev`)
- Data: 2026-11-11
- Módulo: 03, Relacionamento inteligente (fatias F8 a F10 do doc 09, sem envio)

## Contexto

Até aqui o app parava no dossiê da empresa. A tela "Abordagens" era só um aviso e Conversas,
Pipeline e Aprovações eram módulos planejados. O usuário pediu um módulo que leve a empresa
investigada até a conversa e o fechamento: preparar a abordagem com base em evidências, revisar e
aprovar a mensagem, registrar o contato feito e a resposta, interpretar a resposta, marcar
follow-ups e acompanhar o pipeline.

Restrições que valem para esta decisão:

- Regra 2 do `CLAUDE.md`: nada sai sem aprovação com `payload_hash`, e a supressão é checada no
  momento do envio.
- A LIA v2 e a D-LGPD-1 estão em aberto (decisões do usuário): o envio continua bloqueado. Nenhum
  código desta fatia libera a barreira de conformidade.
- Sem integrações externas (Gmail, Calendar), sem WhatsApp para primeiro contato e sem mensagens
  automáticas.
- IA local (ADR-0008): um modelo e uma inferência por vez, `qwen3.5:4b` como padrão.

## Decisão

1. **O app não envia nada.** "Aprovar" marca a versão da mensagem como aprovada para uso (ação
   `message.use`). A pessoa copia o texto, envia pelo canal dela e registra o contato. Não existe
   botão de envio. Quando houver envio pelo app (fatia futura, com integração aprovada), ele vai
   usar a mesma aprovação.
2. **Aprovação ligada ao conteúdo.** `approvals.payload_hash` é o SHA-256 de canal, assunto e
   corpo (`messageHash`). `approve_message` (RPC, numa transação) recusa a aprovação se a versão
   não é a mais recente da conversa, se o hash ou o canal não batem, se a oportunidade está
   encerrada ou se a empresa está suprimida. A aprovação vale **72 horas** (docs/12 §2;
   `APPROVAL_VALIDITY_DAYS = 3`, e o banco recusa validade maior) e **para um contato só**: o
   índice único `interactions_outbound_approval_key` e `record_interaction` recusam registrar duas
   vezes a mesma aprovação, e o contato registrado não pode ter data anterior à aprovação. Editar
   cria uma versão nova (`outbound_messages` só aceita inclusão, e o status muda uma vez), e a
   aprovação antiga deixa de valer; editar uma aprovada sem mudar o texto também gera uma versão
   nova em rascunho ("Preparar para aprovar de novo", depois de revogada ou vencida). Só rascunho
   pode ser descartado: aprovada e descartada são finais (`app.guard_final_status` no banco e
   `invalid_status_change` no serviço).
3. **Barreira de conformidade antes de aprovar.** O serviço chama
   `StrategyService.assertReadyToApproach` (ADR-0009) com a oferta da oportunidade. O comprovante
   (`clearance`) fica gravado na aprovação. No modo memória a barreira nunca libera. Rascunhos podem
   ser preparados e revisados mesmo com a barreira fechada: a tela mostra por que aprovar está
   bloqueado.
4. **Registrar o contato feito confere tudo de novo.** `record_interaction` (RPC) só aceita um
   contato de saída com aprovação válida e não vencida, cujo hash bate com a versão aprovada, e
   checa a supressão naquele momento. É o "momento do envio" da regra 2 enquanto o envio for
   manual.
5. **Estado do contato, canais e rodapé.** O estado vem só do que foi registrado
   (`contactState`): primeiro contato (nada saiu ainda), esperando a primeira resposta, e WhatsApp
   liberado (a empresa escreveu por lá). O primeiro contato é só por e-mail ou LinkedIn manual,
   com a agência identificada e o canal do titular dos dados; WhatsApp só depois que a empresa
   escreveu por lá, nunca para abrir contato. Até a primeira resposta, toda mensagem leva a frase
   de opt-out, qualquer que seja o tipo. O rodapé (opt-out e canal do titular) é do sistema
   (`withContactFooter`), não da IA, e não se duplica; antes de a IA reescrever, ele sai
   (`withoutContactFooter`) e volta depois. `messageIssues` bloqueia a aprovação sem esses itens
   ou com marcador por completar ("[nome da agência]").
6. **Supressão por empresa, raiz de CNPJ e domínio.** `suppression_entries` guarda a origem (você,
   pedido para parar, recusa, pedido de titular). Um pedido para parar numa resposta recebida é
   reconhecido na hora por regra (`STOP_PATTERNS`, no domínio) e pela interpretação da IA
   (`stop_request`). A empresa entra na lista e os follow-ups abertos são cancelados na mesma
   transação (`app.apply_suppression`). Para retirar alguém da lista é preciso dar um motivo de pelo
   menos 10 caracteres, e a retirada fica na auditoria.
7. **A etapa só muda por decisão da pessoa.** As etapas são: oportunidade identificada,
   qualificada, abordagem preparada, contatada, em conversa, reunião, proposta, negociação, ganha
   e perdida. `stageTransition` (domínio) valida cada mudança, e "perdida" exige motivo. Cada
   mudança grava `opportunity_stage_changes` e auditoria. Registrar um contato ou uma resposta só
   move a etapa quando a pessoa marca a caixa ("mover para Contatada / Em conversa"). A IA e o
   Copiloto só sugerem (`suggestStage`).
8. **Uma oportunidade aberta por empresa.** `open_opportunity` é idempotente: se já existe uma
   aberta, devolve essa. As encerradas ficam no histórico do dossiê.
9. **Abordagem baseada em evidências.** `prepareApproach` exige uma oferta ativa e pelo menos um
   fato no dossiê ou um diagnóstico. A IA (`relationship-approach/v1`) recebe os claims do ledger e
   cita os ids. O serviço descarta o id que não existe no dossiê e o ponto que fica sem nenhuma
   fonte. O plano é marcado `basis: limited` quando falta diagnóstico de marca, e as lacunas
   aparecem na tela. Nenhuma conclusão sobre a empresa é gravada fora do ledger: o plano guarda as
   referências.
10. **Três prompts versionados, todos pelo gateway.** São eles: `relationship-approach/v1`
   (estratégia e primeira mensagem), `relationship-message/v1` (variações e follow-ups) e
   `relationship-reply/v1` (interpretar a resposta e sugerir uma). Rodam na tarefa `copilot`, sem
   raciocínio, com saída em JSON Schema validada por Zod; saída fora do formato não grava nada.
   Detalhes que valem para os três:
   - **Referências curtas.** Claims e cases vão como C1, K1; o esquema só aceita as refs que
     existem, e o adaptador as troca pelos ids. Refs copiadas para o texto saem (`stripRefs`).
   - **Dado, nunca instrução.** Tudo vai num bloco DADOS. O pedido de quem dirige a agência vem
     depois, fora dele (PEDIDO), e não muda as regras. A resposta da empresa vai sem o texto
     citado (`replyOwnText`): a nossa mensagem citada não pode virar pedido para parar.
   - **Orçamento de contexto.** Os DADOS são montados do nível mais completo ao mais enxuto
     (`CONTEXT_LEVELS`) e vai o primeiro que cabe na janela com a resposta inteira; se nem o mais
     enxuto cabe, o modelo não é chamado e o erro é `context_too_large` ("encurte o pedido").
   - **Canal pelo estado.** A estratégia só pode recomendar os canais que o estado do contato
     permite (`approachChannels`); o serviço ainda troca por e-mail o que não valer.
   - **Saída ajustada, não consertada.** Campos secundários (listas, frases longas, prazo de
     retomada) são cortados aos limites do contrato; classificação, canal, objetivo e corpo, não.
     Recusa e pedido para parar ficam sem sugestão de resposta, follow-up, case e pergunta;
     resposta automática de ausência fica sem sugestão de resposta.
   - **Uso real só depois de avaliar.** Os três v1 passaram nos testes e numa rodada real pequena,
     mas o avaliador de IA recomendou não usá-los com empresas reais antes de um conjunto de
     avaliação (KI-124).
11. **Minimização.** Nada de nome de pessoa: `counterpart_role` guarda só a função ou a área. O texto
    recebido fica guardado por 12 meses (`retention_until`, `RETENTION_DAYS = 365`). A auditoria
    guarda ids, etapas e classificações, nunca o texto. O valor estimado só aparece com a base
    informada ("orçamento citado na reunião…").
12. **Fixture sintética só nos testes.** `PROSPECTOR_RELATIONSHIP_AI=fixture` troca a IA por
    respostas SINTÉTICAS marcadas DEMO e só funciona com `PROSPECTOR_STORAGE=memory`. O container
    recusa a combinação com o banco.
13. **Navegação.** "Relacionamento" fica no topo, com as abas Abordagens (`/relacionamento`),
    Conversas (`/relacionamento/conversas`) e Pipeline (`/relacionamento/pipeline`, em quadro e
    lista), mais o detalhe `/relacionamento/oportunidades/[id]`. "Aprovações" vai para o trilho
    (`/aprovacoes`). As rotas antigas `/abordagens`, `/conversas` e `/pipeline` redirecionam
    (`permanent: false`, em `next.config.ts`). O dossiê ganhou o painel "Relacionamento". Ações
    cujo formulário some depois de dar certo (aprovar, revogar, descartar, registrar o contato,
    supressão, follow-up) voltam para a página com `?aviso=`; só valores conhecidos viram mensagem
    e o endereço é montado no servidor (`backWith`).
14. **Copiloto: seis ferramentas só de leitura, atrás de um portão.** São elas:
    `get_relationship_agenda`, `list_opportunities`, `get_opportunity`, `get_pipeline_summary`,
    `suggest_reply` e `propose_stage_change` (essa última só sugere). Os avisos (`nao_contatar`,
    texto externo) vêm no topo do resultado, a etapa pode ser pedida pelo código ou pelo nome da
    tela e o detalhe de uma oportunidade fica abaixo de 6.000 caracteres. Só entram com um prompt que as
    conheça (`copilotPromptSupportsRelationshipTools`, versão 4 ou maior). O `copilot-tools/v3`
    em produção não as conhece e diz que Aprovações está "em construção". O trecho do v4 está em
    `docs/rascunhos/copilot-tools-v4-relacionamento.md`, com a rodada de avaliação proposta. O v4
    só é criado e promovido com a aprovação do usuário.

## Banco

Migração `supabase/migrations/20261111170000_relationship.sql`. Tabelas: `opportunities`,
`opportunity_stage_changes`, `suppression_entries`, `interactions`, `approach_plans`,
`outbound_messages` e `approvals`, mais `tasks`. Views: `opportunity_summaries` e
`current_outbound_messages` (`security_invoker`). RPCs: `open_opportunity`,
`change_opportunity_stage`, `approve_message`, `suppress_company` e `record_interaction`.

Todas as tabelas têm RLS e nenhum privilégio para `anon`/`authenticated` (o teste de catálogo
garante). Tabelas de histórico aceitam só inclusão. Nas mutáveis, um trigger limita as colunas
que podem mudar (`app.guard_mutable_columns`, `app.guard_task_update`), e as que podem mudar têm
auditoria. **Ainda não aplicada ao `prospector-dev`**: precisa da confirmação do usuário (skill
`migracao-supabase`).

## Consequências

- Os cenários de aceite que dependem de aprovar (B com aprovação gravada, J) só se completam no
  banco real com a LIA aprovada. No modo memória e no e2e a tela mostra o bloqueio. A aprovação
  gravada está coberta pelos testes do serviço e do banco (PGlite).
- Envio pelo app, caixas de e-mail, limites de volume e janela de envio continuam fora. Quando
  vierem, vão precisar de um ADR e de uma revisão de conformidade próprios.
- O texto recebido tem prazo de guarda, mas ainda não há rotina de expurgo (mesma pendência do
  KI-084). Ver o KI do Relacionamento.
- Rotas novas e o painel no dossiê precisam ser mesclados com a moldura nova do menu lateral
  (branch `claude/ui-menu-lateral-52d404`), onde `modules.ts` usa `group` no lugar de `placement`.
