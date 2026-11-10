import type {
  EntityStatus,
  IcpContent,
  Municipality,
  OfferContent,
  ProofAssetInput,
  RubricContent,
  ScoringModelContent,
} from '@prospector/contracts';

/**
 * Regras de negócio da Estratégia (F2). Puras: recebem dados já no formato dos contratos e
 * devolvem a lista de problemas (vazia = válido). O campo usa o caminho do formulário
 * (`criteria.1.key`, `thresholds.discardPotential`) para a tela destacar o lugar certo.
 */
export interface Issue {
  field: string;
  code: string;
  message: string;
}

/** Pesos são pontos percentuais inteiros e somam 100 (= 1, docs/02 D2). */
export const WEIGHT_TOTAL = 100;

export function weightsTotal(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0);
}

function weightTotalIssue(values: readonly number[], field: string): Issue[] {
  const total = weightsTotal(values);
  if (total === WEIGHT_TOTAL) return [];
  return [
    {
      field,
      code: 'weights_total',
      message: `Os pesos somam ${total}; precisam somar exatamente ${WEIGHT_TOTAL}.`,
    },
  ];
}

/** Comparação sem caixa, acento nem espaços extras. */
export function normalizeLabel(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function duplicateIssue(items: readonly string[], field: string): Issue[] {
  const seen = new Set<string>();
  for (const item of items) {
    const key = normalizeLabel(item);
    if (seen.has(key)) {
      return [{ field, code: 'duplicate_item', message: `Item repetido: "${item.trim()}".` }];
    }
    seen.add(key);
  }
  return [];
}

// -----------------------------------------------------------------------------
// Oferta
// -----------------------------------------------------------------------------

const OFFER_LISTS = [
  'problems',
  'needSignals',
  'disqualifiers',
  'deliverables',
  'valueProps',
] as const;

export function offerContentIssues(content: OfferContent): Issue[] {
  const issues = OFFER_LISTS.flatMap((field) => duplicateIssue(content[field], field));
  const { priceMinCents: min, priceMaxCents: max } = content;
  if (min !== null && max !== null && min > max) {
    issues.push({
      field: 'priceMaxCents',
      code: 'price_range_inverted',
      message: 'O valor máximo precisa ser maior ou igual ao mínimo.',
    });
  }
  return issues;
}

/**
 * O que falta para a oferta ser utilizável pelos agentes (docs/02 D1): problemas, sinais de
 * necessidade, desqualificadores, entregáveis e faixa de investimento.
 */
export function offerCompletenessGaps(content: OfferContent | null): string[] {
  if (!content) return ['conteúdo da oferta'];
  const gaps: string[] = [];
  if (content.problems.length === 0) gaps.push('problemas que resolve');
  if (content.needSignals.length === 0) gaps.push('sinais de necessidade');
  if (content.disqualifiers.length === 0) gaps.push('desqualificadores');
  if (content.deliverables.length === 0) gaps.push('entregáveis');
  if (content.priceMinCents === null || content.priceMaxCents === null) {
    gaps.push('faixa de investimento');
  }
  return gaps;
}

/** Ativar a oferta exige conteúdo completo, rubrica e modelo de score (docs/02 D1, D2). */
export function offerActivationIssues(input: {
  current: OfferContent | null;
  hasRubric: boolean;
  hasScoringModel: boolean;
}): Issue[] {
  const issues: Issue[] = [];
  const gaps = offerCompletenessGaps(input.current);
  if (gaps.length > 0) {
    issues.push({
      field: '_form',
      code: 'offer_incomplete',
      message: `Complete a oferta: falta ${gaps.join(', ')}.`,
    });
  }
  if (!input.hasRubric) {
    issues.push({
      field: '_form',
      code: 'rubric_missing',
      message: 'Salve a rubrica de auditoria visual da oferta.',
    });
  }
  if (!input.hasScoringModel) {
    issues.push({
      field: '_form',
      code: 'scoring_model_missing',
      message: 'Salve o modelo de score (pesos e limiares) da oferta.',
    });
  }
  return issues;
}

const TRANSITIONS: Record<EntityStatus, readonly EntityStatus[]> = {
  draft: ['active', 'archived'],
  active: ['draft', 'archived'],
  archived: ['draft'],
};

/** Ciclo de vida de ofertas e ICPs: rascunho ⇄ ativo → arquivado → rascunho. */
export function canChangeStatus(from: EntityStatus, to: EntityStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

// -----------------------------------------------------------------------------
// Rubrica e modelo de score
// -----------------------------------------------------------------------------

export function rubricIssues(content: RubricContent): Issue[] {
  const issues: Issue[] = [];
  const keys = new Set<string>();
  content.criteria.forEach((criterion, index) => {
    if (keys.has(criterion.key)) {
      issues.push({
        field: `criteria.${index}.key`,
        code: 'duplicate_key',
        message: `O identificador "${criterion.key}" já é usado por outro critério.`,
      });
    }
    keys.add(criterion.key);
  });
  issues.push(
    ...weightTotalIssue(
      content.criteria.map((c) => c.weight),
      'criteria',
    ),
  );
  return issues;
}

export function scoringModelIssues(content: ScoringModelContent): Issue[] {
  const issues = weightTotalIssue(Object.values(content.weights), 'weights');
  const t = content.thresholds;
  if (t.discardPotential >= t.prepareAccessPotential || t.discardPotential >= t.pursuePriority) {
    issues.push({
      field: 'thresholds.discardPotential',
      code: 'thresholds_order',
      message:
        'O limiar de descarte precisa ficar abaixo dos limiares de "Abordar agora" e "Preparar acesso".',
    });
  }
  return issues;
}

// -----------------------------------------------------------------------------
// ICP
// -----------------------------------------------------------------------------

const municipalityKey = (m: Municipality) => `${normalizeLabel(m.name)}/${m.uf}`;

export function icpContentIssues(content: IcpContent): Issue[] {
  const issues: Issue[] = [];
  const { filters, exclusions } = content;
  if (
    filters.minAgeYears !== null &&
    filters.maxAgeYears !== null &&
    filters.minAgeYears > filters.maxAgeYears
  ) {
    issues.push({
      field: 'filters.maxAgeYears',
      code: 'age_range_inverted',
      message: 'A idade máxima precisa ser maior ou igual à mínima.',
    });
  }
  if (filters.ufs.length > 0) {
    const outside = filters.municipalities.filter((m) => !filters.ufs.includes(m.uf));
    if (outside.length > 0) {
      issues.push({
        field: 'filters.municipalities',
        code: 'municipality_outside_ufs',
        message: `Município fora das UFs escolhidas: ${outside.map((m) => `${m.name}/${m.uf}`).join(', ')}.`,
      });
    }
  }
  const conflictingCnaes = exclusions.cnaes.filter((code) => filters.cnaes.includes(code));
  if (conflictingCnaes.length > 0) {
    issues.push({
      field: 'exclusions.cnaes',
      code: 'include_exclude_conflict',
      message: `CNAE incluído e excluído ao mesmo tempo: ${conflictingCnaes.join(', ')}.`,
    });
  }
  const included = new Set(filters.municipalities.map(municipalityKey));
  const conflictingCities = exclusions.municipalities.filter((m) =>
    included.has(municipalityKey(m)),
  );
  if (conflictingCities.length > 0) {
    issues.push({
      field: 'exclusions.municipalities',
      code: 'include_exclude_conflict',
      message: `Município incluído e excluído ao mesmo tempo: ${conflictingCities.map((m) => `${m.name}/${m.uf}`).join(', ')}.`,
    });
  }
  return issues;
}

/** Um ICP ativo precisa recortar segmento (CNAE) ou região; sem isso a busca seria o país todo. */
export function icpActivationIssues(content: IcpContent): Issue[] {
  const { cnaes, ufs, municipalities } = content.filters;
  if (cnaes.length + ufs.length + municipalities.length > 0) return [];
  return [
    {
      field: '_form',
      code: 'icp_without_scope',
      message: 'Inclua ao menos um CNAE, UF ou município.',
    },
  ];
}

// -----------------------------------------------------------------------------
// Cases
// -----------------------------------------------------------------------------

/** Só case com autorização registrada pode ser citado em mensagens (docs/02 D1). */
export function proofAssetIssues(input: ProofAssetInput): Issue[] {
  if (input.publicOk && input.consentRef.trim() === '') {
    return [
      {
        field: 'consentRef',
        code: 'consent_required',
        message: 'Para marcar como citável, registre onde está a autorização do cliente.',
      },
    ];
  }
  return [];
}

// -----------------------------------------------------------------------------
// Versões
// -----------------------------------------------------------------------------

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical((value as Record<string, unknown>)[key])]),
    );
  }
  return value;
}

/** Conteúdos iguais (ordem das chaves não importa; ordem das listas, sim). Evita versão vazia. */
export function sameContent(a: unknown, b: unknown): boolean {
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}
