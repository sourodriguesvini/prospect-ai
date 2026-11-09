import { Panel, PanelHeader } from '@prospector/ui';
import type { Metadata } from 'next';
import { connection } from 'next/server';
import { Suspense } from 'react';
import { Loading } from '@/components/strategy/loading';
import {
  PageHeader,
  StorageNotice,
  Unavailable,
  VersionHistory,
} from '@/components/strategy/page-parts';
import { VoiceForm } from '@/components/strategy/simple-forms';
import { voiceValues } from '@/lib/strategy-forms';
import { strategyRoutes } from '@/lib/strategy-routes';
import { loadStrategy } from '@/server/strategy';
import { saveVoiceGuideAction } from '../actions';

export const metadata: Metadata = { title: 'Voz da agência' };

const TRAIL = [
  { href: '/configuracoes', label: 'Configuração' },
  { href: strategyRoutes.overview, label: 'Estratégia' },
];

async function Voice() {
  await connection();
  const result = await loadStrategy((strategy, ctx) => strategy.voiceGuideVersions(ctx));
  if (result.kind === 'unavailable') return <Unavailable message={result.message} />;
  const versions = result.data;
  const current = versions[0] ?? null;
  return (
    <>
      <StorageNotice storage={result.storage} />
      <Panel aria-labelledby="voz-form">
        <PanelHeader
          titleId="voz-form"
          title={current ? `Versão ${current.version}` : 'Descreva a voz'}
          description={
            current
              ? 'Salvar cria uma nova versão. Sem mudanças, nada é salvo.'
              : 'Ainda não descrita. Sem voz definida, as abordagens ficam bloqueadas.'
          }
        />
        <VoiceForm
          action={saveVoiceGuideAction}
          initial={voiceValues(current?.content ?? null)}
          submitLabel={current ? 'Salvar nova versão' : 'Salvar voz'}
          cancelHref={strategyRoutes.overview}
        />
      </Panel>
      <Panel aria-labelledby="voz-versoes">
        <PanelHeader titleId="voz-versoes" title="Versões" />
        <VersionHistory versions={versions} />
      </Panel>
    </>
  );
}

export default function VoicePage() {
  return (
    <div className="space-y-6">
      <PageHeader
        trail={TRAIL}
        title="Voz da agência"
        description="Como a agência fala nas mensagens: princípios, o que evitar e exemplos. O redator (F10) segue esta voz."
      />
      <Suspense fallback={<Loading label="Carregando a voz da agência…" />}>
        <Voice />
      </Suspense>
    </div>
  );
}
