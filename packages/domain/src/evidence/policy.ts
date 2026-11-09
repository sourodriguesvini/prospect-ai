import type { ClaimDomain, SourceReliabilityTier } from '@prospector/contracts';

/**
 * Parâmetros calibráveis do cálculo de confiança (docs/08 §2.2 e §2.5). Os valores marcados
 * "proposta" não estão fixados no doc 08: foram propostos na F3a e ficam registrados no doc 08
 * §2.5 até a calibração (docs/08 §3.5) ou decisão do usuário.
 */
export interface EvidencePolicy {
  /** Confiabilidade por categoria de fonte. */
  readonly reliability: Readonly<Record<SourceReliabilityTier, number>>;
  /** Validade em dias por domínio do claim: até ela a atualidade é 1,0. */
  readonly validityDays: Readonly<Record<ClaimDomain, number>>;
  /** Validade por `key` do catálogo de claims; tem prioridade sobre a do domínio. */
  readonly keyValidityDays: Readonly<Record<string, number>>;
  /** Acréscimo por fonte independente que concorda (docs/08 §2.2). */
  readonly concordanceBonus: number;
  /** Teto da confiança de um claim contestado (docs/08 §2.2). */
  readonly disputedMaxConfidence: number;
  /** Categorias que não contam como fonte independente concordante (proposta). */
  readonly concordanceExcludedTiers: readonly SourceReliabilityTier[];
}

export const DEFAULT_EVIDENCE_POLICY: EvidencePolicy = Object.freeze({
  reliability: Object.freeze({
    official_registry: 0.95,
    company_owned: 0.85,
    recognized_press: 0.8,
    aggregator: 0.6,
    user_reported: 0.7, // proposta
    unknown: 0.4,
  }),
  validityDays: Object.freeze({
    firmographic: 90, // doc 08: dados cadastrais
    digital_presence: 30, // doc 08: conteúdo de site
    visual: 180, // doc 08: auditoria visual
    positioning: 90, // proposta
    signal: 30, // proposta; o tipo de sinal define a própria validade via keyValidityDays
    contact: 90, // proposta
    competitive: 180, // proposta
    financial_proxy: 180, // proposta
  }),
  keyValidityDays: Object.freeze({}),
  concordanceBonus: 0.05,
  disputedMaxConfidence: 0.5,
  concordanceExcludedTiers: Object.freeze(['unknown'] as const),
});

export function validityDaysFor(
  domain: ClaimDomain,
  key: string,
  policy: EvidencePolicy = DEFAULT_EVIDENCE_POLICY,
): number {
  // hasOwn: uma chave como "constructor" não pode cair no protótipo do objeto.
  const days = Object.hasOwn(policy.keyValidityDays, key)
    ? policy.keyValidityDays[key]
    : policy.validityDays[domain];
  if (days === undefined || !(days > 0)) {
    throw new RangeError(`Validade inválida para ${key}: ${days}.`);
  }
  return days;
}
