import { describe, expect, it } from 'vitest';
import {
  CnaeCode,
  CnpjRoot,
  ContactPolicyContent,
  DomainName,
  IcpContent,
  LiaApprovalInput,
  LiaContent,
  OfferContent,
  Percent,
  PrivacyContact,
  ProofAssetInput,
  RubricContent,
  ScoringModelContent,
} from '../src';

describe('formatos de identificadores', () => {
  it.each([
    ['8630-5/04', '8630-5/04'],
    ['8630504', '8630-5/04'],
    [' 7319-0/02 ', '7319-0/02'],
  ])('CNAE %s → %s', (input, expected) => {
    expect(CnaeCode.parse(input)).toBe(expected);
  });

  it.each(['863050', '86305044', 'abc'])('CNAE inválido %s', (input) => {
    expect(CnaeCode.safeParse(input).success).toBe(false);
  });

  it('raiz de CNPJ numérica ou alfanumérica, sem pontuação', () => {
    expect(CnpjRoot.parse('12.345.678')).toBe('12345678');
    expect(CnpjRoot.parse('12abc345')).toBe('12ABC345');
    expect(CnpjRoot.safeParse('1234567').success).toBe(false);
  });

  it('domínio sem protocolo, www nem caminho', () => {
    expect(DomainName.parse('https://www.Empresa.com.br/contato?x=1')).toBe('empresa.com.br');
    expect(DomainName.safeParse('localhost').success).toBe(false);
    expect(DomainName.safeParse('empresa .com').success).toBe(false);
  });

  it('canal do titular: e-mail ou https', () => {
    expect(PrivacyContact.safeParse('privacidade@agencia.example').success).toBe(true);
    expect(PrivacyContact.safeParse('https://agencia.example/privacidade').success).toBe(true);
    expect(PrivacyContact.safeParse('http://agencia.example').success).toBe(false);
    expect(PrivacyContact.safeParse('ligue para nós').success).toBe(false);
  });

  it('canal do titular precisa ser público: o app é só local', () => {
    for (const local of [
      'https://127.0.0.1:3000/privacidade',
      'https://localhost/privacidade',
      'https://app.localhost',
      'https://intranet/privacidade',
      'https://[::1]/privacidade',
      'https://servidor.local',
      'https://usuario:senha@agencia.example',
      'dpo@localhost',
      'dpo@maquina.local',
    ]) {
      expect(PrivacyContact.safeParse(local).success, local).toBe(false);
    }
  });

  it('entradas gigantes falham rápido (sem ReDoS)', () => {
    const started = performance.now();
    expect(PrivacyContact.safeParse(`https://${'a.'.repeat(16_000)} x`).success).toBe(false);
    expect(
      DomainName.safeParse(`${'/'.repeat(32_000)}
x`).success,
    ).toBe(false);
    expect(performance.now() - started).toBeLessThan(200);
  });
});

describe('Percent', () => {
  it.each([0, 1, 50, 100])('aceita %s', (value) => {
    expect(Percent.safeParse(value).success).toBe(true);
  });
  it.each([-1, 101, 12.5, Number.NaN])('recusa %s', (value) => {
    expect(Percent.safeParse(value).success).toBe(false);
  });
});

describe('OfferContent', () => {
  it('preenche listas vazias e faixa nula', () => {
    expect(OfferContent.parse({ name: '  Branding  ' })).toEqual({
      name: 'Branding',
      description: '',
      problems: [],
      needSignals: [],
      disqualifiers: [],
      deliverables: [],
      valueProps: [],
      priceMinCents: null,
      priceMaxCents: null,
    });
  });

  it('recusa nome vazio, item vazio e valor negativo, com mensagem em pt-BR', () => {
    const result = OfferContent.safeParse({ name: ' ', problems: [''], priceMinCents: -1 });
    expect(result.success).toBe(false);
    const messages = result.error?.issues.map((i) => i.message) ?? [];
    expect(messages).toContain('Campo obrigatório.');
    expect(messages).toContain('Item vazio.');
    expect(messages).toContain('O valor não pode ser negativo.');
  });
});

describe('RubricContent', () => {
  const criterion = {
    key: 'consistencia_canais',
    label: 'Consistência entre canais',
    description: 'Logotipo, cores e tom iguais no site e nas redes.',
    weight: 100,
    evidenceRequired: ['site_desktop', 'social_grid'],
  };

  it('aceita critério válido', () => {
    expect(RubricContent.safeParse({ criteria: [criterion] }).success).toBe(true);
  });

  it('recusa chave fora do padrão, evidência desconhecida e rubrica vazia', () => {
    expect(
      RubricContent.safeParse({ criteria: [{ ...criterion, key: 'Com Espaço' }] }).success,
    ).toBe(false);
    expect(
      RubricContent.safeParse({ criteria: [{ ...criterion, evidenceRequired: ['instagram'] }] })
        .success,
    ).toBe(false);
    expect(RubricContent.safeParse({ criteria: [] }).success).toBe(false);
  });
});

describe('ScoringModelContent', () => {
  it('exige as cinco dimensões e os quatro limiares', () => {
    const valid = {
      weights: { fit: 25, need: 30, signal: 20, capacity: 15, timing: 10 },
      thresholds: {
        pursuePriority: 70,
        prepareAccessPotential: 70,
        discardPotential: 40,
        minEvidenceCoverage: 50,
      },
    };
    expect(ScoringModelContent.safeParse(valid).success).toBe(true);
    const { timing: _timing, ...fourWeights } = valid.weights;
    expect(ScoringModelContent.safeParse({ ...valid, weights: fourWeights }).success).toBe(false);
  });
});

describe('IcpContent', () => {
  it('normaliza CNAEs, raízes e domínios das exclusões', () => {
    const parsed = IcpContent.parse({
      name: 'Clínicas',
      filters: { cnaes: ['8630504'], ufs: ['PR'] },
      exclusions: { cnpjRoots: ['12.345.678'], domains: ['https://www.x.com.br/'] },
    });
    expect(parsed.filters.cnaes).toEqual(['8630-5/04']);
    expect(parsed.filters.sizes).toEqual([]);
    expect(parsed.exclusions).toEqual({
      cnaes: [],
      municipalities: [],
      cnpjRoots: ['12345678'],
      domains: ['x.com.br'],
    });
  });

  it('recusa UF inexistente e porte MEI', () => {
    expect(
      IcpContent.safeParse({ name: 'x', filters: { ufs: ['XX'] }, exclusions: {} }).success,
    ).toBe(false);
    expect(
      IcpContent.safeParse({ name: 'x', filters: { sizes: ['mei'] }, exclusions: {} }).success,
    ).toBe(false);
  });
});

describe('ProofAssetInput', () => {
  it('padrões: privado, sem oferta e sem autorização', () => {
    expect(ProofAssetInput.parse({ title: 'Case', summary: 'Resumo' })).toMatchObject({
      offerId: null,
      publicOk: false,
      consentRef: '',
    });
  });
});

describe('LiaContent e aprovação', () => {
  const lia = {
    purpose: 'p',
    legitimateInterest: 'l',
    necessity: 'n',
    dataCategories: ['name', 'work_email'],
    dataSources: ['company_website'],
    expectations: 'e',
    risks: 'r',
    safeguards: 's',
    conclusion: 'c',
  };

  it('aceita o modelo guiado completo', () => {
    expect(LiaContent.safeParse(lia).success).toBe(true);
  });

  it('não existe categoria de CPF nem de dado sensível', () => {
    expect(LiaContent.safeParse({ ...lia, dataCategories: ['cpf'] }).success).toBe(false);
    expect(LiaContent.safeParse({ ...lia, dataCategories: ['birth_date'] }).success).toBe(false);
  });

  it('exige ao menos uma categoria e uma origem', () => {
    expect(LiaContent.safeParse({ ...lia, dataCategories: [] }).success).toBe(false);
    expect(LiaContent.safeParse({ ...lia, dataSources: [] }).success).toBe(false);
  });

  it('aprovação: data de revisão em AAAA-MM-DD e confirmação explícita', () => {
    const ok = (value: unknown) => LiaApprovalInput.safeParse(value).success;
    expect(ok({ reviewDueOn: '2027-11-09', confirmed: true })).toBe(true);
    expect(ok({ reviewDueOn: '09/11/2027', confirmed: true })).toBe(false);
    expect(ok({ reviewDueOn: '2027-11-09' })).toBe(false);
    expect(ok({ reviewDueOn: '2027-11-09', confirmed: false })).toBe(false);
  });
});

describe('ContactPolicyContent', () => {
  it('exige identificação, canal do titular e texto de opt-out', () => {
    expect(
      ContactPolicyContent.safeParse({
        agencyName: 'Agência',
        privacyContact: 'privacidade@agencia.example',
        optOutText: 'Se preferir não receber mais mensagens, responda "remover".',
      }).success,
    ).toBe(true);
    expect(ContactPolicyContent.safeParse({ agencyName: 'Agência' }).success).toBe(false);
  });
});
