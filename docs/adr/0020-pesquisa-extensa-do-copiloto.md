# ADR-0020 — Pesquisa extensa do Copiloto: regra antes do modelo, lotes duráveis e pessoas protegidas por chave

- **Status:** Aceito (2026-11-27, pelo usuário: "Tudo o que for decisão minha está aprovado"; a validação jurídica da classificação por papel segue na KI-220)
- **Contexto da decisão:** diretriz de 2026-11-26 ([texto](../diretrizes/2026-11-26-evolucao-do-motor-de-inteligencia.md)), Partes 6.2 a 6.6; revisões de arquitetura, segurança, conformidade e UX de 2026-11-26 e 2026-11-27.
- **Relaciona-se com:** ADR-0001 (fronteiras), ADR-0006 (segredos), ADR-0008 (IA local), ADR-0010 (auditoria), ADR-0011 (fila durável), ADR-0012 (pesquisa na internet e a exceção do Copiloto), ADR-0019 (perfis comerciais).

## Contexto

A diretriz pede que o Copiloto **opere** o sistema, não só converse: "Quero encontrar 100 terapeutas ocupacionais no Brasil para apresentar a Blummy" deve virar uma pesquisa que roda em segundo plano, continua se o app fechar, aceita mudanças no meio ("agora priorize SP e MG") e entrega cada achado com a fonte para revisão humana.

Quatro pontos não estavam cobertos pelos ADRs anteriores:
- o Copiloto passa a gravar dados e gastar créditos da Tavily;
- a pesquisa roda em muitos lotes, com mudanças da pessoa no meio;
- a pesquisa guarda **pessoas** (nome, profissão, cidade), com a supressão dependendo de um segredo;
- a pesquisa classifica pessoas por papel para o perfil (usa, compra, influencia).

## Decisão

1. **Regra antes do modelo.** O turno da pesquisa (`packages/application/src/services/research-turn.ts`) roda antes do modelo em `/api/copiloto`:
   - pedido de pesquisa (interpretado por regra, `interpretResearchRequest`) cria a pesquisa;
   - pedido seguinte na mesma conversa ("mais 50", "só no Paraná", "pare", "continue a pesquisa") muda a pesquisa mais recente dela;
   - o resto segue para o modelo; se a leitura da pesquisa falhar (tabela ausente, banco fora do ar), a conversa também segue para o modelo.

   A pesquisa começa **sem pedir confirmação** (Parte 6.6: premissas adotadas sem perguntar, ditas na resposta). Os limites são do servidor: teto de créditos por pesquisa (`creditCapFor`), orçamento mensal da Tavily, no máximo 3 pesquisas abertas. A resposta diz o que foi entendido, as premissas, o teto de buscas e como mudar ou parar; nunca lista nomes de pessoas (KI-217). Engano de interpretação está na KI-226.

2. **Um lote por tarefa da fila, com duas versões na linha.**
   - O banco põe na fila uma tarefa `copilot_research` por lote, com chave `copilot_research:<id>:<version>:<lote>`, ao criar, a cada lote concluído, a cada mudança pedida e ao reabrir. Tarefa cuja versão ou lote não é mais o atual termina sem fazer nada.
   - `version` sobe só com mudança pedida pela pessoa. `row_version` sobe em **toda** gravação, pelo gatilho; o servidor do app não pode escrevê-la.
   - Toda gravação confere `version` e `row_version`. Um lote que perdeu a corrida para outra execução da mesma tarefa não grava por cima (`superseded`). Um lote que perdeu para uma mudança da pessoa reaplica o que rodou no plano novo.
   - A contagem de achados vem dos itens gravados no começo de cada lote (um lote repetido não conta duas vezes).
   - Falha passageira (buscador fora do ar, interrupção) grava o que rodou e a mesma tarefa volta depois. Na última tentativa, a pesquisa termina como `failed`, com a causa guardada. O abandono de tarefa caída confere versão e lote antes de marcar a falha.
   - A tela retoma pelo serviço (`resume`), não por texto.

3. **Chave das pessoas com impressão no banco.**
   - Deduplicação e supressão usam HMAC-SHA256 com um segredo do servidor (ADR-0006): `PROSPECTOR_PEOPLE_KEY` ou o arquivo `chaves\pessoas.key` na pasta de dados. Só a primeira pasta configurada vale: o app não cai para outra pasta, que criaria outra chave.
   - A tabela `people_key_checks` guarda uma linha só, só inclusão: o HMAC de um texto fixo. A primeira gravação fixa a impressão. Chave diferente da gravada = **nenhuma pessoa é guardada** (a supressão de quem pediu opt-out deixaria de casar), e a tela avisa (`progress.keyMismatch`).
   - A cópia de segurança do segredo fora do computador continua pendente (KI-222).

4. **Supressão antes de gravar, opt-out pela tela.**
   - Pessoa: confere a identidade gravada, as variações (sem a UF; com a profissão no lugar da organização) e o e-mail.
   - Organização: confere o domínio do site e do e-mail contra a supressão do Relacionamento e o e-mail contra a supressão de pessoas.
   - "Registrar opt-out" em cada pessoa da tela, com confirmação: definitivo; os meios de contato somem, o trecho fica só com o nome e a identidade com as variações e o e-mail entra em `person_suppressions`.

5. **Papel por regra, sem nota de pessoa.** O papel (`audience_role`) e o segmento vêm de regras do perfil sobre o texto da fonte, e o motivo diz o termo que disparou a regra. A tela mostra "Papel provável (por regra, a conferir)". Não há score de pessoa: a ordem é a de chegada. A validação jurídica do art. 20 (perfilamento) fica na KI-220.

6. **Abordável conferido a cada leitura.** A pessoa só aparece como abordável se a LIA em vigor hoje estiver aprovada e for a mesma versão gravada na linha; organização, se não estiver suprimida. A planilha baixada não traz quem pediu opt-out, traz a versão da LIA e a data de apagar, e cada download fica na auditoria antes de o arquivo sair.

## O que a IA faz e o que não faz

Nada desta decisão chama modelo: interpretação do pedido, plano de buscas, extração literal, deduplicação, supressão e classificação são regras testáveis. A busca na internet é feita pelo serviço de pesquisa (ADR-0012), por profissão e região, nunca pelo nome de alguém. Nada é enviado a ninguém: abordar uma pessoa continua bloqueado até uma LIA cobrir a fonte e os dados (KI-214), e qualquer contato passa pela aprovação (regra 2).

## Consequências

- **Créditos:** uma pesquisa de 100 pode gastar até o teto calculado (no plano gratuito, o mensal também vale). O gasto aparece na conversa, no cartão e na tela da pesquisa.
- **Migrações:** `20261127110000_people` (com `people_key_checks`) e `20261127120000_copilot_research` (com `row_version`), aplicadas com a skill `migracao-supabase`.
- **Limitações registradas** em `docs/known-issues.md`: KI-214 (LIA para pessoas), KI-216 (expurgo), KI-217 (nada de nomes no chat), KI-220 (papel por regra), KI-222 (cópia do segredo), KI-225 (planilha baixada), KI-226 (engano de interpretação), KI-227 (só título e trecho do buscador).
