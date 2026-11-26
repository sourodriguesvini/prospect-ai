import {
  INTELLIGENCE_PERIOD_LABELS,
  IntelligencePeriod,
  type IntelligenceOverview,
} from '@prospector/contracts';
import { Panel, PanelHeader, Well } from '@prospector/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { connection } from 'next/server';
import { Suspense } from 'react';
import { FunnelBars } from '@/components/intelligence/funnel';
import { MonthUsage } from '@/components/intelligence/usage';
import { SegmentedLinks } from '@/components/segmented-links';
import { Loading } from '@/components/strategy/loading';
import { PageHeader, StorageNotice, Unavailable } from '@/components/strategy/page-parts';
import { companyRoutes } from '@/lib/company-routes';
import { discoveryRoutes } from '@/lib/discovery-routes';
import { formatDate, formatDateTime } from '@/lib/format';
import { periodFrom, periodHref } from '@/lib/insights';
import { loadIntelligence } from '@/server/monitoring';

type Props = PageProps<'/inteligencia'>;

/** O período entra no título: é o que o histórico e o leitor de tela anunciam ao trocar. */
export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const period = periodFrom((await searchParams).periodo);
  return {
    title: period === 'month' ? 'Resultados' : `${INTELLIGENCE_PERIOD_LABELS[period]} · Resultados`,
  };
}

const TRAIL = [{ href: '/', label: 'Hoje' }];

function periodPhrase(overview: IntelligenceOverview): string {
  return overview.period === 'month'
    ? `neste mês (desde ${formatDate(overview.monthStart)})`
    : 'desde o início';
}

function Funnel({ overview }: { overview: IntelligenceOverview }) {
  const empty = overview.funnel.every((stage) => stage.count === 0);
  return (
    <Panel aria-labelledby="funil">
      <PanelHeader
        titleId="funil"
        title="Funil de prospecção"
        description={`Empresas distintas que chegaram a cada etapa ${periodPhrase(overview)}, contadas pela data da própria etapa. As etapas não acompanham o mesmo grupo: uma empresa investigada agora pode ter sido encontrada antes.`}
      />
      <div className="space-y-5">
        <SegmentedLinks
          label="Período do funil"
          options={IntelligencePeriod.options.map((period) => ({
            href: periodHref(period),
            label: INTELLIGENCE_PERIOD_LABELS[period],
            current: period === overview.period,
          }))}
        />
        {empty ? (
          <Well className="space-y-2 text-sm text-muted-foreground" data-funnel-empty="">
            <p className="font-medium text-foreground">
              Nenhuma empresa contada {periodPhrase(overview)}.
            </p>
            <p>
              O funil começa quando uma pesquisa da{' '}
              <Link href={discoveryRoutes.home} className="underline underline-offset-4">
                Descoberta
              </Link>{' '}
              encontra empresas ou quando você cadastra uma em{' '}
              <Link href={companyRoutes.list} className="underline underline-offset-4">
                Empresas
              </Link>
              .
            </p>
          </Well>
        ) : (
          <>
            <FunnelBars funnel={overview.funnel} minSample={overview.minSample} />
            <p className="text-xs text-muted-foreground">
              A porcentagem compara com a etapa anterior e só aparece quando as duas foram lidas por
              inteiro e a razão não passa de 100%. Com menos de {overview.minSample} empresas na
              etapa anterior, ela vem marcada como amostra pequena. Número com “+” chegou ao limite
              de leitura e pode ser maior.
            </p>
          </>
        )}
      </div>
    </Panel>
  );
}

/** Inteligência (D16, F13, primeira parte; ADR-0017): funil e consumo do mês, só com dados reais. */
async function Intelligence({ searchParams }: { searchParams: Props['searchParams'] }) {
  await connection();
  const query = await searchParams;
  const result = await loadIntelligence(periodFrom(query.periodo));
  if (result.kind === 'unavailable') return <Unavailable message={result.message} />;
  const overview = result.data;
  return (
    <>
      <StorageNotice storage={result.storage} />
      <Funnel overview={overview} />
      <Panel aria-labelledby="consumo">
        <PanelHeader
          titleId="consumo"
          title="Consumo do mês"
          description={`Desde ${formatDate(overview.monthStart)}, no horário de Brasília. O que roda neste computador não custa dinheiro, mas ocupa a placa de vídeo.`}
        />
        <MonthUsage overview={overview} storage={result.storage} />
      </Panel>
      <p className="text-xs text-muted-foreground">
        Lido em {formatDateTime(overview.generatedAt)}.
      </p>
    </>
  );
}

export default function IntelligencePage({ searchParams }: Props) {
  return (
    <div className="space-y-6">
      <PageHeader
        trail={TRAIL}
        title="Resultados"
        description="Números do seu próprio uso: quantas empresas passaram por cada etapa e quanto a IA local e a busca na internet trabalharam no mês."
      />
      <Suspense fallback={<Loading label="Carregando a inteligência…" />}>
        <Intelligence searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
