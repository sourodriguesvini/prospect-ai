import type { ClaimView } from '@prospector/application';
import { CONFIDENCE_BAND_LABELS } from '@prospector/contracts';
import { Badge, DemoBadge } from '@prospector/ui';
import { CircleCheck } from 'lucide-react';
import {
  CLAIM_STATUS_LABELS,
  CONFIDENCE_BAND_VARIANT,
  EPISTEMIC_LABELS,
} from '@/lib/company-labels';
import { formatDate, formatDateTime } from '@/lib/format';

const percent = new Intl.NumberFormat('pt-BR', { style: 'percent', maximumFractionDigits: 0 });

/** Só endereços web viram link (nada de `javascript:` ou `data:` vindo de uma fonte). */
export function safeHref(url: string | null): string | null {
  return url && /^https?:\/\//i.test(url) ? url : null;
}

function comparable(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** Até quando o claim vale antes de pedir nova conferência. */
export function ClaimValidity({ view }: { view: ClaimView }) {
  return (
    <span className="text-xs text-muted-foreground">
      {view.status === 'stale'
        ? `Venceu em ${formatDate(view.claim.validUntil)}: consulte de novo`
        : `Reconferir a partir de ${formatDate(view.claim.validUntil)}`}
    </span>
  );
}

/** Selos de um claim: tipo, confiança calculada no servidor, estado, DEMO e, se pedido, o prazo. */
export function ClaimBadges({
  view,
  withValidity = true,
}: {
  view: ClaimView;
  withValidity?: boolean;
}) {
  const { claim } = view;
  const confidence =
    claim.confidence === null
      ? CONFIDENCE_BAND_LABELS[view.band]
      : `Confiança ${CONFIDENCE_BAND_LABELS[view.band].toLowerCase()} (${percent.format(claim.confidence)})`;
  return (
    <p className="flex flex-wrap items-center gap-2 text-xs">
      <Badge variant="neutral">{EPISTEMIC_LABELS[claim.epistemicType]}</Badge>
      <Badge variant={CONFIDENCE_BAND_VARIANT[view.band]}>{confidence}</Badge>
      {view.status === 'active' ? null : (
        <Badge variant={view.status === 'stale' ? 'warning' : 'danger'}>
          {CLAIM_STATUS_LABELS[view.status]}
        </Badge>
      )}
      {claim.isDemo ? <DemoBadge /> : null}
      {withValidity ? <ClaimValidity view={view} /> : null}
    </p>
  );
}

/**
 * Um claim do dossiê: o que se afirma e cada evidência com o trecho conferido. Num grupo de mesma
 * fonte e mesmos selos, a fonte, os selos e (se igual) o prazo aparecem uma vez no grupo
 * (`shared`), não em cada linha.
 */
export function ClaimCard({
  view,
  shared,
}: {
  view: ClaimView;
  shared?: { sourceId: string | null; badges: boolean; validity: boolean };
}) {
  const { claim } = view;
  return (
    <li className="space-y-1.5 py-3">
      <p className="text-pretty">{claim.statement}</p>
      {!shared?.badges ? (
        <ClaimBadges view={view} />
      ) : !shared.validity ? (
        <p>
          <ClaimValidity view={view} />
        </p>
      ) : null}
      {claim.reasoning ? (
        <p className="text-sm text-muted-foreground">Raciocínio: {claim.reasoning}</p>
      ) : null}
      {view.evidence.length > 0 ? (
        <ul className="space-y-1.5">
          {view.evidence.map(({ evidence, source }) => {
            const ownSource = source !== null && source.id !== shared?.sourceId;
            const href = safeHref(source?.url ?? null);
            const title = source?.title ?? source?.provider ?? 'Fonte sem título';
            const showQuote =
              evidence.quote !== null && comparable(evidence.quote) !== comparable(claim.statement);
            return (
              <li key={`${evidence.claimId}-${evidence.sourceId}`} className="space-y-1 text-sm">
                {ownSource ? (
                  <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="text-muted-foreground">
                      {evidence.stance === 'contradicts' ? 'Contradiz:' : 'Fonte:'}
                    </span>
                    {href ? (
                      <a
                        href={href}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="underline underline-offset-4 [overflow-wrap:anywhere]"
                      >
                        {title}
                        <span className="sr-only"> (abre em nova aba)</span>
                      </a>
                    ) : (
                      <span>{title}</span>
                    )}
                    <span className="text-muted-foreground">
                      · coletado em {formatDateTime(source.capturedAt)}
                    </span>
                  </p>
                ) : null}
                {showQuote ? (
                  <blockquote className="border-l-2 border-border pl-3 text-muted-foreground [overflow-wrap:anywhere]">
                    <span className="sr-only">Trecho da fonte: </span>“{evidence.quote}”
                  </blockquote>
                ) : null}
                {evidence.quoteVerified ? (
                  <p className="inline-flex items-center gap-1 text-xs text-success">
                    <CircleCheck aria-hidden="true" className="size-3.5" />
                    Trecho conferido na fonte
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </li>
  );
}
