import { Panel } from '@prospector/ui';
import type { Metadata } from 'next';
import { connection } from 'next/server';
import { Suspense } from 'react';
import { Loading } from '@/components/strategy/loading';
import { OfferForm } from '@/components/strategy/offer-form';
import { PageHeader, StorageNotice, Unavailable } from '@/components/strategy/page-parts';
import { strategyRoutes } from '@/lib/strategy-routes';
import { loadStrategy } from '@/server/strategy';
import { createOfferAction } from '../../actions';

export const metadata: Metadata = { title: 'Nova oferta' };

async function NewOffer() {
  await connection();
  const result = await loadStrategy(async () => null);
  if (result.kind === 'unavailable') return <Unavailable message={result.message} />;
  return (
    <div className="space-y-4">
      <StorageNotice storage={result.storage} />
      <Panel aria-label="Conteúdo da oferta">
        <OfferForm
          action={createOfferAction}
          initial={{}}
          submitLabel="Criar oferta"
          cancelHref={strategyRoutes.overview}
        />
      </Panel>
    </div>
  );
}

export default function NewOfferPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        trail={[
          { href: '/configuracoes', label: 'Configuração' },
          { href: strategyRoutes.overview, label: 'Estratégia' },
        ]}
        title="Nova oferta"
        description="A oferta nasce em rascunho. Para ativá-la, complete problemas, sinais, desqualificadores, entregáveis e faixa de investimento, e salve a rubrica e o modelo de score."
      />
      <Suspense fallback={<Loading />}>
        <NewOffer />
      </Suspense>
    </div>
  );
}
