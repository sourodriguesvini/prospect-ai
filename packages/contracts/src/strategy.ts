import { z } from 'zod';
import { Email, Uuid } from './common';

/**
 * Contratos da Estratégia (F2): ofertas, rubrica de auditoria, modelo de score, ICP, voz da
 * agência, cases, LIA e política de contato. Aqui fica só o FORMATO dos dados (tipos, limites,
 * normalização); as regras de negócio (pesos somam 100, prontidão, aprovação de LIA) ficam em
 * @prospector/domain. Mensagens em pt-BR porque chegam aos formulários.
 */

const REQUIRED = 'Campo obrigatório.';

const maxItems = (max: number) => ({ error: `No máximo ${max} itens.` });

/** Idade da empresa em anos (opcional). */
const AgeYears = z
  .number({ error: 'Informe um número inteiro de anos.' })
  .int({ error: 'Use número inteiro.' })
  .min(0, { error: 'Use um valor de 0 a 200.' })
  .max(200, { error: 'Use um valor de 0 a 200.' })
  .nullable()
  .default(null);

function maxChars(max: number) {
  return { error: `Use no máximo ${max} caracteres.` };
}

/** Texto obrigatório, sem espaços nas pontas. */
export function requiredText(max: number) {
  return z.string({ error: REQUIRED }).trim().min(1, { error: REQUIRED }).max(max, maxChars(max));
}

/** Texto opcional: vazio vira ''. */
export function optionalText(max: number) {
  return z.string().trim().max(max, maxChars(max)).default('');
}

/** Lista de frases curtas (um item por linha nos formulários). */
export function textList(maxItems: number, maxLength: number) {
  return z
    .array(z.string().trim().min(1, { error: 'Item vazio.' }).max(maxLength, maxChars(maxLength)))
    .max(maxItems, { error: `No máximo ${maxItems} itens.` })
    .default([]);
}

/** Inteiro de 0 a 100 (pontos percentuais). Pesos somam 100 = 1 (regra no domínio). */
export const Percent = z
  .number({ error: 'Informe um número inteiro de 0 a 100.' })
  .int({ error: 'Use número inteiro.' })
  .min(0, { error: 'Use um valor de 0 a 100.' })
  .max(100, { error: 'Use um valor de 0 a 100.' });

/** Data de calendário AAAA-MM-DD (sem fuso). */
export const CalendarDate = z.iso.date({ error: 'Data inválida.' });

export const EntityStatus = z.enum(['draft', 'active', 'archived'], { error: 'Status inválido.' });
export type EntityStatus = z.infer<typeof EntityStatus>;

// -----------------------------------------------------------------------------
// Oferta (versionada)
// -----------------------------------------------------------------------------

/** Valor em centavos de real; null = não informado. */
const Cents = z
  .number({ error: 'Valor inválido.' })
  .int({ error: 'Valor inválido.' })
  .min(0, { error: 'O valor não pode ser negativo.' })
  .max(100_000_000_00, { error: 'Valor alto demais.' })
  .nullable()
  .default(null);

export const OfferContent = z.object({
  name: requiredText(120),
  description: optionalText(2000),
  problems: textList(20, 300),
  needSignals: textList(20, 300),
  disqualifiers: textList(20, 300),
  deliverables: textList(20, 300),
  valueProps: textList(10, 300),
  priceMinCents: Cents,
  priceMaxCents: Cents,
});
export type OfferContent = z.infer<typeof OfferContent>;
export type OfferContentInput = z.input<typeof OfferContent>;

export const OfferVersion = z.object({
  id: Uuid,
  offerId: Uuid,
  version: z.number().int().min(1),
  content: OfferContent,
  createdAt: z.string(),
});
export type OfferVersion = z.infer<typeof OfferVersion>;

export const Offer = z.object({
  id: Uuid,
  status: EntityStatus,
  isDemo: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
  current: OfferVersion.nullable(),
});
export type Offer = z.infer<typeof Offer>;

// -----------------------------------------------------------------------------
// Rubrica de auditoria visual (versionada por oferta). Escala fixa de 1 a 5 (visual_auditor).
// -----------------------------------------------------------------------------

export const RUBRIC_SCALE = { min: 1, max: 5 } as const;

/** Tipos de captura que o auditor visual pode exigir (docs/06 §4.5, `brand_assets.kind`). */
export const BrandAssetKind = z.enum(
  ['site_desktop', 'site_mobile', 'logo', 'favicon', 'og_image', 'social_grid'],
  { error: 'Tipo de captura desconhecido.' },
);
export type BrandAssetKind = z.infer<typeof BrandAssetKind>;

export const CriterionKey = z
  .string()
  .trim()
  .regex(/^[a-z][a-z0-9_]{1,39}$/, {
    error: 'Use de 2 a 40 letras minúsculas, números ou _ (ex.: consistencia_canais).',
  });

export const RubricCriterion = z.object({
  key: CriterionKey,
  label: requiredText(80),
  description: requiredText(600),
  weight: Percent,
  evidenceRequired: z
    .array(BrandAssetKind)
    .min(1, { error: 'Escolha ao menos uma evidência.' })
    .max(6),
});
export type RubricCriterion = z.infer<typeof RubricCriterion>;

export const RubricContent = z.object({
  criteria: z
    .array(RubricCriterion)
    .min(1, { error: 'A rubrica precisa de ao menos um critério.' })
    .max(15, { error: 'No máximo 15 critérios.' }),
});
export type RubricContent = z.infer<typeof RubricContent>;
export type RubricContentInput = z.input<typeof RubricContent>;

export const RubricVersion = z.object({
  id: Uuid,
  offerId: Uuid,
  version: z.number().int().min(1),
  content: RubricContent,
  createdAt: z.string(),
});
export type RubricVersion = z.infer<typeof RubricVersion>;

// -----------------------------------------------------------------------------
// Modelo de score (versionado por oferta): pesos das dimensões e limiares (docs/08 §3)
// -----------------------------------------------------------------------------

export const ScoreDimension = z.enum(['fit', 'need', 'signal', 'capacity', 'timing']);
export type ScoreDimension = z.infer<typeof ScoreDimension>;
export const SCORE_DIMENSIONS = ScoreDimension.options;

export const ScoreWeights = z.object({
  fit: Percent,
  need: Percent,
  signal: Percent,
  capacity: Percent,
  timing: Percent,
});
export type ScoreWeights = z.infer<typeof ScoreWeights>;

export const ScoreThresholds = z.object({
  /** Prioridade mínima para "Abordar agora" (pursue). */
  pursuePriority: Percent,
  /** Potencial mínimo para "Preparar acesso" (prepare_access). */
  prepareAccessPotential: Percent,
  /** Potencial abaixo do qual a recomendação é "Descartar". */
  discardPotential: Percent,
  /** Cobertura mínima de evidência (% das dimensões com evidência suficiente). */
  minEvidenceCoverage: Percent,
});
export type ScoreThresholds = z.infer<typeof ScoreThresholds>;

export const ScoringModelContent = z.object({
  weights: ScoreWeights,
  thresholds: ScoreThresholds,
});
export type ScoringModelContent = z.infer<typeof ScoringModelContent>;

export const ScoringModelVersion = z.object({
  id: Uuid,
  offerId: Uuid,
  version: z.number().int().min(1),
  content: ScoringModelContent,
  createdAt: z.string(),
});
export type ScoringModelVersion = z.infer<typeof ScoringModelVersion>;

// -----------------------------------------------------------------------------
// ICP (perfil com status + versões de filtros e exclusões)
// -----------------------------------------------------------------------------

export const UF = z.enum(
  [
    'AC',
    'AL',
    'AM',
    'AP',
    'BA',
    'CE',
    'DF',
    'ES',
    'GO',
    'MA',
    'MG',
    'MS',
    'MT',
    'PA',
    'PB',
    'PE',
    'PI',
    'PR',
    'RJ',
    'RN',
    'RO',
    'RR',
    'RS',
    'SC',
    'SE',
    'SP',
    'TO',
  ],
  { error: 'UF inválida (use a sigla, ex.: PR).' },
);
export type UF = z.infer<typeof UF>;

/** Subclasse CNAE 2.3 no formato 0000-0/00 (aceita só dígitos e normaliza). */
export const CnaeCode = z
  .string()
  .trim()
  .transform((value) => value.replace(/\D/g, ''))
  .pipe(z.string().regex(/^\d{7}$/, { error: 'CNAE com 7 dígitos (ex.: 8630-5/04).' }))
  .transform((d) => `${d.slice(0, 4)}-${d.slice(4, 5)}/${d.slice(5)}`);

/** Porte da Receita Federal. MEI fica fora por padrão (dados de pessoa física, docs/06 §4.3.1). */
export const CompanySize = z.enum(['me', 'epp', 'demais'], { error: 'Porte inválido.' });
export type CompanySize = z.infer<typeof CompanySize>;

export const Municipality = z.object({
  name: requiredText(80),
  uf: UF,
});
export type Municipality = z.infer<typeof Municipality>;

/** Raiz do CNPJ (8 posições; alfanumérica para inscrições desde jul/2026). */
export const CnpjRoot = z
  .string()
  .trim()
  .transform((value) => value.replace(/[.\-/\s]/g, '').toUpperCase())
  .pipe(z.string().regex(/^[0-9A-Z]{8}$/, { error: 'Raiz de CNPJ com 8 caracteres.' }));

/**
 * Domínio registrável, sem protocolo nem caminho (ex.: empresa.com.br). O tamanho é limitado
 * antes de qualquer expressão regular, e as limpezas são lineares (sem risco de ReDoS).
 */
export const DomainName = z
  .string()
  .trim()
  .max(300, { ...maxChars(300), abort: true })
  .toLowerCase()
  .transform((value) => {
    const scheme = value.indexOf('://');
    const withoutScheme = scheme >= 0 ? value.slice(scheme + 3) : value;
    const host = withoutScheme.split(/[/?#]/, 1)[0] ?? '';
    return host.startsWith('www.') ? host.slice(4) : host;
  })
  .pipe(
    z
      .string()
      .max(253)
      .regex(/^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/, {
        error: 'Domínio inválido (ex.: empresa.com.br).',
      }),
  );

export const IcpFilters = z.object({
  cnaes: z.array(CnaeCode).max(100, maxItems(100)).default([]),
  ufs: z.array(UF).max(27, maxItems(27)).default([]),
  municipalities: z.array(Municipality).max(200, maxItems(200)).default([]),
  sizes: z.array(CompanySize).max(3, maxItems(3)).default([]),
  minAgeYears: AgeYears,
  maxAgeYears: AgeYears,
});
export type IcpFilters = z.infer<typeof IcpFilters>;

export const IcpExclusions = z.object({
  cnaes: z.array(CnaeCode).max(100, maxItems(100)).default([]),
  municipalities: z.array(Municipality).max(200, maxItems(200)).default([]),
  cnpjRoots: z.array(CnpjRoot).max(500, maxItems(500)).default([]),
  domains: z.array(DomainName).max(500, maxItems(500)).default([]),
});
export type IcpExclusions = z.infer<typeof IcpExclusions>;

export const IcpContent = z.object({
  name: requiredText(120),
  description: optionalText(1000),
  filters: IcpFilters,
  exclusions: IcpExclusions,
});
export type IcpContent = z.infer<typeof IcpContent>;
export type IcpContentInput = z.input<typeof IcpContent>;

export const IcpVersion = z.object({
  id: Uuid,
  icpId: Uuid,
  version: z.number().int().min(1),
  content: IcpContent,
  createdAt: z.string(),
});
export type IcpVersion = z.infer<typeof IcpVersion>;

export const IcpProfile = z.object({
  id: Uuid,
  offerId: Uuid,
  status: EntityStatus,
  isDemo: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
  current: IcpVersion.nullable(),
});
export type IcpProfile = z.infer<typeof IcpProfile>;

// -----------------------------------------------------------------------------
// Voz da agência (versionada, uma por espaço de trabalho)
// -----------------------------------------------------------------------------

export const VoiceGuideContent = z.object({
  summary: requiredText(1000),
  principles: textList(15, 300),
  avoid: textList(15, 300),
  goodExamples: textList(5, 2000),
  badExamples: textList(5, 2000),
});
export type VoiceGuideContent = z.infer<typeof VoiceGuideContent>;
export type VoiceGuideContentInput = z.input<typeof VoiceGuideContent>;

export const VoiceGuideVersion = z.object({
  id: Uuid,
  version: z.number().int().min(1),
  content: VoiceGuideContent,
  createdAt: z.string(),
});
export type VoiceGuideVersion = z.infer<typeof VoiceGuideVersion>;

// -----------------------------------------------------------------------------
// Cases (provas). Só `publicOk` com autorização registrada pode ir para mensagens.
// -----------------------------------------------------------------------------

export const ProofAssetInput = z.object({
  offerId: Uuid.nullable().default(null),
  title: requiredText(120),
  segment: optionalText(120),
  summary: requiredText(1000),
  results: optionalText(1000),
  publicOk: z.boolean().default(false),
  /** Onde está a autorização do cliente (ex.: "e-mail de 03/2026, pasta Contratos"). */
  consentRef: optionalText(300),
});
export type ProofAssetInput = z.infer<typeof ProofAssetInput>;
export type ProofAssetRawInput = z.input<typeof ProofAssetInput>;

export const ProofAsset = ProofAssetInput.extend({
  id: Uuid,
  isDemo: z.boolean(),
  archivedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ProofAsset = z.infer<typeof ProofAsset>;

// -----------------------------------------------------------------------------
// LIA — avaliação de legítimo interesse (modelo guiado; docs/12 §4)
// -----------------------------------------------------------------------------

/** Campos pessoais permitidos (lista fechada de minimização, docs/12 §4). Sem CPF. */
export const LiaDataCategory = z.enum(
  ['name', 'role_title', 'work_email', 'work_phone', 'professional_profile_url'],
  { error: 'Categoria fora da lista de minimização.' },
);
export type LiaDataCategory = z.infer<typeof LiaDataCategory>;

export const LiaDataSource = z.enum(['registry_qsa', 'company_website', 'user_input'], {
  error: 'Origem desconhecida.',
});
export type LiaDataSource = z.infer<typeof LiaDataSource>;

export const LiaContent = z.object({
  /** 1. Finalidade: para que os dados serão usados. */
  purpose: requiredText(1000),
  /** 1. Interesse legítimo concreto da agência. */
  legitimateInterest: requiredText(2000),
  /** 2. Necessidade: por que esses dados, e alternativas menos intrusivas consideradas. */
  necessity: requiredText(2000),
  dataCategories: z
    .array(LiaDataCategory)
    .min(1, { error: 'Marque ao menos uma categoria.' })
    .max(5),
  dataSources: z.array(LiaDataSource).min(1, { error: 'Marque ao menos uma origem.' }).max(3),
  /** 3. Balanceamento: legítima expectativa do titular. */
  expectations: requiredText(2000),
  /** 3. Balanceamento: riscos e impactos para o titular. */
  risks: requiredText(2000),
  /** 4. Salvaguardas: transparência, opt-out, retenção, supressão. */
  safeguards: requiredText(2000),
  /** Conclusão de quem avaliou. */
  conclusion: requiredText(1000),
});
export type LiaContent = z.infer<typeof LiaContent>;
export type LiaContentInput = z.input<typeof LiaContent>;

export const LiaVersion = z.object({
  id: Uuid,
  version: z.number().int().min(1),
  content: LiaContent,
  createdAt: z.string(),
  approvedAt: z.string().nullable(),
  /** AAAA-MM-DD; o domínio compara essas datas como texto. */
  reviewDueOn: CalendarDate.nullable(),
  revokedAt: z.string().nullable(),
});
export type LiaVersion = z.infer<typeof LiaVersion>;

/** Aprovar exige data de revisão e a confirmação explícita de que o texto foi revisado. */
export const LiaApprovalInput = z.object({
  reviewDueOn: CalendarDate,
  confirmed: z.literal(true, {
    error: 'Confirme que revisou o texto e assume esta avaliação.',
  }),
});
export type LiaApprovalInput = z.infer<typeof LiaApprovalInput>;

// -----------------------------------------------------------------------------
// Política de contato: identificação da agência, canal do titular e texto de opt-out
// -----------------------------------------------------------------------------

/**
 * Host que o titular consegue acessar: com ponto, sem IP literal e fora dos nomes só locais.
 * O app roda só neste computador (ADR-0007); o canal do titular precisa ser público.
 */
function isPublicHost(host: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, '');
  if (!h.includes('.') || h.startsWith('[') || h.includes(':')) return false;
  if (/^[\d.]+$/.test(h)) return false;
  const localSuffixes = ['localhost', 'local', 'internal', 'lan', 'home.arpa'];
  return !localSuffixes.some((suffix) => h === suffix || h.endsWith(`.${suffix}`));
}

function isPublicContact(value: string): boolean {
  if (value.startsWith('https://')) {
    try {
      const url = new URL(value);
      return (
        url.protocol === 'https:' && !url.username && !url.password && isPublicHost(url.hostname)
      );
    } catch {
      return false;
    }
  }
  const email = Email.safeParse(value);
  return email.success && isPublicHost(email.data.slice(email.data.lastIndexOf('@') + 1));
}

/**
 * E-mail ou endereço https público do canal do titular (encarregado/formulário). O tamanho é
 * conferido antes (abort) para a validação nunca rodar sobre texto gigante.
 */
export const PrivacyContact = z
  .string()
  .trim()
  .min(1, { error: REQUIRED, abort: true })
  .max(200, { ...maxChars(200), abort: true })
  .refine(isPublicContact, {
    error:
      'Informe um e-mail ou um endereço https:// público: o titular precisa conseguir acessar (o app é só local).',
  });

export const ContactPolicyContent = z.object({
  agencyName: requiredText(120),
  privacyContact: PrivacyContact,
  optOutText: requiredText(500),
});
export type ContactPolicyContent = z.infer<typeof ContactPolicyContent>;
export type ContactPolicyContentInput = z.input<typeof ContactPolicyContent>;

export const ContactPolicyVersion = z.object({
  id: Uuid,
  version: z.number().int().min(1),
  content: ContactPolicyContent,
  createdAt: z.string(),
});
export type ContactPolicyVersion = z.infer<typeof ContactPolicyVersion>;

// -----------------------------------------------------------------------------
// Retrato da estratégia: versões atuais de tudo (entrada da prontidão e das telas)
// -----------------------------------------------------------------------------

export const StrategySnapshot = z.object({
  offers: z.array(Offer),
  /** Versão atual da rubrica de cada oferta que tem rubrica. */
  rubrics: z.array(RubricVersion),
  /** Versão atual do modelo de score de cada oferta que tem modelo. */
  scoringModels: z.array(ScoringModelVersion),
  icps: z.array(IcpProfile),
  voiceGuide: VoiceGuideVersion.nullable(),
  contactPolicy: ContactPolicyVersion.nullable(),
  /** Todas as versões da LIA (a efetiva depende das aprovações e revogações). */
  liaVersions: z.array(LiaVersion),
  proofAssets: z.array(ProofAsset),
});
export type StrategySnapshot = z.infer<typeof StrategySnapshot>;

// -----------------------------------------------------------------------------
// Prontidão: o que falta para descobrir e para abordar (calculado no domínio)
// -----------------------------------------------------------------------------

export const ReadinessCode = z.enum([
  'offer_complete',
  'rubric',
  'scoring_model',
  'offer_active',
  'icp_active',
  'voice_guide',
  'contact_policy',
  'lia_approved',
  'public_case',
  'persistent_storage',
]);
export type ReadinessCode = z.infer<typeof ReadinessCode>;

export const ReadinessItem = z.object({
  code: ReadinessCode,
  label: z.string(),
  ok: z.boolean(),
  /** Bloqueia a ação (false = só recomendação). */
  blocking: z.boolean(),
  /** Explicação do estado atual, em pt-BR. */
  detail: z.string(),
});
export type ReadinessItem = z.infer<typeof ReadinessItem>;

export const ReadinessGate = z.object({
  ready: z.boolean(),
  items: z.array(ReadinessItem),
  /**
   * Oferta avaliada: a do escopo pedido ou, sem escopo, a mais adiantada. Null se não há oferta
   * que conte (só demo, só arquivadas ou nenhuma).
   */
  offerId: Uuid.nullable(),
});
export type ReadinessGate = z.infer<typeof ReadinessGate>;

export const Readiness = z.object({
  discover: ReadinessGate,
  approach: ReadinessGate,
});
export type Readiness = z.infer<typeof Readiness>;

/**
 * Escopo das barreiras: a oferta da abordagem (F10), com o ICP que qualificou o prospect quando
 * houver, ou o ICP da descoberta (F4).
 */
export const ApproachScope = z.object({ offerId: Uuid, icpId: Uuid.optional() });
export type ApproachScope = z.infer<typeof ApproachScope>;
export const DiscoveryScope = z.object({ icpId: Uuid });
export type DiscoveryScope = z.infer<typeof DiscoveryScope>;

/**
 * Versões que a barreira de abordagem conferiu. A ação de abordagem (F10) grava esses ids para
 * provar com que oferta, LIA, opt-out e voz ela foi liberada (versões nunca mudam: ADR-0009).
 */
export const ApproachClearance = z.object({
  offerId: Uuid,
  offerVersionId: Uuid,
  rubricVersionId: Uuid,
  scoringModelVersionId: Uuid,
  /** Versão do ICP pedido no escopo (null quando a abordagem não informou ICP). */
  icpVersionId: Uuid.nullable(),
  voiceGuideVersionId: Uuid,
  contactPolicyVersionId: Uuid,
  liaVersionId: Uuid,
});
export type ApproachClearance = z.infer<typeof ApproachClearance>;

/** Versões que a barreira de descoberta conferiu (F4 grava estes ids na execução). */
export const DiscoveryClearance = z.object({
  offerId: Uuid,
  offerVersionId: Uuid,
  rubricVersionId: Uuid,
  scoringModelVersionId: Uuid,
  icpId: Uuid,
  icpVersionId: Uuid,
});
export type DiscoveryClearance = z.infer<typeof DiscoveryClearance>;
