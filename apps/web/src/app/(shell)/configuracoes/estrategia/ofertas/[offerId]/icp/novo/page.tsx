import { Panel } from '@prospector/ui';
import type { Metadata } from 'next';
import { connection } from 'next/server';
import { Suspense } from 'react';
import { IcpForm } from '@/components/strategy/icp-form';
import { Loading } from '@/components/strategy/loading';
import { PageHeader, StorageNotice, Unavailable } from '@/components/strategy/page-parts';
import { strategyRoutes } from '@/lib/strategy-routes';
import { loadStrategy } from '@/server/strategy';
import { createIcpAction } from '../../../../actions';

export const metadata: Metadata = { title: 'Novo ICP' };

type Props = PageProps<'/configuracoes/estrategia/ofertas/[offerId]/icp/novo'>;

async function NewIcp({ params }: { params: Props['params'] }) {
  await connection();
  const { offerId } = await params;
  const result = await loadStrategy((strategy, ctx) => strategy.offerDetail(ctx, offerId));
  const trail = [
    { href: '/configuracoes', label: 'Configuração' },
    { href: strategyRoutes.overview, label: 'Estratégia' },
    { href: strategyRoutes.offer(offerId), label: 'Oferta' },
  ];
  if (result.kind === 'unavailable') {
    return (
      <>
        <PageHeader trail={trail} title="Novo ICP" />
        <Unavailable message={result.message} />
      </>
    );
  }
  const { offer } = result.data;
  return (
    <>
      <PageHeader
        trail={trail}
        title="Novo ICP"
        description={`Perfil de cliente ideal para "${offer.current?.content.name ?? 'oferta'}". Nasce em rascunho; ative quando os filtros estiverem certos.`}
      />
      <StorageNotice storage={result.storage} />
      <Panel aria-label="Filtros e exclusões">
        <IcpForm
          action={createIcpAction.bind(null, offer.id)}
          initial={{}}
          submitLabel="Criar ICP"
          cancelHref={strategyRoutes.offer(offer.id)}
        />
      </Panel>
    </>
  );
}

export default function NewIcpPage({ params }: Props) {
  return (
    <div className="space-y-6">
      <Suspense fallback={<Loading />}>
        <NewIcp params={params} />
      </Suspense>
    </div>
  );
}
