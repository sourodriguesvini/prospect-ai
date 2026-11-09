# 03 — Canais de contato e conformidade (LGPD, e-mail, WhatsApp, LinkedIn, agendamento)

> Pesquisa de viabilidade técnica e regulatória. Data de consulta de todas as fontes: **2026-11-09**.
> Contexto: SaaS multi-tenant (Next.js/TypeScript/Supabase) de prospecção comercial para uma agência brasileira de branding. O sistema identifica empresas e decisores, gera abordagens personalizadas e gerencia contatos e cadências, **sempre com aprovação humana para ações externas**.
>
> **Isto não é parecer jurídico.** Os pontos que dependem de interpretação estão listados na seção 5 para validação por advogado.
>
> Convenções:
> - Cada afirmação traz o ID da fonte (`[J1]`, `[E3]` etc.). A lista completa com URL está na seção 6.
> - **[não verificado]**: não confirmado em fonte oficial nesta pesquisa.
> - **[inferência]**: conclusão minha a partir das fontes, não uma afirmação da fonte.
> - **[fonte secundária]**: vem de escritório de advocacia, imprensa, blog ou fornecedor, não do órgão ou da plataforma.
> - **[via resumo de busca]**: o conteúdo veio do resumo do mecanismo de busca sobre a página oficial, sem leitura integral da página.

---

## 1. Tabela-resumo de canais

| Canal | Integração | Autenticação | Custo | Regras / limites | Riscos | Veredito MVP |
|---|---|---|---|---|---|---|
| **E-mail 1:1 pela caixa Google do usuário** | Gmail API (`users.messages.send`) | OAuth 2.0 por usuário. `gmail.send` é escopo **sensível**: app público exige verificação, mas não exige avaliação de segurança [E1][E2]. Ler respostas (`gmail.readonly`, `gmail.metadata`, `gmail.modify`) é escopo **restrito** e exige avaliação de segurança anual por avaliador credenciado [E1][E2][E5]. App **interno** do Workspace da própria agência dispensa verificação [E3] | Licença Workspace do usuário. Tarifa da API: [não verificado]. A avaliação de escopo restrito é paga ao avaliador; o Google não cobra [E5] | Workspace: 2.000 mensagens/dia por usuário, 10.000 destinatários/dia, 3.000 destinatários externos/dia; contas em teste: 500 [E11]. Todos os remetentes: SPF ou DKIM, TLS, PTR válido, spam < 0,3% [E9]. Acima de 5.000/dia para Gmail pessoal: SPF + DKIM + DMARC, alinhamento e cancelamento com um clique [E9]. As Políticas do Programa Gmail proíbem "unsolicited commercial mail" [E7] | Suspensão ou limitação da conta do usuário [E7]; reputação do domínio da agência; escopo restrito se o produto quiser detectar respostas; base legal frágil para contato frio sem relação prévia (seção 2) | **Adotar** com volume baixo, mensagens 1:1 e aprovação humana. Começar só com envio (`gmail.send`). Detectar respostas via app interno (uso só pela agência) ou marcação manual |
| **E-mail 1:1 pela caixa Microsoft 365/Outlook** | Microsoft Graph `POST /me/sendMail` [E14] | OAuth 2.0 delegado. `Mail.Send` delegado: consentimento de admin "No"; como permissão de aplicativo: "Yes" [E15]. App multi-tenant sem *publisher verification* pode ter o consentimento de usuários bloqueado se a política de consentimento escalonado por risco estiver ativa [E16] | Licença do usuário; verificação de publisher sem custo [E16] | Exchange Online: 10.000 destinatários/dia e 30 mensagens/min por caixa [E17]. Outlook.com, acima de 5.000/dia: SPF + DKIM + DMARC (p=none no mínimo, alinhado) desde 5/5/2025 [E13] | A própria Microsoft diz que os limites existem para desestimular "unsolicited bulk messages" e indica provedores terceiros para e-mail comercial em massa legítimo [E17] | **Adotar** se a agência usar M365. Senão, fase 2 |
| **ESPs transacionais** (Resend, Postmark, SendGrid, Amazon SES) | API/SMTP | Chave de API | Por volume | As políticas de uso proíbem contato frio, listas compradas e listas sem opt-in [E19][E20][E21][E22] | Suspensão da conta; violação contratual | **Evitar** para prospecção. **Adotar** só para e-mails transacionais do próprio sistema (convites, notificações) |
| **Ferramentas de cold email** (Instantly, Smartlead, lemlist) | API própria e caixas conectadas | Chave de API; conectam caixas de terceiros | Assinatura | Os termos jogam toda a responsabilidade legal sobre o cliente [E25][E26] | Violação dos termos das caixas conectadas [E25]; automação de LinkedIn (lemlist) sujeita a restrição de conta [E27][LI2]; compliance fora do nosso controle | **Evitar** |
| **Verificação de e-mail** (ZeroBounce, NeverBounce) | API REST | Chave de API | ZeroBounce: 2.000 créditos por US$ 39 [E28] [fonte secundária] | Fornecedores nos EUA (suboperadores) | Transferência internacional sem mecanismo válido; envio de dados pessoais a terceiro | **Avaliar** (sob demanda, antes do primeiro envio, com DPA + cláusulas-padrão) |
| **WhatsApp Business Platform (Cloud API)** | Cloud API (Meta) via Embedded Signup (Tech Provider) ou BSP | Token de sistema por WABA do tenant; verificação do negócio para escalar limites [W6][W8] | Por mensagem entregue desde 1/7/2025, pelo código de país do destinatário [W1]. Desde 1/10/2026 também se cobram mensagens de serviço (acima de 1.000/mês por número) e utility dentro da janela [W1][W2] | Exige **opt-in prévio** do destinatário para a empresa específica [W3][W4]. Fora da janela de 24 h, só templates aprovados [W4]. Limite inicial de 250 usuários únicos por 24 h por portfólio [W6] | Não serve para primeiro contato frio; restrição ou banimento por denúncias e baixa qualidade [W4][W5] | **Avaliar** (fase 2, só após opt-in, por exemplo quando o prospect pede para continuar no WhatsApp). **Evitar** como canal frio |
| **WhatsApp não oficial** (Baileys, whatsapp-web.js) | Emula o WhatsApp Web | Sessão de aparelho vinculado | "Grátis" | Clientes não oficiais violam os Termos [W9]; envio em massa ou automatizado "always been a violation" [W10] | Banimento temporário ou permanente do número [W9]; as próprias bibliotecas admitem o risco [W11][W12] | **Evitar** |
| **LinkedIn** | Não há API self-service para mensagens ou convites. Invitations API e Messages API são restritas a parceiros aprovados [LI3][LI5] | n/a | n/a | O User Agreement §8.2 proíbe bots, scraping e automação de convites ou mensagens [LI1] | Restrição ou encerramento da conta [LI2] | **Adotar só fluxo assistido manual** (rascunho + link do perfil + registro manual). **Evitar** qualquer automação |
| **Agendamento** | Link do Cal.com ou Calendly na mensagem + webhook. Google Calendar API para criar evento com Meet | Cal.com: chave de API ou OAuth [C5]. Calendly: OAuth ou PAT [C3]. Google: OAuth (escopos de Calendar fora da lista de restritos) [E4] | Calendly: GET/POST em qualquer plano, inclusive o Free (exceto alguns endpoints Enterprise) [C3]. Cal.com: [não verificado] | Links de uso único do Calendly expiram em 90 dias [C3] | Baixo | **Adotar** link + webhook. Google Calendar API: **avaliar** (fase 2) |

**Leitura rápida [inferência]:** para o MVP, o único canal de saída automatizável e defensável é o **e-mail 1:1 a partir da caixa do próprio usuário** (Google ou Microsoft), em baixo volume e com aprovação humana por mensagem. LinkedIn entra como fluxo assistido manual. WhatsApp entra só depois de opt-in. Agendamento entra por link.

---

## 2. LGPD aplicada à prospecção B2B: obrigações práticas para o produto

### 2.1 O que é dado pessoal neste produto

- A LGPD trata de dados pessoais, definidos como "informação relacionada a pessoa natural identificada ou identificável" (art. 5º, I) [J1].
- **[inferência]** Dados só da empresa (CNPJ, razão social, setor, site institucional) não são dados pessoais. São dados pessoais: nome e cargo do decisor, e-mail nominal (fulano@empresa), telefone celular, URL de perfil profissional e sócios do QSA. Exceção: em empresas individuais (MEI, EI) os dados da empresa podem identificar a pessoa natural. Ver seção 5.
- Papéis: controlador é quem toma as decisões sobre o tratamento; operador é quem trata "em nome do controlador" (art. 5º, VI e VII) [J1]. O operador deve seguir as instruções do controlador (art. 39) [J1] e responde solidariamente quando descumpre a lei ou essas instruções (art. 42, §1º, I) [J1]. Segundo o guia da ANPD, o papel se define por operação de tratamento [J16] [via resumo de busca].
- **[inferência]** No desenho multi-tenant, cada agência (tenant) tende a ser **controladora** dos dados dos seus prospects e a plataforma, **operadora**. Esse enquadramento muda se a plataforma usar dados de um tenant em benefício de outro (base compartilhada de contatos, supressão entre tenants, treino de modelos). Ver seção 5.

### 2.2 Base legal: legítimo interesse (art. 7º, IX e art. 10)

O que a lei exige [J1]:
- Art. 7º, IX: tratamento "quando necessário para atender aos interesses legítimos do controlador ou de terceiro", salvo quando prevalecerem direitos e liberdades fundamentais do titular.
- Art. 10: finalidades legítimas, consideradas a partir de situações concretas, incluindo "apoio e promoção de atividades do controlador" (inciso I), respeitadas as legítimas expectativas do titular (inciso II).
- Art. 10, §1º: "somente os dados pessoais estritamente necessários para a finalidade pretendida poderão ser tratados."
- Art. 10, §2º: o controlador deve adotar medidas de transparência.
- Art. 10, §3º: a ANPD pode pedir relatório de impacto (RIPD).

O que diz o **Guia Orientativo da ANPD sobre Legítimo Interesse** (v1.0, fev/2024) [J2]:
- O teste de balanceamento é "uma boa prática e medida recomendável" (p. 31), ligado aos arts. 6º, X e 37. Tem três fases: **finalidade**, **necessidade** e **balanceamento e salvaguardas** (p. 31–32).
- Se o resultado for inconclusivo, ou se faltarem medidas de mitigação adequadas, "deverá ser adotada outra base legal" (p. 11).
- Legítima expectativa (p. 23): avaliar (a) se existe relação prévia, (b) a fonte e a forma da coleta (direta, por terceiros ou "coletados de fontes públicas"), (c) o contexto e o período da coleta e (d) a compatibilidade da finalidade.
- Transparência e registro (p. 25–26): informação clara sobre forma, duração e finalidade; identificação do controlador; direitos e "canais disponíveis para o seu exercício". O registro (art. 37) pode conter o teste de balanceamento.
- O modelo de teste (Anexo II, p. 52) pergunta se haverá canal de fácil acesso para os titulares "se descadastrar, de opor ao tratamento e de solicitar o término da operação e a eliminação de seus dados pessoais".
- **Marketing no guia:** os dois exemplos de envio de promoções (exemplos 5 e 6, p. 17–21) envolvem **relação prévia** (estudantes, funcionários) e trazem como salvaguarda um mecanismo de descadastramento. **O guia não traz exemplo de prospecção fria (sem relação prévia).** Esse é justamente o caso deste produto. Ver seção 5.

**Obrigações práticas [inferência a partir de J1/J2]:**
1. Um **LIA documentado por finalidade** (por exemplo: "prospecção B2B de serviços de branding para decisores de marketing/diretoria"), versionado e vinculado a cada campanha.
2. Restringir a coleta a **dados profissionais** ligados ao papel do decisor (nome, cargo, e-mail corporativo, empresa). Nada de CPF, endereço residencial, telefone pessoal ou dados sensíveis (o legítimo interesse não se aplica a dado sensível [J2]).
3. **Aviso na primeira mensagem**: quem é o remetente, por que a pessoa recebeu o contato, de onde veio o dado e como pedir para não ser mais contatada.
4. **Opt-out em toda mensagem**, honrado imediatamente e propagado a todos os canais e campanhas do tenant.
5. Política de privacidade da agência e do produto com seção sobre prospecção e canal do titular.

### 2.3 Dados de acesso público e "manifestamente públicos" (art. 7º, §§3º, 4º e 7º)

- §3º: o tratamento de dados de acesso público "deve considerar a finalidade, a boa-fé e o interesse público" que justificaram a disponibilização [J1].
- §4º: fica "dispensada a exigência do consentimento" para dados tornados manifestamente públicos pelo titular, resguardados seus direitos e os princípios da lei [J1].
- §7º: o tratamento posterior desses dados "poderá ser realizado" para novas finalidades, desde que observados propósitos legítimos e específicos e a preservação dos direitos do titular [J1].
- **QSA da Receita:** a Receita publica o quadro de sócios e administradores na consulta pública de CNPJ, que lista nome e CPF do sócio como dados tratados, e o disponibiliza como dado aberto desde 2017 (Decreto nº 8.777/2016) [J17].
  - **[inferência]** O QSA foi publicado por transparência e interesse público. Usá-lo para prospecção comercial é **nova finalidade** (§7º) e continua precisando de base legal (legítimo interesse) e do teste do §3º. "Público" não significa "livre".
  - Se o CPF aparece mascarado nos arquivos abertos atuais: [não verificado]. De toda forma, o projeto já proíbe armazenar CPF.
- **Perfis profissionais públicos (LinkedIn):** além da LGPD, há uma barreira **contratual**. O User Agreement do LinkedIn proíbe "scrape or copy the Services, including profiles and other data" (§8.2) [LI1].
  - **[inferência]** Consulta manual pelo usuário e anotação do mínimo necessário é diferente de extração automatizada.
- **Raspagem e agregadores:** a ANPD afirmou (circuito deliberativo CD 09/2026) que a coleta por agregadores, "inclusive mediante técnicas de raspagem de dados", pode "em tese, atrair a incidência" da LGPD [J8]. "Agregadores de dados pessoais" está na Agenda Regulatória 2025–2026 com foco em *web scraping* e transparência [J6].

### 2.4 Direitos do titular (art. 18), oposição e prazos

- Direitos [J1]: confirmação, acesso, correção, anonimização/bloqueio/eliminação de dados desnecessários, portabilidade, informação sobre compartilhamento, revogação de consentimento.
- **Oposição (art. 18, §2º):** o titular "pode opor-se a tratamento realizado com fundamento em uma das hipóteses de dispensa de consentimento", em caso de descumprimento da lei [J1]. O guia da ANPD liga a oposição à frustração de legítimas expectativas e prevê o encerramento da operação e a eliminação dos dados [J2, p. 24].
- **Propagação (art. 18, §6º):** o controlador deve informar os agentes com quem compartilhou dados sobre correção, eliminação, anonimização ou bloqueio [J1]. **[inferência]** O produto precisa propagar a supressão aos suboperadores (por exemplo: verificador de e-mail, ferramentas de agendamento).
- **Prazos (art. 19):** confirmação ou acesso em formato simplificado "imediatamente"; declaração completa "no prazo de até 15 (quinze) dias" [J1]. Agentes de pequeno porte têm prazo em dobro e declaração simplificada em até 15 dias (Res. 2/2022, arts. 14–15) [J3].
- **Item regulatório pendente:** "Direitos dos titulares" (arts. 9, 18, 19 e 20) está em **redação interna** na ANPD, sem consulta pública até a atualização de 20/10/2026 [J6]. Os prazos podem mudar.

### 2.5 Retenção, término e expurgo (arts. 15 e 16)

- O tratamento termina quando a finalidade é alcançada ou os dados "deixaram de ser necessários ou pertinentes", por comunicação do titular, ao fim do período ou por determinação da ANPD (art. 15) [J1].
- Depois disso os dados devem ser eliminados, exceto em hipóteses como cumprimento de obrigação legal ou uso exclusivo do controlador com dados **anonimizados** (art. 16) [J1].
- **[inferência]** Manter uma lista de supressão depois do opt-out é necessário para honrar a oposição. Guarde o mínimo possível (por exemplo, hash do e-mail ou telefone + data + canal). A base legal dessa retenção precisa de validação (seção 5).

### 2.6 Registro, RIPD, encarregado e segurança

- **Registro das operações** (art. 37), "especialmente quando baseado no legítimo interesse" [J1].
- **RIPD:** a ANPD pode determinar sua elaboração (art. 38) [J1]. O conteúdo mínimo inclui descrição dos dados, metodologia de coleta e de segurança e análise das medidas de mitigação (art. 38, parágrafo único) [J1].
  - O regulamento de RIPD está em redação interna [J6]. A proposta de Agenda 2027–2028 funde "alto risco" ao RIPD [J7].
  - **[inferência]** Prospecção com IA em escala é forte candidata a RIPD voluntário desde já.
- **Encarregado (art. 41)** com contato público. Agentes de pequeno porte podem dispensá-lo, mas precisam manter canal de comunicação com o titular (Res. 2/2022, art. 11) [J3].
- **Segurança desde a concepção** (art. 46, §2º) [J1].
- **Sanções (art. 52)**, entre outras: multa de até 2% do faturamento no Brasil, "limitada, no total, a R$ 50.000.000,00" por infração; bloqueio e eliminação dos dados; suspensão da atividade de tratamento [J1].

### 2.7 Decisões automatizadas (art. 20): o scoring é alcançado?

- O titular pode pedir revisão de decisões "tomadas unicamente com base em tratamento automatizado" que afetem seus interesses, incluindo as que definem seu perfil **profissional** (art. 20) [J1]. O controlador deve informar os critérios quando solicitado (§1º) e, se invocar segredo comercial, a ANPD pode auditar (§2º) [J1].
- **[inferência]**
  - Pontuar **empresas** (sinais de mercado, porte, momento de marca) não envolve dado pessoal, salvo empresa individual.
  - Pontuar ou perfilar **pessoas** (aderência do decisor, propensão a responder) é perfilamento profissional e pode cair no art. 20.
  - A aprovação humana obrigatória antes de qualquer contato reduz o argumento de decisão "unicamente" automatizada, desde que a revisão seja real e não carimbo. Mesmo assim, o produto deve conseguir **explicar os critérios** do score.
- A ANPD está regulando o tema: o item "Inteligência Artificial" da agenda prevê parâmetros interpretativos do art. 20. Houve tomada de subsídios (nov/2024 a jan/2025) consolidada na Nota Técnica 12/2025 [J6].

### 2.8 Agentes de tratamento de pequeno porte (Resolução CD/ANPD nº 2/2022)

- Benefícios [J3]:
  - registro simplificado (art. 9º);
  - dispensa de encarregado, mantendo canal com o titular (art. 11);
  - prazos em dobro para titulares, incidentes e ANPD (art. 14);
  - política de segurança simplificada (art. 13).
- **Não se aplicam** a quem faz tratamento de **alto risco** ou ultrapassa o teto de receita da LC 123/2006 ou da LC 182/2021, inclusive pelo grupo econômico (art. 3º) [J3].
- **Alto risco** = pelo menos um critério geral **e** um específico (art. 4º) [J3]:
  - gerais: larga escala, ou tratamento que possa afetar significativamente interesses e direitos fundamentais;
  - específicos: "uso de tecnologias emergentes ou inovadoras", vigilância de zonas públicas, decisões unicamente automatizadas "inclusive aquelas destinadas a definir o perfil pessoal, profissional", dados sensíveis ou de crianças, adolescentes e idosos.
- **[inferência]** Uma plataforma de prospecção com IA generativa provavelmente cumpre o critério específico "tecnologias emergentes ou inovadoras". Se também operar em **larga escala** (muitos titulares, volume, duração, extensão geográfica, conforme o §1º), passa a ser alto risco e **perde os benefícios**. A agência pode se enquadrar como pequeno porte, mas a avaliação é por agente e caso. Ver seção 5.

### 2.9 Incidentes de segurança (Resolução CD/ANPD nº 15/2024)

- Comunicar à ANPD em **três dias úteis** contados da ciência de que o incidente afetou dados pessoais (art. 6º) [J4].
- Comunicar aos titulares no mesmo prazo, em linguagem simples e, quando possível, de forma direta e individual (art. 9º) [J4].
- O dever se aplica quando o incidente pode afetar significativamente interesses e direitos fundamentais, combinado com critérios como dados sensíveis, financeiros, de autenticação ou em larga escala (art. 5º) [J4].
- **Registro de todos os incidentes**, inclusive os não comunicados, por no mínimo **cinco anos** (art. 10) [J4].
- Prazos em dobro para pequeno porte [J4][J3].
- **[inferência]** Tokens OAuth de caixas de e-mail e de WABA são "dados de autenticação". Vazamento deles provavelmente obriga comunicação. Criptografar e rotacionar.

### 2.10 Transferência internacional (Resolução CD/ANPD nº 19/2024): LLMs e SaaS dos EUA

- Mecanismos do art. 33 [J1]: adequação do país, cláusulas-padrão, cláusulas específicas, normas corporativas globais, consentimento específico, entre outros.
- A Res. 19/2024 [J5]:
  - Cláusulas-padrão (Anexo II) exigem "adoção integral e sem alteração do texto" (art. 16). Podem integrar um contrato mais amplo por termo aditivo (art. 16, §1º, II). Outras cláusulas não podem contrariá-las (art. 16, §2º).
  - Prazo de **12 meses** a partir de 23/08/2024 para incorporá-las aos contratos [J5]. **[inferência]** O prazo terminou em 23/08/2025.
  - Transparência: entregar a íntegra das cláusulas ao titular em **15 dias** se pedido (art. 17, §1º) e **publicar no site**, em português, documento sobre a transferência: forma, duração, finalidade, país de destino, contatos, direitos (art. 17, §2º).
  - "Coleta internacional" (coleta direta pelo agente no exterior) **não** é transferência (art. 6º), mas segue a LGPD quando houver hipótese do art. 3º [J5].
  - O operador deve ajudar o controlador a verificar se há transferência (art. 4º, §1º) [J5].
- **Brasil–UE:** decisões de adequação recíprocas anunciadas em janeiro de 2026 (Res. ANPD nº 32/2026) [J9] [fonte secundária]. Isso **não cobre os EUA**.
- **[inferência] Impacto no produto:**
  - Chamadas à API do Claude (Anthropic, EUA), a ESPs, verificadores de e-mail, Calendly ou Cal.com e hospedagem fora do Brasil são transferências internacionais. Cada contrato precisa das cláusulas-padrão da ANPD ou de outro mecanismo válido, e a política de privacidade precisa da página do art. 17, §2º.
  - O Supabase permite hospedar o projeto em `sa-east-1` (São Paulo), com banco, Auth, Storage e backups na região escolhida [S1] [via resumo de busca]. Isso reduz a superfície de transferência.
  - Verificar DPA, retenção e uso para treino de cada provedor de LLM: [não verificado nesta pesquisa].

### 2.11 Status regulatório em 2026

- **PL 2338/2023 (marco da IA):** na Câmara, "Aguardando Parecer do(a) Relator(a)" na Comissão Especial sobre IA, relator dep. Aguinaldo Ribeiro (designado em 20/05/2025). Sem parecer ou substitutivo registrado; últimas movimentações em 27/10/2026 são apensações [J11]. **Não é lei.** Fontes secundárias nos resultados de busca dizem que o relator adiou a votação para depois das eleições de outubro/2026 [J11b]. [não verificado: a atribuição exata não foi confirmada]
- **ANPD virou agência:** a MP 1317/2025 transforma a ANPD em autarquia de natureza especial (agência reguladora). Foi aprovada pela Câmara (9/2/2026) e pelo Senado (24/2/2026) [J10] [fonte secundária]. Documento oficial de set/2026 já usa o nome "Agência Nacional de Proteção de Dados" [J7]. Número da lei de conversão e data de sanção: [não verificado].
- **Agenda Regulatória 2025–2026 (atualizada em 20/10/2026)** [J6]:
  - em andamento: direitos dos titulares; IA e art. 20; RIPD; anonimização; agregadores de dados pessoais; hipótese legal do consentimento; medidas de segurança;
  - concluído: "alto risco".
  - **Não há item específico sobre legítimo interesse nem sobre perfilamento ou publicidade** [J6].
- **Proposta de Agenda 2027–2028** (NT 20/2026, set/2026) [J7]:
  - nova ação "IA generativa e proteção de dados", com parâmetros para o legítimo interesse no treino e na operação de IA generativa;
  - RIPD absorvendo "alto risco";
  - "agregadores" incorporados à ação de proteção ao crédito.
- **ECA Digital (Lei nº 15.211/2025)** tem a ANPD como autoridade [J7]. Relevância baixa para prospecção B2B.

### 2.12 "Não Me Perturbe" e outras normas sobre comunicação não solicitada

- **Não Me Perturbe:**
  - bloqueia **ligações de telemarketing** de empresas **participantes**: operadoras de telecom (Claro, Vivo, TIM, Oi etc.) e instituições financeiras, inclusive de crédito consignado [J12];
  - o site não menciona e-mail nem WhatsApp [J12];
  - **[inferência]** não se aplica diretamente a uma agência de branding fazendo e-mail B2B. Volta a importar se o produto ganhar canal telefônico.
- **Anatel:** tornou o prefixo 0303 de telemarketing **facultativo** em agosto de 2025 [J13] [fonte secundária].
- **Listas estaduais:** existem leis estaduais de bloqueio de telemarketing (por exemplo, "Não Me Ligue", do Procon-SP), algumas cobrindo SMS e WhatsApp [J13b] [fonte secundária, não verificado em fonte oficial].
- **CDC:**
  - art. 43, §2º: a abertura de cadastro com dados pessoais e de consumo "deverá ser comunicada por escrito ao consumidor" [J14];
  - art. 29: equipara a consumidor quem é exposto a práticas comerciais [J14];
  - **[inferência]** um decisor contatado como representante de empresa em contexto B2B dificilmente é "consumidor", mas a equiparação do art. 29 merece análise jurídica.
- **CAPEM:** Código de Autorregulamentação para a Prática de E-mail Marketing, Resolução CGI.br/RES/2009/001/P [J15]. Autorregulação, não lei. Texto não lido nesta pesquisa, conteúdo [não verificado].
- **Lei federal anti-spam:** não identifiquei lei federal específica de e-mail não solicitado em vigor [não verificado: ausência não comprovada].

---

## 3. Seção por canal

### 3.1 E-mail

#### 3.1.1 Gmail API (caixa do próprio usuário)

**Escopos e verificação**

| Escopo | Classificação [E1] | O que exige |
|---|---|---|
| `gmail.send` | Sensível | Verificação do app (marca + justificativa + vídeo de demonstração) se o app for público [E2]. **Sem** avaliação de segurança |
| `gmail.readonly`, `gmail.metadata`, `gmail.modify`, `gmail.compose`, `gmail.insert` | Restrito | Verificação de escopo restrito + avaliação de segurança anual por avaliador credenciado pelo Google ("annual security assessment from a Google empanelled group of security assessors") [E2] |
| `gmail.labels` | Não sensível | — |

Detalhes:
- **Avaliação de segurança (CASA):**
  - reavaliação a cada 12 meses;
  - o Google não cobra, mas o avaliador cobra;
  - certificações como SOC 2 e ISO 27001 podem ser reaproveitadas [E5] [via resumo de busca];
  - faixa indicativa de US$ 500 a US$ 4.500, citada na documentação de **outra** API do Google [E5b] [indicativo, não confirmado para Gmail].
- **Casos que dispensam verificação** [E3]:
  - **uso interno**: só pessoas da organização Workspace, projeto da organização e tipo de usuário "internal";
  - uso pessoal com menos de 100 usuários (com tela de app não verificado);
  - desenvolvimento e teste (teto de 100 usuários até a verificação).
- **Política de dados do Workspace** [E6]:
  - proíbe usar dados de usuário "to create, train, or improve a machine learning or artificial intelligence model", exceto modelo personalizado do próprio usuário;
  - proíbe transferir dados a terceiros como "advertising platforms, data brokers", salvo exceções (funcionalidade consentida, segurança, lei, M&A);
  - **[inferência]** se o produto ler respostas e passar o conteúdo ao Claude para classificar, isso precisa caber no uso "user-facing" e no Limited Use. Nunca usar para treino.

**[inferência] Implicação para o MVP:**
- Enviar com `gmail.send` é viável num app público com verificação simples.
- **Detectar respostas** automaticamente (pausar cadência quando o prospect responde) exige escopo restrito e avaliação anual.
- Alternativas:
  - (a) enquanto só a agência usa, registrar o app como **interno** no Workspace dela, sem verificação;
  - (b) marcação manual de "respondeu";
  - (c) planejar a avaliação de segurança antes de abrir o SaaS a outros tenants.

**Regras de uso e limites**
- Políticas do Programa Gmail [E7]:
  - "Don't use Gmail to distribute spam or unsolicited commercial mail";
  - proíbem automatizar a interface do Gmail para enviar;
  - o Google pode limitar ou encerrar o acesso.
- Política de Uso Aceitável do Google Cloud/Workspace (atualizada em 13/10/2025): veda e-mails em massa e mensagens não solicitadas (spam) [E8].
- **[inferência]** Mensagens 1:1, personalizadas, revisadas por humano e em baixo volume são o uso mais defensável. Disparo em série a listas frias contraria essas políticas.
- Limites do Workspace [E11]:
  - 2.000 mensagens/dia por usuário (1.500 em mala direta);
  - 10.000 destinatários/dia;
  - 3.000 destinatários externos/dia;
  - até 500 externos por mensagem;
  - contas em teste: 500/dia;
  - quem excede fica até 24 h sem enviar, e a reincidência pode suspender a conta.

#### 3.1.2 Microsoft Graph (Mail.Send)

- Endpoint `POST /me/sendMail`. A resposta 202 não garante entrega, que fica sujeita aos limites do Exchange Online [E14].
- Permissões [E15]:
  - `Mail.Send` delegado: consentimento de admin "No"; como aplicativo: "Yes";
  - `Mail.Read` e `Mail.ReadBasic` (para detectar respostas): mesmo padrão.
  - **Diferença em relação ao Google:** não há avaliação de segurança obrigatória equivalente [inferência: nenhuma exigência desse tipo encontrada nas páginas consultadas].
- **Publisher verification** [E16]:
  - desde novembro de 2020, com o consentimento escalonado por risco ativo, usuários não conseguem consentir em apps multi-tenant novos não verificados;
  - a verificação é gratuita e exige conta no Microsoft AI Cloud Partner Program e domínio verificado.
- Limites do Exchange Online [E17]:
  - 10.000 destinatários/dia e 30 mensagens/minuto por caixa;
  - existe limite por tenant de destinatários externos (TERRL);
  - a Microsoft diz que os limites existem "To discourage the delivery of unsolicited bulk messages" e manda quem precisa de e-mail comercial em massa legítimo usar provedores especializados.

#### 3.1.3 Regras de remetente: Google, Yahoo e Microsoft

| Requisito | Google (destino Gmail pessoal) [E9][E10] | Yahoo [E12] | Microsoft Outlook.com [E13] |
|---|---|---|---|
| Todos os remetentes | SPF **ou** DKIM (chave ≥ 1024 bits); PTR válido; TLS; spam < 0,3%; RFC 5322 | SPF ou DKIM; DNS direto e reverso; spam < 0,3%; RFC 5321/5322 | — (as regras valem para alto volume) |
| Limiar "bulk" | > 5.000 mensagens/24 h para contas pessoais do Gmail, somando o **domínio principal** (subdomínios incluídos); o status de bulk é **permanente** ("doesn't have an expiration date") [E10] | Não especificado na página | > 5.000 e-mails/dia por domínio |
| Autenticação bulk | SPF + DKIM + DMARC (p=none permitido) + alinhamento do From | SPF + DKIM + DMARC (≥ p=none, deve passar) | SPF + DKIM passando + DMARC ≥ p=none alinhado |
| Cancelamento | Um clique (RFC 8058) + link visível para mensagens comerciais; atender em **48 h** | Um clique (RFC 8058, POST recomendado) + link visível; atender em **2 dias** | Recomendado (link visível) |
| Taxa de spam | Ideal < 0,10%; nunca ≥ 0,30% | < 0,3% | Recomendado: higiene de lista |
| Aplicação | Desde 1/2/2024. **Desde novembro de 2025** o Gmail intensificou a aplicação, com rejeições temporárias (4.7.x) e permanentes (5.7.x) [E10] | Desde fevereiro de 2024, gradual | Desde 5/5/2025: lixo eletrônico primeiro, rejeição `550 5.7.515` depois, em data "to be announced" (post v4.0, 30/4/2025) |

Notas:
- As regras do Google **não se aplicam** a mensagens enviadas a contas **Google Workspace** (corporativas); valem só para Gmail pessoal [E10]. **[inferência]** Prospecção B2B atinge sobretudo domínios corporativos, mas o domínio da agência continua exposto aos filtros de cada destinatário.
- **RFC 8058** [E18]:
  - `List-Unsubscribe-Post: List-Unsubscribe=One-Click` + URI HTTPS em `List-Unsubscribe`;
  - os dois cabeçalhos "MUST be covered by the signature" DKIM;
  - o POST não pode exigir interação adicional nem redirecionar.
  - Se a Gmail API e o Graph preservam cabeçalhos `List-Unsubscribe` personalizados: [não verificado], testar na implementação.

#### 3.1.4 ESPs transacionais: o que dizem as políticas de uso

| ESP | O que a política diz sobre contato frio |
|---|---|
| **Resend** [E19] | Proíbe "sending unsolicited messages of any kind, including cold outreach", listas compradas e dados de contato raspados. Destinatários precisam ter "explicitly opted in". Opt-out em até 7 dias. Reclamações < 0,08%, bounce < 4% |
| **Postmark** [E20] | "All email lists ... must be permission-based subscriptions". Lista comprada ou alugada proibida. Envio não solicitado gera reclamações e pode suspender a conta |
| **SendGrid (Twilio)** [E21] | Proíbe listas compradas ou alugadas e listas de quem não deu consentimento afirmativo. Proíbe "Sending emails to email addresses that you obtained from the Internet or social media" sem consentimento prévio |
| **Amazon SES** [E22][E23][E24] | A Política de Uso Aceitável da AWS proíbe "unsolicited mass email". Os termos do SES permitem suspensão por bounces e reclamações. Revisão da conta com bounce ≥ 5% ou reclamação ≥ 0,1% [via resumo de busca] |

**[inferência]** Nenhum desses ESPs serve para prospecção fria. Use-os só para e-mails do próprio sistema.

#### 3.1.5 Ferramentas de cold email (Instantly, Smartlead, lemlist): riscos

- **Instantly** [E25]:
  - "Subscriber is solely responsible" pela conformidade com leis anti-spam (4.6(b)) e de privacidade (6.7);
  - "Instantly does not provide notices or obtain consents on Subscriber's behalf" (6.8);
  - proíbe conteúdo que "violates the terms of use ... for any Connected Accounts";
  - licença para usar dados desidentificados para melhorar o serviço (6.3).
- **Smartlead:** o cliente é responsável por obter consentimentos e provar isso quando pedido [E26] [via resumo de busca].
- **lemlist:** automatiza LinkedIn. O próprio suporte informa que o LinkedIn restringe ou bane contas com ações excessivas (teto aproximado de 100 convites por semana) [E27] [fonte do fornecedor, via resumo de busca]. Isso conflita com o User Agreement do LinkedIn [LI1].
- **[inferência]** Riscos:
  - a responsabilidade fica 100% com o cliente;
  - o modelo de "muitas caixas e alto volume" conflita com as políticas do Google e da Microsoft citadas acima;
  - mais um suboperador nos EUA;
  - perda de controle sobre aprovação humana e supressão.
  - Não recomendado.

#### 3.1.6 Verificação de e-mail (referência rápida)

- **ZeroBounce** [E28] [fonte do fornecedor]:
  - preço por crédito (2.000 por US$ 39);
  - diz ser SOC 2 Type 2 e ISO 27001, apagar arquivos enviados em até 30 dias e oferecer roteamento só UE ou só EUA.
- **NeverBounce** [E29]: preço e DPA [não verificado].
- **[inferência]** Use só quando for enviar (minimização), com DPA e cláusulas-padrão da ANPD, e registre o verificador como suboperador.

### 3.2 WhatsApp Business Platform (Cloud API)

**Opt-in e política**
- Só se pode contatar quem forneceu o número e deu permissão: "you have received opt-in permission from the recipient" [W4].
- A política pede consentimento por categoria de mensagem e exige honrar pedidos de parada "(dentro e fora do WhatsApp)", inclusive removendo a pessoa da lista de contatos [W4].
- A documentação de opt-in exige que a pessoa seja informada claramente de que está aceitando mensagens de uma empresa específica, com o nome dela. A permissão pode ser coletada por site, SMS, IVR ou papel e deve cumprir a lei aplicável [W3].
- **[inferência]** Número achado em fonte pública **não é opt-in**. O WhatsApp **não serve para o primeiro contato frio**.

**Mensagens iniciadas pela empresa**
- Fora da janela de 24 h, só modelos (templates) aprovados [W4].
- Categorias [W5]:
  - **Marketing**: inclui conteúdo misto (por exemplo, atualização + promoção) e conteúdo vago;
  - **Utility**: disparada por ação ou pedido do usuário, não promocional;
  - **Authentication**: só códigos de uso único.
- Utility indevida é recategorizada como marketing. Uso indevido reiterado leva a aviso, limitação de envio (≥ 7 dias), restrição de utility e restrição do portfólio inteiro (30 dias) [W5].
- **[inferência]** Uma abordagem comercial é sempre template de **marketing**.

**Preço (confirmado: cobrança por mensagem desde 1/7/2025)** [W1][W2]
- Cobra-se só mensagem **entregue**, conforme a categoria e o código de país do destinatário.
- Mensagens do usuário para a empresa não são cobradas.
- 1.000 mensagens de serviço grátis por mês por número.
- **Desde 1/10/2026**: cobrança por mensagem de todas as mensagens de serviço (acima da faixa grátis) e de utility enviadas em resposta dentro da janela. Utility e authentication têm faixas de volume.
- Brasil é mercado próprio. A página cita 0,68 ¢ por mensagem para utility e authentication no Brasil. A tarifa de marketing está no CSV do rate card [não verificado].
- Contas em BRL disponíveis desde 1/7/2026 [W1].

**Limites e verificação**
- Novos portfólios: **250 usuários únicos por 24 h** fora da janela, contados por **portfólio** (todos os números compartilham o limite). Níveis seguintes: 2.000, 10.000, 100.000, ilimitado [W6].
- Para chegar a 2.000: verificar o negócio, ou verificação pelo parceiro, ou 2.000 mensagens de alta qualidade em 30 dias. Depois disso, a escala é automática conforme a qualidade [W6].
- **Multi-tenant [inferência a partir de W7/W8, via resumo de busca]:**
  - como **Tech Provider**, o SaaS integra cada tenant por *Embedded Signup*, e cada agência tem a própria WABA e o próprio número;
  - exige verificação do negócio e App Review com acesso avançado a `whatsapp_business_messaging` e `whatsapp_business_management`;
  - o changelog de out/2025 indica mudança nos requisitos de verificação para virar Tech Provider [W7] (fontes conflitantes, confirmar).
  - A alternativa é usar um **BSP** (Solution Partner), que cuida de crédito e cobrança.

**Bibliotecas não oficiais (Baileys, whatsapp-web.js)**
- O WhatsApp diz que conectar a conta a versões não oficiais "é uma violação dos nossos Termos de Serviço", com banimento "temporária ou permanentemente" [W9].
- Mensagens em massa ou automatizadas "have always been a violation" [W10] [via resumo de busca].
- O whatsapp-web.js admite: "WhatsApp does not allow bots or unofficial clients ... it is not guaranteed you will not be blocked" [W11].
- O Baileys diz não ter afiliação com o WhatsApp e desaconselha "bulk or automated messaging" [W12].
- **Evitar.**

### 3.3 LinkedIn

- **API:**
  - a Invitations API traz a nota "Usage of this API is restricted to approved partners, subject to limitations via API agreement" [LI3];
  - a Messages API tem a mesma restrição, segundo resposta no Microsoft Q&A [LI5] [fonte secundária];
  - a Compliance API (arquivamento, não envio) não aceita novos parceiros [LI4] [via resumo de busca];
  - **[inferência]** não existe caminho self-service para enviar convites ou mensagens de prospecção por API.
- **User Agreement (vigente desde 3/11/2025), §8.2** [LI1], proíbe:
  - softwares, scripts ou robôs "to scrape or copy the Services, including profiles and other data";
  - "Use bots or other unauthorized automated methods to access the Services, add or download contacts, send or redirect messages";
  - "crawlers, browser plugins and add-ons".
- **Ferramentas proibidas:** extensões e bots que fazem scraping ou automatizam atividade violam o acordo. Contas podem ser "restricted or shut down" [LI2].

**Fluxo assistido recomendado [inferência]**
1. O sistema prepara o rascunho (convite ≤ limite de caracteres do LinkedIn [não verificado] e mensagem), já aprovado pelo humano, com a **justificativa e as evidências**.
2. A interface mostra botões "copiar texto" e "abrir perfil" (link digitado ou colado pelo usuário, sem extração automática).
3. O **usuário envia manualmente** no LinkedIn.
4. O usuário registra o resultado no sistema: enviado, aceito, respondeu, pediu para parar. O pedido de parada vai para a supressão.
5. Não armazenar conteúdo copiado do LinkedIn além do mínimo anotado pelo usuário (cargo, empresa). Nenhuma extensão de navegador.

### 3.4 Agendamento

- **Google Calendar API** [C1][C2]:
  - `events.insert`/`patch` com `attendees`;
  - `sendUpdates: "all"` ou `"externalOnly"` para enviar convites;
  - Meet via `conferenceData.createRequest` com `conferenceDataVersion=1` (criação assíncrona: `pending` → `success`);
  - prefira o escopo mais estreito, como `calendar.events.owned` ou `calendar.app.created`;
  - nenhum escopo do Calendar aparece na lista de escopos restritos do Google [E4], portanto sem avaliação de segurança. Classificação sensível ou não sensível: [não verificado].
- **Calendly** [C3][C4]:
  - API v2 com OAuth ou token pessoal;
  - GET e POST permitidos em qualquer plano, inclusive o Free, salvo alguns endpoints Enterprise;
  - webhooks em todos os planos;
  - links de uso único expiram em 90 dias;
  - existe uma Scheduling API para criar agendamentos ("Create Event Invitee"). Um texto do Calendly menciona exigência de plano pago (conflito com o FAQ) [via resumo de busca].
- **Cal.com** [C5] [via resumo de busca]:
  - API v2 com `POST /v2/bookings` (regular, recorrente, instantâneo) e header `cal-api-version`;
  - criar, cancelar e remarcar booking e consultar disponibilidade são públicos (sem escopo);
  - OAuth com escopos como `BOOKING_WRITE`;
  - reserva temporária de slot via `POST /v2/slots/reservations`.
- **[inferência]** No MVP, basta incluir o **link de agendamento** do usuário (Cal.com ou Calendly) na mensagem aprovada e assinar o **webhook** de agendamento para registrar a reunião e pausar a cadência. Criar eventos pelo Google Calendar fica para a fase 2.

---

## 4. Controles obrigatórios do sistema

> Compatíveis com as regras inegociáveis do `CLAUDE.md` (aprovação com `approval_id` + `payload_hash`; supressão checada no envio; LGPD). Onde não há fonte, é **recomendação de desenho [inferência]**.

### 4.1 Supressão e opt-out
1. **Lista de supressão por tenant, global entre canais e campanhas:**
   - chaves normalizadas (e-mail em minúsculas, telefone E.164, domínio inteiro opcional), guardadas como hash quando possível;
   - verificada **no momento do envio**, não só no agendamento.
2. **Opt-out em todo canal:**
   - e-mail: texto claro + link de descadastro em cada mensagem; cabeçalho RFC 8058 quando viável [E18];
   - resposta "pare" ou "não tenho interesse" detectada ou marcada → supressão;
   - WhatsApp: palavra de parada + honrar pedidos feitos fora do WhatsApp [W4];
   - LinkedIn: registro manual.
   - Prazo: imediato. Benchmarks externos: Google 48 h [E10], Yahoo 2 dias [E12], Resend 7 dias [E19].
3. **Oposição (art. 18, §2º) e eliminação:** canal do titular (e-mail do encarregado ou formulário). A eliminação apaga o registro do prospect e **mantém só o hash** na supressão. A operação é propagada aos suboperadores (art. 18, §6º) [J1].
4. **Domínios e pessoas sensíveis:** bloqueio de domínios pessoais (gmail.com, hotmail.com etc.) para prospecção fria, configurável [inferência: reforça o caráter B2B e a legítima expectativa].

### 4.2 Base legal, origem e minimização
5. **Registro de base legal por contato:** `legal_basis` (padrão: legítimo interesse), `lia_id` versionado (seção 2.2), finalidade e campanha.
6. **Origem do dado (proveniência):** fonte (URL ou registro público, cadastro manual, indicação, inbound), data da coleta, quem coletou (usuário ou agente), método (manual, API autorizada). **Proibido:** scraping de LinkedIn ou de plataformas cujos termos vedam [LI1].
7. **Minimização:** esquema com lista fechada de campos pessoais permitidos (nome, cargo, e-mail corporativo, telefone corporativo opcional, URL de perfil digitada pelo usuário). Sem CPF, sem dados sensíveis, sem dados de familiares. Validação no contrato Zod.
8. **Aviso de origem** na primeira mensagem: identifica o remetente e a agência, explica por que contatou e de onde veio o contato, e oferece o opt-out [J2].

### 4.3 Retenção e expurgo
9. **Política de retenção configurável por tenant** com padrão conservador [recomendação; prazo exato a validar juridicamente]. Exemplos: prospect sem resposta → anonimizar ou eliminar após N meses do último contato; prospect que pediu parada → eliminar dados e manter hash na supressão.
10. **Expurgo automatizado** com job agendado, relatório e trilha. Backups com política de expiração coerente.

### 4.4 Aprovação humana, auditoria e limites
11. **Aprovação humana por envio:** cada mensagem externa exige aprovação vinculada ao `payload_hash` do conteúdo final, destinatário e canal. Qualquer edição invalida a aprovação.
12. **Trilha de auditoria imutável** (append-only): quem aprovou, quando, o que foi enviado, por qual canal, base legal, origem, resultado (entregue, bounce, resposta, opt-out). Inclui decisões de IA e score com critérios (art. 20, §1º) [J1].
13. **Limites de volume** por caixa, por usuário e por tenant, bem abaixo dos tetos dos provedores (2.000/dia no Workspace [E11], 10.000 destinatários/dia e 30/min no Exchange [E17], 250 usuários/24 h no WhatsApp inicial [W6]).
    - Sugestão de partida: ≤ 50 primeiros contatos por dia por caixa, com aquecimento gradual [recomendação própria, sem fonte].
    - Intervalo aleatório entre envios e janela de horário comercial.
14. **Disjuntores de reputação:** pausar a caixa ou a campanha automaticamente se:
    - bounce > 3% (abaixo dos 4% do Resend e dos 5% do SES [E19][E24]);
    - qualquer reclamação de spam;
    - opt-out acima de um limiar.
    - Para volumes que cheguem perto de 5.000/dia ao Gmail pessoal, monitorar o Postmaster Tools (spam < 0,1%) [E9].
15. **Autenticação do domínio** antes de liberar envio: checagem de SPF, DKIM e DMARC do domínio do usuário [E9][E12][E13]. Recomendar um subdomínio ou domínio dedicado para prospecção só depois de avaliar o efeito no domínio principal (o Google soma subdomínios ao domínio principal [E10]).

### 4.5 Segurança, terceiros e transferências
16. **Tokens OAuth e WABA** criptografados por tenant (Vault), com escopo mínimo (`gmail.send`, `Mail.Send`), revogação e rotação. Registro de incidentes por 5 anos e fluxo de comunicação em 3 dias úteis [J4].
17. **DPA com suboperadores** (Supabase, Anthropic, provedores de e-mail transacional, verificador, Calendly/Cal.com, Meta/BSP, hospedagem):
    - cláusulas-padrão da ANPD **integrais e sem alteração** [J5];
    - página de transparência sobre transferências (art. 17, §2º) [J5];
    - lista pública de suboperadores para os tenants.
18. **Contrato plataforma ↔ tenant** (operador ↔ controlador): instruções, finalidade, proibição de uso cruzado entre tenants, apoio a direitos do titular e a incidentes (arts. 39 e 42) [J1].
19. **Dados de IA:** nenhum dado de prospect usado para treino. Conteúdo lido de caixas Google sujeito ao Limited Use [E6]. Prompts e saídas com dados pessoais ficam sob as regras de retenção acima.
20. **Documentação de conformidade:** LIA por finalidade, registro de operações (art. 37), RIPD voluntário (art. 38), política de privacidade com seção de prospecção, encarregado ou canal (art. 41; Res. 2/2022, art. 11) [J1][J3].

### 4.6 Canais viáveis para o MVP

| Ordem | Canal | Condição |
|---|---|---|
| 1 | E-mail 1:1 via Gmail API (`gmail.send`) e/ou Graph (`Mail.Send`) | Volume baixo, aprovação por mensagem, controles 4.1 a 4.5. Respostas: app interno (só a agência) ou marcação manual |
| 2 | LinkedIn assistido (manual) | Sem automação nem extensões |
| 3 | Link de agendamento (Cal.com ou Calendly) + webhook | — |
| Fase 2 | WhatsApp Cloud API | Só após opt-in documentado; templates de marketing; WABA por tenant |
| Fase 2 | Detecção automática de respostas no Gmail para SaaS multi-tenant | Exige verificação de escopo restrito + avaliação anual [E2][E5] |
| Fora | ESPs para prospecção, ferramentas de cold email, WhatsApp não oficial, automação de LinkedIn | Violação de políticas ou termos |

---

## 5. Pontos que exigem validação jurídica

1. **Legítimo interesse para prospecção fria B2B sem relação prévia.** O guia da ANPD só traz exemplos com relação prévia [J2]. É preciso validar se o LIA proposto (dados profissionais, oferta ligada ao cargo, aviso de origem, opt-out imediato) sustenta a base legal, e se há casos em que só o consentimento serve (por exemplo, e-mail pessoal, celular pessoal).
2. **Reuso de dados públicos** (QSA da Receita, sites institucionais, perfis profissionais) para prospecção: enquadramento nos §§3º, 4º e 7º do art. 7º [J1]. E-mail ou telefone publicado pelo próprio titular em contexto profissional conta como "manifestamente público"?
3. **Empresas individuais (MEI, EI) e sócios:** quando dados "da empresa" passam a ser dados pessoais e que cuidados extras isso exige.
4. **Papéis plataforma × tenant:** confirmar que a plataforma é operadora. Avaliar se alguma funcionalidade (enriquecimento com base própria, supressão compartilhada entre tenants, aprendizado com resultados de vários tenants) a torna controladora ou cocontroladora [J1][J16].
5. **Supressão entre tenants:** se um titular pede à plataforma para nunca mais ser contatado por nenhum cliente, a plataforma pode manter e aplicar essa lista para todos os tenants? Com que base legal?
6. **Retenção:** prazos de eliminação de prospects sem resposta e base legal para manter o hash de supressão após a eliminação (art. 16) [J1].
7. **Art. 20 e scoring de pessoas:** se a aprovação humana afasta a decisão "unicamente automatizada" e qual o nível de explicação de critérios devido [J1][J6].
8. **Pequeno porte e alto risco:** se a agência e a plataforma se enquadram na Res. 2/2022 ou se o uso de IA ("tecnologias emergentes ou inovadoras") + escala as torna alto risco [J3].
9. **RIPD:** necessidade e momento de elaborar, antes do regulamento específico [J6][J7].
10. **Transferência internacional:** escolha do mecanismo para cada provedor dos EUA (cláusulas-padrão da ANPD no contrato do provedor ou em aditivo), redação da página do art. 17, §2º [J5] e situação da adequação Brasil–UE [J9].
11. **CDC (arts. 29 e 43):** se o decisor contatado pode ser equiparado a consumidor e se há dever de comunicar por escrito a abertura de cadastro [J14].
12. **Leis estaduais de bloqueio de telemarketing e mensagens** (por exemplo, SP) e o CAPEM, se o produto incluir telefone, SMS ou WhatsApp [J12][J13b][J15].
13. **Termos das plataformas como risco contratual:** leitura jurídica das Políticas do Programa Gmail e da Política de Uso Aceitável do Google [E7][E8] e da Exchange Online [E17] quanto a prospecção 1:1 em baixo volume.
14. **Conteúdo gerado por IA:** responsabilidade por afirmações factuais nas mensagens (evidência tipada) e eventual impacto do PL 2338/2023 quando votado [J11].

---

## 6. Fontes (todas consultadas em 2026-11-09)

### LGPD, ANPD e normas brasileiras
| ID | Fonte | URL |
|---|---|---|
| J1 | Lei nº 13.709/2018 (LGPD), texto compilado — Planalto | https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm |
| J2 | ANPD — Guia Orientativo: Hipóteses Legais de Tratamento de Dados Pessoais — Legítimo Interesse (v1.0, fev/2024). Texto lido da cópia idêntica em https://tce.pb.gov.br/wp-content/uploads/2025/03/guia_legitimo_interesse.pdf | https://www.gov.br/anpd/pt-br/centrais-de-conteudo/materiais-educativos-e-publicacoes/guia_legitimo_interesse.pdf |
| J3 | Resolução CD/ANPD nº 2/2022 (DOU). Texto lido da cópia em https://www.gov.br/palmares/pt-br/midias/arquivos-menu-acesso-a-informacao/legislacao/resolucao-cd-anpd-n2-2022.pdf | https://in.gov.br/en/web/dou/-/resolucao-cd/anpd-n-2-de-27-de-janeiro-de-2022-376562019 |
| J4 | Resolução CD/ANPD nº 15/2024 (incidentes), reprodução do texto [fonte secundária] | https://www.legisweb.com.br/legislacao/?id=458235 |
| J5 | Resolução CD/ANPD nº 19/2024 (transferência internacional), impressão da página do DOU de 23/08/2024 | https://arq.migalhas.com.br/arquivos/2026/2/DC8DD5485D6EBE_RESOLUCAOCD_ANPDNº19,DE23DEAGO.pdf |
| J6 | ANPD — Agenda Regulatória (status atualizado em 20/10/2026) | https://www.gov.br/anpd/pt-br/assuntos/regulacao/agenda-regulatoria-1 |
| J7 | ANPD — Nota Técnica nº 20/2026 (proposta de Agenda Regulatória 2027–2028) | https://www.gov.br/anpd/pt-br/acesso-a-informacao/participacao-social/outras-acoes/ts-04-2026-nota-tecnica-no-20-2026.pdf/@@display-file/file |
| J8 | ANPD — Circuito Deliberativo CD 09/2026, votos (raspagem e agregadores) | https://www.gov.br/anpd/pt-br/assuntos/deliberacoes-do-conselho-diretor-1/circuitos-deliberativos-ano-2026/cd-09-2026-votos.pdf/@@display-file/file |
| J9 | Mattos Filho — Brasil e UE têm níveis de proteção equivalentes [fonte secundária] | https://www.mattosfilho.com.br/unico/brasil-ue-protecao-dados-equivalentes/ |
| J10 | MP 1317/2025 aprovada pelo Senado [fonte secundária] | https://www.registrodeimoveis.org.br/mp-que-torna-anpd-agencia-reguladora-e-aprovada-pelo-senado |
| J11 | Câmara dos Deputados — ficha de tramitação do PL 2338/2023 | https://www.camara.leg.br/proposicoesWeb/fichadetramitacao?idProposicao=2487262 |
| J11b | Status do PL 2338 em 2026 [fonte secundária; um dos resultados de busca, sem leitura integral] | https://mentrun.com.br/blog/pl-2338-2026 |
| J12 | Não Me Perturbe — site oficial | https://www.naomeperturbe.com.br/ |
| J13 | Exame — Anatel deixa de exigir 0303 [fonte secundária] | https://exame.com/brasil/anatel-deixa-de-exigir-uso-do-prefixo-0303-em-ligacoes-de-telemarketing/ |
| J13b | Tecnoblog — Não Me Perturbe e alternativas estaduais [fonte secundária] | https://tecnoblog.net/noticias/nao-me-perturbe-tem-10-milhoes-de-cadastros-mas-operadoras-seguem-ligando/ |
| J14 | Lei nº 8.078/1990 (CDC), compilado — Planalto | https://www.planalto.gov.br/ccivil_03/leis/l8078compilado.htm |
| J15 | CGI.br — Resolução CGI.br/RES/2009/001/P (CAPEM), registro de catálogo | https://busca.acervo.nic.br/vufind/Record/oai:bibliotecadigital.acervo.nic.br:123456789-4784/Similar?lng=da |
| J16 | ANPD — Guia de Agentes de Tratamento e Encarregado (v2) [via resumo de busca] | https://www.gov.br/anpd/pt-br/centrais-de-conteudo/materiais-educativos-e-publicacoes/Segunda_Versao_do_Guia_de_Agentes_de_Tratamento_retificada.pdf/@@display-file/file |
| J17 | Gov.br — Consultar CNPJ (QSA) e Receita Federal — disponibilização do QSA (2017) | https://www.gov.br/pt-br/servicos/consultar-cadastro-nacional-de-pessoas-juridicas · https://www.gov.br/receitafederal/pt-br/assuntos/noticias/2017/dezembro/receita-federal-disponibiliza-dados-de-quadros-societarios-e-de-administradores-qsa-em-sua-pagina-na-internet |

### E-mail
| ID | Fonte | URL |
|---|---|---|
| E1 | Google — Choose Gmail API scopes | https://developers.google.com/workspace/gmail/api/auth/scopes |
| E2 | Google Cloud Help — Sensitive and restricted scopes | https://support.google.com/cloud/answer/13464321 |
| E3 | Google Cloud Help — When verification is not needed | https://support.google.com/cloud/answer/13464323 |
| E4 | Google Cloud Help — Restricted scopes (lista) | https://support.google.com/cloud/answer/13464325 |
| E5 | Google — Restricted scope verification / Security assessment [via resumo de busca] | https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification · https://support.google.com/cloud/answer/13465431 |
| E5b | Google Health API — App verification (faixa de custo indicativa) [via resumo de busca] | https://developers.google.com/health/app-verification |
| E6 | Google Workspace user data and developer policy | https://developers.google.com/workspace/workspace-api-user-data-developer-policy |
| E7 | Gmail Program Policies | https://support.google.com/mail/answer/16734397 |
| E8 | Google Cloud/Workspace Acceptable Use Policy | https://workspace.google.com/terms/use_policy/ |
| E9 | Gmail — Email sender guidelines | https://support.google.com/a/answer/81126 |
| E10 | Gmail — Email sender guidelines FAQ | https://support.google.com/a/answer/14229414 |
| E11 | Google Workspace — Gmail sending limits | https://knowledge.workspace.google.com/admin/gmail/gmail-sending-limits-in-google-workspace |
| E12 | Yahoo Sender Hub — Best practices / requirements | https://senders.yahooinc.com/best-practices/ |
| E13 | Microsoft Tech Community — Outlook's new requirements for high-volume senders (v4.0, 30/04/2025) | https://techcommunity.microsoft.com/blog/microsoftdefenderforoffice365blog/strengthening-email-ecosystem-outlook%E2%80%99s-new-requirements-for-high%E2%80%90volume-senders/4399730 |
| E14 | Microsoft Graph — user: sendMail | https://learn.microsoft.com/en-us/graph/api/user-sendmail?view=graph-rest-1.0 |
| E15 | Microsoft Graph — permissions reference | https://learn.microsoft.com/en-us/graph/permissions-reference |
| E16 | Microsoft Entra — Publisher verification overview | https://learn.microsoft.com/en-us/entra/identity-platform/publisher-verification-overview |
| E17 | Exchange Online limits | https://learn.microsoft.com/en-us/office365/servicedescriptions/exchange-online-service-description/exchange-online-limits |
| E18 | RFC 8058 — Signaling One-Click Functionality for List Email Headers | https://www.rfc-editor.org/rfc/rfc8058 |
| E19 | Resend — Acceptable Use Policy | https://resend.com/legal/acceptable-use |
| E20 | Postmark — Terms of Service | https://postmarkapp.com/terms-of-service |
| E21 | Twilio SendGrid — Email Prohibited Content Types and Uses | https://support.sendgrid.com/hc/en-us/articles/4404316003483-Twilio-SendGrid-Email-Prohibited-Content-Types-and-Uses |
| E22 | AWS Acceptable Use Policy | https://aws.amazon.com/aup/ |
| E23 | AWS Service Terms (seção 15, SES) | https://aws.amazon.com/service-terms/ |
| E24 | Amazon SES — Sending review process FAQs [via resumo de busca] | https://docs.aws.amazon.com/ses/latest/dg/faqs-enforcement.html |
| E25 | Instantly — Terms | https://instantly.ai/terms |
| E26 | Smartlead — Terms and Conditions [via resumo de busca] | https://www.smartlead.ai/new-terms-and-conditions |
| E27 | lemlist Help — Fix LinkedIn disconnections and restrictions [fonte do fornecedor, via resumo de busca] | http://help.lemlist.com/en/articles/12856275-fix-linkedin-disconnections-and-restrictions-in-lemlist |
| E28 | ZeroBounce — Facts / Pricing [fonte do fornecedor] | https://www.zerobounce.net/facts · https://www.zerobounce.net/pricing |
| E29 | NeverBounce — Email verifier | https://www.neverbounce.com/email-verifier |

### WhatsApp
| ID | Fonte | URL |
|---|---|---|
| W1 | Meta — Pricing on the WhatsApp Business Platform | https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing |
| W2 | Meta — Pricing updates for service and utility messages (non-template) | https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing/non-template-messages |
| W3 | Meta — Getting opt-in | https://developers.facebook.com/documentation/business-messaging/whatsapp/getting-opt-in |
| W4 | WhatsApp Business Messaging Policy (atualizada em 23/09/2026; redirecionada de business.whatsapp.com/policy) | https://whatsappbusiness.com/pt-br/policy/ |
| W5 | Meta — Template categorization | https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/template-categorization |
| W6 | Meta — Messaging limits | https://developers.facebook.com/documentation/business-messaging/whatsapp/messaging-limits |
| W7 | Meta — Become a Tech Provider; WhatsApp changelog [via resumo de busca] | https://developers.facebook.com/documentation/business-messaging/whatsapp/solution-providers/get-started-for-tech-providers · https://developers.facebook.com/documentation/business-messaging/whatsapp/changelog |
| W8 | Meta — Embedded Signup [via resumo de busca] | https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/overview |
| W9 | WhatsApp FAQ — Sobre apps não oficiais | https://faq.whatsapp.com/1217634902127718 |
| W10 | WhatsApp FAQ — Unauthorized use of automated or bulk messaging [via resumo de busca] | https://faq.whatsapp.com/5957850900902049 |
| W11 | whatsapp-web.js — README | https://github.com/pedroslopez/whatsapp-web.js |
| W12 | Baileys — README | https://github.com/WhiskeySockets/Baileys |

### LinkedIn
| ID | Fonte | URL |
|---|---|---|
| LI1 | LinkedIn User Agreement (vigente desde 3/11/2025) | https://www.linkedin.com/legal/user-agreement |
| LI2 | LinkedIn Help — Prohibited software and extensions | https://www.linkedin.com/help/linkedin/answer/a1341387 |
| LI3 | LinkedIn — Invitations API (Microsoft Learn) | https://learn.microsoft.com/en-us/linkedin/shared/integrations/communications/invitations |
| LI4 | LinkedIn — Compliance FAQ [via resumo de busca] | https://learn.microsoft.com/en-us/linkedin/compliance/compliance-api/compliance-faq |
| LI5 | Microsoft Q&A — LinkedIn Messages API [fonte secundária] | https://learn.microsoft.com/en-us/answers/questions/635749/linkedin-messages-api |

### Agendamento e infraestrutura
| ID | Fonte | URL |
|---|---|---|
| C1 | Google Calendar API — Create events | https://developers.google.com/workspace/calendar/api/guides/create-events |
| C2 | Google Calendar API — Auth scopes | https://developers.google.com/workspace/calendar/api/auth |
| C3 | Calendly Developer — FAQ | https://developer.calendly.com/frequently-asked-questions |
| C4 | Calendly — MCP supported tools; Single-use links [via resumo de busca] | https://developer.calendly.com/docs/mcp/supported-tools · https://help.calendly.com/hc/en-us/articles/30121266128535-How-to-create-a-single-use-link |
| C5 | Cal.com Docs — Create a booking; OAuth [via resumo de busca] | https://cal.com/docs/api-reference/v2/bookings/create-a-booking · https://cal.com/docs/api-reference/v2/oauth |
| S1 | Supabase — Available regions; Data residency FAQ [via resumo de busca] | https://supabase.com/docs/guides/platform/regions · https://supabase.com/legal/privacy-resources/data-residency-and-transfers-faq |
