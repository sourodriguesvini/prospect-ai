import {
  PROSPECT_SOURCE_RELATION_LABELS,
  PROSPECT_STATUS_LABELS,
  SIGNAL_RELEVANCE_LABELS,
  TRIAGE_DIMENSION_LABELS,
  TriageDimension,
  formatCnpj,
} from '@prospector/contracts';
import { Alert, Badge, Button, DemoBadge, Panel, PanelHeader, Well } from '@prospector/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { Suspense } from 'react';
import { ActionAnnouncer } from '@/components/discovery/announcers';
import { ActionButton, DismissForm } from '@/components/discovery/discovery-forms';
import {
  PriorityBadge,
  ProspectFacts,
  ReasonSources,
  SignalItem,
  SourceLink,
  analysisConfidenceText,
} from '@/components/discovery/discovery-parts';
import { Loading } from '@/components/strategy/loading';
import { PageHeader, StorageNotice, Unavailable } from '@/components/strategy/page-parts';
import { companyRoutes } from '@/lib/company-routes';
import { discoveryRoutes, isDiscoveryId } from '@/lib/discovery-routes';
import { formatDate, formatDateTime } from '@/lib/format';
import { discoveryProspectDetail, discoveryTitle, loadDiscovery } from '@/server/discovery';
import { decideProspectAction, investigateProspectAction } from '../../actions';

type Props = PageProps<'/descoberta/empresas/[id]'>;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  return {
    title: await discoveryTitle(
      async (discovery) => (await discoveryProspectDetail(discovery, id)).prospect.displayName,
      'Empresa encontrada',
    ),
  };
}

const TRAIL = [
  { href: '/', label: 'Hoje' },
  { href: discoveryRoutes.home, label: 'Descobrir' },
  { href: discoveryRoutes.prospects, label: 'Empresas encontradas' },
];

async function ProspectDetailView({ id }: { id: string }) {
  await connection();
  const result = await loadDiscovery((discovery) => discoveryProspectDetail(discovery, id));
  if (result.kind === 'unavailable') {
    return (
      <>
        <PageHeader trail={TRAIL} title="Empresa encontrada" />
        <Unavailable message={result.message} />
      </>
    );
  }
  const { prospect, sources, signals, company } = result.data;
  const assessment = prospect.assessment;
  const sourceById = Object.fromEntries(sources.map((source) => [source.id, source]));
  const name = prospect.displayName;

  return (
    <>
      <PageHeader
        trail={TRAIL}
        title={prospect.displayName}
        badges={
          <>
            {prospect.isDemo ? <DemoBadge /> : null}
            <PriorityBadge priority={prospect.priority} />
            {prospect.status !== 'new' ? (
              <Badge variant="outline">{PROSPECT_STATUS_LABELS[prospect.status]}</Badge>
            ) : null}
          </>
        }
        description={`Encontrada em ${formatDate(prospect.firstSeenAt)}; vista pela última vez em ${formatDate(prospect.lastSeenAt)}.`}
      />
      <StorageNotice storage={result.storage} />
      {prospect.status === 'dismissed' && prospect.dismissedReason ? (
        <Alert tone="warning" role="note">
          Ignorada: {prospect.dismissedReason}
        </Alert>
      ) : null}

      <Panel aria-labelledby="proximo-passo">
        <PanelHeader
          title="Próximo passo"
          titleId="proximo-passo"
          description="Analisar empresa leva a empresa para Empresas com as fontes e os sinais como evidências e começa a análise (site, marca, concorrentes). Nada é enviado a ninguém."
        />
        {company ? (
          <p className="text-sm">
            Em Empresas como{' '}
            <Link
              href={companyRoutes.company(company.id)}
              className="font-medium underline underline-offset-4"
            >
              {company.displayName}
            </Link>
            .
          </p>
        ) : null}
        <ActionAnnouncer listTitleId="proximo-passo">
          <div className="mt-3 flex flex-wrap items-start gap-2">
            {prospect.status === 'dismissed' ? (
              <ActionButton
                action={decideProspectAction.bind(null, prospect.id, 'new')}
                pendingLabel="Restaurando…"
                success={{ message: `${name} voltou para a lista.`, focus: 'next' }}
              >
                Voltar para a lista
              </ActionButton>
            ) : (
              <>
                <ActionButton
                  action={investigateProspectAction.bind(null, prospect.id)}
                  variant="primary"
                  pendingLabel="Começando a análise…"
                >
                  {prospect.status === 'investigating'
                    ? 'Atualizar as evidências em Empresas'
                    : 'Analisar empresa'}
                </ActionButton>
                {prospect.status !== 'investigating' ? (
                  <ActionButton
                    action={decideProspectAction.bind(null, prospect.id, 'saved')}
                    pendingLabel="Salvando…"
                    done={prospect.status === 'saved' ? 'Salva' : undefined}
                    success={{ message: `${name} salva.`, focus: 'self' }}
                  >
                    Salvar para depois
                  </ActionButton>
                ) : null}
                <DismissForm
                  action={decideProspectAction.bind(null, prospect.id, 'dismissed')}
                  prospectId={prospect.id}
                  name={name}
                />
              </>
            )}
          </div>
        </ActionAnnouncer>
      </Panel>

      <Panel aria-labelledby="dados-basicos">
        <PanelHeader title="Dados básicos" titleId="dados-basicos" />
        <div className="space-y-2">
          <ProspectFacts prospect={prospect} />
          {prospect.description ? (
            <div className="space-y-0.5">
              <p className="text-xs text-muted-foreground">Resumo da IA local (não é evidência)</p>
              <p className="text-sm">{prospect.description}</p>
            </div>
          ) : null}
          <p className="text-sm text-muted-foreground">
            {prospect.cnpj
              ? `CNPJ ${formatCnpj(prospect.cnpj)}, encontrado no site oficial (dígitos conferidos).`
              : 'CNPJ não encontrado no site oficial.'}
            {prospect.lastVerifiedAt
              ? ` Site conferido em ${formatDateTime(prospect.lastVerifiedAt)}.`
              : ''}
          </p>
        </div>
      </Panel>

      <Panel aria-labelledby="triagem">
        <PanelHeader
          title="Triagem"
          titleId="triagem"
          description="Pontos por regras com as fontes encontradas (0 a 100). Não é probabilidade de fechar negócio."
        />
        {assessment ? (
          <div className="space-y-4">
            <p className="flex flex-wrap items-center gap-2 text-sm">
              <PriorityBadge priority={prospect.priority} />
              {prospect.priorityScore !== null ? (
                <span>{prospect.priorityScore} pontos</span>
              ) : null}
              <span className="text-muted-foreground">
                · {analysisConfidenceText(prospect.confidence)} · cobertura de{' '}
                {Math.round(assessment.coverage * 100)}% das dimensões
              </span>
            </p>
            <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {TriageDimension.options.map((dimension) => (
                <div key={dimension} className="space-y-0.5">
                  <dt className="text-xs text-muted-foreground">
                    {TRIAGE_DIMENSION_LABELS[dimension]}
                  </dt>
                  <dd className="text-sm">
                    {assessment.dimensions[dimension] === null ||
                    assessment.dimensions[dimension] === undefined
                      ? 'Sem evidência'
                      : `${assessment.dimensions[dimension]} de 100`}
                  </dd>
                </div>
              ))}
            </dl>
            {assessment.gates.length ? (
              <Alert tone="warning" role="note">
                {assessment.gates.join(' ')}
              </Alert>
            ) : null}
            {assessment.reasons.length ? (
              <div className="space-y-1">
                <h3 className="text-sm font-medium">Motivos</h3>
                <ul className="list-disc space-y-1 pl-5 text-sm">
                  {assessment.reasons.map((reason, index) => (
                    <li key={index}>
                      {reason.text}
                      <ReasonSources
                        sourceIds={reason.sourceIds}
                        sources={sourceById}
                        moreHint="veja Fontes, abaixo"
                      />
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {assessment.missing.length ? (
              <div className="space-y-1">
                <h3 className="text-sm font-medium">O que falta saber</h3>
                <ul className="list-disc space-y-1 pl-5 text-sm">
                  {assessment.missing.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Triagem ainda não feita.</p>
        )}
      </Panel>

      <Panel aria-labelledby="sinais">
        <PanelHeader
          title="Sinais comerciais"
          titleId="sinais"
          description="Cada sinal tem o trecho literal da fonte, conferido no servidor. Hipótese = o texto sugere, mas não afirma."
        />
        {signals.length === 0 ? (
          <Well className="py-6 text-center text-sm text-muted-foreground">
            Nenhum sinal comercial nas fontes encontradas.
          </Well>
        ) : (
          <ul className="space-y-6">
            {signals.map((signal) => (
              <SignalItem
                key={signal.id}
                signal={signal}
                source={sourceById[signal.sourceId] ?? null}
                extra={
                  <p className="text-xs text-muted-foreground">
                    {SIGNAL_RELEVANCE_LABELS[signal.relevance]} · confiança no sinal:{' '}
                    {Math.round(signal.confidence * 100)}%
                  </p>
                }
              />
            ))}
          </ul>
        )}
      </Panel>

      <Panel aria-labelledby="fontes">
        <PanelHeader
          title="Fontes"
          titleId="fontes"
          description="Trechos curtos guardados por tempo limitado; o link leva à página original."
        />
        {sources.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma fonte guardada.</p>
        ) : (
          <ul className="divide-y">
            {sources.map((source) => (
              <li key={source.id} className="space-y-1 py-3">
                <p className="flex flex-wrap items-center gap-2 text-sm">
                  <Badge variant="outline">
                    {PROSPECT_SOURCE_RELATION_LABELS[source.relation]}
                  </Badge>
                  <SourceLink url={source.url} label={source.title ?? source.host} />
                </p>
                {source.snippet ? (
                  <p className="text-sm text-muted-foreground">{source.snippet}</p>
                ) : null}
                <p className="text-xs text-muted-foreground">
                  Coletada em {formatDateTime(source.capturedAt)}
                  {source.publishedAt ? ` · publicada em ${formatDate(source.publishedAt)}` : ''}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <p className="text-sm">
        <Button asChild variant="link">
          <Link href={discoveryRoutes.run(prospect.lastRunId)}>
            Ver a pesquisa que a encontrou por último
          </Link>
        </Button>
      </p>
    </>
  );
}

export default async function ProspectPage({ params }: Props) {
  const { id } = await params;
  if (!isDiscoveryId(id)) notFound();
  return (
    <div className="space-y-6">
      <Suspense fallback={<Loading label="Carregando a empresa…" />}>
        <ProspectDetailView id={id} />
      </Suspense>
    </div>
  );
}
