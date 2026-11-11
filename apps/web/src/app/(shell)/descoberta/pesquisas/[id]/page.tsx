import type { DiscoveryRunDetail } from '@prospector/application';
import {
  DISCOVERY_DEPTH_LABELS,
  DISCOVERY_FAILURE_MESSAGES,
  DISCOVERY_STAGE_LABELS,
  SERVICE_HINT_LABELS,
  SIGNAL_TYPE_LABELS,
  type DiscoveryFailure,
  type DiscoveryRun,
} from '@prospector/contracts';
import { Alert, Badge, Button, DemoBadge, Panel, PanelHeader, Well } from '@prospector/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { Suspense, type ReactNode } from 'react';
import { ActionAnnouncer, FocusOnArrival, RunLiveStatus } from '@/components/discovery/announcers';
import { AutoRefresh } from '@/components/discovery/auto-refresh';
import { ActionButton } from '@/components/discovery/discovery-forms';
import {
  ProspectCard,
  ProspectCardActions,
  RunStatusBadge,
  runCounts,
  runSummary,
  triggerLabel,
} from '@/components/discovery/discovery-parts';
import { Loading } from '@/components/strategy/loading';
import { PageHeader, StorageNotice, Unavailable } from '@/components/strategy/page-parts';
import {
  DISCOVERY_NOTICE_MESSAGES,
  DISCOVERY_NOTICES,
  discoveryRoutes,
  isDiscoveryId,
  readDiscoveryNotice,
} from '@/lib/discovery-routes';
import { formatDateTime } from '@/lib/format';
import { discoveryRunDetail, discoveryTitle, loadDiscovery } from '@/server/discovery';
import {
  cancelRunAction,
  confirmRunAction,
  decideProspectAction,
  discardRunAction,
  investigateProspectAction,
  retryRunAction,
} from '../../actions';

type Props = PageProps<'/descoberta/pesquisas/[id]'>;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  return {
    title: await discoveryTitle(
      async (discovery) => (await discoveryRunDetail(discovery, id)).run.request,
      'Pesquisa',
    ),
  };
}

const TRAIL = [
  { href: '/', label: 'Início' },
  { href: discoveryRoutes.home, label: 'Descoberta' },
];

/** Título da tela (o pedido): recebe o foco quando a pessoa chega depois de uma ação. */
const TITLE_ID = 'titulo-pesquisa';

/** O pedido pode ter até 500 caracteres: o título mostra o começo; o pedido inteiro vem abaixo. */
const TITLE_MAX = 90;

function requestTitle(request: string): { title: string; truncated: boolean } {
  const text = request.trim();
  if (text.length <= TITLE_MAX) return { title: text, truncated: false };
  const cut = text.slice(0, TITLE_MAX);
  const space = cut.lastIndexOf(' ');
  return { title: `${(space > 40 ? cut.slice(0, space) : cut).trimEnd()}…`, truncated: true };
}

/** Falhas que tentar de novo não resolve (configuração ou créditos): sem "Tentar de novo". */
const NO_RETRY: ReadonlySet<DiscoveryFailure> = new Set<DiscoveryFailure>([
  'search_not_configured',
  'search_disabled',
  'quota_exceeded',
  'budget_exhausted',
]);

/**
 * O que a região viva anuncia: só a etapa e o fim (com o resumo), nunca os contadores a cada
 * atualização da tela.
 */
function liveMessage(run: DiscoveryRun): string {
  switch (run.status) {
    case 'draft':
      return 'Pesquisa esperando a sua confirmação.';
    case 'queued':
      return run.failureCode ? 'Pesquisa esperando para tentar de novo.' : 'Pesquisa na fila.';
    case 'running':
      return run.cancelRequestedAt
        ? 'Cancelamento pedido: a pesquisa para na próxima etapa.'
        : `${DISCOVERY_STAGE_LABELS[run.stage ?? 'interpreting']}.`;
    case 'completed':
      return run.partial
        ? `Resultado parcial: ${runSummary(run)}.`
        : `Pesquisa concluída: ${runSummary(run)}.`;
    case 'failed':
      return `A pesquisa falhou. ${DISCOVERY_FAILURE_MESSAGES[run.failureCode ?? 'unexpected']}`;
    case 'cancelled':
      return run.startedAt ? 'Pesquisa cancelada.' : 'Pesquisa descartada antes de rodar.';
  }
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  );
}

/** Estado da execução: o que está acontecendo agora e o que a pessoa pode fazer. */
function RunState({ detail }: { detail: DiscoveryRunDetail }) {
  const { run } = detail;
  const progress = run.progress;
  switch (run.status) {
    case 'draft':
      return (
        <Alert tone="info" role="group" aria-label="Estado da pesquisa">
          <p>
            <strong>Esperando a sua confirmação.</strong> O Copiloto preparou esta pesquisa; ela só
            roda (e só gasta créditos) depois que você confirmar.
          </p>
          <p className="mt-1">
            Gasto máximo: {run.limits.maxSearches}{' '}
            {run.limits.maxSearches === 1 ? 'busca' : 'buscas'} na internet, 1 crédito da Tavily
            cada. Buscas iguais feitas nas últimas 24 horas não gastam crédito.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <ActionButton
              action={confirmRunAction.bind(null, run.id)}
              variant="primary"
              pendingLabel="Confirmando…"
            >
              Confirmar e pesquisar
            </ActionButton>
            <ActionButton action={discardRunAction.bind(null, run.id)} pendingLabel="Descartando…">
              Descartar
            </ActionButton>
          </div>
        </Alert>
      );
    case 'queued':
    case 'running':
      // Sem região viva aqui: a etapa e o fim são anunciados pela RunLiveStatus (fora deste bloco,
      // que troca a cada etapa); os contadores mudam a cada atualização e não são lidos sozinhos.
      return (
        <Alert tone="info" role="group" aria-label="Andamento da pesquisa">
          <AutoRefresh />
          <div className="space-y-1">
            <p>
              <strong>
                {run.status === 'queued'
                  ? run.failureCode
                    ? 'Esperando para tentar de novo.'
                    : 'Na fila.'
                  : `${DISCOVERY_STAGE_LABELS[run.stage ?? 'interpreting']}…`}
              </strong>{' '}
              {run.cancelRequestedAt
                ? 'Cancelamento pedido: a pesquisa para na próxima etapa.'
                : 'A pesquisa roda em segundo plano; esta tela se atualiza sozinha.'}
            </p>
            <p className="text-sm">
              Buscas: {progress.searchesDone} de {progress.searchesPlanned || '…'} ·{' '}
              {runCounts(run)} · páginas lidas: {progress.pagesRead}
            </p>
            {run.failureCode && run.status === 'queued' ? (
              <p className="text-sm">{DISCOVERY_FAILURE_MESSAGES[run.failureCode]}</p>
            ) : null}
          </div>
          {!run.cancelRequestedAt ? (
            <div className="mt-3">
              <ActionButton action={cancelRunAction.bind(null, run.id)} pendingLabel="Cancelando…">
                Cancelar pesquisa
              </ActionButton>
            </div>
          ) : null}
        </Alert>
      );
    case 'failed':
      return (
        <Alert tone="danger" role="group" aria-label="Estado da pesquisa">
          <p>
            <strong>A pesquisa falhou.</strong>{' '}
            {DISCOVERY_FAILURE_MESSAGES[run.failureCode ?? 'unexpected']}
          </p>
          {run.failureCode === 'unexpected' ? (
            <p className="mt-1 text-xs">Código de rastreio: {run.traceId}</p>
          ) : null}
          {run.failureCode && NO_RETRY.has(run.failureCode) ? null : (
            <div className="mt-3">
              <ActionButton action={retryRunAction.bind(null, run.id)} pendingLabel="Criando…">
                Tentar de novo
              </ActionButton>
            </div>
          )}
        </Alert>
      );
    case 'cancelled':
      return (
        <Alert tone="warning" role="group" aria-label="Estado da pesquisa">
          {run.startedAt ? (
            <p>
              <strong>Pesquisa cancelada.</strong>{' '}
              {progress.prospects > 0
                ? 'O que foi encontrado antes do cancelamento continua salvo abaixo.'
                : 'Nada foi encontrado antes do cancelamento.'}
            </p>
          ) : (
            <p>
              <strong>A pesquisa não rodou.</strong> Ela foi descartada antes de começar: nenhuma
              busca foi feita e nenhum crédito foi gasto.
            </p>
          )}
          <div className="mt-3">
            <ActionButton action={retryRunAction.bind(null, run.id)} pendingLabel="Criando…">
              Pesquisar de novo
            </ActionButton>
          </div>
        </Alert>
      );
    case 'completed':
      return run.partial ? (
        <Alert tone="warning" role="group" aria-label="Estado da pesquisa">
          <strong>Resultado parcial.</strong>{' '}
          {run.failureCode
            ? DISCOVERY_FAILURE_MESSAGES[run.failureCode]
            : 'Parte do plano de buscas não foi feita.'}{' '}
          {runCounts(run)}.
        </Alert>
      ) : (
        <Alert tone="success" role="group" aria-label="Estado da pesquisa">
          <strong>Pesquisa concluída.</strong> {runCounts(run)}.
        </Alert>
      );
  }
}

async function RunDetail({ id, notice }: { id: string; notice: string | null }) {
  await connection();
  const result = await loadDiscovery((discovery) => discoveryRunDetail(discovery, id));
  if (result.kind === 'unavailable') {
    return (
      <>
        <PageHeader trail={TRAIL} title="Pesquisa" />
        <Unavailable message={result.message} />
      </>
    );
  }
  const detail = result.data;
  const { run, queries, prospects, monitor } = detail;
  const intent = run.intent;
  const visible = prospects.filter((view) => view.prospect.status !== 'dismissed');
  const dismissed = prospects.length - visible.length;
  // "Na fila…" não faz sentido com a pesquisa já terminada; o aviso de cancelamento continua.
  const finished =
    run.status === 'completed' || run.status === 'failed' || run.status === 'cancelled';
  const shownNotice =
    notice &&
    (!finished ||
      notice === DISCOVERY_NOTICE_MESSAGES[DISCOVERY_NOTICES.cancelled] ||
      notice === DISCOVERY_NOTICE_MESSAGES[DISCOVERY_NOTICES.discarded])
      ? notice
      : null;
  const message = liveMessage(run);
  const { title, truncated } = requestTitle(run.request);

  return (
    <>
      <PageHeader
        trail={TRAIL}
        title={
          <span
            id={TITLE_ID}
            tabIndex={-1}
            className="block text-3xl [overflow-wrap:anywhere] sm:text-4xl"
          >
            {title}
          </span>
        }
        badges={
          <>
            {run.isDemo ? <DemoBadge /> : null}
            <RunStatusBadge status={run.status} />
          </>
        }
        description={`${triggerLabel(run.trigger)} · criada em ${formatDateTime(run.createdAt)}${
          run.finishedAt ? ` · terminou em ${formatDateTime(run.finishedAt)}` : ''
        }`}
        actions={
          run.status === 'completed' && !run.monitorId ? (
            <Button asChild variant="secondary">
              <Link href={discoveryRoutes.newMonitor({ request: run.request })}>
                Monitorar este pedido
              </Link>
            </Button>
          ) : null
        }
      />
      {truncated ? (
        <p className="max-w-3xl text-sm [overflow-wrap:anywhere]">
          <span className="text-muted-foreground">Pedido completo: </span>
          {run.request}
        </p>
      ) : null}
      <StorageNotice storage={result.storage} />
      {/* Única região viva da pesquisa: fica fora do bloco de estado, que troca a cada etapa. */}
      <RunLiveStatus message={message} arrival={notice ? (shownNotice ?? message) : null} />
      {notice ? <FocusOnArrival targetId={TITLE_ID} /> : null}
      {shownNotice ? (
        <Alert tone="success" role="note">
          {shownNotice}
        </Alert>
      ) : null}
      <RunState detail={detail} />
      {monitor ? (
        <p className="text-sm text-muted-foreground">
          Execução do monitoramento{' '}
          <Link href={discoveryRoutes.monitors} className="underline underline-offset-4">
            {monitor.name}
          </Link>
          .
        </p>
      ) : null}

      <Panel aria-labelledby="entendimento">
        <PanelHeader
          title="Como o pedido foi entendido"
          titleId="entendimento"
          description="Interpretação da IA local, completada com padrões do sistema (veja o que foi preenchido por padrão)."
        />
        {intent ? (
          <div className="space-y-4">
            <p className="text-sm">{intent.summary}</p>
            <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Fact label="Setor">{intent.segment ?? 'Não informado'}</Fact>
              <Fact label="Região">{intent.region.label ?? 'Brasil'}</Fact>
              <Fact label="Sinais">
                {intent.signals.length
                  ? intent.signals.map((type) => SIGNAL_TYPE_LABELS[type]).join(', ')
                  : 'Qualquer sinal comercial'}
              </Fact>
              <Fact label="Serviços ligados">
                {intent.services.length
                  ? intent.services.map((service) => SERVICE_HINT_LABELS[service]).join(', ')
                  : 'Não indicado'}
              </Fact>
              <Fact label="Quantidade">Até {intent.quantity} empresas</Fact>
              <Fact label="Profundidade">
                {DISCOVERY_DEPTH_LABELS[intent.depth]} (até {run.limits.maxSearches} buscas)
              </Fact>
            </dl>
            {intent.defaultsApplied.length ? (
              <p className="text-xs text-muted-foreground">
                Preenchido por padrão: {intent.defaultsApplied.join(' ')}
              </p>
            ) : null}
            {queries.length ? (
              <div className="space-y-2">
                <h3 className="text-sm font-medium">Buscas feitas</h3>
                <ul className="space-y-1 text-sm">
                  {queries.map((query) => (
                    <li key={query.position} className="flex flex-wrap items-center gap-2">
                      <span className="break-words">“{query.query.text}”</span>
                      {query.status === 'failed' ? (
                        <Badge variant="danger">Falhou</Badge>
                      ) : (
                        <span className="text-muted-foreground">
                          {query.results.length} resultados ·{' '}
                          {query.creditsCharged > 0
                            ? `${query.creditsCharged} ${query.creditsCharged === 1 ? 'crédito' : 'créditos'}`
                            : 'sem gastar crédito'}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            {run.status === 'draft' || run.status === 'queued'
              ? 'O pedido é interpretado quando a pesquisa começa.'
              : 'O pedido não chegou a ser interpretado.'}
          </p>
        )}
      </Panel>

      <Panel aria-labelledby="resultados">
        <PanelHeader
          title="Empresas encontradas"
          titleId="resultados"
          description="Prioridade é a triagem por regras com as fontes encontradas, não chance de fechar. Nada aqui foi enviado a ninguém."
        />
        <ActionAnnouncer listTitleId="resultados">
          {visible.length === 0 ? (
            <Well className="space-y-2 py-8 text-center text-sm text-muted-foreground">
              {run.status === 'completed' ||
              run.status === 'cancelled' ||
              run.status === 'failed' ? (
                <>
                  <p>
                    {dismissed > 0
                      ? 'Todas as empresas desta pesquisa foram ignoradas.'
                      : 'Nenhuma empresa encontrada com fontes que sustentem o pedido. Nada foi inventado para preencher a lista.'}
                  </p>
                  <p>
                    Tente um pedido mais amplo (outra cidade, setor vizinho ou sem sinais
                    obrigatórios).
                  </p>
                </>
              ) : (
                <p>As empresas aparecem aqui conforme a pesquisa avança.</p>
              )}
            </Well>
          ) : (
            <ul className="divide-y">
              {visible.map((view) => (
                <ProspectCard
                  key={view.prospect.id}
                  view={view}
                  actions={
                    <ProspectCardActions
                      prospect={view.prospect}
                      investigate={investigateProspectAction.bind(null, view.prospect.id)}
                      save={decideProspectAction.bind(null, view.prospect.id, 'saved')}
                      dismiss={decideProspectAction.bind(null, view.prospect.id, 'dismissed')}
                    />
                  }
                />
              ))}
            </ul>
          )}
        </ActionAnnouncer>
        {dismissed > 0 && visible.length > 0 ? (
          <p className="mt-3 text-xs text-muted-foreground">
            {dismissed === 1
              ? '1 empresa ignorada não aparece.'
              : `${dismissed} empresas ignoradas não aparecem.`}
          </p>
        ) : null}
      </Panel>
    </>
  );
}

export default async function RunPage({ params, searchParams }: Props) {
  const { id } = await params;
  if (!isDiscoveryId(id)) notFound();
  const notice = readDiscoveryNotice((await searchParams).aviso);
  return (
    <div className="space-y-6">
      <Suspense fallback={<Loading label="Carregando a pesquisa…" />}>
        <RunDetail id={id} notice={notice} />
      </Suspense>
    </div>
  );
}
