import type {
  ClaimDomain,
  ClaimStatus,
  CompanyOrigin,
  CompanySize,
  ConfidenceBand,
  EpistemicType,
  SourceReliabilityTier,
} from '@prospector/contracts';

/** Rótulos em pt-BR do dossiê (M2). Os do ciclo de vida e da confiança vêm dos contratos. */

export const EPISTEMIC_LABELS: Record<EpistemicType, string> = {
  fact: 'Fato',
  inference: 'Inferência',
  hypothesis: 'Hipótese',
};

export const CLAIM_STATUS_LABELS: Record<ClaimStatus, string> = {
  active: 'Em vigor',
  stale: 'Vencido',
  disputed: 'Contestado',
  rejected: 'Rejeitado',
  superseded: 'Substituído',
};

export const CLAIM_DOMAIN_LABELS: Record<ClaimDomain, string> = {
  firmographic: 'Cadastro',
  digital_presence: 'Presença digital',
  visual: 'Identidade visual',
  positioning: 'Posicionamento',
  signal: 'Sinais',
  contact: 'Contato',
  competitive: 'Concorrência',
  financial_proxy: 'Porte e finanças (indícios)',
};

export const COMPANY_SIZE_LABELS: Record<CompanySize, string> = {
  me: 'Microempresa (ME)',
  epp: 'Empresa de pequeno porte (EPP)',
  demais: 'Demais (acima de EPP)',
};

export const COMPANY_ORIGIN_LABELS: Record<CompanyOrigin, string> = {
  manual: 'Cadastro manual',
  cnpj_lookup: 'Consulta de CNPJ',
  discovery: 'Descoberta',
};

/** Cor do selo de confiança: alta e média em tom positivo/neutro, baixa em alerta. */
export const CONFIDENCE_BAND_VARIANT: Record<
  ConfidenceBand,
  'success' | 'neutral' | 'warning' | 'outline'
> = {
  high: 'success',
  medium: 'neutral',
  low: 'warning',
  unverified: 'outline',
};

/** Por que a confiança de uma fonte é a que é (categoria decidida pelo sistema, docs/08 §2.2). */
export const RELIABILITY_TIER_NOTES: Record<SourceReliabilityTier, string> = {
  official_registry: 'Fonte oficial do governo.',
  company_owned: 'Fonte da própria empresa: vale para o que ela diz de si mesma.',
  recognized_press: 'Imprensa reconhecida.',
  aggregator:
    'Cópia de dados públicos mantida por terceiros, não a fonte oficial: por isso a confiança fica em média.',
  user_reported: 'Anotado por você.',
  unknown: 'Fonte sem categoria conhecida: confiança baixa até aparecer outra fonte.',
};

/** Nome curto do provedor de uma fonte de API (`sources.provider`). */
export const SOURCE_PROVIDER_NAMES: Record<string, string> = {
  opencnpj: 'OpenCNPJ',
  minhareceita: 'Minha Receita',
};
