import { describe, expect, it } from 'vitest';
import {
  activeHref,
  flattenNav,
  isActivePath,
  NAV_GROUPS,
  navLabel,
  shortcutTargets,
  showsChildren,
} from './navigation';

describe('isActivePath', () => {
  it('Início só conta na rota exata', () => {
    expect(isActivePath('/', '/')).toBe(true);
    expect(isActivePath('/empresas', '/')).toBe(false);
  });

  it('conta a própria tela e as de dentro, sem confundir prefixo de palavra', () => {
    expect(isActivePath('/empresas', '/empresas')).toBe(true);
    expect(isActivePath('/empresas/123', '/empresas')).toBe(true);
    expect(isActivePath('/empresas-antigas', '/empresas')).toBe(false);
    expect(isActivePath('/empresas/123', '/empresas', true)).toBe(false);
  });
});

describe('activeHref (um só item destacado)', () => {
  it.each([
    ['/', '/'],
    ['/empresas/abc', '/empresas'],
    ['/copiloto', '/copiloto'],
    ['/descoberta', '/descoberta'],
    ['/configuracoes', '/configuracoes'],
    ['/configuracoes/estrategia/ofertas/nova', '/configuracoes/estrategia'],
    ['/configuracoes/conformidade/lia', '/configuracoes/conformidade'],
    ['/configuracoes/auditoria', '/configuracoes/auditoria'],
  ])('%s → %s', (pathname, expected) => {
    expect(activeHref(pathname)).toBe(expected);
  });

  it('rota fora do menu não destaca nada', () => {
    expect(activeHref('/nada')).toBeNull();
  });
});

describe('submenu da Configuração', () => {
  const settings = NAV_GROUPS.flatMap((group) => group.items).find(
    (item) => item.href === '/configuracoes',
  )!;

  it('abre só dentro da Configuração', () => {
    expect(showsChildren('/configuracoes/auditoria', settings)).toBe(true);
    expect(showsChildren('/configuracoes', settings)).toBe(true);
    expect(showsChildren('/empresas', settings)).toBe(false);
  });

  it('tem Estratégia, Conformidade e Auditoria', () => {
    expect(settings.children.map((child) => child.label)).toEqual([
      'Estratégia',
      'Conformidade',
      'Auditoria',
    ]);
  });
});

describe('itens e atalhos', () => {
  it('todo endereço aparece uma vez só', () => {
    const hrefs = flattenNav().map((item) => item.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  it('atalhos "g + tecla" não se repetem e levam a telas do menu', () => {
    const targets = shortcutTargets();
    expect([...targets.keys()].sort()).toEqual(['c', 'd', 'e', 'i', 'p', 's']);
    expect(targets.get('e')?.href).toBe('/empresas');
    expect(targets.get('s')?.href).toBe('/configuracoes');
  });

  it('tela ainda não entregue diz que vem em breve no nome acessível', () => {
    expect(navLabel({ label: 'Descoberta', plannedSlice: 'F4' })).toBe('Descoberta (em breve)');
    expect(navLabel({ label: 'Empresas', plannedSlice: null })).toBe('Empresas');
  });
});
