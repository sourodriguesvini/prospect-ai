import { describe, expect, it } from 'vitest';
import {
  Cnpj,
  CnpjRegistryRecord,
  CompanyDomain,
  CompanyInput,
  CompanyListFilter,
  cnpjRecordUrl,
  formatCnpj,
  isValidCnpj,
  normalizeCnpj,
} from '../src';

/** CNPJs de teste: os dígitos verificadores conferem, mas não são de empresas reais conhecidas. */
describe('CNPJ', () => {
  it('valida os dígitos verificadores do CNPJ numérico', () => {
    expect(isValidCnpj('11.222.333/0001-81')).toBe(true);
    expect(isValidCnpj('11222333000181')).toBe(true);
    expect(isValidCnpj('11222333000182')).toBe(false);
    expect(isValidCnpj('1122233300018')).toBe(false);
  });

  it('aceita o CNPJ alfanumérico (exemplo oficial da Receita: 12.ABC.345/01DE-35)', () => {
    expect(normalizeCnpj('12.abc.345/01de-35')).toBe('12ABC34501DE35');
    expect(isValidCnpj('12.ABC.345/01DE-35')).toBe(true);
    expect(isValidCnpj('12ABC34501DE36')).toBe(false);
    // Os dígitos verificadores continuam numéricos.
    expect(isValidCnpj('12ABC34501DEAB')).toBe(false);
  });

  it('recusa sequências repetidas, que passam na conta mas não existem', () => {
    expect(isValidCnpj('00000000000000')).toBe(false);
    expect(isValidCnpj('11111111111111')).toBe(false);
  });

  it('formata e normaliza no contrato', () => {
    expect(formatCnpj('12ABC34501DE35')).toBe('12.ABC.345/01DE-35');
    expect(Cnpj.parse(' 11.222.333/0001-81 ')).toBe('11222333000181');
    expect(Cnpj.safeParse('11.222.333/0001-80').success).toBe(false);
  });

  it('endereço do registro no provedor é sempre do provedor e com o CNPJ codificado', () => {
    expect(cnpjRecordUrl('opencnpj', '11.222.333/0001-81')).toBe(
      'https://api.opencnpj.org/11222333000181',
    );
    expect(cnpjRecordUrl('minhareceita', '12ABC34501DE35')).toBe(
      'https://minhareceita.org/12ABC34501DE35',
    );
  });
});

describe('cadastro de empresa', () => {
  it('domínio colado vira só o host, sem www', () => {
    expect(CompanyDomain.parse('https://www.Exemplo.com.br/contato?x=1')).toBe('exemplo.com.br');
    expect(CompanyDomain.parse('exemplo.com.br.')).toBe('exemplo.com.br');
    expect(CompanyDomain.safeParse('localhost').success).toBe(false);
    expect(CompanyDomain.safeParse('exemplo').success).toBe(false);
  });

  it('campos opcionais vazios viram null; nome é obrigatório', () => {
    expect(
      CompanyInput.parse({
        schemaVersion: 1,
        displayName: '  Ateliê Exemplo ',
        cnpj: '',
        primaryDomain: '',
        city: '',
        uf: '',
      }),
    ).toEqual({
      schemaVersion: 1,
      displayName: 'Ateliê Exemplo',
      cnpj: null,
      primaryDomain: null,
      city: null,
      uf: null,
    });
    expect(CompanyInput.safeParse({ schemaVersion: 1, displayName: ' ' }).success).toBe(false);
    expect(
      CompanyInput.safeParse({ schemaVersion: 1, displayName: 'Ateliê', cnpj: '123' }).success,
    ).toBe(false);
  });

  it('filtro da lista tem limites', () => {
    expect(CompanyListFilter.parse({})).toEqual({
      search: '',
      lifecycle: null,
      includeArchived: false,
      limit: 50,
    });
    expect(CompanyListFilter.safeParse({ limit: 500 }).success).toBe(false);
  });
});

describe('registro minimizado da Receita', () => {
  const record = {
    schemaVersion: 1,
    provider: 'opencnpj',
    cnpj: '11222333000181',
    legalName: 'ATELIE EXEMPLO LTDA',
    tradeName: null,
    status: 'active',
    statusSince: null,
    headquarters: true,
    activityStart: null,
    cnaeMain: null,
    cnaeSecondary: [],
    legalNature: null,
    size: null,
    isMei: false,
    simples: null,
    capitalCents: null,
    city: null,
    uf: null,
    providerUpdatedAt: null,
  };

  it('não tem campo para sócios, e-mail, telefone ou endereço de rua', () => {
    const parsed = CnpjRegistryRecord.parse({
      ...record,
      QSA: [{ nome_socio: 'SOCIA EXEMPLO' }],
      email: 'contato@exemplo.test',
      telefones: [{ ddd: '41', numero: '00000000' }],
      logradouro: 'RUA DAS EXEMPLO',
    });
    expect(Object.keys(parsed)).not.toEqual(
      expect.arrayContaining(['QSA', 'email', 'telefones', 'logradouro']),
    );
    expect(JSON.stringify(parsed)).not.toMatch(/SOCIA|contato@|00000000|RUA/);
  });

  it('recusa razão social vazia e capital negativo', () => {
    expect(CnpjRegistryRecord.safeParse({ ...record, legalName: '' }).success).toBe(false);
    expect(CnpjRegistryRecord.safeParse({ ...record, capitalCents: -1 }).success).toBe(false);
  });

  it('recusa CPF no nome empresarial ou fantasia (LGPD), com ou sem pontuação', () => {
    for (const name of ['MARIA EXEMPLO 12345678909', 'JOAO 123.456.789-09', 'ANA12345678909']) {
      expect(CnpjRegistryRecord.safeParse({ ...record, legalName: name }).success).toBe(false);
      expect(CnpjRegistryRecord.safeParse({ ...record, tradeName: name }).success).toBe(false);
    }
    // Número maior que um CPF (como um CNPJ no nome) não é confundido.
    expect(
      CnpjRegistryRecord.safeParse({ ...record, legalName: 'LOJA 11222333000181' }).success,
    ).toBe(true);
  });

  it('natureza jurídica: código de 4 dígitos, opcional', () => {
    expect(CnpjRegistryRecord.parse(record).legalNatureCode).toBeNull();
    expect(CnpjRegistryRecord.parse({ ...record, legalNatureCode: '2135' }).legalNatureCode).toBe(
      '2135',
    );
    expect(CnpjRegistryRecord.safeParse({ ...record, legalNatureCode: '21' }).success).toBe(false);
  });
});
