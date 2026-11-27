# Diretriz do responsável pelo produto — Evolução do motor de inteligência comercial (2026-11-26)

> Texto recebido do usuário em 2026-11-26, guardado aqui na íntegra para a sessão que vai executá-lo. As listas foram compactadas em linha; nada foi resumido nem alterado.

PROSPECTOR — EVOLUÇÃO DO MOTOR DE INTELIGÊNCIA COMERCIAL
Reestruturação estratégica, investigação aprofundada, compatibilidade comercial e Copiloto operacional

## DIRETRIZ PRINCIPAL

O Prospector já está desenvolvido e funcional. Não estamos começando um produto do zero.
As telas e a experiência visual implementadas foram aprovadas como direção geral. A prioridade desta etapa é evoluir a inteligência que alimenta o produto, corrigir a desconexão entre investigação e geração de mensagens e transformar o Copiloto em um verdadeiro operador de inteligência comercial.
Não faça uma reconstrução visual desnecessária.
Não se limite a melhorar os prompts atuais.
Não tente resolver problemas estruturais adicionando instruções ao prompt principal.
Precisamos revisar como o sistema compreende empresas, identifica oportunidades, interpreta acontecimentos, relaciona necessidades com serviços e transforma essas informações em estratégias de aproximação.
O objetivo é construir um sistema de inteligência comercial capaz de trabalhar com diferentes negócios, produtos, públicos e modelos de prospecção.

## PARTE 1 — IDENTIDADE COMERCIAL E CAPACIDADES

### 1.1. Construir o perfil comercial da Found Studio

A primeira responsabilidade é compreender corretamente quem está sendo representado pelo Prospector.
A Found Studio não deve ser classificada simplesmente como uma agência de criação de logotipos, identidade visual e websites.
Seu posicionamento é multidisciplinar e conecta estratégia, marca, produto, comunicação, tecnologia, inovação e operação.
A atuação profissional está relacionada à combinação de: Brand & Product Design; Direção de Arte; Direção Criativa; Product Management; Direção de Projetos; Estratégia de Marca; Estruturação de Produtos; Tecnologia e Inteligência Artificial; Experiência Digital; Inovação e Automação.
A premissa central é: **Entender. Estruturar. Construir.**
O trabalho começa pela compreensão do problema, passa pela estruturação de uma solução e termina na direção, construção e evolução do que precisa existir.
O Prospector deve compreender que um mesmo projeto pode exigir várias dessas capacidades simultaneamente.

### 1.2. Criar um catálogo estruturado de capacidades

Organize as competências em seis famílias:

- **A. Estratégia e Inteligência de Marca:** diagnóstico de marca; pesquisa de mercado; pesquisa de público; análise competitiva; posicionamento; proposta de valor; personalidade e território de marca; naming; arquitetura de marca; estratégia de comunicação.
- **B. Branding e Sistemas de Identidade:** identidade visual; rebranding; sistemas gráficos; sistema tipográfico; sistema cromático; direção visual; brandbook; guidelines; aplicações de marca; consistência entre pontos de contato.
- **C. Direção Criativa e Comunicação:** direção de arte; campanhas; key visuals; direção fotográfica; direção audiovisual; comunicação institucional; narrativas; conteúdo; materiais comerciais e publicitários.
- **D. Produto e Experiência Digital:** Product Discovery; Product Design; UX/UI; arquitetura da informação; user flows; wireframes; Design Systems; prototipagem; Product Management; roadmaps; MVPs; websites; plataformas; aplicativos; portais; e-commerce.
- **E. Tecnologia, Inteligência Artificial e Inovação:** consultoria de IA aplicada; workflows inteligentes; agentes de IA; integrações com APIs; automação; sistemas internos; ferramentas SaaS; IA para comunicação e produção; IA para operações; estruturação de soluções tecnológicas.
- **F. Direção de Projetos e Estruturação Operacional:** gestão de projetos; coordenação multidisciplinar; arquitetura de processos; gestão de demandas; fluxos de aprovação; centrais de projetos; dashboards; documentação; organização de operações; governança e acompanhamento de entregas.

Não transforme esse catálogo em uma lista de serviços exibida integralmente em todas as abordagens. Ele será a base interna de conhecimento comercial.

### 1.3. Diferenciar capacidade, serviço e solução

Implemente uma hierarquia:

1. Capacidade: o que sabemos fazer.
2. Problema: qual situação empresarial essa capacidade consegue resolver.
3. Serviço: como essa capacidade pode ser contratada.
4. Solução: combinação de capacidades para resolver um problema mais amplo.
5. Entregável: o que efetivamente será produzido.

Exemplo: uma startup em expansão pode apresentar dificuldades na evolução do produto digital. A solução pode envolver: diagnóstico de produto; Product Discovery; estruturação de roadmap; UX/UI; Design System; direção de implementação. O Prospector não deve reduzir essa oportunidade a uma oferta de criação de interface.

### 1.4. Representar corretamente a capacidade de entrega

Diferencie: atividades executadas diretamente; atividades dirigidas ou coordenadas; atividades executadas com parceiros e equipes; capacidades ainda não comprovadas comercialmente.
Não apresente experiência, cases, equipes ou resultados inexistentes.
Utilize o inventário de portfólio e suas evidências como referência de capacidade, autoria, colaboração e comprovação.

### 1.5. Permitir múltiplos perfis comerciais

O Prospector não pode ficar permanentemente vinculado à Found Studio. Precisamos suportar diferentes operações de prospecção.
Cada perfil comercial deverá possuir: identidade; descrição; posicionamento; produtos e serviços; capacidades; público-alvo; ICPs; problemas que resolve; proposta de valor; diferenciais; linguagem; cases e evidências; restrições comerciais.
A primeira configuração será:

- **Found Studio:** serviços multidisciplinares de estratégia, branding, produto, tecnologia, comunicação e direção.
- **Blummy:** produto SaaS de gestão inteligente para profissionais e clínicas da área terapêutica.

Os dois perfis precisam funcionar independentemente.
O usuário deve conseguir selecionar a operação de prospecção ou deixar que o Copiloto identifique corretamente a operação a partir da solicitação.
Nunca misture serviços, públicos, posicionamentos ou mensagens de operações diferentes.

## PARTE 2 — NOVO MOTOR DE INTELIGÊNCIA COMERCIAL

### 2.1. Diagnóstico do funcionamento atual

Antes de modificar o código, faça um mapeamento completo do caminho percorrido pelas informações. Identifique: como uma empresa é descoberta; quais dados são coletados; quais fontes são utilizadas; como as evidências são armazenadas; como funciona a investigação; como são gerados os diagnósticos; como funciona a qualificação; como são selecionadas as ofertas; como o contexto chega ao gerador de mensagens; quais informações são descartadas; quais dados ficam disponíveis para o Copiloto.
Identifique exatamente onde ocorre a desconexão entre o diagnóstico empresarial e a mensagem comercial.
Não crie uma segunda implementação paralela se os serviços existentes puderem ser evoluídos.
Preserve o gateway de IA, os contratos, as fronteiras entre pacotes e o sistema de evidências.

### 2.2. Criar uma investigação empresarial em profundidade

A investigação não pode se limitar à análise do site institucional. Ela precisa construir um panorama empresarial. Investigue, conforme a disponibilidade de fontes:

- **Identidade empresarial:** o que a empresa faz; como ganha dinheiro; quais produtos oferece; quem são seus clientes; qual mercado atende; qual seu posicionamento; qual sua estrutura operacional.
- **Momento empresarial:** investimentos; rodadas de financiamento; aquisições; fusões; expansões; novas unidades; lançamentos; parcerias; mudanças de liderança; reestruturações; entrada em novos mercados.
- **Produto e tecnologia:** produtos existentes; novas funcionalidades; evolução de plataformas; aplicativos; tecnologias utilizadas, quando verificáveis; contratações de tecnologia; movimentos de inovação; iniciativas de IA; mudanças de experiência.
- **Mercado:** concorrentes; posicionamento competitivo; movimentos dos concorrentes; tendências relevantes; barreiras do setor; mudanças de comportamento; oportunidades de diferenciação.
- **Marca e comunicação:** posicionamento; linguagem; identidade; consistência; estratégia de comunicação; presença digital; percepção de valor; experiência de marca.
- **Estrutura organizacional:** fundadores; executivos; lideranças; equipes; departamentos; responsáveis por produto, tecnologia, marketing, marca e inovação.
- **Operação:** processos; sistemas; experiência de clientes; possíveis gargalos; estrutura de atendimento; oportunidades de automação.

Não é necessário que todas as dimensões sejam preenchidas para toda empresa. A profundidade deve ser proporcional ao contexto, à relevância comercial e à disponibilidade de informações.

### 2.3. Investigar acontecimentos, não apenas registrá-los

Uma notícia não pode ser tratada como uma oportunidade comercial automaticamente. Quando o sistema encontrar um acontecimento, deverá investigar:

1. O que aconteceu?
2. Quando aconteceu?
3. Quem participou?
4. Qual era o objetivo anunciado?
5. Qual foi o contexto anterior?
6. Qual é a finalidade declarada?
7. Quais consequências podem existir?
8. Quais novas necessidades podem surgir?
9. Existem outras informações que confirmam essa interpretação?
10. Qual é a relação possível com as capacidades comerciais disponíveis?

**Exemplo obrigatório: investimento de R$ 150 milhões.** Se encontrar uma informação sobre investimento na Flash, não deve simplesmente registrá-la como potencial comercial. Deve verificar: qual foi exatamente a operação financeira; se foi rodada de equity, crédito, dívida, financiamento ou outra modalidade; quem forneceu os recursos; qual foi a finalidade anunciada; qual era a situação da empresa antes da operação; o que a empresa declarou que pretende fazer; se existem contratações, produtos ou expansões relacionados; quais movimentos posteriores confirmam ou contradizem a interpretação.
Não trate investimento financeiro como orçamento disponível para contratação de serviços. Se a destinação dos recursos não estiver documentada, registre a informação como desconhecida.
A partir dos fatos, construa cenários e hipóteses comerciais. Exemplo de hipótese: o investimento, combinado com anúncios de expansão de produto e contratação de profissionais de tecnologia, pode indicar uma fase de estruturação e crescimento da plataforma. Isso pode criar oportunidades relacionadas a Product Management, Product Design, UX/UI, Design Systems e direção de projetos digitais. A hipótese precisa demonstrar quais fatos a sustentam.

### 2.4. Construir uma linha do tempo empresarial

As movimentações importantes devem ser organizadas cronologicamente. Cada evento precisa conter: data; acontecimento; fonte; contexto; importância; possível consequência; relação com outros acontecimentos.
A IA deve conseguir interpretar sequências de eventos, não apenas informações isoladas. Uma contratação de liderança de produto, seguida de lançamento de plataforma e expansão de mercado, pode representar um contexto diferente de uma contratação isolada.

## PARTE 3 — EVIDÊNCIAS, CONFIANÇA E REDUÇÃO DE ERROS

### 3.1. Separar fatos, interpretações e hipóteses

Essa separação deve existir em toda a arquitetura. Fato confirmado: informação sustentada por uma fonte identificável. Interpretação: conclusão construída a partir de fatos. Hipótese: possibilidade comercial que ainda precisa de confirmação. Não permita que uma hipótese seja apresentada como uma necessidade declarada pela empresa.

### 3.2. Hierarquia de fontes

Priorize:

1. Comunicados e documentos oficiais da empresa.
2. Relatórios e documentos institucionais.
3. Comunicados de investidores e parceiros.
4. Registros públicos oficiais.
5. Páginas de produtos, carreiras e notícias corporativas.
6. Publicações públicas de executivos e empresas.
7. Veículos jornalísticos confiáveis.
8. Pesquisas setoriais e fontes especializadas.

Fontes secundárias podem complementar a análise, mas não devem ser confundidas com a origem da informação.

### 3.3. Registro de evidências

Cada evidência importante deverá registrar: URL; origem; data de publicação; data de consulta; trecho de sustentação; empresa ou pessoa relacionada; tipo de afirmação; confiança; confirmações independentes; atualidade.
Implemente mecanismos para detectar informações antigas, contraditórias e duplicadas. Não considere republicações da mesma notícia como confirmações independentes. Não invente fontes, endereços, contatos ou citações.

### 3.4. Confiança não deve ser confundida com potencial

Apresente separadamente: potencial comercial; confiança da investigação; compatibilidade com a oferta; disponibilidade de contato.
Uma oportunidade de alto potencial pode estar parcialmente investigada. Isso deve permitir que o usuário decida se vale aprofundar a pesquisa. Não crie bloqueios excessivos.

## PARTE 4 — MOTOR DE COMPATIBILIDADE COMERCIAL

### 4.1. Relacionar contexto e capacidades

Implemente um mecanismo que relacione: Sinais empresariais → Problemas potenciais → Capacidades → Soluções → Estratégias de abordagem.
O sistema deve considerar: segmento; porte; maturidade; momento empresarial; complexidade do problema; necessidade potencial; compatibilidade com a experiência disponível; possibilidade de contratação; acesso aos decisores; evidências.

### 4.2. Não utilizar somente um score

Crie dimensões independentes de avaliação. Apresente: potencial estratégico; qualidade das evidências; compatibilidade comercial; momento; acessibilidade; viabilidade de execução.
Explique o motivo de cada avaliação. Não use números com falsa precisão. Uma classificação qualitativa acompanhada de justificativa e evidências é preferível a uma nota aparentemente científica sem validação.

### 4.3. Recomendar uma tese comercial

Toda empresa analisada deve receber uma recomendação estruturada: principal oportunidade identificada; contexto que sustenta a oportunidade; problema potencial; serviço ou solução compatível; por que essa solução faz sentido; por que este pode ser o momento adequado; qual perfil profissional deveria ser abordado; qual assunto deve iniciar a conversa; o que não deve ser oferecido; o que ainda precisa ser confirmado.
O sistema deve escolher um ângulo principal, podendo apresentar até duas alternativas relevantes. Não apresente todo o portfólio em uma abordagem.

## PARTE 5 — INTELIGÊNCIA DE COMUNICAÇÃO

### 5.1. A mensagem deve ser consequência da estratégia

Nunca gere um e-mail diretamente a partir da auditoria do site. Antes da redação, a IA precisa receber: contexto empresarial; momento atual; evidências relevantes; oportunidade comercial; serviço compatível; destinatário; estratégia de aproximação; objetivo da mensagem; canal; linguagem da agência ou produto.
A mensagem precisa ser consequência de uma tese comercial aprovada.

### 5.2. Analisar a linguagem da empresa prospectada

Antes de gerar a mensagem, pesquise a comunicação pública da empresa. Considere: site institucional; páginas de produto; publicações corporativas; redes sociais públicas; comunicados; entrevistas; conteúdos de executivos, quando pertinentes.
Identifique: formalidade; vocabulário; estilo de comunicação; termos recorrentes; posicionamento; personalidade; forma de apresentar produtos; forma de conversar com o público.
Utilize essa análise para adaptar o registro da mensagem. Não imite integralmente a voz da empresa, não simule vínculo ou intimidade e não escreva como se a Found Studio fizesse parte da organização prospectada. A adaptação deve tornar a comunicação contextualizada e natural.

### 5.3. Construir uma estratégia de primeiro contato

A primeira mensagem deve demonstrar que existe uma razão real para o contato. Considere diferentes estratégias: aproximação por movimentação empresarial; aproximação por expansão; aproximação por lançamento; aproximação por oportunidade de produto; aproximação por inovação; aproximação por desafio operacional; aproximação por posicionamento; aproximação por demanda explícita; networking profissional; pedido de direcionamento; apresentação institucional.
A IA deve selecionar a estratégia mais apropriada.

### 5.4. Naturalidade

A comunicação deve parecer escrita por um profissional que entende o negócio e deseja iniciar uma conversa. Não utilize estruturas comerciais repetitivas. Evite elogios vazios, diagnósticos superficiais, termos técnicos desnecessários, apresentações exageradas e solicitações de reunião sem contexto.
Não é obrigatório oferecer uma solução imediatamente. Em determinados casos, a melhor abordagem é demonstrar conhecimento sobre um movimento da empresa e fazer uma pergunta relevante.

### 5.5. Apresentar o método quando fizer sentido

O Prospector pode considerar a transparência sobre a pesquisa realizada. Por exemplo, em determinados contextos, pode ser interessante dizer que o contato surgiu de uma pesquisa independente sobre empresas do setor.
A existência de um sistema próprio de inteligência pode ser um elemento de diferenciação, mas não deve ser apresentada automaticamente em toda mensagem. A decisão deve considerar o destinatário e o objetivo da abordagem.

## PARTE 6 — NOVO COPILOTO OPERACIONAL

### 6.1. Interface

O Copiloto deve funcionar em uma experiência de chat semelhante ao ChatGPT ou Claude. O usuário já aprovou a direção visual geral do Prospector. Preserve o Design System existente. A correção principal é transformar a área de conversas em uma interface de chat de verdade.
Requisitos: layout com altura limitada à área disponível da aplicação; cabeçalho fixo; histórico de conversas em painel próprio; mensagens com rolagem interna; campo de composição fixo na parte inferior; respostas progressivas; estados de processamento; interrupção de execução; histórico persistente; retomada de pesquisas; resultados estruturados dentro da conversa; experiência responsiva.
O documento inteiro não deve rolar quando o usuário estiver conversando. Somente o histórico de mensagens deve possuir rolagem vertical. O campo de mensagem não deve desaparecer durante a leitura.
Revise especialmente `height`, `min-height`, `overflow` e o comportamento dos contêineres flexíveis para evitar rolagem indevida no shell da aplicação.

### 6.2. Copiloto como operador comercial

Não quero um chatbot limitado a responder perguntas sobre o banco de dados. Ele precisa interpretar e executar solicitações comerciais. Deve compreender intenções como: pesquisar empresas; pesquisar profissionais; encontrar segmentos; mapear mercados; analisar empresas; investigar acontecimentos; identificar decisores; encontrar contatos profissionais públicos; avaliar oportunidades; comparar empresas; relacionar serviços; criar listas comerciais; preparar campanhas; gerar abordagens; analisar respostas; sugerir próximos passos.
O Copiloto deve ter acesso às ferramentas de pesquisa, investigação, relacionamento e gestão comercial que já existem ou que forem implementadas. Não invente ferramentas. Identifique as existentes, conecte-as e desenvolva as que realmente estiverem faltando.

### 6.3. Contexto persistente

O Copiloto deve manter o contexto da conversa. Se o usuário pedir: "Encontre 100 terapeutas ocupacionais no Brasil." E posteriormente disser: "Agora priorize São Paulo e Minas Gerais." O sistema deve compreender que a segunda instrução modifica a pesquisa anterior, sem reiniciar todo o trabalho.
Deve preservar: objetivo; perfil comercial; público; critérios; região; quantidade solicitada; resultados já encontrados; fontes; filtros; etapa atual.
O contexto deve ser persistido e recuperado conforme a necessidade. Não dependa exclusivamente de uma conversa extensa enviada integralmente ao modelo. Utilize contexto estruturado, histórico e recuperação seletiva de informações.

### 6.4. Não limitar pesquisas

Se o usuário solicitar 100 resultados, execute uma pesquisa dimensionada para esse objetivo. Implemente: paginação; pesquisa por lotes; expansão geográfica; variações de termos; deduplicação; validação; controle de progresso; continuidade; armazenamento dos resultados.
Apresente o número solicitado e o número efetivamente encontrado. Se houver limitações de fontes, orçamento ou ferramentas, explique objetivamente. Não invente registros para completar uma quantidade.

### 6.5. Exemplo obrigatório: Blummy

Solicitação: "Quero encontrar 100 terapeutas ocupacionais no Brasil para apresentar a Blummy."
O Copiloto deve:

1. Identificar o perfil comercial Blummy.
2. Recuperar sua proposta de valor e público.
3. Compreender quais profissionais podem utilizar o produto.
4. Distinguir profissionais independentes, clínicas e gestores.
5. Planejar a pesquisa nacional.
6. Pesquisar profissionais e organizações.
7. Identificar distribuição regional.
8. Buscar informações profissionais públicas.
9. Identificar possíveis decisores.
10. Avaliar a compatibilidade com o produto.
11. Organizar os resultados.
12. Preparar uma estratégia de aproximação.

Os resultados devem apresentar, quando disponíveis: nome; profissão; cidade; estado; região; clínica ou organização; cargo ou função; perfil profissional; site; e-mail comercial público; telefone comercial público; fonte; data de verificação; justificativa de compatibilidade.
Diferencie usuário potencial, comprador e influenciador. Não presuma que todo terapeuta ocupacional possui uma clínica ou orçamento para contratar um SaaS.
Não colete indiscriminadamente dados pessoais. Respeite a LGPD e os termos das plataformas. Não faça scraping de áreas restritas ou deduza e-mails.

### 6.6. Comunicação do Copiloto

O Copiloto não deve fazer perguntas excessivas. Interprete a solicitação, utilize o perfil comercial e as configurações existentes e comece a executar.
Quando faltar uma informação não essencial, adote um padrão razoável e informe a premissa. Quando faltar uma informação essencial, faça uma pergunta objetiva. Não transforme cada solicitação em um formulário.

## PARTE 7 — NOVO RELATÓRIO DE INTELIGÊNCIA

A página da empresa deve preservar a apresentação visual já aprovada, mas a informação que alimenta seus blocos precisa evoluir. Organize o relatório em:

1. Resumo executivo.
2. Perfil da empresa.
3. Momento empresarial.
4. Linha do tempo de acontecimentos.
5. Análise de mercado.
6. Produto e tecnologia.
7. Marca e posicionamento.
8. Estrutura organizacional.
9. Oportunidades identificadas.
10. Necessidades potenciais.
11. Compatibilidade com as capacidades comerciais.
12. Estratégia recomendada.
13. Pessoas para abordar.
14. Fontes e evidências.
15. Incertezas e informações faltantes.

O resumo executivo deve responder rapidamente: Quem é a empresa? O que está acontecendo? Por que ela merece atenção? Onde podemos contribuir? Qual é a melhor abordagem?
As análises completas devem ficar disponíveis em seções próprias. Não apresente jargões internos, raciocínios brutos do modelo ou informações técnicas desnecessárias.

## PARTE 8 — VALIDAÇÃO E TESTES OBRIGATÓRIOS

Não considere essa evolução concluída simplesmente porque os novos prompts geram respostas mais longas. Precisamos validar a capacidade real do sistema. Construa uma bateria de cenários.

- **Caso 1 — Flash.** Entrada: empresa de tecnologia com informação pública sobre investimento de R$ 150 milhões. Validar: tipo e origem do investimento; finalidade declarada; movimentações posteriores; evolução de produto; contratações; mercado; necessidades potenciais; compatibilidade com as capacidades da Found Studio. O sistema não deve concluir automaticamente que o site precisa de rebranding ou que a empresa necessita de melhorias de contraste.
- **Caso 2 — Blummy.** Entrada: pesquisa de 100 terapeutas ocupacionais no Brasil. Validar: identificação do produto correto; pesquisa nacional; distribuição regional; quantidade real; qualidade dos contatos; fontes; segmentação; compatibilidade comercial.
- **Caso 3 — Startup em expansão.** Entrada: startup contratando profissionais de produto, tecnologia e inovação. Validar: interpretação das contratações; momento da empresa; necessidades potenciais; serviços compatíveis; estratégia de abordagem.
- **Caso 4 — Empresa com problema superficial de site.** Entrada: empresa sem outros sinais relevantes além de problemas de acessibilidade. Validar: se o sistema reconhece a limitação da oportunidade; se não transforma um detalhe técnico em uma grande oportunidade estratégica; se consegue recomendar uma abordagem mais adequada ou simplesmente não priorizar o contato.
- **Caso 5 — Empresa com demanda explícita.** Entrada: empresa que publicou uma oportunidade de contratação de profissional ou fornecedor para uma necessidade relacionada ao portfólio. Validar: identificação da demanda; prazo; responsável; compatibilidade; abordagem contextualizada.
- **Caso 6 — Informações contraditórias.** Entrada: duas fontes com informações diferentes sobre um acontecimento empresarial. Validar: identificação da divergência; hierarquia das fontes; registro da incerteza; ausência de conclusões inventadas.

**Métricas.** Crie avaliações específicas para: precisão factual; atualidade das informações; qualidade das fontes; profundidade da análise; relevância estratégica; compatibilidade comercial; qualidade dos decisores; naturalidade da mensagem; personalização; adequação ao contexto; tempo de resposta; taxa de falsos positivos.
Inclua revisão humana dos resultados. Não utilize apenas o próprio modelo para julgar a qualidade do próprio trabalho.

## PARTE 9 — ARQUITETURA E IMPLEMENTAÇÃO

Antes de implementar, faça o mapeamento dos componentes existentes. Verifique: `packages/agents`; `packages/application`; `packages/domain`; `packages/contracts`; `packages/db`; serviços de descoberta; serviços de investigação; serviços de relacionamento; gateway de IA; prompts versionados; Copiloto; persistência das conversas; tabelas de evidências; configurações de estratégia e ICP.
Avalie se a arquitetura atual suporta o novo fluxo. Não crie novas tabelas antes de verificar se as estruturas existentes podem ser estendidas. Se forem necessárias novas estruturas, apresente o modelo de dados e suas relações.
Considere, conceitualmente, entidades como: perfis comerciais; capacidades; ofertas; perfis de cliente ideal; campanhas; investigações; eventos empresariais; evidências; hipóteses comerciais; estratégias de abordagem; decisores; conversas e resultados.
Os nomes definitivos devem respeitar os padrões já existentes. Não introduza complexidade arquitetural sem necessidade. Não transforme cada etapa do fluxo em um agente independente se um serviço bem definido e um modelo especializado forem suficientes. Utilize ferramentas determinísticas para pesquisa, validação, deduplicação, cálculos e persistência. Reserve os modelos para interpretação, síntese e raciocínio.

**Modelos de IA.** Avalie o modelo local atual e alternativas compatíveis com o hardware disponível. Não presuma que o modelo de 4B é suficiente para todas as tarefas. Compare: raciocínio; pesquisa; síntese; redação; análise contextual; tempo; consumo de memória. Não substitua o modelo de produção sem avaliação e aprovação. Não execute benchmarks intensivos ou instalações sem autorização.

**Segurança.** Preserve: aprovação humana das mensagens; hash de conteúdo; auditoria; supressão; LGPD; controle de acesso; rastreabilidade; versionamento. Não habilite envio automático de prospecção. Não execute migrations no banco de produção sem autorização expressa. Preserve todas as alterações locais existentes, incluindo os trabalhos KI-187, KI-188 e desktop.

## PARTE 10 — ORDEM DE EXECUÇÃO

Organize a evolução em entregas verificáveis.

- **Fase 1 — Diagnóstico do motor atual:** mapear o fluxo existente, encontrar as desconexões e identificar as limitações. Entregar um diagrama do fluxo de dados e das decisões de IA.
- **Fase 2 — Perfil comercial e catálogo de capacidades:** construir a base estruturada da Found Studio e da Blummy. Relacionar capacidades, serviços, problemas, sinais comerciais e evidências.
- **Fase 3 — Investigação aprofundada:** evoluir a investigação empresarial, a linha do tempo e a validação das evidências.
- **Fase 4 — Inteligência estratégica:** construir a interpretação comercial, o motor de compatibilidade e as recomendações.
- **Fase 5 — Comunicação contextual:** integrar a tese comercial, o perfil do destinatário e a análise da linguagem da empresa à geração de mensagens.
- **Fase 6 — Copiloto operacional:** implementar o layout de chat e a execução de pesquisas extensas, com contexto persistente e resultados estruturados.
- **Fase 7 — Validação:** executar os seis cenários de teste, corrigir problemas e apresentar resultados.

A ordem pode ser ajustada caso a auditoria identifique dependências técnicas relevantes. Não tente implementar tudo simultaneamente sem validar cada camada.

## PARTE 11 — CRITÉRIOS DE ACEITAÇÃO

A evolução será considerada bem-sucedida quando:

1. O Prospector compreender corretamente as diferentes operações comerciais.
2. A Found Studio estiver representada como uma prática multidisciplinar integrada.
3. A Blummy puder ser prospectada independentemente.
4. A investigação for além da análise superficial do site.
5. Os acontecimentos empresariais forem contextualizados.
6. Fatos e hipóteses estiverem claramente separados.
7. As oportunidades forem relacionadas às capacidades reais.
8. A IA recomendar soluções, e não apenas entregáveis isolados.
9. A comunicação partir de uma tese comercial.
10. A linguagem da empresa prospectada for considerada.
11. O Copiloto executar pesquisas extensas.
12. Pesquisas anteriores puderem ser retomadas.
13. A interface de conversa não provocar rolagem da página inteira.
14. As informações tiverem fontes verificáveis.
15. A experiência continuar simples, apesar da inteligência interna.
16. Nenhuma regra de segurança ou conformidade for enfraquecida.

## PARTE 12 — ENTREGA AO RESPONSÁVEL PELO PRODUTO

Não quero apenas um relatório técnico. Apresente: diagnóstico do funcionamento atual; arquitetura de inteligência proposta; mapa de capacidades comerciais; modelo de compatibilidade; fluxo completo de investigação; fluxo de geração de mensagens; arquitetura do Copiloto; alterações implementadas; evidências dos testes; limitações existentes; decisões pendentes.

## PARTE 13 — PRONTIDÃO OPERACIONAL, CONFIGURAÇÃO E INTEGRIDADE DAS FUNCIONALIDADES

### 13.1. Diretriz obrigatória

O Prospector precisa ser entregue como um produto efetivamente funcional, não como uma estrutura de software que depende de configurações posteriores para operar. Toda funcionalidade implementada deve possuir suas dependências devidamente configuradas, suas integrações funcionando, seus dados sendo persistidos corretamente e seus resultados sendo apresentados sem erros.
Não quero descobrir durante a utilização que: uma pasta de armazenamento não foi configurada; um serviço não possui credenciais; uma integração está incompleta; uma funcionalidade depende de uma variável de ambiente ausente; um processo está funcionando apenas com dados simulados; uma imagem foi capturada, mas não foi armazenada; um resultado foi gerado, mas não foi persistido; uma página depende de uma configuração manual que nunca foi realizada; um componente apresenta dados, mas não possui conexão real com o serviço responsável.
Essas situações devem ser identificadas e resolvidas durante o desenvolvimento e a validação. Não considere uma funcionalidade concluída apenas porque sua interface está pronta ou porque uma parte do seu processamento funciona.

### 13.2. Armazenamento de imagens e evidências

Corrigir integralmente o sistema de captura e armazenamento de imagens utilizado nas análises empresariais. O exemplo identificado na análise da Flash apresenta a seguinte mensagem: "Imagem não guardada (pasta das capturas não configurada)." Esse comportamento é inaceitável em uma funcionalidade considerada implementada.
É necessário:

1. Identificar como as capturas são realizadas atualmente.
2. Identificar o serviço responsável pelo armazenamento.
3. Configurar corretamente o armazenamento.
4. Criar automaticamente os diretórios, buckets ou estruturas necessárias, conforme a arquitetura existente.
5. Configurar permissões de leitura e escrita.
6. Garantir que as imagens sejam persistidas.
7. Registrar os metadados das imagens no banco de dados.
8. Garantir que as imagens possam ser recuperadas posteriormente.
9. Garantir que os caminhos e URLs utilizados pela aplicação sejam válidos.
10. Implementar tratamento de falhas e novas tentativas.
11. Garantir que imagens antigas continuem acessíveis conforme as regras de retenção.
12. Evitar duplicações desnecessárias.

Não basta corrigir a mensagem visualmente. A persistência precisa funcionar de verdade.

### 13.3. Captura visual completa dos sites

A análise de marca e posicionamento deve possuir um processo confiável de captura visual. Para cada empresa investigada, quando tecnicamente possível, registrar:

- **Desktop:** página inicial; elementos principais da identidade; cabeçalho e navegação; seções relevantes; rodapé; elementos de destaque.
- **Mobile:** página inicial; navegação; organização dos elementos; hierarquia visual; comportamento responsivo; elementos relevantes da experiência.

A captura deve utilizar dimensões de viewport definidas e consistentes. Não utilizar apenas uma imagem genérica da página para representar toda a análise. Quando a empresa possuir páginas de produtos, serviços ou áreas institucionais relevantes, considerar capturas adicionais. As imagens precisam ser associadas à empresa e à investigação correspondente.

### 13.4. Integridade das evidências visuais

As imagens não são apenas elementos decorativos do relatório. Elas constituem evidências que sustentam a análise. Portanto: toda captura precisa estar vinculada à sua origem; registrar URL da página capturada; registrar data e horário; registrar viewport utilizado; identificar se é desktop ou mobile; registrar o resultado do processamento; preservar a relação entre imagem e análise correspondente.
A IA não deve afirmar que realizou uma análise visual de determinado elemento se não conseguiu acessar ou capturar esse elemento. Se a captura falhar, o sistema deve tentar novamente e diagnosticar o motivo. Se continuar indisponível, registrar a limitação com transparência e não apresentar a análise visual como concluída.

### 13.5. Configuração de infraestrutura

Faça uma auditoria de todas as dependências necessárias para o funcionamento integral do Prospector. Verifique, conforme a arquitetura efetivamente utilizada: banco de dados; armazenamento de arquivos; armazenamento de imagens; serviços de captura de páginas; navegador automatizado; APIs externas; gateway de inteligência artificial; modelo local; serviços de pesquisa; serviços de enriquecimento de dados; filas de processamento; workers; agendamentos; webhooks; autenticação; permissões; variáveis de ambiente; logs; monitoramento; backup; persistência de histórico; controle de custos e limites.
Não presuma que esses componentes estão configurados apenas porque existem no código. Verifique a configuração real de cada um.

### 13.6. Auditoria de dependências e integrações

Crie um inventário técnico contendo: nome do componente; finalidade; dependências; configuração atual; estado operacional; problemas identificados; correção necessária; teste realizado; resultado.
Classifique os componentes em: configurado e validado; configurado, mas não validado; incompleto; não configurado; dependente de credencial externa.
Não deixe configurações obrigatórias escondidas em arquivos de exemplo, variáveis fictícias ou comentários de desenvolvimento. Não coloque credenciais diretamente no código ou no repositório. Utilize os mecanismos seguros de configuração de segredos já existentes. Se uma credencial externa indispensável realmente não estiver disponível, identifique-a como bloqueio explícito. Não simule sucesso.

### 13.7. Validação de ponta a ponta

Toda funcionalidade precisa ser testada desde a entrada do usuário até a apresentação do resultado final. Exemplo da análise de uma empresa:

1. O usuário solicita a investigação.
2. O sistema identifica a empresa.
3. A pesquisa é executada.
4. O site é acessado.
5. As páginas são capturadas.
6. As imagens são armazenadas.
7. Os metadados são registrados.
8. A análise visual é executada.
9. As evidências são relacionadas às conclusões.
10. O relatório é persistido.
11. O usuário consegue visualizar as imagens.
12. O usuário consegue abrir a investigação novamente.
13. As imagens continuam disponíveis após atualizar a página ou reiniciar a aplicação.

O teste só será considerado aprovado quando o fluxo completo funcionar.

### 13.8. Proibição de funcionalidades parcialmente implementadas

Não considere concluídas funcionalidades que apresentem: placeholders permanentes; dados fictícios; resultados simulados; imagens não persistidas; botões sem ação; integrações desconectadas; serviços sem configuração; estados de carregamento infinitos; erros silenciosos; informações que desaparecem ao atualizar a página; resultados que não podem ser recuperados; dependências operacionais pendentes.
Se uma funcionalidade estiver incompleta, ela deve ser identificada como tal. Não esconda limitações com mensagens genéricas de sucesso.

### 13.9. Testes em ambiente limpo

Além dos testes durante o desenvolvimento, simule uma instalação ou inicialização em ambiente limpo de desenvolvimento ou homologação. Verifique se: todas as configurações necessárias estão documentadas; os serviços conseguem iniciar; as dependências estão disponíveis; as estruturas de armazenamento são criadas corretamente; as permissões funcionam; as integrações respondem; os processos em segundo plano executam; as informações persistem; não existem dependências de caminhos locais específicos do computador do desenvolvedor.
Não altere produção nem execute migrations irreversíveis sem a autorização prevista no projeto.

### 13.10. Critério de conclusão

Uma funcionalidade só poderá ser marcada como concluída quando atender simultaneamente a cinco condições:

1. Implementação: código e interface funcionais.
2. Configuração: dependências e integrações devidamente configuradas.
3. Persistência: dados e arquivos armazenados corretamente.
4. Validação: testes reais de ponta a ponta aprovados.
5. Recuperação: informações continuam disponíveis após atualização ou reinicialização.

### 13.11. Entrega obrigatória

Ao finalizar esta auditoria, apresente: lista de problemas encontrados; configurações realizadas; integrações validadas; dependências externas; testes executados; resultados dos testes; funcionalidades aprovadas; funcionalidades ainda pendentes; eventuais bloqueios que dependam de autorização.
Não declare o produto integralmente pronto enquanto existirem dependências obrigatórias sem configuração ou funcionalidades essenciais sem validação.

**DIRETRIZ FINAL:** O usuário não deve funcionar como testador de configurações esquecidas durante o desenvolvimento. O Prospector precisa chegar ao usuário com suas funcionalidades preparadas para uso, suas dependências operacionais resolvidas e seus fluxos devidamente testados. A complexidade técnica deve permanecer sob responsabilidade da arquitetura e do desenvolvimento. Para quem utiliza o produto, tudo precisa funcionar de maneira simples, consistente e previsível.

## Fechamento

Priorize a execução real e documente o que foi efetivamente concluído. Não apresente funcionalidades simuladas como implementadas. Não altere o que já está aprovado sem justificativa. Quando houver uma decisão que dependa de autorização, interrompa somente aquela parte, documente o impedimento e continue com as demais atividades seguras.

## OBJETIVO FINAL

Transformar o Prospector em uma plataforma de inteligência e desenvolvimento comercial capaz de compreender empresas, interpretar seus movimentos, identificar oportunidades reais, conectar essas oportunidades às capacidades comerciais disponíveis e construir abordagens profissionais, relevantes e personalizadas.
A tecnologia deve ser sofisticada. A análise deve ser profunda. A comunicação deve ser humana. A operação deve ser simples.
O diferencial do Prospector não será encontrar empresas ou escrever e-mails. Será compreender por que determinada empresa pode precisar de determinada solução, em determinado momento, e demonstrar isso de maneira inteligente no primeiro contato.
