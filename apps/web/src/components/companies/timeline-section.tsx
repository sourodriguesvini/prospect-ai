import type { ClaimView } from '@prospector/application';
import { BusinessEvent, QUALITATIVE_LEVEL_LABELS } from '@prospector/contracts';
import {
  brazilianPartialDate,
  buildBusinessTimeline,
  dedupeEventEvidence,
  type EventEvidence,
} from '@prospector/domain';
import { Badge } from '@prospector/ui';
import { safeHref } from '@/components/companies/claim-card';
import { EPISTEMIC_LABELS } from '@/lib/company-labels';

/**
 * Linha do tempo de acontecimentos (diretriz 2026-11-26, Partes 2.4 e 7, seção 4): os
 * acontecimentos gravados pela análise em ordem de data, com a fonte, se é fato ou hipótese, a
 * importância e a consequência possível (leitura cautelosa), e as sequências que fazem sentido
 * juntas. Derivada dos claims `signal.web.*` em vigor; o mesmo acontecimento aparece uma vez.
 */
export function eventEvidenceOf(views: readonly ClaimView[]): EventEvidence[] {
  const items = views.flatMap((view) => {
    if (!view.claim.key.startsWith('signal.web.')) return [];
    const parsed = BusinessEvent.safeParse(view.claim.value?.event);
    return parsed.success
      ? [
          {
            claimId: view.claim.id,
            epistemicType: view.claim.epistemicType,
            event: parsed.data,
          },
        ]
      : [];
  });
  return dedupeEventEvidence(items);
}

export function TimelineSection({ views }: { views: readonly ClaimView[] }) {
  const items = eventEvidenceOf(views);
  if (items.length === 0) return null;
  const timeline = buildBusinessTimeline(items);
  return (
    <section className="space-y-3" aria-labelledby="linha-do-tempo">
      <h3 id="linha-do-tempo" className="text-sm font-medium">
        Linha do tempo de acontecimentos
      </h3>
      <ol className="divide-y text-sm">
        {timeline.entries.map((entry) => {
          const href = safeHref(entry.url);
          return (
            <li key={entry.claimId} className="space-y-1 py-2">
              <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="font-medium">
                  {entry.date ? brazilianPartialDate(entry.date) : 'Sem data'}
                </span>
                <span>{entry.label}</span>
                <Badge variant="neutral">{EPISTEMIC_LABELS[entry.epistemicType]}</Badge>
                <Badge variant="outline">
                  Importância {QUALITATIVE_LEVEL_LABELS[entry.importance].toLowerCase()}
                </Badge>
              </p>
              <p className="[overflow-wrap:anywhere]">
                {href ? (
                  <a
                    href={href}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="underline underline-offset-4"
                  >
                    {entry.headline}
                  </a>
                ) : (
                  entry.headline
                )}{' '}
                <span className="text-muted-foreground">
                  ({entry.host}
                  {entry.dateBasis === 'published' ? ', data da publicação' : ''}
                  {entry.independentlyConfirmed ? ', confirmado por outra fonte' : ''})
                </span>
              </p>
              <p className="text-muted-foreground">{entry.consequence}</p>
            </li>
          );
        })}
      </ol>
      {timeline.sequences.length > 0 ? (
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          {timeline.sequences.map((sequence) => (
            <li key={sequence.claimIds.join('-')}>{sequence.reading}</li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
