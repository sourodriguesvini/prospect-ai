import { z } from 'zod';

/**
 * Saídas das análises de IA da investigação (ADR-0015). O modelo local responde em JSON
 * restrito a estes formatos (`format` do Ollama) e o servidor valida de novo aqui. Nada do que
 * o modelo escreve vira afirmação sem passar pelas regras do ledger: trechos conferidos no texto
 * guardado, inferências só com dependências, hipóteses com raciocínio, filtro de afirmações
 * proibidas e deduplicação (`@prospector/domain`, `investigation`).
 *
 * Referências curtas ligam o que o modelo diz ao que o sistema lhe mostrou: páginas `P1`…,
 * itens extraídos `O1`… (ofertas), `A1`… (público), `D1`… (diferenciais), `R1`… (regiões),
 * `S1`… (sinais), medições `M1`…, fatos e inferências do dossiê `K1`…, ofertas `OF1`… e
 * candidatos a concorrente `C1`…. Referência que não existe é descartada pelo servidor.
 *
 * Os textos são cortados (nunca recusados) no limite: um modelo pequeno às vezes passa um pouco.
 */

const cut = (max: number) =>
  z
    .string()
    .transform((value) => value.replace(/\s+/g, ' ').trim())
    .transform((value) => (value.length > max ? `${value.slice(0, max - 1).trimEnd()}…` : value));

const Ref = z.string().trim().max(12);
const Refs = (max: number) =>
  z
    .array(Ref)
    .transform((list) => [...new Set(list)].slice(0, max))
    .default([]);

/** Fator de raciocínio proposto pelo modelo; o domínio limita a [0,5; 0,9]. */
const Factor = z.number().min(0).max(1).catch(0.6);

// -----------------------------------------------------------------------------
// Negócio (texto das páginas do site)
// -----------------------------------------------------------------------------

/** Item extraído de uma página, com o trecho literal que o sustenta. */
export const ExtractedItem = z.object({
  label: cut(80),
  page: Ref,
  quote: cut(300),
});
export type ExtractedItem = z.infer<typeof ExtractedItem>;

export const ModelInference = z.object({
  statement: cut(300),
  reasoning: cut(600),
  factor: Factor,
  basedOn: Refs(8),
});
export type ModelInference = z.infer<typeof ModelInference>;

const items = (max: number) =>
  z
    .array(ExtractedItem)
    .transform((list) => list.slice(0, max))
    .default([]);

export const BusinessAnalysisOutput = z.object({
  offerings: items(8),
  audiences: items(3),
  differentiators: items(4),
  regions: items(3),
  /** Sinais de momento declarados no próprio site (nova unidade, vagas, lançamento…). */
  signals: items(3),
  /**
   * O ramo como o site se apresenta ("pet shop", "clínica odontológica"), com trecho literal.
   * Só a partir do `company-business/v2` (na v1 não vem). Serve para a pesquisa de concorrentes.
   */
  segment: ExtractedItem.nullable().optional().catch(undefined),
  valueProposition: ModelInference.nullable().default(null),
  toneOfVoice: ModelInference.nullable().default(null),
  businessModel: ModelInference.nullable().default(null),
});
export type BusinessAnalysisOutput = z.infer<typeof BusinessAnalysisOutput>;

// -----------------------------------------------------------------------------
// Auditoria visual (capturas + medições técnicas)
// -----------------------------------------------------------------------------

/**
 * `aesthetic`: preferência estética (não conta como necessidade); `functional`: problema que
 * atrapalha uso ou leitura; `strategic`: desalinhamento entre marca, promessa e público.
 */
export const FindingNature = z.enum(['functional', 'strategic', 'aesthetic']);
export type FindingNature = z.infer<typeof FindingNature>;

export const FINDING_NATURE_LABELS: Record<FindingNature, string> = {
  functional: 'problema funcional',
  strategic: 'desalinhamento estratégico',
  aesthetic: 'preferência estética',
};

export const VisualCriterionFinding = z.object({
  criterion: z.string().trim().max(40),
  /** 1 (muito fraco) a 5 (exemplar), escala da rubrica. */
  score: z.number().int().min(1).max(5).catch(3),
  observation: cut(300),
  nature: FindingNature.catch('aesthetic'),
  /** Capturas que mostram o que foi observado. */
  images: z
    .array(z.enum(['desktop', 'mobile']))
    .transform((list) => [...new Set(list)])
    .default([]),
  /** Medições técnicas que confirmam ou contradizem a observação. */
  metrics: Refs(6),
  factor: Factor,
});
export type VisualCriterionFinding = z.infer<typeof VisualCriterionFinding>;

export const VisualAuditOutput = z.object({
  criteria: z
    .array(VisualCriterionFinding)
    .transform((list) => list.slice(0, 15))
    .default([]),
  /** Território e atributos que a marca comunica visualmente. */
  positioning: ModelInference.nullable().default(null),
});
export type VisualAuditOutput = z.infer<typeof VisualAuditOutput>;

// -----------------------------------------------------------------------------
// Concorrência
// -----------------------------------------------------------------------------

export const CompetitorKind = z.enum(['direct', 'aspirational', 'different_size', 'unrelated']);
export type CompetitorKind = z.infer<typeof CompetitorKind>;

export const COMPETITOR_KIND_LABELS: Record<CompetitorKind, string> = {
  direct: 'Concorrente direto',
  aspirational: 'Referência (outro patamar)',
  different_size: 'Porte diferente',
  unrelated: 'Não é concorrente',
};

export const CompetitorTriageOutput = z.object({
  candidates: z
    .array(
      z.object({
        ref: Ref,
        kind: CompetitorKind.catch('unrelated'),
        reason: cut(200),
      }),
    )
    .transform((list) => list.slice(0, 10))
    .default([]),
});
export type CompetitorTriageOutput = z.infer<typeof CompetitorTriageOutput>;

export const CompetitiveFindingKind = z.enum([
  'saturated_territory',
  'unexplored_differentiator',
  'excessive_similarity',
  'differentiation_space',
  'promise_mismatch',
  'sector_convention',
]);
export type CompetitiveFindingKind = z.infer<typeof CompetitiveFindingKind>;

export const COMPETITIVE_FINDING_LABELS: Record<CompetitiveFindingKind, string> = {
  saturated_territory: 'Território saturado',
  unexplored_differentiator: 'Diferencial pouco explorado',
  excessive_similarity: 'Semelhança excessiva',
  differentiation_space: 'Espaço de diferenciação',
  promise_mismatch: 'Promessa desalinhada',
  sector_convention: 'Convenção do setor',
};

export const CompetitiveAnalysisOutput = z.object({
  findings: z
    .array(ModelInference.extend({ kind: CompetitiveFindingKind.catch('sector_convention') }))
    .transform((list) => list.slice(0, 5))
    .default([]),
});
export type CompetitiveAnalysisOutput = z.infer<typeof CompetitiveAnalysisOutput>;

// -----------------------------------------------------------------------------
// Diagnóstico e ofertas
// -----------------------------------------------------------------------------

export const OfferRelevance = z.enum(['strong', 'moderate', 'weak', 'none']);
export type OfferRelevance = z.infer<typeof OfferRelevance>;

export const DiagnosisOutput = z.object({
  summary: ModelInference.nullable().default(null),
  hypotheses: z
    .array(
      z.object({
        statement: cut(300),
        /** O que torna plausível e o que verificar. */
        reasoning: cut(600),
        basedOn: Refs(6),
      }),
    )
    .transform((list) => list.slice(0, 4))
    .default([]),
  offers: z
    .array(
      z.object({
        offer: Ref,
        relevance: OfferRelevance.catch('none'),
        statement: cut(300),
        reasoning: cut(600),
        factor: Factor,
        basedOn: Refs(8),
        openingAngle: cut(300).nullable().default(null),
        objections: z
          .array(cut(200))
          .transform((list) => list.slice(0, 3))
          .default([]),
        toVerify: z
          .array(cut(200))
          .transform((list) => list.slice(0, 3))
          .default([]),
        /** Posições (a partir de 1) dos problemas e sinais da oferta observados, e desqualificadores. */
        problemsMatched: z.array(z.number().int().min(1).max(20)).default([]),
        signalsMatched: z.array(z.number().int().min(1).max(20)).default([]),
        disqualifiersHit: z.array(z.number().int().min(1).max(20)).default([]),
        /**
         * Desqualificadores com o fato que os mostra (`diagnosis/v2`, KI-133): o servidor só aceita
         * quando o fato citado existe, é fato e fala do mesmo assunto. Na v1 não vem.
         */
        disqualifiers: z
          .array(
            z.object({
              position: z.number().int().min(1).max(20),
              basedOn: Refs(4),
              reasoning: cut(300),
            }),
          )
          .transform((list) => list.slice(0, 6))
          .optional()
          .catch(undefined),
      }),
    )
    .transform((list) => list.slice(0, 6))
    .default([]),
});
export type DiagnosisOutput = z.infer<typeof DiagnosisOutput>;

/** Agentes de análise da investigação: um prompt versionado cada (packages/agents/prompts). */
export const AnalysisAgent = z.enum([
  'company-business',
  'brand-visual',
  'competitor-triage',
  'competitive',
  'diagnosis',
]);
export type AnalysisAgent = z.infer<typeof AnalysisAgent>;

export const ANALYSIS_OUTPUT_SCHEMAS = {
  'company-business': BusinessAnalysisOutput,
  'brand-visual': VisualAuditOutput,
  'competitor-triage': CompetitorTriageOutput,
  competitive: CompetitiveAnalysisOutput,
  diagnosis: DiagnosisOutput,
} as const satisfies Record<AnalysisAgent, z.ZodType>;
