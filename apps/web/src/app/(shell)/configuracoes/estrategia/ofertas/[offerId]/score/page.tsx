import { DRAFT_SCORING_MODEL } from '@prospector/domain';
import { Panel, PanelHeader } from '@prospector/ui';
import type { Metadata } from 'next';
import { connection } from 'next/server';
import { Suspense } from 'react';
import { DraftNotice } from '@/components/forms/fields';
import { Loading } from '@/components/strategy/loading';
import {
  PageHeader,
  StorageNotice,
  Unavailable,
  VersionHistory,
} from '@/components/strategy/page-parts';
import { ScoringEditor } from '@/components/strategy/scoring-editor';
import { strategyRoutes } from '@/lib/strategy-routes';
import { loadStrategy } from '@/server/strategy';
import { saveScoringModelAction } from '../../../actions';

export const metadata: Metadata = { title: 'Modelo de score' };

type Props = PageProps<'/configuracoes/estrategia/ofertas/[offerId]/score'>;

async function Scoring({ params }: { params: Props['params'] }) {
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
        <PageHeader trail={trail} title="Modelo de score" />
        <Unavailable message={result.message} />
      </>
    );
  }
  const { offer, scoringModelVersions } = result.data;
  const current = scoringModelVersions[0] ?? null;
  return (
    <>
      <PageHeader
        trail={trail}
        title="Modelo de score"
        description={`${offer.current?.content.name ?? 'Oferta'}: pesos das dimensões e limiares das recomendações (docs/08 §3). Salvar cria uma nova versão.`}
      />
      <StorageNotice storage={result.storage} />
      {current ? null : (
        <DraftNotice>
          Pesos e limiares de 70, 70 e 40 são a proposta inicial de docs/08 para branding, ainda sem
          calibração. A cobertura mínima de 50% não tem base em docs/08: é só um ponto de partida.
          Nada foi salvo ainda.
        </DraftNotice>
      )}
      <Panel aria-label="Pesos e limiares">
        <ScoringEditor
          action={saveScoringModelAction.bind(null, offer.id)}
          initial={current?.content ?? DRAFT_SCORING_MODEL}
          cancelHref={strategyRoutes.offer(offer.id)}
        />
      </Panel>
      <Panel aria-labelledby="versoes-score">
        <PanelHeader titleId="versoes-score" title="Versões do modelo" />
        <VersionHistory versions={scoringModelVersions} />
      </Panel>
    </>
  );
}

export default function ScoringPage({ params }: Props) {
  return (
    <div className="space-y-6">
      <Suspense fallback={<Loading />}>
        <Scoring params={params} />
      </Suspense>
    </div>
  );
}
