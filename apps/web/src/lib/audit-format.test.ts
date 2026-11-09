import type { AuditLogEntry } from '@prospector/contracts';
import { describe, expect, it } from 'vitest';
import { describeActor, describeAuditEntry } from './audit-format';

function entry(partial: Partial<AuditLogEntry>): AuditLogEntry {
  return {
    id: 1,
    actorType: 'user',
    actorLabel: null,
    action: 'research.company.investigated',
    entityType: 'company',
    entityId: 'c-1',
    diff: {},
    traceId: null,
    occurredAt: '2026-11-09T12:00:00Z',
    ...partial,
  };
}

describe('describeActor', () => {
  it('o usuário é "Você"; agentes e sistema aparecem pelo nome', () => {
    expect(describeActor(entry({}))).toBe('Você');
    expect(describeActor(entry({ actorType: 'agent', actorLabel: 'investigador@v1' }))).toBe(
      'Agente investigador@v1',
    );
    expect(describeActor(entry({ actorType: 'system', actorLabel: 'retencao' }))).toBe(
      'Sistema (retencao)',
    );
    expect(describeActor(entry({ actorType: 'agent' }))).toBe('Agente');
  });
});

describe('describeAuditEntry', () => {
  it('ação sem rótulo aparece crua, com a entidade no detalhe', () => {
    expect(describeAuditEntry(entry({}))).toEqual({
      label: 'research.company.investigated',
      detail: 'company · c-1',
    });
    expect(describeAuditEntry(entry({ entityId: null })).detail).toBe('company');
  });

  it('ações da F2 têm rótulo em pt-BR', () => {
    expect(
      describeAuditEntry(
        entry({ action: 'compliance.lia.approved', entityType: 'legal_basis_assessment' }),
      ).label,
    ).toBe('LIA aprovada');
    expect(describeAuditEntry(entry({ action: 'strategy.offer.versioned' })).label).toBe(
      'Nova versão da oferta',
    );
  });
});
