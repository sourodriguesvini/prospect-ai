import {
  ClaimInput,
  SourceInput,
  type Claim,
  type ClaimDependency,
  type ClaimEvidence,
  type ClaimInputDraft,
  type SourceInputDraft,
} from '@prospector/contracts';
import {
  DEFAULT_EVIDENCE_POLICY,
  checkQuotes,
  evaluateClaim,
  type AssessedDependency,
  type AssessedSource,
  type EvidencePolicy,
  type SourceClassificationContext,
} from '@prospector/domain';
import { systemClock, type Clock } from '../clock';
import type { RequestContext } from '../context';
import { AppError, groupFieldErrors, type FieldIssue } from '../errors';
import type {
  CompanyPatch,
  EvidenceBatch,
  EvidenceRepository,
  NewClaim,
  NewSource,
} from '../ports/company-repository';
import { pendingAudit } from './pending-audit';

/**
 * O que um agente, uma importação ou o usuário pede para gravar no ledger. Os ids das fontes e dos
 * claims novos vêm de quem monta o pedido, para que evidências e dependências do mesmo lote se
 * refiram a eles.
 */
export interface EvidenceDraft {
  sources?: Array<{ id: string; source: SourceInputDraft }>;
  claims: Array<{
    id: string;
    claim: ClaimInputDraft;
    /** Claim em vigor que este substitui (nova versão do mesmo fato). */
    supersedes?: string | null;
  }>;
}

/** Listas fixas da classificação de fontes; os domínios do sujeito chegam por pedido. */
export type EvidenceClassification = Omit<SourceClassificationContext, 'ownedOrigins'>;

/**
 * Provedores de registro oficial. Vazio até haver consulta direta à Receita: OpenCNPJ e Minha
 * Receita republicam a base aberta e, pela regra do doc 08 §2.2, contam como agregador (decisão
 * pendente do usuário: D-EVID-2, KI-080).
 */
export const DEFAULT_EVIDENCE_CLASSIFICATION: EvidenceClassification = Object.freeze({
  officialProviders: Object.freeze([] as string[]),
  pressHosts: Object.freeze([] as string[]),
  aggregatorHosts: Object.freeze([] as string[]),
});

export interface RecordEvidenceOptions {
  /** Ação de auditoria (`company.evidence.record`, `company.registry.import`…). */
  action: string;
  patch?: CompanyPatch;
  /** Domínios e perfis da empresa (fontes deles contam como `company_owned`). */
  ownedOrigins?: readonly string[];
}

export interface EvidenceService {
  /**
   * Valida e calcula o lote para o sujeito, sem gravar: confiança, estado e validade vêm do
   * domínio; trechos conferidos contra o conteúdo das fontes. Erros em `claims.N.campo`.
   */
  prepare(
    subject: { companyId: string; ownedOrigins?: readonly string[] },
    draft: EvidenceDraft,
  ): Promise<EvidenceBatch>;
  /** Prepara e grava o lote, com a auditoria na mesma transação (ADR-0010). */
  record(
    ctx: RequestContext,
    companyId: string,
    draft: EvidenceDraft,
    options: RecordEvidenceOptions,
  ): Promise<EvidenceBatch>;
}

function prefixed(prefix: string, issues: ReadonlyArray<{ field: string; message: string }>) {
  return issues.map((item) => ({
    field: item.field ? `${prefix}.${item.field}` : prefix,
    message: item.message,
  }));
}

function zodIssues(
  prefix: string,
  error: { issues: ReadonlyArray<{ path: PropertyKey[]; message: string }> },
) {
  return error.issues.map((issue) => ({
    field: [prefix, ...issue.path.map(String)].join('.'),
    message: issue.message,
  }));
}

export function createEvidenceService(deps: {
  evidence: EvidenceRepository;
  clock?: Clock;
  classification?: EvidenceClassification;
  policy?: EvidencePolicy;
}): EvidenceService {
  const clock = deps.clock ?? systemClock;
  const classification = deps.classification ?? DEFAULT_EVIDENCE_CLASSIFICATION;
  const policy = deps.policy ?? DEFAULT_EVIDENCE_POLICY;

  async function prepare(
    subject: { companyId: string; ownedOrigins?: readonly string[] },
    draft: EvidenceDraft,
  ): Promise<EvidenceBatch> {
    const now = clock.now();
    const issues: FieldIssue[] = [];

    // 1. Forma (Zod) das fontes e dos claims.
    const newSources: NewSource[] = [];
    (draft.sources ?? []).forEach(({ id, source }, index) => {
      const parsed = SourceInput.safeParse(source);
      if (!parsed.success) issues.push(...zodIssues(`sources.${index}`, parsed.error));
      else newSources.push({ ...parsed.data, id });
    });
    const inputs: Array<{ id: string; input: ClaimInput; supersedes: string | null }> = [];
    if (draft.claims.length === 0) issues.push({ field: 'claims', message: 'Nada para gravar.' });
    draft.claims.forEach(({ id, claim, supersedes }, index) => {
      const parsed = ClaimInput.safeParse(claim);
      if (!parsed.success) {
        issues.push(...zodIssues(`claims.${index}`, parsed.error));
        return;
      }
      if (parsed.data.subjectType !== 'company' || parsed.data.subjectId !== subject.companyId) {
        issues.push({ field: `claims.${index}.subjectId`, message: 'O claim é de outra empresa.' });
        return;
      }
      inputs.push({ id, input: parsed.data, supersedes: supersedes ?? null });
    });
    const ids = [...newSources.map((s) => s.id), ...inputs.map((c) => c.id)];
    if (new Set(ids).size !== ids.length) {
      throw new AppError('unexpected', 'unexpected');
    }
    if (issues.length > 0) {
      throw new AppError('validation', 'invalid_input', { fieldErrors: groupFieldErrors(issues) });
    }

    // 2. O que o lote cita e já está no ledger: fontes, dependências e claims a substituir.
    const batchSourceIds = new Set(newSources.map((s) => s.id));
    const batchClaimIds = new Set(inputs.map((c) => c.id));
    const citedSources = [
      ...new Set(inputs.flatMap((c) => c.input.evidence.map((e) => e.sourceId))),
    ].filter((id) => !batchSourceIds.has(id));
    const citedClaims = [
      ...new Set([
        ...inputs.flatMap((c) => c.input.dependsOn),
        ...inputs.flatMap((c) => (c.supersedes ? [c.supersedes] : [])),
      ]),
    ].filter((id) => !batchClaimIds.has(id));
    const [storedSources, storedClaims] = await Promise.all([
      citedSources.length ? deps.evidence.sourcesByIds(citedSources) : Promise.resolve([]),
      citedClaims.length ? deps.evidence.claimsByIds(citedClaims) : Promise.resolve([]),
    ]);

    const sources = new Map<string, AssessedSource>();
    const contents = new Map<string, string | null>();
    for (const source of [...storedSources, ...newSources]) {
      sources.set(source.id, source);
      contents.set(source.id, source.excerptText);
    }
    const known = new Map<string, Claim | NewClaim>(storedClaims.map((c) => [c.id, c]));
    const dependencies = new Map<string, AssessedDependency>(known);

    // 3. Regras do domínio, claim a claim (dependências do próprio lote valem na ordem).
    const claims: NewClaim[] = [];
    const evidence: ClaimEvidence[] = [];
    const links: ClaimDependency[] = [];
    const supersede: string[] = [];
    const context = {
      now,
      sources,
      claims: dependencies,
      classification: { ...classification, ownedOrigins: subject.ownedOrigins ?? [] },
      policy,
    };
    inputs.forEach(({ id, input, supersedes }, index) => {
      const field = `claims.${index}`;
      const evaluation = evaluateClaim(input, context);
      if (!evaluation.ok) {
        issues.push(...prefixed(field, evaluation.issues));
        return;
      }
      const quotes = checkQuotes(input.evidence, contents);
      if (quotes.issues.length > 0) {
        issues.push(...prefixed(field, quotes.issues));
        return;
      }
      if (supersedes !== null) {
        const previous = known.get(supersedes);
        if (!previous || previous.subjectId !== subject.companyId) {
          issues.push({
            field: `${field}.supersedes`,
            message: 'O claim a substituir não existe.',
          });
          return;
        }
        if (previous.key !== input.key) {
          issues.push({
            field: `${field}.supersedes`,
            message: 'A nova versão precisa ter a mesma chave do claim substituído.',
          });
          return;
        }
        supersede.push(supersedes);
      }
      const { assessment } = evaluation;
      const claim: NewClaim = {
        schemaVersion: 1,
        id,
        subjectType: input.subjectType,
        subjectId: input.subjectId,
        domain: input.domain,
        key: input.key,
        statement: input.statement,
        value: input.value,
        epistemicType: input.epistemicType,
        confidence: assessment.confidence,
        status: assessment.status,
        validUntil: assessment.validUntil,
        reasoning: input.reasoning,
        reasoningFactor:
          assessment.breakdown.type === 'inference' ? assessment.breakdown.reasoningFactor : null,
        producedByRunId: null,
        promptVersionId: null,
        supersedesId: supersedes,
        isDemo: input.isDemo,
      };
      claims.push(claim);
      dependencies.set(id, claim);
      input.evidence.forEach((item, position) => {
        evidence.push({
          claimId: id,
          sourceId: item.sourceId,
          quote: item.quote,
          locator: item.locator,
          stance: item.stance,
          reliabilityTier: evaluation.evidenceTiers[position] ?? 'unknown',
          quoteVerified: quotes.verified[position] ?? null,
        });
      });
      for (const dependsOn of input.dependsOn)
        links.push({ claimId: id, dependsOnClaimId: dependsOn });
    });
    if (new Set(supersede).size !== supersede.length) {
      issues.push({ field: 'claims', message: 'Dois claims substituem o mesmo claim.' });
    }
    if (issues.length > 0) {
      throw new AppError('validation', 'invalid_input', { fieldErrors: groupFieldErrors(issues) });
    }
    return { sources: newSources, claims, evidence, dependencies: links, supersede };
  }

  return {
    prepare,
    async record(ctx, companyId, draft, options) {
      const batch = await prepare({ companyId, ownedOrigins: options.ownedOrigins ?? [] }, draft);
      await deps.evidence.record(
        companyId,
        options.patch ?? {},
        batch,
        pendingAudit(ctx, {
          action: options.action,
          entityType: 'company',
          entityId: companyId,
          diff: {
            claims: batch.claims.length,
            sources: batch.sources.length,
            superseded: batch.supersede.length,
          },
        }),
      );
      return batch;
    },
  };
}
