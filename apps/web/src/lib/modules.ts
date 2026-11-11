import {
  ChartColumn,
  Building2,
  CheckCheck,
  Compass,
  House,
  SquareKanban,
  MessagesSquare,
  Radar,
  Send,
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
  /** Barra superior (fluxo principal) ou trilho de ícones à esquerda (apoio). */
  placement: 'top' | 'rail';
  icon: LucideIcon;
}

export const MODULES: readonly ModuleDef[] = [
  {
    segment: '',
    label: 'Início',
    description: 'Fila de decisões do dia.',
    placement: 'top',
    icon: House,
    plannedSlice: null,
  },
  {
    segment: 'copiloto',
    label: 'Copiloto',
    description: 'Conversa com a IA local deste computador, com consulta aos dados salvos.',
    placement: 'rail',
    icon: Sparkles,
    plannedSlice: null,
  },
  {
    segment: 'descoberta',
    label: 'Descoberta',
    description: 'Buscas por ICP, linguagem natural ou lista importada.',
    placement: 'top',
    icon: Compass,
    plannedSlice: 'F4',
  },
  {
    segment: 'empresas',
    label: 'Empresas',
    description: 'Empresas acompanhadas, consulta de CNPJ e dossiês com evidências.',
    placement: 'top',
    icon: Building2,
    plannedSlice: null,
  },
  {
    segment: 'abordagens',
    label: 'Abordagens',
    description: 'Planos e revisão de mensagens.',
    placement: 'top',
    icon: Send,
    plannedSlice: 'F10',
  },
  {
    segment: 'aprovacoes',
    label: 'Aprovações',
    description: 'Tudo o que sai precisa de aprovação humana.',
    placement: 'rail',
    icon: CheckCheck,
    plannedSlice: 'F10',
  },
  {
    segment: 'conversas',
    label: 'Conversas',
    description: 'Respostas classificadas e opt-outs.',
    placement: 'top',
    icon: MessagesSquare,
    plannedSlice: 'F11',
  },
  {
    segment: 'pipeline',
    label: 'Pipeline',
    description: 'Oportunidades, reuniões e propostas.',
    placement: 'top',
    icon: SquareKanban,
    plannedSlice: 'F12',
  },
  {
    segment: 'monitoramento',
    label: 'Monitoramento',
    description: 'Watchlists e mudanças relevantes.',
    placement: 'rail',
    icon: Radar,
    plannedSlice: 'Fase 2',
  },
  {
    segment: 'inteligencia',
    label: 'Inteligência',
    description: 'Funil, custos, aprendizados e calibração.',
    placement: 'rail',
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
