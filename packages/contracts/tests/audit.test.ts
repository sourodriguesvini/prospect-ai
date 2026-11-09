import { describe, expect, it } from 'vitest';
import { AuditAction, Email, RecordAuditInput } from '../src';

describe('AuditAction', () => {
  it.each(['approvals.approval.granted', 'system.health.checked', 'research.company_v2.done'])(
    'aceita %s',
    (action) => {
      expect(AuditAction.safeParse(action).success).toBe(true);
    },
  );

  it.each(['forjado', 'Approvals.Grant', 'a..b', 'a.b.c.d.e', '.a.b', 'a.b.', 'a-b.c'])(
    'recusa %s',
    (action) => {
      expect(AuditAction.safeParse(action).success).toBe(false);
    },
  );
});

describe('RecordAuditInput', () => {
  it('preenche entidade e diff vazios', () => {
    expect(RecordAuditInput.parse({ action: 'a.b', entityType: 'company' })).toEqual({
      action: 'a.b',
      entityType: 'company',
      entityId: null,
      diff: {},
    });
  });

  it('recusa tipo de entidade vazio', () => {
    expect(RecordAuditInput.safeParse({ action: 'a.b', entityType: '  ' }).success).toBe(false);
  });
});

describe('Email', () => {
  it('normaliza para minúsculas sem espaços', () => {
    expect(Email.parse(' Ana@Agencia.Example.Test ')).toBe('ana@agencia.example.test');
  });

  it('recusa endereço inválido', () => {
    expect(Email.safeParse('ana@').success).toBe(false);
  });
});
