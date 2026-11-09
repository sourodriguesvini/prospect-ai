import { AppError } from '@prospector/application';
import { describe, expect, it } from 'vitest';
import {
  mapAuditRow,
  mapInvitationRow,
  mapMemberRow,
  mapOrganizationRow,
  toAppError,
} from '../../src';

const ORG = '3f1d2c4b-8a7e-4c1d-9b2a-5e6f7a8b9c0d';
const USER = '7c9e6679-7425-40de-944b-e07fc1f90ae7';

describe('toAppError', () => {
  it.each([
    [{ message: 'not_admin', code: '42501' }, 'forbidden', 'not_admin'],
    [{ message: 'slug_taken', code: '23505' }, 'conflict', 'slug_taken'],
    [{ message: 'invitation_invalid', code: 'P0002' }, 'not_found', 'invitation_invalid'],
    [{ message: 'not_authenticated', code: '28000' }, 'unauthenticated', 'not_authenticated'],
    [
      { message: 'permission denied for table organizations', code: '42501' },
      'forbidden',
      'forbidden',
    ],
    [
      { message: 'new row violates check constraint', code: '23514' },
      'validation',
      'invalid_input',
    ],
    [{ message: 'algo inesperado', code: 'XX000' }, 'unexpected', 'unexpected'],
  ])('%o → %s/%s', (input, code, reason) => {
    const error = toAppError(input);
    expect(error).toBeInstanceOf(AppError);
    expect(error.code).toBe(code);
    expect(error.reason).toBe(reason);
  });

  it('não expõe a mensagem do banco ao usuário', () => {
    const error = toAppError({ message: 'relation "x" does not exist', code: '42P01' });
    expect(error.message).not.toContain('relation');
  });
});

describe('mapeamento de linhas', () => {
  it('organização com papel (embed objeto ou array)', () => {
    const row = {
      role: 'admin',
      organizations: { id: ORG, name: 'Agência', slug: 'agencia', is_demo: true },
    };
    expect(mapOrganizationRow(row)).toEqual({
      id: ORG,
      name: 'Agência',
      slug: 'agencia',
      isDemo: true,
      role: 'admin',
    });
    expect(mapOrganizationRow({ ...row, organizations: [row.organizations] }).slug).toBe('agencia');
  });

  it('membro com perfil ausente', () => {
    expect(
      mapMemberRow({
        user_id: USER,
        role: 'viewer',
        created_at: '2026-11-09T12:00:00Z',
        profiles: null,
      }),
    ).toEqual({
      userId: USER,
      email: null,
      fullName: null,
      role: 'viewer',
      joinedAt: '2026-11-09T12:00:00Z',
    });
  });

  it('convite pendente vencido aparece como expirado', () => {
    const row = {
      id: ORG,
      email: 'a@example.test',
      role: 'viewer',
      status: 'pending',
      expires_at: '2026-11-01T00:00:00Z',
      created_at: '2026-10-25T00:00:00Z',
    };
    expect(mapInvitationRow(row, new Date('2026-11-09T00:00:00Z')).status).toBe('expired');
    expect(mapInvitationRow(row, new Date('2026-10-30T00:00:00Z')).status).toBe('pending');
  });

  it('linha de auditoria com id bigint em texto', () => {
    const entry = mapAuditRow({
      id: '42',
      actor_type: 'user',
      actor_id: USER,
      action: 'memberships.update',
      entity_type: 'memberships',
      entity_id: USER,
      diff: { role: { from: 'viewer', to: 'admin' } },
      occurred_at: '2026-11-09T12:00:00Z',
    });
    expect(entry.id).toBe(42);
    expect(entry.action).toBe('memberships.update');
  });

  it('linha fora do formato falha alto', () => {
    expect(() =>
      mapMemberRow({ user_id: USER, role: 'root', created_at: 'x', profiles: null }),
    ).toThrow();
  });
});
