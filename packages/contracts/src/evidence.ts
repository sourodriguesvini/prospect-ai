import { z } from 'zod';
import { Uuid } from './common';

/**
 * Evidence Ledger (ADR-0002; docs/08 §2; docs/06 §4.4). Estes contratos fixam a FORMA: tipos,
 * faixas e formatos. As regras epistemológicas (fato exige evidência, inferência exige fatos,
 * cálculo de confiança, validade e `stale`) ficam em `@prospector/domain` (src/evidence), que
 * devolve erros codificados em `ClaimIssueCode`. Os campos são as colunas de docs/06 §4.4 em
 * camelCase. Sem `org_id` nem `reviewed_by`: uso local sem login (ADR-0007).
 */

// -----------------------------------------------------------------------------
// Primitivas
// -----------------------------------------------------------------------------

export const EpistemicType = z.enum(['fact', 'inference', 'hypothesis']);
export type EpistemicType = z.infer<typeof EpistemicType>;

/** `rejected` e `superseded` vêm de verificação, revisão ou nova versão; o cálculo só produz os 3 primeiros. */
export const ClaimStatus = z.enum(['active', 'stale', 'disputed', 'rejected', 'superseded']);
export type ClaimStatus = z.infer<typeof ClaimStatus>;

export const ClaimDomain = z.enum([
  'firmographic',
  'digital_presence',
  'visual',
  'positioning',
  'signal',
  'contact',
  'competitive',
  'financial_proxy',
]);
export type ClaimDomain = z.infer<typeof ClaimDomain>;

export const ClaimSubjectType = z.enum(['company', 'contact', 'competitor_link']);
export type ClaimSubjectType = z.infer<typeof ClaimSubjectType>;

export const EvidenceStance = z.enum(['supports', 'contradicts']);
export type EvidenceStance = z.infer<typeof EvidenceStance>;

/** Confiança de 0 a 1, sempre calculada no servidor (docs/08 §2.2), nunca informada pelo modelo. */
export const Confidence = z.number().min(0).max(1);

/** Teto da confiança de uma inferência (docs/08 §2.1). */
export const INFERENCE_MAX_CONFIDENCE = 0.9;

/** Faixa do fator de raciocínio proposto para uma inferência (docs/08 §2.2). */
export const REASONING_FACTOR_RANGE = { min: 0.5, max: 0.9 } as const;

/** Faixa de exibição. `unverified` = hipótese, que não tem confiança calculada. */
export const ConfidenceBand = z.enum(['high', 'medium', 'low', 'unverified']);
export type ConfidenceBand = z.infer<typeof ConfidenceBand>;

export const CONFIDENCE_BAND_LABELS: Record<ConfidenceBand, string> = {
  high: 'Alta',
  medium: 'Média',
  low: 'Baixa',
  unverified: 'A verificar',
};

/** Chave do catálogo de claims: segmentos em minúsculas separados por ponto (`brand.consistency.cross_channel`). */
export const ClaimKey = z
  .string()
  .max(120)
  .regex(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$/, { error: 'Chave de claim fora do formato.' });

const IsoDateTime = z.iso.datetime({ offset: true, error: 'Data e hora inválidas (ISO 8601).' });

// -----------------------------------------------------------------------------
// Fontes (`sources`)
// -----------------------------------------------------------------------------

export const SourceKind = z.enum([
  'web_page',
  'api_record',
  'screenshot',
  'document',
  'social_post',
  'user_note',
  'search_result',
]);
export type SourceKind = z.infer<typeof SourceKind>;

/**
 * Categoria de confiabilidade (docs/08 §2.2), atribuída pelo sistema, nunca pelo modelo. Fica na
 * evidência (`claim_evidence`), não na fonte: `company_owned` depende do sujeito do claim (o site
 * da empresa A é fonte de terceiro num claim sobre a empresa B). `user_reported` (anotação do
 * usuário) é proposta da F3a, sem valor no doc 08.
 */
export const SourceReliabilityTier = z.enum([
  'official_registry',
  'company_owned',
  'recognized_press',
  'aggregator',
  'user_reported',
  'unknown',
]);
export type SourceReliabilityTier = z.infer<typeof SourceReliabilityTier>;

/** Tipos que apontam para uma página ou publicação e por isso exigem URL. */
const URL_REQUIRED_KINDS: readonly SourceKind[] = [
  'web_page',
  'screenshot',
  'social_post',
  'search_result',
];

const sourceFields = {
  schemaVersion: z.literal(1),
  kind: SourceKind,
  url: z.httpUrl({ error: 'URL inválida (use http ou https).' }).max(2048).nullable().default(null),
  /** Quem forneceu o dado (ex.: provedor da base CNPJ, buscador). */
  provider: z.string().trim().min(1).max(80).nullable().default(null),
  /** Identificador na origem quando não há URL (ex.: CNPJ consultado, nome do arquivo). */
  externalRef: z.string().trim().min(1).max(200).nullable().default(null),
  /** Quando o sistema coletou o conteúdo; base da atualidade. Nunca vem do modelo. */
  capturedAt: IsoDateTime,
  /** SHA-256 em hexadecimal do conteúdo armazenado. */
  contentHash: z
    .string()
    .regex(/^[a-f0-9]{64}$/, { error: 'Hash SHA-256 inválido.' })
    .nullable()
    .default(null),
  storagePath: z.string().trim().min(1).max(500).nullable().default(null),
  mime: z.string().trim().min(1).max(120).nullable().default(null),
  httpStatus: z.number().int().min(100).max(599).nullable().default(null),
  title: z.string().trim().max(300).nullable().default(null),
  /** Texto normalizado da fonte, usado para conferir trechos citados. */
  excerptText: z.string().max(100_000).nullable().default(null),
  licenseNote: z.string().trim().max(500).nullable().default(null),
  retentionUntil: IsoDateTime.nullable().default(null),
  isDemo: z.boolean().default(false),
};

type SourceLocation = {
  kind: SourceKind;
  url: string | null;
  provider: string | null;
  externalRef: string | null;
};

/** Toda fonte se deixa localizar de novo: URL, identificador na origem ou, no mínimo, o provedor. */
function checkSourceLocation(source: SourceLocation, ctx: z.RefinementCtx) {
  if (URL_REQUIRED_KINDS.includes(source.kind) && source.url === null) {
    ctx.addIssue({ code: 'custom', path: ['url'], message: 'Este tipo de fonte exige URL.' });
  }
  if (source.kind === 'api_record' && source.provider === null) {
    ctx.addIssue({
      code: 'custom',
      path: ['provider'],
      message: 'Registro de API exige o provedor.',
    });
  }
  if (source.kind !== 'user_note' && source.url === null && source.externalRef === null) {
    ctx.addIssue({
      code: 'custom',
      path: ['externalRef'],
      message: 'Informe a URL ou o identificador da fonte.',
    });
  }
}

/** Fonte como chega para ser gravada (coleta do sistema, importação ou anotação do usuário). */
export const SourceInput = z.object(sourceFields).superRefine(checkSourceLocation);
export type SourceInput = z.infer<typeof SourceInput>;
export type SourceInputDraft = z.input<typeof SourceInput>;

/** Fonte gravada. */
export const Source = z
  .object({
    ...sourceFields,
    id: Uuid,
    createdAt: IsoDateTime,
  })
  .superRefine(checkSourceLocation);
export type Source = z.infer<typeof Source>;

// -----------------------------------------------------------------------------
// Evidência (`claim_evidence`) e dependências (`claim_dependencies`)
// -----------------------------------------------------------------------------

/** Onde, dentro da fonte, está o trecho. Pelo menos um campo quando informado. */
export const EvidenceLocator = z
  .object({
    selector: z.string().trim().min(1).max(500).optional(),
    /** x, y, largura, altura em pixels da captura. */
    bbox: z
      .tuple([
        z.number().nonnegative(),
        z.number().nonnegative(),
        z.number().positive(),
        z.number().positive(),
      ])
      .optional(),
    page: z.number().int().positive().optional(),
    /** Segundos desde o início (áudio ou vídeo). */
    timestamp: z.number().nonnegative().optional(),
  })
  .refine((locator) => Object.values(locator).some((value) => value !== undefined), {
    error: 'Localizador vazio.',
  });
export type EvidenceLocator = z.infer<typeof EvidenceLocator>;

const claimEvidenceFields = {
  sourceId: Uuid,
  /**
   * Trecho literal da fonte, conferido contra o conteúdo armazenado no servidor. Nulo só quando a
   * evidência é uma região (`locator`), como numa captura de tela (docs/08 §2.1: "trecho/região").
   */
  quote: z
    .string()
    .trim()
    .min(1, { error: 'Trecho vazio.' })
    .max(1200, { error: 'Trecho longo demais (máximo de 1.200 caracteres).' })
    .nullable()
    .default(null),
  locator: EvidenceLocator.nullable().default(null),
  stance: EvidenceStance.default('supports'),
};

function checkQuoteOrRegion(
  evidence: { quote: string | null; locator: EvidenceLocator | null },
  ctx: z.RefinementCtx,
) {
  if (evidence.quote === null && evidence.locator === null) {
    ctx.addIssue({
      code: 'custom',
      path: ['quote'],
      message: 'Informe o trecho ou a região da fonte.',
    });
  }
}

export const ClaimEvidenceInput = z.object(claimEvidenceFields).superRefine(checkQuoteOrRegion);
export type ClaimEvidenceInput = z.infer<typeof ClaimEvidenceInput>;

/** Evidência gravada. Uma por fonte em cada claim: chave (`claimId`, `sourceId`). */
export const ClaimEvidence = z
  .object({
    ...claimEvidenceFields,
    claimId: Uuid,
    /** Categoria da fonte para o sujeito deste claim, decidida pelo sistema. */
    reliabilityTier: SourceReliabilityTier,
    /** Conferência do trecho no conteúdo da fonte (docs/08 §2.4); nulo se não há trecho. */
    quoteVerified: z.boolean().nullable(),
  })
  .superRefine(checkQuoteOrRegion);
export type ClaimEvidence = z.infer<typeof ClaimEvidence>;

export const ClaimDependency = z
  .object({ claimId: Uuid, dependsOnClaimId: Uuid })
  .refine((dependency) => dependency.claimId !== dependency.dependsOnClaimId, {
    error: 'Um claim não pode depender de si mesmo.',
    path: ['dependsOnClaimId'],
  });
export type ClaimDependency = z.infer<typeof ClaimDependency>;

// -----------------------------------------------------------------------------
// Claims (`claims`)
// -----------------------------------------------------------------------------

export const CLAIM_EVIDENCE_LIMIT = 8;
export const CLAIM_DEPENDENCY_LIMIT = 20;

/**
 * O que um agente, uma importação ou o usuário pede para gravar. Sem confiança nem estado: o
 * servidor calcula. `reasoningFactor` é a única estimativa aceita do modelo, só para inferência,
 * e o domínio a limita a `REASONING_FACTOR_RANGE`.
 */
export const ClaimInput = z.object({
  schemaVersion: z.literal(1),
  subjectType: ClaimSubjectType,
  subjectId: Uuid,
  domain: ClaimDomain,
  key: ClaimKey,
  statement: z
    .string()
    .trim()
    .min(5, { error: 'Afirmação curta demais.' })
    .max(500, { error: 'Afirmação longa demais (máximo de 500 caracteres).' }),
  value: z.record(z.string(), z.unknown()).nullable().default(null),
  epistemicType: EpistemicType,
  evidence: z.array(ClaimEvidenceInput).max(CLAIM_EVIDENCE_LIMIT).default([]),
  dependsOn: z.array(Uuid).max(CLAIM_DEPENDENCY_LIMIT).default([]),
  reasoning: z.string().trim().max(800).nullable().default(null),
  reasoningFactor: Confidence.nullable().default(null),
  isDemo: z.boolean().default(false),
});
export type ClaimInput = z.infer<typeof ClaimInput>;
export type ClaimInputDraft = z.input<typeof ClaimInput>;

/** Claim gravado, com confiança e estado calculados pelo domínio. */
export const Claim = z
  .object({
    schemaVersion: z.literal(1),
    id: Uuid,
    subjectType: ClaimSubjectType,
    subjectId: Uuid,
    domain: ClaimDomain,
    key: ClaimKey,
    statement: z.string().min(1).max(500),
    value: z.record(z.string(), z.unknown()).nullable(),
    epistemicType: EpistemicType,
    /** Null só em hipótese (sem confiança calculada: "a verificar"). */
    confidence: Confidence.nullable(),
    status: ClaimStatus,
    /** Depois desta data o claim fica `stale` (docs/08 §2.3). */
    validUntil: IsoDateTime,
    reasoning: z.string().max(800).nullable(),
    /** Fator aplicado (já limitado), só em inferência; necessário para recalcular a confiança. */
    reasoningFactor: Confidence.nullable(),
    producedByRunId: Uuid.nullable(),
    promptVersionId: Uuid.nullable(),
    supersedesId: Uuid.nullable(),
    reviewedAt: IsoDateTime.nullable(),
    isDemo: z.boolean(),
    createdAt: IsoDateTime,
  })
  .superRefine((claim, ctx) => {
    const isHypothesis = claim.epistemicType === 'hypothesis';
    if (isHypothesis !== (claim.confidence === null)) {
      ctx.addIssue({
        code: 'custom',
        path: ['confidence'],
        message: 'Só hipótese fica sem confiança; fato e inferência sempre têm.',
      });
    }
    if (
      claim.epistemicType === 'inference' &&
      claim.confidence !== null &&
      claim.confidence > INFERENCE_MAX_CONFIDENCE
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['confidence'],
        message: 'Confiança de inferência acima de 0,9.',
      });
    }
    const factor = claim.reasoningFactor;
    if (claim.epistemicType === 'inference') {
      if (
        factor === null ||
        factor < REASONING_FACTOR_RANGE.min ||
        factor > REASONING_FACTOR_RANGE.max
      ) {
        ctx.addIssue({
          code: 'custom',
          path: ['reasoningFactor'],
          message: 'Inferência guarda o fator de raciocínio aplicado, entre 0,5 e 0,9.',
        });
      }
    } else if (factor !== null) {
      ctx.addIssue({
        code: 'custom',
        path: ['reasoningFactor'],
        message: 'Só inferência tem fator de raciocínio.',
      });
    }
  });
export type Claim = z.infer<typeof Claim>;

// -----------------------------------------------------------------------------
// Erros das regras do ledger (produzidos por @prospector/domain)
// -----------------------------------------------------------------------------

export const ClaimIssueCode = z.enum([
  'fact_requires_evidence',
  'fact_has_dependencies',
  'inference_requires_dependencies',
  'inference_requires_fact',
  'inference_requires_reasoning',
  'inference_has_evidence',
  'hypothesis_requires_reasoning',
  'reasoning_factor_only_for_inference',
  'evidence_source_not_found',
  'evidence_quote_missing',
  'evidence_region_missing',
  'evidence_duplicate_source',
  'evidence_captured_in_future',
  'evidence_quote_not_found',
  'dependency_not_found',
  'dependency_duplicate',
  'dependency_not_active',
  'dependency_is_hypothesis',
]);
export type ClaimIssueCode = z.infer<typeof ClaimIssueCode>;

export const CLAIM_ISSUE_MESSAGES: Record<ClaimIssueCode, string> = {
  fact_requires_evidence:
    'Fato precisa de pelo menos uma evidência que o sustente, com fonte, data e trecho.',
  fact_has_dependencies:
    'Fato é observação direta de uma fonte e não depende de outros claims. Use inferência.',
  inference_requires_dependencies: 'Inferência precisa indicar os claims de que depende.',
  inference_requires_fact: 'Inferência precisa depender de pelo menos um fato.',
  inference_requires_reasoning: 'Inferência precisa do raciocínio registrado.',
  inference_has_evidence:
    'Inferência não cita fontes diretamente: registre o trecho como fato e dependa dele.',
  hypothesis_requires_reasoning:
    'Hipótese precisa dizer o que a torna plausível e o que verificar.',
  reasoning_factor_only_for_inference: 'Só inferência recebe fator de raciocínio.',
  evidence_source_not_found: 'A fonte citada não existe no ledger.',
  evidence_quote_missing: 'A evidência precisa do trecho citado da fonte.',
  evidence_region_missing: 'Evidência de captura de tela precisa da região (bbox) na imagem.',
  evidence_duplicate_source:
    'A mesma fonte aparece duas vezes: use uma evidência por fonte, com o trecho mais forte.',
  evidence_captured_in_future: 'A data de coleta da fonte está no futuro.',
  evidence_quote_not_found: 'O trecho citado não aparece no conteúdo guardado da fonte.',
  dependency_not_found: 'O claim citado como dependência não existe.',
  dependency_duplicate: 'Dependência repetida.',
  dependency_not_active:
    'A dependência não está ativa (vencida, contestada, rejeitada ou substituída).',
  dependency_is_hypothesis: 'Inferência não pode se apoiar em hipótese.',
};

export const ClaimIssue = z.object({
  code: ClaimIssueCode,
  /** Caminho no `ClaimInput` (ex.: `evidence.0.sourceId`, `dependsOn.1`). */
  field: z.string(),
  message: z.string(),
});
export type ClaimIssue = z.infer<typeof ClaimIssue>;
