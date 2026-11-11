import { z } from 'zod';
import { Uuid } from './common';
import { CnaeCode, CompanySize, UF } from './strategy';

/**
 * Empresas e consulta de CNPJ (M2, docs/06 §4.3). Aqui fica só o formato: o CNPJ é sempre texto,
 * porque existe CNPJ alfanumérico para inscrições desde jul/2026 (research/05 §0). Conclusões
 * sobre a empresa não ficam aqui: viram claims no Evidence Ledger (`evidence.ts`).
 */

const IsoDateTime = z.iso.datetime({ offset: true, error: 'Data e hora inválidas (ISO 8601).' });
const CalendarDate = z.iso.date({ error: 'Data inválida.' });

// -----------------------------------------------------------------------------
// CNPJ
// -----------------------------------------------------------------------------

const CNPJ_PATTERN = /^[0-9A-Z]{12}[0-9]{2}$/;
const FIRST_WEIGHTS = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
const SECOND_WEIGHTS = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];

/** Valor de cada posição na regra da Receita: código ASCII menos 48 (dígitos 0–9, A = 17). */
function checkDigit(body: string, weights: readonly number[]): number {
  let sum = 0;
  for (let index = 0; index < weights.length; index += 1) {
    sum += (body.charCodeAt(index) - 48) * (weights[index] ?? 0);
  }
  const remainder = sum % 11;
  return remainder < 2 ? 0 : 11 - remainder;
}

/** Tira pontuação e espaços e passa para maiúsculas (aceita "12.ABC.345/01DE-35"). */
export function normalizeCnpj(value: string): string {
  return value.replace(/[.\-/\s]/g, '').toUpperCase();
}

/** CNPJ numérico ou alfanumérico com os dois dígitos verificadores certos. */
export function isValidCnpj(value: string): boolean {
  const cnpj = normalizeCnpj(value);
  if (!CNPJ_PATTERN.test(cnpj)) return false;
  // Sequências repetidas (00000000000000, 11111111111111…) passam na conta e não existem.
  if (/^(.)\1{13}$/.test(cnpj)) return false;
  const first = checkDigit(cnpj.slice(0, 12), FIRST_WEIGHTS);
  const second = checkDigit(cnpj.slice(0, 12) + String(first), SECOND_WEIGHTS);
  return cnpj.endsWith(`${first}${second}`);
}

/** 14 posições normalizadas → `00.000.000/0000-00`. */
export function formatCnpj(cnpj: string): string {
  const value = normalizeCnpj(cnpj);
  if (value.length !== 14) return value;
  return `${value.slice(0, 2)}.${value.slice(2, 5)}.${value.slice(5, 8)}/${value.slice(8, 12)}-${value.slice(12)}`;
}

/** CNPJ completo, normalizado (14 posições, sem pontuação). */
export const Cnpj = z
  .string({ error: 'Informe o CNPJ.' })
  .trim()
  .transform(normalizeCnpj)
  .pipe(
    z
      .string()
      .regex(CNPJ_PATTERN, { error: 'CNPJ com 14 posições (ex.: 12.345.678/0001-95).' })
      .refine(isValidCnpj, { error: 'CNPJ inválido: os dígitos verificadores não conferem.' }),
  );
export type Cnpj = z.infer<typeof Cnpj>;

// -----------------------------------------------------------------------------
// Empresa
// -----------------------------------------------------------------------------

/** Ciclo de vida (docs/06 §4.3). Mudança só por ação explícita, nunca por inferência do modelo. */
export const CompanyLifecycle = z.enum([
  'candidate',
  'investigating',
  'qualified',
  'disqualified',
  'engaged',
  'customer',
  'archived',
]);
export type CompanyLifecycle = z.infer<typeof CompanyLifecycle>;

export const COMPANY_LIFECYCLE_LABELS: Record<CompanyLifecycle, string> = {
  candidate: 'Candidata',
  investigating: 'Em investigação',
  qualified: 'Qualificada',
  disqualified: 'Descartada',
  engaged: 'Em conversa',
  customer: 'Cliente',
  archived: 'Arquivada',
};

/** Como a empresa entrou no Prospector. */
export const CompanyOrigin = z.enum(['manual', 'cnpj_lookup', 'discovery']);
export type CompanyOrigin = z.infer<typeof CompanyOrigin>;

/**
 * Domínio principal: aceita endereço colado ("https://www.Exemplo.com.br/contato") e guarda só o
 * host em minúsculas, sem `www.`.
 */
export const CompanyDomain = z
  .string()
  .trim()
  .transform((value) =>
    value
      .toLowerCase()
      .replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
      .replace(/[/?#].*$/, '')
      .replace(/:\d+$/, '')
      .replace(/^www\./, '')
      .replace(/\.$/, ''),
  )
  .pipe(
    z
      .string()
      .max(253)
      .regex(/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/, {
        error: 'Domínio inválido (ex.: exemplo.com.br).',
      }),
  );

const optionalName = (max: number) =>
  z
    .string()
    .trim()
    .max(max, { error: `Use no máximo ${max} caracteres.` })
    .transform((value) => (value === '' ? null : value))
    .nullable()
    .default(null);

/** Cadastro manual (formulário "Adicionar empresa"). */
export const CompanyInput = z.object({
  schemaVersion: z.literal(1),
  displayName: z
    .string({ error: 'Informe o nome da empresa.' })
    .trim()
    .min(2, { error: 'Informe o nome da empresa.' })
    .max(160, { error: 'Use no máximo 160 caracteres.' }),
  cnpj: z
    .union([z.literal('').transform(() => null), Cnpj])
    .nullable()
    .default(null),
  primaryDomain: z
    .union([z.literal('').transform(() => null), CompanyDomain])
    .nullable()
    .default(null),
  city: optionalName(80),
  uf: z
    .union([z.literal('').transform(() => null), UF])
    .nullable()
    .default(null),
});
export type CompanyInput = z.infer<typeof CompanyInput>;
export type CompanyInputDraft = z.input<typeof CompanyInput>;

/** Nome do município como vem da Receita; o mesmo limite no contrato e no banco. */
export const CITY_MAX = 120;

export const Company = z.object({
  id: Uuid,
  displayName: z.string().min(1).max(160),
  legalName: z.string().max(300).nullable(),
  cnpj: z.string().regex(CNPJ_PATTERN).nullable(),
  cnpjRoot: z
    .string()
    .regex(/^[0-9A-Z]{8}$/)
    .nullable(),
  primaryDomain: z.string().max(253).nullable(),
  city: z.string().max(CITY_MAX).nullable(),
  uf: UF.nullable(),
  cnaeMain: CnaeCode.nullable(),
  sizeBand: CompanySize.nullable(),
  lifecycle: CompanyLifecycle,
  origin: CompanyOrigin,
  lastInvestigatedAt: IsoDateTime.nullable(),
  isDemo: z.boolean(),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type Company = z.infer<typeof Company>;

export const CompanyIdentifierKind = z.enum([
  'cnpj',
  'cnpj_root',
  'domain',
  'place_id',
  'instagram',
  'phone',
  'linkedin_url',
]);
export type CompanyIdentifierKind = z.infer<typeof CompanyIdentifierKind>;

/** Chaves que identificam uma empresa sozinhas; telefone e e-mail cadastrais são fracos. */
export const STRONG_IDENTIFIER_KINDS: readonly CompanyIdentifierKind[] = [
  'cnpj',
  'domain',
  'place_id',
];

export const CompanyIdentifier = z.object({
  id: Uuid,
  companyId: Uuid,
  kind: CompanyIdentifierKind,
  valueNormalized: z.string().min(1).max(300),
  strength: z.enum(['strong', 'weak']),
  verified: z.boolean(),
  sourceId: Uuid.nullable(),
  createdAt: IsoDateTime,
});
export type CompanyIdentifier = z.infer<typeof CompanyIdentifier>;

export const CompanyListFilter = z.object({
  /** Busca por nome, razão social, CNPJ ou domínio. */
  search: z.string().trim().max(120).default(''),
  lifecycle: CompanyLifecycle.nullable().default(null),
  includeArchived: z.boolean().default(false),
  limit: z.number().int().min(1).max(200).default(50),
});
export type CompanyListFilter = z.infer<typeof CompanyListFilter>;
export type CompanyListFilterDraft = z.input<typeof CompanyListFilter>;

export const ChangeLifecycleInput = z.object({
  companyId: Uuid,
  lifecycle: CompanyLifecycle,
});
export type ChangeLifecycleInput = z.infer<typeof ChangeLifecycleInput>;

// -----------------------------------------------------------------------------
// Registro da Receita (consulta de CNPJ), já minimizado
// -----------------------------------------------------------------------------

/** Provedores gratuitos da base aberta da Receita (research/05 §1). */
export const CnpjProvider = z.enum(['opencnpj', 'minhareceita']);
export type CnpjProvider = z.infer<typeof CnpjProvider>;

export const CNPJ_PROVIDER_LABELS: Record<CnpjProvider, string> = {
  opencnpj: 'OpenCNPJ (base aberta da Receita Federal)',
  minhareceita: 'Minha Receita (base aberta da Receita Federal)',
};

/** Endereço público do registro no provedor, para o usuário conferir a fonte. */
export function cnpjRecordUrl(provider: CnpjProvider, cnpj: string): string {
  const id = encodeURIComponent(normalizeCnpj(cnpj));
  return provider === 'opencnpj'
    ? `https://api.opencnpj.org/${id}`
    : `https://minhareceita.org/${id}`;
}

export const RegistryStatus = z.enum(['active', 'suspended', 'unfit', 'closed', 'null']);
export type RegistryStatus = z.infer<typeof RegistryStatus>;

export const REGISTRY_STATUS_LABELS: Record<RegistryStatus, string> = {
  active: 'Ativa',
  suspended: 'Suspensa',
  unfit: 'Inapta',
  closed: 'Baixada',
  null: 'Nula',
};

/** CPF com ou sem pontuação, sem outro dígito colado antes ou depois. */
export const CPF_IN_TEXT = /(?<!\d)\d{3}\.?\d{3}\.?\d{3}-?\d{2}(?!\d)/;
const CPF_MESSAGE = 'O registro não pode trazer CPF (LGPD).';
function hasNoCpf(value: string): boolean {
  return !CPF_IN_TEXT.test(value);
}

/**
 * O que o Prospector guarda de uma consulta de CNPJ. Minimizado (regra 7, LGPD): sem quadro de
 * sócios, sem e-mail e telefone cadastrais (muitas vezes do contador ou, no MEI, da pessoa) e sem
 * endereço de rua (no MEI costuma ser a casa da pessoa). No MEI, o CPF sai do nome empresarial.
 */
export const CnpjRegistryRecord = z.object({
  schemaVersion: z.literal(1),
  provider: CnpjProvider,
  cnpj: z.string().regex(CNPJ_PATTERN),
  legalName: z.string().min(1).max(300).refine(hasNoCpf, CPF_MESSAGE),
  tradeName: z.string().min(1).max(300).refine(hasNoCpf, CPF_MESSAGE).nullable(),
  status: RegistryStatus,
  statusSince: CalendarDate.nullable(),
  headquarters: z.boolean().nullable(),
  activityStart: CalendarDate.nullable(),
  cnaeMain: z.object({ code: CnaeCode, description: z.string().max(300).nullable() }).nullable(),
  cnaeSecondary: z.array(CnaeCode).max(100),
  legalNature: z.string().max(200).nullable(),
  /** Código da natureza jurídica (tabela da Receita, 4 dígitos), quando o provedor informa. */
  legalNatureCode: z
    .string()
    .regex(/^\d{4}$/)
    .nullable()
    .default(null),
  size: CompanySize.nullable(),
  isMei: z.boolean(),
  simples: z.boolean().nullable(),
  capitalCents: z.number().int().nonnegative().nullable(),
  city: z.string().max(CITY_MAX).nullable(),
  uf: UF.nullable(),
  /** Data da extração da Receita usada pelo provedor, quando ele informa. */
  providerUpdatedAt: IsoDateTime.nullable(),
});
export type CnpjRegistryRecord = z.infer<typeof CnpjRegistryRecord>;

/** Por que a consulta de CNPJ não trouxe dados. */
export const CnpjLookupFailure = z.enum([
  'not_found',
  'rate_limited',
  'unavailable',
  'invalid_response',
  /** A empresa pediu anonimização na base pública (LGPD): nada é guardado nem buscado na reserva. */
  'anonymized',
]);
export type CnpjLookupFailure = z.infer<typeof CnpjLookupFailure>;

export const CNPJ_LOOKUP_MESSAGES: Record<CnpjLookupFailure, string> = {
  not_found: 'Esse CNPJ não aparece na base aberta da Receita Federal.',
  rate_limited: 'O serviço de consulta de CNPJ pediu uma pausa. Tente de novo em alguns minutos.',
  unavailable:
    'Não consegui consultar o CNPJ agora (serviço fora do ar ou sem internet). Tente de novo mais tarde ou cadastre a empresa à mão.',
  invalid_response:
    'O serviço de consulta de CNPJ respondeu num formato inesperado. Cadastre a empresa à mão por enquanto.',
  anonymized:
    'Essa empresa pediu a anonimização dos dados na base pública (LGPD). O Prospector não guarda esse registro; se precisar, cadastre à mão só o necessário.',
};

/**
 * Mensagens da nova consulta, pedida no dossiê: a empresa já está cadastrada e os fatos guardados
 * continuam valendo, então nada de "cadastre à mão".
 */
export const CNPJ_REFRESH_MESSAGES: Record<CnpjLookupFailure, string> = {
  not_found:
    'Esse CNPJ não aparece mais na base aberta da Receita Federal. Os fatos guardados continuam como estavam.',
  rate_limited: CNPJ_LOOKUP_MESSAGES.rate_limited,
  unavailable:
    'Não consegui consultar o CNPJ agora (serviço fora do ar ou sem internet). Os fatos guardados continuam como estavam; tente de novo mais tarde.',
  invalid_response:
    'O serviço de consulta de CNPJ respondeu num formato inesperado. Os fatos guardados continuam como estavam.',
  anonymized:
    'Essa empresa pediu a anonimização dos dados na base pública (LGPD). Nada novo foi guardado; avalie arquivar a empresa.',
};

export const CnpjLookupInput = z.object({ cnpj: Cnpj });
export type CnpjLookupInput = z.infer<typeof CnpjLookupInput>;
