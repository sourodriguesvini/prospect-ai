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
  RECOGNIZED_PRESS_HOSTS,
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
    /**
     * Origens próprias para ESTE claim, no lugar das do sujeito. Uso: fato sobre um concorrente,
     * gravado no dossiê da empresa investigada (o banco só aceita sujeito `company`, KI-143): o
     * site do concorrente é fonte própria do que ele diz de si mesmo, não do investigado.
     */
    ownedOrigins?: readonly string[];
  }>;
  /** Execução que produziu o lote (id da investigação); vai para `claims.produced_by_run_id`. */
  producedByRunId?: string | null;
}

/** Claim recusado no modo tolerante, com os motivos. */
export interface RejectedClaim {
  id: string;
  key: string | null;
  issues: FieldIssue[];
}

/** Lote preparado; `rejected` só tem itens no modo tolerante. */
export interface PreparedEvidence extends EvidenceBatch {
  rejected: RejectedClaim[];
}

export interface PrepareOptions {
  /**
   * Tolerante: claim que não passa nas regras fica fora do lote (com o motivo em `rejected`), e o
   * resto segue. Para conclusões de agentes, verificadas uma a uma. Erro de forma das fontes,
   * sujeito errado e ids repetidos continuam derrubando o lote inteiro.
   */
  lenient?: boolean;
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
  // Diretriz 2026-11-26, Parte 3.2: imprensa reconhecida vale como `recognized_press` só na
  // página lida; resultado de busca continua cópia indireta (no máximo agregador).
  pressHosts: RECOGNIZED_PRESS_HOSTS,
  aggregatorHosts: Object.freeze([] as string[]),
});

export interface RecordEvidenceOptions {
  /** Ação de auditoria (`company.evidence.record`, `company.registry.import`…). */
  action: string;
  patch?: CompanyPatch;
  /** Domínios e perfis da empresa (fontes deles contam como `company_owned`). */
  ownedOrigins?: readonly string[];
  /** Modo tolerante (`PrepareOptions.lenient`). */
  lenient?: boolean;
}

export interface EvidenceService {
  /**
   * Valida e calcula o lote para o sujeito, sem gravar: confiança, estado e validade vêm do
   * domínio; trechos conferidos contra o conteúdo das fontes. Erros em `claims.N.campo`.
   */
  prepare(
    subject: { companyId: string; ownedOrigins?: readonly string[] },
    draft: EvidenceDraft,
    options?: PrepareOptions,
  ): Promise<PreparedEvidence>;
  /**
   * Prepara e grava o lote, com a auditoria na mesma transação (ADR-0010). No modo tolerante,
   * se nenhum claim passar, nada é gravado (o lote volta com `claims` vazio e os recusados).
   */
  record(
    ctx: RequestContext,
    companyId: string,
    draft: EvidenceDraft,
    options: RecordEvidenceOptions,
  ): Promise<PreparedEvidence>;
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
    options: PrepareOptions = {},
  ): Promise<PreparedEvidence> {
    const now = clock.now();
    const issues: FieldIssue[] = [];
    const lenient = options.lenient === true;
    const rejected: RejectedClaim[] = [];
    const reject = (id: string, key: string | null, claimIssues: FieldIssue[]) => {
      if (lenient) rejected.push({ id, key, issues: claimIssues });
      else issues.push(...claimIssues);
    };

    // 1. Forma (Zod) das fontes e dos claims.
    const newSources: NewSource[] = [];
    (draft.sources ?? []).forEach(({ id, source }, index) => {
      const parsed = SourceInput.safeParse(source);
      if (!parsed.success) issues.push(...zodIssues(`sources.${index}`, parsed.error));
      else newSources.push({ ...parsed.data, id });
    });
    const inputs: Array<{
      id: string;
      index: number;
      input: ClaimInput;
      supersedes: string | null;
      ownedOrigins: readonly string[] | null;
    }> = [];
    if (draft.claims.length === 0) issues.push({ field: 'claims', message: 'Nada para gravar.' });
    draft.claims.forEach(({ id, claim, supersedes, ownedOrigins }, index) => {
      const parsed = ClaimInput.safeParse(claim);
      if (!parsed.success) {
        const key = typeof claim.key === 'string' ? claim.key : null;
        reject(id, key, zodIssues(`claims.${index}`, parsed.error));
        return;
      }
      if (parsed.data.subjectType !== 'company' || parsed.data.subjectId !== subject.companyId) {
        issues.push({ field: `claims.${index}.subjectId`, message: 'O claim é de outra empresa.' });
        return;
      }
      inputs.push({
        id,
        index,
        input: parsed.data,
        supersedes: supersedes ?? null,
        ownedOrigins: ownedOrigins ?? null,
      });
    });
    const ids = [...newSources.map((s) => s.id), ...draft.claims.map((c) => c.id)];
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
    const supersededInBatch = new Set<string>();
    inputs.forEach(({ id, index, input, supersedes, ownedOrigins }) => {
      const field = `claims.${index}`;
      const claimContext =
        ownedOrigins === null
          ? context
          : { ...context, classification: { ...classification, ownedOrigins } };
      const evaluation = evaluateClaim(input, claimContext);
      if (!evaluation.ok) {
        reject(id, input.key, prefixed(field, evaluation.issues));
        return;
      }
      const quotes = checkQuotes(input.evidence, contents);
      if (quotes.issues.length > 0) {
        reject(id, input.key, prefixed(field, quotes.issues));
        return;
      }
      if (supersedes !== null) {
        const previous = known.get(supersedes);
        if (!previous || previous.subjectId !== subject.companyId) {
          reject(id, input.key, [
            { field: `${field}.supersedes`, message: 'O claim a substituir não existe.' },
          ]);
          return;
        }
        if (previous.key !== input.key) {
          reject(id, input.key, [
            {
              field: `${field}.supersedes`,
              message: 'A nova versão precisa ter a mesma chave do claim substituído.',
            },
          ]);
          return;
        }
        if (lenient && supersededInBatch.has(supersedes)) {
          reject(id, input.key, [
            { field: `${field}.supersedes`, message: 'Outro claim do lote já substitui este.' },
          ]);
          return;
        }
        supersededInBatch.add(supersedes);
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
        producedByRunId: draft.producedByRunId ?? null,
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
    return { sources: newSources, claims, evidence, dependencies: links, supersede, rejected };
  }

  return {
    prepare,
    async record(ctx, companyId, draft, options) {
      const batch = await prepare({ companyId, ownedOrigins: options.ownedOrigins ?? [] }, draft, {
        lenient: options.lenient === true,
      });
      if (batch.claims.length === 0) return batch;
      const stored: EvidenceBatch = {
        sources: batch.sources,
        claims: batch.claims,
        evidence: batch.evidence,
        dependencies: batch.dependencies,
        supersede: batch.supersede,
      };
      await deps.evidence.record(
        companyId,
        options.patch ?? {},
        stored,
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
