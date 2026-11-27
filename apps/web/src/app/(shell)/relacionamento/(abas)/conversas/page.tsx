import { Panel, PanelHeader, StatTile } from '@prospector/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { connection } from 'next/server';
import { Suspense } from 'react';
import {
  AttentionList,
  EmptyState,
  OpportunityBadges,
  OpportunityFacts,
  ReadAt,
} from '@/components/relationship/parts';
import { Loading } from '@/components/strategy/loading';
import { StorageNotice, Unavailable } from '@/components/strategy/page-parts';
import { formatDateTime } from '@/lib/format';
import { relationshipRoutes } from '@/lib/relationship-routes';
import { loadRelationship } from '@/server/relationship';

export const metadata: Metadata = { title: 'Conversas · Em andamento' };

/** Etapas em que há conversa a acompanhar (depois do primeiro contato, antes de fechar). */
const IN_CONTACT = ['contacted', 'in_conversation', 'meeting', 'proposal', 'negotiation'] as const;

async function Conversations() {
  await connection();
  const result = await loadRelationship((relationship, ctx) => relationship.overview(ctx));
  if (result.kind === 'unavailable') return <Unavailable message={result.message} />;
  const overview = result.data;
  const inContact = overview.opportunities
    .filter((opportunity) => (IN_CONTACT as readonly string[]).includes(opportunity.stage))
    .sort((a, b) => (b.lastInteractionAt ?? '').localeCompare(a.lastInteractionAt ?? ''));
  return (
    <>
      <StorageNotice storage={result.storage} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Follow-ups vencidos" value={overview.tasksOverdue} />
        <StatTile label="Follow-ups para hoje" value={overview.tasksToday} />
        <StatTile label="Rascunhos para revisar" value={overview.draftsToReview} />
        <StatTile label="Oportunidades abertas" value={overview.openCount} />
      </div>
      <Panel aria-labelledby="hoje">
        <PanelHeader
          titleId="hoje"
          title="Para acompanhar hoje"
          description="Em ordem de urgência: follow-up vencido, resposta esperando retorno, follow-up do dia, rascunho parado, prospect sem resposta e oportunidade sem próximo passo. Empresa que pediu para parar não gera cobrança de contato."
        />
        <AttentionList items={overview.attention} />
      </Panel>
      <Panel aria-labelledby="em-contato">
        <PanelHeader
          titleId="em-contato"
          title="Em contato"
          description="Oportunidades depois do primeiro contato, da conversa mais recente para a mais antiga."
        />
        {inContact.length === 0 ? (
          <EmptyState>
            Nenhuma conversa registrada ainda. Depois de enviar uma mensagem aprovada, registre o
            contato feito no detalhe da oportunidade.
          </EmptyState>
        ) : (
          <ul className="divide-y divide-border">
            {inContact.map((opportunity) => (
              <li key={opportunity.id} className="space-y-1 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    href={relationshipRoutes.opportunitySection(opportunity.id, 'conversa')}
                    className="break-words font-medium underline-offset-4 hover:underline"
                  >
                    {opportunity.companyName}
                  </Link>
                  <OpportunityBadges opportunity={opportunity} />
                </div>
                <p className="text-xs text-muted-foreground">
                  {opportunity.lastInboundAt
                    ? `Última resposta da empresa em ${formatDateTime(opportunity.lastInboundAt)}`
                    : 'Sem resposta da empresa ainda'}
                  {opportunity.lastOutboundAt
                    ? ` · último contato seu em ${formatDateTime(opportunity.lastOutboundAt)}`
                    : ''}
                </p>
                <OpportunityFacts opportunity={opportunity} />
              </li>
            ))}
          </ul>
        )}
        <ReadAt at={overview.readAt} />
      </Panel>
    </>
  );
}

export default function ConversationsTab() {
  return (
    <div className="space-y-6">
      <Suspense fallback={<Loading label="Carregando as conversas…" />}>
        <Conversations />
      </Suspense>
    </div>
  );
}
