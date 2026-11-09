import { describe, expect, it } from 'vitest';
import { errorsFor } from './form-state';

describe('errorsFor', () => {
  const state = {
    status: 'error' as const,
    fieldErrors: {
      problems: ['Itens repetidos.'],
      'problems.2': ['Use no máximo 300 caracteres.'],
      'filters.municipalities.0.uf': ['UF inválida (use a sigla, ex.: PR).'],
      priceMaxCents: ['Faixa invertida.'],
    },
  };

  it('junta o campo e os itens da lista, indicando o item', () => {
    expect(errorsFor(state, 'problems')).toEqual([
      'Itens repetidos.',
      'Item 3: Use no máximo 300 caracteres.',
    ]);
    expect(errorsFor(state, 'filters.municipalities')).toEqual([
      'Item 1: UF inválida (use a sigla, ex.: PR).',
    ]);
  });

  it('não confunde campos com prefixo parecido', () => {
    expect(errorsFor(state, 'price')).toBeUndefined();
    expect(errorsFor({ status: 'idle' }, 'problems')).toBeUndefined();
  });
});
