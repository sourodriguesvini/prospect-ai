import { describe, expect, it } from 'vitest';
import { normalizeListMarkers } from './rich-text';

describe('normalizeListMarkers', () => {
  it('troca o asterisco do item de lista por hífen, mantendo o recuo', () => {
    expect(normalizeListMarkers('Ofertas:\n* Identidade\n  * Site')).toBe(
      'Ofertas:\n- Identidade\n  - Site',
    );
  });

  it('não mexe em negrito, multiplicação nem asterisco no meio da linha', () => {
    const text = '**Oferta ativa**\n2 * 3 = 6\nnota * importante';
    expect(normalizeListMarkers(text)).toBe(text);
  });
});
