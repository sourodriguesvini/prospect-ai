import { Alert, Badge, Button, DemoBadge, Panel, PanelHeader, Well } from '@prospector/ui';
import { Plus } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { connection } from 'next/server';
import { Suspense } from 'react';
import { Loading } from '@/components/strategy/loading';
import { PageHeader, StorageNotice, Unavailable } from '@/components/strategy/page-parts';
import { CASE_ARCHIVED_NOTICE, strategyRoutes } from '@/lib/strategy-routes';
import { loadStrategy } from '@/server/strategy';

export const metadata: Metadata = { title: 'Cases' };

const TRAIL = [
  { href: '/configuracoes', label: 'Configuração' },
  { href: strategyRoutes.overview, label: 'Estratégia' },
];

async function Cases() {
  await connection();
  const result = await loadStrategy((strategy, ctx) => strategy.overview(ctx));
  if (result.kind === 'unavailable') return <Unavailable message={result.message} />;
  const { snapshot } = result.data;
  const offerName = new Map(
    snapshot.offers.map((o) => [o.id, o.current?.content.name ?? 'Oferta sem conteúdo']),
  );
  const active = snapshot.proofAssets.filter((p) => !p.archivedAt);
  const archived = snapshot.proofAssets.filter((p) => p.archivedAt);

  const list = (items: typeof active) => (
    <ul className="divide-y">
      {items.map((asset) => (
        <li key={asset.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
          <span className="min-w-0 space-y-0.5">
            <span className="flex flex-wrap items-center gap-2">
              <Link
                href={strategyRoutes.case(asset.id)}
                className="font-medium underline-offset-4 hover:underline"
              >
                {asset.title}
              </Link>
              {asset.isDemo ? <DemoBadge /> : null}
            </span>
            <span className="block text-sm text-muted-foreground">
              {[asset.segment, asset.offerId ? offerName.get(asset.offerId) : 'Todas as ofertas']
                .filter(Boolean)
                .join(' · ')}
            </span>
          </span>
          {asset.archivedAt ? (
            <Badge variant="outline">Arquivado</Badge>
          ) : asset.publicOk ? (
            <Badge variant="success">Citável</Badge>
          ) : (
            <Badge variant="neutral">Só uso interno</Badge>
          )}
        </li>
      ))}
    </ul>
  );

  return (
    <>
      <StorageNotice storage={result.storage} />
      <Panel aria-labelledby="cases-lista">
        <PanelHeader
          titleId="cases-lista"
          title="Cases"
          description="Só cases citáveis (com autorização do cliente registrada) podem aparecer em mensagens."
          actions={
            <Button asChild size="sm">
              <Link href={strategyRoutes.newCase}>
                <Plus aria-hidden="true" className="size-4" />
                Novo case
              </Link>
            </Button>
          }
        />
        {active.length === 0 ? (
          <Well className="py-10 text-center text-sm text-muted-foreground">
            Nenhum case ainda. Um case citável fortalece a abordagem, mas não é obrigatório.
          </Well>
        ) : (
          list(active)
        )}
      </Panel>
      {archived.length > 0 ? (
        <Panel aria-labelledby="cases-arquivados">
          <PanelHeader
            titleId="cases-arquivados"
            title="Arquivados"
            description="Não aparecem em mensagens nem contam na prontidão."
          />
          {list(archived)}
        </Panel>
      ) : null}
    </>
  );
}

type Props = PageProps<'/configuracoes/estrategia/cases'>;

/** Confirmação que sobrevive ao redirecionamento depois de arquivar (só o valor conhecido). */
async function Notice({ searchParams }: { searchParams: Props['searchParams'] }) {
  if ((await searchParams).aviso !== CASE_ARCHIVED_NOTICE) return null;
  return (
    <Alert tone="success" role="status" data-aviso={CASE_ARCHIVED_NOTICE}>
      Case arquivado. Ele saiu das mensagens e da prontidão e continua na lista de arquivados.
    </Alert>
  );
}

export default function CasesPage({ searchParams }: Props) {
  return (
    <div className="space-y-6">
      <PageHeader
        trail={TRAIL}
        title="Cases"
        description="Provas de resultado da agência. O redator só cita o que o cliente autorizou."
      />
      <Suspense fallback={null}>
        <Notice searchParams={searchParams} />
      </Suspense>
      <Suspense fallback={<Loading label="Carregando os cases…" />}>
        <Cases />
      </Suspense>
    </div>
  );
}
