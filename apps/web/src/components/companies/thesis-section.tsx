import type { ClaimView } from '@prospector/application';
import {
  QUALITATIVE_LEVEL_LABELS,
  THESIS_DIMENSION_LABELS,
  THESIS_RECOMMENDATION_LABELS,
  type CommercialThesis,
  type QualitativeLevel,
  type ThesisAngle,
  type ThesisRecommendation,
} from '@prospector/contracts';
import { Badge, Well } from '@prospector/ui';
import type { ReactNode } from 'react';
import { ClaimCard } from '@/components/companies/claim-card';

/**
 * Tese comercial (diretriz 2026-11-26, Parte 4.3): um ângulo principal, até duas alternativas,
 * seis dimensões qualitativas com motivo, o que não oferecer e o que confirmar. Só compõe o que o
 * motor de compatibilidade gravou no diagnóstico; ângulos e dimensões mostram os claims que os
 * sustentam e avisam quando eles foram substituídos por uma coleta mais nova.
 */

const LEVEL_VARIANT: Record<QualitativeLevel, 'success' | 'neutral' | 'warning' | 'outline'> = {
  high: 'success',
  medium: 'neutral',
  low: 'warning',
  unknown: 'outline',
};

const RECOMMENDATION_VARIANT: Record<ThesisRecommendation, 'success' | 'neutral' | 'outline'> = {
  approach: 'success',
  deepen_research: 'neutral',
  deprioritize: 'outline',
};

function Support({ ids, views }: { ids: readonly string[]; views: readonly ClaimView[] }) {
  if (ids.length === 0) return null;
  const byId = new Map(views.map((view) => [view.claim.id, view]));
  const support = ids.flatMap((id) => {
    const view = byId.get(id);
    return view ? [view] : [];
  });
  if (support.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        As evidências disto foram substituídas por uma coleta mais nova. Atualize a análise para
        rever com as fontes atuais.
      </p>
    );
  }
  return (
    <details className="text-sm">
      <summary className="cursor-pointer underline underline-offset-4">
        {support.length === 1
          ? 'Em que se apoia (1 evidência)'
          : `Em que se apoia (${support.length} evidências)`}
      </summary>
      <ul className="divide-y">
        {support.map((view) => (
          <ClaimCard key={view.claim.id} view={view} support={byId} />
        ))}
      </ul>
    </details>
  );
}

/** Par rótulo/texto: em coluna no celular (com respiro entre pares), lado a lado a partir de `sm`. */
function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-0.5 sm:grid-cols-[10rem_minmax(0,1fr)] sm:gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 [overflow-wrap:anywhere]">{children}</dd>
    </div>
  );
}

function Angle({
  angle,
  views,
  principal,
}: {
  angle: ThesisAngle;
  views: readonly ClaimView[];
  principal: boolean;
}) {
  return (
    <div className="space-y-3">
      <h4 className={principal ? 'text-base font-medium' : 'text-sm font-medium'}>{angle.title}</h4>
      <dl className="space-y-3 text-sm sm:space-y-2">
        <Row label="Contexto">{angle.context}</Row>
        <Row label="Problema provável">{angle.problem}</Row>
        <Row label="O que oferecer">{angle.offer.join(' · ')}</Row>
        {principal ? (
          <>
            <Row label="Por que faz sentido">{angle.why}</Row>
            <Row label="Por que agora">{angle.whyNow}</Row>
            <Row label="Com quem falar">{angle.approachRole}</Row>
            <Row label="Assunto para abrir">{angle.openingTopic}</Row>
          </>
        ) : null}
      </dl>
      <Support ids={angle.claimIds} views={views} />
    </div>
  );
}

export function ThesisSection({
  thesis,
  views,
}: {
  thesis: CommercialThesis;
  views: readonly ClaimView[];
}) {
  return (
    <section className="space-y-4" aria-labelledby="tese-comercial">
      <div className="flex flex-wrap items-center gap-2">
        <h3 id="tese-comercial" className="text-sm font-medium">
          Tese comercial
        </h3>
        <Badge variant={RECOMMENDATION_VARIANT[thesis.recommendation]}>
          {THESIS_RECOMMENDATION_LABELS[thesis.recommendation]}
        </Badge>
      </div>
      <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">
        {thesis.recommendationReason}
      </p>

      {thesis.principal ? (
        <Angle angle={thesis.principal} views={views} principal />
      ) : (
        <Well className="py-4 text-sm text-muted-foreground">
          Ainda não há acontecimento nem sinal que sustente um ângulo de abordagem. A tese é refeita
          a cada análise: atualize a análise quando houver novidades sobre a empresa.
        </Well>
      )}

      {thesis.alternatives.length > 0 ? (
        <details className="text-sm">
          <summary className="cursor-pointer underline underline-offset-4">
            {`Outros ângulos possíveis (${thesis.alternatives.length})`}
          </summary>
          <div className="mt-3 space-y-5">
            {thesis.alternatives.map((angle) => (
              <Angle key={angle.problemId} angle={angle} views={views} principal={false} />
            ))}
          </div>
        </details>
      ) : null}

      <div className="space-y-2">
        <h4 className="text-sm font-medium">Avaliação, dimensão por dimensão</h4>
        <ul className="divide-y text-sm">
          {thesis.dimensions.map((dimension) => (
            <li key={dimension.key} className="flex flex-col gap-1 py-2 sm:flex-row sm:gap-4">
              <span className="flex shrink-0 items-center justify-between gap-2 sm:w-64">
                <span>{THESIS_DIMENSION_LABELS[dimension.key]}</span>
                <Badge variant={LEVEL_VARIANT[dimension.level]}>
                  {QUALITATIVE_LEVEL_LABELS[dimension.level]}
                </Badge>
              </span>
              <div className="min-w-0 space-y-1">
                <p className="text-muted-foreground [overflow-wrap:anywhere]">{dimension.reason}</p>
                <Support ids={dimension.claimIds} views={views} />
              </div>
            </li>
          ))}
        </ul>
      </div>

      {thesis.doNotOffer.length > 0 ? (
        <div className="space-y-2">
          <h4 className="text-sm font-medium">O que não oferecer</h4>
          <ul className="list-disc space-y-1 pl-5 text-sm [overflow-wrap:anywhere]">
            {thesis.doNotOffer.map((item) => (
              <li key={item.item}>
                <span className="font-medium">{item.item}</span>: {item.reason}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {thesis.toConfirm.length > 0 ? (
        <div className="space-y-2">
          <h4 className="text-sm font-medium">O que confirmar antes</h4>
          <ul className="list-disc space-y-1 pl-5 text-sm [overflow-wrap:anywhere]">
            {thesis.toConfirm.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
