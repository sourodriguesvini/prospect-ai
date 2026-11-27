import {
  CNPJ_PROVIDER_LABELS,
  REGISTRY_STATUS_LABELS,
  formatCnpj,
  type Claim,
  type ClaimDomain,
  type CnpjRegistryRecord,
  type CompanySize,
} from '@prospector/contracts';
import { effectiveStatus } from '../evidence/confidence';

/**
 * Consulta de CNPJ → fatos do Evidence Ledger (M2). O texto da fonte (`sources.excerpt_text`) é
 * montado aqui, linha a linha, e cada fato cita a sua linha literal: o trecho é conferido contra o
 * texto guardado (docs/08 §2.4), sem depender do modelo. Só entram campos do registro minimizado
 * (`CnpjRegistryRecord`): nada de sócios, e-mail, telefone nem endereço de rua.
 *
 * Empresa individual (MEI, empresário individual, EIRELI…): o nome empresarial é o nome da pessoa
 * (dado pessoal). Fontes e evidências não podem ser apagadas, então esse nome não entra no texto da
 * fonte nem nos fatos; fica só no cadastro da empresa, que pode ser corrigido ou expurgado (LGPD).
 */

export interface RegistryFact {
  readonly domain: ClaimDomain;
  readonly key: string;
  readonly statement: string;
  readonly value: Record<string, unknown>;
  /** Linha literal do texto da fonte que sustenta o fato. */
  readonly quote: string;
}

const SIZE_LABELS: Record<CompanySize, string> = {
  me: 'Microempresa (ME)',
  epp: 'Empresa de pequeno porte (EPP)',
  demais: 'Demais (acima de EPP)',
};

/** Fontes do registro ficam guardadas por 12 meses (docs/06 §6, a validar com jurídico). */
export const REGISTRY_SOURCE_RETENTION_MONTHS = 12;

/** `capturedAt` + o prazo de guarda da fonte (ISO). */
export function registryRetentionUntil(capturedAt: string): string {
  const date = new Date(capturedAt);
  date.setUTCMonth(date.getUTCMonth() + REGISTRY_SOURCE_RETENTION_MONTHS);
  return date.toISOString();
}

/** `2005-11-03` → `03/11/2005`. */
export function brazilianDate(isoDate: string): string {
  const [year, month, day] = isoDate.slice(0, 10).split('-');
  return `${day}/${month}/${year}`;
}

/** Centavos → `R$ 1.234,56`, sem depender da localidade do Node. */
export function brl(cents: number): string {
  const reais = Math.floor(cents / 100);
  const rest = String(cents % 100).padStart(2, '0');
  return `R$ ${String(reais).replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${rest}`;
}

function yesNo(value: boolean): string {
  return value ? 'sim' : 'não';
}

function fold(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Naturezas jurídicas cujo nome empresarial é o nome de uma pessoa natural (tabela da Receita):
 * empresário individual, EIRELI, sociedade unipessoal de advocacia, empresa individual
 * imobiliária e produtor rural pessoa física.
 */
const INDIVIDUAL_NATURE_CODES: ReadonlySet<string> = new Set([
  '2135',
  '2305',
  '2313',
  '2321',
  '4014',
  '4120',
]);
const INDIVIDUAL_NATURE_TEXT = /individual|eireli|unipessoal de advocacia|pessoa fisica/;

/** MEI ou outra empresa de uma pessoa só: a razão social é o nome da pessoa. */
export function isIndividualBusiness(
  record: Pick<CnpjRegistryRecord, 'isMei' | 'legalNature' | 'legalNatureCode'>,
): boolean {
  return (
    record.isMei ||
    (record.legalNatureCode !== null && INDIVIDUAL_NATURE_CODES.has(record.legalNatureCode)) ||
    INDIVIDUAL_NATURE_TEXT.test(fold(record.legalNature ?? ''))
  );
}

/**
 * Empresa individual lida dos fatos do registro em vigor (regime e natureza jurídica), para a tela
 * avisar que o cadastro guarda o nome de uma pessoa.
 */
export function isIndividualFromFacts(facts: readonly { key: string; value: unknown }[]): boolean {
  const valueOf = (key: string): Record<string, unknown> => {
    const value = facts.find((fact) => fact.key === key)?.value;
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  };
  const regime = valueOf('registry.tax_regime');
  const nature = valueOf('registry.legal_nature');
  return isIndividualBusiness({
    isMei: regime.isMei === true,
    legalNature: typeof nature.legalNature === 'string' ? nature.legalNature : null,
    legalNatureCode: typeof nature.code === 'string' ? nature.code : null,
  });
}

/** Na empresa individual, nome fantasia igual ao nome da pessoa também é dado pessoal. */
function personalTradeName(record: CnpjRegistryRecord): boolean {
  if (!record.tradeName || !isIndividualBusiness(record)) return false;
  const trade = fold(record.tradeName);
  const legal = fold(record.legalName);
  return trade === legal || trade.includes(legal) || legal.includes(trade);
}

const NOT_INFORMED = 'não informado';

/** Linhas do texto da fonte, na ordem; a chave é a do fato que a linha sustenta. */
function registryLines(record: CnpjRegistryRecord): ReadonlyMap<string, string> {
  const individual = isIndividualBusiness(record);
  const legalNature = record.legalNature
    ? `${record.legalNature}${record.legalNatureCode ? ` (código ${record.legalNatureCode})` : ''}`
    : 'não informada';
  return new Map([
    ['cnpj', `CNPJ: ${formatCnpj(record.cnpj)}`],
    [
      'registry.legal_name',
      individual
        ? 'Razão social: nome da pessoa titular (empresa individual; não guardado nas evidências)'
        : `Razão social: ${record.legalName}`,
    ],
    [
      'registry.trade_name',
      !record.tradeName
        ? `Nome fantasia: ${NOT_INFORMED}`
        : personalTradeName(record)
          ? 'Nome fantasia: nome da pessoa titular (não guardado nas evidências)'
          : `Nome fantasia: ${record.tradeName}`,
    ],
    [
      'registry.status',
      `Situação cadastral: ${REGISTRY_STATUS_LABELS[record.status]}${
        record.statusSince ? ` desde ${brazilianDate(record.statusSince)}` : ''
      }`,
    ],
    [
      'registry.establishment_type',
      `Estabelecimento: ${
        record.headquarters === null ? NOT_INFORMED : record.headquarters ? 'matriz' : 'filial'
      }`,
    ],
    [
      'registry.activity_start',
      `Início de atividade: ${
        record.activityStart ? brazilianDate(record.activityStart) : NOT_INFORMED
      }`,
    ],
    [
      'registry.cnae_main',
      `CNAE principal: ${
        record.cnaeMain
          ? `${record.cnaeMain.code}${
              record.cnaeMain.description ? ` (${record.cnaeMain.description})` : ''
            }`
          : NOT_INFORMED
      }`,
    ],
    [
      'registry.cnae_secondary',
      `CNAEs secundários: ${
        record.cnaeSecondary.length > 0 ? record.cnaeSecondary.join(', ') : 'nenhum'
      }`,
    ],
    ['registry.legal_nature', `Natureza jurídica: ${legalNature}`],
    ['registry.size', `Porte: ${record.size ? SIZE_LABELS[record.size] : NOT_INFORMED}`],
    [
      'registry.tax_regime',
      `MEI: ${yesNo(record.isMei)}${
        record.simples === null ? '' : `; Simples Nacional: ${yesNo(record.simples)}`
      }`,
    ],
    [
      'registry.share_capital',
      `Capital social: ${record.capitalCents === null ? NOT_INFORMED : brl(record.capitalCents)}`,
    ],
    [
      'registry.location',
      record.city && record.uf
        ? `Município: ${record.city}/${record.uf}`
        : record.uf
          ? `UF: ${record.uf}`
          : `Município: ${NOT_INFORMED}`,
    ],
    [
      'provider',
      `Fonte: ${CNPJ_PROVIDER_LABELS[record.provider]}${
        record.providerUpdatedAt
          ? `, extração de ${brazilianDate(record.providerUpdatedAt.slice(0, 10))}`
          : ''
      }`,
    ],
  ]);
}

/** Texto normalizado da fonte (`sources.excerpt_text`): uma linha por campo. */
export function registryExcerpt(record: CnpjRegistryRecord): string {
  return [...registryLines(record).values()].join('\n');
}

/** Fato que substitui um fato antigo cujo dado não veio na nova consulta. */
const ABSENT_FACTS: Record<string, { domain: ClaimDomain; statement: string }> = {
  'registry.legal_name': {
    domain: 'firmographic',
    statement: 'A razão social é o nome da pessoa titular e fica só no cadastro da empresa.',
  },
  'registry.trade_name': {
    domain: 'firmographic',
    statement: 'O registro não traz nome fantasia guardado nas evidências.',
  },
  'registry.establishment_type': {
    domain: 'firmographic',
    statement: 'O registro não informa se o CNPJ é de matriz ou filial.',
  },
  'registry.activity_start': {
    domain: 'firmographic',
    statement: 'O registro não informa a data de início de atividade.',
  },
  'registry.cnae_main': {
    domain: 'firmographic',
    statement: 'O registro não informa a atividade principal.',
  },
  'registry.cnae_secondary': {
    domain: 'firmographic',
    statement: 'Nenhuma atividade secundária registrada.',
  },
  'registry.legal_nature': {
    domain: 'firmographic',
    statement: 'O registro não informa a natureza jurídica.',
  },
  'registry.size': { domain: 'firmographic', statement: 'O registro não informa o porte.' },
  'registry.share_capital': {
    domain: 'financial_proxy',
    statement: 'O registro não informa o capital social.',
  },
  'registry.location': {
    domain: 'firmographic',
    statement: 'O registro não informa o município.',
  },
};

/**
 * Fatos firmográficos que a consulta sustenta, cada um com a sua linha como trecho. `replacing`:
 * chaves em vigor da consulta anterior; a que não tiver dado agora ganha um fato de ausência, para
 * a versão antiga sair de cena em vez de ficar valendo com a fonte velha.
 */
export function registryFacts(
  record: CnpjRegistryRecord,
  options: { replacing?: ReadonlySet<string> } = {},
): RegistryFact[] {
  const lines = registryLines(record);
  const facts: RegistryFact[] = [];
  const add = (
    key: string,
    statement: string,
    value: Record<string, unknown>,
    domain: ClaimDomain = 'firmographic',
  ) => {
    const line = lines.get(key);
    if (line !== undefined) facts.push({ domain, key, statement, value, quote: line });
  };

  if (!isIndividualBusiness(record)) {
    add('registry.legal_name', `Razão social: ${record.legalName}.`, {
      legalName: record.legalName,
    });
  }
  if (record.tradeName && !personalTradeName(record)) {
    add('registry.trade_name', `Nome fantasia: ${record.tradeName}.`, {
      tradeName: record.tradeName,
    });
  }
  add(
    'registry.status',
    `Situação cadastral na Receita Federal: ${REGISTRY_STATUS_LABELS[record.status].toLowerCase()}${
      record.statusSince ? ` desde ${brazilianDate(record.statusSince)}` : ''
    }.`,
    { status: record.status, since: record.statusSince },
  );
  if (record.headquarters !== null) {
    add(
      'registry.establishment_type',
      record.headquarters ? 'O CNPJ é da matriz.' : 'O CNPJ é de uma filial.',
      { headquarters: record.headquarters },
    );
  }
  if (record.activityStart) {
    add(
      'registry.activity_start',
      `Início de atividade em ${brazilianDate(record.activityStart)}.`,
      {
        activityStart: record.activityStart,
      },
    );
  }
  if (record.cnaeMain) {
    add(
      'registry.cnae_main',
      `Atividade principal (CNAE ${record.cnaeMain.code})${
        record.cnaeMain.description ? `: ${record.cnaeMain.description}` : ''
      }.`,
      { code: record.cnaeMain.code, description: record.cnaeMain.description },
    );
  }
  if (record.cnaeSecondary.length > 0) {
    const count = record.cnaeSecondary.length;
    add(
      'registry.cnae_secondary',
      count === 1
        ? '1 atividade secundária registrada.'
        : `${count} atividades secundárias registradas.`,
      { codes: record.cnaeSecondary },
    );
  }
  if (record.legalNature) {
    add('registry.legal_nature', `Natureza jurídica: ${record.legalNature}.`, {
      legalNature: record.legalNature,
      code: record.legalNatureCode,
    });
  }
  if (record.size) {
    add('registry.size', `Porte na Receita: ${SIZE_LABELS[record.size]}.`, { size: record.size });
  }
  add(
    'registry.tax_regime',
    record.isMei
      ? 'É microempreendedor individual (MEI).'
      : record.simples === true
        ? 'Optante pelo Simples Nacional (não é MEI).'
        : 'Não é MEI.',
    { isMei: record.isMei, simples: record.simples },
  );
  if (record.capitalCents !== null) {
    add(
      'registry.share_capital',
      `Capital social declarado: ${brl(record.capitalCents)}.`,
      { cents: record.capitalCents },
      'financial_proxy',
    );
  }
  if (record.uf) {
    add(
      'registry.location',
      record.city ? `Sede em ${record.city}/${record.uf}.` : `Sede no estado ${record.uf}.`,
      { city: record.city, uf: record.uf },
    );
  }

  const produced = new Set(facts.map((fact) => fact.key));
  for (const key of options.replacing ?? []) {
    const absent = ABSENT_FACTS[key];
    if (produced.has(key) || !absent) continue;
    add(key, absent.statement, { informed: false }, absent.domain);
  }
  return facts;
}

/**
 * Quantos fatos mudaram de valor entre as versões em vigor e a nova consulta (chave nova, chave
 * que sumiu ou valor diferente). Só para a mensagem ao usuário.
 */
export function changedRegistryFacts(
  previous: ReadonlyArray<{ key: string; value: Record<string, unknown> | null }>,
  next: readonly RegistryFact[],
): number {
  const before = new Map(previous.map((claim) => [claim.key, JSON.stringify(claim.value)]));
  let changed = 0;
  for (const fact of next) {
    if (before.get(fact.key) !== JSON.stringify(fact.value)) changed += 1;
  }
  return changed;
}

/** Resumo do dossiê para a lista e o cabeçalho (estado lido no instante `now`). */
export interface ClaimSummary {
  readonly total: number;
  readonly facts: number;
  readonly inferences: number;
  readonly hypotheses: number;
  /** Vencidos (precisam de nova coleta). */
  readonly stale: number;
  readonly disputed: number;
}

export function summarizeClaims(
  claims: readonly Pick<Claim, 'epistemicType' | 'status' | 'validUntil'>[],
  now: Date,
): ClaimSummary {
  const current = claims.filter(
    (claim) => claim.status !== 'superseded' && claim.status !== 'rejected',
  );
  const statusOf = (claim: (typeof current)[number]) => effectiveStatus(claim, now);
  return {
    total: current.length,
    facts: current.filter((claim) => claim.epistemicType === 'fact').length,
    inferences: current.filter((claim) => claim.epistemicType === 'inference').length,
    hypotheses: current.filter((claim) => claim.epistemicType === 'hypothesis').length,
    stale: current.filter((claim) => statusOf(claim) === 'stale').length,
    disputed: current.filter((claim) => statusOf(claim) === 'disputed').length,
  };
}
