import {
  IntelligenceOverview,
  MonitoringOverview,
  type Company,
  type CompanyInvestigationSummary,
  type DiscoveryMonitor,
  type DiscoveryRun,
  type InvestigationChange,
} from '@prospector/contracts';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  calendarMonthStart,
  compareMonitorsForFeed,
  createIntelligenceService,
  createMonitoringService,
  type AiUsageSummary,
  type IntelligenceRepository,
  type MonitoringServiceDeps,
  type PendingAudit,
  type RequestContext,
} from '../src';
import {
  createMemoryAuditRepository,
  createMemoryCompanyRepository,
  createMemoryIntelligenceRepository,
  createMemoryInvestigationRepository,
  createMemoryMonitoringRepository,
  createMemoryRelationshipRepository,
} from '../src/memory';

/** Dados SINTÉTICOS: empresas, ids e buscas de teste; nada aqui é empresa real. */
const ctx: RequestContext = {
  actor: { type: 'user' },
  traceId: '0b7c6d3e-4f2a-4b8c-9d1e-2f3a4b5c6d7e',
};

const AUDIT: PendingAudit = {
  actorType: 'system',
  actorLabel: 'teste',
  traceId: ctx.traceId,
  action: 'teste.registro',
  entityType: 'teste',
  entityId: null,
  diff: {},
  withVersion: false,
};

let sequence = 0;
const uuid = () => {
  sequence += 1;
  return `00000000-0000-4000-8000-${sequence.toString(16).padStart(12, '0')}`;
};

function company(overrides: Partial<Company> = {}): Company {
  return {
    id: uuid(),
    displayName: 'Empresa Sintética',
    legalName: null,
    cnpj: null,
    cnpjRoot: null,
    primaryDomain: null,
    city: null,
    uf: null,
    cnaeMain: null,
    sizeBand: null,
    lifecycle: 'candidate',
    origin: 'manual',
    lastInvestigatedAt: null,
    isDemo: false,
    createdAt: '2026-11-01T12:00:00.000Z',
    updatedAt: '2026-11-01T12:00:00.000Z',
    ...overrides,
  };
}

function summary(
  companyId: string,
  overrides: Partial<CompanyInvestigationSummary> = {},
): CompanyInvestigationSummary {
  return {
    companyId,
    investigationId: uuid(),
    status: 'succeeded',
    finishedAt: '2026-11-10T12:00:00.000Z',
    updatedAt: '2026-11-10T12:00:00.000Z',
    recommendation: 'monitor',
    recommendedOfferName: null,
    priority: 50,
    ...overrides,
  };
}

const change = (kind: InvestigationChange['kind']): InvestigationChange => ({
  kind,
  text: 'Texto montado pelo sistema.',
  claimIds: [],
});

function monitor(overrides: Partial<DiscoveryMonitor> = {}): DiscoveryMonitor {
  return {
    id: uuid(),
    name: 'Busca recorrente de teste',
    request: 'clínicas odontológicas em Curitiba',
    frequency: 'weekly',
    status: 'active',
    maxSearches: 2,
    maxProspects: 10,
    icpId: null,
    nextRunAt: null,
    lastRunAt: null,
    lastRunId: null,
    missedRuns: 0,
    isDemo: false,
    createdAt: '2026-11-01T12:00:00.000Z',
    updatedAt: '2026-11-01T12:00:00.000Z',
    ...overrides,
  };
}

/** Só os campos que o serviço lê; o resto da execução não importa para o feed. */
function run(monitorId: string, overrides: Partial<DiscoveryRun> = {}): DiscoveryRun {
  return {
    id: uuid(),
    monitorId,
    status: 'completed',
    isDemo: false,
    createdAt: '2026-11-24T08:00:00.000Z',
    finishedAt: '2026-11-24T08:05:00.000Z',
    progress: {
      searchesPlanned: 2,
      searchesDone: 2,
      creditsUsed: 2,
      pagesRead: 4,
      prospects: 5,
      newProspects: 3,
      signals: 1,
    },
    ...overrides,
  } as DiscoveryRun;
}

describe('MonitoringService (ADR-0017)', () => {
  const now = new Date('2026-11-25T15:00:00.000Z');

  function service(
    overrides: Omit<Partial<MonitoringServiceDeps>, 'companies'> & { companies?: Company[] } = {},
  ) {
    const { companies = [], ...rest } = overrides;
    return createMonitoringService({
      repo: { recentChanges: async () => [] },
      investigations: { summaries: async () => [] },
      discovery: null,
      clock: { now: () => now },
      ...rest,
      companies: { list: async () => companies },
    });
  }

  it('lista pela recomendação: vencidas primeiro, descartadas e não investigadas fora', async () => {
    const overdue = company({
      displayName: 'Vencida',
      lastInvestigatedAt: '2026-11-10T12:00:00.000Z',
    });
    const fresh = company({
      displayName: 'Em dia',
      lastInvestigatedAt: '2026-11-20T12:00:00.000Z',
    });
    const running = company({
      displayName: 'Rodando',
      lastInvestigatedAt: '2026-11-01T12:00:00.000Z',
    });
    const discarded = company({
      displayName: 'Descartada',
      lastInvestigatedAt: '2026-11-20T12:00:00.000Z',
    });
    const never = company({ displayName: 'Nunca investigada' });
    const overview = await service({
      companies: [fresh, discarded, never, running, overdue],
      investigations: {
        summaries: async () => [
          summary(overdue.id, { recommendation: 'pursue', priority: 80 }),
          summary(fresh.id, {
            recommendation: 'monitor',
            finishedAt: '2026-11-20T12:00:00.000Z',
          }),
          summary(running.id, { recommendation: 'monitor', status: 'running' }),
          summary(discarded.id, {
            recommendation: 'discard',
            finishedAt: '2026-11-20T12:00:00.000Z',
          }),
        ],
      },
    }).overview(ctx);

    expect(MonitoringOverview.safeParse(overview).success).toBe(true);
    expect(overview.watchlist.map((item) => [item.companyName, item.state, item.cadence])).toEqual([
      ['Vencida', 'due', 'weekly'],
      ['Rodando', 'running', 'monthly'],
      ['Em dia', 'upcoming', 'monthly'],
    ]);
    expect(overview.watchlist[0]).toMatchObject({ days: 8, priority: 80 });
    expect(overview.excludedDiscarded).toBe(1);
    expect(overview.notInvestigated).toBe(1);
    expect(overview.truncated).toBe(false);
    expect(overview.discovery).toBe('off');
    expect(overview.companyChanges).toBe('included');
    expect(overview.feedTruncated).toBe(false);
  });

  it('o prazo conta da última investigação concluída, não da data gravada na empresa', async () => {
    // `last_investigated_at` também muda quando o CNPJ é consultado: não pode adiar o prazo.
    const touched = company({ lastInvestigatedAt: '2026-11-24T12:00:00.000Z' });
    // Investigação nova que falhou: vale a data da empresa, como antes.
    const failed = company({ lastInvestigatedAt: '2026-11-24T12:00:00.000Z' });
    const overview = await service({
      companies: [touched, failed],
      investigations: {
        summaries: async () => [
          summary(touched.id, { recommendation: 'pursue', finishedAt: '2026-11-10T12:00:00.000Z' }),
          summary(failed.id, {
            recommendation: 'pursue',
            status: 'failed',
            finishedAt: '2026-11-24T13:00:00.000Z',
          }),
        ],
      },
    }).overview(ctx);
    const byId = new Map(overview.watchlist.map((item) => [item.companyId, item]));
    expect(byId.get(touched.id)).toMatchObject({
      state: 'due',
      lastInvestigatedAt: '2026-11-10T12:00:00.000Z',
    });
    expect(byId.get(failed.id)).toMatchObject({
      state: 'upcoming',
      lastInvestigatedAt: '2026-11-24T12:00:00.000Z',
    });
  });

  it('feed único: mudanças das empresas e novidades das buscas recorrentes', async () => {
    const watched = company({ displayName: 'Acompanhada' });
    const recurring = monitor({ name: 'Clínicas em Curitiba' });
    const overview = await service({
      repo: {
        recentChanges: async () => [
          {
            investigationId: uuid(),
            companyId: watched.id,
            companyName: watched.displayName,
            isDemo: false,
            companyArchived: false,
            finishedAt: '2026-11-23T10:00:00.000Z',
            changes: [change('offering_added'), change('temporarily_unavailable')],
          },
          {
            investigationId: uuid(),
            companyId: uuid(),
            companyName: 'Arquivada',
            isDemo: false,
            companyArchived: true,
            finishedAt: '2026-11-24T10:00:00.000Z',
            changes: [change('site_changed')],
          },
        ],
      },
      discovery: {
        listMonitors: async () => [recurring],
        listRuns: async (_ctx, options) => [
          run(options?.monitorId ?? ''),
          run(options?.monitorId ?? '', {
            progress: {
              searchesPlanned: 1,
              searchesDone: 1,
              creditsUsed: 1,
              pagesRead: 0,
              prospects: 2,
              newProspects: 0,
              signals: 0,
            },
          }),
          run(options?.monitorId ?? '', { status: 'running', finishedAt: null }),
        ],
      },
    }).overview(ctx);

    expect(overview.discovery).toBe('included');
    expect(overview.feed.map((item) => item.kind)).toEqual(['discovery_novelty', 'company_change']);
    const novelty = overview.feed[0];
    expect(novelty).toMatchObject({ monitorName: 'Clínicas em Curitiba', newCompanies: 3 });
    const changed = overview.feed[1];
    expect(changed?.kind === 'company_change' && changed.changes).toHaveLength(1);
    expect(changed?.kind === 'company_change' && changed.unavailable).toHaveLength(1);
  });

  it('falha na leitura da Descoberta não derruba o feed das empresas', async () => {
    const overview = await service({
      discovery: {
        listMonitors: async () => {
          throw new Error('banco fora do ar');
        },
        listRuns: async () => [],
      },
    }).overview(ctx);
    expect(overview.discovery).toBe('unavailable');
    expect(overview.feed).toEqual([]);
  });

  it('falha na leitura das mudanças não derruba a lista de acompanhamento', async () => {
    const watched = company({ lastInvestigatedAt: '2026-11-10T12:00:00.000Z' });
    const overview = await service({
      companies: [watched],
      repo: {
        recentChanges: async () => {
          throw new Error('banco fora do ar');
        },
      },
      investigations: { summaries: async () => [summary(watched.id)] },
    }).overview(ctx);
    expect(overview.companyChanges).toBe('unavailable');
    expect(overview.feed).toEqual([]);
    expect(overview.watchlist).toHaveLength(1);
  });

  it('avisa quando há mais novidades do que o feed mostra', async () => {
    const limits: number[] = [];
    const rows = Array.from({ length: 61 }, (_, index) => ({
      investigationId: uuid(),
      companyId: uuid(),
      companyName: `Empresa Sintética ${index}`,
      isDemo: false,
      companyArchived: false,
      finishedAt: new Date(Date.UTC(2026, 10, 1, 0, index)).toISOString(),
      changes: [change('site_changed')],
    }));
    const overview = await service({
      repo: {
        recentChanges: async (limit) => {
          limits.push(limit);
          return rows.slice(0, limit);
        },
      },
    }).overview(ctx);
    expect(limits).toEqual([61]);
    expect(overview.feed).toHaveLength(60);
    expect(overview.feedTruncated).toBe(true);

    const exact = await service({
      repo: { recentChanges: async () => rows.slice(0, 60) },
    }).overview(ctx);
    expect(exact.feedTruncated).toBe(false);
  });

  it('teto das buscas recorrentes: ativas e pausadas antes das arquivadas, as mais recentes primeiro', () => {
    const archivedRecent = monitor({ status: 'archived', lastRunAt: '2026-11-24T10:00:00.000Z' });
    const activeOld = monitor({ status: 'active', lastRunAt: '2026-10-01T10:00:00.000Z' });
    const activeNew = monitor({ status: 'active', lastRunAt: '2026-11-20T10:00:00.000Z' });
    const activeNever = monitor({ status: 'active', lastRunAt: null });
    const paused = monitor({ status: 'paused', lastRunAt: '2026-11-23T10:00:00.000Z' });
    const sorted = [archivedRecent, activeNever, paused, activeOld, activeNew].sort(
      compareMonitorsForFeed,
    );
    expect(sorted).toEqual([activeNew, activeOld, activeNever, paused, archivedRecent]);
  });

  it('avisa quando a leitura das empresas chegou ao teto', async () => {
    const many = Array.from({ length: 200 }, () => company());
    const overview = await service({ companies: many }).overview(ctx);
    expect(overview.truncated).toBe(true);
    expect(overview.notInvestigated).toBe(200);
  });
});

describe('IntelligenceService (ADR-0017)', () => {
  const usage: AiUsageSummary = {
    since: '2026-11-01T03:00:00.000Z',
    generations: 12,
    failed: 1,
    cancelled: 0,
    outputTokens: 3400,
    totalMs: 52_000,
    byModel: [
      { model: 'modelo-b', generations: 2, outputTokens: 400 },
      { model: 'modelo-a', generations: 10, outputTokens: 3000 },
    ],
    toolCalls: 4,
    toolErrors: 0,
    capped: false,
  };
  const repo = (since: Array<string | null>): IntelligenceRepository => ({
    async funnel(value) {
      since.push(value);
      return {
        found: { count: 30, demo: 0, capped: false },
        saved: { count: 6, demo: 1, capped: false },
        investigated: { count: 3, demo: 0, capped: false },
        approached: { count: 1, demo: 0, capped: false },
        contacted: { count: 0, demo: 0, capped: false },
        replied: { count: 0, demo: 0, capped: false },
        won: { count: 0, demo: 0, capped: false },
      };
    },
    async moneySpent() {
      return { usdMicros: 0, capped: false };
    },
  });

  it('início do mês no fuso da agência (Brasília), mesmo de madrugada em UTC', () => {
    expect(calendarMonthStart(new Date('2026-12-01T02:00:00.000Z')).toISOString()).toBe(
      '2026-11-01T03:00:00.000Z',
    );
    expect(calendarMonthStart(new Date('2026-12-01T03:00:00.000Z')).toISOString()).toBe(
      '2026-12-01T03:00:00.000Z',
    );
  });

  it('funil do mês com amostra, consumo da IA local e da Tavily', async () => {
    const seen: Array<string | null> = [];
    const overview = await createIntelligenceService({
      repo: repo(seen),
      telemetry: { usageSince: async () => usage },
      research: {
        status: async () => ({
          search: 'enabled',
          pageReader: 'enabled',
          usage: {
            period: '2026-11',
            provider: 'tavily',
            creditsUsed: 40,
            creditsBudget: 900,
            creditsRemaining: 860,
          },
        }),
      },
      clock: { now: () => new Date('2026-11-25T15:00:00.000Z') },
    }).overview(ctx);

    expect(IntelligenceOverview.safeParse(overview).success).toBe(true);
    expect(seen).toEqual(['2026-11-01T03:00:00.000Z']);
    expect(overview.period).toBe('month');
    expect(overview.funnel[1]).toMatchObject({ count: 6, shareOfPrevious: 0.2, reliability: 'ok' });
    expect(overview.funnel[2]).toMatchObject({ reliability: 'small' });
    expect(overview.ai?.byModel.map((row) => row.model)).toEqual(['modelo-a', 'modelo-b']);
    expect(overview.search).toEqual({
      state: 'enabled',
      usage: {
        period: '2026-11',
        creditsUsed: 40,
        creditsBudget: 900,
        creditsRemaining: 860,
        freeQuota: 1000,
      },
    });
    expect(overview.money).toEqual({ usdMicros: 0, capped: false });
  });

  it('"desde o início" sem data; período desconhecido volta para o mês', async () => {
    const seen: Array<string | null> = [];
    const service = createIntelligenceService({
      repo: repo(seen),
      telemetry: { usageSince: async () => usage },
      research: null,
      clock: { now: () => new Date('2026-11-25T15:00:00.000Z') },
    });
    const all = await service.overview(ctx, { period: 'all' });
    expect(all.since).toBeNull();
    expect(all.search).toEqual({ state: 'disabled', usage: null });
    const fallback = await service.overview(ctx, { period: 'semana' });
    expect(fallback.period).toBe('month');
    expect(seen).toEqual([null, '2026-11-01T03:00:00.000Z']);
  });

  it('consumo ilegível vira null sem esconder o funil; falha no funil sobe', async () => {
    const overview = await createIntelligenceService({
      repo: {
        ...repo([]),
        moneySpent: async () => {
          throw new Error('fora do ar');
        },
      },
      telemetry: {
        usageSince: async () => {
          throw new Error('fora do ar');
        },
      },
      research: {
        status: async () => {
          throw new Error('fora do ar');
        },
      },
    }).overview(ctx);
    expect(overview.ai).toBeNull();
    expect(overview.money).toBeNull();
    expect(overview.search.usage).toBeNull();
    expect(overview.funnel[0]?.count).toBe(30);

    await expect(
      createIntelligenceService({
        repo: {
          ...repo([]),
          funnel: async () => {
            throw new Error('fora do ar');
          },
        },
        telemetry: { usageSince: async () => usage },
        research: null,
      }).overview(ctx),
    ).rejects.toThrow('fora do ar');
  });
});

describe('leituras em memória do Monitoramento e da Inteligência', () => {
  let now: Date;
  const clock = { now: () => now };
  let companies: ReturnType<typeof createMemoryCompanyRepository>;
  let investigations: ReturnType<typeof createMemoryInvestigationRepository>;
  let relationship: ReturnType<typeof createMemoryRelationshipRepository>;

  beforeEach(() => {
    now = new Date('2026-11-25T15:00:00.000Z');
    const audit = createMemoryAuditRepository({ clock });
    companies = createMemoryCompanyRepository({ audit, clock });
    investigations = createMemoryInvestigationRepository({ audit, companies, clock });
    relationship = createMemoryRelationshipRepository({ audit, companies, clock });
  });

  async function addCompany(name: string, isDemo = false) {
    return companies.create(
      {
        id: uuid(),
        displayName: name,
        legalName: null,
        cnpj: null,
        primaryDomain: null,
        city: null,
        uf: null,
        cnaeMain: null,
        sizeBand: null,
        origin: 'manual',
        lastInvestigatedAt: null,
        isDemo,
      },
      [],
      { sources: [], claims: [], evidence: [] },
      AUDIT,
    );
  }

  async function investigate(
    companyId: string,
    finishedAt: string,
    changes: InvestigationChange[],
    previousId: string | null,
    isDemo = false,
  ) {
    // Como no serviço: investigação de empresa de demonstração também é demonstração.
    const created = await investigations.create(
      {
        id: uuid(),
        companyId,
        trigger: 'user',
        pipelineVersion: 1,
        steps: [],
        previousId,
        isDemo,
      },
      AUDIT,
    );
    await investigations.updateAudited(
      created.id,
      { status: 'succeeded', finishedAt, changes, startedAt: finishedAt },
      AUDIT,
    );
    return created.id;
  }

  it('mudanças recentes: só concluídas com mudança, mais novas primeiro', async () => {
    const a = await addCompany('Empresa Sintética A');
    const b = await addCompany('Empresa Sintética B', true);
    const first = await investigate(a.id, '2026-11-01T10:00:00.000Z', [], null);
    await investigate(a.id, '2026-11-20T10:00:00.000Z', [change('visual_changed')], first);
    const firstB = await investigate(b.id, '2026-11-02T10:00:00.000Z', [], null);
    await investigate(b.id, '2026-11-22T10:00:00.000Z', [change('new_signal')], firstB);

    const rows = await createMemoryMonitoringRepository({
      companies,
      investigations,
    }).recentChanges(10);
    expect(rows.map((row) => [row.companyName, row.isDemo, row.changes[0]?.kind])).toEqual([
      ['Empresa Sintética B', true, 'new_signal'],
      ['Empresa Sintética A', false, 'visual_changed'],
    ]);
  });

  it('mudanças recentes: empresa arquivada vem marcada e não ocupa vaga no limite', async () => {
    const kept = await addCompany('Empresa Sintética Ativa');
    const archived = await addCompany('Empresa Sintética Arquivada');
    const first = await investigate(kept.id, '2026-11-01T10:00:00.000Z', [], null);
    await investigate(kept.id, '2026-11-20T10:00:00.000Z', [change('visual_changed')], first);
    const firstArchived = await investigate(archived.id, '2026-11-02T10:00:00.000Z', [], null);
    await investigate(
      archived.id,
      '2026-11-22T10:00:00.000Z',
      [change('new_signal')],
      firstArchived,
    );
    await companies.setLifecycle(archived.id, 'archived', AUDIT);

    const rows = await createMemoryMonitoringRepository({
      companies,
      investigations,
    }).recentChanges(1);
    expect(rows.map((row) => [row.companyName, row.companyArchived])).toEqual([
      ['Empresa Sintética Arquivada', true],
      ['Empresa Sintética Ativa', false],
    ]);
  });

  it('funil: empresas distintas por etapa no período, com demonstração separada', async () => {
    now = new Date('2026-10-20T12:00:00.000Z');
    const old = await addCompany('Antiga');
    now = new Date('2026-11-05T12:00:00.000Z');
    const recent = await addCompany('Recente', true);
    await investigate(old.id, '2026-10-21T10:00:00.000Z', [], null);
    await investigate(recent.id, '2026-11-06T10:00:00.000Z', [], null, true);
    await investigate(recent.id, '2026-11-07T10:00:00.000Z', [], null, true);

    const repo = createMemoryIntelligenceRepository({
      companies,
      investigations,
      discovery: null,
      relationship,
    });
    const month = await repo.funnel('2026-11-01T03:00:00.000Z');
    expect(month.saved).toEqual({ count: 1, demo: 1, capped: false });
    expect(month.investigated).toEqual({ count: 1, demo: 1, capped: false });
    expect(month.found.count).toBe(0);
    const all = await repo.funnel(null);
    expect(all.saved).toEqual({ count: 2, demo: 1, capped: false });
    expect(all.investigated).toEqual({ count: 2, demo: 1, capped: false });
    expect(await repo.moneySpent('2026-11-01T03:00:00.000Z')).toEqual({
      usdMicros: 0,
      capped: false,
    });
  });
});
