import {
  MonitoringFeedItem,
  type InvestigationChange,
  type WatchItem,
} from '@prospector/contracts';
import { describe, expect, it } from 'vitest';
import {
  buildMonitoringFeed,
  changeItem,
  compareWatchItems,
  filterMonitoringFeed,
  noveltyItem,
  watchCadence,
  watchStatus,
} from '../../src';

/** Dados SINTÉTICOS: ids e nomes de teste, sem empresa real. */
const COMPANY_A = '11111111-1111-4111-8111-111111111111';
const COMPANY_B = '22222222-2222-4222-8222-222222222222';
const INV_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const INV_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const RUN = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const MONITOR = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

const change = (kind: InvestigationChange['kind'], text = 'Texto do sistema.') => ({
  kind,
  text,
  claimIds: [],
});

describe('watchCadence', () => {
  it('segue a recomendação: abordar e preparar a cada 7 dias, o resto a cada 30', () => {
    expect(watchCadence('pursue')).toBe('weekly');
    expect(watchCadence('prepare_access')).toBe('weekly');
    expect(watchCadence('monitor')).toBe('monthly');
    expect(watchCadence('investigate_more')).toBe('monthly');
    expect(watchCadence('insufficient_evidence')).toBe('monthly');
  });

  it('descartar tira a empresa da lista', () => {
    expect(watchCadence('discard')).toBeNull();
  });
});

describe('watchStatus', () => {
  const now = new Date('2026-11-25T15:00:00.000Z');

  it('em dia: conta os dias até o prazo', () => {
    const status = watchStatus({
      lastInvestigatedAt: '2026-11-20T15:00:00.000Z',
      cadence: 'weekly',
      running: false,
      now,
    });
    expect(status).toEqual({ dueAt: '2026-11-27T15:00:00.000Z', state: 'upcoming', days: 2 });
  });

  it('vencida: conta os dias inteiros de atraso (0 = venceu hoje)', () => {
    expect(
      watchStatus({
        lastInvestigatedAt: '2026-10-20T15:00:00.000Z',
        cadence: 'monthly',
        running: false,
        now,
      }),
    ).toEqual({ dueAt: '2026-11-19T15:00:00.000Z', state: 'due', days: 6 });
    expect(
      watchStatus({
        lastInvestigatedAt: '2026-11-18T15:00:00.000Z',
        cadence: 'weekly',
        running: false,
        now,
      }).days,
    ).toBe(0);
  });

  it('com investigação na fila ou rodando, o estado é "em andamento"', () => {
    const status = watchStatus({
      lastInvestigatedAt: '2026-10-01T15:00:00.000Z',
      cadence: 'weekly',
      running: true,
      now,
    });
    expect(status.state).toBe('running');
    expect(status.days).toBe(0);
  });

  it('data ilegível vira vencida, nunca some da lista', () => {
    const status = watchStatus({
      lastInvestigatedAt: 'não é data',
      cadence: 'weekly',
      running: false,
      now,
    });
    expect(status.state).toBe('due');
    expect(status.dueAt).toBe(now.toISOString());
  });
});

describe('compareWatchItems', () => {
  const item = (
    companyName: string,
    state: WatchItem['state'],
    dueAt: string,
    priority: number | null = null,
  ) => ({ companyName, state, dueAt, priority });

  it('vencidas primeiro (mais atrasadas), depois em andamento, depois em dia', () => {
    const sorted = [
      item('Em dia', 'upcoming', '2026-12-01T00:00:00.000Z'),
      item('Rodando', 'running', '2026-11-01T00:00:00.000Z'),
      item('Vencida recente', 'due', '2026-11-20T00:00:00.000Z'),
      item('Vencida antiga', 'due', '2026-11-01T00:00:00.000Z'),
    ].sort(compareWatchItems);
    expect(sorted.map((row) => row.companyName)).toEqual([
      'Vencida antiga',
      'Vencida recente',
      'Rodando',
      'Em dia',
    ]);
  });

  it('mesmo prazo: maior prioridade primeiro, depois o nome', () => {
    const due = '2026-11-20T00:00:00.000Z';
    const sorted = [
      item('Beta', 'due', due, 40),
      item('Alfa', 'due', due, 40),
      item('Gama', 'due', due, 80),
    ].sort(compareWatchItems);
    expect(sorted.map((row) => row.companyName)).toEqual(['Gama', 'Alfa', 'Beta']);
  });
});

describe('feed de novidades', () => {
  const record = {
    investigationId: INV_A,
    companyId: COMPANY_A,
    companyName: 'Empresa Sintética A',
    isDemo: false,
    finishedAt: '2026-11-24T12:00:00.000Z',
  };

  it('separa "fora do ar nesta coleta" das mudanças de fato', () => {
    const item = changeItem({
      ...record,
      changes: [change('offering_added'), change('temporarily_unavailable')],
    });
    expect(item?.changes.map((entry) => entry.kind)).toEqual(['offering_added']);
    expect(item?.unavailable.map((entry) => entry.kind)).toEqual(['temporarily_unavailable']);
    expect(MonitoringFeedItem.safeParse(item).success).toBe(true);
  });

  it('investigação sem mudança nenhuma não entra no feed', () => {
    expect(changeItem({ ...record, changes: [] })).toBeNull();
  });

  it('busca recorrente sem empresa nova não entra no feed', () => {
    const novelty = {
      runId: RUN,
      monitorId: MONITOR,
      monitorName: 'Clínicas em Curitiba',
      finishedAt: '2026-11-25T08:00:00.000Z',
      newCompanies: 0,
      isDemo: false,
    };
    expect(noveltyItem(novelty)).toBeNull();
    const item = noveltyItem({ ...novelty, newCompanies: 3 });
    expect(MonitoringFeedItem.safeParse(item).success).toBe(true);
  });

  it('junta as duas origens, mais recentes primeiro, e respeita o limite', () => {
    const feed = buildMonitoringFeed({
      changes: [
        { ...record, changes: [change('site_changed')] },
        {
          ...record,
          investigationId: INV_B,
          companyId: COMPANY_B,
          companyName: 'Empresa Sintética B',
          finishedAt: '2026-11-20T12:00:00.000Z',
          changes: [change('new_signal')],
        },
      ],
      novelties: [
        {
          runId: RUN,
          monitorId: MONITOR,
          monitorName: 'Clínicas em Curitiba',
          finishedAt: '2026-11-25T08:00:00.000Z',
          newCompanies: 2,
          isDemo: true,
        },
      ],
      limit: 2,
    });
    expect(feed.map((item) => item.kind)).toEqual(['discovery_novelty', 'company_change']);
    expect(feed).toHaveLength(2);
    expect(filterMonitoringFeed(feed, 'companies')).toHaveLength(1);
    expect(filterMonitoringFeed(feed, 'discovery')).toHaveLength(1);
    expect(filterMonitoringFeed(feed, 'all')).toHaveLength(2);
  });
});
