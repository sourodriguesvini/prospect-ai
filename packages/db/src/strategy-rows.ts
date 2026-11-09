import {
  ContactPolicyVersion,
  EntityStatus,
  IcpVersion,
  LiaVersion,
  OfferVersion,
  ProofAsset,
  RubricVersion,
  ScoringModelVersion,
  VoiceGuideVersion,
  type ContactPolicyContent,
  type IcpContent,
  type LiaContent,
  type OfferContent,
  type ProofAssetInput,
  type ScoringModelContent,
  type VoiceGuideContent,
} from '@prospector/contracts';
import { z } from 'zod';

/**
 * Linhas das tabelas da F2 (snake_case) ↔ tipos de contrato. Toda leitura passa pelo contrato:
 * uma mudança de esquema falha alto em vez de chegar torta à UI.
 */

// bigint: o PostgREST devolve número; aceita texto para não perder precisão no futuro.
const BigintCents = z
  .union([z.number().int(), z.string().regex(/^\d+$/).transform(Number)])
  .nullable();

export const HEADER_SELECT = 'id, status, is_demo, created_at, updated_at';

export const HeaderRow = z.object({
  id: z.string(),
  status: EntityStatus,
  is_demo: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
});
export const IcpHeaderRow = HeaderRow.extend({ offer_id: z.string() });

export const mapHeader = (row: z.infer<typeof HeaderRow>) => ({
  id: row.id,
  status: row.status,
  isDemo: row.is_demo,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

// --- Oferta ---------------------------------------------------------------------

export const OFFER_VERSION_SELECT =
  'id, offer_id, version, name, description, problems, need_signals, disqualifiers, deliverables, value_props, price_min_cents, price_max_cents, created_at';

const OfferVersionRow = z.object({
  id: z.string(),
  offer_id: z.string(),
  version: z.number().int(),
  name: z.string(),
  description: z.string(),
  problems: z.array(z.string()),
  need_signals: z.array(z.string()),
  disqualifiers: z.array(z.string()),
  deliverables: z.array(z.string()),
  value_props: z.array(z.string()),
  price_min_cents: BigintCents,
  price_max_cents: BigintCents,
  created_at: z.string(),
});

export function offerVersionColumns(content: OfferContent) {
  return {
    name: content.name,
    description: content.description,
    problems: content.problems,
    need_signals: content.needSignals,
    disqualifiers: content.disqualifiers,
    deliverables: content.deliverables,
    value_props: content.valueProps,
    price_min_cents: content.priceMinCents,
    price_max_cents: content.priceMaxCents,
  };
}

export function mapOfferVersion(raw: unknown): OfferVersion {
  const row = OfferVersionRow.parse(raw);
  return OfferVersion.parse({
    id: row.id,
    offerId: row.offer_id,
    version: row.version,
    createdAt: row.created_at,
    content: {
      name: row.name,
      description: row.description,
      problems: row.problems,
      needSignals: row.need_signals,
      disqualifiers: row.disqualifiers,
      deliverables: row.deliverables,
      valueProps: row.value_props,
      priceMinCents: row.price_min_cents,
      priceMaxCents: row.price_max_cents,
    },
  });
}

// --- Rubrica e modelo de score ------------------------------------------------------

export const RUBRIC_SELECT = 'id, offer_id, version, criteria, created_at';

const RubricRow = z.object({
  id: z.string(),
  offer_id: z.string(),
  version: z.number().int(),
  criteria: z.unknown(),
  created_at: z.string(),
});

export function mapRubric(raw: unknown): RubricVersion {
  const row = RubricRow.parse(raw);
  return RubricVersion.parse({
    id: row.id,
    offerId: row.offer_id,
    version: row.version,
    content: { criteria: row.criteria },
    createdAt: row.created_at,
  });
}

export const SCORING_SELECT =
  'id, offer_id, version, weight_fit, weight_need, weight_signal, weight_capacity, weight_timing, pursue_priority, prepare_access_potential, discard_potential, min_evidence_coverage, created_at';

const ScoringRow = z.object({
  id: z.string(),
  offer_id: z.string(),
  version: z.number().int(),
  weight_fit: z.number(),
  weight_need: z.number(),
  weight_signal: z.number(),
  weight_capacity: z.number(),
  weight_timing: z.number(),
  pursue_priority: z.number(),
  prepare_access_potential: z.number(),
  discard_potential: z.number(),
  min_evidence_coverage: z.number(),
  created_at: z.string(),
});

export function scoringColumns(content: ScoringModelContent) {
  return {
    weight_fit: content.weights.fit,
    weight_need: content.weights.need,
    weight_signal: content.weights.signal,
    weight_capacity: content.weights.capacity,
    weight_timing: content.weights.timing,
    pursue_priority: content.thresholds.pursuePriority,
    prepare_access_potential: content.thresholds.prepareAccessPotential,
    discard_potential: content.thresholds.discardPotential,
    min_evidence_coverage: content.thresholds.minEvidenceCoverage,
  };
}

export function mapScoring(raw: unknown): ScoringModelVersion {
  const row = ScoringRow.parse(raw);
  return ScoringModelVersion.parse({
    id: row.id,
    offerId: row.offer_id,
    version: row.version,
    createdAt: row.created_at,
    content: {
      weights: {
        fit: row.weight_fit,
        need: row.weight_need,
        signal: row.weight_signal,
        capacity: row.weight_capacity,
        timing: row.weight_timing,
      },
      thresholds: {
        pursuePriority: row.pursue_priority,
        prepareAccessPotential: row.prepare_access_potential,
        discardPotential: row.discard_potential,
        minEvidenceCoverage: row.min_evidence_coverage,
      },
    },
  });
}

// --- ICP ----------------------------------------------------------------------------

export const ICP_HEADER_SELECT = `${HEADER_SELECT}, offer_id`;
export const ICP_VERSION_SELECT =
  'id, icp_id, version, name, description, cnaes, ufs, municipalities, sizes, min_age_years, max_age_years, excluded_cnaes, excluded_municipalities, excluded_cnpj_roots, excluded_domains, created_at';

const IcpVersionRow = z.object({
  id: z.string(),
  icp_id: z.string(),
  version: z.number().int(),
  name: z.string(),
  description: z.string(),
  cnaes: z.array(z.string()),
  ufs: z.array(z.string()),
  municipalities: z.unknown(),
  sizes: z.array(z.string()),
  min_age_years: z.number().int().nullable(),
  max_age_years: z.number().int().nullable(),
  excluded_cnaes: z.array(z.string()),
  excluded_municipalities: z.unknown(),
  excluded_cnpj_roots: z.array(z.string()),
  excluded_domains: z.array(z.string()),
  created_at: z.string(),
});

export function icpVersionColumns(content: IcpContent) {
  return {
    name: content.name,
    description: content.description,
    cnaes: content.filters.cnaes,
    ufs: content.filters.ufs,
    municipalities: content.filters.municipalities,
    sizes: content.filters.sizes,
    min_age_years: content.filters.minAgeYears,
    max_age_years: content.filters.maxAgeYears,
    excluded_cnaes: content.exclusions.cnaes,
    excluded_municipalities: content.exclusions.municipalities,
    excluded_cnpj_roots: content.exclusions.cnpjRoots,
    excluded_domains: content.exclusions.domains,
  };
}

export function mapIcpVersion(raw: unknown): IcpVersion {
  const row = IcpVersionRow.parse(raw);
  return IcpVersion.parse({
    id: row.id,
    icpId: row.icp_id,
    version: row.version,
    createdAt: row.created_at,
    content: {
      name: row.name,
      description: row.description,
      filters: {
        cnaes: row.cnaes,
        ufs: row.ufs,
        municipalities: row.municipalities,
        sizes: row.sizes,
        minAgeYears: row.min_age_years,
        maxAgeYears: row.max_age_years,
      },
      exclusions: {
        cnaes: row.excluded_cnaes,
        municipalities: row.excluded_municipalities,
        cnpjRoots: row.excluded_cnpj_roots,
        domains: row.excluded_domains,
      },
    },
  });
}

// --- Voz e política de contato ---------------------------------------------------------

export const VOICE_SELECT =
  'id, version, summary, principles, avoid, good_examples, bad_examples, created_at';

const VoiceRow = z.object({
  id: z.string(),
  version: z.number().int(),
  summary: z.string(),
  principles: z.array(z.string()),
  avoid: z.array(z.string()),
  good_examples: z.array(z.string()),
  bad_examples: z.array(z.string()),
  created_at: z.string(),
});

export function voiceColumns(content: VoiceGuideContent) {
  return {
    summary: content.summary,
    principles: content.principles,
    avoid: content.avoid,
    good_examples: content.goodExamples,
    bad_examples: content.badExamples,
  };
}

export function mapVoice(raw: unknown): VoiceGuideVersion {
  const row = VoiceRow.parse(raw);
  return VoiceGuideVersion.parse({
    id: row.id,
    version: row.version,
    createdAt: row.created_at,
    content: {
      summary: row.summary,
      principles: row.principles,
      avoid: row.avoid,
      goodExamples: row.good_examples,
      badExamples: row.bad_examples,
    },
  });
}

export const CONTACT_POLICY_SELECT =
  'id, version, agency_name, privacy_contact, opt_out_text, created_at';

const ContactPolicyRow = z.object({
  id: z.string(),
  version: z.number().int(),
  agency_name: z.string(),
  privacy_contact: z.string(),
  opt_out_text: z.string(),
  created_at: z.string(),
});

export function contactPolicyColumns(content: ContactPolicyContent) {
  return {
    agency_name: content.agencyName,
    privacy_contact: content.privacyContact,
    opt_out_text: content.optOutText,
  };
}

export function mapContactPolicy(raw: unknown): ContactPolicyVersion {
  const row = ContactPolicyRow.parse(raw);
  return ContactPolicyVersion.parse({
    id: row.id,
    version: row.version,
    createdAt: row.created_at,
    content: {
      agencyName: row.agency_name,
      privacyContact: row.privacy_contact,
      optOutText: row.opt_out_text,
    },
  });
}

// --- Cases ------------------------------------------------------------------------------

export const PROOF_ASSET_SELECT =
  'id, offer_id, title, segment, summary, results, public_ok, consent_ref, is_demo, archived_at, created_at, updated_at';

const ProofAssetRow = z.object({
  id: z.string(),
  offer_id: z.string().nullable(),
  title: z.string(),
  segment: z.string(),
  summary: z.string(),
  results: z.string(),
  public_ok: z.boolean(),
  consent_ref: z.string(),
  is_demo: z.boolean(),
  archived_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

export function proofAssetColumns(input: ProofAssetInput) {
  return {
    offer_id: input.offerId,
    title: input.title,
    segment: input.segment,
    summary: input.summary,
    results: input.results,
    public_ok: input.publicOk,
    consent_ref: input.consentRef,
  };
}

export function mapProofAsset(raw: unknown): ProofAsset {
  const row = ProofAssetRow.parse(raw);
  return ProofAsset.parse({
    id: row.id,
    offerId: row.offer_id,
    title: row.title,
    segment: row.segment,
    summary: row.summary,
    results: row.results,
    publicOk: row.public_ok,
    consentRef: row.consent_ref,
    isDemo: row.is_demo,
    archivedAt: row.archived_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

// --- LIA --------------------------------------------------------------------------------

export const LIA_SELECT =
  'id, version, purpose, legitimate_interest, necessity, data_categories, data_sources, expectations, risks, safeguards, conclusion, approved_at, review_due_on, revoked_at, created_at';

const LiaRow = z.object({
  id: z.string(),
  version: z.number().int(),
  purpose: z.string(),
  legitimate_interest: z.string(),
  necessity: z.string(),
  data_categories: z.array(z.string()),
  data_sources: z.array(z.string()),
  expectations: z.string(),
  risks: z.string(),
  safeguards: z.string(),
  conclusion: z.string(),
  approved_at: z.string().nullable(),
  review_due_on: z.string().nullable(),
  revoked_at: z.string().nullable(),
  created_at: z.string(),
});

export function liaColumns(content: LiaContent) {
  return {
    purpose: content.purpose,
    legitimate_interest: content.legitimateInterest,
    necessity: content.necessity,
    data_categories: content.dataCategories,
    data_sources: content.dataSources,
    expectations: content.expectations,
    risks: content.risks,
    safeguards: content.safeguards,
    conclusion: content.conclusion,
  };
}

export function mapLia(raw: unknown): LiaVersion {
  const row = LiaRow.parse(raw);
  return LiaVersion.parse({
    id: row.id,
    version: row.version,
    createdAt: row.created_at,
    approvedAt: row.approved_at,
    reviewDueOn: row.review_due_on,
    revokedAt: row.revoked_at,
    content: {
      purpose: row.purpose,
      legitimateInterest: row.legitimate_interest,
      necessity: row.necessity,
      dataCategories: row.data_categories,
      dataSources: row.data_sources,
      expectations: row.expectations,
      risks: row.risks,
      safeguards: row.safeguards,
      conclusion: row.conclusion,
    },
  });
}
