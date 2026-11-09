import { DRAFT_OPT_OUT_TEXT } from '@prospector/domain';
import { Panel } from '@prospector/ui';
import type { Metadata } from 'next';
import { connection } from 'next/server';
import { Suspense } from 'react';
import { DraftNotice } from '@/components/forms/fields';
import { Loading } from '@/components/strategy/loading';
import { PageHeader, StorageNotice, Unavailable } from '@/components/strategy/page-parts';
import { ContactPolicyForm } from '@/components/strategy/simple-forms';
import { contactPolicyValues } from '@/lib/strategy-forms';
import { strategyRoutes } from '@/lib/strategy-routes';
import { loadStrategy } from '@/server/strategy';
import { saveContactPolicyAction } from '../actions';

export const metadata: Metadata = { title: 'Identificação e opt-out' };

const TRAIL = [
  { href: '/configuracoes', label: 'Configuração' },
  { href: strategyRoutes.compliance, label: 'Conformidade' },
];

async function ContactPolicy() {
  await connection();
  const result = await loadStrategy((strategy, ctx) => strategy.compliance(ctx));
  if (result.kind === 'unavailable') return <Unavailable message={result.message} />;
  const current = result.data.contactPolicyVersions[0] ?? null;
  return (
    <>
      <StorageNotice storage={result.storage} />
      {current ? null : (
        <DraftNotice>
          O texto de opt-out abaixo é uma sugestão. Nome da agência e canal do titular ficam em
          branco: só você sabe quais são. Nada foi salvo ainda.
        </DraftNotice>
      )}
      <Panel aria-label="Identificação e opt-out">
        <ContactPolicyForm
          action={saveContactPolicyAction}
          initial={
            current ? contactPolicyValues(current.content) : { optOutText: DRAFT_OPT_OUT_TEXT }
          }
          submitLabel={current ? `Salvar como v${current.version + 1}` : 'Salvar'}
          cancelHref={strategyRoutes.compliance}
        />
      </Panel>
    </>
  );
}

export default function ContactPolicyPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        trail={TRAIL}
        title="Identificação e opt-out"
        description="Como a agência se apresenta, onde o titular exerce os direitos e como deixa de receber mensagens."
      />
      <Suspense fallback={<Loading />}>
        <ContactPolicy />
      </Suspense>
    </div>
  );
}
