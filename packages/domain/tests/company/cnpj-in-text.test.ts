import { COMPANY_CNPJ_KEY } from '@prospector/contracts';
import { describe, expect, it } from 'vitest';
import { findCnpjsInText, linkedCnpjFromClaims, registryNameMatches } from '../../src';

/** CNPJs SINTÉTICOS (dígitos verificadores válidos, sem empresa real por trás) e nomes de exemplo. */
const STORE = '11222333000181';
const BRANCH = '11222333000262';
const AGENCY = '44555666000181';
const OTHER = '77888999000181';
const ALPHA = '12ABC345000188';

describe('findCnpjsInText', () => {
  it('acha o CNPJ do rodapé com e sem pontuação, com o rótulo no trecho citado', () => {
    const text = [
      'Ração, banho e tosa',
      '© 2026 Exemplo Pet Center Ltda - CNPJ: 11.222.333/0001-81 - Rua Teste, 10',
    ].join('\n');
    expect(findCnpjsInText(text)).toEqual([
      { cnpj: STORE, quote: 'CNPJ: 11.222.333/0001-81', thirdParty: false },
    ]);
    expect(findCnpjsInText('CNPJ 11222333000181 · todos os direitos reservados')).toEqual([
      { cnpj: STORE, quote: 'CNPJ 11222333000181', thirdParty: false },
    ]);
    expect(findCnpjsInText('C.N.P.J./MF nº 11.222.333/000181')[0]?.cnpj).toBe(STORE);
    expect(findCnpjsInText('Inscrita sob o 11.222.333/0001-81.')[0]?.quote).toBe(
      '11.222.333/0001-81',
    );
  });

  it('aceita o CNPJ com letras e confere os dígitos verificadores', () => {
    expect(findCnpjsInText('CNPJ 12.ABC.345/0001-88')[0]?.cnpj).toBe(ALPHA);
    // Dígitos errados e sequência repetida ficam de fora.
    expect(findCnpjsInText('CNPJ: 11.222.333/0001-80')).toEqual([]);
    expect(findCnpjsInText('CNPJ: 00.000.000/0000-00')).toEqual([]);
  });

  it('não pega número solto de 14 dígitos sem o rótulo (telefone, código, pedido)', () => {
    expect(findCnpjsInText('Pedido 11222333000181 enviado')).toEqual([]);
    expect(findCnpjsInText('Código 11222333000181123')).toEqual([]);
  });

  it('marca como de terceiro o CNPJ de quem fez o site, da hospedagem ou do pagamento', () => {
    const text = [
      'Exemplo Pet Center - CNPJ 11.222.333/0001-81',
      'Desenvolvido por Agência Modelo Digital - CNPJ 44.555.666/0001-81',
      'Pagamentos processados por Intermediadora Teste CNPJ 77.888.999/0001-81',
    ].join('\n');
    expect(findCnpjsInText(text)).toEqual([
      { cnpj: STORE, quote: 'CNPJ 11.222.333/0001-81', thirdParty: false },
      { cnpj: AGENCY, quote: 'CNPJ 44.555.666/0001-81', thirdParty: true },
      { cnpj: OTHER, quote: 'CNPJ 77.888.999/0001-81', thirdParty: true },
    ]);
  });

  it('formas de pagamento na linha de cima não fazem o CNPJ da loja virar de terceiro', () => {
    const text = 'Formas de pagamento: cartão e Pix\nExemplo Pet Center CNPJ 11.222.333/0001-81';
    expect(findCnpjsInText(text)[0]?.thirdParty).toBe(false);
  });

  it('o mesmo CNPJ visto duas vezes conta uma, e só é de terceiro se as duas forem', () => {
    const text = 'Site por Exemplo CNPJ 11.222.333/0001-81\nLoja Exemplo CNPJ 11.222.333/0001-81';
    expect(findCnpjsInText(text)).toEqual([
      { cnpj: STORE, quote: 'CNPJ 11.222.333/0001-81', thirdParty: false },
    ]);
    expect(findCnpjsInText(`matriz 11.222.333/0001-81, filial 11.222.333/0002-62`)).toHaveLength(2);
    expect(findCnpjsInText('filial 11.222.333/0002-62')[0]?.cnpj).toBe(BRANCH);
  });
});

describe('registryNameMatches', () => {
  const company = {
    displayName: 'Exemplo Pet Center',
    city: 'Curitiba',
    uf: 'PR',
    primaryDomain: 'exemplopetcenter.com.br',
  };

  it('aceita a razão social ou o nome fantasia da mesma empresa', () => {
    expect(
      registryNameMatches(company, {
        legalName: 'EXEMPLO PET CENTER COMERCIO DE RACOES LTDA',
        tradeName: null,
      }),
    ).toBe(true);
    expect(
      registryNameMatches(company, {
        legalName: 'ZXY PARTICIPACOES LTDA',
        tradeName: 'EXEMPLO PET CENTER',
      }),
    ).toBe(true);
    // Nome escrito junto na Receita.
    expect(
      registryNameMatches(
        { ...company, displayName: 'Hiper Exemplo', primaryDomain: null },
        { legalName: 'HIPEREXEMPLO COMERCIO DE ARTIGOS LTDA', tradeName: null },
      ),
    ).toBe(true);
    // Nome da Receita no endereço do site.
    expect(
      registryNameMatches(
        { ...company, displayName: 'Loja do Exemplo', primaryDomain: 'hiperexemplo.com.br' },
        { legalName: 'HIPEREXEMPLO COMERCIO LTDA', tradeName: null },
      ),
    ).toBe(true);
  });

  it('recusa a agência que fez o site, outra empresa e nome comum demais', () => {
    expect(
      registryNameMatches(company, {
        legalName: 'AGENCIA MODELO DIGITAL LTDA',
        tradeName: 'MODELO DIGITAL',
      }),
    ).toBe(false);
    expect(
      registryNameMatches(company, { legalName: 'CLINICA AMIGO FIEL LTDA', tradeName: null }),
    ).toBe(false);
    // Domínio curto não basta para ligar qualquer nome do ramo.
    expect(
      registryNameMatches(
        { displayName: 'Ateliê Rosa', city: null, uf: null, primaryDomain: 'pet.com.br' },
        { legalName: 'PET SHOP QUALQUER LTDA', tradeName: null },
      ),
    ).toBe(false);
  });
});

describe('linkedCnpjFromClaims', () => {
  it('devolve o CNPJ do fato em vigor e ignora substituído, rejeitado e inválido', () => {
    const claims = [
      { id: 'a', key: 'registry.status', status: 'active', value: { status: 'active' } },
      { id: 'b', key: COMPANY_CNPJ_KEY, status: 'superseded', value: { cnpj: OTHER } },
      { id: 'c', key: COMPANY_CNPJ_KEY, status: 'active', value: { cnpj: '123' } },
      {
        id: 'd',
        key: COMPANY_CNPJ_KEY,
        status: 'active',
        value: { cnpj: STORE, origin: 'company_site', url: 'https://exemplo.test/' },
      },
    ];
    expect(linkedCnpjFromClaims(claims)).toEqual({
      cnpj: STORE,
      origin: 'company_site',
      url: 'https://exemplo.test/',
      claimId: 'd',
    });
    expect(linkedCnpjFromClaims(claims.slice(0, 3))).toBeNull();
  });
});
