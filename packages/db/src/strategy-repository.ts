import { AppError, type PendingAudit, type StrategyRepository } from '@prospector/application';
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
 * Cabeçalho com o registro de auditoria da escrita. O trigger `app.audit_write` (migrações
 * 20261110120000 e 20261110130000) lê o cabeçalho no mesmo pedido e grava o `audit_log` na mesma
 * transação; pelo PostgREST, escrita sem ele é recusada (`audit_missing`), e registro malformado
 * ou de outra tabela também (`audit_invalid`). KI-041; regras no ADR-0010.
 */
export const AUDIT_HEADER = 'x-prospector-audit';

/** Limite do cabeçalho: o registro leva ids e números, nunca conteúdo (KI-015). */
export const AUDIT_HEADER_MAX_BYTES = 4096;

/**
 * Tabelas com o trigger de auditoria. `table` registra; numa RPC que grava várias, as outras vão
 * em `covers` (lista explícita): qualquer outra tabela gravada no mesmo pedido é recusada.
 */
export type AuditedTable =
  | 'offers'
  | 'offer_versions'
  | 'audit_rubrics'
  | 'scoring_models'
  | 'icp_profiles'
  | 'icp_profile_versions'
  | 'voice_guides'
  | 'contact_policies'
  | 'proof_assets'
  | 'legal_basis_assessments'
  | 'copilot_threads'
  | 'companies'
  | 'company_identifiers'
  | 'sources'
  | 'claims'
  | 'claim_evidence'
  | 'claim_dependencies';

/**
 * JSON em base64: cabeçalho HTTP só aceita ASCII. Sem conteúdo da estratégia (KI-015). `table` e
 * `covers` vêm por último, para o registro não conseguir trocá-los.
 */
export function encodeAuditHeader(
  table: AuditedTable,
  audit: PendingAudit,
  covers: readonly AuditedTable[] = [],
): string {
  const encoded = Buffer.from(JSON.stringify({ ...audit, table, covers }), 'utf8').toString(
    'base64',
  );
  if (encoded.length > AUDIT_HEADER_MAX_BYTES) throw new AppError('unexpected', 'unexpected');
  return encoded;
}

interface WithHeader<T> {
  setHeader(name: string, value: string): T;
}

function audited<T extends WithHeader<T>>(
  query: T,
  table: AuditedTable,
  audit: PendingAudit,
  covers: readonly AuditedTable[] = [],
): T {
  return query.setHeader(AUDIT_HEADER, encodeAuditHeader(table, audit, covers));
}

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

  async function setStatus(
    table: 'offers' | 'icp_profiles',
    id: string,
    status: string,
    audit: PendingAudit,
  ) {
    const updated = await rows(
      audited(client.from(table).update({ status }).eq('id', id).select('id'), table, audit),
    );
    if (updated.length === 0) throw notFound();
  }

  async function liaById(id: string) {
    const row = await run(
      client.from('legal_basis_assessments').select(LIA_SELECT).eq('id', id).maybeSingle(),
    );
    return row ? mapLia(row) : null;
  }

  /** Atualização condicional da LIA: nenhuma linha → inexistente ou já decidida. */
  async function decideLia(
    id: string,
    patch: Record<string, string>,
    guard: 'approve' | 'revoke',
    audit: PendingAudit,
  ) {
    let query = client.from('legal_basis_assessments').update(patch).eq('id', id);
    query =
      guard === 'approve'
        ? query.is('approved_at', null)
        : query.is('revoked_at', null).not('approved_at', 'is', null);
    const updated = await rows(audited(query.select(LIA_SELECT), 'legal_basis_assessments', audit));
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

    async createOffer(content, audit) {
      const id = await run(
        audited(
          client.rpc('create_offer', { p_version: offerVersionColumns(content) }),
          'offers',
          audit,
          ['offer_versions'],
        ),
      );
      const offer = typeof id === 'string' ? await offerById(id) : null;
      if (!offer) throw new AppError('unexpected', 'unexpected');
      return offer;
    },

    async addOfferVersion(offerId, content, audit) {
      return mapOfferVersion(
        await run(
          audited(
            client
              .from('offer_versions')
              .insert({ offer_id: offerId, ...offerVersionColumns(content) })
              .select(OFFER_VERSION_SELECT)
              .single(),
            'offer_versions',
            audit,
          ),
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

    setOfferStatus: (offerId, status, audit) => setStatus('offers', offerId, status, audit),

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

    async addRubricVersion(offerId, content, audit) {
      return mapRubric(
        await run(
          audited(
            client
              .from('audit_rubrics')
              .insert({ offer_id: offerId, criteria: content.criteria })
              .select(RUBRIC_SELECT)
              .single(),
            'audit_rubrics',
            audit,
          ),
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

    async addScoringModelVersion(offerId, content, audit) {
      return mapScoring(
        await run(
          audited(
            client
              .from('scoring_models')
              .insert({ offer_id: offerId, ...scoringColumns(content) })
              .select(SCORING_SELECT)
              .single(),
            'scoring_models',
            audit,
          ),
        ),
      );
    },

    getIcp: icpById,

    async createIcp(offerId, content, audit) {
      const id = await run(
        audited(
          client.rpc('create_icp_profile', {
            p_offer_id: offerId,
            p_version: icpVersionColumns(content),
          }),
          'icp_profiles',
          audit,
          ['icp_profile_versions'],
        ),
      );
      const icp = typeof id === 'string' ? await icpById(id) : null;
      if (!icp) throw new AppError('unexpected', 'unexpected');
      return icp;
    },

    async addIcpVersion(icpId, content, audit) {
      return mapIcpVersion(
        await run(
          audited(
            client
              .from('icp_profile_versions')
              .insert({ icp_id: icpId, ...icpVersionColumns(content) })
              .select(ICP_VERSION_SELECT)
              .single(),
            'icp_profile_versions',
            audit,
          ),
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

    setIcpStatus: (icpId, status, audit) => setStatus('icp_profiles', icpId, status, audit),

    async listVoiceGuideVersions() {
      const list = await rows(
        client.from('voice_guides').select(VOICE_SELECT).order('version', { ascending: false }),
      );
      return list.map(mapVoice);
    },

    async addVoiceGuideVersion(content, audit) {
      return mapVoice(
        await run(
          audited(
            client.from('voice_guides').insert(voiceColumns(content)).select(VOICE_SELECT).single(),
            'voice_guides',
            audit,
          ),
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

    async addContactPolicyVersion(content, audit) {
      return mapContactPolicy(
        await run(
          audited(
            client
              .from('contact_policies')
              .insert(contactPolicyColumns(content))
              .select(CONTACT_POLICY_SELECT)
              .single(),
            'contact_policies',
            audit,
          ),
        ),
      );
    },

    async getProofAsset(id) {
      const row = await run(
        client.from('proof_assets').select(PROOF_ASSET_SELECT).eq('id', id).maybeSingle(),
      );
      return row ? mapProofAsset(row) : null;
    },

    async createProofAsset(input, audit) {
      return mapProofAsset(
        await run(
          audited(
            client
              .from('proof_assets')
              .insert(proofAssetColumns(input))
              .select(PROOF_ASSET_SELECT)
              .single(),
            'proof_assets',
            audit,
          ),
        ),
      );
    },

    async updateProofAsset(id, input, audit) {
      const [row] = await rows(
        audited(
          client
            .from('proof_assets')
            .update(proofAssetColumns(input))
            .eq('id', id)
            .select(PROOF_ASSET_SELECT),
          'proof_assets',
          audit,
        ),
      );
      if (!row) throw notFound();
      return mapProofAsset(row);
    },

    async archiveProofAsset(id, archivedAt, audit) {
      const updated = await rows(
        audited(
          client.from('proof_assets').update({ archived_at: archivedAt }).eq('id', id).select('id'),
          'proof_assets',
          audit,
        ),
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

    async addLiaVersion(content, audit) {
      return mapLia(
        await run(
          audited(
            client
              .from('legal_basis_assessments')
              .insert(liaColumns(content))
              .select(LIA_SELECT)
              .single(),
            'legal_basis_assessments',
            audit,
          ),
        ),
      );
    },

    approveLia: (id, { approvedAt, reviewDueOn }, audit) =>
      decideLia(id, { approved_at: approvedAt, review_due_on: reviewDueOn }, 'approve', audit),

    revokeLia: (id, revokedAt, audit) => decideLia(id, { revoked_at: revokedAt }, 'revoke', audit),
  };
}
