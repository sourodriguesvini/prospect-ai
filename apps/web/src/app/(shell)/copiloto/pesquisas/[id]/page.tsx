import {
  RESEARCH_STOP_LABELS,
  type CopilotResearch,
  type ResearchItemView,
  type ResearchQuery,
} from '@prospector/contracts';
import {
  Alert,
  Badge,
  Button,
  DemoBadge,
  Panel,
  PanelHeader,
  StatTile,
  Well,
} from '@prospector/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { connection } from 'next/server';
import { Suspense, type ReactNode } from 'react';
import { AutoRefresh } from '@/components/discovery/auto-refresh';
import { FocusOnArrival, RunLiveStatus } from '@/components/discovery/announcers';
import { ActionButton } from '@/components/discovery/discovery-forms';
import {
  creditsLine,
  isResearchOpen,
  ResearchBreakdownSection,
  ResearchItemsTable,
  ResearchStatusBadge,
} from '@/components/copilot/research-parts';
import { Loading } from '@/components/strategy/loading';
import { PageHeader, StorageNotice, Unavailable } from '@/components/strategy/page-parts';
import { formatDateTime } from '@/lib/format';
import {
  discardSummary,
  queryPlace,
  readResearchNotice,
  regionSummary,
  RESEARCH_NOTICE_MESSAGES,
  researchRoutes,
  researchTitle,
} from '@/lib/research-labels';
import { strategyRoutes } from '@/lib/strategy-routes';
import { getServices } from '@/server/container';
import { loadResearch, researchDetail } from '@/server/copilot-research';
import { cancelResearchAction, optOutResearchPersonAction, resumeResearchAction } from '../actions';

/** "1 achado", "3 achados" (revisão de UX de 27/11: "1 achados"). */
function countOf(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

type Props = PageProps<'/copiloto/pesquisas/[id]'>;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const { copilotResearch } = getServices();
  if (!copilotResearch) return { title: 'Pesquisa' };
  try {
    return { title: researchTitle(await researchDetail(copilotResearch, id)).slice(0, 80) };
  } catch {
    return { title: 'Pesquisa' };
  }
}

const TRAIL = [
  { href: '/', label: 'Hoje' },
  { href: '/copiloto', label: 'Copiloto' },
  { href: researchRoutes.list, label: 'Pesquisas' },
];

const TITLE_ID = 'titulo-pesquisa';
const SETTINGS_HREF = '/configuracoes';

/**
 * O que a região viva anuncia: só a mudança de estado e o fim, nunca os contadores a cada
 * atualização da tela.
 */
function liveMessage(research: CopilotResearch): string {
  switch (research.status) {
    case 'queued':
      return 'Pesquisa na fila.';
    case 'running':
      return 'Pesquisando.';
    case 'paused':
      return 'Pesquisa pausada.';
    case 'done':
      return research.stopReason === 'count_reached'
        ? `Pesquisa concluída: ${countOf(research.foundCount, 'achado', 'achados')}.`
        : `Pesquisa encerrada antes da quantidade: ${research.foundCount} de ${countOf(research.requestedCount, 'achado', 'achados')}.`;
    case 'failed':
      return 'A pesquisa parou por uma falha.';
    case 'cancelled':
      return 'Pesquisa cancelada.';
  }
}

const QUERY_STATUS: Record<ResearchQuery['status'], ReactNode> = {
  pending: <span className="text-muted-foreground">Pendente</span>,
  done: <Badge variant="success">Feita</Badge>,
  failed: <Badge variant="danger">Falhou</Badge>,
  skipped: <span className="text-muted-foreground">Pulada</span>,
};

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm [overflow-wrap:anywhere]">{children}</dd>
    </div>
  );
}

/** O que está acontecendo agora e o que a pessoa pode fazer. */
function ResearchState({ research }: { research: CopilotResearch }) {
  const { progress } = research;
  const counts = `${research.foundCount} de ${research.requestedCount} achados · ${progress.queriesDone} ${
    progress.queriesDone === 1 ? 'busca feita' : 'buscas feitas'
  } · ${creditsLine(research)}`;
  const resumeButton = (
    <div className="mt-3">
      <ActionButton action={resumeResearchAction.bind(null, research.id)} pendingLabel="Retomando…">
        Retomar de onde parou
      </ActionButton>
    </div>
  );
  if (isResearchOpen(research)) {
    return (
      <Alert tone="info" role="group" aria-label="Andamento da pesquisa">
        <AutoRefresh intervalMs={5000} />
        <p>
          <strong>{research.status === 'running' ? 'Pesquisando…' : 'Na fila.'}</strong> A pesquisa
          roda em segundo plano, em lotes; esta tela se atualiza sozinha. Se o app fechar, ela
          continua de onde parou quando você abrir o Prospector de novo.
        </p>
        <p className="mt-1 text-sm">{counts}</p>
        {progress.lastError ? <p className="mt-1 text-sm">{progress.lastError}</p> : null}
        <p className="mt-1 text-sm">
          Para mudar no meio, peça na conversa: “agora priorize SP e MG”, “mais 50” ou “só no
          Paraná”.
        </p>
        <div className="mt-3 space-y-1">
          <ActionButton
            action={cancelResearchAction.bind(null, research.id)}
            pendingLabel="Cancelando…"
          >
            Cancelar pesquisa
          </ActionButton>
          <p className="text-xs">
            Cancelar para as buscas na hora e não dá para desfazer; o que já foi achado continua
            guardado.
          </p>
        </div>
      </Alert>
    );
  }
  if (research.status === 'failed') {
    return (
      <Alert tone="danger" role="group" aria-label="Estado da pesquisa">
        <p>
          <strong>A pesquisa parou por uma falha.</strong>{' '}
          {progress.lastError ?? 'Nenhuma busca nova foi feita depois dela.'}
        </p>
        <p className="mt-1 text-sm">{counts}. O que foi achado continua abaixo.</p>
        <p className="mt-1 text-sm">
          Retomar repete só o que faltou. Se a falha voltar, confira a pesquisa na internet em{' '}
          <Link href={SETTINGS_HREF} className="underline underline-offset-4">
            Configurações
          </Link>
          .
        </p>
        {resumeButton}
      </Alert>
    );
  }
  if (research.status === 'cancelled') {
    return (
      <Alert tone="warning" role="group" aria-label="Estado da pesquisa">
        <p>
          <strong>Pesquisa cancelada.</strong>{' '}
          {research.foundCount > 0
            ? 'O que foi achado antes do cancelamento continua abaixo.'
            : 'Nada foi achado antes do cancelamento.'}
        </p>
        <p className="mt-1 text-sm">
          Uma pesquisa cancelada não volta. Para buscar de novo, faça um pedido novo na{' '}
          <Link
            href={researchRoutes.conversation(research.threadId)}
            className="underline underline-offset-4"
          >
            conversa
          </Link>
          .
        </p>
      </Alert>
    );
  }
  const reached = research.stopReason === 'count_reached';
  return (
    <Alert tone={reached ? 'success' : 'warning'} role="group" aria-label="Estado da pesquisa">
      <p>
        <strong>
          {reached ? 'Pesquisa concluída.' : 'Pesquisa encerrada antes da quantidade.'}
        </strong>{' '}
        {research.stopReason ? RESEARCH_STOP_LABELS[research.stopReason] : null}
      </p>
      <p className="mt-1 text-sm">{counts}.</p>
      <NextStep research={research} />
      {research.stopReason === 'search_unavailable' ? resumeButton : null}
    </Alert>
  );
}

/** O que fazer depois que a pesquisa parou sem a quantidade pedida, pelo motivo. */
function NextStep({ research }: { research: CopilotResearch }) {
  const conversation = (
    <Link
      href={researchRoutes.conversation(research.threadId)}
      className="underline underline-offset-4"
    >
      conversa
    </Link>
  );
  switch (research.stopReason) {
    case 'budget_exhausted':
      return (
        <p className="mt-1 text-sm">
          As buscas do mês acabaram (plano gratuito da Tavily). Quando o mês virar, peça “continue a
          pesquisa” na {conversation}; o limite mensal fica em{' '}
          <Link href={SETTINGS_HREF} className="underline underline-offset-4">
            Configurações
          </Link>
          .
        </p>
      );
    case 'search_unavailable':
      return (
        <p className="mt-1 text-sm">
          A pesquisa na internet está desligada ou sem chave. Ligue em{' '}
          <Link href={SETTINGS_HREF} className="underline underline-offset-4">
            Configurações
          </Link>{' '}
          e retome; o que já foi achado não é refeito.
        </p>
      );
    case 'sources_exhausted':
      return (
        <p className="mt-1 text-sm">
          As buscas planejadas acabaram. Para achar mais, peça outra região ou um número maior na{' '}
          {conversation} (“inclua o Paraná”, “mais 50”).
        </p>
      );
    case 'credit_cap':
      return (
        <p className="mt-1 text-sm">
          O teto de buscas desta pesquisa foi atingido. Para ampliar, peça “mais 20” na{' '}
          {conversation}; o que já foi achado não é refeito.
        </p>
      );
    default:
      return null;
  }
}

function Results({
  research,
  items,
}: {
  research: CopilotResearch;
  items: readonly ResearchItemView[];
}) {
  const { progress } = research;
  const people = items.filter((item) => item.kind === 'person');
  const approachable = items.filter((item) => item.approachable && !item.optedOut).length;
  const uncovered = people.some((item) => !item.approachable && !item.optedOut);
  const discarded = discardSummary(progress.discarded);
  const notStored =
    progress.peopleNotStored > 0
      ? `${progress.peopleNotStored} ${
          progress.peopleNotStored === 1
            ? 'profissional achado não foi guardado'
            : 'profissionais achados não foram guardados'
        }`
      : null;
  return (
    <Panel aria-labelledby="resultados">
      <PanelHeader
        title="Resultados para revisar"
        titleId="resultados"
        description="Cada linha tem a fonte pública e o trecho em que a pessoa ou organização aparece. Confira antes de usar: nada é enviado a ninguém sem a sua aprovação. A planilha baixada não autoriza contato, não traz quem pediu opt-out e deve ser apagada na data de cada linha."
        actions={
          items.length > 0 ? (
            <Button asChild variant="secondary" size="sm">
              <a href={researchRoutes.csv(research.id)} download>
                Baixar CSV
              </a>
            </Button>
          ) : null
        }
      />
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile
            label="Achados"
            value={research.foundCount}
            note={`de ${countOf(research.requestedCount, 'pedido', 'pedidos')}`}
          />
          <StatTile label="Profissionais" value={people.length} />
          <StatTile label="Organizações" value={items.length - people.length} />
          <StatTile
            label="Abordáveis"
            value={approachable}
            note="cobertos pela LIA em vigor, ou organizações"
          />
        </div>
        {discarded ? (
          <p className="text-sm text-muted-foreground">Descartados: {discarded}.</p>
        ) : null}
        <ResearchBreakdownSection items={items} scopeUfs={research.criteria.ufs} />
        {progress.keyMismatch ? (
          <Alert tone="danger" role="note">
            A chave que protege os dados de pessoas neste computador não é a mesma que gravou as
            pessoas no banco. Para não perder quem pediu opt-out, nenhuma pessoa nova é guardada até
            a chave original voltar (ela fica na pasta de dados do Prospector, que vai no backup).
          </Alert>
        ) : notStored ? (
          <Alert tone="warning" role="note">
            {notStored} porque o app não conseguiu criar a chave que protege os dados de pessoas
            (ela fica na pasta de dados do Prospector). As organizações continuam sendo guardadas.
          </Alert>
        ) : null}
        {uncovered ? (
          <p className="text-sm">
            Nenhuma LIA aprovada cobre a fonte e os dados das linhas “Só para revisão”: elas ficam
            guardadas por até 90 dias, sem abordagem.{' '}
            <Link href={strategyRoutes.lia} className="underline underline-offset-4">
              Ver a LIA
            </Link>
          </p>
        ) : null}
        {items.length > 0 ? (
          <>
            <ResearchItemsTable
              items={items}
              actions={{
                optOut: (itemId) => optOutResearchPersonAction.bind(null, research.id, itemId),
              }}
            />
            <p className="text-xs text-muted-foreground">
              “Guardar até” é o prazo combinado para cada linha; a remoção automática nessa data
              ainda não está ligada no app.
            </p>
          </>
        ) : (
          <Well className="py-10 text-center text-sm text-muted-foreground">
            {isResearchOpen(research)
              ? 'Nenhum resultado ainda. Os achados aparecem aqui a cada lote.'
              : notStored
                ? `Nenhum resultado guardado: ${notStored}.`
                : 'Nenhum resultado foi achado nas fontes públicas.'}
          </Well>
        )}
      </div>
    </Panel>
  );
}

async function ResearchView({ id, notice }: { id: string; notice: string | null }) {
  await connection();
  const result = await loadResearch(async (service, ctx) => {
    const research = await researchDetail(service, id);
    const items = await service.listItems(ctx, research.id, { limit: 500 });
    return { research, items };
  });
  if (result.kind === 'unavailable') {
    return (
      <>
        <PageHeader trail={TRAIL} title="Pesquisa" />
        <Unavailable message={result.message} />
      </>
    );
  }
  const { research, items } = result.data;
  const { criteria, plan } = research;
  const doneQueries = plan.queries.filter((query) => query.status !== 'pending');
  const pendingQueries = plan.queries.length - doneQueries.length;
  const message = liveMessage(research);
  // "Retomada" não faz sentido se a pesquisa já terminou de novo; o cancelamento continua valendo.
  const shownNotice =
    notice && (isResearchOpen(research) || notice !== RESEARCH_NOTICE_MESSAGES.retomada)
      ? notice
      : null;

  return (
    <>
      <PageHeader
        trail={TRAIL}
        title={
          <span id={TITLE_ID} tabIndex={-1} className="block [overflow-wrap:anywhere]">
            {researchTitle(research)}
          </span>
        }
        badges={
          <>
            {research.isDemo ? <DemoBadge /> : null}
            <ResearchStatusBadge status={research.status} />
          </>
        }
        description={`Para ${research.profileName} · criada em ${formatDateTime(research.createdAt)}${
          research.finishedAt ? ` · terminou em ${formatDateTime(research.finishedAt)}` : ''
        }`}
        actions={
          <Button asChild variant="secondary">
            <Link href={researchRoutes.conversation(research.threadId)}>Voltar à conversa</Link>
          </Button>
        }
      />
      <StorageNotice storage={result.storage} />
      {/* Única região viva da pesquisa: fica fora do bloco de estado, que troca a cada etapa. */}
      <RunLiveStatus message={message} arrival={notice ? (shownNotice ?? message) : null} />
      {notice ? <FocusOnArrival targetId={TITLE_ID} /> : null}
      {shownNotice ? (
        <Alert tone="success" role="note">
          {shownNotice}
        </Alert>
      ) : null}
      <ResearchState research={research} />

      <Results research={research} items={items} />

      <Panel aria-labelledby="pedido">
        <PanelHeader
          title="O que foi pedido"
          titleId="pedido"
          description="Entendido por regra, sem IA: as premissas abaixo foram adotadas sem perguntar e podem ser mudadas na conversa."
        />
        <div className="space-y-4">
          <p className="text-sm [overflow-wrap:anywhere]">
            <span className="text-muted-foreground">Pedido: </span>“{research.request}”
          </p>
          <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Fact label="Público">{research.audience}</Fact>
            <Fact label="Objetivo">{research.objective}</Fact>
            <Fact label="Região">{regionSummary(research)}</Fact>
            <Fact label="Termos das buscas">{criteria.terms.join(', ')}</Fact>
            <Fact label="Tipos">
              {criteria.entityKinds
                .map((kind) => (kind === 'person' ? 'profissionais' : 'organizações'))
                .join(' e ')}
            </Fact>
            <Fact label="Teto de buscas">
              Até {research.creditCap} (1 crédito da Tavily cada; buscas iguais em 24 horas não
              gastam crédito). Usados até agora: {research.progress.creditsUsed}.
            </Fact>
          </dl>
          {criteria.assumptions.length > 0 ? (
            <div className="space-y-1">
              <h3 className="text-sm font-medium">Premissas adotadas</h3>
              <ul className="list-disc space-y-0.5 pl-5 text-sm">
                {criteria.assumptions.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {research.revisions.length > 0 ? (
            <div className="space-y-1">
              <h3 className="text-sm font-medium">Mudanças pedidas</h3>
              <ol className="space-y-1 text-sm">
                {research.revisions.map((revision) => (
                  <li key={revision.at} className="[overflow-wrap:anywhere]">
                    <span className="text-muted-foreground">{formatDateTime(revision.at)}: </span>
                    {revision.change}{' '}
                    <span className="text-muted-foreground">(“{revision.request}”)</span>
                  </li>
                ))}
              </ol>
            </div>
          ) : null}
        </div>
      </Panel>

      <Panel aria-labelledby="buscas">
        <PanelHeader
          title="Plano de buscas"
          titleId="buscas"
          description="Por profissão e região, nunca pelo nome de alguém. Os estados priorizados vão primeiro."
        />
        <p className="mb-3 text-sm text-muted-foreground">
          {doneQueries.length} {doneQueries.length === 1 ? 'busca feita' : 'buscas feitas'}
          {pendingQueries > 0 ? ` · ${countOf(pendingQueries, 'pendente', 'pendentes')}` : ''}.
        </p>
        <details className="text-sm">
          <summary className="cursor-pointer font-medium">Ver as buscas</summary>
          <ol className="mt-3 space-y-1">
            {plan.queries.map((query) => (
              <li key={query.index} className="flex flex-wrap items-center gap-2">
                <span className="[overflow-wrap:anywhere]">“{query.query}”</span>
                <span className="text-muted-foreground">{queryPlace(query)}</span>
                {QUERY_STATUS[query.status]}
                {query.status === 'done' ? (
                  <span className="text-muted-foreground">
                    {countOf(query.results, 'resultado', 'resultados')} ·{' '}
                    {countOf(query.added, 'novo', 'novos')}
                  </span>
                ) : null}
              </li>
            ))}
          </ol>
        </details>
      </Panel>
    </>
  );
}

export default async function ResearchPage({ params, searchParams }: Props) {
  const { id } = await params;
  const notice = readResearchNotice((await searchParams).aviso);
  return (
    <div className="space-y-6">
      <Suspense fallback={<Loading label="Carregando a pesquisa…" />}>
        <ResearchView id={id} notice={notice} />
      </Suspense>
    </div>
  );
}
