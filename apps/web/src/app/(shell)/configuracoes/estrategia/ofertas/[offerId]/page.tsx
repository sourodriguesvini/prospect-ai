import { SCORE_DIMENSIONS, type EntityStatus } from '@prospector/contracts';
import { Alert, Badge, Button, DemoBadge, Panel, PanelHeader, Well } from '@prospector/ui';
import { Pencil, Plus } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { connection } from 'next/server';
import { Suspense } from 'react';
import { StatusButton } from '@/components/strategy/decision-forms';
import { Loading } from '@/components/strategy/loading';
import {
  PageHeader,
  StorageNotice,
  TermList,
  Unavailable,
  VersionHistory,
} from '@/components/strategy/page-parts';
import { formatPriceRange } from '@/lib/format';
import {
  ICP_STATUS_LABELS,
  SCORE_DIMENSION_LABELS,
  STATUS_BADGE,
  STATUS_LABELS,
  THRESHOLD_LABELS,
} from '@/lib/strategy-labels';
import { strategyRoutes } from '@/lib/strategy-routes';
import { loadStrategy } from '@/server/strategy';
import { changeOfferStatusAction } from '../../actions';

export const metadata: Metadata = { title: 'Oferta' };

type Params = PageProps<'/configuracoes/estrategia/ofertas/[offerId]'>['params'];

const TRANSITIONS: Record<
  EntityStatus,
  readonly { to: EntityStatus; label: string; variant: 'primary' | 'secondary' | 'destructive' }[]
> = {
  draft: [
    { to: 'active', label: 'Ativar oferta', variant: 'primary' },
    { to: 'archived', label: 'Arquivar', variant: 'secondary' },
  ],
  active: [
    { to: 'draft', label: 'Voltar para rascunho', variant: 'secondary' },
    { to: 'archived', label: 'Arquivar', variant: 'secondary' },
  ],
  archived: [{ to: 'draft', label: 'Reabrir como rascunho', variant: 'secondary' }],
};

const TRAIL = [
  { href: '/configuracoes', label: 'Configuração' },
  { href: strategyRoutes.overview, label: 'Estratégia' },
];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <h3 className="text-sm font-semibold">{title}</h3>
      {children}
    </div>
  );
}

async function OfferDetail({ params }: { params: Params }) {
  await connection();
  const { offerId } = await params;
  const result = await loadStrategy((strategy, ctx) => strategy.offerDetail(ctx, offerId));
  if (result.kind === 'unavailable') {
    return (
      <>
        <PageHeader trail={TRAIL} title="Oferta" />
        <Unavailable message={result.message} />
      </>
    );
  }
  const { offer, versions, rubricVersions, scoringModelVersions, icps, activationIssues } =
    result.data;
  const content = offer.current?.content ?? null;
  const rubric = rubricVersions[0] ?? null;
  const scoring = scoringModelVersions[0] ?? null;
  const price = content ? formatPriceRange(content.priceMinCents, content.priceMaxCents) : null;

  return (
    <>
      <PageHeader
        trail={TRAIL}
        title={content?.name ?? 'Oferta sem conteúdo'}
        badges={
          <>
            <Badge variant={STATUS_BADGE[offer.status]}>{STATUS_LABELS[offer.status]}</Badge>
            {offer.current ? <Badge variant="outline">v{offer.current.version}</Badge> : null}
            {offer.isDemo ? <DemoBadge /> : null}
          </>
        }
        description={content?.description || undefined}
        actions={
          <Button asChild variant="secondary">
            <Link href={strategyRoutes.editOffer(offer.id)}>
              <Pencil aria-hidden="true" className="size-4" />
              Editar oferta
            </Link>
          </Button>
        }
      />
      <StorageNotice storage={result.storage} />

      <Panel aria-labelledby="oferta-status">
        <PanelHeader
          titleId="oferta-status"
          title="Status"
          description="Só ofertas ativas entram na descoberta e na prontidão."
        />
        {offer.status === 'draft' && activationIssues.length > 0 ? (
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
          {TRANSITIONS[offer.status].map((t) => (
            <StatusButton
              key={t.to}
              label={t.label}
              variant={t.variant}
              action={changeOfferStatusAction.bind(null, offer.id, t.to)}
            />
          ))}
        </div>
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel aria-labelledby="oferta-conteudo">
          <PanelHeader
            titleId="oferta-conteudo"
            title="Conteúdo"
            description={offer.current ? `Versão ${offer.current.version}.` : undefined}
          />
          {content ? (
            <div className="space-y-4">
              <Section title="Problemas que resolve">
                <TermList items={content.problems} />
              </Section>
              <Section title="Sinais de necessidade">
                <TermList items={content.needSignals} />
              </Section>
              <Section title="Desqualificadores">
                <TermList items={content.disqualifiers} />
              </Section>
              <Section title="Entregáveis">
                <TermList items={content.deliverables} />
              </Section>
              <Section title="Faixa de investimento">
                <p className="text-sm">
                  {price ?? <span className="text-muted-foreground">Não informada.</span>}
                </p>
              </Section>
            </div>
          ) : (
            <Well className="text-sm text-muted-foreground">Sem conteúdo.</Well>
          )}
        </Panel>

        <div className="space-y-4">
          <Panel aria-labelledby="oferta-rubrica">
            <PanelHeader
              titleId="oferta-rubrica"
              title="Rubrica de auditoria visual"
              description={
                rubric ? `Versão ${rubric.version}, escala de 1 a 5.` : 'Escala de 1 a 5.'
              }
              actions={
                <Button asChild size="sm" variant={rubric ? 'secondary' : 'primary'}>
                  <Link href={strategyRoutes.rubric(offer.id)}>
                    {rubric ? 'Editar rubrica' : 'Criar rubrica'}
                  </Link>
                </Button>
              }
            />
            {rubric ? (
              <ul className="divide-y text-sm">
                {rubric.content.criteria.map((c) => (
                  <li key={c.key} className="flex justify-between gap-3 py-2">
                    <span>{c.label}</span>
                    <span className="text-muted-foreground">peso {c.weight}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <Well className="text-sm text-muted-foreground">
                Ainda sem rubrica. Há um rascunho sugerido para branding para você revisar.
              </Well>
            )}
          </Panel>

          <Panel aria-labelledby="oferta-score">
            <PanelHeader
              titleId="oferta-score"
              title="Modelo de score"
              description={scoring ? `Versão ${scoring.version}.` : undefined}
              actions={
                <Button asChild size="sm" variant={scoring ? 'secondary' : 'primary'}>
                  <Link href={strategyRoutes.scoring(offer.id)}>
                    {scoring ? 'Editar modelo' : 'Criar modelo'}
                  </Link>
                </Button>
              }
            />
            {scoring ? (
              <div className="space-y-4 text-sm">
                <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-3">
                  {SCORE_DIMENSIONS.map((d) => (
                    <div key={d}>
                      <dt className="text-muted-foreground">{SCORE_DIMENSION_LABELS[d].label}</dt>
                      <dd className="font-medium">{scoring.content.weights[d]}</dd>
                    </div>
                  ))}
                </dl>
                <dl className="space-y-1">
                  {(Object.keys(THRESHOLD_LABELS) as (keyof typeof THRESHOLD_LABELS)[]).map((k) => (
                    <div key={k} className="flex justify-between gap-3">
                      <dt className="text-muted-foreground">{THRESHOLD_LABELS[k].label}</dt>
                      <dd className="font-medium">{scoring.content.thresholds[k]}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            ) : (
              <Well className="text-sm text-muted-foreground">
                Ainda sem modelo. Há um rascunho sugerido (pesos de docs/08) para você revisar.
              </Well>
            )}
          </Panel>
        </div>
      </div>

      <Panel aria-labelledby="oferta-icps">
        <PanelHeader
          titleId="oferta-icps"
          title="Perfis de cliente ideal (ICP)"
          description="Quem a descoberta deve buscar para esta oferta, e quem fica de fora."
          actions={
            <Button asChild size="sm">
              <Link href={strategyRoutes.newIcp(offer.id)}>
                <Plus aria-hidden="true" className="size-4" />
                Novo ICP
              </Link>
            </Button>
          }
        />
        {icps.length === 0 ? (
          <Well className="py-6 text-center text-sm text-muted-foreground">Nenhum ICP ainda.</Well>
        ) : (
          <ul className="divide-y">
            {icps.map((icp) => (
              <li key={icp.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <span className="flex items-center gap-2">
                  <Link
                    href={strategyRoutes.icp(icp.id)}
                    className="font-medium underline-offset-4 hover:underline"
                  >
                    {icp.current?.content.name ?? 'ICP sem conteúdo'}
                  </Link>
                  {icp.isDemo ? <DemoBadge /> : null}
                </span>
                <span className="flex items-center gap-2 text-sm text-muted-foreground">
                  {icp.current ? <span>v{icp.current.version}</span> : null}
                  <Badge variant={STATUS_BADGE[icp.status]}>{ICP_STATUS_LABELS[icp.status]}</Badge>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel aria-labelledby="oferta-historico">
        <PanelHeader
          titleId="oferta-historico"
          title="Histórico da oferta"
          description="Versões salvas nunca mudam; avaliações registram a versão que usaram."
        />
        <VersionHistory versions={versions} />
      </Panel>
    </>
  );
}

export default function OfferPage({
  params,
}: PageProps<'/configuracoes/estrategia/ofertas/[offerId]'>) {
  return (
    <div className="space-y-6">
      <Suspense fallback={<Loading label="Carregando a oferta…" />}>
        <OfferDetail params={params} />
      </Suspense>
    </div>
  );
}
