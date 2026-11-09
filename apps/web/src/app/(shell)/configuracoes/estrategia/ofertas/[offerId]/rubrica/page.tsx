import { DRAFT_BRANDING_RUBRIC } from '@prospector/domain';
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
import { RubricEditor } from '@/components/strategy/rubric-editor';
import { strategyRoutes } from '@/lib/strategy-routes';
import { loadStrategy } from '@/server/strategy';
import { saveRubricAction } from '../../../actions';

export const metadata: Metadata = { title: 'Rubrica de auditoria' };

type Props = PageProps<'/configuracoes/estrategia/ofertas/[offerId]/rubrica'>;

async function Rubric({ params }: { params: Props['params'] }) {
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
        <PageHeader trail={trail} title="Rubrica de auditoria visual" />
        <Unavailable message={result.message} />
      </>
    );
  }
  const { offer, rubricVersions } = result.data;
  const current = rubricVersions[0] ?? null;
  return (
    <>
      <PageHeader
        trail={trail}
        title="Rubrica de auditoria visual"
        description={`${offer.current?.content.name ?? 'Oferta'}: critérios que o auditor visual pontua de 1 a 5, com pesos que somam 100. Salvar cria uma nova versão.`}
      />
      <StorageNotice storage={result.storage} />
      {current ? null : (
        <DraftNotice>
          Critérios e pesos abaixo são uma proposta inicial para branding, sem calibração com
          resultados reais. Ajuste ao seu método; nada foi salvo ainda.
        </DraftNotice>
      )}
      <Panel aria-label="Critérios da rubrica">
        <RubricEditor
          action={saveRubricAction.bind(null, offer.id)}
          initial={current?.content ?? DRAFT_BRANDING_RUBRIC}
          cancelHref={strategyRoutes.offer(offer.id)}
        />
      </Panel>
      <Panel aria-labelledby="versoes-rubrica">
        <PanelHeader titleId="versoes-rubrica" title="Versões da rubrica" />
        <VersionHistory versions={rubricVersions} />
      </Panel>
    </>
  );
}

export default function RubricPage({ params }: Props) {
  return (
    <div className="space-y-6">
      <Suspense fallback={<Loading />}>
        <Rubric params={params} />
      </Suspense>
    </div>
  );
}
