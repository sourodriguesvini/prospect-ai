import type {
  Claim,
  ClaimDependency,
  ClaimEvidence,
  ClaimSubjectType,
  Company,
  CompanyIdentifier,
  CompanyIdentifierKind,
  CompanyLifecycle,
  CompanyListFilter,
  CompanyOrigin,
  CompanySize,
  Source,
} from '@prospector/contracts';
import type { PendingAudit } from './audit-repository';

/** Empresa a gravar; o id vem do serviço (as fontes e claims do mesmo pedido apontam para ele). */
export interface NewCompany {
  id: string;
  displayName: string;
  legalName: string | null;
  cnpj: string | null;
  primaryDomain: string | null;
  city: string | null;
  uf: string | null;
  cnaeMain: string | null;
  sizeBand: CompanySize | null;
  origin: CompanyOrigin;
  lastInvestigatedAt: string | null;
  isDemo: boolean;
}

export interface NewCompanyIdentifier {
  kind: CompanyIdentifierKind;
  valueNormalized: string;
  strength: 'strong' | 'weak';
  verified: boolean;
}

/** Projeção da empresa que acompanha claims novos (campo ausente = não muda). */
export interface CompanyPatch {
  legalName?: string | null;
  city?: string | null;
  uf?: string | null;
  cnaeMain?: string | null;
  sizeBand?: CompanySize | null;
  lastInvestigatedAt?: string | null;
}

/** Claim pronto para gravar: confiança, estado e validade já calculados pelo domínio. */
export type NewClaim = Omit<Claim, 'createdAt' | 'reviewedAt'>;
/** Fonte nova; `createdAt` é do banco. */
export type NewSource = Omit<Source, 'createdAt'>;

/**
 * Lote do ledger gravado de uma vez (ADR-0010): fontes novas, claims com as evidências e
 * dependências, e os claims que a nova versão substitui. Nada é gravado se uma parte falhar.
 */
export interface EvidenceBatch {
  sources: NewSource[];
  claims: NewClaim[];
  evidence: ClaimEvidence[];
  dependencies: ClaimDependency[];
  /** Claims que saem de cena (`superseded`). Se algum já não estiver em vigor: `concurrent_change`. */
  supersede: string[];
}

/**
 * Empresas (M2). Criação, troca de ciclo de vida e registro de evidências gravam a auditoria no
 * mesmo pedido, com uma linha por operação (ADR-0010; migração 20261110170000).
 * Erros: AppError('conflict', 'company_duplicate') para CNPJ ou domínio já cadastrado;
 * AppError('conflict', 'concurrent_change') quando um claim a substituir já foi substituído.
 */
export interface CompanyRepository {
  list(filter: CompanyListFilter): Promise<Company[]>;
  get(id: string): Promise<Company | null>;
  /** Empresa que já tem alguma destas chaves fortes (CNPJ, domínio, place_id). */
  findByStrongIdentifier(
    keys: ReadonlyArray<{ kind: CompanyIdentifierKind; value: string }>,
  ): Promise<Company | null>;
  identifiers(companyId: string): Promise<CompanyIdentifier[]>;
  /** Cria a empresa, as chaves e, se houver, os primeiros claims (sem dependências). */
  create(
    company: NewCompany,
    identifiers: NewCompanyIdentifier[],
    batch: Omit<EvidenceBatch, 'dependencies' | 'supersede'>,
    audit: PendingAudit,
  ): Promise<Company>;
  /** Devolve false quando a empresa não existe (nada é gravado nem auditado). */
  setLifecycle(id: string, lifecycle: CompanyLifecycle, audit: PendingAudit): Promise<boolean>;
}

/** Leitura e gravação do Evidence Ledger (ADR-0002). Fontes e evidências são só inclusão. */
export interface EvidenceRepository {
  /** Grava o lote e atualiza a projeção da empresa; AppError('not_found') se ela não existe. */
  record(
    companyId: string,
    patch: CompanyPatch,
    batch: EvidenceBatch,
    audit: PendingAudit,
  ): Promise<void>;
  /** Claims do sujeito, mais recentes primeiro; `superseded` só com `includeSuperseded`. */
  claimsFor(
    subjectType: ClaimSubjectType,
    subjectId: string,
    options?: { includeSuperseded?: boolean },
  ): Promise<Claim[]>;
  claimsByIds(ids: readonly string[]): Promise<Claim[]>;
  evidenceFor(claimIds: readonly string[]): Promise<ClaimEvidence[]>;
  sourcesByIds(ids: readonly string[]): Promise<Source[]>;
  dependenciesFor(claimIds: readonly string[]): Promise<ClaimDependency[]>;
}
