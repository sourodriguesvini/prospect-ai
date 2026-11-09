import { Panel } from '@prospector/ui';
import type { Metadata } from 'next';
import { connection } from 'next/server';
import { Suspense } from 'react';
import { Loading } from '@/components/strategy/loading';
import { OfferForm } from '@/components/strategy/offer-form';
import { PageHeader, StorageNotice, Unavailable } from '@/components/strategy/page-parts';
import { offerValues } from '@/lib/strategy-forms';
import { strategyRoutes } from '@/lib/strategy-routes';
import { loadStrategy } from '@/server/strategy';
import { updateOfferAction } from '../../../actions';

export const metadata: Metadata = { title: 'Editar oferta' };

type Props = PageProps<'/configuracoes/estrategia/ofertas/[offerId]/editar'>;

async function EditOffer({ params }: { params: Props['params'] }) {
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
        <PageHeader trail={trail} title="Editar oferta" />
        <Unavailable message={result.message} />
      </>
    );
  }
  const { offer } = result.data;
  return (
    <>
      <PageHeader
        trail={trail}
        title="Editar oferta"
        description={`Salvar cria a versão ${(offer.current?.version ?? 0) + 1}; a versão ${offer.current?.version ?? 1} continua igual para quem a usou. Sem mudanças, nada é salvo.`}
      />
      <StorageNotice storage={result.storage} />
      <Panel aria-label="Conteúdo da oferta">
        <OfferForm
          action={updateOfferAction.bind(null, offer.id)}
          initial={offerValues(offer.current?.content ?? null)}
          submitLabel="Salvar nova versão"
          cancelHref={strategyRoutes.offer(offer.id)}
        />
      </Panel>
    </>
  );
}

export default function EditOfferPage({ params }: Props) {
  return (
    <div className="space-y-6">
      <Suspense fallback={<Loading />}>
        <EditOffer params={params} />
      </Suspense>
    </div>
  );
}
