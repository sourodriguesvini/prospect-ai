import { Panel } from '@prospector/ui';
import type { Metadata } from 'next';
import { connection } from 'next/server';
import { Suspense } from 'react';
import { Loading } from '@/components/strategy/loading';
import { PageHeader, StorageNotice, Unavailable } from '@/components/strategy/page-parts';
import { ProofAssetForm } from '@/components/strategy/simple-forms';
import { strategyRoutes } from '@/lib/strategy-routes';
import { loadStrategy } from '@/server/strategy';
import { createProofAssetAction } from '../../actions';

export const metadata: Metadata = { title: 'Novo case' };

const TRAIL = [
  { href: '/configuracoes', label: 'Configuração' },
  { href: strategyRoutes.overview, label: 'Estratégia' },
  { href: strategyRoutes.cases, label: 'Cases' },
];

async function NewCase() {
  await connection();
  const result = await loadStrategy((strategy, ctx) => strategy.overview(ctx));
  if (result.kind === 'unavailable') return <Unavailable message={result.message} />;
  const offers = result.data.snapshot.offers
    .filter((o) => o.status !== 'archived')
    .map((o) => ({
      value: o.id,
      label: `${o.current?.content.name ?? 'Oferta sem conteúdo'}${o.isDemo ? ' (demo)' : ''}`,
    }));
  return (
    <>
      <StorageNotice storage={result.storage} />
      <Panel aria-label="Dados do case">
        <ProofAssetForm
          action={createProofAssetAction}
          initial={{}}
          offers={offers}
          submitLabel="Criar case"
          cancelHref={strategyRoutes.cases}
        />
      </Panel>
    </>
  );
}

export default function NewCasePage() {
  return (
    <div className="space-y-6">
      <PageHeader
        trail={TRAIL}
        title="Novo case"
        description="Sem dados pessoais do cliente: descreva o trabalho e o resultado da empresa."
      />
      <Suspense fallback={<Loading />}>
        <NewCase />
      </Suspense>
    </div>
  );
}
