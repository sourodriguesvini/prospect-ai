import { ROLES, type Role } from '@prospector/contracts';
import { describe, expect, it } from 'vitest';
import {
  canManageMembers,
  canViewAuditLog,
  checkInvitation,
  checkMemberRemoval,
  checkRoleChange,
  hasAtLeast,
  suggestSlug,
} from '../src';

describe('hierarquia de papéis', () => {
  it('owner > admin > operator > viewer', () => {
    expect(hasAtLeast('owner', 'admin')).toBe(true);
    expect(hasAtLeast('admin', 'operator')).toBe(true);
    expect(hasAtLeast('operator', 'viewer')).toBe(true);
    expect(hasAtLeast('viewer', 'operator')).toBe(false);
    expect(hasAtLeast('admin', 'owner')).toBe(false);
  });

  it('só admin e owner gerenciam membros e veem auditoria', () => {
    const managers = ROLES.filter(canManageMembers);
    expect(managers).toEqual(['owner', 'admin']);
    expect(ROLES.filter(canViewAuditLog)).toEqual(['owner', 'admin']);
  });
});

describe('checkInvitation', () => {
  it.each<[Role, Role, boolean]>([
    ['owner', 'admin', true],
    ['admin', 'admin', true],
    ['admin', 'viewer', true],
    ['operator', 'viewer', false],
    ['viewer', 'viewer', false],
    ['owner', 'owner', false],
  ])('%s convidando %s → %s', (actor, invited, allowed) => {
    expect(checkInvitation(actor, invited).ok).toBe(allowed);
  });
});

describe('checkRoleChange', () => {
  it('nega alteração do próprio papel', () => {
    expect(
      checkRoleChange({ actorRole: 'owner', isSelf: true, targetRole: 'owner', newRole: 'admin' }),
    ).toEqual({
      ok: false,
      reason: 'self_change',
    });
  });

  it('admin não promove a owner nem altera um owner', () => {
    expect(
      checkRoleChange({ actorRole: 'admin', isSelf: false, targetRole: 'viewer', newRole: 'owner' })
        .ok,
    ).toBe(false);
    expect(
      checkRoleChange({ actorRole: 'admin', isSelf: false, targetRole: 'owner', newRole: 'viewer' })
        .ok,
    ).toBe(false);
  });

  it('admin altera papéis abaixo de owner; owner altera qualquer outro membro', () => {
    expect(
      checkRoleChange({
        actorRole: 'admin',
        isSelf: false,
        targetRole: 'viewer',
        newRole: 'operator',
      }).ok,
    ).toBe(true);
    expect(
      checkRoleChange({ actorRole: 'owner', isSelf: false, targetRole: 'admin', newRole: 'owner' })
        .ok,
    ).toBe(true);
  });

  it('operator e viewer não alteram papéis', () => {
    expect(
      checkRoleChange({
        actorRole: 'operator',
        isSelf: false,
        targetRole: 'viewer',
        newRole: 'operator',
      }),
    ).toEqual({
      ok: false,
      reason: 'not_admin',
    });
  });
});

describe('checkMemberRemoval', () => {
  it('aplica as mesmas restrições de owner e de autoalteração', () => {
    expect(
      checkMemberRemoval({ actorRole: 'admin', isSelf: false, targetRole: 'operator' }).ok,
    ).toBe(true);
    expect(checkMemberRemoval({ actorRole: 'admin', isSelf: false, targetRole: 'owner' }).ok).toBe(
      false,
    );
    expect(checkMemberRemoval({ actorRole: 'owner', isSelf: true, targetRole: 'owner' }).ok).toBe(
      false,
    );
    expect(
      checkMemberRemoval({ actorRole: 'viewer', isSelf: false, targetRole: 'viewer' }).ok,
    ).toBe(false);
  });
});

describe('suggestSlug', () => {
  it.each([
    ['Estúdio Ação & Cia', 'estudio-acao-cia'],
    ['  Marca  Viva  ', 'marca-viva'],
    ['ÇÃÕ', 'cao'],
    ['---', ''],
  ])('%s → %s', (name, slug) => {
    expect(suggestSlug(name)).toBe(slug);
  });

  it('limita a 48 caracteres sem terminar em hífen', () => {
    const slug = suggestSlug(`${'a'.repeat(47)} b`);
    expect(slug.length).toBeLessThanOrEqual(48);
    expect(slug.endsWith('-')).toBe(false);
  });
});
