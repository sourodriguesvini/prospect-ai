import type { CompanyDossier } from '@prospector/application';
import {
  COMPANY_LIFECYCLE_LABELS,
  formatCnpj,
  type CompanyIdentifier,
  type CompanyIdentifierKind,
  type CompanyOrigin,
} from '@prospector/contracts';
import { Alert, Badge, DemoBadge, Panel, PanelHeader, Well } from '@prospector/ui';
import type { Metadata } from 'next';
import { connection } from 'next/server';
import { Suspense, type ReactNode } from 'react';
import { LifecycleForm } from '@/components/companies/company-forms';
import { EvidenceGroups } from '@/components/companies/evidence-groups';
import { StatusButton } from '@/components/strategy/decision-forms';
import { Loading } from '@/components/strategy/loading';
import { PageHeader, StorageNotice, Unavailable } from '@/components/strategy/page-parts';
import { COMPANY_ORIGIN_LABELS, COMPANY_SIZE_LABELS } from '@/lib/company-labels';
import { COMPANY_NOTICES, companyRoutes, type CompanyNotice } from '@/lib/company-routes';
import { formatDate, formatDateTime } from '@/lib/format';
import { companyDossier, companyTitle, loadCompanies } from '@/server/companies';
import { cnpjLookupEnabled } from '@/server/env';
import { changeLifecycleAction, refreshRegistryAction } from '../actions';

type Props = PageProps<'/empresas/[id]'>;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  return { title: await companyTitle(id, 'Empresa') };
}

const TRAIL = [
  { href: '/', label: 'Início' },
  { href: companyRoutes.list, label: 'Empresas' },
];

/** A raiz do CNPJ é chave interna de deduplicação; não aparece na tela. */
const IDENTIFIER_LABELS: Partial<Record<CompanyIdentifierKind, string>> = {
  cnpj: 'CNPJ',
  domain: 'Site',
  place_id: 'Google Maps',
  instagram: 'Instagram',
  phone: 'Telefone',
  linkedin_url: 'LinkedIn',
};

const REGISTRY_DESCRIPTIONS: Record<CompanyOrigin, string> = {
  cnpj_lookup:
    'Dados da última consulta à Receita, para a lista e a busca. O que sustenta cada um está em Evidências.',
  manual: 'Dados como você informou, sem verificação.',
  discovery: 'Dados trazidos pela descoberta. O que sustenta cada um está em Evidências.',
};

function noticeText(notice: CompanyNotice, changed: number | null): string {
  switch (notice) {
    case COMPANY_NOTICES.created:
      return 'Empresa cadastrada.';
    case COMPANY_NOTICES.duplicate:
      return 'Essa empresa já estava cadastrada (mesmo CNPJ ou site). Nada foi alterado: este é o dossiê dela.';
    case COMPANY_NOTICES.unchanged:
      return 'Consulta à Receita feita: nada mudou desde a última consulta, então nada foi gravado.';
    case COMPANY_NOTICES.refreshed:
      if (changed === null) {
        return 'Consulta à Receita feita. Os fatos novos substituíram os anteriores, que ficam no histórico.';
      }
      if (changed === 0) {
        return 'Consulta à Receita feita: nenhum dado mudou, só a data da base. Os fatos foram reconfirmados com a fonte nova.';
      }
      return `Consulta à Receita feita: ${changed === 1 ? '1 dado mudou' : `${changed} dados mudaram`}. A versão anterior de cada um fica no histórico.`;
  }
}

function readChanged(value: string | string[] | undefined): number | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw || !/^\d{1,3}$/.test(raw)) return null;
  return Number(raw);
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0 space-y-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm [overflow-wrap:anywhere]">{children}</dd>
    </div>
  );
}

function identifierValue(identifier: CompanyIdentifier): string {
  return identifier.kind === 'cnpj'
    ? formatCnpj(identifier.valueNormalized)
    : identifier.valueNormalized;
}

function Registry({ dossier }: { dossier: CompanyDossier }) {
  const { company } = dossier;
  const identifiers = dossier.identifiers.filter((item) => IDENTIFIER_LABELS[item.kind]);
  const empty = <span className="text-muted-foreground">Não informado</span>;
  return (
    <Panel aria-labelledby="cadastro">
      <PanelHeader
        titleId="cadastro"
        title="Cadastro"
        description={`${REGISTRY_DESCRIPTIONS[company.origin]} Editar o cadastro ainda não é possível nesta versão.`}
      />
      {dossier.individual ? (
        <Alert tone="warning" className="mb-5">
          Empresa individual (MEI ou de uma pessoa só): a razão social é o nome da pessoa titular,
          um dado pessoal. Ele fica só neste cadastro, fora das evidências; use-o só para
          identificar a empresa.
        </Alert>
      ) : null}
      <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Razão social">{company.legalName ?? empty}</Field>
        <Field label="CNPJ">{company.cnpj ? formatCnpj(company.cnpj) : empty}</Field>
        <Field label="Site">{company.primaryDomain ?? empty}</Field>
        <Field label="Cidade">
          {company.city ? [company.city, company.uf].filter(Boolean).join('/') : empty}
        </Field>
        <Field label="CNAE principal">{company.cnaeMain ?? empty}</Field>
        <Field label="Porte na Receita">
          {company.sizeBand ? COMPANY_SIZE_LABELS[company.sizeBand] : empty}
        </Field>
        <Field label="Entrou por">{COMPANY_ORIGIN_LABELS[company.origin]}</Field>
        <Field label="Última consulta">
          {company.lastInvestigatedAt ? formatDateTime(company.lastInvestigatedAt) : 'Nenhuma'}
        </Field>
        <Field label="Cadastrada em">{formatDateTime(company.createdAt)}</Field>
      </dl>
      {identifiers.length > 0 ? (
        <div className="mt-5 space-y-2">
          <h3 className="text-sm font-medium">Identificadores</h3>
          <ul className="flex flex-wrap gap-2">
            {identifiers.map((identifier) => (
              <li key={identifier.id} className="max-w-full">
                <Badge
                  variant={identifier.verified ? 'success' : 'outline'}
                  className="max-w-full [overflow-wrap:anywhere]"
                >
                  {IDENTIFIER_LABELS[identifier.kind]}: {identifierValue(identifier)}
                  {identifier.verified ? ' · conferido' : ' · não conferido'}
                </Badge>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Panel>
  );
}

function Claims({ dossier }: { dossier: CompanyDossier }) {
  const { claims, summary, historyCount } = dossier;
  const counts = [
    `${summary.facts} ${summary.facts === 1 ? 'fato' : 'fatos'}`,
    `${summary.inferences} ${summary.inferences === 1 ? 'inferência' : 'inferências'}`,
    `${summary.hypotheses} ${summary.hypotheses === 1 ? 'hipótese' : 'hipóteses'}`,
  ];
  if (summary.stale > 0) counts.push(`${summary.stale} vencido${summary.stale === 1 ? '' : 's'}`);
  return (
    <Panel aria-labelledby="evidencias">
      <PanelHeader
        titleId="evidencias"
        title="Evidências"
        description={
          summary.total === 0
            ? 'Nada coletado ainda.'
            : `${counts.join(' · ')}. A confiança é calculada pelo sistema a partir da fonte, nunca informada pela IA.`
        }
      />
      {claims.length === 0 ? (
        <Well className="py-8 text-center text-sm text-muted-foreground">
          Nenhum fato registrado. Com o CNPJ cadastrado, consulte a Receita para trazer os dados do
          registro com a fonte.
        </Well>
      ) : (
        <EvidenceGroups views={claims} />
      )}
      {historyCount > 0 ? (
        <p className="mt-4 text-xs text-muted-foreground">
          {historyCount === 1
            ? '1 versão anterior guardada no histórico.'
            : `${historyCount} versões anteriores guardadas no histórico.`}{' '}
          Cada consulta nova substitui a versão anterior do mesmo dado.
        </p>
      ) : null}
    </Panel>
  );
}

function RegistryLookup({ dossier }: { dossier: CompanyDossier }) {
  const { company } = dossier;
  let body: ReactNode;
  if (company.lifecycle === 'archived') {
    body = (
      <p className="text-sm text-muted-foreground">
        Empresa arquivada não recebe novas consultas. Mude a etapa para consultar.
      </p>
    );
  } else if (!company.cnpj) {
    body = (
      <p className="text-sm text-muted-foreground">
        Sem CNPJ cadastrado, não há o que consultar na Receita. Editar o cadastro ainda não é
        possível nesta versão.
      </p>
    );
  } else if (!cnpjLookupEnabled()) {
    body = (
      <p className="text-sm text-muted-foreground">
        A consulta de CNPJ está desligada nesta instalação.
      </p>
    );
  } else {
    body = (
      <StatusButton
        action={refreshRegistryAction.bind(null, company.id)}
        label={company.lastInvestigatedAt ? 'Consultar a Receita de novo' : 'Consultar a Receita'}
        pendingLabel="Consultando…"
      />
    );
  }
  return (
    <Panel aria-labelledby="receita">
      <PanelHeader
        titleId="receita"
        title="Receita Federal"
        description={
          company.lastInvestigatedAt
            ? `Última consulta em ${formatDate(company.lastInvestigatedAt)}. A base aberta da Receita muda uma vez por mês; antes disso, consultar de novo costuma não trazer novidade.`
            : 'Nenhuma consulta ainda.'
        }
      />
      {body}
    </Panel>
  );
}

async function Dossier({ params, searchParams }: Pick<Props, 'params' | 'searchParams'>) {
  await connection();
  const { id } = await params;
  const result = await loadCompanies((companies) => companyDossier(companies, id));
  if (result.kind === 'unavailable') {
    return (
      <>
        <PageHeader trail={TRAIL} title="Empresa" />
        <Unavailable message={result.message} />
      </>
    );
  }
  const dossier = result.data;
  const { company } = dossier;
  const query = await searchParams;
  const notice = Object.values(COMPANY_NOTICES).find((value) => value === query.aviso);
  const archived = company.lifecycle === 'archived';

  return (
    <>
      <PageHeader
        trail={TRAIL}
        title={company.displayName}
        badges={
          <>
            <Badge variant={archived ? 'outline' : 'neutral'}>
              {COMPANY_LIFECYCLE_LABELS[company.lifecycle]}
            </Badge>
            {dossier.individual ? (
              <Badge variant="warning">Empresa individual: contém dado pessoal</Badge>
            ) : null}
            {company.isDemo ? <DemoBadge /> : null}
          </>
        }
        description={
          [company.legalName, company.cnpj ? formatCnpj(company.cnpj) : null]
            .filter(Boolean)
            .join(' · ') || undefined
        }
      />
      {notice ? (
        <Alert tone="success" role="status" data-aviso={notice}>
          {noticeText(notice, readChanged(query.mudancas))}
        </Alert>
      ) : null}
      <StorageNotice storage={result.storage} />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="min-w-0 space-y-6 lg:col-span-2">
          <Registry dossier={dossier} />
          <Claims dossier={dossier} />
        </div>
        <div className="order-first min-w-0 space-y-6 lg:order-none">
          <Panel aria-labelledby="etapa">
            <PanelHeader
              titleId="etapa"
              title="Etapa"
              description="Em que ponto do funil a empresa está. Só muda quando você decide."
            />
            <LifecycleForm
              action={changeLifecycleAction.bind(null, company.id)}
              current={company.lifecycle}
            />
          </Panel>
          <RegistryLookup dossier={dossier} />
        </div>
      </div>
    </>
  );
}

export default function CompanyPage({ params, searchParams }: Props) {
  return (
    <div className="space-y-6">
      <Suspense fallback={<Loading label="Carregando o dossiê…" />}>
        <Dossier params={params} searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
