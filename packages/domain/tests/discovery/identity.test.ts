import { describe, expect, it } from 'vitest';
import {
  companyNameCore,
  distinctiveTokens,
  findSameCompany,
  homepageOf,
  hostCategory,
  hostOf,
  nameFoundIn,
  nameMatchesHost,
  normalizeCompanyName,
  prospectDedupeKey,
  registrableDomain,
  nameWithoutPlace,
  sameCompanyName,
  sameCompanyNameAt,
  siteKey,
  supportedEventDate,
} from '../../src';

describe('hosts', () => {
  it('normaliza o host e recusa endereços que não são http(s)', () => {
    expect(hostOf('https://WWW.Clinica-Exemplo.com.br/contato')).toBe('clinica-exemplo.com.br');
    expect(hostOf('ftp://exemplo.com.br')).toBeNull();
    expect(hostOf('não é endereço')).toBeNull();
  });

  it('acha o domínio registrável com o segundo nível do registro.br', () => {
    expect(registrableDomain('agenda.clinica.com.br')).toBe('clinica.com.br');
    expect(registrableDomain('blog.exemplo.com')).toBe('exemplo.com');
    expect(registrableDomain('clinica.med.br')).toBe('clinica.med.br');
  });

  it('classifica redes sociais, guias, notícias, vagas e governo', () => {
    expect(hostCategory('br.linkedin.com')).toBe('social');
    expect(hostCategory('www.doctoralia.com.br')).toBe('directory');
    expect(hostCategory('g1.globo.com')).toBe('news');
    expect(hostCategory('empresa.gupy.io')).toBe('job_board');
    expect(hostCategory('ribeiraopreto.sp.gov.br')).toBe('government');
    expect(hostCategory('clinicaexemplo.com.br')).toBeNull();
  });

  it('nunca usa portal, rede social ou diretório como site da empresa', () => {
    expect(siteKey('https://www.instagram.com/clinica')).toBeNull();
    expect(siteKey('https://www.doctoralia.com.br/clinicas/ribeirao-preto')).toBeNull();
    expect(siteKey('https://g1.globo.com/sp/ribeirao-preto/noticia/x.ghtml')).toBeNull();
    expect(siteKey('http://192.168.0.10/')).toBeNull();
  });

  it('usa o domínio registrável e separa sites em hospedagem compartilhada', () => {
    expect(siteKey('https://agenda.clinicavida.com.br/marcar')).toBe('clinicavida.com.br');
    expect(siteKey('https://clinicavida.wordpress.com/sobre')).toBe('clinicavida.wordpress.com');
    expect(siteKey('https://usuario.wixsite.com/clinicavida/contato')).toBe(
      'usuario.wixsite.com/clinicavida',
    );
    expect(siteKey('https://wordpress.com/')).toBeNull();
  });

  it('acha a página inicial do site', () => {
    expect(homepageOf('https://www.clinicavida.com.br/servicos?x=1')).toBe(
      'https://www.clinicavida.com.br/',
    );
    expect(homepageOf('https://usuario.wixsite.com/clinicavida/contato')).toBe(
      'https://usuario.wixsite.com/clinicavida',
    );
  });
});

describe('nomes', () => {
  it('tira acento, pontuação e forma jurídica', () => {
    expect(normalizeCompanyName('Clínica São Lucas Ltda.')).toBe('clinica sao lucas');
    expect(normalizeCompanyName('Odonto & Cia S/A')).toBe('odonto e');
    expect(normalizeCompanyName('ME')).toBe('me');
  });

  it('separa palavras que distinguem a empresa das palavras de segmento', () => {
    expect(distinctiveTokens('Clínica Médica Vida Plena')).toEqual(['vida', 'plena']);
  });

  it('só considera mesmo nome quando a forma normalizada é igual', () => {
    expect(sameCompanyName('Clínica Vida Plena LTDA', 'CLINICA VIDA PLENA')).toBe(true);
    expect(sameCompanyName('Clínica Vida', 'Clínica Vida Plena')).toBe(false);
  });

  // Achado da pesquisa real de 2026-11-11 (KI-117): o perfil do Instagram trazia a cidade no nome.
  it('tira a cidade e a UF da própria empresa do fim do nome, com o separador solto', () => {
    const places = ['Ribeirão Preto', 'SP'];
    expect(nameWithoutPlace('Clínica Quali Saúde l Ribeirão Preto', places)).toBe(
      'clinica quali saude',
    );
    expect(nameWithoutPlace('Pro Clínica - Ribeirão Preto/SP', places)).toBe('pro clinica');
    expect(nameWithoutPlace('Quali Saúde Franca', places)).toBe('quali saude franca');
    // O nome nunca some inteiro, e o lugar só sai do fim.
    expect(nameWithoutPlace('Ribeirão Preto', places)).toBe('ribeirao preto');
    expect(nameWithoutPlace('Ribeirão Preto Odontologia', places)).toBe(
      'ribeirao preto odontologia',
    );
  });

  it('acha o núcleo do nome para procurar entre as empresas já encontradas', () => {
    const places = ['Ribeirão Preto', 'SP'];
    expect(companyNameCore('Clínica Quali Saúde l Ribeirão Preto', places)).toBe('quali saude');
    expect(companyNameCore('Quali Saúde', places)).toBe('quali saude');
    expect(companyNameCore('Clínica Saúde', places)).toBe('saude');
  });

  it('junta o nome com a cidade no fim ou com palavras de segmento a mais no começo', () => {
    const places = ['Ribeirão Preto', 'SP'];
    expect(sameCompanyNameAt('Quali Saúde', 'Clínica Quali Saúde l Ribeirão Preto', places)).toBe(
      true,
    );
    expect(sameCompanyNameAt('Pro Clínica Ribeirão Preto', 'Pro Clínica', places)).toBe(true);
    expect(sameCompanyNameAt('Saúde Total', 'Clínica Saúde Total', places)).toBe(true);
    expect(sameCompanyNameAt('Eloclin', 'Clínica Eloclin', places)).toBe(true);
    expect(sameCompanyNameAt('Clínica Vida Plena LTDA', 'CLINICA VIDA PLENA', [])).toBe(true);
  });

  it('não junta nomes só parecidos nem nomes que viram só segmento sem o lugar', () => {
    const places = ['Ribeirão Preto', 'SP'];
    expect(sameCompanyNameAt('Clínica Vida', 'Clínica Vida Plena', places)).toBe(false);
    expect(sameCompanyNameAt('Hospital São Lucas', 'Clínica São Lucas', places)).toBe(false);
    expect(sameCompanyNameAt('Clínica Ribeirão Preto', 'Clínica SP', places)).toBe(false);
    expect(sameCompanyNameAt('Quali Saúde', 'Quali Saúde Franca', places)).toBe(false);
    expect(sameCompanyNameAt('Vida', 'Clínica Vida Ribeirão Preto', places)).toBe(false);
  });

  it('confere o nome com o endereço do site', () => {
    expect(nameMatchesHost('Clínica Vida Plena', 'vidaplena.com.br')).toBe(true);
    expect(nameMatchesHost('Hospital São Lucas Ribeirão', 'hslr.com.br')).toBe(true);
    expect(nameMatchesHost('Clínica Vida Plena', 'odontosorriso.com.br')).toBe(false);
  });

  it('acha o nome no texto da página', () => {
    expect(nameFoundIn('Clínica Vida Plena', 'Bem-vindo à CLÍNICA VIDA PLENA, em Ribeirão')).toBe(
      true,
    );
    expect(nameFoundIn('Clínica Vida Plena', 'Clínica Sorriso Feliz')).toBe(false);
  });
});

describe('deduplicação', () => {
  const known = [
    {
      id: 'a',
      name: 'Clínica Vida Plena',
      siteKey: 'vidaplena.com.br',
      city: 'Ribeirão Preto',
      uf: 'SP',
      cnpj: null,
    },
    {
      id: 'b',
      name: 'Odonto Sorriso',
      siteKey: null,
      city: 'Ribeirão Preto',
      uf: 'SP',
      cnpj: '11222333000181',
    },
    { id: 'c', name: 'Clínica Bem Estar', siteKey: null, city: 'Franca', uf: 'SP', cnpj: null },
  ];

  it('gera chave pelo site ou, sem site, por nome, cidade e UF', () => {
    expect(
      prospectDedupeKey({
        name: 'X',
        siteKey: 'vidaplena.com.br',
        city: null,
        uf: null,
        cnpj: null,
      }),
    ).toBe('domain:vidaplena.com.br');
    expect(
      prospectDedupeKey({
        name: 'Clínica Bem-Estar Ltda',
        siteKey: null,
        city: 'Franca',
        uf: 'SP',
        cnpj: null,
      }),
    ).toBe('name:clinica bem estar|franca|SP');
  });

  it('junta pelo mesmo site, mesmo com nome escrito diferente', () => {
    const match = findSameCompany(
      { name: 'Vida Plena Saúde', siteKey: 'vidaplena.com.br', city: null, uf: null, cnpj: null },
      known,
    );
    expect(match).toEqual({ target: known[0], reason: 'site' });
  });

  it('junta pela raiz do CNPJ (filial é a mesma empresa)', () => {
    const match = findSameCompany(
      {
        name: 'Sorriso Odontologia',
        siteKey: null,
        city: 'Sertãozinho',
        uf: 'SP',
        cnpj: '11222333000262',
      },
      known,
    );
    expect(match?.reason).toBe('cnpj');
    expect(match?.target.id).toBe('b');
  });

  it('junta por nome igual só na mesma cidade', () => {
    expect(
      findSameCompany(
        { name: 'CLÍNICA BEM ESTAR', siteKey: null, city: 'Franca', uf: 'SP', cnpj: null },
        known,
      )?.target.id,
    ).toBe('c');
    expect(
      findSameCompany(
        { name: 'Clínica Bem Estar', siteKey: null, city: 'Campinas', uf: 'SP', cnpj: null },
        known,
      ),
    ).toBeNull();
  });

  it('nunca junta dois sites diferentes, mesmo com o mesmo nome', () => {
    expect(
      findSameCompany(
        {
          name: 'Clínica Vida Plena',
          siteKey: 'vidaplenafranca.com.br',
          city: 'Ribeirão Preto',
          uf: 'SP',
          cnpj: null,
        },
        known,
      ),
    ).toBeNull();
  });

  it('junta o perfil com a cidade no nome ao site da mesma empresa (pesquisa real, KI-117)', () => {
    const site = {
      id: 'q',
      name: 'Quali Saúde',
      siteKey: 'qualisaudeclinicapopular.com.br',
      city: 'Ribeirão Preto',
      uf: 'SP',
      cnpj: null,
    };
    const profile = {
      name: 'Clínica Quali Saúde l Ribeirão Preto',
      siteKey: null,
      city: 'Ribeirão Preto',
      uf: 'SP',
      cnpj: null,
    };
    expect(findSameCompany(profile, [site])).toEqual({ target: site, reason: 'name_location' });
    // Em outra cidade, continua separada.
    expect(findSameCompany({ ...profile, city: 'Franca' }, [site])).toBeNull();
  });

  it('não junta nomes só parecidos', () => {
    expect(
      findSameCompany(
        { name: 'Clínica Vida', siteKey: null, city: 'Ribeirão Preto', uf: 'SP', cnpj: null },
        known,
      ),
    ).toBeNull();
  });
});

describe('data do acontecimento', () => {
  it('só aceita o que o texto sustenta (ano, mês e dia)', () => {
    const text = 'A Clínica Vida inaugurou em outubro de 2026 a nova unidade.';
    expect(supportedEventDate('2026-10', text)).toBe('2026-10');
    expect(supportedEventDate('2026-10-15', text)).toBe('2026-10');
    expect(supportedEventDate('2026-11', text)).toBe('2026');
    expect(supportedEventDate('2025-10', text)).toBeNull();
    // Texto sem data: a data de hoje devolvida pelo modelo não entra.
    expect(
      supportedEventDate('2026-11-11', 'Vaga de analista de marketing. Candidate-se.'),
    ).toBeNull();
    expect(supportedEventDate('2026-09-02', 'Publicado em 02/09/2026 no jornal.')).toBe(
      '2026-09-02',
    );
    expect(supportedEventDate('2026-09', 'Em set. de 2026 a loja abriu.')).toBe('2026-09');
    expect(supportedEventDate(null, 'qualquer texto 2026')).toBeNull();
  });
});
