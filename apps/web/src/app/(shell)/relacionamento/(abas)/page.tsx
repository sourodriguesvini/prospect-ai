import { MESSAGE_KIND_LABELS, MESSAGE_STATUS_LABELS } from '@prospector/contracts';
import { Badge, Button, Panel, PanelHeader } from '@prospector/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { connection } from 'next/server';
import { Suspense } from 'react';
import {
  EmptyState,
  OpportunityBadges,
  OpportunityFacts,
  ReadAt,
} from '@/components/relationship/parts';
import { Loading } from '@/components/strategy/loading';
import { ReadinessChecklist, StorageNotice, Unavailable } from '@/components/strategy/page-parts';
import { companyRoutes } from '@/lib/company-routes';
import { formatDateTime } from '@/lib/format';
import { relationshipRoutes } from '@/lib/relationship-routes';
import { strategyRoutes } from '@/lib/strategy-routes';
import { loadRelationship } from '@/server/relationship';
import { loadStrategy } from '@/server/strategy';

export const metadata: Metadata = { title: 'Conversas · Para enviar' };

/**
 * Aba Abordagens: a barreira da estratégia (desde a F2), os rascunhos que esperam revisão e as
 * abordagens preparadas. A abordagem começa no dossiê da empresa ("Preparar abordagem").
 */
async function Gate() {
  await connection();
  const result = await loadStrategy((strategy, ctx) => strategy.overview(ctx));
  if (result.kind === 'unavailable') return <Unavailable message={result.message} />;
  const { snapshot, readiness } = result.data;
  const gate = readiness.approach;
  const offer = snapshot.offers.find((o) => o.id === gate.offerId);
  return (
    <Panel aria-label="Condições para abordar" className="space-y-4">
      <ReadinessChecklist
        gate={gate}
        title="Pronto para aprovar mensagens?"
        titleId="condicoes-abordagem"
        headingLevel="h2"
        offerName={offer?.current?.content.name ?? null}
        readyText="A estratégia está pronta: mensagens revisadas podem ser aprovadas para uso. O envio é sempre manual, e a supressão é conferida de novo ao registrar o contato."
        blockedText="Rascunhos podem ser preparados e revisados, mas aprovar mensagens fica bloqueado até cada item obrigatório abaixo estar atendido."
      />
      {gate.ready ? null : (
        <div className="flex flex-wrap gap-2">
          <Button asChild size="sm">
            <Link href={strategyRoutes.overview}>Abrir a estratégia</Link>
          </Button>
          <Button asChild size="sm" variant="secondary">
            <Link href={strategyRoutes.compliance}>Abrir a conformidade</Link>
          </Button>
        </div>
      )}
    </Panel>
  );
}

async function Approaches() {
  await connection();
  const result = await loadRelationship(async (relationship, ctx) => {
    const [queue, opportunities] = await Promise.all([
      relationship.approvalQueue(ctx),
      relationship.listOpportunities(ctx, { stages: ['approach_ready'] }),
    ]);
    return { queue, opportunities };
  });
  if (result.kind === 'unavailable') return <Unavailable message={result.message} />;
  const { queue, opportunities } = result.data;
  return (
    <>
      <StorageNotice storage={result.storage} />
      <Panel aria-labelledby="para-revisar">
        <PanelHeader
          titleId="para-revisar"
          title="Rascunhos para revisar"
          description="A versão mais recente de cada mensagem ainda não aprovada. Revise, edite se precisar e aprove no detalhe da oportunidade."
        />
        {queue.pending.length === 0 ? (
          <EmptyState>
            Nenhum rascunho esperando revisão. Para começar, abra uma empresa em{' '}
            <Link href={companyRoutes.list} className="underline underline-offset-4">
              Empresas
            </Link>{' '}
            e use “Preparar mensagem”.
          </EmptyState>
        ) : (
          <ul className="divide-y divide-border">
            {queue.pending.map(({ view, opportunity }) => (
              <li
                key={view.message.id}
                className="flex flex-wrap items-start justify-between gap-3 py-3"
              >
                <div className="min-w-0 space-y-1">
                  <Link
                    href={relationshipRoutes.opportunitySection(opportunity.id, 'mensagens')}
                    className="break-words font-medium underline-offset-4 hover:underline"
                  >
                    {opportunity.companyName}
                  </Link>
                  <p className="text-sm text-muted-foreground">
                    {MESSAGE_KIND_LABELS[view.message.kind]} · v{view.message.version} · criada em{' '}
                    {formatDateTime(view.message.createdAt)}
                  </p>
                  {view.issues.length > 0 ? (
                    <p className="text-sm text-warning">
                      Falta corrigir: {view.issues.map((issue) => issue.message).join(' ')}
                    </p>
                  ) : null}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <Badge>{MESSAGE_STATUS_LABELS[view.status]}</Badge>
                  <OpportunityBadges opportunity={opportunity} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      <Panel aria-labelledby="preparadas">
        <PanelHeader
          titleId="preparadas"
          title="Abordagens preparadas"
          description="Oportunidades com estratégia pronta e ainda sem contato registrado."
        />
        {opportunities.length === 0 ? (
          <EmptyState>Nenhuma abordagem preparada esperando o primeiro contato.</EmptyState>
        ) : (
          <ul className="divide-y divide-border">
            {opportunities.map((opportunity) => (
              <li key={opportunity.id} className="space-y-1 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    href={relationshipRoutes.opportunity(opportunity.id)}
                    className="break-words font-medium underline-offset-4 hover:underline"
                  >
                    {opportunity.companyName}
                  </Link>
                  <OpportunityBadges opportunity={opportunity} />
                </div>
                <OpportunityFacts opportunity={opportunity} />
              </li>
            ))}
          </ul>
        )}
        <ReadAt at={queue.readAt} />
      </Panel>
    </>
  );
}

export default function ApproachesTab() {
  return (
    <div className="space-y-6">
      <Suspense fallback={<Loading label="Verificando se as abordagens podem ser liberadas…" />}>
        <Gate />
      </Suspense>
      <Suspense fallback={<Loading label="Carregando as abordagens…" />}>
        <Approaches />
      </Suspense>
    </div>
  );
}
