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
 * Telas principais (proposta de 26/11, aprovada como direção). A jornada tem quatro passos (Hoje,
 * Descobrir, Empresas, Conversas); Copiloto e Resultados são apoio. Aprovações e Monitoramento
 * continuam existindo nos mesmos endereços, mas saem do menu: o que pede ação delas aparece em
 * Hoje e em Conversas, e a paleta (Ctrl+K) leva direto a elas.
 */
export interface ModuleDef {
  /** Segmento da URL (`/[segment]`); vazio = Hoje. */
  segment: string;
  label: string;
  description: string;
  /** Fatia do roadmap que entrega o módulo; null = disponível. */
  plannedSlice: string | null;
  /** Grupo no menu lateral: jornada principal ou apoio; null = fora do menu (só paleta e links). */
  group: 'flow' | 'support' | null;
  icon: LucideIcon;
}

export const MODULES: readonly ModuleDef[] = [
  {
    segment: '',
    label: 'Hoje',
    description: 'O que precisa da sua atenção agora: respostas, mensagens, follow-ups e empresas.',
    group: 'flow',
    icon: House,
    plannedSlice: null,
  },
  {
    segment: 'descoberta',
    label: 'Descobrir',
    description: 'Pesquisas de empresas em linguagem natural, com a fonte de cada motivo.',
    group: 'flow',
    icon: Compass,
    plannedSlice: null,
  },
  {
    segment: 'empresas',
    label: 'Empresas',
    description: 'Empresas acompanhadas, com a análise comercial e as evidências de cada uma.',
    group: 'flow',
    icon: Building2,
    plannedSlice: null,
  },
  {
    segment: 'relacionamento',
    label: 'Conversas',
    description: 'Mensagens para revisar e enviar, conversas em andamento e funil.',
    group: 'flow',
    icon: MessagesSquare,
    plannedSlice: null,
  },
  {
    segment: 'copiloto',
    label: 'Copiloto',
    description: 'Conversa com a IA deste computador, com consulta aos dados salvos.',
    group: 'support',
    icon: Sparkles,
    plannedSlice: null,
  },
  {
    segment: 'inteligencia',
    label: 'Resultados',
    description: 'Funil de prospecção e gasto do mês.',
    group: 'support',
    icon: ChartColumn,
    plannedSlice: null,
  },
  {
    segment: 'aprovacoes',
    label: 'Aprovações',
    description: 'Mensagens aprovadas e esperando aprovação; nada sai sem você.',
    group: null,
    icon: CheckCheck,
    plannedSlice: null,
  },
  {
    segment: 'monitoramento',
    label: 'Monitoramento',
    description: 'Empresas para rever e novidades das buscas automáticas.',
    group: null,
    icon: Radar,
    plannedSlice: null,
  },
];

export function moduleHref(item: ModuleDef): string {
  return `/${item.segment}`;
}
