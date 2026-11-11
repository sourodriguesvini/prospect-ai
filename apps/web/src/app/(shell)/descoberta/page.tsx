import { DISCOVERY_DEPTH_LIMITS, DISCOVERY_FAILURE_MESSAGES } from '@prospector/contracts';
import { Alert, Button, DemoBadge, Panel, PanelHeader, Well } from '@prospector/ui';
import { Building2, Radar } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { connection } from 'next/server';
import { Suspense } from 'react';
import { DiscoverySearchForm } from '@/components/discovery/discovery-forms';
import {
  PriorityBadge,
  ProspectFacts,
  RunRow,
  SignalItem,
} from '@/components/discovery/discovery-parts';
import { Loading } from '@/components/strategy/loading';
import { PageHeader, StorageNotice, Unavailable } from '@/components/strategy/page-parts';
import { discoveryRoutes } from '@/lib/discovery-routes';
import { formatDate } from '@/lib/format';
import { loadDiscovery } from '@/server/discovery';
import { createRunAction } from './actions';

export const metadata: Metadata = { title: 'Descoberta' };

/** Sinais do radar: os dos últimos 30 dias. */
const RADAR_DAYS = 30;

function searchUnavailable(search: 'enabled' | 'disabled' | 'not_configured'): string | null {
  if (search === 'enabled') return null;
  return search === 'not_configured'
    ? DISCOVERY_FAILURE_MESSAGES.search_not_configured
    : DISCOVERY_FAILURE_MESSAGES.search_disabled;
}

/** Início da janela do radar (a hora vem da requisição, não do render). */
function radarSince(now: Date): string {
  return new Date(now.getTime() - RADAR_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

async function DiscoveryHome() {
  await connection();
  const result = await loadDiscovery(async (discovery, ctx) => {
    const since = radarSince(new Date());
    const [status, runs, opportunities, signals] = await Promise.all([
      discovery.status(ctx),
      discovery.listRuns(ctx, { limit: 8 }),
      discovery.opportunities(ctx, { limit: 6 }),
      discovery.signals(ctx, { since, limit: 8 }),
    ]);
    return { status, runs, opportunities, signals };
  });
  if (result.kind === 'unavailable') return <Unavailable message={result.message} />;
  const { status, runs, opportunities, signals } = result.data;
  const unavailable = searchUnavailable(status.search);
  const usage = status.usage;

  return (
    <>
      <StorageNotice storage={result.storage} />
      {unavailable ? (
        <Alert tone="warning" role="status">
          {unavailable}
        </Alert>
      ) : null}
      {status.drafts > 0 ? (
        <Alert tone="info" role="status">
          {status.drafts === 1
            ? 'Há 1 pesquisa preparada pelo Copiloto esperando a sua confirmação.'
            : `Há ${status.drafts} pesquisas preparadas pelo Copiloto esperando a sua confirmação.`}{' '}
          Elas aparecem em Pesquisas recentes; nada roda sem você confirmar.
        </Alert>
      ) : null}

      <Panel aria-labelledby="nova-pesquisa">
        <PanelHeader
          title="Nova pesquisa"
          titleId="nova-pesquisa"
          description="A pesquisa roda em segundo plano: interpreta o pedido, busca na internet, confere sites e faz a triagem. Você pode sair da tela e voltar depois."
        />
        <DiscoverySearchForm action={createRunAction} disabledReason={unavailable} />
        <p className="mt-4 text-xs text-muted-foreground">
          Cada pesquisa gasta no máximo {DISCOVERY_DEPTH_LIMITS.deep.maxSearches} créditos (1 por
          busca nova; o padrão é até {DISCOVERY_DEPTH_LIMITS.standard.maxSearches}).{' '}
          {usage
            ? `Créditos da Tavily neste mês: ${usage.creditsUsed} de ${usage.creditsBudget} (restam ${usage.creditsRemaining}).`
            : 'Uso de créditos indisponível nesta instalação.'}
          {status.activeRuns > 0
            ? ` ${status.activeRuns === 1 ? '1 pesquisa em andamento' : `${status.activeRuns} pesquisas em andamento`}.`
            : ''}
        </p>
      </Panel>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel aria-labelledby="oportunidades">
          <PanelHeader
            title="Oportunidades"
            titleId="oportunidades"
            description="Empresas de prioridade alta ou média que você ainda não ignorou nem investigou. Prioridade é a triagem por regras com as fontes, não chance de fechar negócio."
            actions={
              <Button asChild variant="ghost" size="sm">
                <Link href={discoveryRoutes.prospects}>Ver todas</Link>
              </Button>
            }
          />
          {opportunities.length === 0 ? (
            <Well className="py-8 text-center text-sm text-muted-foreground">
              Nenhuma oportunidade ainda. Faça uma pesquisa: as empresas com sinais fortes e boa
              aderência ao seu perfil de cliente aparecem aqui.
            </Well>
          ) : (
            <ul className="divide-y">
              {opportunities.map(({ prospect, signals: prospectSignals, sources }) => (
                <li key={prospect.id} className="space-y-2 py-3">
                  <p className="flex flex-wrap items-center gap-2">
                    <Link
                      href={discoveryRoutes.prospect(prospect.id)}
                      className="break-words font-medium underline-offset-4 hover:underline"
                    >
                      {prospect.displayName}
                    </Link>
                    {prospect.isDemo ? <DemoBadge /> : null}
                    <PriorityBadge priority={prospect.priority} />
                  </p>
                  <ProspectFacts prospect={prospect} />
                  {prospectSignals[0] ? (
                    <ul aria-label={`Sinal mais forte de ${prospect.displayName}`}>
                      <SignalItem
                        signal={prospectSignals[0]}
                        source={sources[prospectSignals[0].sourceId] ?? null}
                        compact
                      />
                    </ul>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel aria-labelledby="radar">
          <PanelHeader
            title="Radar de sinais"
            titleId="radar"
            description={`Sinais comerciais encontrados nos últimos ${RADAR_DAYS} dias, com a fonte.`}
          />
          {signals.length === 0 ? (
            <Well className="py-8 text-center text-sm text-muted-foreground">
              Nenhum sinal nos últimos {RADAR_DAYS} dias. Monitoramentos trazem sinais novos sem
              você precisar pesquisar de novo.
            </Well>
          ) : (
            <ul className="divide-y">
              {signals.map(({ signal, prospect, source }) => (
                <SignalItem
                  key={signal.id}
                  signal={signal}
                  source={source}
                  compact
                  className="py-3"
                  lead={
                    <p className="flex flex-wrap items-center gap-2 text-sm">
                      <Link
                        href={discoveryRoutes.prospect(prospect.id)}
                        className="break-words font-medium underline-offset-4 hover:underline"
                      >
                        {prospect.displayName}
                      </Link>
                      {prospect.isDemo ? <DemoBadge /> : null}
                      <span className="text-muted-foreground">
                        · encontrado em {formatDate(signal.discoveredAt)}
                      </span>
                    </p>
                  }
                />
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <Panel aria-labelledby="pesquisas-recentes">
        <PanelHeader
          title="Pesquisas recentes"
          titleId="pesquisas-recentes"
          actions={
            <Button asChild variant="ghost" size="sm">
              <Link href={discoveryRoutes.monitors}>Monitoramentos</Link>
            </Button>
          }
        />
        {runs.length === 0 ? (
          <Well className="py-8 text-center text-sm text-muted-foreground">
            Nenhuma pesquisa ainda. Escreva acima o tipo de empresa que você procura.
          </Well>
        ) : (
          <ul className="divide-y">
            {runs.map((run) => (
              <RunRow key={run.id} run={run} />
            ))}
          </ul>
        )}
      </Panel>
    </>
  );
}

export default function DiscoveryPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        trail={[{ href: '/', label: 'Início' }]}
        title="Descoberta"
        description="Encontre empresas com sinais comerciais na internet. Cada empresa e cada sinal aparecem com a fonte e o trecho; o que não está na fonte é descartado, e nada é enviado a ninguém."
        actions={
          <>
            <Button asChild variant="secondary">
              <Link href={discoveryRoutes.prospects}>
                <Building2 aria-hidden="true" className="size-4" />
                Empresas encontradas
              </Link>
            </Button>
            <Button asChild variant="secondary">
              <Link href={discoveryRoutes.monitors}>
                <Radar aria-hidden="true" className="size-4" />
                Monitoramentos
              </Link>
            </Button>
          </>
        }
      />
      <Suspense fallback={<Loading label="Carregando a Descoberta…" />}>
        <DiscoveryHome />
      </Suspense>
    </div>
  );
}
