import type {
  Claim,
  ClaimDependency,
  ClaimEvidence,
  Company,
  CompanyIdentifier,
  Source,
} from '@prospector/contracts';
import { systemClock, type Clock } from '../clock';
import { AppError } from '../errors';
import type { AuditRepository, PendingAudit } from '../ports/audit-repository';
import type {
  CompanyRepository,
  EvidenceBatch,
  EvidenceRepository,
} from '../ports/company-repository';

const clone = <T>(value: T): T => structuredClone(value);

const CURRENT: ReadonlySet<string> = new Set(['active', 'stale', 'disputed']);

/** Busca sem acento e sem maiúsculas, como o `unaccent(...) ilike` do banco. */
function fold(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/**
 * Empresas e Evidence Ledger em memória: mesmo comportamento observável do banco (chaves fortes
 * únicas, fontes e evidências só inclusão, lote atômico, uma linha de auditoria por operação).
 */
export function createMemoryCompanyRepository(options: {
  audit: AuditRepository;
  clock?: Clock;
  newId?: () => string;
}): CompanyRepository & EvidenceRepository {
  const clock = options.clock ?? systemClock;
  const newId = options.newId ?? (() => crypto.randomUUID());
  const now = () => clock.now().toISOString();
  const companies = new Map<string, Company>();
  const identifiers: CompanyIdentifier[] = [];
  const sources = new Map<string, Source>();
  const claims = new Map<string, Claim>();
  const evidence: ClaimEvidence[] = [];
  const dependencies: ClaimDependency[] = [];

  async function audited(audit: PendingAudit, id: string): Promise<void> {
    await options.audit.append({
      actorType: audit.actorType,
      actorLabel: audit.actorLabel,
      action: audit.action,
      entityType: audit.entityType,
      entityId: audit.entityId ?? id,
      diff: { ...audit.diff },
      traceId: audit.traceId,
    });
  }

  function strongTaken(kind: string, value: string): boolean {
    return identifiers.some(
      (item) => item.strength === 'strong' && item.kind === kind && item.valueNormalized === value,
    );
  }

  /** Confere tudo antes de gravar: ou o lote inteiro entra, ou nada. */
  function checkBatch(
    batch: Omit<EvidenceBatch, 'dependencies' | 'supersede'> & Partial<EvidenceBatch>,
  ) {
    const sourceIds = new Set([...sources.keys(), ...batch.sources.map((s) => s.id)]);
    const claimIds = new Set([...claims.keys(), ...batch.claims.map((c) => c.id)]);
    for (const item of batch.evidence) {
      if (!sourceIds.has(item.sourceId) || !claimIds.has(item.claimId)) {
        throw new AppError('not_found', 'not_found');
      }
    }
    for (const item of batch.dependencies ?? []) {
      if (!claimIds.has(item.claimId) || !claimIds.has(item.dependsOnClaimId)) {
        throw new AppError('not_found', 'not_found');
      }
    }
    for (const id of batch.supersede ?? []) {
      const claim = claims.get(id);
      if (!claim || !CURRENT.has(claim.status)) throw new AppError('conflict', 'concurrent_change');
    }
  }

  function insertBatch(
    batch: Omit<EvidenceBatch, 'dependencies' | 'supersede'> & Partial<EvidenceBatch>,
  ) {
    const at = now();
    for (const source of batch.sources) sources.set(source.id, { ...clone(source), createdAt: at });
    for (const claim of batch.claims) {
      claims.set(claim.id, { ...clone(claim), reviewedAt: null, createdAt: at });
    }
    evidence.push(...batch.evidence.map(clone));
    dependencies.push(...(batch.dependencies ?? []).map(clone));
    for (const id of batch.supersede ?? []) {
      const claim = claims.get(id);
      if (claim) claim.status = 'superseded';
    }
  }

  return {
    async list(filter) {
      const search = fold(filter.search.trim());
      const digits = filter.search.replace(/[.\-/\s]/g, '').toUpperCase();
      return [...companies.values()]
        .filter((company) => (filter.lifecycle ? company.lifecycle === filter.lifecycle : true))
        .filter(
          (company) =>
            filter.includeArchived ||
            filter.lifecycle === 'archived' ||
            company.lifecycle !== 'archived',
        )
        .filter((company) => {
          if (!search) return true;
          const text = fold(
            [company.displayName, company.legalName ?? '', company.primaryDomain ?? ''].join(' '),
          );
          return (
            text.includes(search) || (digits.length >= 4 && (company.cnpj ?? '').includes(digits))
          );
        })
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .slice(0, filter.limit)
        .map(clone);
    },

    async get(id) {
      const company = companies.get(id);
      return company ? clone(company) : null;
    },

    async findByStrongIdentifier(keys) {
      for (const key of keys) {
        const match = identifiers.find(
          (item) =>
            item.strength === 'strong' &&
            item.kind === key.kind &&
            item.valueNormalized === key.value,
        );
        if (match) return clone(companies.get(match.companyId) ?? null);
      }
      return null;
    },

    async identifiers(companyId) {
      return identifiers.filter((item) => item.companyId === companyId).map(clone);
    },

    async create(company, keys, batch, audit) {
      const duplicate =
        (company.cnpj !== null && [...companies.values()].some((c) => c.cnpj === company.cnpj)) ||
        (company.primaryDomain !== null &&
          [...companies.values()].some((c) => c.primaryDomain === company.primaryDomain)) ||
        keys.some((key) => key.strength === 'strong' && strongTaken(key.kind, key.valueNormalized));
      if (duplicate) throw new AppError('conflict', 'company_duplicate');
      checkBatch(batch);
      const at = now();
      const stored: Company = {
        id: company.id,
        displayName: company.displayName,
        legalName: company.legalName,
        cnpj: company.cnpj,
        cnpjRoot: company.cnpj ? company.cnpj.slice(0, 8) : null,
        primaryDomain: company.primaryDomain,
        city: company.city,
        uf: company.uf as Company['uf'],
        cnaeMain: company.cnaeMain,
        sizeBand: company.sizeBand,
        lifecycle: 'candidate',
        origin: company.origin,
        lastInvestigatedAt: company.lastInvestigatedAt,
        isDemo: company.isDemo,
        createdAt: at,
        updatedAt: at,
      };
      companies.set(stored.id, stored);
      for (const key of keys) {
        identifiers.push({
          id: newId(),
          companyId: stored.id,
          kind: key.kind,
          valueNormalized: key.valueNormalized,
          strength: key.strength,
          verified: key.verified,
          sourceId: null,
          createdAt: at,
        });
      }
      insertBatch(batch);
      await audited(audit, stored.id);
      return clone(stored);
    },

    async setLifecycle(id, lifecycle, audit) {
      const company = companies.get(id);
      if (!company) return false;
      company.lifecycle = lifecycle;
      company.updatedAt = now();
      await audited(audit, id);
      return true;
    },

    async record(companyId, patch, batch, audit) {
      if (batch.claims.length === 0) throw new AppError('validation', 'invalid_input');
      const company = companies.get(companyId);
      if (!company) throw new AppError('not_found', 'not_found');
      checkBatch(batch);
      insertBatch(batch);
      for (const [key, value] of Object.entries(patch)) {
        if (value !== undefined) (company as unknown as Record<string, unknown>)[key] = value;
      }
      company.updatedAt = now();
      await audited(audit, companyId);
    },

    async claimsFor(subjectType, subjectId, filter = {}) {
      return [...claims.values()]
        .filter((claim) => claim.subjectType === subjectType && claim.subjectId === subjectId)
        .filter((claim) => filter.includeSuperseded || claim.status !== 'superseded')
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .map(clone);
    },

    async claimsByIds(ids) {
      return ids.flatMap((id) => {
        const claim = claims.get(id);
        return claim ? [clone(claim)] : [];
      });
    },

    async evidenceFor(claimIds) {
      const wanted = new Set(claimIds);
      return evidence.filter((item) => wanted.has(item.claimId)).map(clone);
    },

    async sourcesByIds(ids) {
      return ids.flatMap((id) => {
        const source = sources.get(id);
        return source ? [clone(source)] : [];
      });
    },

    async dependenciesFor(claimIds) {
      const wanted = new Set(claimIds);
      return dependencies.filter((item) => wanted.has(item.claimId)).map(clone);
    },
  };
}
