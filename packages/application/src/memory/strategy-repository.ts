import type {
  ContactPolicyVersion,
  EntityStatus,
  IcpContent,
  IcpProfile,
  IcpVersion,
  LiaVersion,
  Offer,
  OfferContent,
  OfferVersion,
  ProofAsset,
  RubricVersion,
  ScoringModelVersion,
  VoiceGuideVersion,
} from '@prospector/contracts';
import { systemClock, type Clock } from '../clock';
import { AppError } from '../errors';
import type { StrategyRepository } from '../ports/strategy-repository';

/**
 * StrategyRepository em memória (ADR-0009): mesmo comportamento observável do banco — versões
 * somente inclusão numeradas pela persistência, decisão da LIA uma vez só — sem IO.
 * Usado nos testes de serviço e no modo local sem banco (`PROSPECTOR_STORAGE=memory`).
 * Os dados somem quando o processo termina.
 */

interface Header {
  id: string;
  status: EntityStatus;
  isDemo: boolean;
  createdAt: string;
  updatedAt: string;
}

interface IcpHeader extends Header {
  offerId: string;
}

export interface MemoryStrategyOptions {
  clock?: Clock;
  newId?: () => string;
}

export interface MemoryStrategyRepository extends StrategyRepository {
  /** Marca uma oferta como demonstração (só seeds; o app nunca faz isso). */
  markOfferAsDemo(offerId: string): void;
}

const byVersionDesc = <T extends { version: number }>(list: readonly T[]) =>
  [...list].sort((a, b) => b.version - a.version);

const clone = <T>(value: T): T => structuredClone(value);

export function createMemoryStrategyRepository(
  options: MemoryStrategyOptions = {},
): MemoryStrategyRepository {
  const clock = options.clock ?? systemClock;
  const newId = options.newId ?? (() => crypto.randomUUID());
  const now = () => clock.now().toISOString();

  const offers = new Map<string, Header>();
  const offerVersions: OfferVersion[] = [];
  const rubrics: RubricVersion[] = [];
  const scoringModels: ScoringModelVersion[] = [];
  const icps = new Map<string, IcpHeader>();
  const icpVersions: IcpVersion[] = [];
  const voiceGuides: VoiceGuideVersion[] = [];
  const contactPolicies: ContactPolicyVersion[] = [];
  const proofAssets = new Map<string, ProofAsset>();
  const liaVersions: LiaVersion[] = [];

  const nextVersion = (list: readonly { version: number }[]) =>
    list.reduce((max, v) => Math.max(max, v.version), 0) + 1;

  const latest = <T extends { version: number }>(list: readonly T[]): T | null =>
    byVersionDesc(list)[0] ?? null;

  function requireOfferHeader(id: string): Header {
    const header = offers.get(id);
    if (!header) throw new AppError('not_found', 'not_found');
    return header;
  }

  function requireIcpHeader(id: string): IcpHeader {
    const header = icps.get(id);
    if (!header) throw new AppError('not_found', 'not_found');
    return header;
  }

  function toOffer(header: Header): Offer {
    return clone({
      ...header,
      current: latest(offerVersions.filter((v) => v.offerId === header.id)),
    });
  }

  function toIcp(header: IcpHeader): IcpProfile {
    return clone({ ...header, current: latest(icpVersions.filter((v) => v.icpId === header.id)) });
  }

  function pushOfferVersion(offerId: string, content: OfferContent): OfferVersion {
    const version: OfferVersion = {
      id: newId(),
      offerId,
      version: nextVersion(offerVersions.filter((v) => v.offerId === offerId)),
      content: clone(content),
      createdAt: now(),
    };
    offerVersions.push(version);
    return clone(version);
  }

  function pushIcpVersion(icpId: string, content: IcpContent): IcpVersion {
    const version: IcpVersion = {
      id: newId(),
      icpId,
      version: nextVersion(icpVersions.filter((v) => v.icpId === icpId)),
      content: clone(content),
      createdAt: now(),
    };
    icpVersions.push(version);
    return clone(version);
  }

  function currentPerOffer<T extends { offerId: string; version: number }>(list: readonly T[]) {
    return [...offers.keys()]
      .map((id) => latest(list.filter((v) => v.offerId === id)))
      .filter((v): v is T => v !== null)
      .map(clone);
  }

  function requireLia(id: string): LiaVersion {
    const lia = liaVersions.find((v) => v.id === id);
    if (!lia) throw new AppError('not_found', 'not_found');
    return lia;
  }

  return {
    async loadSnapshot() {
      return {
        offers: [...offers.values()].map(toOffer),
        rubrics: currentPerOffer(rubrics),
        scoringModels: currentPerOffer(scoringModels),
        icps: [...icps.values()].map(toIcp),
        voiceGuide: clone(latest(voiceGuides)),
        contactPolicy: clone(latest(contactPolicies)),
        liaVersions: byVersionDesc(liaVersions).map(clone),
        proofAssets: [...proofAssets.values()].map(clone),
      };
    },

    async getOffer(id) {
      const header = offers.get(id);
      return header ? toOffer(header) : null;
    },

    async createOffer(content) {
      const at = now();
      const header: Header = {
        id: newId(),
        status: 'draft',
        isDemo: false,
        createdAt: at,
        updatedAt: at,
      };
      offers.set(header.id, header);
      pushOfferVersion(header.id, content);
      return toOffer(header);
    },

    async addOfferVersion(offerId, content) {
      requireOfferHeader(offerId);
      return pushOfferVersion(offerId, content);
    },

    async listOfferVersions(offerId) {
      return byVersionDesc(offerVersions.filter((v) => v.offerId === offerId)).map(clone);
    },

    async setOfferStatus(offerId, status) {
      const header = requireOfferHeader(offerId);
      header.status = status;
      header.updatedAt = now();
    },

    async listRubricVersions(offerId) {
      return byVersionDesc(rubrics.filter((v) => v.offerId === offerId)).map(clone);
    },

    async addRubricVersion(offerId, content) {
      requireOfferHeader(offerId);
      const version: RubricVersion = {
        id: newId(),
        offerId,
        version: nextVersion(rubrics.filter((v) => v.offerId === offerId)),
        content: clone(content),
        createdAt: now(),
      };
      rubrics.push(version);
      return clone(version);
    },

    async listScoringModelVersions(offerId) {
      return byVersionDesc(scoringModels.filter((v) => v.offerId === offerId)).map(clone);
    },

    async addScoringModelVersion(offerId, content) {
      requireOfferHeader(offerId);
      const version: ScoringModelVersion = {
        id: newId(),
        offerId,
        version: nextVersion(scoringModels.filter((v) => v.offerId === offerId)),
        content: clone(content),
        createdAt: now(),
      };
      scoringModels.push(version);
      return clone(version);
    },

    async getIcp(id) {
      const header = icps.get(id);
      return header ? toIcp(header) : null;
    },

    async createIcp(offerId, content) {
      requireOfferHeader(offerId);
      const at = now();
      const header: IcpHeader = {
        id: newId(),
        offerId,
        status: 'draft',
        isDemo: false,
        createdAt: at,
        updatedAt: at,
      };
      icps.set(header.id, header);
      pushIcpVersion(header.id, content);
      return toIcp(header);
    },

    async addIcpVersion(icpId, content) {
      requireIcpHeader(icpId);
      return pushIcpVersion(icpId, content);
    },

    async listIcpVersions(icpId) {
      return byVersionDesc(icpVersions.filter((v) => v.icpId === icpId)).map(clone);
    },

    async setIcpStatus(icpId, status) {
      const header = requireIcpHeader(icpId);
      header.status = status;
      header.updatedAt = now();
    },

    async listVoiceGuideVersions() {
      return byVersionDesc(voiceGuides).map(clone);
    },

    async addVoiceGuideVersion(content) {
      const version: VoiceGuideVersion = {
        id: newId(),
        version: nextVersion(voiceGuides),
        content: clone(content),
        createdAt: now(),
      };
      voiceGuides.push(version);
      return clone(version);
    },

    async listContactPolicyVersions() {
      return byVersionDesc(contactPolicies).map(clone);
    },

    async addContactPolicyVersion(content) {
      const version: ContactPolicyVersion = {
        id: newId(),
        version: nextVersion(contactPolicies),
        content: clone(content),
        createdAt: now(),
      };
      contactPolicies.push(version);
      return clone(version);
    },

    async getProofAsset(id) {
      const asset = proofAssets.get(id);
      return asset ? clone(asset) : null;
    },

    async createProofAsset(input) {
      if (input.offerId) requireOfferHeader(input.offerId);
      const at = now();
      const asset: ProofAsset = {
        ...clone(input),
        id: newId(),
        isDemo: false,
        archivedAt: null,
        createdAt: at,
        updatedAt: at,
      };
      proofAssets.set(asset.id, asset);
      return clone(asset);
    },

    async updateProofAsset(id, input) {
      const existing = proofAssets.get(id);
      if (!existing) throw new AppError('not_found', 'not_found');
      if (input.offerId) requireOfferHeader(input.offerId);
      const updated: ProofAsset = { ...existing, ...clone(input), updatedAt: now() };
      proofAssets.set(id, updated);
      return clone(updated);
    },

    async archiveProofAsset(id, archivedAt) {
      const existing = proofAssets.get(id);
      if (!existing) throw new AppError('not_found', 'not_found');
      proofAssets.set(id, { ...existing, archivedAt, updatedAt: now() });
    },

    async listLiaVersions() {
      return byVersionDesc(liaVersions).map(clone);
    },

    async addLiaVersion(content) {
      const version: LiaVersion = {
        id: newId(),
        version: nextVersion(liaVersions),
        content: clone(content),
        createdAt: now(),
        approvedAt: null,
        reviewDueOn: null,
        revokedAt: null,
      };
      liaVersions.push(version);
      return clone(version);
    },

    async approveLia(id, { approvedAt, reviewDueOn }) {
      const lia = requireLia(id);
      if (lia.approvedAt) throw new AppError('conflict', 'lia_decision_locked');
      lia.approvedAt = approvedAt;
      lia.reviewDueOn = reviewDueOn;
      return clone(lia);
    },

    async revokeLia(id, revokedAt) {
      const lia = requireLia(id);
      if (!lia.approvedAt || lia.revokedAt) {
        throw new AppError('conflict', 'lia_decision_locked');
      }
      lia.revokedAt = revokedAt;
      return clone(lia);
    },

    markOfferAsDemo(offerId) {
      requireOfferHeader(offerId).isDemo = true;
    },
  };
}
