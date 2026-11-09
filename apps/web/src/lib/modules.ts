/**
 * Navegação principal (arquitetura de informação de docs/07 §2). Módulos ainda não
 * construídos aparecem com a fatia que os entrega, sem conteúdo simulado.
 */
export interface ModuleDef {
  /** Segmento da URL em /o/[slug]/[segment]; vazio = Início. */
  segment: string;
  label: string;
  description: string;
  /** Fatia do roadmap que entrega o módulo; null = disponível. */
  plannedSlice: string | null;
}

export const MODULES: readonly ModuleDef[] = [
  { segment: '', label: 'Início', description: 'Fila de decisões do dia.', plannedSlice: null },
  {
    segment: 'copiloto',
    label: 'Copiloto',
    description: 'Perguntas e pedidos em linguagem natural.',
    plannedSlice: 'F8',
  },
  {
    segment: 'descoberta',
    label: 'Descoberta',
    description: 'Buscas por ICP, linguagem natural ou lista importada.',
    plannedSlice: 'F4',
  },
  {
    segment: 'empresas',
    label: 'Empresas',
    description: 'Dossiês com evidências tipadas.',
    plannedSlice: 'F3',
  },
  {
    segment: 'abordagens',
    label: 'Abordagens',
    description: 'Planos e revisão de mensagens.',
    plannedSlice: 'F10',
  },
  {
    segment: 'aprovacoes',
    label: 'Aprovações',
    description: 'Tudo o que sai precisa de aprovação humana.',
    plannedSlice: 'F10',
  },
  {
    segment: 'conversas',
    label: 'Conversas',
    description: 'Respostas classificadas e opt-outs.',
    plannedSlice: 'F11',
  },
  {
    segment: 'pipeline',
    label: 'Pipeline',
    description: 'Oportunidades, reuniões e propostas.',
    plannedSlice: 'F12',
  },
  {
    segment: 'monitoramento',
    label: 'Monitoramento',
    description: 'Watchlists e mudanças relevantes.',
    plannedSlice: 'Fase 2',
  },
  {
    segment: 'inteligencia',
    label: 'Inteligência',
    description: 'Funil, custos, aprendizados e calibração.',
    plannedSlice: 'F13',
  },
];

export const PLACEHOLDER_MODULES = MODULES.filter((item) => item.plannedSlice !== null);

export function findPlaceholderModule(segment: string): ModuleDef | undefined {
  return PLACEHOLDER_MODULES.find((item) => item.segment === segment);
}
