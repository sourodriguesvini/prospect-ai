import { describe, expect, it } from 'vitest';
import { csvCell, toCsv } from './csv';

describe('CSV para o Excel em português', () => {
  it('usa ponto e vírgula, BOM e CRLF; aspas só quando precisa', () => {
    const csv = toCsv(
      ['nome', 'local'],
      [
        ['Clínica Sintética; Centro', 'São Paulo/SP'],
        ['Diz "olá"', null],
      ],
    );
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv).toBe(
      '\uFEFFnome;local\r\n"Clínica Sintética; Centro";São Paulo/SP\r\n"Diz ""olá""";\r\n',
    );
  });

  it('texto que a planilha leria como fórmula vira texto', () => {
    expect(csvCell('=HYPERLINK("http://exemplo.test")')).toBe(
      `"'=HYPERLINK(""http://exemplo.test"")"`,
    );
    expect(csvCell('+55 11 3333-4444')).toBe("'+55 11 3333-4444");
    expect(csvCell('@perfil')).toBe("'@perfil");
    expect(csvCell('-1')).toBe("'-1");
    expect(csvCell(-1)).toBe('-1');
    expect(csvCell(true)).toBe('sim');
    expect(csvCell(false)).toBe('não');
  });

  it('vírgula não abre fórmula numa planilha com vírgula como separador', () => {
    expect(csvCell('Clínica Sintética,=1+1')).toBe(`"Clínica Sintética,'=1+1"`);
    expect(csvCell('a, b')).toBe('"a, b"');
    expect(csvCell('x,@y,-z,+w')).toBe(`"x,'@y,'-z,'+w"`);
  });
});
