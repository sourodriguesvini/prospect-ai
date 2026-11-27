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
  it('Hoje só conta na rota exata', () => {
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
    // Fora do menu: destaca o item de onde a tela faz parte.
    ['/aprovacoes', '/relacionamento'],
    ['/monitoramento', '/empresas'],
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

  it('tem Estratégia, Conformidade, E-mail e Histórico de ações', () => {
    expect(settings.children.map((child) => child.label)).toEqual([
      'Estratégia',
      'Conformidade',
      'E-mail',
      'Histórico de ações',
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
    expect([...targets.keys()].sort()).toEqual(['c', 'd', 'e', 'h', 'i', 'r', 's']);
    expect(targets.get('h')?.href).toBe('/');
    expect(targets.get('c')?.href).toBe('/relacionamento');
    expect(targets.get('i')?.href).toBe('/copiloto');
    expect(targets.get('e')?.href).toBe('/empresas');
    expect(targets.get('s')?.href).toBe('/configuracoes');
  });

  it('jornada com quatro passos e apoio com Copiloto e Resultados', () => {
    const labels = (id: string) =>
      NAV_GROUPS.find((group) => group.id === id)?.items.map((item) => item.label);
    expect(labels('fluxo')).toEqual(['Hoje', 'Descobrir', 'Empresas', 'Conversas']);
    expect(labels('apoio')).toEqual(['Copiloto', 'Resultados']);
  });

  it('Aprovações e Monitoramento saem do menu, mas continuam na paleta', () => {
    const hrefs = flattenNav().map((item) => item.href);
    expect(hrefs).not.toContain('/aprovacoes');
    expect(hrefs).not.toContain('/monitoramento');
  });

  it('tela ainda não entregue diz que vem em breve no nome acessível', () => {
    expect(navLabel({ label: 'Descoberta', plannedSlice: 'F4' })).toBe('Descoberta (em breve)');
    expect(navLabel({ label: 'Empresas', plannedSlice: null })).toBe('Empresas');
  });
});
