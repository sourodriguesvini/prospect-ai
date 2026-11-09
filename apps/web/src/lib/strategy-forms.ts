import type {
  ContactPolicyContent,
  IcpContent,
  LiaContent,
  OfferContent,
  ProofAsset,
  VoiceGuideContent,
} from '@prospector/contracts';
import {
  all,
  brlToCents,
  centsToBrl,
  checked,
  formatMunicipality,
  joinLines,
  lines,
  optionalInt,
  parseMunicipality,
  text,
  type FormValues,
} from './form-data';

/**
 * Formulários da Estratégia: campos (texto) ↔ entradas dos contratos. Os nomes dos campos são
 * os caminhos do contrato, para os erros de validação caírem no campo certo.
 */

// --- Oferta ----------------------------------------------------------------------

export function offerInput(v: FormValues) {
  return {
    name: text(v, 'name'),
    description: text(v, 'description'),
    problems: lines(text(v, 'problems')),
    needSignals: lines(text(v, 'needSignals')),
    disqualifiers: lines(text(v, 'disqualifiers')),
    deliverables: lines(text(v, 'deliverables')),
    valueProps: lines(text(v, 'valueProps')),
    priceMinCents: brlToCents(text(v, 'priceMinCents')),
    priceMaxCents: brlToCents(text(v, 'priceMaxCents')),
  };
}

export function offerValues(content: OfferContent | null): FormValues {
  if (!content) return {};
  return {
    name: content.name,
    description: content.description,
    problems: joinLines(content.problems),
    needSignals: joinLines(content.needSignals),
    disqualifiers: joinLines(content.disqualifiers),
    deliverables: joinLines(content.deliverables),
    valueProps: joinLines(content.valueProps),
    priceMinCents: centsToBrl(content.priceMinCents),
    priceMaxCents: centsToBrl(content.priceMaxCents),
  };
}

// --- ICP -------------------------------------------------------------------------

export function icpInput(v: FormValues) {
  return {
    name: text(v, 'name'),
    description: text(v, 'description'),
    filters: {
      cnaes: lines(text(v, 'filters.cnaes')),
      ufs: all(v, 'filters.ufs'),
      municipalities: lines(text(v, 'filters.municipalities')).map(parseMunicipality),
      sizes: all(v, 'filters.sizes'),
      minAgeYears: optionalInt(text(v, 'filters.minAgeYears')),
      maxAgeYears: optionalInt(text(v, 'filters.maxAgeYears')),
    },
    exclusions: {
      cnaes: lines(text(v, 'exclusions.cnaes')),
      municipalities: lines(text(v, 'exclusions.municipalities')).map(parseMunicipality),
      cnpjRoots: lines(text(v, 'exclusions.cnpjRoots')),
      domains: lines(text(v, 'exclusions.domains')),
    },
  };
}

export function icpValues(content: IcpContent | null): FormValues {
  if (!content) return {};
  const { filters, exclusions } = content;
  return {
    name: content.name,
    description: content.description,
    'filters.cnaes': joinLines(filters.cnaes),
    'filters.ufs': filters.ufs,
    'filters.municipalities': joinLines(filters.municipalities.map(formatMunicipality)),
    'filters.sizes': filters.sizes,
    'filters.minAgeYears': filters.minAgeYears === null ? '' : String(filters.minAgeYears),
    'filters.maxAgeYears': filters.maxAgeYears === null ? '' : String(filters.maxAgeYears),
    'exclusions.cnaes': joinLines(exclusions.cnaes),
    'exclusions.municipalities': joinLines(exclusions.municipalities.map(formatMunicipality)),
    'exclusions.cnpjRoots': joinLines(exclusions.cnpjRoots),
    'exclusions.domains': joinLines(exclusions.domains),
  };
}

// --- Voz da agência ----------------------------------------------------------------

/** Exemplos de mensagem podem ter várias linhas: separados por uma linha com "---". */
function examples(value: string): string[] {
  return value
    .split(/\r?\n---+\r?\n/)
    .map((block) => block.trim())
    .filter((block) => block.length > 0);
}

export function voiceInput(v: FormValues) {
  return {
    summary: text(v, 'summary'),
    principles: lines(text(v, 'principles')),
    avoid: lines(text(v, 'avoid')),
    goodExamples: examples(text(v, 'goodExamples')),
    badExamples: examples(text(v, 'badExamples')),
  };
}

export function voiceValues(content: VoiceGuideContent | null): FormValues {
  if (!content) return {};
  return {
    summary: content.summary,
    principles: joinLines(content.principles),
    avoid: joinLines(content.avoid),
    goodExamples: content.goodExamples.join('\n---\n'),
    badExamples: content.badExamples.join('\n---\n'),
  };
}

// --- Cases ---------------------------------------------------------------------------

export function proofAssetInput(v: FormValues) {
  const offerId = text(v, 'offerId');
  return {
    offerId: offerId === '' ? null : offerId,
    title: text(v, 'title'),
    segment: text(v, 'segment'),
    summary: text(v, 'summary'),
    results: text(v, 'results'),
    publicOk: checked(v, 'publicOk'),
    consentRef: text(v, 'consentRef'),
  };
}

export function proofAssetValues(asset: ProofAsset | null): FormValues {
  if (!asset) return {};
  return {
    offerId: asset.offerId ?? '',
    title: asset.title,
    segment: asset.segment,
    summary: asset.summary,
    results: asset.results,
    ...(asset.publicOk ? { publicOk: 'on' } : {}),
    consentRef: asset.consentRef,
  };
}

// --- LIA e política de contato ----------------------------------------------------------

export function liaInput(v: FormValues) {
  return {
    purpose: text(v, 'purpose'),
    legitimateInterest: text(v, 'legitimateInterest'),
    necessity: text(v, 'necessity'),
    dataCategories: all(v, 'dataCategories'),
    dataSources: all(v, 'dataSources'),
    expectations: text(v, 'expectations'),
    risks: text(v, 'risks'),
    safeguards: text(v, 'safeguards'),
    conclusion: text(v, 'conclusion'),
  };
}

export function liaValues(content: LiaContent | null): FormValues {
  if (!content) return {};
  return { ...content, dataCategories: content.dataCategories, dataSources: content.dataSources };
}

export function contactPolicyInput(v: FormValues) {
  return {
    agencyName: text(v, 'agencyName'),
    privacyContact: text(v, 'privacyContact'),
    optOutText: text(v, 'optOutText'),
  };
}

export function contactPolicyValues(content: ContactPolicyContent | null): FormValues {
  return content ? { ...content } : {};
}
