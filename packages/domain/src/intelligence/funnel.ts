import { FunnelStage, type FunnelStageView, type SampleReliability } from '@prospector/contracts';

/**
 * Funil de prospecção (D16, F13; ADR-0017). Cada etapa conta empresas distintas no período, pela
 * data da própria etapa (não é coorte). A razão em relação à etapa anterior só aparece quando a
 * anterior tem empresas, a razão não passa de 100% (num funil por período isso pode acontecer, e
 * aí o número enganaria) e nenhuma das duas contagens parou no teto de leitura. Abaixo da amostra mínima, a razão vem marcada como amostra pequena:
 * "toda métrica exibe tamanho de amostra e aviso quando n é pequeno" (doc 02, D16).
 */

export const FUNNEL_MIN_SAMPLE = 20;

export interface StageTally {
  count: number;
  /** Quantas são registros de demonstração. */
  demo: number;
  /** A leitura chegou ao teto de linhas. */
  capped: boolean;
}

export const EMPTY_STAGE_TALLY: StageTally = { count: 0, demo: 0, capped: false };

function share(previous: StageTally, current: StageTally): number | null {
  // Contagem que parou no teto é só um mínimo: a razão sairia errada.
  if (previous.capped || current.capped) return null;
  if (previous.count <= 0 || current.count > previous.count) return null;
  return Math.round((current.count / previous.count) * 1000) / 1000;
}

export function buildFunnel(
  tallies: Partial<Record<FunnelStage, StageTally>>,
  minSample: number = FUNNEL_MIN_SAMPLE,
): FunnelStageView[] {
  const stages = FunnelStage.options;
  return stages.map((stage, index) => {
    const current = sanitize(tallies[stage]);
    const previousStage = index > 0 ? stages[index - 1] : undefined;
    const previous = previousStage ? sanitize(tallies[previousStage]) : null;
    const shareOfPrevious = previous ? share(previous, current) : null;
    const reliability: SampleReliability =
      shareOfPrevious === null || !previous ? 'none' : previous.count < minSample ? 'small' : 'ok';
    return {
      stage,
      count: current.count,
      demo: current.demo,
      capped: current.capped,
      shareOfPrevious,
      reliability,
    };
  });
}

/** Contagens negativas ou fracionárias (defeito de leitura) não chegam à tela. */
function sanitize(tally: StageTally | undefined): StageTally {
  if (!tally) return EMPTY_STAGE_TALLY;
  const count = Math.max(0, Math.floor(tally.count));
  return {
    count,
    demo: Math.min(count, Math.max(0, Math.floor(tally.demo))),
    capped: tally.capped,
  };
}

/** Empresas distintas (e quantas são demonstração) a partir de linhas com `companyId`. */
export function tallyDistinct(
  rows: readonly { companyId: string; isDemo: boolean }[],
  capped = false,
): StageTally {
  const companies = new Map<string, boolean>();
  for (const row of rows) {
    companies.set(row.companyId, (companies.get(row.companyId) ?? false) || row.isDemo);
  }
  let demo = 0;
  for (const isDemo of companies.values()) if (isDemo) demo += 1;
  return { count: companies.size, demo, capped };
}
