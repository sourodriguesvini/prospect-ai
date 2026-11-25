import { describe, expect, it } from 'vitest';
import { cnpjInText } from '../src/services/discovery-engine';

/** CNPJ lido na página do candidato (descoberta): o da empresa, nunca o de quem fez o site. */
describe('cnpjInText (descoberta)', () => {
  it('pega o CNPJ da empresa e ignora o da agência no rodapé', () => {
    const footer = [
      'Desenvolvido por Agência Modelo Digital - CNPJ 44.555.666/0001-81',
      '© 2026 Ateliê Exemplo - CNPJ: 11.222.333/0001-81',
    ].join('\n');
    expect(cnpjInText(footer)).toBe('11222333000181');
  });

  it('só o CNPJ de quem fez o site, ou número inválido: nenhum', () => {
    expect(cnpjInText('Site por Agência Modelo Digital - CNPJ 44.555.666/0001-81')).toBeNull();
    expect(cnpjInText('CNPJ 11.222.333/0001-80')).toBeNull();
    expect(cnpjInText('Ligue (11) 98765-4321')).toBeNull();
  });

  it('aceita o número com rótulo, sem máscara', () => {
    expect(cnpjInText('Razão social e CNPJ: 11222333000181')).toBe('11222333000181');
  });
});
