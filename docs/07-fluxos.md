# Fluxos de usuário, fluxos de agentes e UX

> Versão 0.1 · 2026-11-09

## 1. Princípios de experiência

1. **Copiloto no centro, estrutura ao lado.** Linguagem natural para pedir e explorar; telas estruturadas para comparar, editar, revisar e aprovar. Toda resposta do Copiloto leva a uma tela estruturada ("abrir no dossiê") e toda tela tem o Copiloto contextual (`⌘K` / painel lateral).
2. **Toda conclusão tem um "por quê".** Scores, recomendações, achados e frases de mensagens mostram os claims de suporte: tipo (Fato · Inferência · Hipótese), confiança, fonte e data, com acesso ao snapshot.
3. **Fila de decisões, não de dados.** A tela inicial organiza o trabalho do dia em decisões: aprovar, revisar, decidir abordar/descartar, responder.
4. **Progressivo e assíncrono.** Investigações rodam em segundo plano com progresso em tempo real; resultados parciais aparecem assim que existem.
5. **Custo visível.** Ações que gastam mostram estimativa antes e custo real depois.
6. **Editorial, minimalista, premium.** O produto é usado por uma agência de branding: a interface é parte do argumento.

## 2. Arquitetura de informação

```
Início (Hoje)
Copiloto (tela cheia + painel contextual em todas as telas)
Descoberta
  ├─ Nova busca (ICP / linguagem natural / importar lista)
  └─ Execuções → Candidatos (triagem)
Empresas
  └─ Empresa (dossiê)
       Resumo · Evidências · Marca · Concorrência · Sinais · Pessoas · Qualificação · Abordagem · Linha do tempo
Abordagens
  ├─ Planos
  └─ Revisão de mensagens
Aprovações
Conversas (inbox classificada)
Pipeline (oportunidades · reuniões · propostas)
Monitoramento (watchlist · mudanças)
Inteligência (funil · custos · aprendizados · calibração)
Configuração
  Ofertas · Rubricas · ICP · Voz da agência · Cases · Integrações · Equipe
  Conformidade (LIA · supressão · solicitações de titulares · retenção)
  Uso e orçamento · Agentes (modelos, versões de prompt, avaliações)
```

## 3. Fluxos de usuário

### 3.1 Onboarding e configuração estratégica
1. Criar organização → convidar equipe → definir papéis.
2. Cadastrar oferta "Branding e identidade visual": descrição, problemas, sinais, desqualificadores, entregáveis, faixa de investimento.
3. Revisar rubrica de auditoria visual sugerida (modelo padrão editável).
4. Definir ICP inicial: segmentos (CNAE), regiões, porte, exclusões. Opcional: importar clientes atuais (CSV) → sistema sugere ICP com justificativa.
5. Voz da agência (exemplos de mensagens boas e ruins) e cases autorizados.
6. Conformidade: registrar avaliação de legítimo interesse (modelo guiado), texto de opt-out, política de retenção.
7. Integrações: caixa de e-mail (OAuth), chaves de provedores de dados.
8. Orçamento mensal e limiares de aprovação.

**Aceite:** sem oferta ativa, rubrica e LIA aprovada, o sistema não permite gerar abordagens (mostra o que falta).

### 3.2 Descoberta
1. Usuário escolhe ICP ou escreve: "clínicas odontológicas em Curitiba com presença digital fraca".
2. Copiloto converte em filtros explícitos e mostra **plano + estimativa** (fontes, volume esperado, custo).
3. Execução: candidatos aparecem em tabela com origem, dados básicos, `fit_hint` e motivo; duplicatas já agrupadas.
4. Triagem: selecionar → "Investigar (L1)", "Descartar (motivo)", "Monitorar".
5. Lote de investigação mostra progresso por empresa.

### 3.3 Investigação → dossiê
O dossiê é a tela central do produto.

| Aba | Conteúdo |
|---|---|
| **Resumo** | recomendação com motivos, prioridade, lacunas, custo gasto, próximos passos |
| **Evidências** | todos os claims filtráveis por domínio/tipo/confiança/status; ações: confirmar, contestar, corrigir (feedback) |
| **Marca** | capturas lado a lado (desktop/mobile/logo/redes) com achados da rubrica sobrepostos às regiões |
| **Concorrência** | concorrentes com base da relação; comparativo de posicionamento e maturidade visual |
| **Sinais** | linha do tempo de sinais com força atual (decaimento visível) |
| **Pessoas** | decisores, papel, canais, base legal, verificação, supressão |
| **Qualificação** | 7 dimensões (barra + confiança), gates, "o que mudaria a decisão", histórico de avaliações |
| **Abordagem** | plano e mensagens |
| **Linha do tempo** | tudo que aconteceu, por humanos e agentes |

### 3.4 Qualificação e decisão
- Usuário concorda ou discorda da recomendação; discordância exige motivo codificado (vira feedback para calibração).
- `investigate_more` mostra o que falta e o custo para subir de nível.
- `insufficient_evidence` mostra explicitamente: "não há base para abordar esta empresa agora", com as lacunas.

### 3.5 Abordagem → revisão → aprovação → envio
1. "Preparar abordagem" (requer `pursue`/`prepare_access` resolvido).
2. Plano exibido: tese, argumentos (cada um com chips de claims), canal, sequência, riscos. Editar ou aprovar o plano.
3. Mensagens geradas com relatório do verificador: frases sublinhadas ligadas aos claims; bloqueios em vermelho, avisos em âmbar.
4. Edição inline; reverificação automática ao editar.
5. Aprovar → item na fila; envio respeita janela e limites; confirmação na linha do tempo.
6. LinkedIn/telefone: gera **tarefa assistida** (texto pronto para copiar, link do perfil quando houver), marcada como feita pelo usuário.

### 3.6 Conversas
Inbox com classificação (interesse, não agora, objeção, opt-out, fora do escritório). Opt-out: suprimido automaticamente, com banner informando. Respostas positivas → "Criar oportunidade" e rascunho de resposta.

### 3.7 Pipeline
Kanban configurável; cartão mostra origem (descoberta → plano → mensagem), valor, próximo passo. Reunião: briefing gerado do dossiê; pós-reunião: notas → resumo e próximos passos.

### 3.8 Monitoramento e aprendizado
Feed de mudanças significativas com "por que importa"; sinais podem reabrir empresas `monitor`. Inteligência mostra funil, custo por resultado, e propostas de calibração/aprendizado com amostra e backtest para aprovar ou rejeitar.

## 4. Fluxos de agentes (sequências)

### 4.1 Investigação L1

```mermaid
sequenceDiagram
  participant UI
  participant WF as Workflow Engine
  participant REG as Cadastro (API CNPJ)
  participant CAP as Captura (serviço de screenshot)
  participant LLM as Capacidades LLM
  participant INV as Agente Investigador
  participant LED as Evidence Ledger
  UI->>WF: investigation.requested (L1, orçamento)
  par
    WF->>REG: consulta CNPJ
    REG-->>LED: claims fato (firmográficos)
  and
    WF->>WF: resolver domínio/redes (DET + busca)
    WF->>CAP: capturar site desktop/mobile, logo
    CAP-->>LED: sources (screenshots, HTML)
  end
  WF->>LLM: site_extractor(texto)
  LLM-->>LED: claims fato (declarações do site, com trechos)
  par
    WF->>LLM: visual_auditor(capturas, rubrica)
    LLM-->>LED: achados + claims inferência
  and
    WF->>INV: lacunas + contexto (orçamento L1)
    loop até finish ou orçamento
      INV->>INV: web_search / web_fetch
      INV->>LED: record_claim (trecho verificado)
    end
    INV-->>WF: InvestigationReport
  end
  WF->>WF: evidence.validate
  WF->>LLM: need_assessor(claims, rubrica)
  WF->>LED: qualification_assessment
  WF-->>UI: assessment.created (Realtime)
```

### 4.2 Abordagem e envio

```mermaid
sequenceDiagram
  participant U as Usuário
  participant WF as Workflow Engine
  participant P as approach_planner
  participant W as message_writer
  participant V as message_verifier
  participant A as Aprovações
  participant M as Caixa (Gmail/Graph)
  U->>WF: approach.requested
  WF->>P: avaliação + claims + oferta + cases
  alt planner abstém
    P-->>U: "sem base para abordar" + motivo
  else plano
    P-->>WF: ApproachPlan
    WF->>W: plano + persona + canal + voz
    W-->>WF: DraftMessage
    WF->>V: mensagem + claims
    alt bloqueio
      V-->>WF: relatório
      WF->>W: reescrita guiada (1x)
      W-->>WF: nova versão
      WF->>V: reverificar
    end
    WF-->>U: revisão (needs_review)
    U->>A: aprovar (payload_hash)
    A-->>WF: approval.decided
    WF->>WF: checar supressão, limites, janela
    WF->>M: enviar (idempotency_key)
    M-->>WF: provider_message_id
    WF-->>U: enviado (linha do tempo)
  end
```

### 4.3 Resposta recebida
`inbox.sync` → regra DET de opt-out ∥ `reply_classifier` → (opt-out → supressão + cancelar pendentes) · (interesse → tarefa + rascunho) · (fora do escritório → reagendar) · (reclamação → escalar).

### 4.4 Copiloto (exemplo)
> "Quais empresas da lista de Curitiba valem uma abordagem esta semana e por quê?"

1. `search_companies` (lista + filtros) → 2. `get_assessments` → 3. resposta com ranking curto, motivos com links para claims, e ações sugeridas ("preparar abordagem para 3 empresas — custo estimado US$ X"). Nenhuma ação é executada sem o usuário pedir; ações externas viram itens de aprovação.

## 5. Linguagem visual (design system)

> Decisão do usuário em 2026-11-09: seguir duas referências de dashboard enviadas por ele (painéis brancos muito arredondados sobre cinza, navegação em pílula com item ativo preto e acento laranja; cartões de métrica com gradientes suaves, cartão grafite e números grandes em grotesca). Tokens em `packages/ui/src/styles/tokens.css`; componentes em `packages/ui`. Das referências entrou a estrutura e a linguagem visual; ficaram de fora saldos, transações, avatares e números de exemplo (regra de dados sem ficção).

| Elemento | Decisão |
|---|---|
| Superfícies | Quatro camadas: `canvas` (fundo) → `background` (moldura do app, raio 32 px) → `surface` (painel branco, raio 24 px, `Panel`) → `muted` (poço cinza, raio 18 px, `Well`) |
| Navegação | Marca em pílula; navegação principal em pílula com item ativo em tinta (`NavPill`); trilho de ícones à esquerda com tema (sol/lua/sistema), módulos de apoio e Configuração (`NavIcon`, nome acessível + dica) |
| Cor | Tinta (`primary`: preto no claro, quase branco no escuro) para a ação principal e o item ativo; laranja (`accent`) só como destaque, no máximo um cartão por grupo; semânticas `success`/`warning`/`danger` com versões `-soft` para fundos |
| Cartões de métrica | `StatTile` nos tons `plain`, `accent` (laranja), `dusk` (céu de fim de tarde), `sand` (areia) e `graphite`; número grande em peso regular com tracking negativo; sem dado real, mostra "—" e a fatia que o entrega |
| Tipografia | Uma grotesca (Geist, OFL) para tudo; títulos em peso 500 com tracking negativo; numerais tabulares em tabelas e números |
| Botões e chips | Tudo em pílula (`rounded-full`); botão primário em tinta, secundário em superfície com fio; estados com ponto colorido + texto (`StatusDot`, `Badge`) |
| Tabelas | Cabeçalho em poço cinza com pontas arredondadas, linhas com fio fino (`AuditTable`) |
| Contraste | WCAG 2.2 AA verificado com axe nos dois temas. O laranja de fundo é mais fechado que o das referências (#C2410C) para o texto branco passar de 4,5:1; o laranja de texto é outro tom (#B43C12 / #FB8A5C) |
| Densidade e movimento | Como antes: leitura com respiro, operação compacta; movimento mínimo e funcional |
| Componentes próprios a criar | `ClaimChip`, `EvidencePopover`, `ConfidenceMeter`, `DimensionBar`, `RecommendationBadge`, `VerifierHighlight`, `CostEstimate` (seguindo estes tokens); `DemoBadge` já existe |

### Padrão de explicabilidade (componente-chave)

```
[Inferência · Média 0,68]  Identidade visual inconsistente entre site e Instagram
  ↳ depende de: [Fato · Alta] Logotipo do site ≠ logotipo do perfil (captura 08/11/2026)
                 [Fato · Alta] Paleta do site: #1E3A5F/#F2C14E; Instagram: #8E2A6B/#FFFFFF
  Fontes: site.com.br (08/11) · instagram.com/… (captura autorizada, 08/11)
  [Confirmar] [Contestar] [Ver snapshot]
```

## 6. Responsividade

- Desktop: layouts de duas/três colunas (lista · detalhe · Copiloto).
- Tablet/mobile: navegação inferior com Início, Aprovações, Conversas, Copiloto; dossiê em abas empilhadas; aprovação de mensagem com evidências em painel expansível.
- Tabelas de triagem viram listas com ações por gesto/menus em telas estreitas.
