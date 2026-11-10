import { Badge, DemoBadge, Panel, PanelHeader } from '@prospector/ui';
import type { Metadata } from 'next';
import { connection } from 'next/server';
import { Suspense } from 'react';
import { StatusButton } from '@/components/strategy/decision-forms';
import { Loading } from '@/components/strategy/loading';
import { PageHeader, StorageNotice, Unavailable } from '@/components/strategy/page-parts';
import { ProofAssetForm } from '@/components/strategy/simple-forms';
import { formatDateTime } from '@/lib/format';
import { proofAssetValues } from '@/lib/strategy-forms';
import { strategyRoutes } from '@/lib/strategy-routes';
import { loadStrategy, strategyDetail, strategyTitle } from '@/server/strategy';
import { archiveProofAssetAction, updateProofAssetAction } from '../../actions';

type Props = PageProps<'/configuracoes/estrategia/cases/[caseId]'>;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { caseId } = await params;
  const title = await strategyTitle(
    async (strategy) => (await strategyDetail.proofAsset(strategy, caseId)).title,
    'Case',
  );
  return { title };
}

const TRAIL = [
  { href: '/configuracoes', label: 'Configuração' },
  { href: strategyRoutes.overview, label: 'Estratégia' },
  { href: strategyRoutes.cases, label: 'Cases' },
];

async function CaseDetail({ params }: { params: Props['params'] }) {
  await connection();
  const { caseId } = await params;
  const result = await loadStrategy((strategy, ctx) =>
    Promise.all([strategyDetail.proofAsset(strategy, caseId), strategy.overview(ctx)]),
  );
  if (result.kind === 'unavailable') {
    return (
      <>
        <PageHeader trail={TRAIL} title="Case" />
        <Unavailable message={result.message} />
      </>
    );
  }
  const [asset, { snapshot }] = result.data;
  const linkedOffer = snapshot.offers.find((o) => o.id === asset.offerId);
  const offerName = linkedOffer
    ? (linkedOffer.current?.content.name ?? 'Oferta sem conteúdo')
    : 'Nenhuma (vale para a agência)';
  const offers = snapshot.offers
    .filter((o) => o.status !== 'archived' || o.id === asset.offerId)
    .map((o) => ({
      value: o.id,
      label: `${o.current?.content.name ?? 'Oferta sem conteúdo'}${o.isDemo ? ' (demo)' : ''}`,
    }));
  return (
    <>
      <PageHeader
        trail={TRAIL}
        title={asset.title}
        badges={
          <>
            {asset.archivedAt ? (
              <Badge variant="outline">Arquivado</Badge>
            ) : asset.publicOk ? (
              <Badge variant="success">Citável</Badge>
            ) : (
              <Badge variant="neutral">Só uso interno</Badge>
            )}
            {asset.isDemo ? <DemoBadge /> : null}
          </>
        }
        description={`Atualizado em ${formatDateTime(asset.updatedAt)}.`}
      />
      <StorageNotice storage={result.storage} />
      {asset.archivedAt ? (
        <Panel aria-labelledby="case-arquivado">
          <PanelHeader
            titleId="case-arquivado"
            title="Case arquivado"
            description={`Arquivado em ${formatDateTime(asset.archivedAt)}. Não aparece em mensagens nem na prontidão, e não pode ser editado.`}
          />
          {/* Cada par num div; sm:contents mantém a grade de duas colunas a partir de sm. */}
          <dl className="space-y-4 text-sm sm:grid sm:grid-cols-[12rem_1fr] sm:gap-x-6 sm:gap-y-4 sm:space-y-0">
            {(
              [
                ['Oferta', offerName, false],
                ['Segmento', asset.segment || '—', false],
                ['Resumo', asset.summary, true],
                ['Resultados', asset.results || '—', true],
                [
                  'Citável em mensagens',
                  asset.publicOk ? 'Sim, com autorização registrada' : 'Não (só uso interno)',
                  false,
                ],
                ['Onde está a autorização', asset.consentRef || '—', false],
              ] as const
            ).map(([term, value, multiline]) => (
              <div key={term} className="space-y-1 sm:contents">
                <dt className="text-muted-foreground">{term}</dt>
                <dd
                  className={
                    multiline
                      ? 'whitespace-pre-line [overflow-wrap:anywhere]'
                      : '[overflow-wrap:anywhere]'
                  }
                >
                  {value}
                </dd>
              </div>
            ))}
          </dl>
        </Panel>
      ) : (
        <>
          <Panel aria-label="Dados do case">
            <ProofAssetForm
              action={updateProofAssetAction.bind(null, asset.id)}
              initial={proofAssetValues(asset)}
              offers={offers}
              submitLabel="Salvar case"
              cancelHref={strategyRoutes.cases}
            />
          </Panel>
          <Panel aria-labelledby="case-arquivar">
            <PanelHeader
              titleId="case-arquivar"
              title="Arquivar"
              description="O case sai das mensagens e da prontidão. O registro continua guardado."
            />
            <StatusButton
              label="Arquivar case"
              confirm="Arquivar este case? Ele sai das mensagens e da prontidão e não pode mais ser editado. Não dá para desfazer."
              pendingLabel="Arquivando…"
              action={archiveProofAssetAction.bind(null, asset.id)}
            />
          </Panel>
        </>
      )}
    </>
  );
}

export default function CasePage({ params }: Props) {
  return (
    <div className="space-y-6">
      <Suspense fallback={<Loading label="Carregando o case…" />}>
        <CaseDetail params={params} />
      </Suspense>
    </div>
  );
}
