import type { Source } from '@prospector/contracts';
import { describe, expect, it } from 'vitest';
import {
  SUBJECT_OWNED_ORIGIN,
  type SourceClassificationContext,
  classifySourceReliability,
  evidenceOrigin,
  sourceOrigin,
} from '../../src';
import { CLASSIFICATION, source } from './fixtures';

type Location = Pick<Source, 'kind' | 'url' | 'provider'>;

const CONTEXT: SourceClassificationContext = {
  officialProviders: ['base_cnpj'],
  ownedOrigins: ['https://www.Clinica.example.test/', 'instagram.example.test/clinica'],
  pressHosts: ['jornal.example.test'],
  aggregatorHosts: ['diretorio.example.test'],
};

function page(url: string, kind: Location['kind'] = 'web_page'): Location {
  return { kind, url, provider: null };
}

describe('classifySourceReliability', () => {
  it('anotação do usuário → user_reported', () => {
    expect(
      classifySourceReliability({ kind: 'user_note', url: null, provider: null }, CONTEXT),
    ).toBe('user_reported');
  });

  it('registro de provedor oficial → official_registry (sem diferenciar caixa)', () => {
    expect(
      classifySourceReliability(
        { kind: 'api_record', url: null, provider: ' Base_CNPJ ' },
        CONTEXT,
      ),
    ).toBe('official_registry');
  });

  it('registro de outro provedor → aggregator', () => {
    expect(
      classifySourceReliability(
        { kind: 'api_record', url: 'https://api.example.test/x', provider: 'enriquecedor' },
        CONTEXT,
      ),
    ).toBe('aggregator');
  });

  it.each([
    'https://clinica.example.test',
    'https://www.clinica.example.test/sobre',
    'https://blog.clinica.example.test/post',
    'HTTPS://CLINICA.EXAMPLE.TEST/Contato',
  ])('site da empresa (%s) → company_owned', (url) => {
    expect(classifySourceReliability(page(url), CONTEXT)).toBe('company_owned');
  });

  it.each([
    'https://outraclinica.example.test',
    'https://clinica.example.test.golpe.example/',
    'https://example.test',
  ])('domínio parecido (%s) não é da empresa', (url) => {
    expect(classifySourceReliability(page(url), CONTEXT)).toBe('unknown');
  });

  it('perfil da empresa na rede social → company_owned; outro perfil, não', () => {
    expect(
      classifySourceReliability(
        page('https://www.instagram.example.test/clinica/p/123', 'social_post'),
        CONTEXT,
      ),
    ).toBe('company_owned');
    expect(
      classifySourceReliability(
        page('https://instagram.example.test/clinica', 'social_post'),
        CONTEXT,
      ),
    ).toBe('company_owned');
    expect(
      classifySourceReliability(
        page('https://instagram.example.test/clinicaxyz', 'social_post'),
        CONTEXT,
      ),
    ).toBe('unknown');
  });

  it('imprensa e agregador pela lista de domínios', () => {
    expect(classifySourceReliability(page('https://jornal.example.test/a'), CONTEXT)).toBe(
      'recognized_press',
    );
    expect(classifySourceReliability(page('https://diretorio.example.test/b'), CONTEXT)).toBe(
      'aggregator',
    );
  });

  it('resultado de busca nunca passa de agregador', () => {
    expect(
      classifySourceReliability(page('https://clinica.example.test', 'search_result'), CONTEXT),
    ).toBe('aggregator');
    expect(
      classifySourceReliability(page('https://jornal.example.test/a', 'search_result'), CONTEXT),
    ).toBe('aggregator');
    expect(
      classifySourceReliability(page('https://blog.example.test', 'search_result'), CONTEXT),
    ).toBe('unknown');
  });

  it('compara domínio acentuado pelo punycode, sem ponto final nem versão móvel', () => {
    const context = { ...CONTEXT, ownedOrigins: ['Café.example.test'] };
    expect(classifySourceReliability(page('https://xn--caf-dma.example.test/a'), context)).toBe(
      'company_owned',
    );
    expect(classifySourceReliability(page('https://m.café.example.test./a'), context)).toBe(
      'company_owned',
    );
    expect(classifySourceReliability(page('https://mobile.jornal.example.test/a'), CONTEXT)).toBe(
      'recognized_press',
    );
  });

  it('as fontes de teste recebem a categoria que declaram', () => {
    for (const tier of [
      'official_registry',
      'company_owned',
      'recognized_press',
      'aggregator',
      'user_reported',
      'unknown',
    ] as const) {
      expect(classifySourceReliability(source(tier), CLASSIFICATION)).toBe(tier);
    }
  });

  it('endereço ilegível e listas vazias → unknown', () => {
    expect(classifySourceReliability(page('não é url'), CONTEXT)).toBe('unknown');
    expect(
      classifySourceReliability(page('https://clinica.example.test'), {
        officialProviders: [],
        ownedOrigins: ['', '  '],
        pressHosts: [],
        aggregatorHosts: [],
      }),
    ).toBe('unknown');
  });
});

describe('sourceOrigin', () => {
  it('registro de API pelo provedor', () => {
    expect(
      sourceOrigin({ kind: 'api_record', url: 'https://api.example.test', provider: 'Base_CNPJ' }),
    ).toBe('provider:base_cnpj');
  });

  it('páginas do mesmo site, com ou sem www, são a mesma origem', () => {
    expect(sourceOrigin(page('https://www.Clinica.example.test/a'))).toBe(
      sourceOrigin(page('https://clinica.example.test/b')),
    );
  });

  it('resultado de busca pela página encontrada, não pelo buscador', () => {
    expect(
      sourceOrigin({
        kind: 'search_result',
        url: 'https://jornal.example.test/a',
        provider: 'buscador',
      }),
    ).toBe('host:jornal.example.test');
  });

  it('sem endereço: provedor ou tipo', () => {
    expect(sourceOrigin({ kind: 'document', url: null, provider: 'Arquivo' })).toBe(
      'provider:arquivo',
    );
    expect(sourceOrigin({ kind: 'user_note', url: null, provider: null })).toBe('kind:user_note');
  });

  it('versão móvel e ponto final não mudam a origem', () => {
    expect(sourceOrigin(page('https://m.jornal.example.test./a'))).toBe(
      sourceOrigin(page('https://jornal.example.test/b')),
    );
  });
});

describe('evidenceOrigin', () => {
  it('tudo o que a própria empresa publica é uma origem só', () => {
    const site = page('https://clinica.example.test/sobre');
    const profile = page('https://instagram.example.test/clinica', 'social_post');
    expect(evidenceOrigin(site, 'company_owned')).toBe(SUBJECT_OWNED_ORIGIN);
    expect(evidenceOrigin(profile, 'company_owned')).toBe(SUBJECT_OWNED_ORIGIN);
  });

  it('as demais categorias seguem a origem da fonte', () => {
    const press = page('https://www.jornal.example.test/a');
    expect(evidenceOrigin(press, 'recognized_press')).toBe('host:jornal.example.test');
    expect(evidenceOrigin(page('https://clinica.example.test'), 'unknown')).toBe(
      'host:clinica.example.test',
    );
  });
});
