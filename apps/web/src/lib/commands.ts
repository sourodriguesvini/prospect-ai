import {
  Building2,
  FileCheck2,
  Keyboard,
  Monitor,
  Moon,
  PanelLeft,
  Plus,
  Sun,
  Target,
  type LucideIcon,
} from 'lucide-react';
import { z } from 'zod';
import { companyRoutes } from './company-routes';
import { flattenNav, navLabel, type NavGroup, NAV_GROUPS } from './navigation';
import { strategyRoutes } from './strategy-routes';

/**
 * Paleta de comandos (Ctrl+K): ir a qualquer tela ou rodar uma ação da interface. Função pura
 * para filtrar e ordenar; quem executa é o componente (navegar, trocar tema, recolher o menu).
 */
export type CommandAction =
  | { kind: 'navigate'; href: string }
  | { kind: 'theme'; theme: 'light' | 'dark' | 'system' }
  | { kind: 'toggle-sidebar' }
  | { kind: 'shortcuts' };

export type CommandGroup = 'Telas' | 'Criar' | 'Interface' | 'Empresas';

/** Empresa achada pela busca da paleta (rota /api/busca). */
export const CompanySearchHit = z.object({
  id: z.string(),
  name: z.string(),
  /** Cidade/UF, quando conhecida. */
  place: z.string().nullable(),
  isDemo: z.boolean(),
  /** Link interno para o dossiê (nunca endereço externo). */
  href: z.string().startsWith('/'),
});
export type CompanySearchHit = z.infer<typeof CompanySearchHit>;

/** Resposta da rota /api/busca: o contrato vale nos dois lados (rota e paleta). */
export const CompanySearchReply = z.object({
  hits: z.array(CompanySearchHit),
  /** Aviso em pt-BR quando a busca de empresas não pôde ser feita. */
  error: z.string().optional(),
});
export type CompanySearchReply = z.infer<typeof CompanySearchReply>;

/** Empresas viram comandos de "ir para o dossiê"; dados de demonstração levam o selo. */
export function companyCommands(hits: readonly CompanySearchHit[]): Command[] {
  return hits.map((hit) => ({
    id: `empresa:${hit.id}`,
    label: hit.name,
    group: 'Empresas',
    hint: hit.place,
    keywords: [],
    keys: [],
    demo: hit.isDemo,
    icon: Building2,
    action: { kind: 'navigate', href: hit.href },
  }));
}

/**
 * Lista vazia: em vez de só "nada encontrado", oferece buscar o texto na tela Empresas (que
 * também procura por CNPJ e domínio e mostra as arquivadas pelo filtro).
 */
export function searchInCompaniesCommand(query: string): Command {
  const text = query.trim();
  return {
    id: 'empresas:buscar',
    label: `Buscar “${text}” em Empresas`,
    group: 'Empresas',
    hint: 'Abre a lista de empresas com este filtro',
    keywords: [],
    keys: [],
    icon: Building2,
    action: { kind: 'navigate', href: `${companyRoutes.list}?busca=${encodeURIComponent(text)}` },
  };
}

export interface Command {
  id: string;
  label: string;
  group: CommandGroup;
  /** Linha de apoio (onde fica, o que faz). */
  hint: string | null;
  /** Outras palavras que acham o comando (sem acento, minúsculas). */
  keywords: readonly string[];
  /** Teclas do atalho, para mostrar ao lado (ex.: ["G", "E"]). */
  keys: readonly string[];
  /** Registro de demonstração (selo DEMO). */
  demo?: boolean;
  icon: LucideIcon;
  action: CommandAction;
}

/** Minúsculas e sem acento: "Configuração" e "configuracao" se acham. */
export function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();
}

const navigate = (href: string): CommandAction => ({ kind: 'navigate', href });

/** Telas do menu lateral e as subtelas mais usadas da Configuração. */
export function screenCommands(groups: readonly NavGroup[] = NAV_GROUPS): Command[] {
  const fromNav: Command[] = flattenNav(groups).map((item) => ({
    id: `tela:${item.href}`,
    label: item.label,
    group: 'Telas',
    hint: item.plannedSlice ? `Em breve (${item.plannedSlice})` : null,
    keywords: [normalize(navLabel(item))],
    keys: item.shortcut ? ['G', item.shortcut.toUpperCase()] : [],
    icon: item.icon,
    action: navigate(item.href),
  }));
  const extra = (
    [
      ['Voz da agência', strategyRoutes.voice, 'Estratégia', ['tom', 'escrita']],
      ['Cases', strategyRoutes.cases, 'Estratégia', ['provas', 'portfolio']],
      ['LIA (legítimo interesse)', strategyRoutes.lia, 'Conformidade', ['lgpd', 'base legal']],
      ['Texto de opt-out', strategyRoutes.contactPolicy, 'Conformidade', ['descadastro', 'lgpd']],
    ] as const
  ).map(([label, href, parent, keywords]): Command => ({
    id: `tela:${href}`,
    label,
    group: 'Telas',
    hint: `Configuração › ${parent}`,
    keywords: keywords.map(normalize),
    keys: [],
    icon: parent === 'Estratégia' ? Target : FileCheck2,
    action: navigate(href),
  }));
  return [...fromNav, ...extra];
}

export const CREATE_COMMANDS: readonly Command[] = [
  {
    id: 'criar:empresa',
    label: 'Adicionar empresa',
    group: 'Criar',
    hint: 'Consulta o CNPJ e abre o dossiê',
    keywords: ['nova empresa', 'cnpj', 'cadastrar'],
    keys: [],
    icon: Plus,
    action: navigate(companyRoutes.create),
  },
  {
    id: 'criar:conversa',
    label: 'Nova conversa no Copiloto',
    group: 'Criar',
    hint: null,
    keywords: ['perguntar', 'ia', 'chat'],
    keys: [],
    icon: Plus,
    action: navigate('/copiloto'),
  },
  {
    id: 'criar:oferta',
    label: 'Nova oferta',
    group: 'Criar',
    hint: 'Configuração › Estratégia',
    keywords: ['servico', 'produto'],
    keys: [],
    icon: Plus,
    action: navigate(strategyRoutes.newOffer),
  },
];

/** Ações da interface; o rótulo do menu muda conforme ele está recolhido ou não. */
/**
 * Ações da interface. No celular o menu é gaveta (não recolhe): o comando de recolher sai da
 * lista (`collapsible` falso).
 */
export function interfaceCommands(sidebarCollapsed: boolean, collapsible = true): Command[] {
  const menu: Command[] = collapsible
    ? [
        {
          id: 'interface:menu',
          label: sidebarCollapsed ? 'Expandir o menu lateral' : 'Recolher o menu lateral',
          group: 'Interface',
          hint: null,
          keywords: ['sidebar', 'barra lateral', 'esconder', 'mostrar'],
          keys: ['Ctrl', 'B'],
          icon: PanelLeft,
          action: { kind: 'toggle-sidebar' },
        },
      ]
    : [];
  return [
    ...menu,
    {
      id: 'interface:tema-claro',
      label: 'Tema claro',
      group: 'Interface',
      hint: null,
      keywords: ['aparencia', 'cores', 'light'],
      keys: [],
      icon: Sun,
      action: { kind: 'theme', theme: 'light' },
    },
    {
      id: 'interface:tema-escuro',
      label: 'Tema escuro',
      group: 'Interface',
      hint: null,
      keywords: ['aparencia', 'cores', 'dark', 'noite'],
      keys: [],
      icon: Moon,
      action: { kind: 'theme', theme: 'dark' },
    },
    {
      id: 'interface:tema-sistema',
      label: 'Tema do sistema',
      group: 'Interface',
      hint: 'Segue o claro ou escuro do Windows',
      keywords: ['aparencia', 'cores', 'automatico'],
      keys: [],
      icon: Monitor,
      action: { kind: 'theme', theme: 'system' },
    },
    {
      id: 'interface:atalhos',
      label: 'Atalhos de teclado',
      group: 'Interface',
      hint: null,
      keywords: ['teclas', 'ajuda', 'shortcuts'],
      keys: ['?'],
      icon: Keyboard,
      action: { kind: 'shortcuts' },
    },
  ];
}

/**
 * Filtra por todas as palavras digitadas (em qualquer ordem, sem acento) e ordena: começo do
 * nome, começo de palavra do nome, meio do nome, palavra-chave. Empate mantém a ordem original.
 */
export function filterCommands(commands: readonly Command[], query: string): Command[] {
  const tokens = normalize(query).split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [...commands];
  const scored: { command: Command; score: number; index: number }[] = [];
  commands.forEach((command, index) => {
    const label = normalize(command.label);
    const haystack = [label, normalize(command.hint ?? ''), ...command.keywords].join(' ');
    if (!tokens.every((token) => haystack.includes(token))) return;
    const first = tokens[0]!;
    const score = label.startsWith(first)
      ? 0
      : label.split(/[\s›()-]+/).some((word) => word.startsWith(first))
        ? 1
        : label.includes(first)
          ? 2
          : 3;
    scored.push({ command, score, index });
  });
  return scored
    .sort((a, b) => a.score - b.score || a.index - b.index)
    .map((entry) => entry.command);
}
