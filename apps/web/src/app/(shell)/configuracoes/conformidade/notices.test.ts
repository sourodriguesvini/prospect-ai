import { describe, expect, it } from 'vitest';
import { complianceHref, complianceNotice } from './notices';

describe('avisos da Conformidade', () => {
  it('aceita só os avisos conhecidos', () => {
    expect(complianceNotice('lia-aprovada')).toBe('lia-aprovada');
    expect(complianceNotice('lia-revogada')).toBe('lia-revogada');
  });

  it('ignora valores desconhecidos, listas e propriedades herdadas', () => {
    expect(complianceNotice(undefined)).toBeNull();
    expect(complianceNotice('<script>')).toBeNull();
    expect(complianceNotice(['lia-aprovada'])).toBeNull();
    expect(complianceNotice('toString')).toBeNull();
    expect(complianceNotice('__proto__')).toBeNull();
  });

  it('monta o caminho com o aviso', () => {
    expect(complianceHref('/configuracoes/conformidade', 'lia-salva')).toBe(
      '/configuracoes/conformidade?aviso=lia-salva',
    );
  });
});
