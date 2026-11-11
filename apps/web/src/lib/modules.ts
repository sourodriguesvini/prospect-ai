import {
  ChartColumn,
  Building2,
  CheckCheck,
  Compass,
  House,
  MessagesSquare,
  Radar,
  Sparkles,
  type LucideIcon,
} from 'lucide-react';

/**
 * Navegação principal (arquitetura de informação de docs/07 §2). Módulos ainda não
 * construídos aparecem com a fatia que os entrega, sem conteúdo simulado.
 */
export interface ModuleDef {
  /** Segmento da URL (`/[segment]`); vazio = Início. */
  segment: string;
  label: string;
  description: string;
  /** Fatia do roadmap que entrega o módulo; null = disponível. */
  plannedSlice: string | null;
  /** Grupo no menu lateral: fluxo principal do trabalho ou apoio. */
  group: 'flow' | 'support';
  icon: LucideIcon;
}

export const MODULES: readonly ModuleDef[] = [
  {
    segment: '',
    label: 'Início',
    description: 'Fila de decisões do dia.',
    group: 'flow',
    icon: House,
    plannedSlice: null,
  },
  {
    segment: 'copiloto',
    label: 'Copiloto',
    description: 'Conversa com a IA local deste computador, com consulta aos dados salvos.',
    group: 'support',
    icon: Sparkles,
    plannedSlice: null,
  },
  {
    segment: 'descoberta',
    label: 'Descoberta',
    description: 'Buscas por ICP, linguagem natural ou lista importada.',
    group: 'flow',
    icon: Compass,
    plannedSlice: null,
  },
  {
    segment: 'empresas',
    label: 'Empresas',
    description: 'Empresas acompanhadas, consulta de CNPJ e dossiês com evidências.',
    group: 'flow',
    icon: Building2,
    plannedSlice: null,
  },
  {
    segment: 'relacionamento',
    label: 'Relacionamento',
    description: 'Abordagens, conversas e pipeline.',
    group: 'flow',
    icon: MessagesSquare,
    plannedSlice: null,
  },
  {
    segment: 'aprovacoes',
    label: 'Aprovações',
    description: 'Tudo o que sai precisa de aprovação humana.',
    group: 'support',
    icon: CheckCheck,
    plannedSlice: null,
  },
  {
    segment: 'monitoramento',
    label: 'Monitoramento',
    description: 'Watchlists e mudanças relevantes.',
    group: 'support',
    icon: Radar,
    plannedSlice: 'Fase 2',
  },
  {
    segment: 'inteligencia',
    label: 'Inteligência',
    description: 'Funil, custos, aprendizados e calibração.',
    group: 'support',
    icon: ChartColumn,
    plannedSlice: 'F13',
  },
];

export const PLACEHOLDER_MODULES = MODULES.filter((item) => item.plannedSlice !== null);

export function findPlaceholderModule(segment: string): ModuleDef | undefined {
  return PLACEHOLDER_MODULES.find((item) => item.segment === segment);
}

export function moduleHref(item: ModuleDef): string {
  return `/${item.segment}`;
}
