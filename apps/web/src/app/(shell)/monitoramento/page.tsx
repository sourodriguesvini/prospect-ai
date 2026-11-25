import { filterMonitoringFeed } from '@prospector/domain';
import { MonitoringFeedFilter, type MonitoringOverview } from '@prospector/contracts';
import { Alert, Panel, PanelHeader } from '@prospector/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { connection } from 'next/server';
import { Suspense } from 'react';
import { MonitoringFeed } from '@/components/monitoring/feed';
import { Watchlist } from '@/components/monitoring/watchlist';
import { SegmentedLinks } from '@/components/segmented-links';
import { Loading } from '@/components/strategy/loading';
import { PageHeader, StorageNotice, Unavailable } from '@/components/strategy/page-parts';
import { discoveryRoutes } from '@/lib/discovery-routes';
import { formatDateTime } from '@/lib/format';
import { FEED_FILTER_LABELS, feedFilterFrom, feedFilterHref } from '@/lib/insights';
import { loadMonitoring } from '@/server/monitoring';

type Props = PageProps<'/monitoramento'>;

/** O filtro entra no título: é o que o histórico e o leitor de tela anunciam ao trocar. */
export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const filter = feedFilterFrom((await searchParams).origem);
  return {
    title: filter === 'all' ? 'Monitoramento' : `${FEED_FILTER_LABELS[filter]} · Monitoramento`,
  };
}

const TRAIL = [{ href: '/', label: 'Início' }];

function FeedNotes({ overview }: { overview: MonitoringOverview }) {
  return (
    <>
      {overview.companyChanges === 'unavailable' ? (
        <Alert tone="warning" role="status" data-feed-note="changes">
          Não foi possível ler as mudanças das empresas agora; tente de novo em instantes.
        </Alert>
      ) : null}
      {overview.discovery === 'included' ? null : (
        <Alert
          tone={overview.discovery === 'unavailable' ? 'warning' : 'info'}
          role="status"
          data-discovery={overview.discovery}
        >
          {overview.discovery === 'unavailable'
            ? 'Não foi possível ler as buscas recorrentes agora; o feed mostra só as mudanças das empresas.'
            : 'A Descoberta não está ligada nesta instalação; o feed mostra só as mudanças das empresas.'}
        </Alert>
      )}
    </>
  );
}

/**
 * Monitoramento (ADR-0017): o que mudou nas empresas acompanhadas e o que as buscas recorrentes da
 * Descoberta acharam de novo, num feed só; ao lado, quem está na hora de olhar de novo.
 */
async function Monitoring({ searchParams }: { searchParams: Props['searchParams'] }) {
  await connection();
  const [result, query] = await Promise.all([loadMonitoring(), searchParams]);
  if (result.kind === 'unavailable') return <Unavailable message={result.message} />;
  const overview = result.data;
  const discoveryOn = overview.discovery !== 'off';
  // Sem Descoberta só há mudanças de empresas: o filtro não teria o que separar.
  const filter = discoveryOn ? feedFilterFrom(query.origem) : 'all';
  const items = filterMonitoringFeed(overview.feed, filter);
  const options = MonitoringFeedFilter.options.map((option) => ({
    href: feedFilterHref(option),
    label: FEED_FILTER_LABELS[option],
    current: option === filter,
    count: filterMonitoringFeed(overview.feed, option).length,
  }));
  return (
    <>
      <StorageNotice storage={result.storage} />
      {/* "Para olhar de novo" vem primeiro no código: no celular, o que pede ação aparece antes;
          na tela larga ele fica à direita. */}
      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-12">
        <Panel aria-labelledby="acompanhamento" className="xl:order-last xl:col-span-5">
          <PanelHeader
            titleId="acompanhamento"
            title="Para olhar de novo"
            description="A frequência vem da recomendação do último diagnóstico: Abordar agora e Preparar acesso a cada 7 dias; Acompanhar, Investigar mais e Sem base suficiente a cada 30. Nada é investigado sozinho. Investigar de novo reaproveita o que ainda vale e usa a IA deste computador e, se precisar, créditos da busca na internet."
          />
          <Watchlist overview={overview} />
        </Panel>
        <Panel aria-labelledby="novidades" className="xl:col-span-7">
          <PanelHeader
            titleId="novidades"
            title="Novidades"
            description={
              discoveryOn ? (
                <>
                  O que cada nova investigação encontrou de diferente da anterior e as empresas
                  novas achadas pelas{' '}
                  <Link href={discoveryRoutes.monitors} className="underline underline-offset-4">
                    buscas recorrentes
                  </Link>
                  . Mais recentes primeiro.
                </>
              ) : (
                'O que cada nova investigação encontrou de diferente da anterior. Mais recentes primeiro.'
              )
            }
          />
          <div className="space-y-4">
            {discoveryOn ? <SegmentedLinks label="Filtrar novidades" options={options} /> : null}
            <FeedNotes overview={overview} />
            <MonitoringFeed items={items} filter={filter} discoveryOn={discoveryOn} />
            {overview.feedTruncated ? (
              <p className="text-xs text-muted-foreground" data-feed-truncated="">
                Mostrando as {overview.feed.length} novidades mais recentes.
              </p>
            ) : null}
          </div>
        </Panel>
      </div>
      <p className="text-xs text-muted-foreground">
        Lido em {formatDateTime(overview.generatedAt)}.
      </p>
    </>
  );
}

export default function MonitoringPage({ searchParams }: Props) {
  return (
    <div className="space-y-6">
      <PageHeader
        trail={TRAIL}
        title="Monitoramento"
        description="O que mudou nas empresas já investigadas e o que as buscas recorrentes acharam de novo. Uma nova investigação só começa com o seu clique."
      />
      <Suspense fallback={<Loading label="Carregando o monitoramento…" />}>
        <Monitoring searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
