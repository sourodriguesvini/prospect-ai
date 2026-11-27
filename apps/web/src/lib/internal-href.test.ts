import { describe, expect, it } from 'vitest';
import { InternalHref } from './internal-href';

describe('InternalHref', () => {
  it('aceita caminhos do app', () => {
    for (const href of ['/', '/empresas', '/empresas/abc%2F1', '/copiloto?x=1']) {
      expect(InternalHref.safeParse(href).success).toBe(true);
    }
  });

  it('recusa endereços que levariam para fora', () => {
    for (const href of [
      '//evil.example',
      '/\\evil.example',
      'https://evil.example',
      'empresas',
      '',
    ]) {
      expect(InternalHref.safeParse(href).success).toBe(false);
    }
  });
});
