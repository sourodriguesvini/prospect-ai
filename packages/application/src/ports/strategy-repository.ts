import type {
  ContactPolicyContent,
  ContactPolicyVersion,
  EntityStatus,
  IcpContent,
  IcpProfile,
  IcpVersion,
  LiaContent,
  LiaVersion,
  Offer,
  OfferContent,
  OfferVersion,
  ProofAsset,
  ProofAssetInput,
  RubricContent,
  RubricVersion,
  ScoringModelContent,
  ScoringModelVersion,
  StrategySnapshot,
  VoiceGuideContent,
  VoiceGuideVersion,
} from '@prospector/contracts';

import type { PendingAudit } from './audit-repository';

export type { PendingAudit } from './audit-repository';

/**
 * Persistência da estratégia (F2, ADR-0009). Versões são somente inclusão: o repositório nunca
 * altera nem apaga uma versão, e o número da versão é atribuído pela persistência.
 * Listas de versões vêm da mais recente para a mais antiga.
 * Toda escrita recebe o registro de auditoria e o grava junto (KI-041).
 * Erros: AppError('not_found') para pai inexistente; AppError('conflict') para corrida.
 */
export interface StrategyRepository {
  /** Versões atuais de tudo (entrada da prontidão e da visão geral). */
  loadSnapshot(): Promise<StrategySnapshot>;

  getOffer(id: string): Promise<Offer | null>;
  /** Cria o cabeçalho (rascunho) e a versão 1 de forma atômica. */
  createOffer(content: OfferContent, audit: PendingAudit): Promise<Offer>;
  addOfferVersion(
    offerId: string,
    content: OfferContent,
    audit: PendingAudit,
  ): Promise<OfferVersion>;
  listOfferVersions(offerId: string): Promise<OfferVersion[]>;
  setOfferStatus(offerId: string, status: EntityStatus, audit: PendingAudit): Promise<void>;

  listRubricVersions(offerId: string): Promise<RubricVersion[]>;
  addRubricVersion(
    offerId: string,
    content: RubricContent,
    audit: PendingAudit,
  ): Promise<RubricVersion>;

  listScoringModelVersions(offerId: string): Promise<ScoringModelVersion[]>;
  addScoringModelVersion(
    offerId: string,
    content: ScoringModelContent,
    audit: PendingAudit,
  ): Promise<ScoringModelVersion>;

  getIcp(id: string): Promise<IcpProfile | null>;
  /** Cria o perfil (rascunho) e a versão 1 de forma atômica. */
  createIcp(offerId: string, content: IcpContent, audit: PendingAudit): Promise<IcpProfile>;
  addIcpVersion(icpId: string, content: IcpContent, audit: PendingAudit): Promise<IcpVersion>;
  listIcpVersions(icpId: string): Promise<IcpVersion[]>;
  setIcpStatus(icpId: string, status: EntityStatus, audit: PendingAudit): Promise<void>;

  listVoiceGuideVersions(): Promise<VoiceGuideVersion[]>;
  addVoiceGuideVersion(content: VoiceGuideContent, audit: PendingAudit): Promise<VoiceGuideVersion>;

  listContactPolicyVersions(): Promise<ContactPolicyVersion[]>;
  addContactPolicyVersion(
    content: ContactPolicyContent,
    audit: PendingAudit,
  ): Promise<ContactPolicyVersion>;

  getProofAsset(id: string): Promise<ProofAsset | null>;
  createProofAsset(input: ProofAssetInput, audit: PendingAudit): Promise<ProofAsset>;
  updateProofAsset(id: string, input: ProofAssetInput, audit: PendingAudit): Promise<ProofAsset>;
  archiveProofAsset(id: string, archivedAt: string, audit: PendingAudit): Promise<void>;

  listLiaVersions(): Promise<LiaVersion[]>;
  addLiaVersion(content: LiaContent, audit: PendingAudit): Promise<LiaVersion>;
  /**
   * Grava a aprovação só se a versão ainda não tiver sido aprovada; se já tiver,
   * AppError('conflict', 'lia_decision_locked').
   */
  approveLia(
    id: string,
    decision: { approvedAt: string; reviewDueOn: string },
    audit: PendingAudit,
  ): Promise<LiaVersion>;
  /** Grava a revogação só se a versão estiver aprovada e não revogada. */
  revokeLia(id: string, revokedAt: string, audit: PendingAudit): Promise<LiaVersion>;
}
