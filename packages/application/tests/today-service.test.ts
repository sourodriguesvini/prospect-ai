import type {
  AttentionItem,
  Company,
  CompanyInvestigationSummary,
  DiscoveryRun,
  WatchItem,
} from '@prospector/contracts';
import { describe, expect, it } from 'vitest';
import {
  createTodayService,
  type ApprovalQueue,
  type ProspectView,
  type RelationshipOverview,
  type RequestContext,
  type TodayServiceDeps,
} from '../src';

/** Dados SINTÉTICOS: ids e nomes de teste; nada aqui é empresa real. */
const ctx: RequestContext = {
  actor: { type: 'user' },
  traceId: '0b7c6d3e-4f2a-4b8c-9d1e-2f3a4b5c6d7e',
};
const NOW = new Date('2026-11-26T12:00:00.000Z');
const clock = { now: () => NOW };

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function company(n: number, overrides: Partial<Company> = {}): Company {
  return {
    id: id(n),
    displayName: `Empresa Teste ${n}`,
    lifecycle: 'qualified',
    isDemo: false,
    ...overrides,
  } as Company;
}

function summary(
  n: number,
  overrides: Partial<CompanyInvestigationSummary> = {},
): CompanyInvestigationSummary {
  return {
    companyId: id(n),
    investigationId: id(100 + n),
    status: 'succeeded',
    finishedAt: '2026-11-25T10:00:00.000Z',
    updatedAt: '2026-11-25T10:00:00.000Z',
    recommendation: 'pursue',
    recommendedOfferName: 'Identidade visual',
    priority: 70,
    ...overrides,
  };
}

function attention(kind: AttentionItem['kind'], n: number): AttentionItem {
  return {
    kind,
    opportunityId: id(200 + n),
    companyId: id(n),
    companyName: `Empresa Teste ${n}`,
    detail: 'detalhe',
    at: '2026-11-25T10:00:00.000Z',
    rank: 1,
    isDemo: false,
  } as AttentionItem;
}

function run(n: number, overrides: Partial<DiscoveryRun> = {}): DiscoveryRun {
  return {
    id: id(300 + n),
    request: `pesquisa ${n}`,
    status: 'completed',
    progress: {
      searchesPlanned: 3,
      searchesDone: 3,
      creditsUsed: 0,
      pagesRead: 4,
      prospects: 5,
      newProspects: 2,
      signals: 1,
    },
    isDemo: false,
    createdAt: '2026-11-25T09:00:00.000Z',
    startedAt: '2026-11-25T09:00:00.000Z',
    finishedAt: '2026-11-25T09:10:00.000Z',
    ...overrides,
  } as DiscoveryRun;
}

function overview(overrides: Partial<RelationshipOverview> = {}): RelationshipOverview {
  return {
    opportunities: [],
    attention: [],
    byStage: {},
    openCount: 0,
    draftsToReview: 0,
    tasksOverdue: 0,
    tasksToday: 0,
    valueWithBasisCents: 0,
    valuedCount: 0,
    readAt: NOW.toISOString(),
    ...overrides,
  } as RelationshipOverview;
}

function deps(overrides: Partial<TodayServiceDeps> = {}): TodayServiceDeps {
  return {
    relationship: {
      overview: async () => overview(),
      approvalQueue: async () =>
        ({ pending: [], recent: [], compliance: { ready: true, missing: [] } }) as never,
      suppressionsOf: async () => new Map(),
      listOpportunities: async () => [],
    },
    companies: { list: async () => [] },
    investigations: { summaries: async () => [] },
    discovery: { listRuns: async () => [], opportunities: async () => [] },
    monitoring: null,
    clock,
    ...overrides,
  };
}

describe('TodayService', () => {
  it('sem nada pendente, todas as listas vêm vazias e nada fica indisponível', async () => {
    const today = await createTodayService(deps()).overview(ctx);
    expect(today.unavailable).toEqual([]);
    for (const key of [
      'readyToApproach',
      'replies',
      'drafts',
      'approved',
      'followUps',
      'finishedSearches',
      'newOpportunities',
      'toReview',
      'runningAnalyses',
      'runningSearches',
    ] as const) {
      expect(today[key]).toEqual({ items: [], total: 0 });
    }
    expect(today.pipeline).toEqual({ openCount: 0, valueWithBasisCents: 0, valuedCount: 0 });
  });

  it('prontas para abordar: só análise concluída com recomendação de abordar e sem conversa aberta', async () => {
    const companies = [
      company(1),
      company(2),
      company(3),
      company(4),
      company(5, { lifecycle: 'customer' }),
      company(6),
      company(7),
    ];
    const summaries = [
      summary(1, { recommendation: 'prepare_access', finishedAt: '2026-11-26T09:00:00.000Z' }),
      summary(2, { recommendation: 'pursue', finishedAt: '2026-11-20T09:00:00.000Z' }),
      summary(3, { recommendation: 'monitor' }),
      summary(4, { recommendation: 'pursue' }),
      summary(5, { recommendation: 'pursue' }),
      summary(6, {
        status: 'running',
        recommendation: null,
        updatedAt: '2026-11-26T11:00:00.000Z',
      }),
      summary(7, { status: 'failed', recommendation: null }),
    ];
    const service = createTodayService(
      deps({
        companies: { list: async () => companies },
        investigations: { summaries: async () => summaries },
        relationship: {
          overview: async () =>
            overview({
              opportunities: [{ companyId: id(4) }] as RelationshipOverview['opportunities'],
            }),
          approvalQueue: async () => ({ pending: [], recent: [] }) as never,
          suppressionsOf: async () => new Map(),
          listOpportunities: async () => [],
        },
      }),
    );
    const today = await service.overview(ctx);
    // "Abordar agora" primeiro; a 3 é "acompanhar", a 4 já está em conversa, a 5 é cliente.
    expect(today.readyToApproach.items.map((item) => item.companyId)).toEqual([id(2), id(1)]);
    expect(today.readyToApproach.items[0]?.offerName).toBe('Identidade visual');
    expect(today.runningAnalyses.items.map((item) => item.companyId)).toEqual([id(6)]);
    expect(today.runningAnalyses.items[0]?.status).toBe('running');
  });

  it('prontas para abordar: nunca quem pediu para não ser contatado nem quem já teve conversa', async () => {
    const companies = [company(1), company(2), company(3), company(4)];
    const summaries = [1, 2, 3, 4].map((n) => summary(n, { recommendation: 'pursue' }));
    const asked: string[] = [];
    const service = createTodayService(
      deps({
        companies: { list: async () => companies },
        investigations: { summaries: async () => summaries },
        relationship: {
          overview: async () => overview(),
          approvalQueue: async () => ({ pending: [], recent: [] }) as never,
          // A 1 pediu opt-out (pode ter vindo pela raiz do CNPJ ou pelo domínio: o serviço resolve).
          suppressionsOf: async (_ctx, list) => {
            asked.push(...list.map((item) => item.id));
            return new Map([[id(1), [{ reason: 'opt_out' }]]]) as never;
          },
          // A 2 teve uma conversa encerrada.
          listOpportunities: async (_ctx, filter) => {
            expect(filter).toEqual({ includeClosed: true });
            return [{ companyId: id(2), closedAt: '2026-11-20T00:00:00.000Z' }] as never;
          },
        },
      }),
    );
    const today = await service.overview(ctx);
    expect(asked.sort()).toEqual([id(1), id(2), id(3), id(4)]);
    expect(today.readyToApproach.items.map((item) => item.companyId).sort()).toEqual([
      id(3),
      id(4),
    ]);
  });

  it('sem conseguir conferir o opt-out, não recomenda abordar ninguém', async () => {
    const service = createTodayService(
      deps({
        companies: { list: async () => [company(1)] },
        investigations: { summaries: async () => [summary(1, { recommendation: 'pursue' })] },
        log: () => undefined,
        relationship: {
          overview: async () => overview(),
          approvalQueue: async () => ({ pending: [], recent: [] }) as never,
          suppressionsOf: async () => {
            throw new Error('fora do ar');
          },
          listOpportunities: async () => [],
        },
      }),
    );
    const today = await service.overview(ctx);
    expect(today.readyToApproach.total).toBe(0);
    expect(today.unavailable).toContain('relationship');
  });

  it('a última atualização falhou: continua valendo a recomendação da análise anterior', async () => {
    const service = createTodayService(
      deps({
        companies: { list: async () => [company(1)] },
        investigations: {
          summaries: async () => [summary(1, { status: 'cancelled', recommendation: 'pursue' })],
        },
      }),
    );
    const today = await service.overview(ctx);
    expect(today.readyToApproach.items.map((item) => item.companyId)).toEqual([id(1)]);
  });

  it('separa respostas, rascunhos e follow-ups do Relacionamento', async () => {
    const service = createTodayService(
      deps({
        relationship: {
          overview: async () =>
            overview({
              openCount: 3,
              valueWithBasisCents: 1_500_000,
              valuedCount: 1,
              attention: [
                attention('reply_waiting_us', 1),
                attention('draft_to_review', 2),
                attention('task_overdue', 3),
                attention('task_due_today', 4),
                attention('awaiting_their_reply', 5),
                attention('stale', 6),
              ],
            }),
          approvalQueue: async () => ({ pending: [], recent: [] }) as never,
          suppressionsOf: async () => new Map(),
          listOpportunities: async () => [],
        },
      }),
    );
    const today = await service.overview(ctx);
    expect(today.replies.items.map((item) => item.companyId)).toEqual([id(1)]);
    expect(today.drafts.items.map((item) => item.companyId)).toEqual([id(2)]);
    expect(today.followUps.items.map((item) => item.kind)).toEqual([
      'task_overdue',
      'task_due_today',
      'awaiting_their_reply',
    ]);
    expect(today.pipeline).toEqual({
      openCount: 3,
      valueWithBasisCents: 1_500_000,
      valuedCount: 1,
    });
  });

  it('aprovadas: só as que ainda valem, em conversa aberta, a que vence antes primeiro', async () => {
    const entry = (
      n: number,
      problems: string[],
      expiresAt: string,
      closedAt: string | null = null,
    ) => ({
      approval: { id: id(400 + n), channel: 'email', expiresAt },
      message: { id: id(500 + n) },
      opportunity: {
        id: id(200 + n),
        companyId: id(n),
        companyName: `Empresa Teste ${n}`,
        companyIsDemo: false,
        closedAt,
      },
      problems,
    });
    const service = createTodayService(
      deps({
        relationship: {
          overview: async () => overview(),
          approvalQueue: async () =>
            ({
              pending: [],
              recent: [
                entry(1, [], '2026-11-30T00:00:00.000Z'),
                entry(2, ['used'], '2026-11-30T00:00:00.000Z'),
                entry(3, [], '2026-11-28T00:00:00.000Z'),
                entry(4, [], '2026-11-28T00:00:00.000Z', '2026-11-25T00:00:00.000Z'),
              ],
            }) as unknown as ApprovalQueue,
          suppressionsOf: async () => new Map(),
          listOpportunities: async () => [],
        },
      }),
    );
    const today = await service.overview(ctx);
    expect(today.approved.items.map((item) => item.companyId)).toEqual([id(3), id(1)]);
  });

  it('pesquisas: concluídas nos últimos 7 dias com empresas novas; em andamento à parte', async () => {
    const runs = [
      run(1, { finishedAt: '2026-11-26T08:00:00.000Z' }),
      run(2, { finishedAt: '2026-11-10T08:00:00.000Z' }),
      run(3, { progress: { ...run(3).progress, newProspects: 0 } }),
      run(4, { status: 'failed' }),
      run(5, { status: 'running', finishedAt: null }),
    ];
    const service = createTodayService(
      deps({ discovery: { listRuns: async () => runs, opportunities: async () => [] } }),
    );
    const today = await service.overview(ctx);
    expect(today.finishedSearches.items.map((item) => item.runId)).toEqual([id(301)]);
    expect(today.runningSearches.items.map((item) => item.runId)).toEqual([id(305)]);
  });

  it('novas oportunidades trazem o motivo (sem sinal confirmado, o primeiro) e o lugar', async () => {
    const view = {
      prospect: {
        id: id(600),
        displayName: 'Doceria Lua Cheia',
        segment: 'Confeitaria',
        city: 'Curitiba',
        uf: 'PR',
        priority: 'high',
        isDemo: true,
        assessment: { reasons: [{ text: 'Abriu a segunda loja', sourceIds: [] }] },
      },
      signals: [],
      sources: {},
      isNew: null,
    } as unknown as ProspectView;
    const service = createTodayService(
      deps({ discovery: { listRuns: async () => [], opportunities: async () => [view] } }),
    );
    const [first] = (await service.overview(ctx)).newOpportunities.items;
    expect(first).toEqual({
      prospectId: id(600),
      name: 'Doceria Lua Cheia',
      segment: 'Confeitaria',
      place: 'Curitiba/PR',
      priority: 'high',
      reason: 'Abriu a segunda loja',
      isDemo: true,
    });
  });

  it('o motivo de uma oportunidade é o sinal confirmado, não uma lacuna da triagem', async () => {
    const opportunity = (signals: unknown[], reasons: unknown[]) =>
      ({
        prospect: {
          id: id(601),
          displayName: 'Café Serra Alta',
          segment: null,
          city: null,
          uf: null,
          priority: 'high',
          isDemo: true,
          assessment: { reasons },
        },
        signals,
        sources: {},
        isNew: null,
      }) as unknown as ProspectView;
    const gap = { text: 'Falta confirmar o segmento.', sourceIds: [] };
    const sourced = { text: 'Fica em Curitiba/PR, na região pedida.', sourceIds: [id(1)] };
    const reasonOf = async (view: ProspectView) => {
      const service = createTodayService(
        deps({ discovery: { listRuns: async () => [], opportunities: async () => [view] } }),
      );
      return (await service.overview(ctx)).newOpportunities.items[0]?.reason;
    };
    const signals = [
      { verification: 'hypothesis', summary: 'Talvez abra outra loja.' },
      { verification: 'confirmed', summary: 'Começou a vender em supermercados.' },
    ];
    expect(await reasonOf(opportunity(signals, [gap, sourced]))).toBe(
      'Começou a vender em supermercados.',
    );
    expect(await reasonOf(opportunity([], [gap, sourced]))).toBe(sourced.text);
    expect(await reasonOf(opportunity([], []))).toBeNull();
  });

  it('para rever: só as acompanhadas com prazo vencido', async () => {
    const watch = (n: number, state: WatchItem['state']) =>
      ({ companyId: id(n), state }) as WatchItem;
    const service = createTodayService(
      deps({
        monitoring: {
          overview: async () =>
            ({ watchlist: [watch(1, 'due'), watch(2, 'upcoming'), watch(3, 'running')] }) as never,
        },
      }),
    );
    const today = await service.overview(ctx);
    expect(today.toReview.items.map((item) => item.companyId)).toEqual([id(1)]);
  });

  it('uma parte que falha vira "indisponível" sem derrubar as outras e fica registrada', async () => {
    const logs: string[] = [];
    const service = createTodayService(
      deps({
        log: (message) => logs.push(message),
        relationship: {
          overview: async () => {
            throw new Error('fora do ar');
          },
          approvalQueue: async () => ({ pending: [], recent: [] }) as never,
          suppressionsOf: async () => new Map(),
          listOpportunities: async () => [],
        },
        discovery: {
          listRuns: async () => [run(1, { finishedAt: '2026-11-26T08:00:00.000Z' })],
          opportunities: async () => {
            throw new Error('fora do ar');
          },
        },
      }),
    );
    const today = await service.overview(ctx);
    expect(today.unavailable.sort()).toEqual(['discovery', 'relationship']);
    expect(today.pipeline).toBeNull();
    expect(today.finishedSearches.total).toBe(1);
    // Só o tipo do erro vai para o registro, nunca a mensagem (pode ter dado de alguém).
    expect(logs.sort()).toEqual([
      '[hoje] parte "discovery" indisponível: Error',
      '[hoje] parte "relationship" indisponível: Error',
    ]);
  });

  it('sem banco (serviços nulos) não lê nada e não acusa falha', async () => {
    const service = createTodayService({
      relationship: null,
      companies: null,
      investigations: null,
      discovery: null,
      monitoring: null,
      clock,
    });
    const today = await service.overview(ctx);
    expect(today.unavailable).toEqual([]);
    expect(today.pipeline).toBeNull();
    expect(today.readyToApproach.total).toBe(0);
  });

  it('mostra no máximo 5 por lista e conta o total', async () => {
    const companies = Array.from({ length: 8 }, (_, index) => company(index + 1));
    const summaries = companies.map((_, index) => summary(index + 1));
    const service = createTodayService(
      deps({
        companies: { list: async () => companies },
        investigations: { summaries: async () => summaries },
      }),
    );
    const today = await service.overview(ctx);
    expect(today.readyToApproach.items).toHaveLength(5);
    expect(today.readyToApproach.total).toBe(8);
  });
});
