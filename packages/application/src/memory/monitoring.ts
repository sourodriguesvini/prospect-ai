import { CompanyListFilter, ProspectListFilter, type FunnelStage } from '@prospector/contracts';
import { tallyDistinct, type StageTally } from '@prospector/domain';
import type { CompanyRepository } from '../ports/company-repository';
import type { DiscoveryRepository } from '../ports/discovery';
import type { InvestigationRepository } from '../ports/investigation';
import type {
  FunnelTallies,
  IntelligenceRepository,
  InvestigationChangeRow,
  MonitoringRepository,
} from '../ports/monitoring';
import type { RelationshipRepository } from '../ports/relationship-repository';

/**
 * Leituras do Monitoramento e da Inteligência em memória (ADR-0009, ADR-0017): montadas sobre as
 * portas dos outros módulos, com o mesmo resultado observável das consultas do banco. Servem ao
 * modo memória (telas e e2e) e aos testes de serviço. Os tetos imitam os do banco.
 */

/** Teto de empresas lidas (o maior que a porta de Empresas aceita). */
const COMPANY_LIMIT = 200;
/** Investigações lidas por empresa (o histórico do dossiê mostra 10). */
const INVESTIGATIONS_PER_COMPANY = 50;
/** Teto de empresas encontradas lidas da Descoberta (o maior que a porta aceita). */
const PROSPECT_LIMIT = 100;
const RELATIONSHIP_LIMIT = 500;

const FINISHED = new Set(['succeeded', 'partial']);

interface MemoryMonitoringParts {
  companies: Pick<CompanyRepository, 'list'>;
  investigations: Pick<InvestigationRepository, 'listForCompany'>;
}

async function allCompanies(parts: MemoryMonitoringParts) {
  const companies = await parts.companies.list(
    CompanyListFilter.parse({ includeArchived: true, limit: COMPANY_LIMIT }),
  );
  return { companies, capped: companies.length >= COMPANY_LIMIT };
}

async function allInvestigations(parts: MemoryMonitoringParts) {
  const { companies, capped } = await allCompanies(parts);
  const lists = await Promise.all(
    companies.map((company) =>
      parts.investigations.listForCompany(company.id, INVESTIGATIONS_PER_COMPANY),
    ),
  );
  return { companies, investigations: lists.flat(), capped };
}

export function createMemoryMonitoringRepository(
  parts: MemoryMonitoringParts,
): MonitoringRepository {
  return {
    async recentChanges(limit) {
      const { companies, investigations } = await allInvestigations(parts);
      const byId = new Map(companies.map((company) => [company.id, company]));
      const rows: InvestigationChangeRow[] = [];
      for (const item of investigations) {
        const company = byId.get(item.companyId);
        if (!company || !FINISHED.has(item.status) || !item.finishedAt) continue;
        if (item.changes.length === 0) continue;
        rows.push({
          investigationId: item.id,
          companyId: item.companyId,
          companyName: company.displayName,
          isDemo: item.isDemo || company.isDemo,
          companyArchived: company.lifecycle === 'archived',
          finishedAt: item.finishedAt,
          changes: item.changes,
        });
      }
      rows.sort(
        (a, b) =>
          b.finishedAt.localeCompare(a.finishedAt) ||
          a.investigationId.localeCompare(b.investigationId),
      );
      // Como no banco: as arquivadas vêm marcadas, mas não ocupam vaga no limite.
      const result: InvestigationChangeRow[] = [];
      let kept = 0;
      for (const row of rows) {
        if (kept >= Math.max(0, limit)) break;
        result.push(row);
        if (!row.companyArchived) kept += 1;
      }
      return result;
    },
  };
}

export function createMemoryIntelligenceRepository(
  parts: MemoryMonitoringParts & {
    discovery: Pick<DiscoveryRepository, 'listProspects'> | null;
    relationship: Pick<
      RelationshipRepository,
      'listOpportunities' | 'listPlans' | 'listInteractions'
    >;
  },
): IntelligenceRepository {
  const inPeriod = (at: string | null | undefined, since: string | null) => {
    if (!at) return false;
    if (since === null) return true;
    const time = Date.parse(at);
    return !Number.isNaN(time) && time >= Date.parse(since);
  };

  function interactionTally(
    rows: readonly { companyId: string; isDemo: boolean; direction: string; occurredAt: string }[],
    direction: 'outbound' | 'inbound',
    from: string | null,
    cap: boolean,
  ): StageTally {
    return tallyDistinct(
      rows
        .filter((row) => row.direction === direction && inPeriod(row.occurredAt, from))
        .map((row) => ({ companyId: row.companyId, isDemo: row.isDemo })),
      cap,
    );
  }

  return {
    async funnel(since) {
      const sinceIso = since === null ? null : new Date(since).toISOString();
      const [{ companies, investigations, capped }, prospects, opportunities, interactions] =
        await Promise.all([
          allInvestigations(parts),
          parts.discovery
            ? parts.discovery.listProspects(
                ProspectListFilter.parse({
                  includeDismissed: true,
                  firstSeenSince: sinceIso,
                  limit: PROSPECT_LIMIT,
                }),
              )
            : Promise.resolve([]),
          parts.relationship.listOpportunities({ includeClosed: true, limit: RELATIONSHIP_LIMIT }),
          parts.relationship.listInteractions({ limit: RELATIONSHIP_LIMIT }),
        ]);
      const plans = (
        await Promise.all(
          opportunities.map((opportunity) => parts.relationship.listPlans(opportunity.id)),
        )
      ).flat();
      const relationshipCapped =
        opportunities.length >= RELATIONSHIP_LIMIT || interactions.length >= RELATIONSHIP_LIMIT;

      const found: StageTally = {
        count: prospects.filter((item) => inPeriod(item.firstSeenAt, sinceIso)).length,
        demo: prospects.filter((item) => inPeriod(item.firstSeenAt, sinceIso) && item.isDemo)
          .length,
        capped: prospects.length >= PROSPECT_LIMIT,
      };
      const tallies: FunnelTallies = {
        found,
        saved: tallyDistinct(
          companies
            .filter((company) => inPeriod(company.createdAt, sinceIso))
            .map((company) => ({ companyId: company.id, isDemo: company.isDemo })),
          capped,
        ),
        investigated: tallyDistinct(
          investigations
            .filter((item) => FINISHED.has(item.status) && inPeriod(item.finishedAt, sinceIso))
            .map((item) => ({ companyId: item.companyId, isDemo: item.isDemo })),
          capped,
        ),
        approached: tallyDistinct(
          plans
            .filter((plan) => inPeriod(plan.createdAt, sinceIso))
            .map((plan) => ({ companyId: plan.companyId, isDemo: plan.isDemo })),
          relationshipCapped,
        ),
        contacted: interactionTally(interactions, 'outbound', sinceIso, relationshipCapped),
        replied: interactionTally(interactions, 'inbound', sinceIso, relationshipCapped),
        won: tallyDistinct(
          opportunities
            .filter((item) => item.stage === 'won' && inPeriod(item.closedAt, sinceIso))
            .map((item) => ({ companyId: item.companyId, isDemo: item.isDemo })),
          relationshipCapped,
        ),
      } satisfies Record<FunnelStage, StageTally>;
      return tallies;
    },

    // O modo memória não registra custo em dinheiro: a IA é local e a busca fica desligada sem
    // banco (ADR-0012). Zero aqui é o que de fato foi gasto.
    async moneySpent() {
      return { usdMicros: 0, capped: false };
    },
  };
}
