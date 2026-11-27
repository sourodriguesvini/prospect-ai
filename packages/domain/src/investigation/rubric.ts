/**
 * Rubrica da auditoria visual da investigação. Cada oferta pode ter a sua (Estratégia); a
 * investigação audita a marca uma vez só, com a união dos critérios das ofertas ativas. Sem
 * nenhuma rubrica cadastrada, vale a rubrica padrão abaixo (escala de 1 a 5).
 */

export interface VisualCriterion {
  key: string;
  label: string;
  description: string;
}

export const MAX_VISUAL_CRITERIA = 12;

export const DEFAULT_VISUAL_RUBRIC: readonly VisualCriterion[] = Object.freeze([
  {
    key: 'clareza_proposta',
    label: 'Clareza da proposta',
    description:
      'A página inicial deixa claro, em poucos segundos, o que a empresa faz, para quem e por que escolhê-la.',
  },
  {
    key: 'consistencia_visual',
    label: 'Consistência visual',
    description:
      'Cores, tipografia, ícones e estilo de imagem se repetem de forma coerente entre as seções e entre computador e celular.',
  },
  {
    key: 'hierarquia_legibilidade',
    label: 'Hierarquia e legibilidade',
    description: 'Títulos, contraste, tamanho de texto e espaçamento guiam a leitura sem esforço.',
  },
  {
    key: 'identidade_marca',
    label: 'Qualidade da identidade',
    description:
      'Logotipo nítido e bem aplicado; a marca tem presença própria e não parece modelo pronto.',
  },
  {
    key: 'adequacao_publico',
    label: 'Adequação ao público',
    description:
      'Estética e linguagem compatíveis com o público, o preço e a promessa que o site faz.',
  },
  {
    key: 'experiencia_celular',
    label: 'Experiência no celular',
    description:
      'Layout adaptado, botões fáceis de tocar, texto legível e nada saindo da tela no celular.',
  },
  {
    key: 'chamadas_acao',
    label: 'Chamadas para ação',
    description: 'Contato, agendamento ou compra aparecem com destaque e sem ambiguidade.',
  },
  {
    key: 'diferenciacao',
    label: 'Diferenciação',
    description: 'A marca se distingue das convenções genéricas do setor em vez de repeti-las.',
  },
]);

/**
 * União dos critérios das rubricas das ofertas ativas (a primeira de cada chave vale), até
 * `MAX_VISUAL_CRITERIA`; sem rubrica, a padrão.
 */
export function visualRubric(
  rubrics: ReadonlyArray<{
    offerId: string;
    content: { criteria: ReadonlyArray<{ key: string; label: string; description: string }> };
  }>,
  activeOfferIds: ReadonlySet<string>,
): VisualCriterion[] {
  const byKey = new Map<string, VisualCriterion>();
  for (const rubric of rubrics) {
    if (!activeOfferIds.has(rubric.offerId)) continue;
    for (const { key, label, description } of rubric.content.criteria) {
      if (!byKey.has(key)) byKey.set(key, { key, label, description });
    }
  }
  const criteria = [...byKey.values()].slice(0, MAX_VISUAL_CRITERIA);
  return criteria.length > 0 ? criteria : [...DEFAULT_VISUAL_RUBRIC];
}
