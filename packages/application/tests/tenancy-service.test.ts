import type { Role } from '@prospector/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AppError,
  createTenancyService,
  type RequestContext,
  type TenancyRepository,
} from '../src';

const ORG = '3f1d2c4b-8a7e-4c1d-9b2a-5e6f7a8b9c0d';
const OWNER = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const ADMIN = '1b4e28ba-2fa1-41d2-883f-0016d3cca427';
const VIEWER = '9b2f1c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d';
const OUTSIDER = 'c56a4180-65aa-42ec-a945-5fd21dec0538';

const ctxOf = (userId: string): RequestContext => ({
  actor: { type: 'user', userId },
  traceId: 't-1',
});
const systemCtx: RequestContext = { actor: { type: 'system', component: 'teste' }, traceId: 't-2' };

/** Repositório em memória: guarda papéis e registra chamadas de escrita. */
function fakeRepo(roles: Record<string, Role>) {
  const repo: TenancyRepository = {
    createOrganization: vi.fn(async (input) => ({ id: ORG, slug: input.slug })),
    listMyOrganizations: vi.fn(async () => []),
    findMyOrganizationBySlug: vi.fn(async () => null),
    getMemberRole: vi.fn(async (orgId, userId) => (orgId === ORG ? (roles[userId] ?? null) : null)),
    listMembers: vi.fn(async () => []),
    listInvitations: vi.fn(async () => []),
    createInvitation: vi.fn(async () => ({
      invitationId: ORG,
      token: 'a'.repeat(64),
      expiresAt: '2026-11-16T00:00:00Z',
    })),
    acceptInvitation: vi.fn(async () => ({ orgId: ORG, slug: 'agencia' })),
    revokeInvitation: vi.fn(async () => undefined),
    changeMemberRole: vi.fn(async () => undefined),
    removeMember: vi.fn(async () => undefined),
    listAuditLog: vi.fn(async () => []),
  };
  return repo;
}

async function expectAppError(
  promise: Promise<unknown>,
  code: AppError['code'],
  reason?: AppError['reason'],
) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(AppError);
  expect((error as AppError).code).toBe(code);
  if (reason) expect((error as AppError).reason).toBe(reason);
}

describe('TenancyService', () => {
  let repo: TenancyRepository;
  beforeEach(() => {
    repo = fakeRepo({ [OWNER]: 'owner', [ADMIN]: 'admin', [VIEWER]: 'viewer' });
  });

  it('exige usuário autenticado', async () => {
    const service = createTenancyService(repo);
    await expectAppError(
      service.createOrganization(systemCtx, { name: 'Agência', slug: 'agencia' }),
      'unauthenticated',
    );
  });

  it('valida a entrada antes de chegar ao repositório', async () => {
    const service = createTenancyService(repo);
    const error = await service
      .createOrganization(ctxOf(OWNER), { name: 'A', slug: '-x' })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).fieldErrors).toHaveProperty('name');
    expect((error as AppError).fieldErrors).toHaveProperty('slug');
    expect(repo.createOrganization).not.toHaveBeenCalled();
  });

  it('admin convida; viewer não convida; ninguém convida como owner', async () => {
    const service = createTenancyService(repo);
    await service.inviteMember(ctxOf(ADMIN), {
      orgId: ORG,
      email: 'novo@agencia.example.test',
      role: 'operator',
    });
    expect(repo.createInvitation).toHaveBeenCalledOnce();

    await expectAppError(
      service.inviteMember(ctxOf(VIEWER), { orgId: ORG, email: 'x@example.test', role: 'viewer' }),
      'forbidden',
      'not_admin',
    );
    await expectAppError(
      service.inviteMember(ctxOf(OWNER), { orgId: ORG, email: 'x@example.test', role: 'owner' }),
      'validation',
    );
  });

  it('quem não é membro recebe not_found (não revela a existência da organização)', async () => {
    const service = createTenancyService(repo);
    await expectAppError(service.listMembers(ctxOf(OUTSIDER), ORG), 'not_found');
    await expectAppError(
      service.inviteMember(ctxOf(OUTSIDER), {
        orgId: ORG,
        email: 'x@example.test',
        role: 'viewer',
      }),
      'not_found',
    );
  });

  it('aplica regras de alteração de papel', async () => {
    const service = createTenancyService(repo);
    await expectAppError(
      service.changeMemberRole(ctxOf(ADMIN), { orgId: ORG, userId: OWNER, role: 'viewer' }),
      'forbidden',
      'owner_only',
    );
    await expectAppError(
      service.changeMemberRole(ctxOf(OWNER), { orgId: ORG, userId: OWNER, role: 'admin' }),
      'forbidden',
      'self_change',
    );
    await expectAppError(
      service.changeMemberRole(ctxOf(ADMIN), { orgId: ORG, userId: OUTSIDER, role: 'viewer' }),
      'not_found',
      'member_not_found',
    );

    await service.changeMemberRole(ctxOf(ADMIN), { orgId: ORG, userId: VIEWER, role: 'operator' });
    expect(repo.changeMemberRole).toHaveBeenCalledWith({
      orgId: ORG,
      userId: VIEWER,
      role: 'operator',
    });
  });

  it('remoção segue as mesmas regras', async () => {
    const service = createTenancyService(repo);
    await expectAppError(
      service.removeMember(ctxOf(ADMIN), { orgId: ORG, userId: OWNER }),
      'forbidden',
      'owner_only',
    );
    await service.removeMember(ctxOf(OWNER), { orgId: ORG, userId: ADMIN });
    expect(repo.removeMember).toHaveBeenCalledOnce();
  });

  it('auditoria só para admin e owner', async () => {
    const service = createTenancyService(repo);
    await expectAppError(service.listAuditLog(ctxOf(VIEWER), ORG), 'forbidden');
    await service.listAuditLog(ctxOf(ADMIN), ORG);
    expect(repo.listAuditLog).toHaveBeenCalledWith(ORG, 100);
  });

  it('slug inválido na URL vira not_found sem consultar o banco', async () => {
    const service = createTenancyService(repo);
    await expectAppError(service.getOrganization(ctxOf(OWNER), '../etc'), 'not_found');
    expect(repo.findMyOrganizationBySlug).not.toHaveBeenCalled();
  });
});
