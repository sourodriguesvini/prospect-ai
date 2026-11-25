import {
  FUNNEL_STAGE_HINTS,
  FUNNEL_STAGE_LABELS,
  type FunnelStageView,
} from '@prospector/contracts';
import { DemoBadge } from '@prospector/ui';
import { formatCount, formatShare } from '@/lib/insights';

/**
 * Funil de prospecção (D16, F13; ADR-0017) em barras. A barra é só desenho (proporcional à maior
 * etapa); o número, a razão e os avisos estão em texto, para leitor de tela e para quem imprime.
 * Número "+" = a leitura parou no teto de linhas e o real pode ser maior.
 */

function countText(stage: FunnelStageView): string {
  return `${formatCount(stage.count)}${stage.capped ? '+' : ''}`;
}

function shareText(stage: FunnelStageView, minSample: number): string | null {
  if (stage.shareOfPrevious === null) return null;
  const share = `${formatShare(stage.shareOfPrevious)} da etapa anterior`;
  return stage.reliability === 'small'
    ? `${share} · amostra pequena: menos de ${minSample} empresas na etapa anterior`
    : share;
}

export function FunnelBars({
  funnel,
  minSample,
  compact = false,
}: {
  funnel: readonly FunnelStageView[];
  minSample: number;
  /** Versão da Início: só as contagens, sem razão nem explicações (estão na Inteligência). */
  compact?: boolean;
}) {
  const max = Math.max(1, ...funnel.map((stage) => stage.count));
  return (
    <ol className={compact ? 'space-y-2' : 'space-y-4'} data-funnel="">
      {funnel.map((stage) => {
        const share = compact ? null : shareText(stage, minSample);
        const width = stage.count === 0 ? 0 : Math.max(2, (stage.count / max) * 100);
        return (
          <li key={stage.stage} className="space-y-1" data-stage={stage.stage}>
            <div className="flex items-baseline justify-between gap-3">
              <span className="flex min-w-0 flex-wrap items-center gap-x-2 text-sm font-medium">
                {FUNNEL_STAGE_LABELS[stage.stage]}
                {stage.demo > 0 ? (
                  <span className="inline-flex items-center gap-1 text-xs font-normal text-muted-foreground">
                    <DemoBadge />
                    {stage.demo === stage.count
                      ? 'todas de demonstração'
                      : `${formatCount(stage.demo)} de demonstração`}
                  </span>
                ) : null}
              </span>
              <span className="shrink-0 text-sm font-medium tabular-nums" data-count="">
                {countText(stage)}
              </span>
            </div>
            <div aria-hidden="true" className="h-2 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-primary" style={{ width: `${width}%` }} />
            </div>
            {!compact ? (
              <p className="text-xs text-muted-foreground">
                {FUNNEL_STAGE_HINTS[stage.stage]}
                {share ? <span className="block text-foreground">{share}</span> : null}
              </p>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
