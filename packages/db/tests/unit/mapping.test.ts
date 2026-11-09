import { AppError } from '@prospector/application';
import { describe, expect, it } from 'vitest';
import { mapAuditRow, toAppError } from '../../src';

const TRACE = '0b7c6d3e-4f2a-4b8c-9d1e-2f3a4b5c6d7e';

describe('toAppError', () => {
  it.each([
    [
      { message: 'new row violates check constraint', code: '23514' },
      'validation',
      'invalid_input',
    ],
    [
      { message: 'JSON object requested, multiple (or no) rows returned', code: 'PGRST116' },
      'not_found',
      'not_found',
    ],
    [
      { message: "Could not find the table 'public.audit_log'", code: 'PGRST205' },
      'unavailable',
      'database_schema_missing',
    ],
    [
      { message: 'relation "public.audit_log" does not exist', code: '42P01' },
      'unavailable',
      'database_schema_missing',
    ],
    [{ message: 'TypeError: fetch failed', code: '' }, 'unavailable', 'database_unreachable'],
    [{ message: 'Invalid API key' }, 'unavailable', 'database_unreachable'],
    [
      { message: 'permission denied for table audit_log', code: '42501' },
      'unexpected',
      'unexpected',
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

describe('mapAuditRow', () => {
  const row = {
    id: 42,
    actor_type: 'agent',
    actor_label: 'investigador@v1',
    action: 'research.company.investigated',
    entity_type: 'company',
    entity_id: 'c-1',
    diff: { fontes: 3 },
    trace_id: TRACE,
    occurred_at: '2026-11-09T12:00:00+00:00',
  };

  it('converte snake_case para o contrato', () => {
    expect(mapAuditRow(row)).toEqual({
      id: 42,
      actorType: 'agent',
      actorLabel: 'investigador@v1',
      action: 'research.company.investigated',
      entityType: 'company',
      entityId: 'c-1',
      diff: { fontes: 3 },
      traceId: TRACE,
      occurredAt: '2026-11-09T12:00:00+00:00',
    });
  });

  it('aceita id bigint em texto', () => {
    expect(mapAuditRow({ ...row, id: '42' }).id).toBe(42);
  });

  it('linha fora do formato falha alto', () => {
    expect(() => mapAuditRow({ ...row, actor_type: 'root' })).toThrow();
    expect(() => mapAuditRow({ ...row, diff: null })).toThrow();
  });
});
