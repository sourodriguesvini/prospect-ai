# ADR-0016 — E-mail pela caixa da Found Studio, fila de aprovação em lote e Prospector via MCP

- Status: **Proposto** (decisões do usuário em 2026-11-25; implementados o modelo de e-mail e a
  fatia E3, com a migração da E3 aplicada no `prospector-dev` em 2026-11-25)
- Data: 2026-11-25
- Módulo: 03, Relacionamento (fatias F11 e F12 do doc 09)
- Substitui, quando aceito, o item "Envio pelo app, caixas de e-mail…" das consequências do
  ADR-0014.

## Contexto

O usuário pediu que o Prospector feche o ciclo sozinho: o monitor encontra empresas, a IA escreve
o e-mail no padrão visual da Found Studio (cabeçalho, corpo, assinatura e rodapé do modelo
enviado à Telemidia) e o app envia pela caixa dele. Pediu também conexões "via MCP" e recursos
que aumentem a chance de fechar clientes reais.

Regras que continuam valendo:

- Regra 2 do `CLAUDE.md`: nada sai sem `approval_id` cujo `payload_hash` bate com o conteúdo, e a
  supressão é checada no momento do envio.
- docs/12 §5: e-mail 1:1 pela caixa do usuário, volume baixo, SPF/DKIM/DMARC conferidos, limites
  bem abaixo dos tetos do provedor, opt-out em toda mensagem; ESPs transacionais e ferramentas de
  cold email são proibidos para prospecção.
- KI-005 / D-LGPD-1: o parecer sobre legítimo interesse continua em aberto; a LIA v2 foi aprovada
  pelo usuário. O envio real é decisão dele (2026-11-25), registrada aqui.

## Decisões do usuário (2026-11-25)

1. **Aprovação em lote, envio automático depois.** A IA prepara os e-mails; o usuário aprova a fila
   do dia num clique (ou edita/descarta). O app envia sozinho em horário comercial, com limite
   diário, conferindo supressão, resposta e validade antes de cada envio. Os follow-ups da
   sequência são aprovados junto com a primeira mensagem. Envio sem aprovação humana **não**
   existe.
2. **Caixa de prospecção: `fala@foundstudio.com.br` (Hostinger).** SMTP para enviar e IMAP para
   ler respostas. O Gmail fica fora do primeiro contato (as políticas do Gmail vedam e-mail
   comercial não solicitado); pode entrar depois para agenda. **Condicionada ao KI-171:** os termos
   da Hostinger só permitem mensagem comercial com opt-in; para a prospecção (E4) o usuário decide
   entre manter a Hostinger assumindo o risco, usar outro provedor de envio ou outra caixa. A E3
   (login e teste para a própria caixa) não depende disso.
3. **Conexão direta no app + Prospector como servidor MCP local.** As conexões MCP que existem hoje
   ligam caixas ao Claude, não ao app, que roda sozinho com o Ollama. O app terá conexão própria
   com a caixa; e um servidor MCP local exporá o Prospector ao Claude (consultar prospects, filas e
   dossiês; preparar rascunhos). O MCP **não** aprova nem envia.
4. **Portfólio por serviço.** Branding, rebranding e social media citam
   `https://branding.foundstudio.com.br/`; UI/UX, produto digital, sistemas, Design System e site
   citam `https://foundstudio.com.br/`.

## Decisão técnica

### 1. Modelo de e-mail (`email-layout/v1`) — implementado

`renderEmail` (domínio, puro) monta o HTML e o texto puro a partir do texto aprovado e da
identidade do remetente, no desenho do modelo: monograma com ponto de acento e nome em caixa-alta
no cabeçalho, etiqueta à direita ("Proposta de conversa · Empresa"), corpo em parágrafos, cartão
opcional de esboço (imagem com borda de acento), link de portfólio, despedida, assinatura com
faixa de imagem e painel (nome, função, redes, estúdio, cidade, site, WhatsApp, e-mail) e rodapé
pequeno com o opt-out. Tabelas com `role="presentation"`, estilos em linha, bloco para Outlook
(`mso`), pré-cabeçalho oculto e versão em texto puro equivalente.

- O texto aprovado continua sendo a fonte: o HTML é derivado dele de forma determinística. O
  rodapé de opt-out e o canal do titular saem do corpo (mesma regra de `withoutContactFooter`) e
  vão para o rodapé do layout, então a frase aprovada é a que aparece.
- Todo texto é escapado; só `https://` vira link; e-mails viram `mailto:`.
- `portfolioForService` aplica a decisão 4.

### 2. Destinatário com origem (fatia E2, migração)

O app hoje não guarda o endereço de quem recebe (KI-126). Passa a guardar **um endereço por
oportunidade**, com URL e data de onde foi lido (base legal e origem, regra 7):

- Prioridade para endereço funcional publicado no site da empresa (`contato@`, `comercial@`,
  `marketing@`), lido pela investigação (links `mailto:` e texto da página de contato).
- Domínios pessoais (gmail.com, hotmail.com…) bloqueados para primeiro contato (docs/12 §5.5).
- Conferência grátis de sintaxe e MX por DNS antes de enviar; sem verificador pago.
- O endereço entra no `payload_hash` de envio (docs/12 §2: conteúdo, destinatário e canal).

### 3. Conexão da caixa (fatia E3, migração) — implementado e migração aplicada

- Tabela `mailboxes` (endereço, servidores SMTP/IMAP, porta, usuário, limites) e senha no
  **Supabase Vault** (ADR-0006), lida só no servidor por função restrita. Quem digita a senha é o
  usuário, na tela de Configurações; ela nunca aparece em log, trace ou resposta.
- Botão "Testar conexão" (login SMTP/IMAP, sem enviar) e checagem de SPF, DKIM e DMARC de
  `foundstudio.com.br` antes de liberar a caixa.
- "Enviar teste para mim": manda o e-mail renderizado só para a própria caixa.
- Bibliotecas candidatas (conferir licença e manutenção antes de instalar): `nodemailer` (envio),
  `imapflow` (leitura) e `mailparser`.

**Como ficou (2026-11-25).** Tela Configuração › E-mail (`/configuracoes/email`) com quatro
partes: quem assina (`sender_identities`, versionada), caixa de envio (uma só, `mailboxes`, com os
servidores da Hostinger já preenchidos), senha (RPC `set_mailbox_password` no Vault; a leitura
`mailbox_password` só para `service_role`) e conferência (`mailbox_checks`), mais a prévia do
modelo com a identidade salva.

- `nodemailer` 10.5.0 e `imapflow` 2.11.0 (MIT), só em `packages/integrations`; `mailparser`
  fica para a E5. O host do servidor passa pela mesma proteção do leitor de páginas (ADR-0012):
  resolve só para IP público e a conexão vai ao IP conferido, com o certificado conferido pelo
  nome do host (TLS 1.2 ou mais). Sem log das bibliotecas; o EHLO anuncia o domínio da caixa.
- A conferência vale para a conexão em que foi feita (`connection` = endereço, servidores,
  usuário e data da senha): mudar qualquer um deles ou a senha desfaz a verificação, e a tela pede
  um teste novo. DNS (TXT) com o resolvedor do sistema, sem serviço pago.
- O remetente fica no domínio do usuário da caixa (um apelido da conta, como `contato@`, vale):
  o login prova o usuário, não o endereço digitado. Regra no contrato e no banco.
- A senha vale para o servidor e o usuário em que foi digitada: mudar o servidor de envio ou de
  entrada ou o usuário desliga a senha (o gatilho `app.mailbox_reset_verification` zera
  `secret_id`), e ela precisa ser digitada de novo; a senha nunca vai para um servidor novo. Mudar
  endereço ou porta só desfaz a verificação. Um teste compara as listas do serviço
  (`MAILBOX_CONNECTION_FIELDS`, `MAILBOX_CREDENTIAL_FIELDS`) com o gatilho.
- A verificação é gravada de forma condicional (`updated_at` lido antes): se a caixa mudar durante
  a conferência, o resultado não vale para ela. Uma conferência por vez, com 10 s entre elas
  (cliques seguidos com a senha errada podem bloquear a conta no provedor).
- O teste vai só para o endereço que o login prova (`authenticatedAddress`: o usuário, quando é um
  e-mail; senão o endereço da caixa), nunca para um endereço digitado; uma tentativa por minuto
  (conta a tentativa, mesmo se falhar), com o cabeçalho `X-Prospector: teste`, e fica na auditoria
  (`email.test_sent`, só com o `Message-ID`). Sem caixa, senha e login de envio aprovado, o botão
  fica bloqueado (`aria-disabled`, focável) com o motivo.
- A prévia avisa quando a política de contato ainda não tem frase de opt-out. Ela é servida por
  rota própria (`/configuracoes/email/previa`) com política só dela: imagens `https:` (a faixa e
  os ícones cadastrados), nenhum script nem formulário, enquadrável só pelo app
  (`frame-ancestors 'self'`), num `iframe` em `sandbox`. As outras telas seguem sem imagem de fora.
- As imagens da assinatura são conferidas ao salvar quem assina (2026-11-26): o servidor baixa uma
  vez cada endereço novo (faixa e ícones; os que já estavam na versão salva, no mesmo papel, não
  são baixados de novo), dois por vez, pelo cliente seguro do leitor de páginas (SSRF por salto,
  endereço fixado, só https e sem porta em todos os saltos, sites restritos recusados, até 2 MB,
  8 s) e só aceita PNG, JPG ou GIF pelos
  bytes, entregue como imagem, com resposta 200, faixa até 1 MB e com pelo menos 536 px de
  largura, ícone quadrado de pelo menos 20 px e até 200 KB. Página da web, SVG (o Gmail não mostra)
  e WebP (o Outlook não mostra) são recusados com o motivo no campo. Motivo: o primeiro teste real
  saiu sem faixa nem ícones, porque a faixa estava vazia e os ícones apontavam para páginas
  (Wikimedia e um banco de vetores). As regras ficam em `domain/relationship/email-image.ts`; o
  download em `integrations/email/image.ts`. Não consulta o robots.txt: é um único arquivo
  cadastrado pelo usuário, não rastreamento.
- Modo de demonstração `PROSPECTOR_EMAIL=fixture` (só com `PROSPECTOR_STORAGE=memory`): caixa,
  servidores e DNS simulados, marcados DEMO. Testes: unitários e de contrato nos quatro pacotes,
  RLS e Vault em PGlite (`pnpm test:db`) e e2e da tela (`e2e/email.spec.ts`).
- Migração `20261125120000_email_mailbox` aplicada no `prospector-dev` em 2026-11-25, com
  confirmação do usuário. Conferido no banco real: RLS nas três tabelas, sem políticas e sem
  privilégio para `anon`/`authenticated`; `service_role` sem `delete` e sem gravar `secret_id`
  nem `password_set_at`; as RPCs da senha executáveis só por `service_role`; a tela abre com o
  banco real. O login real na Hostinger depende da senha, que só o usuário digita.
- Termos da Hostinger: ver KI-171 antes da E4.

### 4. Fila em lote, sequência e envio agendado (fatia E4, migração; emenda da regra 2)

Antes da E4: decisão do usuário sobre o KI-171 (termos da Hostinger) e os pré-requisitos do
KI-172 (vindos das revisões da E3).

- **Fila de hoje** em Aprovações: cada cartão mostra destinatário, assunto, prévia do HTML e
  pendências (`messageIssues`). "Aprovar selecionadas" cria **uma aprovação por mensagem**, com
  hash próprio, inclusive para cada follow-up da sequência.
- **Emenda proposta à validade de 72 h:** a aprovação de um follow-up vale até 72 h depois da data
  agendada dele e cai sozinha se a empresa responder, for suprimida ou a oportunidade fechar. A
  primeira mensagem mantém 72 h. Exige mudar a restrição do banco (`validade ≤ 3 dias`).
- **Envio:** fila `scheduled_sends`, processada pelo próprio app (como os monitores: só com o app
  aberto), em dias úteis das 8 h às 18 h (America/Sao_Paulo), intervalo aleatório entre envios,
  limite diário por caixa (padrão 20; teto 50) e aquecimento nas duas primeiras semanas (5 a 10
  por dia).
- **Follow-ups só depois da E5.** Sem ler as respostas, o app mandaria o segundo e-mail a quem já
  respondeu. Até a E5 existir, a E4 envia só a primeira mensagem de cada sequência.
- **No momento do envio**, numa transação: aprovação válida e não usada, hash igual, supressão,
  resposta recebida, oportunidade aberta e limite do dia. A linha é marcada "enviando" antes do
  SMTP; se o app cair entre o envio e o registro, ela fica "incerta" e **não** é reenviada (antes
  perder um envio que duplicar). O `Message-ID` fica gravado para ligar as respostas.
- Cabeçalho `List-Unsubscribe` com `mailto:` (RFC 2369). O clique único (RFC 8058) exige endereço
  público, e o app só escuta em localhost: fora.
- **Disjuntores:** qualquer devolução permanente ou reclamação pausa a caixa; devoluções acima de
  3% em 7 dias pausam os envios até o usuário revisar.

### 5. Respostas (fatia E5)

Leitura por IMAP da caixa de entrada, só de mensagens que respondem a um `Message-ID` nosso.
A resposta vira interação recebida, passa pelo `detectStopRequest` (a frase do rodapé já ensina
que "não" sozinho é pedido para parar) e pela interpretação da IA; follow-ups pendentes são
cancelados. Texto guardado com o prazo de guarda já definido.

### 6. Rascunhos a partir dos monitores (fatia E6)

Depois de cada monitor, até N empresas por dia (padrão 5) com prioridade alta e base suficiente
são investigadas e ganham rascunho da sequência na fila. Respeita a GPU (uma inferência por vez)
e o orçamento da Tavily.

### 7. Prospector como servidor MCP local (fatia E7)

Servidor MCP por `stdio` que fala com o app em `127.0.0.1` com um token local. Ferramentas de
leitura (prospects do dia, dossiê, fila de aprovação, pipeline) e de rascunho (preparar
abordagem, anotar). Sem aprovar, sem enviar, sem apagar.

## Consequências

- Cada fatia com banco (E2, E3, E4) precisa de confirmação do usuário antes de aplicar a migração
  no `prospector-dev`.
- A emenda da validade (item 4) altera a regra 2 só no prazo; aprovação por mensagem, hash e
  supressão no envio continuam.
- A prospecção pela caixa da Hostinger depende da decisão do KI-171; a E4 tem os pré-requisitos do
  KI-172 (portfólio na oferta, hash com as versões de identidade, modelo e política, `Message-ID`
  antes do SMTP, conferência recente, revisão da LIA e dos docs 12).
- Envios reais só depois de: LIA v2 aprovada (feito), caixa testada, SPF/DKIM/DMARC conferidos e
  primeiro lote aprovado pelo usuário. Testes automatizados nunca enviam: usam um transporte falso.
- KI-006 (preservação do `List-Unsubscribe`) fica resolvido para SMTP direto quando a E4 for
  testada com envio para a própria caixa.
