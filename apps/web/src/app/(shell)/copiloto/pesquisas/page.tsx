import { Button, Panel, PanelHeader, Well } from '@prospector/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { connection } from 'next/server';
import { Suspense } from 'react';
import { ResearchCard } from '@/components/copilot/research-parts';
import { Loading } from '@/components/strategy/loading';
import { PageHeader, StorageNotice, Unavailable } from '@/components/strategy/page-parts';
import { loadResearch } from '@/server/copilot-research';

export const metadata: Metadata = { title: 'Pesquisas do Copiloto' };

const TRAIL = [
  { href: '/', label: 'Hoje' },
  { href: '/copiloto', label: 'Copiloto' },
];

const HEADER = {
  trail: TRAIL,
  title: 'Pesquisas do Copiloto',
  description:
    'Pesquisas extensas pedidas na conversa (por exemplo, “encontre 100 terapeutas ocupacionais no Brasil”). Cada uma guarda os achados com a fonte, para revisão.',
};

async function ResearchList() {
  await connection();
  const result = await loadResearch((service, ctx) => service.listRecent(ctx, 50));
  if (result.kind === 'unavailable') {
    return (
      <>
        <PageHeader {...HEADER} />
        <Unavailable message={result.message} />
      </>
    );
  }
  const list = result.data;
  return (
    <>
      <PageHeader
        {...HEADER}
        actions={
          <Button asChild variant="secondary">
            <Link href="/copiloto">Pedir uma pesquisa</Link>
          </Button>
        }
      />
      <StorageNotice storage={result.storage} />
      <Panel aria-labelledby="lista-pesquisas">
        <PanelHeader title="Mais recentes" titleId="lista-pesquisas" />
        {list.length > 0 ? (
          <ul className="space-y-3">
            {list.map((research) => (
              <li key={research.id}>
                <ResearchCard research={research} showDate />
              </li>
            ))}
          </ul>
        ) : (
          <Well className="py-10 text-center text-sm text-muted-foreground">
            Nenhuma pesquisa ainda. Peça no Copiloto, por exemplo: “Quero encontrar 100 terapeutas
            ocupacionais no Brasil para apresentar a Blummy.”
          </Well>
        )}
      </Panel>
    </>
  );
}

export default function ResearchListPage() {
  return (
    <div className="space-y-6">
      <Suspense fallback={<Loading label="Carregando as pesquisas…" />}>
        <ResearchList />
      </Suspense>
    </div>
  );
}
