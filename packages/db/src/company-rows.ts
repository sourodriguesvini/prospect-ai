import type {
  CompanyPatch,
  EvidenceBatch,
  NewCompany,
  NewCompanyIdentifier,
} from '@prospector/application';
import {
  Claim,
  ClaimDependency,
  ClaimEvidence,
  Company,
  CompanyIdentifier,
  Source,
} from '@prospector/contracts';
import { z } from 'zod';

/**
 * Linhas do M2 (empresas e Evidence Ledger, migração 20261110170000) ↔ contratos. Toda leitura
 * passa pelo contrato: uma mudança de esquema falha alto em vez de chegar torta à UI.
 */

/** numeric/bigint chegam como número ou texto, conforme o tamanho. */
const Numeric = z.union([
  z.number(),
  z
    .string()
    .regex(/^-?\d+(\.\d+)?$/)
    .transform(Number),
]);

/** timestamptz do PostgREST (`+00:00`, até microssegundos) → ISO 8601 em UTC. */
const Timestamp = z.string().transform((value, ctx) => {
  const time = Date.parse(value);
  if (Number.isNaN(time)) {
    ctx.addIssue({ code: 'custom', message: 'Data inválida.' });
    return z.NEVER;
  }
  return new Date(time).toISOString();
});

// --- Empresas -------------------------------------------------------------------

export const COMPANY_SELECT =
  'id, display_name, legal_name, cnpj, cnpj_root, primary_domain, city, uf, cnae_main, size_band, lifecycle, origin, last_investigated_at, is_demo, created_at, updated_at';

const CompanyRow = z.object({
  id: z.string(),
  display_name: z.string(),
  legal_name: z.string().nullable(),
  cnpj: z.string().nullable(),
  cnpj_root: z.string().nullable(),
  primary_domain: z.string().nullable(),
  city: z.string().nullable(),
  uf: z.string().nullable(),
  cnae_main: z.string().nullable(),
  size_band: z.string().nullable(),
  lifecycle: z.string(),
  origin: z.string(),
  last_investigated_at: Timestamp.nullable(),
  is_demo: z.boolean(),
  created_at: Timestamp,
  updated_at: Timestamp,
});

export function mapCompany(raw: unknown): Company {
  const row = CompanyRow.parse(raw);
  return Company.parse({
    id: row.id,
    displayName: row.display_name,
    legalName: row.legal_name,
    cnpj: row.cnpj,
    cnpjRoot: row.cnpj_root,
    primaryDomain: row.primary_domain,
    city: row.city,
    uf: row.uf,
    cnaeMain: row.cnae_main,
    sizeBand: row.size_band,
    lifecycle: row.lifecycle,
    origin: row.origin,
    lastInvestigatedAt: row.last_investigated_at,
    isDemo: row.is_demo,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

export function companyColumns(company: NewCompany) {
  return {
    id: company.id,
    display_name: company.displayName,
    legal_name: company.legalName,
    cnpj: company.cnpj,
    primary_domain: company.primaryDomain,
    city: company.city,
    uf: company.uf,
    cnae_main: company.cnaeMain,
    size_band: company.sizeBand,
    origin: company.origin,
    last_investigated_at: company.lastInvestigatedAt,
    is_demo: company.isDemo,
  };
}

/** Só os campos presentes no patch; a RPC mantém os ausentes. */
export function companyPatchColumns(patch: CompanyPatch): Record<string, unknown> {
  const columns: Record<string, unknown> = {};
  if (patch.legalName !== undefined) columns.legal_name = patch.legalName;
  if (patch.city !== undefined) columns.city = patch.city;
  if (patch.uf !== undefined) columns.uf = patch.uf;
  if (patch.cnaeMain !== undefined) columns.cnae_main = patch.cnaeMain;
  if (patch.sizeBand !== undefined) columns.size_band = patch.sizeBand;
  if (patch.lastInvestigatedAt !== undefined) {
    columns.last_investigated_at = patch.lastInvestigatedAt;
  }
  return columns;
}

export const IDENTIFIER_SELECT =
  'id, company_id, kind, value_normalized, strength, verified, source_id, created_at';

const IdentifierRow = z.object({
  id: z.string(),
  company_id: z.string(),
  kind: z.string(),
  value_normalized: z.string(),
  strength: z.string(),
  verified: z.boolean(),
  source_id: z.string().nullable(),
  created_at: Timestamp,
});

export function mapIdentifier(raw: unknown): CompanyIdentifier {
  const row = IdentifierRow.parse(raw);
  return CompanyIdentifier.parse({
    id: row.id,
    companyId: row.company_id,
    kind: row.kind,
    valueNormalized: row.value_normalized,
    strength: row.strength,
    verified: row.verified,
    sourceId: row.source_id,
    createdAt: row.created_at,
  });
}

export function identifierColumns(identifier: NewCompanyIdentifier) {
  return {
    kind: identifier.kind,
    value_normalized: identifier.valueNormalized,
    strength: identifier.strength,
    verified: identifier.verified,
  };
}

// --- Fontes ---------------------------------------------------------------------

export const SOURCE_SELECT =
  'id, kind, url, provider, external_ref, captured_at, content_hash, storage_path, mime, http_status, title, excerpt_text, license_note, retention_until, is_demo, created_at';

const SourceRow = z.object({
  id: z.string(),
  kind: z.string(),
  url: z.string().nullable(),
  provider: z.string().nullable(),
  external_ref: z.string().nullable(),
  captured_at: Timestamp,
  content_hash: z.string().nullable(),
  storage_path: z.string().nullable(),
  mime: z.string().nullable(),
  http_status: z.number().int().nullable(),
  title: z.string().nullable(),
  excerpt_text: z.string().nullable(),
  license_note: z.string().nullable(),
  retention_until: Timestamp.nullable(),
  is_demo: z.boolean(),
  created_at: Timestamp,
});

export function mapSource(raw: unknown): Source {
  const row = SourceRow.parse(raw);
  return Source.parse({
    schemaVersion: 1,
    id: row.id,
    kind: row.kind,
    url: row.url,
    provider: row.provider,
    externalRef: row.external_ref,
    capturedAt: row.captured_at,
    contentHash: row.content_hash,
    storagePath: row.storage_path,
    mime: row.mime,
    httpStatus: row.http_status,
    title: row.title,
    excerptText: row.excerpt_text,
    licenseNote: row.license_note,
    retentionUntil: row.retention_until,
    isDemo: row.is_demo,
    createdAt: row.created_at,
  });
}

// --- Claims ---------------------------------------------------------------------

export const CLAIM_SELECT =
  'id, subject_type, subject_id, domain, key, statement, value, epistemic_type, confidence, status, valid_until, reasoning, reasoning_factor, produced_by_run_id, prompt_version_id, supersedes_id, reviewed_at, is_demo, created_at';

const ClaimRow = z.object({
  id: z.string(),
  subject_type: z.string(),
  subject_id: z.string(),
  domain: z.string(),
  key: z.string(),
  statement: z.string(),
  value: z.record(z.string(), z.unknown()).nullable(),
  epistemic_type: z.string(),
  confidence: Numeric.nullable(),
  status: z.string(),
  valid_until: Timestamp,
  reasoning: z.string().nullable(),
  reasoning_factor: Numeric.nullable(),
  produced_by_run_id: z.string().nullable(),
  prompt_version_id: z.string().nullable(),
  supersedes_id: z.string().nullable(),
  reviewed_at: Timestamp.nullable(),
  is_demo: z.boolean(),
  created_at: Timestamp,
});

export function mapClaim(raw: unknown): Claim {
  const row = ClaimRow.parse(raw);
  return Claim.parse({
    schemaVersion: 1,
    id: row.id,
    subjectType: row.subject_type,
    subjectId: row.subject_id,
    domain: row.domain,
    key: row.key,
    statement: row.statement,
    value: row.value,
    epistemicType: row.epistemic_type,
    confidence: row.confidence,
    status: row.status,
    validUntil: row.valid_until,
    reasoning: row.reasoning,
    reasoningFactor: row.reasoning_factor,
    producedByRunId: row.produced_by_run_id,
    promptVersionId: row.prompt_version_id,
    supersedesId: row.supersedes_id,
    reviewedAt: row.reviewed_at,
    isDemo: row.is_demo,
    createdAt: row.created_at,
  });
}

export const EVIDENCE_SELECT =
  'claim_id, source_id, quote, locator, stance, reliability_tier, quote_verified';

const EvidenceRow = z.object({
  claim_id: z.string(),
  source_id: z.string(),
  quote: z.string().nullable(),
  locator: z.record(z.string(), z.unknown()).nullable(),
  stance: z.string(),
  reliability_tier: z.string(),
  quote_verified: z.boolean().nullable(),
});

export function mapEvidence(raw: unknown): ClaimEvidence {
  const row = EvidenceRow.parse(raw);
  return ClaimEvidence.parse({
    claimId: row.claim_id,
    sourceId: row.source_id,
    quote: row.quote,
    locator: row.locator,
    stance: row.stance,
    reliabilityTier: row.reliability_tier,
    quoteVerified: row.quote_verified,
  });
}

export const DEPENDENCY_SELECT = 'claim_id, depends_on_claim_id';

export function mapDependency(raw: unknown): ClaimDependency {
  const row = z.object({ claim_id: z.string(), depends_on_claim_id: z.string() }).parse(raw);
  return ClaimDependency.parse({
    claimId: row.claim_id,
    dependsOnClaimId: row.depends_on_claim_id,
  });
}

/** Lote do ledger nas colunas que as RPCs `create_company` e `record_evidence` recebem. */
export function batchColumns(
  batch: Partial<EvidenceBatch> & Pick<EvidenceBatch, 'sources' | 'claims' | 'evidence'>,
) {
  return {
    p_sources: batch.sources.map((source) => ({
      id: source.id,
      kind: source.kind,
      url: source.url,
      provider: source.provider,
      external_ref: source.externalRef,
      captured_at: source.capturedAt,
      content_hash: source.contentHash,
      storage_path: source.storagePath,
      mime: source.mime,
      http_status: source.httpStatus,
      title: source.title,
      excerpt_text: source.excerptText,
      license_note: source.licenseNote,
      retention_until: source.retentionUntil,
      is_demo: source.isDemo,
    })),
    p_claims: batch.claims.map((claim) => ({
      id: claim.id,
      subject_type: claim.subjectType,
      subject_id: claim.subjectId,
      domain: claim.domain,
      key: claim.key,
      statement: claim.statement,
      value: claim.value,
      epistemic_type: claim.epistemicType,
      confidence: claim.confidence,
      status: claim.status,
      valid_until: claim.validUntil,
      reasoning: claim.reasoning,
      reasoning_factor: claim.reasoningFactor,
      produced_by_run_id: claim.producedByRunId,
      prompt_version_id: claim.promptVersionId,
      supersedes_id: claim.supersedesId,
      is_demo: claim.isDemo,
    })),
    p_evidence: batch.evidence.map((item) => ({
      claim_id: item.claimId,
      source_id: item.sourceId,
      quote: item.quote,
      locator: item.locator,
      stance: item.stance,
      reliability_tier: item.reliabilityTier,
      quote_verified: item.quoteVerified,
    })),
    ...(batch.dependencies === undefined
      ? {}
      : {
          p_dependencies: batch.dependencies.map((item) => ({
            claim_id: item.claimId,
            depends_on_claim_id: item.dependsOnClaimId,
          })),
        }),
    ...(batch.supersede === undefined ? {} : { p_supersede: batch.supersede }),
  };
}
