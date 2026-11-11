import { MONITOR_FREQUENCY_LABELS, MONITOR_STATUS_LABELS } from '@prospector/contracts';
import { Alert, Badge, DemoBadge, Panel, PanelHeader, Well } from '@prospector/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { connection } from 'next/server';
import { Suspense } from 'react';
import { ActionAnnouncer } from '@/components/discovery/announcers';
import { ActionButton, MonitorForm } from '@/components/discovery/discovery-forms';
import { Loading } from '@/components/strategy/loading';
import { PageHeader, StorageNotice, Unavailable } from '@/components/strategy/page-parts';
import { discoveryRoutes, readDiscoveryNotice } from '@/lib/discovery-routes';
import { formatDateTime } from '@/lib/format';
import { loadDiscovery } from '@/server/discovery';
import { discoveryDailyAutoCredits } from '@/server/env';
import { createMonitorAction, runMonitorNowAction, setMonitorStatusAction } from '../actions';

export const metadata: Metadata = { title: 'Monitoramentos' };

type Props = PageProps<'/descoberta/monitoramentos'>;

function one(value: string | string[] | undefined): string {
  return ((Array.isArray(value) ? value[0] : value) ?? '').slice(0, 500);
}

async function Monitors({ searchParams }: { searchParams: Props['searchParams'] }) {
  await connection();
  const params = await searchParams;
  const notice = readDiscoveryNotice(params.aviso);
  const prefill = { request: one(params.pedido), name: one(params.nome).slice(0, 120) };
  const result = await loadDiscovery(async (discovery, ctx) => {
    const [monitors, status] = await Promise.all([
      discovery.listMonitors(ctx),
      discovery.status(ctx),
    ]);
    return { monitors, status };
  });
  if (result.kind === 'unavailable') return <Unavailable message={result.message} />;
  const { monitors, status } = result.data;
  const dailyCredits = discoveryDailyAutoCredits();
  const prefilled = prefill.request !== '';

  return (
    <>
      <StorageNotice storage={result.storage} />
      {notice ? (
        <Alert tone="success" role="status">
          {notice}
        </Alert>
      ) : null}
      {status.search !== 'enabled' ? (
        <Alert tone="warning" role="status">
          A pesquisa na internet não está disponível: monitoramentos ficam esperando e tentam de
          novo no próximo horário, sem inventar resultados.
        </Alert>
      ) : null}
      <Alert tone="info" role="note">
        {dailyCredits === 0
          ? 'Monitoramentos não rodam sozinhos nesta instalação (DISCOVERY_DAILY_AUTO_CREDITS=0). Use “Rodar agora”.'
          : `Monitoramentos rodam sozinhos com o app aberto, até ${dailyCredits} créditos da Tavily por dia no total. Com o computador desligado, a execução perdida é recuperada uma vez só quando o app abre.`}
      </Alert>

      <Panel aria-labelledby="lista-monitoramentos">
        <PanelHeader title="Seus monitoramentos" titleId="lista-monitoramentos" />
        <ActionAnnouncer listTitleId="lista-monitoramentos">
          {monitors.length === 0 ? (
            <Well className="py-8 text-center text-sm text-muted-foreground">
              Nenhum monitoramento. Crie um abaixo ou, numa pesquisa concluída, use “Monitorar este
              pedido”.
            </Well>
          ) : (
            <ul className="divide-y">
              {monitors.map((monitor) => (
                <li key={monitor.id} className="space-y-2 py-4" data-card="">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 space-y-0.5">
                      <h3
                        id={`monitoramento-${monitor.id}`}
                        tabIndex={-1}
                        data-card-title=""
                        className="flex flex-wrap items-center gap-2 break-words font-medium"
                      >
                        {monitor.name}
                        {monitor.isDemo ? <DemoBadge /> : null}
                      </h3>
                      <p className="break-words text-sm text-muted-foreground">{monitor.request}</p>
                    </div>
                    <Badge variant={monitor.status === 'active' ? 'success' : 'outline'}>
                      {MONITOR_STATUS_LABELS[monitor.status]}
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {MONITOR_FREQUENCY_LABELS[monitor.frequency]} · até {monitor.maxSearches}{' '}
                    {monitor.maxSearches === 1 ? 'busca' : 'buscas'} e {monitor.maxProspects}{' '}
                    empresas por execução
                    {monitor.status === 'active' && monitor.nextRunAt
                      ? ` · próxima: ${formatDateTime(monitor.nextRunAt)}`
                      : ''}
                    {monitor.missedRuns > 0
                      ? ` · ${monitor.missedRuns} ${monitor.missedRuns === 1 ? 'execução perdida' : 'execuções perdidas'} (computador desligado ou buscador indisponível)`
                      : ''}
                  </p>
                  {monitor.lastRunId ? (
                    <p className="text-sm">
                      <Link
                        href={discoveryRoutes.run(monitor.lastRunId)}
                        className="underline underline-offset-4"
                      >
                        Última execução
                        {monitor.lastRunAt ? ` (${formatDateTime(monitor.lastRunAt)})` : ''}
                      </Link>
                    </p>
                  ) : null}
                  <div className="flex flex-wrap items-start gap-2">
                    {monitor.status !== 'archived' ? (
                      <ActionButton
                        action={runMonitorNowAction.bind(null, monitor.id)}
                        pendingLabel="Criando…"
                      >
                        Rodar agora<span className="sr-only">: {monitor.name}</span>
                      </ActionButton>
                    ) : null}
                    {/* Pausar e Retomar ocupam o mesmo lugar: o foco continua no botão. */}
                    {monitor.status === 'active' ? (
                      <ActionButton
                        action={setMonitorStatusAction.bind(null, monitor.id, 'paused')}
                        pendingLabel="Pausando…"
                        success={{
                          message: `Monitoramento “${monitor.name}” pausado.`,
                          focus: 'self',
                        }}
                      >
                        Pausar<span className="sr-only">: {monitor.name}</span>
                      </ActionButton>
                    ) : (
                      <ActionButton
                        action={setMonitorStatusAction.bind(null, monitor.id, 'active')}
                        pendingLabel="Retomando…"
                        success={{
                          message: `Monitoramento “${monitor.name}” ${
                            monitor.status === 'archived' ? 'reativado' : 'retomado'
                          }.`,
                          focus: 'self',
                        }}
                      >
                        {monitor.status === 'archived' ? 'Reativar' : 'Retomar'}
                        <span className="sr-only">: {monitor.name}</span>
                      </ActionButton>
                    )}
                    {monitor.status !== 'archived' ? (
                      <ActionButton
                        action={setMonitorStatusAction.bind(null, monitor.id, 'archived')}
                        variant="ghost"
                        pendingLabel="Arquivando…"
                        success={{
                          message: `Monitoramento “${monitor.name}” arquivado.`,
                          focus: 'next',
                        }}
                      >
                        Arquivar<span className="sr-only">: {monitor.name}</span>
                      </ActionButton>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </ActionAnnouncer>
      </Panel>

      <Panel aria-labelledby="novo-monitoramento-titulo" id="novo-monitoramento">
        <PanelHeader
          title="Novo monitoramento"
          titleId="novo-monitoramento-titulo"
          description="O pedido roda sozinho na frequência escolhida e mostra só o que é novo (empresas e sinais que ainda não apareceram)."
        />
        <MonitorForm
          action={createMonitorAction}
          initial={
            prefilled
              ? { request: prefill.request, name: prefill.name || prefill.request.slice(0, 60) }
              : {}
          }
        />
      </Panel>
    </>
  );
}

export default function MonitorsPage({ searchParams }: Props) {
  return (
    <div className="space-y-6">
      <PageHeader
        trail={[
          { href: '/', label: 'Início' },
          { href: discoveryRoutes.home, label: 'Descoberta' },
        ]}
        title="Monitoramentos"
        description="Pesquisas que se repetem sozinhas para trazer empresas e sinais novos, com teto de créditos."
      />
      <Suspense fallback={<Loading label="Carregando os monitoramentos…" />}>
        <Monitors searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
