import { AppError, type StrategyRepository } from '@prospector/application';
import type { IcpProfile, Offer } from '@prospector/contracts';
import type { SupabaseClient } from '@supabase/supabase-js';
import { toAppError } from './errors';
import {
  CONTACT_POLICY_SELECT,
  HEADER_SELECT,
  HeaderRow,
  ICP_HEADER_SELECT,
  ICP_VERSION_SELECT,
  IcpHeaderRow,
  LIA_SELECT,
  OFFER_VERSION_SELECT,
  PROOF_ASSET_SELECT,
  RUBRIC_SELECT,
  SCORING_SELECT,
  VOICE_SELECT,
  contactPolicyColumns,
  icpVersionColumns,
  liaColumns,
  mapContactPolicy,
  mapHeader,
  mapIcpVersion,
  mapLia,
  mapOfferVersion,
  mapProofAsset,
  mapRubric,
  mapScoring,
  mapVoice,
  offerVersionColumns,
  proofAssetColumns,
  scoringColumns,
  voiceColumns,
} from './strategy-rows';

/** Resposta do PostgREST: erro vira AppError; dado é devolvido sem tipo (validado no mapeamento). */
interface Result {
  data: unknown;
  error: { message?: string | null; code?: string | null } | null;
}

async function run(query: PromiseLike<Result>): Promise<unknown> {
  const { data, error } = await query;
  if (error) throw toAppError(error);
  return data;
}

async function rows(query: PromiseLike<Result>): Promise<unknown[]> {
  return ((await run(query)) as unknown[] | null) ?? [];
}

const notFound = () => new AppError('not_found', 'not_found');

/**
 * StrategyRepository via PostgREST (ADR-0009). O banco garante o que importa: versões somente
 * inclusão com número atribuído por trigger, criação atômica de cabeçalho + versão 1 (RPCs
 * `create_offer`/`create_icp_profile`) e decisão da LIA uma vez só. Aqui só há mapeamento.
 */
export function createSupabaseStrategyRepository(client: SupabaseClient): StrategyRepository {
  async function offerById(id: string): Promise<Offer | null> {
    const [header, current] = await Promise.all([
      run(client.from('offers').select(HEADER_SELECT).eq('id', id).maybeSingle()),
      run(
        client
          .from('current_offer_versions')
          .select(OFFER_VERSION_SELECT)
          .eq('offer_id', id)
          .maybeSingle(),
      ),
    ]);
    if (!header) return null;
    return {
      ...mapHeader(HeaderRow.parse(header)),
      current: current ? mapOfferVersion(current) : null,
    };
  }

  async function icpById(id: string): Promise<IcpProfile | null> {
    const [header, current] = await Promise.all([
      run(client.from('icp_profiles').select(ICP_HEADER_SELECT).eq('id', id).maybeSingle()),
      run(
        client
          .from('current_icp_profile_versions')
          .select(ICP_VERSION_SELECT)
          .eq('icp_id', id)
          .maybeSingle(),
      ),
    ]);
    if (!header) return null;
    const row = IcpHeaderRow.parse(header);
    return {
      ...mapHeader(row),
      offerId: row.offer_id,
      current: current ? mapIcpVersion(current) : null,
    };
  }

  async function setStatus(table: 'offers' | 'icp_profiles', id: string, status: string) {
    const updated = await rows(client.from(table).update({ status }).eq('id', id).select('id'));
    if (updated.length === 0) throw notFound();
  }

  async function liaById(id: string) {
    const row = await run(
      client.from('legal_basis_assessments').select(LIA_SELECT).eq('id', id).maybeSingle(),
    );
    return row ? mapLia(row) : null;
  }

  /** Atualização condicional da LIA: nenhuma linha → inexistente ou já decidida. */
  async function decideLia(id: string, patch: Record<string, string>, guard: 'approve' | 'revoke') {
    let query = client.from('legal_basis_assessments').update(patch).eq('id', id);
    query =
      guard === 'approve'
        ? query.is('approved_at', null)
        : query.is('revoked_at', null).not('approved_at', 'is', null);
    const updated = await rows(query.select(LIA_SELECT));
    const [row] = updated;
    if (row) return mapLia(row);
    if (await liaById(id)) throw new AppError('conflict', 'lia_decision_locked');
    throw notFound();
  }

  return {
    async loadSnapshot() {
      const [
        offers,
        offerVersions,
        rubrics,
        scoring,
        icps,
        icpVersions,
        voice,
        policy,
        lias,
        proofAssets,
      ] = await Promise.all([
        rows(client.from('offers').select(HEADER_SELECT).order('created_at')),
        rows(client.from('current_offer_versions').select(OFFER_VERSION_SELECT)),
        rows(client.from('current_audit_rubrics').select(RUBRIC_SELECT)),
        rows(client.from('current_scoring_models').select(SCORING_SELECT)),
        rows(client.from('icp_profiles').select(ICP_HEADER_SELECT).order('created_at')),
        rows(client.from('current_icp_profile_versions').select(ICP_VERSION_SELECT)),
        rows(
          client
            .from('voice_guides')
            .select(VOICE_SELECT)
            .order('version', { ascending: false })
            .limit(1),
        ),
        rows(
          client
            .from('contact_policies')
            .select(CONTACT_POLICY_SELECT)
            .order('version', { ascending: false })
            .limit(1),
        ),
        rows(
          client
            .from('legal_basis_assessments')
            .select(LIA_SELECT)
            .order('version', { ascending: false }),
        ),
        rows(client.from('proof_assets').select(PROOF_ASSET_SELECT).order('created_at')),
      ]);
      const currentOffer = new Map(offerVersions.map(mapOfferVersion).map((v) => [v.offerId, v]));
      const currentIcp = new Map(icpVersions.map(mapIcpVersion).map((v) => [v.icpId, v]));
      return {
        offers: offers.map((raw) => {
          const header = mapHeader(HeaderRow.parse(raw));
          return { ...header, current: currentOffer.get(header.id) ?? null };
        }),
        rubrics: rubrics.map(mapRubric),
        scoringModels: scoring.map(mapScoring),
        icps: icps.map((raw) => {
          const row = IcpHeaderRow.parse(raw);
          return {
            ...mapHeader(row),
            offerId: row.offer_id,
            current: currentIcp.get(row.id) ?? null,
          };
        }),
        voiceGuide: voice[0] ? mapVoice(voice[0]) : null,
        contactPolicy: policy[0] ? mapContactPolicy(policy[0]) : null,
        liaVersions: lias.map(mapLia),
        proofAssets: proofAssets.map(mapProofAsset),
      };
    },

    getOffer: offerById,

    async createOffer(content) {
      const id = await run(client.rpc('create_offer', { p_version: offerVersionColumns(content) }));
      const offer = typeof id === 'string' ? await offerById(id) : null;
      if (!offer) throw new AppError('unexpected', 'unexpected');
      return offer;
    },

    async addOfferVersion(offerId, content) {
      return mapOfferVersion(
        await run(
          client
            .from('offer_versions')
            .insert({ offer_id: offerId, ...offerVersionColumns(content) })
            .select(OFFER_VERSION_SELECT)
            .single(),
        ),
      );
    },

    async listOfferVersions(offerId) {
      const list = await rows(
        client
          .from('offer_versions')
          .select(OFFER_VERSION_SELECT)
          .eq('offer_id', offerId)
          .order('version', { ascending: false }),
      );
      return list.map(mapOfferVersion);
    },

    setOfferStatus: (offerId, status) => setStatus('offers', offerId, status),

    async listRubricVersions(offerId) {
      const list = await rows(
        client
          .from('audit_rubrics')
          .select(RUBRIC_SELECT)
          .eq('offer_id', offerId)
          .order('version', { ascending: false }),
      );
      return list.map(mapRubric);
    },

    async addRubricVersion(offerId, content) {
      return mapRubric(
        await run(
          client
            .from('audit_rubrics')
            .insert({ offer_id: offerId, criteria: content.criteria })
            .select(RUBRIC_SELECT)
            .single(),
        ),
      );
    },

    async listScoringModelVersions(offerId) {
      const list = await rows(
        client
          .from('scoring_models')
          .select(SCORING_SELECT)
          .eq('offer_id', offerId)
          .order('version', { ascending: false }),
      );
      return list.map(mapScoring);
    },

    async addScoringModelVersion(offerId, content) {
      return mapScoring(
        await run(
          client
            .from('scoring_models')
            .insert({ offer_id: offerId, ...scoringColumns(content) })
            .select(SCORING_SELECT)
            .single(),
        ),
      );
    },

    getIcp: icpById,

    async createIcp(offerId, content) {
      const id = await run(
        client.rpc('create_icp_profile', {
          p_offer_id: offerId,
          p_version: icpVersionColumns(content),
        }),
      );
      const icp = typeof id === 'string' ? await icpById(id) : null;
      if (!icp) throw new AppError('unexpected', 'unexpected');
      return icp;
    },

    async addIcpVersion(icpId, content) {
      return mapIcpVersion(
        await run(
          client
            .from('icp_profile_versions')
            .insert({ icp_id: icpId, ...icpVersionColumns(content) })
            .select(ICP_VERSION_SELECT)
            .single(),
        ),
      );
    },

    async listIcpVersions(icpId) {
      const list = await rows(
        client
          .from('icp_profile_versions')
          .select(ICP_VERSION_SELECT)
          .eq('icp_id', icpId)
          .order('version', { ascending: false }),
      );
      return list.map(mapIcpVersion);
    },

    setIcpStatus: (icpId, status) => setStatus('icp_profiles', icpId, status),

    async listVoiceGuideVersions() {
      const list = await rows(
        client.from('voice_guides').select(VOICE_SELECT).order('version', { ascending: false }),
      );
      return list.map(mapVoice);
    },

    async addVoiceGuideVersion(content) {
      return mapVoice(
        await run(
          client.from('voice_guides').insert(voiceColumns(content)).select(VOICE_SELECT).single(),
        ),
      );
    },

    async listContactPolicyVersions() {
      const list = await rows(
        client
          .from('contact_policies')
          .select(CONTACT_POLICY_SELECT)
          .order('version', { ascending: false }),
      );
      return list.map(mapContactPolicy);
    },

    async addContactPolicyVersion(content) {
      return mapContactPolicy(
        await run(
          client
            .from('contact_policies')
            .insert(contactPolicyColumns(content))
            .select(CONTACT_POLICY_SELECT)
            .single(),
        ),
      );
    },

    async getProofAsset(id) {
      const row = await run(
        client.from('proof_assets').select(PROOF_ASSET_SELECT).eq('id', id).maybeSingle(),
      );
      return row ? mapProofAsset(row) : null;
    },

    async createProofAsset(input) {
      return mapProofAsset(
        await run(
          client
            .from('proof_assets')
            .insert(proofAssetColumns(input))
            .select(PROOF_ASSET_SELECT)
            .single(),
        ),
      );
    },

    async updateProofAsset(id, input) {
      const [row] = await rows(
        client
          .from('proof_assets')
          .update(proofAssetColumns(input))
          .eq('id', id)
          .select(PROOF_ASSET_SELECT),
      );
      if (!row) throw notFound();
      return mapProofAsset(row);
    },

    async archiveProofAsset(id, archivedAt) {
      const updated = await rows(
        client.from('proof_assets').update({ archived_at: archivedAt }).eq('id', id).select('id'),
      );
      if (updated.length === 0) throw notFound();
    },

    async listLiaVersions() {
      const list = await rows(
        client
          .from('legal_basis_assessments')
          .select(LIA_SELECT)
          .order('version', { ascending: false }),
      );
      return list.map(mapLia);
    },

    async addLiaVersion(content) {
      return mapLia(
        await run(
          client
            .from('legal_basis_assessments')
            .insert(liaColumns(content))
            .select(LIA_SELECT)
            .single(),
        ),
      );
    },

    approveLia: (id, { approvedAt, reviewDueOn }) =>
      decideLia(id, { approved_at: approvedAt, review_due_on: reviewDueOn }, 'approve'),

    revokeLia: (id, revokedAt) => decideLia(id, { revoked_at: revokedAt }, 'revoke'),
  };
}
