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

/**
 * Persistência da estratégia (F2, ADR-0009). Versões são somente inclusão: o repositório nunca
 * altera nem apaga uma versão, e o número da versão é atribuído pela persistência.
 * Listas de versões vêm da mais recente para a mais antiga.
 * Erros: AppError('not_found') para pai inexistente; AppError('conflict') para corrida.
 */
export interface StrategyRepository {
  /** Versões atuais de tudo (entrada da prontidão e da visão geral). */
  loadSnapshot(): Promise<StrategySnapshot>;

  getOffer(id: string): Promise<Offer | null>;
  /** Cria o cabeçalho (rascunho) e a versão 1 de forma atômica. */
  createOffer(content: OfferContent): Promise<Offer>;
  addOfferVersion(offerId: string, content: OfferContent): Promise<OfferVersion>;
  listOfferVersions(offerId: string): Promise<OfferVersion[]>;
  setOfferStatus(offerId: string, status: EntityStatus): Promise<void>;

  listRubricVersions(offerId: string): Promise<RubricVersion[]>;
  addRubricVersion(offerId: string, content: RubricContent): Promise<RubricVersion>;

  listScoringModelVersions(offerId: string): Promise<ScoringModelVersion[]>;
  addScoringModelVersion(
    offerId: string,
    content: ScoringModelContent,
  ): Promise<ScoringModelVersion>;

  getIcp(id: string): Promise<IcpProfile | null>;
  /** Cria o perfil (rascunho) e a versão 1 de forma atômica. */
  createIcp(offerId: string, content: IcpContent): Promise<IcpProfile>;
  addIcpVersion(icpId: string, content: IcpContent): Promise<IcpVersion>;
  listIcpVersions(icpId: string): Promise<IcpVersion[]>;
  setIcpStatus(icpId: string, status: EntityStatus): Promise<void>;

  listVoiceGuideVersions(): Promise<VoiceGuideVersion[]>;
  addVoiceGuideVersion(content: VoiceGuideContent): Promise<VoiceGuideVersion>;

  listContactPolicyVersions(): Promise<ContactPolicyVersion[]>;
  addContactPolicyVersion(content: ContactPolicyContent): Promise<ContactPolicyVersion>;

  getProofAsset(id: string): Promise<ProofAsset | null>;
  createProofAsset(input: ProofAssetInput): Promise<ProofAsset>;
  updateProofAsset(id: string, input: ProofAssetInput): Promise<ProofAsset>;
  archiveProofAsset(id: string, archivedAt: string): Promise<void>;

  listLiaVersions(): Promise<LiaVersion[]>;
  addLiaVersion(content: LiaContent): Promise<LiaVersion>;
  /**
   * Grava a aprovação só se a versão ainda não tiver sido aprovada; se já tiver,
   * AppError('conflict', 'lia_decision_locked').
   */
  approveLia(
    id: string,
    decision: { approvedAt: string; reviewDueOn: string },
  ): Promise<LiaVersion>;
  /** Grava a revogação só se a versão estiver aprovada e não revogada. */
  revokeLia(id: string, revokedAt: string): Promise<LiaVersion>;
}
