import { describe, expect, it } from 'vitest';
import {
  all,
  brlToCents,
  centsToBrl,
  checked,
  formValues,
  lines,
  optionalInt,
  parseMunicipality,
  text,
} from './form-data';

describe('form-data', () => {
  it('formValues junta campos repetidos e ignora os internos do Next', () => {
    const fd = new FormData();
    fd.append('name', 'Oferta');
    fd.append('ufs', 'PR');
    fd.append('ufs', 'SC');
    fd.append('$ACTION_ID_x', '');
    const values = formValues(fd);
    expect(values).toEqual({ name: 'Oferta', ufs: ['PR', 'SC'] });
    expect(text(values, 'name')).toBe('Oferta');
    expect(all(values, 'ufs')).toEqual(['PR', 'SC']);
    expect(all(values, 'nada')).toEqual([]);
    expect(checked({ publicOk: 'on' }, 'publicOk')).toBe(true);
  });

  it('lines: um item por linha, sem linhas em branco', () => {
    expect(lines(' a \r\n\n b\n  ')).toEqual(['a', 'b']);
  });

  it.each([
    ['', null],
    ['15000', 1_500_000],
    ['15.000', 1_500_000],
    ['15.000,50', 1_500_050],
    ['R$ 1.500,5', 150_050],
    ['1500,00', 150_000],
    ['15,000.00', '15,000.00'],
    ['abc', 'abc'],
  ])('brlToCents(%j) → %j', (input, expected) => {
    expect(brlToCents(input)).toBe(expected);
  });

  it('centsToBrl volta para o formato editável', () => {
    expect(centsToBrl(1_500_050)).toBe('15.000,50');
    expect(brlToCents(centsToBrl(1_500_050))).toBe(1_500_050);
    expect(centsToBrl(null)).toBe('');
  });

  it('optionalInt: vazio → null; texto segue para o contrato recusar', () => {
    expect(optionalInt('')).toBeNull();
    expect(optionalInt(' 3 ')).toBe(3);
    expect(optionalInt('três')).toBe('três');
  });

  it('parseMunicipality aceita "Cidade/UF" e "Cidade - UF"', () => {
    expect(parseMunicipality('Curitiba/pr')).toEqual({ name: 'Curitiba', uf: 'PR' });
    expect(parseMunicipality('São José dos Pinhais - PR')).toEqual({
      name: 'São José dos Pinhais',
      uf: 'PR',
    });
    expect(parseMunicipality('Curitiba')).toEqual({ name: 'Curitiba', uf: '' });
  });
});
