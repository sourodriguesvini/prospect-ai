import { OPPORTUNITY_PRIORITY_LABELS, type OpportunityStage } from '@prospector/contracts';
import { Badge, Button, DemoBadge, Panel, PanelHeader } from '@prospector/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { connection } from 'next/server';
import { Suspense } from 'react';
import { EmptyState, OpportunityCard, ReadAt } from '@/components/relationship/parts';
import { Loading } from '@/components/strategy/loading';
import { StorageNotice, Unavailable } from '@/components/strategy/page-parts';
import { formatCents, formatDate } from '@/lib/format';
import { OPEN_STAGES, stageLabel } from '@/lib/relationship-labels';
import { relationshipRoutes } from '@/lib/relationship-routes';
import { loadRelationship } from '@/server/relationship';

export const metadata: Metadata = { title: 'Conversas · Funil' };

type Props = PageProps<'/relacionamento/pipeline'>;

/**
 * Pipeline: kanban por etapa ou lista (mesma informação). Mover de etapa é no detalhe da
 * oportunidade, sempre por decisão explícita, com histórico e auditoria; nada muda sozinho.
 */
async function Pipeline({ searchParams }: Pick<Props, 'searchParams'>) {
  await connection();
  const query = await searchParams;
  const list = query.vista === 'lista';
  const includeClosed = query.encerradas === '1';
  const result = await loadRelationship(async (relationship, ctx) => {
    const [opportunities, overview] = await Promise.all([
      relationship.listOpportunities(ctx, { includeClosed }),
      relationship.overview(ctx),
    ]);
    return { opportunities, overview };
  });
  if (result.kind === 'unavailable') return <Unavailable message={result.message} />;
  const { opportunities, overview } = result.data;
  const stages: readonly OpportunityStage[] = includeClosed
    ? [...OPEN_STAGES, 'won', 'lost']
    : OPEN_STAGES;
  const byStage = (stage: OpportunityStage) => opportunities.filter((o) => o.stage === stage);
  const href = (next: { lista?: boolean; encerradas?: boolean }) => {
    const params = new URLSearchParams();
    if (next.lista ?? list) params.set('vista', 'lista');
    if (next.encerradas ?? includeClosed) params.set('encerradas', '1');
    const search = params.toString();
    return `${relationshipRoutes.pipeline}${search ? `?${search}` : ''}`;
  };

  return (
    <>
      <StorageNotice storage={result.storage} />
      <Panel aria-labelledby="pipeline">
        <PanelHeader
          titleId="pipeline"
          title="Funil"
          description={
            overview.valuedCount > 0
              ? `${overview.openCount} oportunidades abertas. Valor informado (só com base real): ${formatCents(overview.valueWithBasisCents)} em ${overview.valuedCount}.`
              : `${overview.openCount} oportunidades abertas. Nenhum valor informado: o valor só entra com uma base real (orçamento citado, proposta).`
          }
          actions={
            <>
              <Button asChild size="sm" variant="secondary">
                <Link href={href({ lista: !list })}>
                  {list ? 'Ver em colunas' : 'Ver em lista'}
                </Link>
              </Button>
              <Button asChild size="sm" variant="ghost">
                <Link href={href({ encerradas: !includeClosed })}>
                  {includeClosed ? 'Esconder encerradas' : 'Mostrar encerradas'}
                </Link>
              </Button>
            </>
          }
        />
        {opportunities.length === 0 ? (
          <EmptyState>
            Nenhuma conversa ainda. Elas começam na página de uma empresa (“Preparar mensagem” ou
            “Escrever sem a IA”).
          </EmptyState>
        ) : list ? (
          // `relative`: o texto só para leitor de tela (posição absoluta) dos selos fica preso aqui;
          // sem isso ele escapa da rolagem e alarga a página no celular.
          // Região rolável focável: no teclado, Tab chega nela e as setas rolam (WCAG 2.1.1).
          <div
            className="relative overflow-x-auto focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            tabIndex={0}
            role="region"
            aria-label="Tabela de oportunidades (role para os lados)"
          >
            <table className="w-full min-w-[40rem] text-left text-sm">
              <caption className="sr-only">Oportunidades por etapa</caption>
              <thead className="text-xs text-muted-foreground">
                <tr>
                  <th scope="col" className="py-2 pr-3 font-medium">
                    Empresa
                  </th>
                  <th scope="col" className="py-2 pr-3 font-medium">
                    Etapa
                  </th>
                  <th scope="col" className="py-2 pr-3 font-medium">
                    Prioridade
                  </th>
                  <th scope="col" className="py-2 pr-3 font-medium">
                    Último registro
                  </th>
                  <th scope="col" className="py-2 pr-3 font-medium">
                    Próximo follow-up
                  </th>
                  <th scope="col" className="py-2 font-medium">
                    Valor
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {stages.flatMap((stage) =>
                  byStage(stage).map((o) => (
                    <tr key={o.id} data-stage={o.stage}>
                      <td className="py-2 pr-3">
                        <span className="flex flex-wrap items-center gap-1.5">
                          <Link
                            href={relationshipRoutes.opportunity(o.id)}
                            className="font-medium underline-offset-4 hover:underline"
                          >
                            {o.companyName}
                          </Link>
                          {o.suppressed ? <Badge variant="danger">Não contatar</Badge> : null}
                          {o.isDemo || o.companyIsDemo ? <DemoBadge /> : null}
                        </span>
                      </td>
                      <td className="py-2 pr-3">{stageLabel(o.stage)}</td>
                      <td className="py-2 pr-3">{OPPORTUNITY_PRIORITY_LABELS[o.priority]}</td>
                      <td className="py-2 pr-3">
                        {o.lastInteractionAt ? formatDate(o.lastInteractionAt) : '—'}
                      </td>
                      <td className="py-2 pr-3">
                        {o.nextTaskDueAt ? formatDate(o.nextTaskDueAt) : '—'}
                      </td>
                      <td className="py-2">
                        {o.valueEstimateCents !== null ? formatCents(o.valueEstimateCents) : '—'}
                      </td>
                    </tr>
                  )),
                )}
              </tbody>
            </table>
          </div>
        ) : (
          <div
            className="relative -mx-1 overflow-x-auto pb-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            tabIndex={0}
            role="region"
            aria-label="Colunas do pipeline (role para os lados)"
          >
            <div className="flex min-w-max gap-3 px-1">
              {stages.map((stage) => {
                const items = byStage(stage);
                return (
                  <section
                    key={stage}
                    aria-labelledby={`coluna-${stage}`}
                    className="w-64 shrink-0 space-y-2 rounded-[var(--radius-tile)] bg-muted p-3"
                    data-column={stage}
                  >
                    <h3
                      id={`coluna-${stage}`}
                      className="flex items-center justify-between text-sm font-medium"
                    >
                      {stageLabel(stage)}
                      <span className="text-muted-foreground">{items.length}</span>
                    </h3>
                    {items.length === 0 ? (
                      <p className="text-xs text-muted-foreground">Vazia.</p>
                    ) : (
                      <ul className="space-y-2">
                        {items.map((opportunity) => (
                          <OpportunityCard key={opportunity.id} opportunity={opportunity} />
                        ))}
                      </ul>
                    )}
                  </section>
                );
              })}
            </div>
          </div>
        )}
        <ReadAt at={overview.readAt} />
      </Panel>
    </>
  );
}

export default function PipelineTab({ searchParams }: Props) {
  return (
    <div className="space-y-6">
      <Suspense fallback={<Loading label="Carregando o pipeline…" />}>
        <Pipeline searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
