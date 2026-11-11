import { FileCheck2, ScrollText, Settings, Target, type LucideIcon } from 'lucide-react';
import { MODULES, moduleHref, type ModuleDef } from './modules';
import { strategyRoutes } from './strategy-routes';

/**
 * Menu lateral (docs/07 §2 e §5): todos os menus ficam à esquerda, em grupos. A Configuração
 * abre o próprio submenu quando a tela atual é dela. A paleta de comandos (Ctrl+K) e os atalhos
 * de teclado leem daqui, para os três nunca divergirem.
 */
export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Fatia do roadmap que entrega a tela; null = disponível. */
  plannedSlice: string | null;
  /** Só a rota exata conta como ativa (Início). */
  exact: boolean;
  /** Tecla do atalho em sequência: "g" e depois esta tecla. */
  shortcut: string | null;
  /** Submenu, mostrado quando a tela atual está dentro deste item. */
  children: readonly NavItem[];
}

export interface NavGroup {
  id: string;
  label: string;
  items: readonly NavItem[];
}

/** Seções da Configuração: submenu do menu lateral e cartões da tela /configuracoes. */
export const SETTINGS_SECTIONS = [
  {
    href: strategyRoutes.overview,
    icon: Target,
    label: 'Estratégia',
    detail: 'Ofertas, rubricas, modelo de score, ICP, voz da agência e cases.',
  },
  {
    href: strategyRoutes.compliance,
    icon: FileCheck2,
    label: 'Conformidade',
    detail: 'LIA e texto de opt-out, condições para abordar pessoas.',
  },
  {
    href: '/configuracoes/auditoria',
    icon: ScrollText,
    label: 'Auditoria',
    detail: 'Registro imutável do que você, os agentes e o sistema fizeram.',
  },
] as const;

export const SETTINGS_HREF = '/configuracoes';

/** Atalhos "g + tecla" das telas mais usadas (Configuração: "s", de sistema). */
const MODULE_SHORTCUTS: Readonly<Record<string, string>> = {
  '': 'i',
  descoberta: 'd',
  empresas: 'e',
  copiloto: 'c',
  pipeline: 'p',
};

function moduleItem(item: ModuleDef): NavItem {
  return {
    href: moduleHref(item),
    label: item.label,
    icon: item.icon,
    plannedSlice: item.plannedSlice,
    exact: item.segment === '',
    shortcut: MODULE_SHORTCUTS[item.segment] ?? null,
    children: [],
  };
}

export const NAV_GROUPS: readonly NavGroup[] = [
  {
    id: 'fluxo',
    label: 'Fluxo',
    items: MODULES.filter((item) => item.group === 'flow').map(moduleItem),
  },
  {
    id: 'apoio',
    label: 'Apoio',
    items: MODULES.filter((item) => item.group === 'support').map(moduleItem),
  },
  {
    id: 'sistema',
    label: 'Sistema',
    items: [
      {
        href: SETTINGS_HREF,
        label: 'Configuração',
        icon: Settings,
        plannedSlice: null,
        exact: false,
        shortcut: 's',
        children: SETTINGS_SECTIONS.map((section) => ({
          href: section.href,
          label: section.label,
          icon: section.icon,
          plannedSlice: null,
          exact: false,
          shortcut: null,
          children: [],
        })),
      },
    ],
  },
];

/** A rota atual é este endereço (ou, sem `exact`, uma tela dentro dele)? */
export function isActivePath(pathname: string, href: string, exact = false): boolean {
  if (exact || href === '/') return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Submenu aberto: a tela atual está dentro do item. */
export function showsChildren(pathname: string, item: NavItem): boolean {
  return item.children.length > 0 && isActivePath(pathname, item.href, false);
}

/**
 * Endereço do item destacado (pílula de tinta e `aria-current`): o mais específico visível
 * que contém a rota atual. Só um item por vez recebe o destaque.
 */
export function activeHref(pathname: string, groups: readonly NavGroup[] = NAV_GROUPS) {
  for (const group of groups) {
    for (const item of group.items) {
      if (!isActivePath(pathname, item.href, item.exact)) continue;
      const child = showsChildren(pathname, item)
        ? item.children.find((c) => isActivePath(pathname, c.href, c.exact))
        : undefined;
      return child?.href ?? item.href;
    }
  }
  return null;
}

/** Todos os itens, com os do submenu, na ordem do menu. */
export function flattenNav(groups: readonly NavGroup[] = NAV_GROUPS): NavItem[] {
  return groups.flatMap((group) => group.items.flatMap((item) => [item, ...item.children]));
}

/** Atalhos "g + tecla" → endereço. */
export function shortcutTargets(groups: readonly NavGroup[] = NAV_GROUPS): Map<string, NavItem> {
  const map = new Map<string, NavItem>();
  for (const item of flattenNav(groups)) {
    if (item.shortcut) map.set(item.shortcut, item);
  }
  return map;
}

/** Nome acessível do item: telas ainda não entregues dizem que vêm em breve. */
export function navLabel(item: Pick<NavItem, 'label' | 'plannedSlice'>): string {
  return item.plannedSlice ? `${item.label} (em breve)` : item.label;
}
