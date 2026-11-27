import type { CompanyDossier } from '@prospector/application';
import {
  COMPANY_LIFECYCLE_LABELS,
  formatCnpj,
  type CompanyIdentifier,
  type CompanyIdentifierKind,
  type CompanyOrigin,
} from '@prospector/contracts';
import { Alert, Badge, DemoBadge, Panel, PanelHeader, Well } from '@prospector/ui';
import { ChevronDown } from 'lucide-react';
import type { Metadata } from 'next';
import { connection } from 'next/server';
import { Suspense, type ReactNode } from 'react';
import { CnpjLinkForm, LifecycleForm } from '@/components/companies/company-forms';
import { DecisionSummary } from '@/components/companies/decision-summary';
import { EvidenceGroups } from '@/components/companies/evidence-groups';
import { OrganizationPanel, ProductTechnologyPanel } from '@/components/companies/report-panels';
import { CompanyRelationshipPanel } from '@/components/relationship/company-panel';
import {
  BrandPanel,
  claimsWithPrefix,
  DiagnosisPanel,
  InvestigationHistoryPanel,
  InvestigationPanel,
  MarketPanel,
} from '@/components/companies/investigation-panels';
import { StatusButton } from '@/components/strategy/decision-forms';
import { Loading } from '@/components/strategy/loading';
import { PageHeader, StorageNotice, Unavailable } from '@/components/strategy/page-parts';
import { COMPANY_ORIGIN_LABELS, COMPANY_SIZE_LABELS } from '@/lib/company-labels';
import {
  COMPANY_NOTICES,
  WARNING_NOTICES,
  companyRoutes,
  visibleNotice,
  type CompanyNotice,
} from '@/lib/company-routes';
import { formatDate, formatDateTime } from '@/lib/format';
import { companyDossier, companyTitle, loadCompanies } from '@/server/companies';
import { cnpjLookupEnabled } from '@/server/env';
import { loadInvestigationPanel } from '@/server/investigations';
import { loadRelationship } from '@/server/relationship';
import { changeLifecycleAction, linkCnpjAction, refreshRegistryAction } from '../actions';

type Props = PageProps<'/empresas/[id]'>;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  return { title: await companyTitle(id, 'Empresa') };
}

const TRAIL = [
  { href: '/', label: 'Hoje' },
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
      return 'Essa empresa já estava cadastrada (mesmo CNPJ ou site). Nada foi alterado: esta é a página dela.';
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
    case COMPANY_NOTICES.investigationStarted:
      return 'Análise começou. Ela roda no computador, uma por vez, e leva alguns minutos; o resultado aparece no topo desta página.';
    case COMPANY_NOTICES.investigationResumed:
      return 'Análise retomada: as etapas já concluídas não são repetidas.';
    case COMPANY_NOTICES.investigationCancelled:
      return 'Cancelamento pedido. A etapa atual para no meio; o que já foi coletado fica guardado.';
    case COMPANY_NOTICES.siteConfirmed:
      return 'Site oficial confirmado. Atualize a análise para ler as páginas e olhar a marca.';
    case COMPANY_NOTICES.cnpjLinked:
      return 'CNPJ vinculado: os dados da Receita estão em Cadastro e evidências. Atualize a análise para ela usar porte, atividade e situação.';
    case COMPANY_NOTICES.analysisStarted:
      return 'Empresa salva com as fontes da pesquisa, e a análise começou. Leva alguns minutos; o resultado aparece no topo desta página.';
    case COMPANY_NOTICES.analysisRunning:
      return 'Esta empresa já está sendo analisada. Nenhuma análise nova foi criada.';
    case COMPANY_NOTICES.alreadyAnalyzed:
      return 'Esta empresa já tinha sido analisada, então nada foi refeito (nenhuma busca gasta). Para atualizar, use Atualizar a análise, no painel Análise.';
    case COMPANY_NOTICES.analysisQueueFull:
      return 'Empresa salva com as fontes da pesquisa, mas a análise não começou: a fila de análises está cheia. Espere algumas terminarem e use Analisar empresa, abaixo.';
    case COMPANY_NOTICES.analysisArchived:
      return 'A empresa já estava cadastrada e está arquivada, então a análise não começou. Mude a etapa para analisar.';
    case COMPANY_NOTICES.analysisUnavailable:
      return 'Empresa salva com as fontes da pesquisa, mas a análise não está disponível nesta instalação agora.';
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

/** CNPJ do cadastro ou, sem ele, o vinculado depois (lido no site ou informado por você). */
function companyCnpj(dossier: CompanyDossier): string | null {
  return dossier.company.cnpj ?? dossier.linkedCnpj?.cnpj ?? null;
}

const LINKED_ORIGIN_LABELS = {
  company_site: 'lido no site da empresa',
  user: 'informado por você',
} as const;

function identifierValue(identifier: CompanyIdentifier): string {
  return identifier.kind === 'cnpj'
    ? formatCnpj(identifier.valueNormalized)
    : identifier.valueNormalized;
}

function Registry({ dossier }: { dossier: CompanyDossier }) {
  const { company } = dossier;
  const identifiers = dossier.identifiers.filter((item) => IDENTIFIER_LABELS[item.kind]);
  const empty = <span className="text-muted-foreground">Não informado</span>;
  const linked = company.cnpj ? null : dossier.linkedCnpj;
  const editing = companyCnpj(dossier) ? (
    'Editar os outros dados do cadastro ainda não é possível nesta versão.'
  ) : (
    <>
      Sem CNPJ: informe-o em{' '}
      <a href="#receita" className="underline underline-offset-4">
        Receita Federal
      </a>{' '}
      para trazer porte, atividade e situação.
    </>
  );
  return (
    <Panel aria-labelledby="cadastro">
      <PanelHeader
        titleId="cadastro"
        title="Cadastro"
        description={
          <>
            {REGISTRY_DESCRIPTIONS[company.origin]} {editing}
          </>
        }
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
        <Field label="CNPJ">
          {company.cnpj ? (
            formatCnpj(company.cnpj)
          ) : linked ? (
            <>
              {formatCnpj(linked.cnpj)}
              <span className="block text-xs text-muted-foreground">
                {LINKED_ORIGIN_LABELS[linked.origin]}; a fonte está em Evidências
              </span>
            </>
          ) : (
            empty
          )}
        </Field>
        <Field label="Site">{company.primaryDomain ?? empty}</Field>
        <Field label="Cidade">
          {company.city ? [company.city, company.uf].filter(Boolean).join('/') : empty}
        </Field>
        <Field label="CNAE principal">{company.cnaeMain ?? empty}</Field>
        <Field label="Porte na Receita">
          {company.sizeBand ? COMPANY_SIZE_LABELS[company.sizeBand] : empty}
        </Field>
        <Field label="Entrou por">{COMPANY_ORIGIN_LABELS[company.origin]}</Field>
        <Field label="Última coleta">
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
          {companyCnpj(dossier)
            ? 'Nenhum fato registrado. Consulte a Receita para trazer os dados do registro com a fonte.'
            : 'Nenhum fato registrado. Informe o CNPJ em Receita Federal ou analise a empresa para coletar o que o site e a internet mostram, com a fonte.'}
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

/**
 * Data da última consulta à Receita: a fonte mais recente dos fatos do registro. Não usa
 * `lastInvestigatedAt`, que também muda com a investigação (ADR-0015).
 */
function registryCheckedAt(dossier: CompanyDossier): string | null {
  let latest: string | null = null;
  for (const view of dossier.claims) {
    if (!view.claim.key.startsWith('registry.')) continue;
    for (const { source } of view.evidence) {
      if (source && (latest === null || Date.parse(source.capturedAt) > Date.parse(latest))) {
        latest = source.capturedAt;
      }
    }
  }
  return latest;
}

function RegistryLookup({ dossier }: { dossier: CompanyDossier }) {
  const { company } = dossier;
  const checkedAt = registryCheckedAt(dossier);
  let body: ReactNode;
  if (company.lifecycle === 'archived') {
    body = (
      <p className="text-sm text-muted-foreground">
        Empresa arquivada não recebe novas consultas. Mude a etapa para consultar.
      </p>
    );
  } else if (!companyCnpj(dossier) && !cnpjLookupEnabled()) {
    body = (
      <p className="text-sm text-muted-foreground">
        Sem CNPJ cadastrado, e a consulta de CNPJ está desligada nesta instalação.
      </p>
    );
  } else if (!companyCnpj(dossier)) {
    body = (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Sem CNPJ cadastrado. A análise procura o CNPJ no site da empresa; se não achar, informe
          aqui. Nada é gravado se a Receita não confirmar.
        </p>
        <CnpjLinkForm action={linkCnpjAction.bind(null, company.id)} />
      </div>
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
        label={checkedAt ? 'Consultar a Receita de novo' : 'Consultar a Receita'}
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
          checkedAt
            ? `Última consulta em ${formatDate(checkedAt)}. A base aberta da Receita muda uma vez por mês; antes disso, consultar de novo costuma não trazer novidade.`
            : 'Nenhuma consulta ainda.'
        }
      />
      {body}
    </Panel>
  );
}

/** Resumo do que está guardado em "Cadastro e evidências", para quem decide abrir. */
function evidenceCountText(dossier: CompanyDossier): string {
  const total = dossier.summary.total;
  if (total === 0) return 'Nada coletado ainda.';
  return `${total} ${total === 1 ? 'informação' : 'informações'}, cada uma com a sua fonte.`;
}

/**
 * Contatos ainda não existem no Prospector (dependem de aprovação das fontes, da base legal e de
 * migração; proposta de 26/11, C.7). O painel diz isso e não oferece botão que não funciona.
 */
function ContactsPanel() {
  return (
    <Panel aria-labelledby="contatos">
      <PanelHeader
        titleId="contatos"
        title="Com quem falar"
        description="O Prospector ainda não guarda contatos de pessoas. Por enquanto, a mensagem é escrita para a empresa e você escolhe o destinatário fora do app: prefira o canal que a própria empresa publica (site, e-mail de contato) e anote de onde veio o endereço ao registrar o envio."
      />
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
  const investigation = await loadInvestigationPanel(company.id);
  const latest = investigation?.latest ?? null;
  // O diagnóstico mostrado é o da última investigação que chegou a montá-lo.
  const diagnosed = investigation?.history.find((item) => item.diagnosis !== null) ?? null;
  const query = await searchParams;
  const notice = visibleNotice(
    Object.values(COMPANY_NOTICES).find((value) => value === query.aviso),
    investigation?.active ?? false,
  );
  // Pedidos de não contato e conversa aberta, para o topo nunca sugerir abordar quem pediu para
  // parar (regra 7). Sem conseguir ler, o topo não oferece "Preparar mensagem".
  const relation = await loadRelationship((relationship, ctx) =>
    relationship.forCompany(ctx, company.id),
  );
  const contact =
    relation.kind === 'ok'
      ? {
          suppressions: relation.data.activeSuppressions,
          openOpportunityId: relation.data.open?.id ?? null,
        }
      : null;
  const archived = company.lifecycle === 'archived';
  const cnpj = companyCnpj(dossier);
  const contactBlocked = (contact?.suppressions.length ?? 0) > 0;

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
          [company.legalName, cnpj ? formatCnpj(cnpj) : null].filter(Boolean).join(' · ') ||
          undefined
        }
      />
      {notice ? (
        <Alert
          tone={WARNING_NOTICES.includes(notice) ? 'warning' : 'success'}
          role="status"
          data-aviso={notice}
        >
          {noticeText(notice, readChanged(query.mudancas))}
        </Alert>
      ) : null}
      <StorageNotice storage={result.storage} />
      <DecisionSummary
        company={company}
        diagnosed={diagnosed}
        latest={latest}
        active={investigation?.active ?? false}
        views={dossier.claims}
        available={investigation !== null}
        contact={contact}
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="min-w-0 space-y-6 lg:col-span-2">
          <DiagnosisPanel
            investigation={diagnosed}
            latest={latest}
            views={dossier.claims}
            contactBlocked={contactBlocked}
          />
          <BrandPanel company={company} views={dossier.claims} />
          <MarketPanel views={dossier.claims} />
          <ProductTechnologyPanel views={dossier.claims} analyzed={diagnosed !== null} />
          <OrganizationPanel
            views={dossier.claims}
            thesis={diagnosed?.diagnosis?.thesis ?? null}
            analyzed={diagnosed !== null}
            contactBlocked={contactBlocked}
          />
          <ContactsPanel />
          {/* Recolhido quando há análise (o relatório vem primeiro); sem análise, o cadastro e as
              evidências são o que há para ler, então já abrem. */}
          <details className="group" data-details="cadastro" open={diagnosed === null}>
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-[var(--radius-panel)] bg-surface px-5 py-4 text-sm font-medium shadow-[var(--shadow-panel)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring sm:px-6 [&::-webkit-details-marker]:hidden">
              <span>
                Cadastro e evidências
                <span className="block text-xs font-normal text-muted-foreground">
                  {evidenceCountText(dossier)}
                </span>
              </span>
              <ChevronDown
                aria-hidden="true"
                className="size-4 shrink-0 transition-transform group-open:rotate-180"
              />
            </summary>
            <div className="mt-6 space-y-6">
              <Registry dossier={dossier} />
              <Claims dossier={dossier} />
            </div>
          </details>
        </div>
        <div className="min-w-0 space-y-6">
          <CompanyRelationshipPanel companyId={company.id} archived={archived} />
          <InvestigationPanel
            company={company}
            data={investigation}
            siteCandidates={
              latest
                ? claimsWithPrefix(dossier.claims, 'digital_presence.official_site_candidate.')
                : []
            }
          />
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
          <InvestigationHistoryPanel data={investigation} />
          <RegistryLookup dossier={dossier} />
        </div>
      </div>
    </>
  );
}

export default function CompanyPage({ params, searchParams }: Props) {
  return (
    <div className="space-y-6">
      <Suspense fallback={<Loading label="Carregando a empresa…" />}>
        <Dossier params={params} searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
