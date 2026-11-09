import type { SourceReliabilityTier } from '@prospector/contracts';
import type {
  AssessedDependency,
  AssessedEvidence,
  AssessedSource,
  SourceClassificationContext,
} from '../../src';

/** Relógio fixo dos testes. */
export const NOW = new Date('2026-11-09T12:00:00.000Z');
export const DAY_MS = 86_400_000;

export function msAgo(ms: number): string {
  return new Date(NOW.getTime() - ms).toISOString();
}

export function daysAgo(days: number): string {
  return msAgo(days * DAY_MS);
}

export function daysFromNow(days: number): string {
  return new Date(NOW.getTime() + days * DAY_MS).toISOString();
}

/** Listas de classificação dos testes; o sujeito dos claims é a clínica. */
export const CLASSIFICATION: SourceClassificationContext = {
  officialProviders: ['base_cnpj'],
  ownedOrigins: ['clinica.example.test', 'instagram.example.test/clinica'],
  pressHosts: ['jornal.example.test'],
  aggregatorHosts: ['diretorio.example.test'],
};

const HOSTS: Record<SourceReliabilityTier, string> = {
  official_registry: '',
  company_owned: 'https://clinica.example.test/sobre',
  recognized_press: 'https://jornal.example.test/materia',
  aggregator: 'https://diretorio.example.test/clinica',
  user_reported: '',
  unknown: 'https://blog.example.test/post',
};

/** Fonte de teste com a categoria que `CLASSIFICATION` dá a ela (conferido em sources.test). */
export type TestSource = AssessedSource & { readonly tier: SourceReliabilityTier };

export function source(
  tier: SourceReliabilityTier,
  capturedAt: string = NOW.toISOString(),
  override: Partial<AssessedSource> = {},
): TestSource {
  if (tier === 'official_registry') {
    return { kind: 'api_record', url: null, provider: 'base_cnpj', capturedAt, tier, ...override };
  }
  if (tier === 'user_reported') {
    return { kind: 'user_note', url: null, provider: null, capturedAt, tier, ...override };
  }
  return { kind: 'web_page', url: HOSTS[tier], provider: null, capturedAt, tier, ...override };
}

function plain({ kind, url, provider, capturedAt }: TestSource): AssessedSource {
  return { kind, url, provider, capturedAt };
}

export function supports(src: TestSource): AssessedEvidence {
  return { stance: 'supports', reliabilityTier: src.tier, source: plain(src) };
}

export function contradicts(src: TestSource): AssessedEvidence {
  return { stance: 'contradicts', reliabilityTier: src.tier, source: plain(src) };
}

export function dependency(override: Partial<AssessedDependency> = {}): AssessedDependency {
  return {
    epistemicType: 'fact',
    status: 'active',
    confidence: 0.95,
    validUntil: daysFromNow(100),
    ...override,
  };
}
