import { describe, expect, it } from 'vitest';
import {
  isoToLocalDate,
  isoToLocalDateTime,
  localDateInDays,
  localDateTimeToIso,
  localDateToIso,
} from './relationship-dates';

describe('datas do Relacionamento (hora da agência)', () => {
  it('converte a hora de parede de São Paulo para ISO com deslocamento', () => {
    expect(localDateTimeToIso('2026-11-11T14:30')).toBe('2026-11-11T14:30:00-03:00');
    expect(new Date(localDateTimeToIso('2026-11-11T23:30')!).toISOString()).toBe(
      '2026-11-12T02:30:00.000Z',
    );
    // Horário de verão antigo (2018): o deslocamento é o daquele instante.
    expect(localDateTimeToIso('2018-12-01T10:00')).toBe('2018-12-01T10:00:00-02:00');
  });

  it('vazio vira null; formato ou data impossível segue cru para o contrato recusar', () => {
    expect(localDateTimeToIso('  ')).toBeNull();
    expect(localDateTimeToIso('11/11/2026')).toBe('11/11/2026');
    expect(localDateTimeToIso('2026-02-30T10:00')).toBe('2026-02-30T10:00');
    expect(localDateToIso('')).toBeNull();
  });

  it('data sem hora vira 9h da agência', () => {
    expect(localDateToIso('2026-11-14')).toBe('2026-11-14T09:00:00-03:00');
  });

  it('volta de ISO para os campos do formulário na hora da agência', () => {
    expect(isoToLocalDateTime('2026-11-12T02:30:00.000Z')).toBe('2026-11-11T23:30');
    expect(isoToLocalDate('2026-11-12T02:30:00.000Z')).toBe('2026-11-11');
    expect(isoToLocalDateTime('não é data')).toBe('');
    expect(localDateInDays(new Date('2026-11-11T15:00:00Z'), 3)).toBe('2026-11-14');
  });
});
