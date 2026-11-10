import type { EntityStatus, IcpContent } from '@prospector/contracts';
import { Alert, Badge, DemoBadge, Panel, PanelHeader } from '@prospector/ui';
import type { Metadata } from 'next';
import { connection } from 'next/server';
import { Suspense } from 'react';
import { StatusButton } from '@/components/strategy/decision-forms';
import { IcpForm } from '@/components/strategy/icp-form';
import { Loading } from '@/components/strategy/loading';
import {
  PageHeader,
  StorageNotice,
  TermList,
  Unavailable,
  VersionHistory,
} from '@/components/strategy/page-parts';
import { formatMunicipality } from '@/lib/form-data';
import { COMPANY_SIZE_LABELS, ICP_STATUS_LABELS, STATUS_BADGE } from '@/lib/strategy-labels';
import { icpValues } from '@/lib/strategy-forms';
import { strategyRoutes } from '@/lib/strategy-routes';
import { loadStrategy, strategyDetail, strategyTitle } from '@/server/strategy';
import { changeIcpStatusAction, updateIcpAction } from '../../actions';

type Props = PageProps<'/configuracoes/estrategia/icp/[icpId]'>;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { icpId } = await params;
  const title = await strategyTitle(
    async (strategy) => (await strategyDetail.icp(strategy, icpId)).icp.current?.content.name,
    'ICP',
  );
  return { title };
}

const TRANSITIONS: Record<
  EntityStatus,
  readonly { to: EntityStatus; label: string; variant: 'primary' | 'secondary' }[]
> = {
  draft: [
    { to: 'active', label: 'Ativar ICP', variant: 'primary' },
    { to: 'archived', label: 'Arquivar', variant: 'secondary' },
  ],
  active: [
    { to: 'draft', label: 'Pausar', variant: 'secondary' },
    { to: 'archived', label: 'Arquivar', variant: 'secondary' },
  ],
  archived: [{ to: 'draft', label: 'Reabrir como rascunho', variant: 'secondary' }],
};

function ageRange(min: number | null, max: number | null): string | null {
  if (min === null && max === null) return null;
  if (min !== null && max !== null) return `De ${min} a ${max} anos`;
  if (min !== null) return `${min} anos ou mais`;
  return `Até ${max} anos`;
}

function IcpSummary({ content }: { content: IcpContent }) {
  const { filters, exclusions } = content;
  const age = ageRange(filters.minAgeYears, filters.maxAgeYears);
  const rows = [
    { label: 'CNAEs', items: filters.cnaes },
    { label: 'UFs', items: filters.ufs },
    { label: 'Municípios', items: filters.municipalities.map(formatMunicipality) },
    { label: 'Porte', items: filters.sizes.map((s) => COMPANY_SIZE_LABELS[s]) },
    { label: 'Idade da empresa', items: age ? [age] : [] },
  ];
  const excluded = [
    { label: 'CNAEs', items: exclusions.cnaes },
    { label: 'Municípios', items: exclusions.municipalities.map(formatMunicipality) },
    { label: 'Raízes de CNPJ', items: exclusions.cnpjRoots },
    { label: 'Domínios', items: exclusions.domains },
  ];
  return (
    <div className="grid gap-6 md:grid-cols-2">
      <section aria-labelledby="icp-filtros" className="space-y-3">
        <h3 id="icp-filtros" className="text-sm font-semibold">
          Filtros
        </h3>
        <dl className="space-y-3">
          {rows.map((row) => (
            <div key={row.label} className="space-y-1">
              <dt className="text-sm text-muted-foreground">{row.label}</dt>
              <dd>
                <TermList items={row.items} empty="Sem filtro." />
              </dd>
            </div>
          ))}
        </dl>
      </section>
      <section aria-labelledby="icp-exclusoes" className="space-y-3">
        <h3 id="icp-exclusoes" className="text-sm font-semibold">
          Exclusões
        </h3>
        <dl className="space-y-3">
          {excluded.map((row) => (
            <div key={row.label} className="space-y-1">
              <dt className="text-sm text-muted-foreground">{row.label}</dt>
              <dd>
                <TermList items={row.items} empty="Nenhuma." />
              </dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}

async function IcpDetail({ params }: { params: Props['params'] }) {
  await connection();
  const { icpId } = await params;
  const result = await loadStrategy((strategy) => strategyDetail.icp(strategy, icpId));
  const baseTrail = [
    { href: '/configuracoes', label: 'Configuração' },
    { href: strategyRoutes.overview, label: 'Estratégia' },
  ];
  if (result.kind === 'unavailable') {
    return (
      <>
        <PageHeader trail={baseTrail} title="ICP" />
        <Unavailable message={result.message} />
      </>
    );
  }
  const { icp, offer, versions, activationIssues } = result.data;
  const content = icp.current?.content ?? null;
  const trail = [...baseTrail, { href: strategyRoutes.offer(offer.id), label: 'Oferta' }];
  return (
    <>
      <PageHeader
        trail={trail}
        title={content?.name ?? 'ICP sem conteúdo'}
        badges={
          <>
            <Badge variant={STATUS_BADGE[icp.status]}>{ICP_STATUS_LABELS[icp.status]}</Badge>
            {icp.current ? <Badge variant="outline">v{icp.current.version}</Badge> : null}
            {icp.isDemo ? <DemoBadge /> : null}
          </>
        }
        description={
          content?.description ||
          `Perfil de cliente ideal da oferta "${offer.current?.content.name ?? 'sem nome'}".`
        }
      />
      <StorageNotice storage={result.storage} />

      <Panel aria-labelledby="icp-status">
        <PanelHeader
          titleId="icp-status"
          title="Status"
          description="Só ICPs ativos de ofertas ativas orientam a descoberta."
        />
        {icp.status === 'draft' && activationIssues.length > 0 ? (
          <Alert tone="info" role="note" className="mb-4">
            <p className="font-medium">Para ativar, falta:</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5">
              {activationIssues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          </Alert>
        ) : null}
        <div className="flex flex-wrap items-start gap-2">
          {TRANSITIONS[icp.status].map((t) => (
            <StatusButton
              key={t.to}
              label={t.label}
              variant={t.variant}
              action={changeIcpStatusAction.bind(null, icp.id, t.to)}
            />
          ))}
        </div>
      </Panel>

      {content ? (
        <Panel aria-labelledby="icp-resumo">
          <PanelHeader
            titleId="icp-resumo"
            title="Quem entra e quem fica de fora"
            description={icp.current ? `Versão ${icp.current.version}.` : undefined}
          />
          <IcpSummary content={content} />
        </Panel>
      ) : null}

      <Panel aria-labelledby="icp-editar">
        <PanelHeader
          titleId="icp-editar"
          title="Editar filtros"
          description="Salvar cria uma nova versão. Sem mudanças, nada é salvo."
        />
        <IcpForm
          action={updateIcpAction.bind(null, icp.id)}
          initial={icpValues(content)}
          submitLabel="Salvar nova versão"
        />
      </Panel>

      <Panel aria-labelledby="icp-versoes">
        <PanelHeader titleId="icp-versoes" title="Versões do ICP" />
        <VersionHistory versions={versions} />
      </Panel>
    </>
  );
}

export default function IcpPage({ params }: Props) {
  return (
    <div className="space-y-6">
      <Suspense fallback={<Loading label="Carregando o ICP…" />}>
        <IcpDetail params={params} />
      </Suspense>
    </div>
  );
}
