import { describe, expect, it } from 'vitest';
import { preparedOfferId } from './relationship-labels';

const OFFERS = [
  { value: 'oferta-a', label: 'Oferta A' },
  { value: 'oferta-b', label: 'Oferta B' },
];

describe('oferta marcada em "Preparar abordagem" (KI-129)', () => {
  it('a escolhida antes vale mais que a recomendada pelo diagnóstico', () => {
    expect(preparedOfferId(OFFERS, 'oferta-a', 'oferta-b')).toBe('oferta-a');
  });

  it('sem escolha, vale a recomendada pelo diagnóstico', () => {
    expect(preparedOfferId(OFFERS, null, 'oferta-b')).toBe('oferta-b');
  });

  it('oferta fora das ativas não é marcada', () => {
    expect(preparedOfferId(OFFERS, 'arquivada', 'inativa')).toBeNull();
    expect(preparedOfferId(OFFERS, null, null)).toBeNull();
  });
});
