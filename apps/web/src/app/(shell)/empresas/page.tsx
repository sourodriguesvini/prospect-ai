import {
  ACTIVE_INVESTIGATION_STATUSES,
  COMPANY_LIFECYCLE_LABELS,
  CompanyLifecycle,
  formatCnpj,
  INVESTIGATION_STATUS_LABELS,
  Recommendation,
  type Company,
  type CompanyInvestigationSummary,
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
import { RECOMMENDATION_SHORT, RECOMMENDATION_VIEW } from '@/lib/decision';
import { formatDate } from '@/lib/format';
import { loadCompanies } from '@/server/companies';
import { loadInvestigationSummaries } from '@/server/investigations';

export const metadata: Metadata = { title: 'Empresas' };

const LIMIT = 100;

const FILTER_OPTIONS = [
  { value: '', label: 'Todas em acompanhamento' },
  ...CompanyLifecycle.options.map((value) => ({ value, label: COMPANY_LIFECYCLE_LABELS[value] })),
];

/** Filtro pela última investigação: recomendação do diagnóstico, em andamento ou nenhuma. */
const INVESTIGATION_FILTERS = ['sem', 'andamento', ...Recommendation.options] as const;
type InvestigationFilter = (typeof INVESTIGATION_FILTERS)[number];

const INVESTIGATION_FILTER_OPTIONS = [
  { value: '', label: 'Todas' },
  { value: 'sem', label: 'Sem análise' },
  { value: 'andamento', label: 'Análise em andamento' },
  ...Recommendation.options.map((value) => ({ value, label: RECOMMENDATION_SHORT[value] })),
];

type Props = PageProps<'/empresas'>;

interface Filter {
  search: string;
  lifecycle: CompanyLifecycle | null;
  investigation: InvestigationFilter | null;
  byPriority: boolean;
}

function readFilter(params: Awaited<Props['searchParams']>): Filter {
  const one = (value: string | string[] | undefined) =>
    (Array.isArray(value) ? value[0] : value) ?? '';
  const lifecycle = CompanyLifecycle.safeParse(one(params.etapa));
  const investigation = INVESTIGATION_FILTERS.find((value) => value === one(params.investigacao));
  return {
    search: one(params.busca).trim().slice(0, 120),
    lifecycle: lifecycle.success ? lifecycle.data : null,
    investigation: investigation ?? null,
    byPriority: one(params.ordem) === 'prioridade',
  };
}

function matches(summary: CompanyInvestigationSummary | undefined, filter: InvestigationFilter) {
  if (filter === 'sem') return summary === undefined;
  if (!summary) return false;
  if (filter === 'andamento') return ACTIVE_INVESTIGATION_STATUSES.includes(summary.status);
  return summary.recommendation === filter;
}

/** Última investigação: recomendação e prioridade do diagnóstico ou o estado da execução. */
function InvestigationSummary({ summary }: { summary: CompanyInvestigationSummary | undefined }) {
  if (!summary) return <span>Não analisada</span>;
  if (!summary.recommendation) {
    return <Badge variant="outline">{INVESTIGATION_STATUS_LABELS[summary.status]}</Badge>;
  }
  return (
    <span className="flex flex-wrap items-center gap-2">
      <Badge
        variant={
          RECOMMENDATION_VIEW[summary.recommendation].tone === 'positive' ? 'success' : 'neutral'
        }
      >
        {RECOMMENDATION_SHORT[summary.recommendation]}
      </Badge>
      {summary.priority !== null ? <span>Prioridade {summary.priority}</span> : null}
      {summary.recommendedOfferName ? <span>· {summary.recommendedOfferName}</span> : null}
      {ACTIVE_INVESTIGATION_STATUSES.includes(summary.status) ? (
        <span>· {INVESTIGATION_STATUS_LABELS[summary.status].toLowerCase()}</span>
      ) : null}
    </span>
  );
}

function CompanyRow({
  company,
  summary,
}: {
  company: Company;
  summary: CompanyInvestigationSummary | undefined;
}) {
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
        <InvestigationSummary summary={summary} />
        {company.lastInvestigatedAt ? (
          <span>Última coleta em {formatDate(company.lastInvestigatedAt)}</span>
        ) : (
          <span>Sem coleta</span>
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
  const loaded = result.data;
  const summaries = await loadInvestigationSummaries(loaded.map((company) => company.id));
  const investigationFilter = filter.investigation;
  const selected = investigationFilter
    ? loaded.filter((company) => matches(summaries.get(company.id), investigationFilter))
    : loaded;
  const companies = filter.byPriority
    ? [...selected].sort(
        (a, b) => (summaries.get(b.id)?.priority ?? -1) - (summaries.get(a.id)?.priority ?? -1),
      )
    : selected;
  const filtered =
    filter.search !== '' || filter.lifecycle !== null || investigationFilter !== null;

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
          <div className="space-y-1.5">
            <Label htmlFor="investigacao-empresas">Análise</Label>
            <NativeSelect
              id="investigacao-empresas"
              name="investigacao"
              defaultValue={filter.investigation ?? ''}
            >
              {INVESTIGATION_FILTER_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ordem-empresas">Ordem</Label>
            <NativeSelect
              id="ordem-empresas"
              name="ordem"
              defaultValue={filter.byPriority ? 'prioridade' : ''}
            >
              <option value="">Mais recentes</option>
              <option value="prioridade">Maior prioridade</option>
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
              {loaded.length === LIMIT
                ? investigationFilter
                  ? `${companies.length} entre as ${LIMIT} mais recentes. Use a busca para achar outras.`
                  : `Mostrando as ${LIMIT} mais recentes. Use a busca para achar outras.`
                : `${companies.length} ${companies.length === 1 ? 'empresa' : 'empresas'}.`}
            </p>
            <ul className="divide-y">
              {companies.map((company) => (
                <CompanyRow
                  key={company.id}
                  company={company}
                  summary={summaries.get(company.id)}
                />
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
        trail={[{ href: '/', label: 'Hoje' }]}
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
