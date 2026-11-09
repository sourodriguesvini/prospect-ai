import {
  CLAIM_ISSUE_MESSAGES,
  type ClaimInput,
  type ClaimIssue,
  type ClaimIssueCode,
  type SourceReliabilityTier,
} from '@prospector/contracts';
import {
  type AssessedDependency,
  type AssessedEvidence,
  type AssessedSource,
  type ClaimAssessment,
  assessFact,
  assessHypothesis,
  assessInference,
  effectiveStatus,
} from './confidence';
import type { EvidencePolicy } from './policy';
import { type SourceClassificationContext, classifySourceReliability } from './sources';

/**
 * Regras epistemológicas para gravar um claim (docs/08 §2.1 e §2.4; ADR-0002). Recebe o
 * `ClaimInput` já validado na forma (Zod) e o que o ledger sabe das fontes e claims citados.
 */
export interface ClaimRulesContext {
  /** Relógio injetado (domínio puro). */
  readonly now: Date;
  /**
   * Fontes citadas nas evidências, por id, lidas do ledger depois de gravadas: `capturedAt` é
   * sempre o do servidor, nunca o que o modelo informou.
   */
  readonly sources: ReadonlyMap<string, AssessedSource>;
  /** Claims citados em `dependsOn`, por id. */
  readonly claims: ReadonlyMap<string, AssessedDependency>;
  /** Listas para classificar as fontes, com os domínios e perfis do sujeito deste claim. */
  readonly classification: SourceClassificationContext;
  readonly policy?: EvidencePolicy;
}

function issue(code: ClaimIssueCode, field: string): ClaimIssue {
  return { code, field, message: CLAIM_ISSUE_MESSAGES[code] };
}

/** Busca o que a validação já garantiu que existe; falhar aqui é erro de programação. */
function lookup<T>(map: ReadonlyMap<string, T>, id: string): T {
  const value = map.get(id);
  if (value === undefined) throw new RangeError(`Referência não validada: ${id}.`);
  return value;
}

function isBlank(value: string | null): boolean {
  return value === null || value.trim() === '';
}

/**
 * Cada evidência aponta para uma fonte conhecida, coletada até `now`, citada uma vez só no claim.
 * Captura de tela precisa da região (`locator.bbox`); os demais tipos, do trecho literal.
 */
function evidenceIssues(input: ClaimInput, context: ClaimRulesContext): ClaimIssue[] {
  const issues: ClaimIssue[] = [];
  const seen = new Set<string>();
  input.evidence.forEach((evidence, index) => {
    const field = `evidence.${index}`;
    if (seen.has(evidence.sourceId)) {
      issues.push(issue('evidence_duplicate_source', `${field}.sourceId`));
      return;
    }
    seen.add(evidence.sourceId);
    const source = context.sources.get(evidence.sourceId);
    if (source === undefined) {
      issues.push(issue('evidence_source_not_found', `${field}.sourceId`));
      return;
    }
    if (Date.parse(source.capturedAt) > context.now.getTime()) {
      issues.push(issue('evidence_captured_in_future', `${field}.sourceId`));
    }
    if (source.kind === 'screenshot') {
      if (evidence.locator?.bbox === undefined) {
        issues.push(issue('evidence_region_missing', `${field}.locator`));
      }
    } else if (isBlank(evidence.quote)) {
      issues.push(issue('evidence_quote_missing', `${field}.quote`));
    }
  });
  return issues;
}

function dependencyIssues(input: ClaimInput, context: ClaimRulesContext): ClaimIssue[] {
  const issues: ClaimIssue[] = [];
  const seen = new Set<string>();
  input.dependsOn.forEach((id, index) => {
    const field = `dependsOn.${index}`;
    if (seen.has(id)) {
      issues.push(issue('dependency_duplicate', field));
      return;
    }
    seen.add(id);
    const dependency = context.claims.get(id);
    if (dependency === undefined) {
      issues.push(issue('dependency_not_found', field));
      return;
    }
    if (input.epistemicType === 'inference' && dependency.epistemicType === 'hypothesis') {
      issues.push(issue('dependency_is_hypothesis', field));
    }
    if (effectiveStatus(dependency, context.now) !== 'active') {
      issues.push(issue('dependency_not_active', field));
    }
  });
  return issues;
}

/** Lista de problemas (vazia = pode gravar). Cada um com código, campo e mensagem em pt-BR. */
export function validateClaimInput(input: ClaimInput, context: ClaimRulesContext): ClaimIssue[] {
  const issues: ClaimIssue[] = [];

  if (input.reasoningFactor !== null && input.epistemicType !== 'inference') {
    issues.push(issue('reasoning_factor_only_for_inference', 'reasoningFactor'));
  }

  switch (input.epistemicType) {
    case 'fact': {
      if (input.dependsOn.length > 0) issues.push(issue('fact_has_dependencies', 'dependsOn'));
      issues.push(...evidenceIssues(input, context));
      if (!input.evidence.some((evidence) => evidence.stance === 'supports')) {
        issues.push(issue('fact_requires_evidence', 'evidence'));
      }
      break;
    }
    case 'inference': {
      if (input.evidence.length > 0) issues.push(issue('inference_has_evidence', 'evidence'));
      if (input.dependsOn.length === 0) {
        issues.push(issue('inference_requires_dependencies', 'dependsOn'));
      } else {
        issues.push(...dependencyIssues(input, context));
        const hasFact = input.dependsOn.some(
          (id) => context.claims.get(id)?.epistemicType === 'fact',
        );
        if (!hasFact) issues.push(issue('inference_requires_fact', 'dependsOn'));
      }
      if (isBlank(input.reasoning)) issues.push(issue('inference_requires_reasoning', 'reasoning'));
      break;
    }
    case 'hypothesis': {
      issues.push(...evidenceIssues(input, context));
      issues.push(...dependencyIssues(input, context));
      if (isBlank(input.reasoning)) {
        issues.push(issue('hypothesis_requires_reasoning', 'reasoning'));
      }
      break;
    }
  }
  return issues;
}

export type ClaimEvaluation =
  | {
      readonly ok: true;
      readonly assessment: ClaimAssessment;
      /**
       * Categoria de cada evidência, na ordem de `input.evidence`, para gravar em
       * `claim_evidence.reliability_tier`.
       */
      readonly evidenceTiers: readonly SourceReliabilityTier[];
    }
  | { readonly ok: false; readonly issues: readonly ClaimIssue[] };

/**
 * Valida e calcula um claim novo: o que o `EvidenceService` grava. Classifica cada fonte para o
 * sujeito do claim. Hipótese nova conta a validade a partir de `now` (momento do registro) quando
 * não tem evidência de apoio. Claim cujas fontes já venceram é aceito e nasce `stale`.
 */
export function evaluateClaim(input: ClaimInput, context: ClaimRulesContext): ClaimEvaluation {
  const issues = validateClaimInput(input, context);
  if (issues.length > 0) return { ok: false, issues };

  const evidence: AssessedEvidence[] = input.evidence.map((item) => {
    const source = lookup(context.sources, item.sourceId);
    return {
      stance: item.stance,
      reliabilityTier: classifySourceReliability(source, context.classification),
      source,
    };
  });
  const evidenceTiers = evidence.map((item) => item.reliabilityTier);
  const dependencies = input.dependsOn.map((id) => lookup(context.claims, id));
  const { now, policy } = context;

  let assessment: ClaimAssessment;
  switch (input.epistemicType) {
    case 'fact':
      assessment = assessFact({ domain: input.domain, key: input.key, evidence, now, policy });
      break;
    case 'inference':
      assessment = assessInference({
        dependencies,
        reasoningFactor: input.reasoningFactor,
        now,
        policy,
      });
      break;
    case 'hypothesis':
      assessment = assessHypothesis({
        domain: input.domain,
        key: input.key,
        evidence,
        dependencies,
        createdAt: now.toISOString(),
        now,
        policy,
      });
      break;
  }
  return { ok: true, assessment, evidenceTiers };
}
