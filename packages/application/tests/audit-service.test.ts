import { describe, expect, it, vi } from 'vitest';
import {
  AppError,
  createAuditService,
  createSystemService,
  type AuditRepository,
  type RequestContext,
} from '../src';

const TRACE = '0b7c6d3e-4f2a-4b8c-9d1e-2f3a4b5c6d7e';

function fakeRepo(): AuditRepository {
  return { append: vi.fn(async () => {}), listRecent: vi.fn(async () => []) };
}

describe('AuditService.record', () => {
  it('grava o usuário como ator, com traceId do contexto', async () => {
    const repo = fakeRepo();
    const ctx: RequestContext = { actor: { type: 'user' }, traceId: TRACE };
    await createAuditService(repo).record(ctx, {
      action: 'system.health.checked',
      entityType: 'system',
    });
    expect(repo.append).toHaveBeenCalledWith({
      actorType: 'user',
      actorLabel: null,
      action: 'system.health.checked',
      entityType: 'system',
      entityId: null,
      diff: {},
      traceId: TRACE,
    });
  });

  it('identifica o agente pelo nome', async () => {
    const repo = fakeRepo();
    const ctx: RequestContext = {
      actor: { type: 'agent', agent: 'investigador@v1', runId: 'run-1' },
      traceId: TRACE,
    };
    await createAuditService(repo).record(ctx, {
      action: 'research.company.investigated',
      entityType: 'company',
      entityId: 'c-1',
    });
    expect(repo.append).toHaveBeenCalledWith(
      expect.objectContaining({ actorType: 'agent', actorLabel: 'investigador@v1' }),
    );
  });

  it('recusa ação fora da convenção sem gravar nada', async () => {
    const repo = fakeRepo();
    const ctx: RequestContext = { actor: { type: 'user' }, traceId: TRACE };
    await expect(
      createAuditService(repo).record(ctx, { action: 'forjado', entityType: 'x' }),
    ).rejects.toBeInstanceOf(AppError);
    expect(repo.append).not.toHaveBeenCalled();
  });
});

describe('AuditService.listRecent', () => {
  it('limita a página entre 1 e 100', async () => {
    const repo = fakeRepo();
    const service = createAuditService(repo);
    const ctx: RequestContext = { actor: { type: 'user' }, traceId: TRACE };
    await service.listRecent(ctx, 5000);
    await service.listRecent(ctx, 0);
    expect(repo.listRecent).toHaveBeenNthCalledWith(1, 100);
    expect(repo.listRecent).toHaveBeenNthCalledWith(2, 1);
  });
});

describe('SystemService.databaseStatus', () => {
  it('sem credenciais: não configurado', async () => {
    expect(await createSystemService(null).databaseStatus()).toBe('not_configured');
  });

  it('repassa o resultado da verificação e trata exceção como fora do ar', async () => {
    expect(await createSystemService({ check: async () => 'ok' }).databaseStatus()).toBe('ok');
    expect(
      await createSystemService({
        check: async () => {
          throw new Error('rede');
        },
      }).databaseStatus(),
    ).toBe('unreachable');
  });
});
