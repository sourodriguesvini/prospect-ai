import { describe, expect, it } from 'vitest';
import { greetingFor } from './greeting';

describe('greetingFor (horário de São Paulo, UTC−3)', () => {
  it.each([
    ['2026-11-09T08:00:00Z', 'Bom dia'], // 05:00
    ['2026-11-09T07:59:00Z', 'Boa noite'], // 04:59
    ['2026-11-09T12:00:00Z', 'Bom dia'], // 09:00
    ['2026-11-09T15:00:00Z', 'Boa tarde'], // 12:00
    ['2026-11-09T21:00:00Z', 'Boa noite'], // 18:00
  ])('%s → %s', (iso, expected) => {
    expect(greetingFor(new Date(iso))).toBe(expected);
  });
});
