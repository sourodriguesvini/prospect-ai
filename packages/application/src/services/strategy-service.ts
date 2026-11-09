import {
  ApproachScope,
  ContactPolicyContent,
  DiscoveryScope,
  EntityStatus,
  IcpContent,
  LiaApprovalInput,
  LiaContent,
  OfferContent,
  ProofAssetInput,
  RubricContent,
  ScoringModelContent,
  Uuid,
  VoiceGuideContent,
  type ApproachClearance,
  type ContactPolicyVersion,
  type DiscoveryClearance,
  type IcpProfile,
  type IcpVersion,
  type LiaVersion,
  type Offer,
  type OfferVersion,
  type ProofAsset,
  type Readiness,
  type ReadinessGate,
  type RubricVersion,
  type ScoringModelVersion,
  type StrategySnapshot,
  type VoiceGuideVersion,
} from '@prospector/contracts';
import {
  DEFAULT_LIA_REVIEW_MONTHS,
  MAX_LIA_REVIEW_MONTHS,
  addDays,
  addMonths,
  approachClearance,
  assessReadiness,
  canChangeStatus,
  discoveryClearance,
  effectiveLia,
  icpActivationIssues,
  icpContentIssues,
  liaApprovalIssues,
  liaRevocationIssues,
  liaStatus,
  offerActivationIssues,
  offerCompletenessGaps,
  offerContentIssues,
  proofAssetIssues,
  rubricIssues,
  sameContent,
  scoringModelIssues,
  type EffectiveLia,
  type LiaStatus,
} from '@prospector/domain';
import { calendarDate, systemClock, type Clock } from '../clock';
import type { RequestContext } from '../context';
import { AppError, assertNoIssues, parseInput } from '../errors';
import type { StrategyRepository } from '../ports/strategy-repository';
import type { AuditService } from './audit-service';

/** Resultado de um salvamento versionado: `changed` é falso quando nada mudou (sem nova versão). */
export interface SaveResult<T> {
  value: T;
  changed: boolean;
}

export interface StrategyOverview {
  snapshot: StrategySnapshot;
  readiness: Readiness;
  today: string;
}

export interface OfferDetail {
  offer: Offer;
  versions: OfferVersion[];
  rubricVersions: RubricVersion[];
  scoringModelVersions: ScoringModelVersion[];
  icps: IcpProfile[];
  /** O que falta para ativar (vazio = pode ativar). */
  activationIssues: string[];
}

export interface IcpDetail {
  icp: IcpProfile;
  offer: Offer;
  versions: IcpVersion[];
  activationIssues: string[];
}

export interface LiaVersionView extends LiaVersion {
  status: LiaStatus;
}

export interface ComplianceOverview {
  today: string;
  effectiveLia: EffectiveLia;
  liaVersions: LiaVersionView[];
  contactPolicyVersions: ContactPolicyVersion[];
  /** Sugestão para o formulário de aprovação (hoje + 12 meses) e faixa aceita (amanhã a hoje + 24). */
  suggestedReviewDueOn: string;
  minReviewDueOn: string;
  maxReviewDueOn: string;
}

export interface StrategyService {
  overview(ctx: RequestContext): Promise<StrategyOverview>;
  readiness(ctx: RequestContext): Promise<Readiness>;
  /**
   * Barreira das ações de abordagem (F10), para a oferta (e o ICP) da ação. Lança
   * AppError('conflict', 'approach_blocked') com o que falta; liberada, devolve as versões
   * conferidas, que a ação grava junto da aprovação.
   */
  assertReadyToApproach(ctx: RequestContext, scope: unknown): Promise<ApproachClearance>;
  /** Barreira da descoberta (F4) de um ICP: AppError('conflict', 'discovery_blocked') se faltar algo. */
  assertReadyToDiscover(ctx: RequestContext, scope: unknown): Promise<DiscoveryClearance>;

  offerDetail(ctx: RequestContext, offerId: string): Promise<OfferDetail>;
  createOffer(ctx: RequestContext, raw: unknown): Promise<Offer>;
  updateOffer(
    ctx: RequestContext,
    offerId: string,
    raw: unknown,
  ): Promise<SaveResult<OfferVersion>>;
  changeOfferStatus(ctx: RequestContext, offerId: string, status: unknown): Promise<void>;
  saveRubric(
    ctx: RequestContext,
    offerId: string,
    raw: unknown,
  ): Promise<SaveResult<RubricVersion>>;
  saveScoringModel(
    ctx: RequestContext,
    offerId: string,
    raw: unknown,
  ): Promise<SaveResult<ScoringModelVersion>>;

  icpDetail(ctx: RequestContext, icpId: string): Promise<IcpDetail>;
  createIcp(ctx: RequestContext, offerId: string, raw: unknown): Promise<IcpProfile>;
  updateIcp(ctx: RequestContext, icpId: string, raw: unknown): Promise<SaveResult<IcpVersion>>;
  changeIcpStatus(ctx: RequestContext, icpId: string, status: unknown): Promise<void>;

  voiceGuideVersions(ctx: RequestContext): Promise<VoiceGuideVersion[]>;
  saveVoiceGuide(ctx: RequestContext, raw: unknown): Promise<SaveResult<VoiceGuideVersion>>;

  proofAsset(ctx: RequestContext, id: string): Promise<ProofAsset>;
  createProofAsset(ctx: RequestContext, raw: unknown): Promise<ProofAsset>;
  updateProofAsset(ctx: RequestContext, id: string, raw: unknown): Promise<ProofAsset>;
  archiveProofAsset(ctx: RequestContext, id: string): Promise<void>;

  compliance(ctx: RequestContext): Promise<ComplianceOverview>;
  saveLia(ctx: RequestContext, raw: unknown): Promise<SaveResult<LiaVersion>>;
  approveLia(ctx: RequestContext, id: string, raw: unknown): Promise<LiaVersion>;
  revokeLia(ctx: RequestContext, id: string): Promise<LiaVersion>;
  saveContactPolicy(ctx: RequestContext, raw: unknown): Promise<SaveResult<ContactPolicyVersion>>;
}

const notFound = () => new AppError('not_found', 'not_found');

/**
 * Casos de uso da estratégia (F2). Regras de negócio vêm de @prospector/domain; aqui ficam a
 * validação de entrada (contratos), a orquestração com o repositório e a auditoria.
 * A auditoria registra versões e decisões, nunca o conteúdo (KI-015).
 */
export function createStrategyService(deps: {
  repo: StrategyRepository;
  audit: AuditService;
  clock?: Clock;
  /**
   * Armazenamento que some ao reiniciar (modo memória, ADR-0009): a barreira de abordagem fica
   * sempre bloqueada, porque LIA e auditoria precisam durar.
   */
  ephemeralStorage?: boolean;
}): StrategyService {
  const { repo, audit } = deps;
  const clock = deps.clock ?? systemClock;
  const today = () => calendarDate(clock.now());
  const options = { ephemeralStorage: deps.ephemeralStorage ?? false };

  /** Ids vêm da URL ou do formulário: id malformado é "não encontrado", igual nos dois modos. */
  function assertId(id: string): void {
    if (!Uuid.safeParse(id).success) throw notFound();
  }

  function blocked(gate: ReadinessGate, reason: 'approach_blocked' | 'discovery_blocked') {
    const missing = gate.items.filter((i) => i.blocking && !i.ok);
    return new AppError('conflict', reason, {
      fieldErrors: { _form: missing.map((i) => `${i.label}: ${i.detail}`) },
    });
  }

  async function requireOffer(offerId: string): Promise<Offer> {
    assertId(offerId);
    const offer = await repo.getOffer(offerId);
    if (!offer) throw notFound();
    return offer;
  }

  async function requireIcp(icpId: string): Promise<IcpProfile> {
    assertId(icpId);
    const icp = await repo.getIcp(icpId);
    if (!icp) throw notFound();
    return icp;
  }

  async function requireProofAsset(id: string): Promise<ProofAsset> {
    assertId(id);
    const asset = await repo.getProofAsset(id);
    if (!asset) throw notFound();
    return asset;
  }

  async function readiness(): Promise<Readiness> {
    return assessReadiness(await repo.loadSnapshot(), today(), {}, options);
  }

  async function offerActivationGaps(offer: Offer): Promise<string[]> {
    const [rubrics, models] = await Promise.all([
      repo.listRubricVersions(offer.id),
      repo.listScoringModelVersions(offer.id),
    ]);
    return offerActivationIssues({
      current: offer.current?.content ?? null,
      hasRubric: rubrics.length > 0,
      hasScoringModel: models.length > 0,
    }).map((i) => i.message);
  }

  function parseStatus(raw: unknown) {
    return parseInput(EntityStatus, raw);
  }

  return {
    async overview() {
      const snapshot = await repo.loadSnapshot();
      const day = today();
      return { snapshot, readiness: assessReadiness(snapshot, day, {}, options), today: day };
    },

    readiness: () => readiness(),

    async assertReadyToApproach(_ctx, raw) {
      const scope = parseInput(ApproachScope, raw);
      const snapshot = await repo.loadSnapshot();
      const day = today();
      const { approach } = assessReadiness(snapshot, day, scope, options);
      const clearance = approachClearance(snapshot, day, scope, options);
      if (!approach.ready || !clearance) throw blocked(approach, 'approach_blocked');
      return clearance;
    },

    async assertReadyToDiscover(_ctx, raw) {
      const scope = parseInput(DiscoveryScope, raw);
      const snapshot = await repo.loadSnapshot();
      const day = today();
      const { discover } = assessReadiness(snapshot, day, scope, options);
      const clearance = discoveryClearance(snapshot, day, scope);
      if (!discover.ready || !clearance) throw blocked(discover, 'discovery_blocked');
      return clearance;
    },

    // --- Ofertas ---------------------------------------------------------------

    async offerDetail(_ctx, offerId) {
      const offer = await requireOffer(offerId);
      const [versions, rubricVersions, scoringModelVersions, snapshot] = await Promise.all([
        repo.listOfferVersions(offerId),
        repo.listRubricVersions(offerId),
        repo.listScoringModelVersions(offerId),
        repo.loadSnapshot(),
      ]);
      return {
        offer,
        versions,
        rubricVersions,
        scoringModelVersions,
        icps: snapshot.icps.filter((icp) => icp.offerId === offerId),
        activationIssues: offerActivationIssues({
          current: offer.current?.content ?? null,
          hasRubric: rubricVersions.length > 0,
          hasScoringModel: scoringModelVersions.length > 0,
        }).map((i) => i.message),
      };
    },

    async createOffer(ctx, raw) {
      const content = parseInput(OfferContent, raw);
      assertNoIssues(offerContentIssues(content));
      const offer = await repo.createOffer(content);
      await audit.record(ctx, {
        action: 'strategy.offer.created',
        entityType: 'offer',
        entityId: offer.id,
        diff: { version: offer.current?.version ?? 1 },
      });
      return offer;
    },

    async updateOffer(ctx, offerId, raw) {
      const offer = await requireOffer(offerId);
      const content = parseInput(OfferContent, raw);
      assertNoIssues(offerContentIssues(content));
      if (offer.current && sameContent(offer.current.content, content)) {
        return { value: offer.current, changed: false };
      }
      if (offer.status === 'active') {
        const gaps = offerCompletenessGaps(content);
        if (gaps.length > 0) {
          throw new AppError('validation', 'offer_active_incomplete', {
            fieldErrors: { _form: [`Falta: ${gaps.join(', ')}.`] },
          });
        }
      }
      const version = await repo.addOfferVersion(offerId, content);
      await audit.record(ctx, {
        action: 'strategy.offer.versioned',
        entityType: 'offer',
        entityId: offerId,
        diff: { version: version.version, previousVersion: offer.current?.version ?? null },
      });
      return { value: version, changed: true };
    },

    async changeOfferStatus(ctx, offerId, rawStatus) {
      const status = parseStatus(rawStatus);
      const offer = await requireOffer(offerId);
      if (offer.status === status) return;
      if (!canChangeStatus(offer.status, status)) {
        throw new AppError('validation', 'invalid_status_change');
      }
      if (status === 'active') {
        const gaps = await offerActivationGaps(offer);
        if (gaps.length > 0) {
          throw new AppError('validation', 'activation_blocked', { fieldErrors: { _form: gaps } });
        }
      }
      await repo.setOfferStatus(offerId, status);
      await audit.record(ctx, {
        action: 'strategy.offer.status_changed',
        entityType: 'offer',
        entityId: offerId,
        diff: { from: offer.status, to: status },
      });
    },

    async saveRubric(ctx, offerId, raw) {
      await requireOffer(offerId);
      const content = parseInput(RubricContent, raw);
      assertNoIssues(rubricIssues(content));
      const [current] = await repo.listRubricVersions(offerId);
      if (current && sameContent(current.content, content)) {
        return { value: current, changed: false };
      }
      const version = await repo.addRubricVersion(offerId, content);
      await audit.record(ctx, {
        action: 'strategy.rubric.versioned',
        entityType: 'offer',
        entityId: offerId,
        diff: { version: version.version, criteria: content.criteria.length },
      });
      return { value: version, changed: true };
    },

    async saveScoringModel(ctx, offerId, raw) {
      await requireOffer(offerId);
      const content = parseInput(ScoringModelContent, raw);
      assertNoIssues(scoringModelIssues(content));
      const [current] = await repo.listScoringModelVersions(offerId);
      if (current && sameContent(current.content, content)) {
        return { value: current, changed: false };
      }
      const version = await repo.addScoringModelVersion(offerId, content);
      await audit.record(ctx, {
        action: 'strategy.scoring_model.versioned',
        entityType: 'offer',
        entityId: offerId,
        diff: { version: version.version },
      });
      return { value: version, changed: true };
    },

    // --- ICP -------------------------------------------------------------------

    async icpDetail(_ctx, icpId) {
      const icp = await requireIcp(icpId);
      const [offer, versions] = await Promise.all([
        requireOffer(icp.offerId),
        repo.listIcpVersions(icpId),
      ]);
      return {
        icp,
        offer,
        versions,
        activationIssues: icp.current
          ? icpActivationIssues(icp.current.content).map((i) => i.message)
          : [],
      };
    },

    async createIcp(ctx, offerId, raw) {
      await requireOffer(offerId);
      const content = parseInput(IcpContent, raw);
      assertNoIssues(icpContentIssues(content));
      const icp = await repo.createIcp(offerId, content);
      await audit.record(ctx, {
        action: 'strategy.icp.created',
        entityType: 'icp_profile',
        entityId: icp.id,
        diff: { offerId, version: icp.current?.version ?? 1 },
      });
      return icp;
    },

    async updateIcp(ctx, icpId, raw) {
      const icp = await requireIcp(icpId);
      const content = parseInput(IcpContent, raw);
      assertNoIssues(icpContentIssues(content));
      if (icp.current && sameContent(icp.current.content, content)) {
        return { value: icp.current, changed: false };
      }
      if (icp.status === 'active') {
        assertNoIssues(icpActivationIssues(content), 'icp_active_incomplete');
      }
      const version = await repo.addIcpVersion(icpId, content);
      await audit.record(ctx, {
        action: 'strategy.icp.versioned',
        entityType: 'icp_profile',
        entityId: icpId,
        diff: { version: version.version, previousVersion: icp.current?.version ?? null },
      });
      return { value: version, changed: true };
    },

    async changeIcpStatus(ctx, icpId, rawStatus) {
      const status = parseStatus(rawStatus);
      const icp = await requireIcp(icpId);
      if (icp.status === status) return;
      if (!canChangeStatus(icp.status, status)) {
        throw new AppError('validation', 'invalid_status_change');
      }
      if (status === 'active' && icp.current) {
        assertNoIssues(icpActivationIssues(icp.current.content), 'activation_blocked');
      }
      await repo.setIcpStatus(icpId, status);
      await audit.record(ctx, {
        action: 'strategy.icp.status_changed',
        entityType: 'icp_profile',
        entityId: icpId,
        diff: { from: icp.status, to: status },
      });
    },

    // --- Voz da agência ----------------------------------------------------------

    voiceGuideVersions: () => repo.listVoiceGuideVersions(),

    async saveVoiceGuide(ctx, raw) {
      const content = parseInput(VoiceGuideContent, raw);
      const [current] = await repo.listVoiceGuideVersions();
      if (current && sameContent(current.content, content)) {
        return { value: current, changed: false };
      }
      const version = await repo.addVoiceGuideVersion(content);
      await audit.record(ctx, {
        action: 'strategy.voice_guide.versioned',
        entityType: 'voice_guide',
        entityId: version.id,
        diff: { version: version.version },
      });
      return { value: version, changed: true };
    },

    // --- Cases -------------------------------------------------------------------

    proofAsset: (_ctx, id) => requireProofAsset(id),

    async createProofAsset(ctx, raw) {
      const input = parseInput(ProofAssetInput, raw);
      assertNoIssues(proofAssetIssues(input));
      if (input.offerId) await requireOffer(input.offerId);
      const asset = await repo.createProofAsset(input);
      await audit.record(ctx, {
        action: 'strategy.proof_asset.created',
        entityType: 'proof_asset',
        entityId: asset.id,
        diff: { publicOk: asset.publicOk },
      });
      return asset;
    },

    async updateProofAsset(ctx, id, raw) {
      const before = await requireProofAsset(id);
      if (before.archivedAt) throw new AppError('conflict', 'proof_asset_archived');
      const input = parseInput(ProofAssetInput, raw);
      assertNoIssues(proofAssetIssues(input));
      if (input.offerId) await requireOffer(input.offerId);
      const asset = await repo.updateProofAsset(id, input);
      await audit.record(ctx, {
        action: 'strategy.proof_asset.updated',
        entityType: 'proof_asset',
        entityId: id,
        // Só o fato de a autorização ter mudado, nunca o texto dela (KI-015).
        diff: {
          publicOk:
            before.publicOk === asset.publicOk
              ? asset.publicOk
              : { from: before.publicOk, to: asset.publicOk },
          ...(before.consentRef === asset.consentRef ? {} : { consentRefChanged: true }),
        },
      });
      return asset;
    },

    async archiveProofAsset(ctx, id) {
      const asset = await requireProofAsset(id);
      if (asset.archivedAt) return;
      await repo.archiveProofAsset(id, clock.now().toISOString());
      await audit.record(ctx, {
        action: 'strategy.proof_asset.archived',
        entityType: 'proof_asset',
        entityId: id,
      });
    },

    // --- Conformidade: LIA e política de contato ---------------------------------

    async compliance() {
      const [liaVersions, contactPolicyVersions] = await Promise.all([
        repo.listLiaVersions(),
        repo.listContactPolicyVersions(),
      ]);
      const day = today();
      return {
        today: day,
        effectiveLia: effectiveLia(liaVersions, day),
        liaVersions: liaVersions.map((v) => ({ ...v, status: liaStatus(v, liaVersions, day) })),
        contactPolicyVersions,
        suggestedReviewDueOn: addMonths(day, DEFAULT_LIA_REVIEW_MONTHS),
        minReviewDueOn: addDays(day, 1),
        maxReviewDueOn: addMonths(day, MAX_LIA_REVIEW_MONTHS),
      };
    },

    async saveLia(ctx, raw) {
      const content = parseInput(LiaContent, raw);
      const [latest] = await repo.listLiaVersions();
      // Só um rascunho igual é "nada mudou". Depois de aprovada, revogada ou vencida, salvar o
      // mesmo texto cria nova versão: é assim que se renova a LIA ou se estende a revisão.
      if (latest && !latest.approvedAt && sameContent(latest.content, content)) {
        return { value: latest, changed: false };
      }
      const version = await repo.addLiaVersion(content);
      await audit.record(ctx, {
        action: 'compliance.lia.versioned',
        entityType: 'legal_basis_assessment',
        entityId: version.id,
        diff: { version: version.version },
      });
      return { value: version, changed: true };
    },

    async approveLia(ctx, id, raw) {
      assertId(id);
      const { reviewDueOn } = parseInput(LiaApprovalInput, raw);
      const all = await repo.listLiaVersions();
      const target = all.find((v) => v.id === id);
      if (!target) throw notFound();
      assertNoIssues(liaApprovalIssues(target, all, reviewDueOn, today()));
      const approved = await repo.approveLia(id, {
        approvedAt: clock.now().toISOString(),
        reviewDueOn,
      });
      await audit.record(ctx, {
        action: 'compliance.lia.approved',
        entityType: 'legal_basis_assessment',
        entityId: id,
        diff: { version: approved.version, reviewDueOn },
      });
      return approved;
    },

    async revokeLia(ctx, id) {
      assertId(id);
      const all = await repo.listLiaVersions();
      const target = all.find((v) => v.id === id);
      if (!target) throw notFound();
      assertNoIssues(liaRevocationIssues(target, all));
      const revoked = await repo.revokeLia(id, clock.now().toISOString());
      await audit.record(ctx, {
        action: 'compliance.lia.revoked',
        entityType: 'legal_basis_assessment',
        entityId: id,
        diff: { version: revoked.version },
      });
      return revoked;
    },

    async saveContactPolicy(ctx, raw) {
      const content = parseInput(ContactPolicyContent, raw);
      const [current] = await repo.listContactPolicyVersions();
      if (current && sameContent(current.content, content)) {
        return { value: current, changed: false };
      }
      const version = await repo.addContactPolicyVersion(content);
      await audit.record(ctx, {
        action: 'compliance.contact_policy.versioned',
        entityType: 'contact_policy',
        entityId: version.id,
        diff: { version: version.version },
      });
      return { value: version, changed: true };
    },
  };
}
