import type { Investigation } from '@prospector/contracts';
import { describe, expect, it } from 'vitest';
import { AppError, analyzeProspect, type AnalyzeProspectDeps, type RequestContext } from '../src';

/** Dados SINTÉTICOS: ids de teste; nada aqui é empresa real. */
const ctx: RequestContext = {
  actor: { type: 'user' },
  traceId: '0b7c6d3e-4f2a-4b8c-9d1e-2f3a4b5c6d7e',
};
const COMPANY = '11111111-1111-4111-8111-111111111111';
const PROSPECT = '22222222-2222-4222-8222-222222222222';

function investigation(id: string, status: Investigation['status']): Investigation {
  return { id, status } as Investigation;
}

/** Investigação falsa que anota o que foi pedido. */
function fakeInvestigations(options: {
  latest?: Investigation;
  /** Análises mais antigas, depois da mais recente. */
  older?: Investigation[];
  /** O que o histórico mostra a partir da segunda leitura (outra aba mexeu no meio). */
  later?: Investigation;
  startError?: AppError;
  resumeError?: AppError;
}) {
  const calls: string[] = [];
  let reads = 0;
  const service: NonNullable<AnalyzeProspectDeps['investigations']> = {
    async history(_ctx, companyId, limit) {
      calls.push(`history:${companyId}:${limit}`);
      reads += 1;
      const current = reads > 1 && options.later ? options.later : options.latest;
      return [...(current ? [current] : []), ...(options.older ?? [])].slice(0, limit);
    },
    async start(_ctx, raw) {
      calls.push(`start:${raw.trigger}:${String(raw.force)}`);
      if (options.startError) throw options.startError;
      return investigation('33333333-3333-4333-8333-333333333333', 'queued');
    },
    async resume(_ctx, id) {
      calls.push(`resume:${id}`);
      if (options.resumeError) throw options.resumeError;
      return investigation(id, 'queued');
    },
  };
  return { service, calls };
}

function deps(investigations: AnalyzeProspectDeps['investigations']): AnalyzeProspectDeps {
  return {
    discovery: {
      async investigate(_ctx, prospectId) {
        expect(prospectId).toBe(PROSPECT);
        return { companyId: COMPANY, created: true, claims: 3 };
      },
    },
    investigations,
  };
}

describe('analyzeProspect (Analisar empresa na Descoberta)', () => {
  it('grava a empresa e começa a análise no mesmo clique, com gatilho da Descoberta', async () => {
    const fake = fakeInvestigations({});
    const result = await analyzeProspect(deps(fake.service), ctx, PROSPECT);
    expect(result).toEqual({
      status: 'started',
      companyId: COMPANY,
      investigationId: '33333333-3333-4333-8333-333333333333',
    });
    expect(fake.calls).toEqual([`history:${COMPANY}:10`, 'start:discovery:false']);
  });

  it('não cria outra análise quando já há uma em andamento', async () => {
    const fake = fakeInvestigations({ latest: investigation('a1', 'running') });
    const result = await analyzeProspect(deps(fake.service), ctx, PROSPECT);
    expect(result).toEqual({
      status: 'already_running',
      companyId: COMPANY,
      investigationId: 'a1',
    });
    expect(fake.calls.some((call) => call.startsWith('start'))).toBe(false);
  });

  it('não refaz sozinha uma análise concluída (nada de gastar buscas de novo)', async () => {
    for (const status of ['succeeded', 'partial'] as const) {
      const fake = fakeInvestigations({ latest: investigation('a2', status) });
      const result = await analyzeProspect(deps(fake.service), ctx, PROSPECT);
      expect(result.status).toBe('already_analyzed');
      expect(fake.calls.some((call) => call.startsWith('start'))).toBe(false);
    }
  });

  it('atualização cancelada depois de uma análise concluída: não refaz nem gasta buscas', async () => {
    const done = '55555555-5555-4555-8555-555555555555';
    const fake = fakeInvestigations({
      latest: investigation('66666666-6666-4666-8666-666666666666', 'cancelled'),
      older: [investigation(done, 'succeeded')],
    });
    const result = await analyzeProspect(deps(fake.service), ctx, PROSPECT);
    expect(result).toEqual({
      status: 'already_analyzed',
      companyId: COMPANY,
      investigationId: done,
    });
    expect(fake.calls.filter((call) => !call.startsWith('history'))).toEqual([]);
  });

  it('retoma a análise interrompida ou com falha sem repetir as etapas concluídas', async () => {
    for (const status of ['interrupted', 'failed'] as const) {
      const fake = fakeInvestigations({ latest: investigation('a3', status) });
      const result = await analyzeProspect(deps(fake.service), ctx, PROSPECT);
      expect(result).toEqual({ status: 'resumed', companyId: COMPANY, investigationId: 'a3' });
      expect(fake.calls).toContain('resume:a3');
    }
  });

  it('começa de novo depois de uma análise cancelada', async () => {
    const fake = fakeInvestigations({ latest: investigation('a4', 'cancelled') });
    const result = await analyzeProspect(deps(fake.service), ctx, PROSPECT);
    expect(result.status).toBe('started');
  });

  it('fila cheia: a empresa fica gravada e o resultado diz que a análise não começou', async () => {
    const fake = fakeInvestigations({
      startError: new AppError('unavailable', 'investigation_queue_full'),
    });
    const result = await analyzeProspect(deps(fake.service), ctx, PROSPECT);
    expect(result).toEqual({ status: 'not_started', companyId: COMPANY, reason: 'queue_full' });
  });

  it('fila cheia também na retomada', async () => {
    const fake = fakeInvestigations({
      latest: investigation('a5', 'interrupted'),
      resumeError: new AppError('unavailable', 'investigation_queue_full'),
    });
    const result = await analyzeProspect(deps(fake.service), ctx, PROSPECT);
    expect(result).toEqual({ status: 'not_started', companyId: COMPANY, reason: 'queue_full' });
  });

  it('empresa arquivada: não começa e diz o motivo', async () => {
    const fake = fakeInvestigations({ startError: new AppError('conflict', 'company_archived') });
    const result = await analyzeProspect(deps(fake.service), ctx, PROSPECT);
    expect(result).toEqual({
      status: 'not_started',
      companyId: COMPANY,
      reason: 'company_archived',
    });
  });

  it('corrida com outra aba: o índice único do banco vira "já em andamento", não erro', async () => {
    const fake = fakeInvestigations({
      startError: new AppError('conflict', 'investigation_running'),
    });
    const result = await analyzeProspect(deps(fake.service), ctx, PROSPECT);
    expect(result).toEqual({
      status: 'already_running',
      companyId: COMPANY,
      investigationId: null,
    });
  });

  it('corrida na retomada: outra aba já retomou ou a análise terminou, sem erro', async () => {
    const id = '44444444-4444-4444-8444-444444444444';
    const notResumable = new AppError('conflict', 'investigation_not_resumable');
    const running = fakeInvestigations({
      latest: investigation(id, 'interrupted'),
      later: investigation(id, 'running'),
      resumeError: notResumable,
    });
    expect(await analyzeProspect(deps(running.service), ctx, PROSPECT)).toEqual({
      status: 'already_running',
      companyId: COMPANY,
      investigationId: id,
    });
    const done = fakeInvestigations({
      latest: investigation(id, 'failed'),
      later: investigation(id, 'succeeded'),
      resumeError: notResumable,
    });
    expect(await analyzeProspect(deps(done.service), ctx, PROSPECT)).toEqual({
      status: 'already_analyzed',
      companyId: COMPANY,
      investigationId: id,
    });
    // Sem mudança no histórico, o erro sobe: a tela não inventa um aviso.
    const stuck = fakeInvestigations({
      latest: investigation(id, 'failed'),
      resumeError: notResumable,
    });
    await expect(analyzeProspect(deps(stuck.service), ctx, PROSPECT)).rejects.toThrow();
  });

  it('investigação desligada: grava a empresa e avisa que a análise não começou', async () => {
    const result = await analyzeProspect(deps(null), ctx, PROSPECT);
    expect(result).toEqual({ status: 'not_started', companyId: COMPANY, reason: 'unavailable' });
  });

  it('erro inesperado sobe (não vira aviso enganoso)', async () => {
    const fake = fakeInvestigations({ startError: new AppError('unexpected', 'not_found') });
    await expect(analyzeProspect(deps(fake.service), ctx, PROSPECT)).rejects.toThrow();
  });
});
