# Segurança e conformidade

> Versão 0.1 · 2026-11-09
> Base: [research/03](research/03-canais-contato-e-conformidade.md) (LGPD, canais), [research/04](research/04-infraestrutura-e-execucao.md) (infraestrutura e segredos), [ADR-0006](adr/0006-segredos-e-credenciais.md).
> **Isto não é parecer jurídico.** Os pontos que dependem de interpretação estão em §7 e são pré-requisito do marco M2 (decisão D-LGPD-1).

## 1. Papéis e escopo

| Cenário | Controlador | Operador | Observação |
|---|---|---|---|
| MVP de uso interno (D-PROD-1 a) | Agência | Agência (opera a própria plataforma) + suboperadores (§6) | Caso mais simples; todos os controles abaixo valem igualmente |
| SaaS multi-tenant (fase 3) | Cada tenant (agência cliente) | Plataforma | Exige contrato operador ↔ controlador (arts. 39 e 42) |

Funcionalidades que podem tornar a plataforma **controladora ou cocontroladora** e por isso ficam **proibidas sem validação jurídica**: base de contatos compartilhada entre tenants, supressão compartilhada entre tenants, aprendizado com resultados de vários tenants, uso de dados de tenant para treino de modelos.

## 2. Ameaças principais e controles

| Ameaça | Controle | Onde |
|---|---|---|
| Vazamento entre tenants | RLS em 100% das tabelas com `org_id`; teste de isolamento por tabela; teste de catálogo (toda tabela com `org_id` tem RLS); cache do Next.js com `orgId` na chave | [06 §2](06-modelo-de-dados.md), [03 §4](03-arquitetura-tecnica.md) |
| Uso indevido da secret key do Supabase (ignora RLS) | Só em tasks/servidor; repositórios exigem `orgId`; proibida em `NEXT_PUBLIC_*`; lint que bloqueia import no cliente | ADR-0006 |
| Envio não autorizado ou alterado após aprovação | `approval_id` + `payload_hash` (conteúdo, destinatário, canal); expiração em 72 h; supressão rechecada no envio; idempotência | [04 §5](04-arquitetura-de-agentes.md), F10/F11 |
| Prompt injection por sites, e-mails e documentos | Conteúdo externo marcado como dado não confiável; agentes de leitura sem ferramentas de ação externa; ferramentas com permissões mínimas por agente; aprovação humana para ações externas | [04 §9](04-arquitetura-de-agentes.md) |
| Roubo de tokens OAuth (caixas de e-mail) | Supabase Vault por tenant; escopo mínimo (`gmail.send`, `Mail.Send`); revogação e rotação; tokens nunca em logs, traces ou prompts | ADR-0006 |
| SSRF por URLs de fontes ou usuários | Bloqueio de IPs privados, `localhost`, metadados de nuvem e esquemas não HTTP(S); limite de redirecionamentos; captura de tela por serviço externo | [03 §5](03-arquitetura-tecnica.md) |
| PII em logs, traces e erros | Redator de PII e segredos antes de Langfuse/Sentry; payloads de tasks carregam IDs, não dados pessoais; retenção curta de traces com conteúdo (D-LGPD-3) | ADR-0005 |
| Conta de usuário comprometida | MFA obrigatório para owner/admin; sessões curtas para ações sensíveis; auditoria de login | D-AUTH-1 |
| Webhooks forjados (agendamento, provedores) | Verificação de assinatura; rate limit; idempotência por ID do evento | F11/F12 |
| Abuso de custo (LLM, provedores pagos) | Orçamentos por tenant com corte; confirmação acima de limiar; rate limit no Copiloto | F13, [10 §3](10-riscos-custos-decisoes.md) |
| Dependências comprometidas | Lockfile; atualização automatizada com revisão; SDKs fixados; varredura de segredos no CI | [11 §6](11-qualidade-e-testes.md) |

## 3. Controles de segurança da aplicação

1. **Identidade e acesso:** Supabase Auth (e-mail + Google, D-AUTH-1); papéis `owner > admin > operator > viewer` checados nas Server Actions **e** nas políticas RLS; MFA para owner/admin.
2. **Isolamento:** ver §2. Storage com prefixo `org_id/` e políticas espelhando o RLS; URLs assinadas de curta duração.
3. **Segredos:** ADR-0006 — segredos de plataforma em variáveis de ambiente da Vercel e do Trigger.dev; credenciais por tenant no Vault; nunca ler nem imprimir `.env.local`.
4. **Entrada e rede:** validação Zod em toda borda; CSP restritiva, HSTS, `frame-ancestors 'none'`; CSRF nativo das Server Actions; rate limit em rotas públicas e webhooks.
5. **Agentes:** catálogo de ferramentas por agente com papel mínimo; nenhum agente acessa banco ou SDK de terceiros diretamente; toda chamada ao Claude pelo LLM Gateway; dados pessoais nos prompts limitados ao necessário para a tarefa.
6. **Auditoria:** `audit_log` append-only (sem `update`/`delete` para ninguém) com ator, ação, entidade e diff; decisões de IA rastreáveis por `agent_runs` → `llm_calls` → `prompt_versions`.
7. **Backups e continuidade:** backups gerenciados do Supabase Pro; expurgos LGPD respeitados também na política de expiração dos backups [validar com o plano contratado].
8. **Incidentes (Res. CD/ANPD nº 15/2024):** runbook com triagem, contenção, avaliação de risco aos titulares, comunicação à ANPD e aos titulares em **3 dias úteis** quando aplicável (prazo em dobro para pequeno porte) e registro de **todos** os incidentes por no mínimo **5 anos**. Vazamento de tokens OAuth conta como dado de autenticação.

## 4. LGPD — obrigações e como o produto as cumpre

| Obrigação | Base | Controle no produto | Dados/serviço | Fatia |
|---|---|---|---|---|
| Base legal definida por finalidade | Art. 7º, IX; art. 10 | Legítimo interesse com **LIA versionado por finalidade** (finalidade, necessidade, balanceamento e salvaguardas); contato sem `lia_id` válido não é contatável | `legal_basis_assessments`, `contacts.legal_basis/lia_id` | F9 |
| Minimização | Art. 6º, III; art. 10, §1º | Lista fechada de campos pessoais: nome, cargo, e-mail corporativo, telefone corporativo (opcional), URL de perfil digitada pelo usuário. **Sem CPF**, sem dados sensíveis, sem faixa etária, sem dados de familiares. Validação no contrato Zod e teste de esquema | `contacts`, `contact_channels`, `ref_cnpj_partners` | F3/F9 |
| Uso de dados públicos para nova finalidade | Art. 7º, §§3º e 7º | QSA e sites institucionais tratados como fonte com proveniência; "público" não dispensa base legal; nada de scraping que viole termos | `sources`, `contacts.data_origin` | F3/F9 |
| Transparência na abordagem | Art. 10, §2º; guia da ANPD | Primeira mensagem identifica remetente e agência, explica **por que** a pessoa foi contatada e **de onde veio o contato**, e oferece opt-out — regra bloqueante do verificador | `message_verifier` | F10 |
| Oposição e opt-out imediato | Art. 18, §2º | Opt-out em toda mensagem; resposta de descadastro (regra determinística + `reply_classifier`) → supressão em segundos e cancelamento de pendentes; supressão rechecada no envio; vale para todos os canais e campanhas do tenant | `suppression_entries` (HMAC por tenant) | F10/F11 |
| Direitos do titular e prazos | Arts. 18 e 19 | Canal do titular (e-mail do encarregado/formulário); registro com prazo (`due_at`); acesso simplificado imediato e completo em até 15 dias (em dobro para pequeno porte); atendimento assistido no MVP | `data_subject_requests` | F9 |
| Eliminação com supressão preservada | Arts. 15 e 16 | Eliminação apaga dados pessoais do prospect e mantém só o hash na supressão (base legal da retenção do hash a validar, §7) | expurgo + `suppression_entries` | F9 |
| Propagação a quem recebeu os dados | Art. 18, §6º | Registro de suboperadores que receberam cada dado (ex.: verificador de e-mail) e pedido de eliminação quando aplicável | `provider_usage.ref`, §6 | F11 |
| Retenção e expurgo | Arts. 15 e 16 | Prazos padrão de [06 §6](06-modelo-de-dados.md) configuráveis por tenant; job de expurgo com relatório e registro em `audit_log` | job agendado | F9/F13 |
| Registro das operações | Art. 37 | Documento de registro (finalidades, dados, fontes, suboperadores) + trilha técnica (`audit_log`, `activities`) | docs + banco | antes de M2 |
| Decisões automatizadas | Art. 20 | No MVP **o score é da empresa**, não de pessoas (sem propensão de resposta por indivíduo); critérios explicáveis por dimensão com claims; aprovação humana real antes de qualquer contato | `qualification_assessments` | F7 |
| Segurança | Arts. 46–49 | §§2–3 | — | contínuo |
| Encarregado ou canal do titular | Art. 41; Res. 2/2022, art. 11 | Contato público na política de privacidade e em toda primeira mensagem | — | antes de M2 |
| Transferência internacional | Art. 33; Res. 19/2024 | Mapa de suboperadores (§6); cláusulas-padrão da ANPD **integrais e sem alteração** ou outro mecanismo válido; página pública de transparência sobre transferências (art. 17, §2º); preferir região `sa-east-1` (São Paulo) no Supabase | — | F1 (região) / antes de M2 |
| RIPD | Art. 38 | RIPD voluntário recomendado (IA em escala é candidata a "alto risco") | docs | antes de M2 |
| Dados para IA | Política do provedor; Limited Use do Google | Nenhum dado de prospect usado para treino; conteúdo lido de caixas Google sujeito ao Limited Use; verificar DPA e retenção da Anthropic e demais provedores de IA [não verificado] | — | F4 |

## 5. Regras de contato por canal

| Canal | Status | Condições |
|---|---|---|
| **E-mail 1:1 pela caixa do usuário** (Gmail API `gmail.send` ou Microsoft Graph `Mail.Send`) | MVP (F11) | Aprovação por mensagem; volume baixo; controles abaixo. `gmail.send` é escopo **sensível** (verificação do app se público; sem avaliação de segurança). App **interno** do Workspace da agência dispensa verificação. No Microsoft 365, app multi-tenant exige *publisher verification* |
| **Detecção de respostas** | MVP com restrição | Gmail: leitura é escopo **restrito** (avaliação de segurança anual por avaliador credenciado) → no MVP usar app **interno** no Workspace da agência ou marcação manual; avaliação de segurança antes de abrir o SaaS. Microsoft: `Mail.Read` delegado, sem avaliação equivalente encontrada |
| **LinkedIn** | MVP, só assistido | Rascunho aprovado + botão copiar + link do perfil digitado pelo usuário; envio **manual**; resultado registrado manualmente. Nenhuma automação, extensão ou extração |
| **Agendamento** | MVP (F12) | Link do Cal.com/Calendly do usuário na mensagem + webhook para registrar a reunião e pausar a sequência |
| **WhatsApp Cloud API** | Fase 2 | Só após **opt-in** documentado para a empresa específica (ex.: o prospect pede para continuar pelo WhatsApp); templates de marketing; WABA por tenant |
| **Telefone** | Fase 2, assistido | Tarefa manual; verificar leis estaduais de bloqueio se virar canal relevante |
| ESPs transacionais (Resend, Postmark, SendGrid, SES) | Só e-mails do sistema | As políticas de uso proíbem prospecção fria |
| Ferramentas de cold email, WhatsApp não oficial, automação de LinkedIn | **Proibidos** | Violam termos das plataformas e tiram o controle de aprovação e supressão |

**Controles de envio (F11)**

1. **Autenticação do domínio** antes de liberar a caixa: checagem de SPF, DKIM e DMARC do domínio remetente.
2. **Limites** por caixa, usuário e tenant, muito abaixo dos tetos dos provedores (Workspace: 2.000 mensagens/dia; Exchange: 10.000 destinatários/dia e 30/min). Ponto de partida sugerido, sem fonte: **≤ 50 primeiros contatos por dia por caixa**, com aquecimento gradual, intervalo aleatório e janela de horário comercial.
3. **Disjuntores de reputação:** pausa automática da caixa/campanha com bounce > 3%, qualquer reclamação de spam ou opt-out acima do limiar configurado.
4. **Opt-out:** texto claro e link em toda mensagem; cabeçalho `List-Unsubscribe` (RFC 8058) quando viável — se a Gmail API e o Graph preservam esse cabeçalho é [não verificado] e será testado na F11.
5. **Domínios pessoais** (gmail.com, hotmail.com etc.) bloqueados para primeiro contato frio, configurável pelo admin.
6. **Verificação de e-mail** só para contatos que serão abordados (minimização).

## 6. Suboperadores e transferência internacional

| Provedor | Dado pessoal enviado | Minimização | País/região | Status do mecanismo |
|---|---|---|---|---|
| Supabase | Todos os dados do produto | — | `sa-east-1` disponível (São Paulo) [via resumo de busca] | Escolher região na F1; DPA a verificar |
| Vercel | Dados em trânsito nas requisições | Sem armazenamento de PII fora do banco | EUA/regiões a verificar | DPA e cláusulas a verificar |
| Trigger.dev | Payloads de tasks | **Só IDs** nos payloads | A verificar | A verificar |
| Anthropic (Claude API) | Trechos de fontes, nomes e cargos quando necessários à tarefa | Prompts com o mínimo; sem dados de canal desnecessários | EUA | DPA, retenção e uso para treino a verificar [não verificado] |
| Langfuse / Sentry | Traces e erros | Redação de PII; retenção curta | A verificar | A verificar |
| Hunter / MillionVerifier | Nome + domínio / e-mail | Só para quem será abordado | EUA/UE a verificar | A verificar |
| Google (Gmail, Places) / Microsoft (Graph) | Mensagens enviadas pela caixa do usuário | — | EUA | Termos do provedor + cláusulas |
| Cal.com / Calendly | Dados de quem agenda | — | EUA | A verificar |
| ScreenshotOne, Firecrawl, Logo.dev, PageSpeed | URLs de empresas (em geral sem dado pessoal) | Não enviar URLs de perfis pessoais | EUA/UE | Baixo risco; confirmar |

A adequação Brasil–UE (anunciada em 2026, fonte secundária) **não cobre os EUA**. Para cada provedor dos EUA: cláusulas-padrão da ANPD no contrato ou aditivo, ou outro mecanismo do art. 33 — decisão D-LGPD-2.

## 7. Pontos que exigem validação jurídica (D-LGPD-1)

Resumo de [research/03 §5](research/03-canais-contato-e-conformidade.md):

1. **Legítimo interesse para prospecção fria B2B sem relação prévia** — o guia da ANPD só traz exemplos com relação prévia. É o principal ponto em aberto.
2. Reuso de dados públicos (QSA, sites, perfis profissionais) para prospecção (art. 7º, §§3º, 4º e 7º).
3. Empresas individuais (MEI/EI) e sócios: quando dados "da empresa" são dados pessoais.
4. Papéis plataforma × tenant e funcionalidades que mudariam esse enquadramento.
5. Supressão entre tenants: possibilidade e base legal.
6. Prazos de retenção e base legal para manter o hash de supressão após a eliminação.
7. Art. 20: se a aprovação humana afasta a decisão "unicamente automatizada" e qual explicação é devida.
8. Enquadramento como pequeno porte × alto risco (IA como "tecnologia emergente" + escala).
9. Necessidade e momento do RIPD.
10. Mecanismo de transferência para cada provedor dos EUA e redação da página do art. 17, §2º.
11. CDC (arts. 29 e 43): equiparação do decisor a consumidor.
12. Leis estaduais de bloqueio e CAPEM, se houver telefone, SMS ou WhatsApp.
13. Políticas do Gmail, do Google e do Exchange Online frente à prospecção 1:1 em baixo volume.
14. Responsabilidade por afirmações em mensagens geradas por IA e impacto do PL 2338/2023 quando votado.

## 8. Testes obrigatórios

Ver [11-qualidade-e-testes.md](11-qualidade-e-testes.md). Mínimo para segurança e conformidade:

- Isolamento entre organizações em toda tabela de tenant (leitura, escrita, Storage).
- Envio bloqueado sem aprovação, com aprovação expirada ou com `payload_hash` divergente.
- Supressão rechecada no envio (inserir supressão entre aprovação e envio → envio cancelado).
- Opt-out: recall ≥ 99% no conjunto de avaliação; supressão em segundos no teste de workflow.
- Esquema sem campos proibidos (CPF, data de nascimento, faixa etária) — teste de contrato.
- Redação de PII e segredos em logs e traces.
- SSRF: URLs para IPs privados e metadados bloqueadas.
- Webhooks com assinatura inválida rejeitados.

## 9. Checklist antes de qualquer contato real (marco M2)

- [ ] Parecer jurídico sobre §7, no mínimo itens 1, 2, 6 e 10.
- [ ] LIA da finalidade aprovado e versionado no sistema.
- [ ] Política de privacidade com seção de prospecção, canal do titular e página de transferência internacional.
- [ ] Encarregado ou canal do titular publicado.
- [ ] DPAs/cláusulas com os suboperadores que recebem dados pessoais.
- [ ] Domínio remetente com SPF, DKIM e DMARC.
- [ ] Limites e disjuntores configurados.
- [ ] Teste ponta a ponta de opt-out (resposta → supressão → cancelamento de pendentes).
- [ ] Runbook de incidente revisado.
