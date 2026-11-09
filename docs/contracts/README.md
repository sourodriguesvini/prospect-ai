# Contratos principais

> Versão 0.1 · 2026-11-09
> Fonte da verdade na implementação: **schemas Zod em `packages/contracts`**. Este documento descreve os contratos em TypeScript/Zod de forma legível; a fatia F1 cria o pacote real e testes de schema.
> Regras gerais: todo contrato tem `schemaVersion`; IDs são UUID; datas ISO-8601 com fuso; valores monetários em centavos (BRL) ou micro-dólares (custo de IA); textos para o usuário em pt-BR.

## 1. Primitivas compartilhadas e Evidence Ledger

> **Implementado na F3a (2026-11-09)** em `packages/contracts/src/evidence.ts`, com testes em `packages/contracts/tests/evidence.test.ts`. Os contratos fixam só a forma; as regras epistemológicas e o cálculo de confiança ficam em `packages/domain/src/evidence` ([08 §2.5](../08-metodologia-comercial.md#25-regras-implementadas-e-valores-propostos-f3a-2026-11-09)). Os campos são as colunas de [06 §4.4](../06-modelo-de-dados.md#44-evidence-ledger-mvp) em camelCase.

| Contrato | Conteúdo |
|---|---|
| `EpistemicType`, `ClaimStatus`, `ClaimDomain`, `ClaimSubjectType`, `EvidenceStance`, `Confidence` | enums e faixa 0–1 |
| `ClaimKey` | `segmento(.segmento)*` em minúsculas, até 120 caracteres |
| `SourceKind`, `SourceReliabilityTier` | tipo da fonte; categoria de confiabilidade atribuída pelo sistema, por claim (fica na evidência) |
| `SourceInput` / `Source` | tipo, `url` ou `externalRef`, `provider`, `capturedAt`, hash, Storage, título, texto normalizado; página, captura, post e resultado de busca exigem URL; registro de API exige provedor. `Source` acrescenta `id` e `createdAt`. `capturedAt` nunca vem do modelo |
| `EvidenceLocator`, `ClaimEvidenceInput` / `ClaimEvidence` | `sourceId`, trecho literal (1–1.200) **ou** região no localizador (`selector`, `bbox`, `page`, `timestamp`), `stance`; a gravada acrescenta `claimId`, `reliabilityTier` (categoria da fonte para o sujeito do claim) e `quoteVerified` (nulo sem trecho). As regras do domínio exigem `bbox` em captura de tela e trecho nos demais tipos |
| `ClaimDependency` | `claimId` → `dependsOnClaimId` (nunca o próprio) |
| `ClaimInput` | sujeito (`subjectType`, `subjectId`), `domain`, `key`, `statement`, `value`, `epistemicType`, até 8 evidências, até 20 dependências, `reasoning`, `reasoningFactor` (só inferência) |
| `Claim` | gravado: `confidence` (nula só em hipótese; inferência ≤ 0,9), `status`, `validUntil`, `reasoningFactor` aplicado, procedência (`producedByRunId`, `promptVersionId`, `supersedesId`), `reviewedAt`, `isDemo` |
| `ConfidenceBand`, `CONFIDENCE_BAND_LABELS` | `high` Alta · `medium` Média · `low` Baixa · `unverified` A verificar |
| `ClaimIssueCode`, `CLAIM_ISSUE_MESSAGES`, `ClaimIssue` | erros das regras do ledger, com mensagem em pt-BR |

Mudanças em relação ao esboço anterior desta seção: a evidência cita `sourceId` (a fonte é gravada antes pelo sistema), não uma URL solta; não existe `confidenceHint` (a única estimativa aceita do modelo é o `reasoningFactor` da inferência); o sujeito é plano (`subjectType`, `subjectId`), como no banco; as regras "fato exige evidência" e "inferência exige dependências" saíram do `superRefine` e viraram regras de domínio com código. `ClaimRef` nasce com o primeiro consumidor (F7).

## 2. Eventos de domínio (workflow engine)

Nome `dominio.entidade.verbo`, payload mínimo (IDs), sempre com `orgId` e `idempotencyKey`.

| Evento | Payload | Emitido por | Consumido por |
|---|---|---|---|
| `discovery.run.requested` | `{orgId, runId}` | UI/Copiloto | `discovery.run` |
| `company.created` | `{orgId, companyId, source}` | D3 | enriquecimento L0 |
| `investigation.requested` | `{orgId, companyId, depth, requestedBy, budgetUsd}` | UI/Copiloto/regra | `investigate` |
| `investigation.completed` | `{orgId, companyId, investigationId, costUsd}` | `investigate` | qualificação, UI |
| `assessment.created` | `{orgId, companyId, assessmentId, recommendation}` | D9 | UI, monitoramento, planejamento |
| `approach.requested` | `{orgId, companyId, assessmentId, contactId}` | UI/Copiloto | `approach.prepare` |
| `approval.decided` | `{orgId, approvalId, status}` | UI | `outbound.send` (waitForEvent) |
| `message.sent` / `message.failed` | `{orgId, messageId}` | `outbound.send` | timeline, cadência |
| `reply.received` | `{orgId, conversationMessageId}` | `inbox.sync` | `reply_classifier` |
| `suppression.added` | `{orgId, kind, valueHash, reason}` | D12/D13/DSR | cancela envios pendentes |
| `signal.detected` | `{orgId, companyId, signalId}` | D7 | requalificação |

## 3. Contratos das capacidades de IA (saídas)

### 3.1 `candidate_triage`
```ts
export const TriageOutput = z.object({
  schemaVersion: z.literal(1),
  items: z.array(z.object({
    candidateId: z.string().uuid(),
    fitHint: z.enum(["high", "medium", "low"]),
    reason: z.string().max(240),
    redFlags: z.array(z.string()).max(3),
  })),
});
```

### 3.2 `site_extractor`
```ts
export const SiteExtraction = z.object({
  schemaVersion: z.literal(1),
  businessDescription: z.object({ text: z.string(), quote: z.string() }).nullable(),
  audiences: z.array(z.object({ label: z.string(), quote: z.string() })).max(5),
  valueProposition: z.object({ text: z.string(), quote: z.string() }).nullable(),
  offerings: z.array(z.object({ name: z.string(), quote: z.string() })).max(15),
  locations: z.array(z.object({ text: z.string(), quote: z.string() })).max(20),
  socialLinks: z.array(z.object({ network: z.string(), url: z.string().url() })),
  teamMentions: z.array(z.object({ name: z.string(), role: z.string().nullable(), quote: z.string() })).max(20),
  lastUpdatedHints: z.array(z.object({ text: z.string(), quote: z.string() })).max(5), // ex.: "© 2017"
});
```
Cada item com `quote` vira claim `fact` sobre "o que o site declara".

### 3.3 `visual_auditor`
```ts
export const VisualAuditOutput = z.object({
  schemaVersion: z.literal(1),
  rubricVersion: z.number().int(),
  coverage: z.enum(["full", "partial"]),
  missingInputs: z.array(z.string()),
  findings: z.array(z.object({
    criterionKey: z.string(),
    score: z.number().int().min(1).max(5),
    severity: z.enum(["info", "minor", "major", "critical"]),
    finding: z.string().max(400),               // observação concreta
    implication: z.string().max(300),           // inferência para o negócio
    assetIds: z.array(z.string().uuid()).min(1),// evidência visual obrigatória
    region: z.string().max(120).optional(),     // "cabeçalho do site", "grade do Instagram"
    confidence: Confidence.max(0.8),            // juízo estético nunca > 0,8
  })),
  overallMaturity: z.number().min(1).max(5),
  summary: z.string().max(600),
});
```

### 3.4 `investigator` — fechamento (`finish_investigation`)
```ts
export const InvestigationReport = z.object({
  schemaVersion: z.literal(1),
  claimsRecorded: z.array(z.string().uuid()),
  competitorsProposed: z.array(z.object({ name: z.string(), domain: z.string().nullable(), basis: z.string() })).max(5),
  contactsProposed: z.array(z.object({
    name: z.string(), roleTitle: z.string(), sourceUrl: z.string().url(), quote: z.string(),
  })).max(5),
  remainingGaps: z.array(z.string()),
  overallConfidence: z.enum(["low", "medium", "high"]),
  notes: z.string().max(800),
});
```

### 3.5 `need_assessor` / avaliação
```ts
export const Recommendation = z.enum([
  "pursue", "prepare_access", "investigate_more", "monitor", "discard", "insufficient_evidence",
]);

export const DimensionScore = z.object({
  dimension: z.enum(["fit", "need", "signal", "capacity", "timing", "access", "evidence"]),
  score: z.number().min(0).max(100),
  confidence: Confidence,
  rationale: z.string().max(400),
  claimIds: z.array(z.string().uuid()),
});

export const QualificationAssessment = z.object({
  schemaVersion: z.literal(1),
  dimensions: z.array(DimensionScore).length(7),
  potential: z.number().min(0).max(100),
  priority: z.number().min(0).max(100),
  evidenceCoverage: z.number().min(0).max(1),
  gatesTriggered: z.array(z.string()),
  recommendation: Recommendation,
  reasons: z.array(z.object({ text: z.string().max(240), claimIds: z.array(z.string().uuid()).min(1) })).min(1).max(5),
  whatWouldChange: z.array(z.string().max(200)).max(3),
});
```
O LLM produz apenas a dimensão `need` (+ textos de motivo); as demais são calculadas e o objeto final é montado pelo serviço.

### 3.6 `approach_planner`
```ts
export const ApproachPlan = z.object({
  schemaVersion: z.literal(1),
  whyThisCompany: z.object({ text: z.string().max(400), claimIds: z.array(z.string().uuid()).min(1) }),
  whyNow: z.object({ text: z.string().max(300), claimIds: z.array(z.string().uuid()) }).nullable(),
  targetContactId: z.string().uuid().nullable(),
  register: z.enum(["founder_direct", "marketing_technical", "executive_brief"]),
  angle: z.string().max(120),
  arguments: z.array(z.object({
    text: z.string().max(300),
    strength: z.enum(["strong", "moderate"]),
    claimIds: z.array(z.string().uuid()).min(1),
    framing: z.enum(["assertion", "observation", "question"]), // hipótese → question
  })).min(1).max(3),
  proofAssetIds: z.array(z.string().uuid()).max(2),
  likelyObjections: z.array(z.object({ objection: z.string(), response: z.string() })).max(3),
  channel: z.enum(["email", "linkedin_manual", "phone_manual"]),
  sequence: z.array(z.object({ step: z.number().int(), dayOffset: z.number().int(), intent: z.string() })).max(4),
  initialValueOffer: z.string().max(200),
  cta: z.string().max(160),
  risks: z.array(z.string()).max(4),
  abstain: z.object({ shouldAbstain: z.boolean(), reason: z.string().nullable() }), // o planejador pode se recusar
});
```

### 3.7 `message_writer` e `message_verifier`
```ts
export const DraftMessage = z.object({
  schemaVersion: z.literal(1),
  step: z.number().int(),
  subject: z.string().max(90).nullable(),
  body: z.string().max(2000),
  statements: z.array(z.object({                // cada afirmação sobre o prospect
    text: z.string(),
    claimIds: z.array(z.string().uuid()),
    framing: z.enum(["assertion", "observation", "question"]),
  })),
});

export const VerificationReport = z.object({
  schemaVersion: z.literal(1),
  passed: z.boolean(),
  checks: z.array(z.object({
    code: z.enum([
      "unsupported_claim", "low_confidence_claim", "hypothesis_as_fact", "stale_claim",
      "forbidden_pattern", "missing_opt_out", "missing_sender_identity", "length_out_of_range",
      "unauthorized_link", "personal_data", "tone_mismatch", "repetition",
    ]),
    severity: z.enum(["block", "warn"]),
    detail: z.string(),
    span: z.string().optional(),
  })),
});
```

### 3.8 `reply_classifier`
```ts
export const ReplyClassification = z.object({
  schemaVersion: z.literal(1),
  intent: z.enum(["interested", "not_now", "not_interested", "referral", "question", "out_of_office", "unsubscribe", "complaint", "other"]),
  optOutRequested: z.boolean(),
  objections: z.array(z.string()).max(3),         // códigos do catálogo
  sentiment: z.enum(["positive", "neutral", "negative"]),
  suggestedNextStep: z.string().max(200),
  escalateToHuman: z.boolean(),
  referral: z.object({ name: z.string().nullable(), email: z.string().nullable() }).nullable(),
});
```
`optOutRequested = true` dispara supressão imediata mesmo que outras saídas falhem (regra DET de palavras-chave roda em paralelo).

## 4. Ferramentas do investigador (cliente, `strict: true`)

| Ferramenta | Entrada | Saída | Efeito |
|---|---|---|---|
| `get_company_context` | `{}` | ficha + claims ativos resumidos + lacunas | leitura |
| `list_claims` | `{domain?, key?}` | claims | leitura |
| `record_claim` | `ClaimInput` sem `subject` (implícito) | `{claimId, status, confidence, rejectedReason?}` | grava no ledger após validação de trechos |
| `propose_competitor` | `{name, domain?, basis, evidence[]}` | `{competitorLinkId}` | grava proposta (status `proposed`) |
| `propose_contact` | `{name, roleTitle, sourceUrl, quote}` | `{contactId}` ou rejeição | só fontes da própria empresa ou registro oficial |
| `request_asset_capture` | `{url, kinds[]}` | `{captureJobId}` | enfileira captura (DET) |
| `finish_investigation` | `InvestigationReport` | `{ok}` | encerra o loop |

## 5. Ferramentas do Copiloto (amostra)

| Ferramenta | Permissão mínima | Efeito |
|---|---|---|
| `search_companies({query, filters})` | viewer | leitura |
| `get_dossier({companyId})` | viewer | leitura |
| `explain_assessment({companyId})` | viewer | leitura |
| `start_discovery({icpProfileId, query})` | operator | workflow (estimativa de custo antes) |
| `start_investigation({companyId, depth})` | operator | workflow; acima do limiar → aprovação |
| `draft_approach({companyId, contactId})` | operator | workflow; gera rascunhos |
| `propose_send({messageId})` | operator | cria aprovação (não envia) |
| `create_task({…})` | operator | interno |
| `get_metrics({metric, period, segment?})` | viewer | leitura |
| `update_icp_draft({…})` | admin | rascunho; ativação exige aprovação |

## 6. API HTTP (borda)

- Leituras e mutações da UI: **Server Actions / Route Handlers** do Next.js chamando serviços de aplicação; validação Zod na borda.
- Webhooks de entrada (`/api/webhooks/<provider>`): verificação de assinatura, idempotência por ID do evento, resposta rápida e processamento assíncrono.
- Endpoint do workflow engine (`/api/workflows`) conforme a ferramenta escolhida ([ADR-0004](../adr/0004-orquestracao-duravel.md)).
- Streaming do Copiloto via Route Handler com `ReadableStream`.
