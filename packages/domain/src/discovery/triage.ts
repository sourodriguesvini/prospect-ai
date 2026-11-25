import {
  DISCOVERY_TRIAGE_RUBRIC,
  SIGNAL_TYPE_LABELS,
  SIGNAL_VERIFICATION_LABELS,
  type AnalysisConfidence,
  type CompanyLifecycle,
  type CompanySize,
  type Municipality,
  type PriorityBand,
  type ProspectAssessment,
  type ProspectSourceRelation,
  type ScoreWeights,
  type SignalRecency,
  type SignalRelevance,
  type SignalType,
  type SignalVerification,
  type TriageDimension,
  type TriageReason,
  type UF,
} from '@prospector/contracts';
import { registrableDomain } from './hosts';
import { normalizeCity, stripAccents } from './names';

/**
 * Triagem da Descoberta — rubrica `discovery-triage/v1` (docs/08 §3 adaptada; ADR-0013).
 *
 * Pré-qualificação, não diagnóstico: usa quatro das cinco dimensões do modelo de score da oferta
 * (aderência, sinais, atualidade, porte) e deixa "necessidade" para a investigação em Empresas.
 * - Cada dimensão vale 0–100 ou null (sem evidência). Dimensão sem evidência entra como neutra
 *   (40) na conta e baixa a cobertura; com cobertura menor que 50% ou sem aderência avaliável o
 *   resultado é "Informações insuficientes".
 * - Faixas: 70+ alta, 50–69 média, abaixo de 50 baixa. Bloqueio (exclusão do ICP, cliente,
 *   arquivada) força "baixa" e aparece como motivo.
 * - A confiança da análise é separada da prioridade: diz quanto da conta se apoia em fato
 *   conferido (site lido, sinal confirmado, CNPJ), não a chance de virar cliente.
 * - Todo motivo aponta as fontes que o sustentam; motivo sem fonte é regra do sistema.
 */

export const TRIAGE_NEUTRAL_POINTS = 40;
export const TRIAGE_HIGH_FROM = 70;
export const TRIAGE_MEDIUM_FROM = 50;
export const TRIAGE_MIN_COVERAGE = 0.5;

const DIMENSIONS: readonly TriageDimension[] = ['fit', 'signal', 'timing', 'capacity'];

/** Pesos sem "necessidade" quando não há modelo de score da oferta (mesma proporção do padrão). */
export const DEFAULT_TRIAGE_WEIGHTS: Record<TriageDimension, number> = {
  fit: 25,
  signal: 20,
  capacity: 15,
  timing: 10,
};

export interface TriageSignal {
  type: SignalType;
  verification: SignalVerification;
  relevance: SignalRelevance;
  recency: SignalRecency;
  sourceId: string;
  summary: string;
}

export interface TriageSource {
  id: string;
  relation: ProspectSourceRelation;
}

export interface TriageInput {
  name: string;
  domain: string | null;
  /** Há site oficial identificado (mesmo sem leitura). */
  hasOfficialSite: boolean;
  /** O site oficial foi lido e confere com o nome. */
  siteVerified: boolean;
  officialSiteSourceId: string | null;
  segment: string | null;
  description: string | null;
  city: string | null;
  uf: UF | null;
  cnpj: string | null;
  sources: readonly TriageSource[];
  signals: readonly TriageSignal[];
  /** O que o pedido procurava (intenção interpretada). */
  wanted: {
    segment: string | null;
    segmentTerms: readonly string[];
    cities: readonly string[];
    ufs: readonly UF[];
    signals: readonly SignalType[];
  } | null;
  icp: {
    versionId: string;
    ufs: readonly UF[];
    municipalities: readonly Municipality[];
    /** Portes que o ICP aceita; vazio = qualquer porte. */
    sizes?: readonly CompanySize[];
    exclusions: {
      domains: readonly string[];
      cnpjRoots: readonly string[];
      municipalities: readonly Municipality[];
    };
  } | null;
  scoring: { versionId: string; weights: ScoreWeights } | null;
  /** Situação no módulo Empresas, quando já existe empresa ligada. */
  companyLifecycle: CompanyLifecycle | null;
  /** Porte do registro da Receita, quando já se sabe. */
  sizeBand: CompanySize | null;
  now: Date;
}

export interface TriageResult {
  priority: PriorityBand;
  /** null quando as informações são insuficientes (não existe "nota" sem base). */
  priorityScore: number | null;
  confidence: AnalysisConfidence;
  assessment: ProspectAssessment;
}

// -----------------------------------------------------------------------------
// Auxiliares
// -----------------------------------------------------------------------------

function words(text: string): string[] {
  return stripAccents(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((word) => word.length >= 4);
}

function sameStem(a: string, b: string): boolean {
  if (a.length >= 5 && b.length >= 5) return a.slice(0, 5) === b.slice(0, 5);
  return a === b;
}

/** Algum termo do segmento pedido aparece no texto (com plural e flexões simples). */
export function segmentMatches(text: string, terms: readonly string[]): boolean {
  const haystack = words(text);
  return terms.some((term) => words(term).some((word) => haystack.some((h) => sameStem(h, word))));
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function trimText(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

/** Pesos do modelo de score sem "necessidade", renormalizados para somar 1. */
export function triageWeights(weights: ScoreWeights | null): Record<TriageDimension, number> {
  const base: Record<TriageDimension, number> = weights
    ? {
        fit: weights.fit,
        signal: weights.signal,
        capacity: weights.capacity,
        timing: weights.timing,
      }
    : DEFAULT_TRIAGE_WEIGHTS;
  let total = DIMENSIONS.reduce((sum, dimension) => sum + base[dimension], 0);
  const source = total > 0 ? base : DEFAULT_TRIAGE_WEIGHTS;
  if (total <= 0) total = DIMENSIONS.reduce((sum, dimension) => sum + source[dimension], 0);
  return Object.fromEntries(
    DIMENSIONS.map((dimension) => [
      dimension,
      Math.round((source[dimension] / total) * 1000) / 1000,
    ]),
  ) as Record<TriageDimension, number>;
}

// -----------------------------------------------------------------------------
// Dimensões
// -----------------------------------------------------------------------------

interface Scored {
  points: number | null;
  reasons: TriageReason[];
  /** Aderência: as fontes descrevem um segmento que não é o pedido. */
  segmentMismatch?: boolean;
}

/** Segmento não informado nas fontes: nem confirma nem afasta o setor pedido. */
export const TRIAGE_UNKNOWN_SEGMENT_POINTS = 50;

function evidenceIds(input: TriageInput): string[] {
  const ids = input.officialSiteSourceId ? [input.officialSiteSourceId] : [];
  for (const source of input.sources) if (!ids.includes(source.id)) ids.push(source.id);
  return ids.slice(0, 3);
}

function scoreFit(input: TriageInput): Scored {
  const reasons: TriageReason[] = [];
  const parts: number[] = [];
  let segmentMismatch = false;
  const sourceIds = evidenceIds(input);

  // Segmento: o pedido (termos) contra o que as fontes dizem da empresa.
  const terms = [...(input.wanted?.segmentTerms ?? [])];
  if (input.wanted?.segment) terms.push(input.wanted.segment);
  if (terms.length > 0) {
    const described = [input.segment, input.description].filter(Boolean).join(' ');
    const text = `${input.name} ${described}`;
    if (segmentMatches(text, terms)) {
      parts.push(100);
      reasons.push({
        text: trimText(
          `Segmento compatível com o pedido${input.segment ? `: ${input.segment}` : ''}.`,
          300,
        ),
        sourceIds,
      });
    } else if (described) {
      parts.push(30);
      segmentMismatch = true;
      reasons.push({
        text: trimText(
          `O segmento descrito nas fontes (${input.segment ?? 'outro'}) não bate com o pedido.`,
          300,
        ),
        sourceIds,
      });
    } else {
      // Sem segmento nas fontes, a região sozinha dava aderência máxima: a "Neodent" (fábrica de
      // implantes) entrava como média numa busca de clínicas (teste real de 2026-11-25).
      parts.push(TRIAGE_UNKNOWN_SEGMENT_POINTS);
      reasons.push({
        text: 'As fontes não dizem o segmento da empresa: falta confirmar se é do setor pedido.',
        sourceIds: [],
      });
    }
  }

  // Região: o pedido manda; sem região no pedido, vale a do ICP.
  const wantedCities = (input.wanted?.cities ?? []).map(normalizeCity);
  let wantedUfs = [...(input.wanted?.ufs ?? [])];
  let cities = wantedCities;
  if (cities.length === 0 && wantedUfs.length === 0 && input.icp) {
    cities = input.icp.municipalities.map((item) => normalizeCity(item.name));
    wantedUfs = [...input.icp.ufs, ...input.icp.municipalities.map((item) => item.uf)];
  }
  if (cities.length > 0 || wantedUfs.length > 0) {
    const city = input.city ? normalizeCity(input.city) : null;
    const where = [input.city, input.uf].filter(Boolean).join('/');
    if (city && cities.includes(city)) {
      parts.push(100);
      reasons.push({ text: `Fica em ${where}, na região pedida.`, sourceIds });
    } else if (input.uf && wantedUfs.includes(input.uf)) {
      parts.push(cities.length > 0 && city ? 45 : cities.length > 0 ? 60 : 100);
      reasons.push({
        text:
          cities.length > 0
            ? `Fica em ${where}: no estado pedido, mas não confirmada na cidade.`
            : `Fica em ${where}, no estado pedido.`,
        sourceIds,
      });
    } else if (city || input.uf) {
      parts.push(10);
      reasons.push({ text: `Fica em ${where}, fora da região pedida.`, sourceIds });
    }
  }

  if (parts.length === 0) return { points: null, reasons, segmentMismatch };
  return {
    points: clampScore(parts.reduce((a, b) => a + b, 0) / parts.length),
    reasons,
    segmentMismatch,
  };
}

const RELEVANCE_POINTS: Record<SignalRelevance, number> = { high: 90, medium: 70, low: 45 };
const VERIFICATION_FACTOR: Record<SignalVerification, number> = { confirmed: 1, hypothesis: 0.65 };
const RECENCY_POINTS_FACTOR: Record<SignalRecency, number> = {
  recent: 1,
  unknown: 0.8,
  older: 0.5,
};

function signalPoints(signal: TriageSignal): number {
  return (
    RELEVANCE_POINTS[signal.relevance] *
    VERIFICATION_FACTOR[signal.verification] *
    RECENCY_POINTS_FACTOR[signal.recency]
  );
}

function rankedSignals(input: TriageInput): TriageSignal[] {
  return [...input.signals].sort((a, b) => signalPoints(b) - signalPoints(a));
}

function scoreSignal(input: TriageInput): Scored {
  if (input.signals.length === 0) return { points: null, reasons: [] };
  const ranked = rankedSignals(input);
  const best = ranked[0];
  if (!best) return { points: null, reasons: [] };
  let points = signalPoints(best);
  const types = new Set(ranked.map((signal) => signal.type));
  points += Math.min(20, (types.size - 1) * 10);
  const wanted = input.wanted?.signals ?? [];
  if (wanted.length > 0 && ranked.some((signal) => wanted.includes(signal.type))) points += 10;
  const reasons = ranked.slice(0, 3).map((signal) => ({
    text: trimText(
      `${SIGNAL_TYPE_LABELS[signal.type]} (${SIGNAL_VERIFICATION_LABELS[signal.verification].toLowerCase()}): ${signal.summary}`,
      300,
    ),
    sourceIds: [signal.sourceId],
  }));
  return { points: clampScore(points), reasons };
}

function scoreTiming(input: TriageInput): Scored {
  if (input.signals.length === 0) return { points: null, reasons: [] };
  const recent = input.signals.filter((signal) => signal.recency === 'recent');
  if (recent.length > 0) {
    const confirmed = recent.some((signal) => signal.verification === 'confirmed');
    return {
      points: confirmed ? 90 : 75,
      reasons: [
        {
          text: confirmed
            ? 'Há acontecimento recente confirmado na fonte (últimos 6 meses).'
            : 'Há indício de acontecimento recente, ainda a confirmar.',
          sourceIds: recent.slice(0, 3).map((signal) => signal.sourceId),
        },
      ],
    };
  }
  if (input.signals.some((signal) => signal.recency === 'unknown')) {
    return {
      points: 50,
      reasons: [{ text: 'Os sinais não têm data clara: atualidade incerta.', sourceIds: [] }],
    };
  }
  return {
    points: 25,
    reasons: [
      {
        text: 'Os sinais encontrados são antigos (mais de 6 meses).',
        sourceIds: input.signals.slice(0, 3).map((signal) => signal.sourceId),
      },
    ],
  };
}

const SIZE_POINTS: Record<CompanySize, number> = { me: 40, epp: 65, demais: 85 };
const SIZE_LABELS: Record<CompanySize, string> = {
  me: 'microempresa',
  epp: 'empresa de pequeno porte',
  demais: 'porte médio ou grande',
};
const GROWTH_SIGNALS: readonly SignalType[] = ['expansion', 'investment', 'hiring'];

function scoreCapacity(input: TriageInput): Scored {
  const reasons: TriageReason[] = [];
  let points: number | null = null;
  const wantedSizes = input.icp?.sizes ?? [];
  if (input.sizeBand && wantedSizes.length > 0) {
    // O ICP diz que porte interessa (dado da Estratégia): a regra fixa de "maior é melhor" sai.
    const fits = wantedSizes.includes(input.sizeBand);
    points = fits ? 85 : 25;
    reasons.push({
      text: fits
        ? `Porte no cadastro da Receita (${SIZE_LABELS[input.sizeBand]}) está entre os do perfil de cliente.`
        : `Porte no cadastro da Receita (${SIZE_LABELS[input.sizeBand]}) fora dos portes do perfil de cliente.`,
      sourceIds: [],
    });
  } else if (input.sizeBand) {
    points = SIZE_POINTS[input.sizeBand];
    reasons.push({
      text: `Porte no cadastro da Receita: ${SIZE_LABELS[input.sizeBand]}.`,
      sourceIds: [],
    });
  } else if (input.siteVerified) {
    points = 55;
    reasons.push({
      text: `Tem site próprio conferido (${input.domain ?? 'site oficial'}): operação estruturada.`,
      sourceIds: input.officialSiteSourceId ? [input.officialSiteSourceId] : [],
    });
  }
  const growth = input.signals.find(
    (signal) => signal.verification === 'confirmed' && GROWTH_SIGNALS.includes(signal.type),
  );
  if (growth) {
    points = (points ?? 50) + 15;
    reasons.push({
      text: 'Sinal confirmado de crescimento (expansão, investimento ou contratação).',
      sourceIds: [growth.sourceId],
    });
  }
  return { points: points === null ? null : clampScore(points), reasons };
}

// -----------------------------------------------------------------------------
// Bloqueios, lacunas e confiança
// -----------------------------------------------------------------------------

const PUBLIC_DOMAIN_SUFFIXES = ['gov.br', 'leg.br', 'jus.br', 'mp.br', 'def.br'];
const TEACHING_DOMAIN_SUFFIXES = ['edu.br', 'edu'];
/**
 * Domínio de país que não é o Brasil (KI-148): "ucsf.edu" e afins já caem em ensino. Ficam de fora
 * os de país usados no mundo todo como genéricos (.io, .ai, .co, .me, .tv…), comuns em startups
 * brasileiras.
 */
const FOREIGN_COUNTRY_TLDS = new Set(
  'pt es uk de fr it ar mx cl pe uy py bo ec ve us ca au nz jp cn kr in ru za ie nl be ch at se no dk fi pl cz gr tr il ae sa'.split(
    ' ',
  ),
);
/** Palavras do nome ou do segmento que indicam órgão público. */
const PUBLIC_WORDS = [
  'municipal',
  'municipais',
  'prefeitura',
  'governo',
  'servico publico',
  'orgao publico',
  'administracao publica',
  'autarquia',
  // Unidades do SUS (teste real de 2026-11-25: "Clínica Odontológica da Unidade de Saúde Mãe
  // Curitibana", com fonte só na prefeitura, saiu como média).
  'unidade de saude',
  'unidade basica',
  'posto de saude',
  'centro de saude',
];
/** Só com contexto: "Secretária Virtual" e "Federal Pet" são empresas. */
const PUBLIC_PATTERNS = [
  /\bsecretaria (municipal|estadual|de|da|do)\b/,
  /\b(hospital|universidade|instituto|escola|colegio|policia) (estadual|federal)\b/,
  // UBS e UPA do SUS, sem pegar o banco "UBS BB".
  /\b(ubs|upa) (24h|\d+|vila|jardim|parque|bairro|central|municipal|de|do|da|dos|das)\b/,
];
/** Instituição de ensino: universidade, faculdade ou clínica/hospital-escola. */
const TEACHING_PATTERNS = [
  /\buniversidade\b/,
  /\bfaculdade\b/,
  /\b(clinica|hospital)( \w+)? escola\b/,
  /\b(uf[a-z]{2,3}|puc|puc[a-z]{2}|unesp|unicamp|usp)\b/,
];

function plain(text: string | null | undefined): string {
  return ` ${stripAccents(text ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()} `;
}

/**
 * Órgão público ou instituição de ensino (KI-148): a Descoberta procura empresas privadas, então
 * "Hospital Veterinário Municipal", "Hospital Veterinário – UFPR" e prefeituras viram bloqueio
 * com motivo, a não ser que o próprio pedido procure esse tipo de instituição.
 */
export function institutionKind(input: {
  name: string;
  domain: string | null;
  segment: string | null;
}): 'public' | 'teaching' | null {
  const domain = (input.domain ?? '').toLowerCase();
  const endsWith = (suffix: string) => domain === suffix || domain.endsWith(`.${suffix}`);
  if (PUBLIC_DOMAIN_SUFFIXES.some(endsWith)) return 'public';
  if (TEACHING_DOMAIN_SUFFIXES.some(endsWith)) return 'teaching';
  // Lugares com nome de órgão, mas que não são órgão: "Pet Shop do Mercado Municipal".
  const text = plain(`${input.name} ${input.segment ?? ''}`)
    .replaceAll(' distrito federal ', ' ')
    .replaceAll(' mercado municipal ', ' ');
  if (PUBLIC_WORDS.some((word) => text.includes(` ${word} `))) return 'public';
  if (PUBLIC_PATTERNS.some((pattern) => pattern.test(text))) return 'public';
  if (TEACHING_PATTERNS.some((pattern) => pattern.test(text))) return 'teaching';
  return null;
}

/** Site oficial com domínio de outro país ("clinica.pt"): a Descoberta procura empresas no Brasil. */
export function foreignSiteTld(domain: string | null): string | null {
  const tld = (domain ?? '').toLowerCase().split('.').pop() ?? '';
  return FOREIGN_COUNTRY_TLDS.has(tld) ? tld : null;
}

function wantsInstitutions(input: TriageInput): boolean {
  const wanted = plain([input.wanted?.segment, ...(input.wanted?.segmentTerms ?? [])].join(' '));
  return / (publico|publica|prefeituras?|governo|escolas?|universidades?|faculdades?|ensino|educacao) /.test(
    wanted,
  );
}

function gatesOf(input: TriageInput): string[] {
  const gates: string[] = [];
  const kind = wantsInstitutions(input) ? null : institutionKind(input);
  if (kind === 'public') {
    gates.push('Parece órgão público; a Descoberta procura empresas privadas.');
  } else if (kind === 'teaching') {
    gates.push('Parece instituição de ensino (universidade ou clínica-escola), não empresa.');
  }
  const foreign = foreignSiteTld(input.domain);
  if (foreign) gates.push(`O site oficial é de fora do Brasil (domínio .${foreign}).`);
  const exclusions = input.icp?.exclusions;
  if (exclusions && input.domain) {
    const domain = registrableDomain(input.domain);
    if (exclusions.domains.some((item) => registrableDomain(item) === domain)) {
      gates.push(`O domínio ${domain} está nas exclusões do ICP.`);
    }
  }
  if (exclusions && input.cnpj && exclusions.cnpjRoots.includes(input.cnpj.slice(0, 8))) {
    gates.push('A raiz do CNPJ está nas exclusões do ICP.');
  }
  if (exclusions && input.city && input.uf) {
    const city = normalizeCity(input.city);
    if (
      exclusions.municipalities.some(
        (item) => item.uf === input.uf && normalizeCity(item.name) === city,
      )
    ) {
      gates.push(`${input.city}/${input.uf} está nas exclusões do ICP.`);
    }
  }
  if (input.companyLifecycle === 'customer') gates.push('Já é cliente (módulo Empresas).');
  if (input.companyLifecycle === 'archived') gates.push('Empresa arquivada no módulo Empresas.');
  if (input.companyLifecycle === 'disqualified') {
    gates.push('Empresa já descartada no módulo Empresas.');
  }
  return gates.slice(0, 4);
}

function missingOf(input: TriageInput): string[] {
  const missing: string[] = [];
  if (!input.hasOfficialSite) missing.push('Encontrar o site oficial da empresa.');
  else if (!input.siteVerified) missing.push('Conferir o site oficial (a página não foi lida).');
  if (!input.city) missing.push('Confirmar a cidade da empresa.');
  if (input.signals.length === 0) {
    missing.push('Procurar sinais comerciais recentes (expansão, vagas, lançamentos).');
  } else if (input.signals.some((signal) => signal.verification === 'hypothesis')) {
    missing.push('Confirmar os sinais marcados como hipótese.');
  }
  if (!input.cnpj) missing.push('Confirmar o CNPJ e os dados cadastrais.');
  missing.push('Avaliar a necessidade (marca, site, comunicação) ao investigar em Empresas.');
  return missing.slice(0, 6);
}

function confidenceOf(input: TriageInput, coverage: number): AnalysisConfidence {
  let value = coverage * 0.5;
  if (input.siteVerified) value += 0.2;
  if (input.signals.some((signal) => signal.verification === 'confirmed')) value += 0.2;
  if (input.cnpj) value += 0.1;
  if (value >= 0.75) return 'high';
  if (value >= 0.45) return 'medium';
  return 'low';
}

// -----------------------------------------------------------------------------
// Triagem
// -----------------------------------------------------------------------------

export function assessProspect(input: TriageInput): TriageResult {
  const weights = triageWeights(input.scoring?.weights ?? null);
  const scored: Record<TriageDimension, Scored> = {
    fit: scoreFit(input),
    signal: scoreSignal(input),
    timing: scoreTiming(input),
    capacity: scoreCapacity(input),
  };
  const dimensions = Object.fromEntries(
    DIMENSIONS.map((dimension) => [dimension, scored[dimension].points]),
  ) as Record<TriageDimension, number | null>;
  const assessed = DIMENSIONS.filter((dimension) => dimensions[dimension] !== null).length;
  const coverage = Math.round((assessed / DIMENSIONS.length) * 100) / 100;
  const score = clampScore(
    DIMENSIONS.reduce(
      (sum, dimension) =>
        sum + weights[dimension] * (dimensions[dimension] ?? TRIAGE_NEUTRAL_POINTS),
      0,
    ),
  );

  const gates = gatesOf(input);
  const insufficient = dimensions.fit === null || coverage < TRIAGE_MIN_COVERAGE;
  let priority: PriorityBand;
  if (gates.length > 0) priority = 'low';
  else if (insufficient) priority = 'insufficient';
  // Segmento diferente do pedido não sobe por sinal forte: "Caixa" (banco) e "Neodent" (fábrica)
  // saíam como média em buscas de outro setor (testes reais de 2026-11-24 e 2026-11-25).
  else if (scored.fit.segmentMismatch) priority = 'low';
  else if (score >= TRIAGE_HIGH_FROM) priority = 'high';
  else if (score >= TRIAGE_MEDIUM_FROM) priority = 'medium';
  else priority = 'low';

  const reasons = [
    ...scored.fit.reasons,
    ...scored.signal.reasons,
    ...scored.timing.reasons,
    ...scored.capacity.reasons,
  ].slice(0, 8);

  return {
    priority,
    priorityScore: insufficient && gates.length === 0 ? null : score,
    confidence: confidenceOf(input, coverage),
    assessment: {
      rubric: DISCOVERY_TRIAGE_RUBRIC,
      dimensions,
      weights,
      coverage,
      reasons,
      missing: missingOf(input),
      gates,
      icpVersionId: input.icp?.versionId ?? null,
      scoringModelVersionId: input.scoring?.versionId ?? null,
      assessedAt: input.now.toISOString(),
    },
  };
}
