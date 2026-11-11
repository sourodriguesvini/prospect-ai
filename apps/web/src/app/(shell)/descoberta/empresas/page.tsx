import {
  PRIORITY_BAND_LABELS,
  PROSPECT_STATUS_LABELS,
  PriorityBand,
  ProspectStatus,
  SIGNAL_TYPE_LABELS,
  SignalType,
} from '@prospector/contracts';
import { Button, Label, NativeSelect, Panel, PanelHeader, Well } from '@prospector/ui';
import { Search } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { connection } from 'next/server';
import { Suspense } from 'react';
import { ActionAnnouncer } from '@/components/discovery/announcers';
import { ProspectCard, ProspectCardActions } from '@/components/discovery/discovery-parts';
import { Loading } from '@/components/strategy/loading';
import { PageHeader, StorageNotice, Unavailable } from '@/components/strategy/page-parts';
import { discoveryRoutes } from '@/lib/discovery-routes';
import { loadDiscovery } from '@/server/discovery';
import { decideProspectAction, investigateProspectAction } from '../actions';

export const metadata: Metadata = { title: 'Empresas encontradas' };

const LIMIT = 60;

type Props = PageProps<'/descoberta/empresas'>;

interface Filter {
  status: ProspectStatus | null;
  priority: PriorityBand | null;
  signal: SignalType | null;
}

function readFilter(params: Awaited<Props['searchParams']>): Filter {
  const one = (value: string | string[] | undefined) =>
    (Array.isArray(value) ? value[0] : value) ?? '';
  const status = ProspectStatus.safeParse(one(params.situacao));
  const priority = PriorityBand.safeParse(one(params.prioridade));
  const signal = SignalType.safeParse(one(params.sinal));
  return {
    status: status.success ? status.data : null,
    priority: priority.success ? priority.data : null,
    signal: signal.success ? signal.data : null,
  };
}

function Select({
  id,
  name,
  label,
  value,
  options,
}: {
  id: string;
  name: string;
  label: string;
  value: string;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <NativeSelect id={id} name={name} defaultValue={value}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </NativeSelect>
    </div>
  );
}

async function ProspectList({ searchParams }: { searchParams: Props['searchParams'] }) {
  await connection();
  const filter = readFilter(await searchParams);
  const result = await loadDiscovery((discovery, ctx) =>
    discovery.listProspects(ctx, {
      status: filter.status ? [filter.status] : [],
      priority: filter.priority ? [filter.priority] : [],
      signalType: filter.signal,
      includeDismissed: filter.status === 'dismissed',
      limit: LIMIT,
    }),
  );
  if (result.kind === 'unavailable') return <Unavailable message={result.message} />;
  const prospects = result.data;
  const filtered = filter.status !== null || filter.priority !== null || filter.signal !== null;

  return (
    <>
      <StorageNotice storage={result.storage} />
      <Panel aria-labelledby="lista-encontradas">
        <PanelHeader
          title="Resultados"
          titleId="lista-encontradas"
          description="Prioridade é a triagem por regras com as fontes encontradas, não chance de fechar negócio. Nada aqui foi enviado a ninguém."
        />
        <form
          role="search"
          aria-label="Filtrar empresas encontradas"
          action={discoveryRoutes.prospects}
          className="mb-5 flex flex-wrap items-end gap-3"
        >
          <Select
            id="filtro-situacao"
            name="situacao"
            label="Situação"
            value={filter.status ?? ''}
            options={[
              { value: '', label: 'Todas (menos ignoradas)' },
              ...ProspectStatus.options.map((value) => ({
                value,
                label: PROSPECT_STATUS_LABELS[value],
              })),
            ]}
          />
          <Select
            id="filtro-prioridade"
            name="prioridade"
            label="Prioridade"
            value={filter.priority ?? ''}
            options={[
              { value: '', label: 'Todas' },
              ...PriorityBand.options.map((value) => ({
                value,
                label: PRIORITY_BAND_LABELS[value],
              })),
            ]}
          />
          <Select
            id="filtro-sinal"
            name="sinal"
            label="Sinal"
            value={filter.signal ?? ''}
            options={[
              { value: '', label: 'Qualquer' },
              ...SignalType.options.map((value) => ({ value, label: SIGNAL_TYPE_LABELS[value] })),
            ]}
          />
          <Button type="submit" variant="secondary">
            <Search aria-hidden="true" className="size-4" />
            Filtrar
          </Button>
          {filtered ? (
            <Button asChild variant="ghost">
              <Link href={discoveryRoutes.prospects}>Limpar</Link>
            </Button>
          ) : null}
        </form>
        <ActionAnnouncer listTitleId="lista-encontradas">
          {prospects.length === 0 ? (
            <Well className="space-y-2 py-10 text-center text-sm text-muted-foreground">
              {filtered ? (
                <p>Nenhuma empresa encontrada com esses filtros.</p>
              ) : (
                <p>
                  Nenhuma empresa encontrada ainda.{' '}
                  <Link href={discoveryRoutes.home} className="underline underline-offset-4">
                    Faça uma pesquisa
                  </Link>{' '}
                  para começar.
                </p>
              )}
            </Well>
          ) : (
            <>
              {/* A ordem é a do repositório: as vistas mais recentemente numa pesquisa primeiro. */}
              <p className="text-sm text-muted-foreground">
                {prospects.length === LIMIT
                  ? `Mostrando as ${LIMIT} vistas mais recentemente numa pesquisa; use os filtros para achar outras.`
                  : `${prospects.length} ${prospects.length === 1 ? 'empresa' : 'empresas'}, das vistas mais recentemente numa pesquisa para as mais antigas.`}
                {filter.priority === null ? (
                  <>
                    {' '}
                    Para ver só as de maior prioridade, use o filtro{' '}
                    <a href="#filtro-prioridade" className="underline underline-offset-4">
                      Prioridade
                    </a>
                    .
                  </>
                ) : null}
              </p>
              <ul className="divide-y">
                {prospects.map((view) => (
                  <ProspectCard
                    key={view.prospect.id}
                    view={view}
                    actions={
                      <ProspectCardActions
                        prospect={view.prospect}
                        investigate={investigateProspectAction.bind(null, view.prospect.id)}
                        save={decideProspectAction.bind(null, view.prospect.id, 'saved')}
                        dismiss={decideProspectAction.bind(null, view.prospect.id, 'dismissed')}
                        restore={decideProspectAction.bind(null, view.prospect.id, 'new')}
                      />
                    }
                  />
                ))}
              </ul>
            </>
          )}
        </ActionAnnouncer>
      </Panel>
    </>
  );
}

export default function ProspectsPage({ searchParams }: Props) {
  return (
    <div className="space-y-6">
      <PageHeader
        trail={[
          { href: '/', label: 'Início' },
          { href: discoveryRoutes.home, label: 'Descoberta' },
        ]}
        title="Empresas encontradas"
        description="Todas as empresas que as pesquisas acharam, sem repetição. Investigar leva a empresa para Empresas com as fontes como evidências."
      />
      <Suspense fallback={<Loading label="Carregando as empresas encontradas…" />}>
        <ProspectList searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
