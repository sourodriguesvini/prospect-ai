import { DRAFT_LIA } from '@prospector/domain';
import { Alert, Panel } from '@prospector/ui';
import type { Metadata } from 'next';
import { connection } from 'next/server';
import { Suspense } from 'react';
import { DraftNotice } from '@/components/forms/fields';
import { Loading } from '@/components/strategy/loading';
import { PageHeader, StorageNotice, Unavailable } from '@/components/strategy/page-parts';
import { LiaForm } from '@/components/strategy/simple-forms';
import { liaValues } from '@/lib/strategy-forms';
import { strategyRoutes } from '@/lib/strategy-routes';
import { loadStrategy } from '@/server/strategy';
import { saveLiaAction } from '../actions';

export const metadata: Metadata = { title: 'LIA' };

const TRAIL = [
  { href: '/configuracoes', label: 'Configuração' },
  { href: strategyRoutes.compliance, label: 'Conformidade' },
];

async function Lia() {
  await connection();
  const result = await loadStrategy((strategy, ctx) => strategy.compliance(ctx));
  if (result.kind === 'unavailable') return <Unavailable message={result.message} />;
  const latest = result.data.liaVersions[0] ?? null;
  const { effectiveLia } = result.data;
  const lapsed =
    effectiveLia.status === 'revoked' || effectiveLia.status === 'expired'
      ? effectiveLia.version
      : null;
  return (
    <>
      <StorageNotice storage={result.storage} />
      {lapsed && lapsed.id === latest?.id ? (
        <Alert tone="info" role="note">
          A LIA v{lapsed.version} {effectiveLia.status === 'revoked' ? 'foi revogada' : 'venceu'}.
          Para voltar a abordar, salve uma nova versão (pode manter o texto, se ele ainda vale) e
          aprove na Conformidade.
        </Alert>
      ) : null}
      {latest ? null : (
        <DraftNotice>
          Texto sugerido para prospecção de empresas sem contato prévio. Não é parecer jurídico:
          usar o legítimo interesse para isso ainda precisa do parecer de um advogado. A conclusão
          fica em branco de propósito, para você escrever a sua. Nada foi salvo ainda.
        </DraftNotice>
      )}
      <Panel aria-label="Modelo guiado da LIA">
        <LiaForm
          action={saveLiaAction}
          initial={liaValues(latest?.content ?? DRAFT_LIA)}
          submitLabel={latest ? `Salvar como v${latest.version + 1}` : 'Salvar v1'}
          cancelHref={strategyRoutes.compliance}
        />
      </Panel>
    </>
  );
}

export default function LiaPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        trail={TRAIL}
        title="LIA: avaliação de legítimo interesse"
        description="Salvar cria uma versão em rascunho. A aprovação é um passo separado, na tela de Conformidade, e só vale para a versão mais recente."
      />
      <Suspense fallback={<Loading label="Carregando a LIA…" />}>
        <Lia />
      </Suspense>
    </div>
  );
}
