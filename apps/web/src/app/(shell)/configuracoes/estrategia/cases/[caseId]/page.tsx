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
import { loadStrategy } from '@/server/strategy';
import { archiveProofAssetAction, updateProofAssetAction } from '../../actions';

export const metadata: Metadata = { title: 'Case' };

type Props = PageProps<'/configuracoes/estrategia/cases/[caseId]'>;

const TRAIL = [
  { href: '/configuracoes', label: 'Configuração' },
  { href: strategyRoutes.overview, label: 'Estratégia' },
  { href: strategyRoutes.cases, label: 'Cases' },
];

async function CaseDetail({ params }: { params: Props['params'] }) {
  await connection();
  const { caseId } = await params;
  const result = await loadStrategy((strategy, ctx) =>
    Promise.all([strategy.proofAsset(ctx, caseId), strategy.overview(ctx)]),
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
