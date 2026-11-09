import type { AuditLogEntry } from '@prospector/contracts';
import { describe, expect, it } from 'vitest';
import { describeActor, describeAuditEntry } from './audit-format';

const people = new Map([
  ['u-ana', 'Ana Teste'],
  ['u-bia', 'Bia Teste'],
]);

function entry(partial: Partial<AuditLogEntry>): AuditLogEntry {
  return {
    id: 1,
    actorType: 'user',
    actorId: 'u-ana',
    action: 'memberships.update',
    entityType: 'memberships',
    entityId: 'u-bia',
    diff: null,
    occurredAt: '2026-11-09T12:00:00Z',
    ...partial,
  };
}

describe('describeAuditEntry', () => {
  it('descreve mudança de papel com origem e destino', () => {
    const result = describeAuditEntry(
      entry({ diff: { role: { from: 'viewer', to: 'admin' } } }),
      people,
    );
    expect(result).toEqual({
      label: 'Papel alterado',
      detail: 'Bia Teste: Leitor → Administrador',
    });
  });

  it('descreve convite criado sem expor o token', () => {
    const result = describeAuditEntry(
      entry({
        action: 'invitations.insert',
        entityId: 'inv-1',
        diff: { email: 'bia@example.test', role: 'operator' },
      }),
      people,
    );
    expect(result).toEqual({ label: 'Convite criado', detail: 'bia@example.test · Operador' });
  });

  it('descreve mudança de status de convite', () => {
    const result = describeAuditEntry(
      entry({ action: 'invitations.update', diff: { status: { from: 'pending', to: 'revoked' } } }),
      people,
    );
    expect(result.detail).toBe('pendente → revogado');
  });

  it('mantém a ação crua quando desconhecida', () => {
    expect(describeAuditEntry(entry({ action: 'outra.coisa' }), people).label).toBe('outra.coisa');
  });
});

describe('describeActor', () => {
  it('identifica ex-membros, sistema e agentes', () => {
    expect(describeActor(entry({ actorId: 'u-saiu' }), people)).toBe('Ex-membro');
    expect(describeActor(entry({ actorType: 'system', actorId: null }), people)).toBe('Sistema');
    expect(describeActor(entry({ actorType: 'agent' }), people)).toBe('Agente');
  });
});
