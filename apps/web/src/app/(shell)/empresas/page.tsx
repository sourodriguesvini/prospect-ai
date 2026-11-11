import {
  COMPANY_LIFECYCLE_LABELS,
  CompanyLifecycle,
  formatCnpj,
  type Company,
} from '@prospector/contracts';
import { Badge, Button, DemoBadge, Input, Label, NativeSelect, Panel, Well } from '@prospector/ui';
import { Plus, Search } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { connection } from 'next/server';
import { Suspense } from 'react';
import { Loading } from '@/components/strategy/loading';
import { PageHeader, StorageNotice, Unavailable } from '@/components/strategy/page-parts';
import { companyRoutes } from '@/lib/company-routes';
import { formatDate } from '@/lib/format';
import { loadCompanies } from '@/server/companies';

export const metadata: Metadata = { title: 'Empresas' };

const LIMIT = 100;

const FILTER_OPTIONS = [
  { value: '', label: 'Todas em acompanhamento' },
  ...CompanyLifecycle.options.map((value) => ({ value, label: COMPANY_LIFECYCLE_LABELS[value] })),
];

type Props = PageProps<'/empresas'>;

interface Filter {
  search: string;
  lifecycle: CompanyLifecycle | null;
}

function readFilter(params: Awaited<Props['searchParams']>): Filter {
  const one = (value: string | string[] | undefined) =>
    (Array.isArray(value) ? value[0] : value) ?? '';
  const lifecycle = CompanyLifecycle.safeParse(one(params.etapa));
  return {
    search: one(params.busca).trim().slice(0, 120),
    lifecycle: lifecycle.success ? lifecycle.data : null,
  };
}

function CompanyRow({ company }: { company: Company }) {
  const place = [company.city, company.uf].filter(Boolean).join('/');
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 py-3">
      <span className="min-w-0 space-y-0.5">
        <span className="flex flex-wrap items-center gap-2">
          <Link
            href={companyRoutes.company(company.id)}
            className="font-medium underline-offset-4 hover:underline"
          >
            {company.displayName}
          </Link>
          {company.isDemo ? <DemoBadge /> : null}
        </span>
        <span className="block text-sm text-muted-foreground">
          {[company.cnpj ? formatCnpj(company.cnpj) : 'Sem CNPJ', place || null]
            .filter(Boolean)
            .join(' · ')}
        </span>
      </span>
      <span className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        {company.lastInvestigatedAt ? (
          <span>Consultada em {formatDate(company.lastInvestigatedAt)}</span>
        ) : (
          <span>Sem consulta</span>
        )}
        <Badge variant={company.lifecycle === 'archived' ? 'outline' : 'neutral'}>
          {COMPANY_LIFECYCLE_LABELS[company.lifecycle]}
        </Badge>
      </span>
    </li>
  );
}

async function CompanyList({ searchParams }: { searchParams: Props['searchParams'] }) {
  await connection();
  const filter = readFilter(await searchParams);
  const result = await loadCompanies((companies, ctx) =>
    companies.list(ctx, {
      search: filter.search,
      lifecycle: filter.lifecycle,
      includeArchived: filter.lifecycle === 'archived',
      limit: LIMIT,
    }),
  );
  if (result.kind === 'unavailable') return <Unavailable message={result.message} />;
  const companies = result.data;
  const filtered = filter.search !== '' || filter.lifecycle !== null;

  return (
    <>
      <StorageNotice storage={result.storage} />
      <Panel aria-labelledby="empresas-lista">
        <h2 id="empresas-lista" className="sr-only">
          Lista de empresas
        </h2>
        <form
          role="search"
          aria-label="Buscar empresas"
          action={companyRoutes.list}
          className="mb-5 flex flex-wrap items-end gap-3"
        >
          <div className="min-w-56 flex-1 space-y-1.5">
            <Label htmlFor="busca-empresas">Buscar</Label>
            <Input
              id="busca-empresas"
              name="busca"
              type="search"
              defaultValue={filter.search}
              placeholder="Nome, razão social, CNPJ ou site"
              maxLength={120}
              autoComplete="off"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="etapa-empresas">Etapa</Label>
            <NativeSelect id="etapa-empresas" name="etapa" defaultValue={filter.lifecycle ?? ''}>
              {FILTER_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </NativeSelect>
          </div>
          <Button type="submit" variant="secondary">
            <Search aria-hidden="true" className="size-4" />
            Buscar
          </Button>
          {filtered ? (
            <Button asChild variant="ghost">
              <Link href={companyRoutes.list}>Limpar</Link>
            </Button>
          ) : null}
        </form>
        {companies.length === 0 ? (
          <Well className="space-y-2 py-10 text-center text-sm text-muted-foreground">
            {filtered ? (
              <p>
                Nenhuma empresa encontrada com esses filtros.
                {filter.lifecycle === null
                  ? ' A busca não inclui as arquivadas: escolha Arquivada em Etapa para procurar nelas.'
                  : ''}
              </p>
            ) : (
              <>
                <p>
                  Nenhuma empresa em acompanhamento. Comece pelo CNPJ: o Prospector consulta a base
                  aberta da Receita e guarda cada dado com a fonte.
                </p>
                <p>
                  <Link href={companyRoutes.create} className="underline underline-offset-4">
                    Adicionar a primeira empresa
                  </Link>
                  . As arquivadas aparecem ao escolher Arquivada em Etapa.
                </p>
              </>
            )}
          </Well>
        ) : (
          <>
            <p className="text-sm text-muted-foreground" role="status">
              {companies.length === LIMIT
                ? `Mostrando as ${LIMIT} mais recentes. Use a busca para achar outras.`
                : `${companies.length} ${companies.length === 1 ? 'empresa' : 'empresas'}.`}
            </p>
            <ul className="divide-y">
              {companies.map((company) => (
                <CompanyRow key={company.id} company={company} />
              ))}
            </ul>
          </>
        )}
      </Panel>
    </>
  );
}

export default function CompaniesPage({ searchParams }: Props) {
  return (
    <div className="space-y-6">
      <PageHeader
        trail={[{ href: '/', label: 'Início' }]}
        title="Empresas"
        description="Empresas que você acompanha. Cada dado do dossiê aparece com a fonte, a data da coleta e a confiança."
        actions={
          <Button asChild>
            <Link href={companyRoutes.create}>
              <Plus aria-hidden="true" className="size-4" />
              Adicionar empresa
            </Link>
          </Button>
        }
      />
      <Suspense fallback={<Loading label="Carregando as empresas…" />}>
        <CompanyList searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
