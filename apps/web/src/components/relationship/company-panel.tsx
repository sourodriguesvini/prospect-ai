import { SUPPRESSION_REASON_LABELS } from '@prospector/contracts';
import { Alert, Button, Panel, PanelHeader } from '@prospector/ui';
import Link from 'next/link';
import { Suspense } from 'react';
import { Loading } from '@/components/strategy/loading';
import { formatDate } from '@/lib/format';
import { preparedOfferId, stageLabel } from '@/lib/relationship-labels';
import { relationshipRoutes } from '@/lib/relationship-routes';
import { activeOfferOptions, loadRelationship } from '@/server/relationship';
import { openOpportunityAction, prepareApproachAction } from '@/app/(shell)/relacionamento/actions';
import { OpenOpportunityForm, PrepareApproachForm } from './forms';
import { DiagnosisNote, OpportunityBadges, OpportunityFacts } from './parts';
import { SuppressionLift } from './suppression';

/**
 * Relacionamento no dossiê da empresa (ADR-0014): a oportunidade aberta, ou o começo de uma
 * ("Preparar abordagem" com a IA local, ou abrir sem IA). Empresa com opt-out não recebe contato.
 */
async function Relationship({ companyId, archived }: { companyId: string; archived: boolean }) {
  const result = await loadRelationship((relationship, ctx) =>
    relationship.forCompany(ctx, companyId),
  );
  if (result.kind === 'unavailable') {
    return <p className="text-sm text-muted-foreground">{result.message}</p>;
  }
  const { open, closed, activeSuppressions, insights } = result.data;
  const suppressed = activeSuppressions.length > 0;
  const offers = open || suppressed || archived ? [] : await activeOfferOptions();
  const recommendedOfferId = preparedOfferId(
    offers,
    null,
    insights.recommendedService?.offerId ?? null,
  );
  return (
    <div className="space-y-4">
      {suppressed ? (
        <Alert tone="danger" role="note" data-suppressed>
          <p className="font-medium">Não contatar esta empresa.</p>
          <p className="text-sm">
            {activeSuppressions
              .map(
                (entry) =>
                  `${SUPPRESSION_REASON_LABELS[entry.reason]} (${formatDate(entry.createdAt)})`,
              )
              .join('; ')}
            .
          </p>
          {open ? null : (
            <SuppressionLift
              entries={activeSuppressions}
              companyId={companyId}
              opportunityId={null}
              summary="Foi engano? Retirar da lista"
              hint="Fica registrado na auditoria."
            />
          )}
        </Alert>
      ) : null}
      {open ? (
        <div className="space-y-2" data-open-opportunity={open.id}>
          <div className="flex flex-wrap items-center gap-1.5">
            <OpportunityBadges opportunity={open} />
          </div>
          <OpportunityFacts opportunity={open} />
          <Button asChild size="sm">
            <Link href={relationshipRoutes.opportunity(open.id)}>Abrir a oportunidade</Link>
          </Button>
        </div>
      ) : archived ? (
        <p className="text-sm text-muted-foreground">
          Empresa arquivada: mude a etapa para abrir uma oportunidade.
        </p>
      ) : suppressed ? null : (
        <div className="space-y-4">
          <DiagnosisNote insights={insights} offers={offers} />
          {offers.length > 0 ? (
            <PrepareApproachForm
              action={prepareApproachAction.bind(null, companyId)}
              offers={offers}
              defaultOfferId={recommendedOfferId}
            />
          ) : (
            <p className="text-sm text-muted-foreground">
              Nenhuma oferta ativa na Estratégia: sem ela, a IA não tem o que propor. Você ainda
              pode abrir a oportunidade e escrever à mão.
            </p>
          )}
          <OpenOpportunityForm
            action={openOpportunityAction.bind(null, companyId)}
            offers={offers}
            defaultOfferId={recommendedOfferId}
          />
        </div>
      )}
      {closed.length > 0 ? (
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">Oportunidades encerradas</p>
          <ul className="space-y-1 text-sm">
            {closed.map((item) => (
              <li key={item.id}>
                <Link
                  href={relationshipRoutes.opportunity(item.id)}
                  className="underline underline-offset-4"
                >
                  {stageLabel(item.stage)}
                  {item.closedAt ? ` em ${formatDate(item.closedAt)}` : ''}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

export function CompanyRelationshipPanel({
  companyId,
  archived,
}: {
  companyId: string;
  archived: boolean;
}) {
  return (
    <Panel aria-labelledby="relacionamento">
      <PanelHeader
        titleId="relacionamento"
        title="Relacionamento"
        description="Abordagem, mensagens e conversa com esta empresa. Nada é enviado pelo app."
      />
      <Suspense fallback={<Loading label="Carregando o relacionamento…" />}>
        <Relationship companyId={companyId} archived={archived} />
      </Suspense>
    </Panel>
  );
}
