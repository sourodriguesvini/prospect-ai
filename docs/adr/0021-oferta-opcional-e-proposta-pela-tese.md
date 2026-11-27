# ADR-0021 — Oferta opcional, proposta pela tese e barreira de coerência antes de gerar

- **Status:** Aceito (2026-11-27, pelo usuário: "Tudo o que for decisão minha está aprovado"). A migração que tira o `NOT NULL` da oferta em `approach_plans` está escrita e testada em PGlite; aplicar no `prospector-dev` depende de autorização explícita.
- **Contexto da decisão:** pedidos do usuário de 2026-11-27: "Ajuste — preparação de mensagens e motor de ofertas" e "Correção — validação de coerência comercial antes da geração de mensagens".
- **Relaciona-se com:** ADR-0001 (fronteiras), ADR-0008 (IA local), ADR-0014 (Estratégia: ofertas, rubricas e modelos), ADR-0019 (motor de inteligência comercial: perfis, acontecimentos e tese).

## Contexto

Antes desta decisão, "Preparar abordagem" exigia uma **oferta da Estratégia**. Sem oferta ativa, a IA não preparava nada. Com oferta, a mensagem saía dela, mesmo quando a tese da investigação apontava para outra frente.

O usuário viu isso na prática:
- na Flash (fintech de benefícios, Série D para produto e IA), a oferta marcada era "site institucional", e a mensagem seguia a oferta, não a tese;
- a tela tinha dois controles chamados "Oferta" (um na preparação e outro em "Escrever sem a IA"), com valores que podiam divergir;
- bastava escolher uma oferta e clicar em "Preparar" para gerar, mesmo sem tese, com acontecimento de outra empresa ou com conteúdo do blog tratado como lançamento.

Os perfis comerciais do ADR-0019 (Found Studio com as frentes A–F; Blummy, produto por assinatura para terapeutas) já tinham catálogo, capacidades e problemas. Faltava a abordagem usar esse catálogo.

## Decisão

1. **A oferta da Estratégia fica opcional.**
   - A abordagem pode ter uma oferta da Estratégia (ativa, como manda o ADR-0014), mas não precisa.
   - `approach_plans.offer_id` e `offer_version_id` aceitam nulo, sempre os dois juntos (`approach_plans_offer_pair_check`). Migração `20261127130000_approach_plan_optional_offer.sql`, só aditiva; estratégias antigas continuam com a oferta delas.
   - Sem oferta, a liberação (`assessApproachWithoutOffer`) confere só voz da agência, política de contato, LIA e armazenamento persistente. Não há rubrica nem modelo de pontuação a exigir.
   - Na conversa sem oferta, uma oferta enviada pelo formulário é ignorada.

2. **A proposta sai da tese e do catálogo do perfil** (regra pura, `packages/domain/src/commercial/proposal.ts`). A cadeia é: investigação → acontecimentos → interpretação → necessidade × capacidades → solução (ou combinação) → ângulo → mensagem.
   - **Três modos** (`ProposalMode`):
     - **seguir a recomendação:** `recommendProposal` usa o ângulo escolhido e combina com a alternativa 1 quando o mesmo acontecimento sustenta as duas e a alternativa traz frente nova (ex.: reestruturação pede estratégia + branding + operação);
     - **ajustar:** a pessoa escolhe frentes do catálogo; ao menos uma precisa se ligar ao ângulo;
     - **sem oferta:** só abrir uma conversa (networking, sondar interesse), sem apresentar serviço.
   - **Perfil escolhido na tela** ("Em nome de"), entre os perfis que a investigação ligou à empresa. A tese usada é a desse perfil (`thesisForProfile`), sem misturar catálogos.
   - **A proposta é do servidor.** Ela é gravada em `approach_plans.content.proposal` (perfil, modo, título, frentes, serviços, justificativa, objetivo da primeira interação, observação). O contrato de saída da IA (`ApproachAiOutput`) não aceita `proposal` nem `thesisBasis`: o que o modelo devolver nesses campos é descartado, nunca gravado.
   - **Objetivo da primeira interação** vem do modo (`proposalObjective`), não do modelo. Perfil de produto: despertar interesse em conhecer o produto, sem lista de funções. Conversa: nada de serviço nem reunião de venda.

3. **Barreira de coerência antes de gerar** (`assessProposalCoherence`, no domínio; o serviço repete a checagem e responde `proposal_incoherent` com os motivos em pt-BR). Propor serviço exige:
   - tese do perfil escolhido para a empresa;
   - tese que recomende abordar (senão, o motivo da tese e o que confirmar antes);
   - ângulo escolhido, com ao menos uma evidência em vigor (não vencida, não contestada, não só hipótese);
   - no modo "ajustar", ao menos uma frente ligada ao ângulo.

   A conversa sem oferta não depende da tese, só da base do dossiê (`assessApproachBasis`). A tela mostra os mesmos motivos antes do clique e desabilita "Preparar mensagem"; o servidor não confia na tela.

4. **Checagens de entidade e de acontecimento nas regras de sinais** (método de sinais 7, ADR-0019):
   - página de conteúdo permanente ("O que é SaaS?", guia, glossário, pergunta no título) não vira acontecimento (`isExplainerContent`);
   - "`<empresa> investe R$ …`" é a empresa gastando, não rodada dela; investimento recebido só com investidor como sujeito ou com o nome da empresa depois do valor;
   - a mesma rodada em veículos diferentes (rodada e valor iguais) vira um acontecimento só, com confirmação independente;
   - frase em que a empresa aparece só como terceira ("cliente da Flash", "como a Flash") não atribui o acontecimento a ela (`thirdPartyMention`).

5. **Prompts v6** (`relationship-approach/v6.md`, `relationship-message/v6.md`):
   - recebem `perfil` (nome, tipo, descrição, posicionamento, proposta de valor, linguagem, restrições) e `proposta` (modo, título, frentes, serviços, justificativa, objetivo, observação);
   - `oferta` só chega quando a pessoa escolheu uma oferta da Estratégia;
   - regras novas: só esta empresa; conteúdo não é acontecimento; nada de "fase de crescimento" genérica; trazer algo útil; na conversa sem oferta, nenhum serviço; no perfil de produto, o produto pelo nome do perfil, sem vender serviço da agência;
   - o v5 continua funcionando com o código novo, sem `perfil` nem `proposta` (`proposalAware` falso). A promoção segue o doc 11 §4.3; em 27/11 a v6 **não foi promovida** (KI-246). Com a v5, o servidor aceita só o perfil padrão e os modos "seguir a recomendação" e "só conversa", e mensagem em nome de outro perfil não é aprovada até a LIA cobri-lo (KI-215).

6. **Uma tela de preparação só** (`apps/web/src/components/relationship/proposal-form.tsx`):
   - perfil, ângulo, "O que propor" (os três modos), a recomendação com o porquê, as frentes do catálogo marcadas "ligada ao ângulo", os motivos de bloqueio e a oferta da Estratégia como campo opcional;
   - "Escrever sem a IA" usa o mesmo estado: não há mais dois controles de oferta.

## Compatibilidade

- Estratégias gravadas antes desta decisão continuam com oferta e sem `content.proposal`. O contrato aceita a ausência, e a tela mostra "O que propor" só quando existe.
- Oportunidades antigas não mudam. A oportunidade aberta pela abordagem sem oferta fica com `offer_id` nulo (a coluna de `opportunities` já aceitava).
- Enquanto a migração não for aplicada no `prospector-dev`, a gravação de estratégia sem oferta falha no banco com o erro de sempre (`NOT NULL`). Abordagem com oferta continua funcionando (KI-244).

## Consequências

- **A Flash** passa a receber a proposta de produto e tecnologia que a tese indica, não "site institucional". Site institucional só entra se a pessoa escolher a oferta ou a frente, e a barreira barra frente sem ligação com o ângulo.
- **Blummy:** a abordagem sai em nome do produto, com o catálogo dela (frente G), sem misturar a Found Studio. Quem assina a mensagem ainda é o nome da política de contato (KI-243).
- **Avaliações:** casos novos cobrem produto depois de rodada, reestruturação, produto para clínica, conversa sem oferta e conteúdo que não é lançamento. Checagens de tolerância zero: sem site institucional, sem serviço na conversa, sem agência no perfil de produto, sem preço, sem lançamento inventado.
- **Limitações** em `docs/known-issues.md` (KI-243 a KI-245).
