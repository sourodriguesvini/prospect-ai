import { describe, expect, it } from 'vitest';
import { calendarDate, localDay } from '../src/clock';
import { brazilianDay } from '../src/services/investigation/run';

describe('dia no fuso da agência (KI-149)', () => {
  it('instante depois das 21h de Brasília continua no dia de Brasília', () => {
    // 22:19 em Brasília de 24/11 = 01:19 UTC de 25/11.
    expect(localDay('2026-11-25T01:19:00.000Z')).toBe('2026-11-24');
    expect(brazilianDay('2026-11-25T01:19:00.000Z')).toBe('24/11/2026');
    expect(calendarDate(new Date('2026-11-25T01:19:00.000Z'))).toBe('2026-11-24');
  });

  it('instante durante o dia não muda', () => {
    expect(localDay('2026-11-24T15:00:00+00:00')).toBe('2026-11-24');
  });

  it('data pura fica como está', () => {
    expect(localDay('2026-09-19')).toBe('2026-09-19');
    expect(brazilianDay('2026-09-19')).toBe('19/09/2026');
  });

  it('valor que não é data cai no corte antigo, sem lançar erro', () => {
    expect(localDay('sem data')).toBe('sem data');
  });
});
