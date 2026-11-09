import type { ReadinessCode } from '@prospector/contracts';
import { Badge, Button, DemoBadge, Panel, PanelHeader, Well } from '@prospector/ui';
import { ArrowUpRight, FileCheck2, MessageSquareQuote, Plus, Trophy } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { connection } from 'next/server';
import { Suspense } from 'react';
import {
  PageHeader,
  ReadinessChecklist,
  StorageNotice,
  Unavailable,
} from '@/components/strategy/page-parts';
import { STATUS_BADGE, STATUS_LABELS } from '@/lib/strategy-labels';
import { strategyRoutes } from '@/lib/strategy-routes';
import { loadStrategy } from '@/server/strategy';

export const metadata: Metadata = { title: 'Estratégia' };

const DISCOVER_CODES = [
  'offer_complete',
  'rubric',
  'scoring_model',
  'offer_active',
  'icp_active',
] as const satisfies readonly ReadinessCode[];

const LINK_CLASS =
  'group flex items-center gap-4 rounded-[var(--radius-tile)] bg-muted p-4 transition-colors hover:bg-border focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring';

async function StrategyOverview() {
  await connection();
  const result = await loadStrategy((strategy, ctx) => strategy.overview(ctx));
  if (result.kind === 'unavailable') return <Unavailable message={result.message} />;
  const { snapshot, readiness } = result.data;
  // Cases de demonstração não contam (como na prontidão).
  const realCases = snapshot.proofAssets.filter((p) => !p.archivedAt && !p.isDemo);
  const publicCases = realCases.filter((p) => p.publicOk).length;
  const evaluated = snapshot.offers.find((o) => o.id === readiness.discover.offerId);
  const evaluatedName = evaluated?.current?.content.name ?? null;
  const related = [
    {
      href: strategyRoutes.voice,
      icon: MessageSquareQuote,
      title: 'Voz da agência',
      detail: snapshot.voiceGuide
        ? `Versão ${snapshot.voiceGuide.version} salva.`
        : 'Ainda não descrita.',
    },
    {
      href: strategyRoutes.cases,
      icon: Trophy,
      title: 'Cases',
      detail: `${realCases.length === 1 ? '1 case' : `${realCases.length} cases`}, ${publicCases === 1 ? '1 citável' : `${publicCases} citáveis`}.`,
    },
    {
      href: strategyRoutes.compliance,
      icon: FileCheck2,
      title: 'Conformidade: LIA e opt-out',
      detail: readiness.approach.items.find((i) => i.code === 'lia_approved')?.detail ?? '',
    },
  ];

  return (
    <div className="space-y-4">
      <StorageNotice storage={result.storage} />
      <Panel aria-labelledby="prontidao">
        <PanelHeader
          titleId="prontidao"
          title="Prontidão"
          description="O que falta para descobrir empresas e para abordar pessoas. Dados de demonstração e itens arquivados não contam."
        />
        <div className="grid gap-8 lg:grid-cols-2">
          <ReadinessChecklist
            gate={readiness.discover}
            title="Para descobrir empresas"
            titleId="prontidao-descobrir"
            readyText="Oferta ativa e completa, com rubrica, modelo de score e ICP ativo."
            blockedText="A descoberta de empresas só roda com uma oferta ativa e completa e um ICP ativo."
            offerName={evaluatedName}
          />
          <ReadinessChecklist
            gate={readiness.approach}
            title="Para abordar pessoas"
            titleId="prontidao-abordar"
            readyText="Estratégia completa, voz da agência, opt-out e LIA aprovada em vigor."
            blockedText="Abordar exige tudo o que a descoberta exige, mais voz da agência, opt-out e LIA aprovada em vigor."
            summarize={{ codes: DISCOVER_CODES, label: 'Tudo de "Para descobrir empresas"' }}
          />
        </div>
      </Panel>

      <Panel aria-labelledby="ofertas">
        <PanelHeader
          titleId="ofertas"
          title="Ofertas"
          description="Cada oferta tem a própria rubrica, modelo de score e ICPs."
          actions={
            <Button asChild size="sm">
              <Link href={strategyRoutes.newOffer}>
                <Plus aria-hidden="true" className="size-4" />
                Nova oferta
              </Link>
            </Button>
          }
        />
        {snapshot.offers.length === 0 ? (
          <Well className="py-10 text-center text-sm text-muted-foreground">
            Nenhuma oferta ainda. Comece descrevendo o que a agência vende, para quem e por quanto.
          </Well>
        ) : (
          <ul className="divide-y">
            {snapshot.offers.map((offer) => (
              <li key={offer.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <span className="flex flex-wrap items-center gap-2">
                  <Link
                    href={strategyRoutes.offer(offer.id)}
                    className="font-medium underline-offset-4 hover:underline"
                  >
                    {offer.current?.content.name ?? 'Oferta sem conteúdo'}
                  </Link>
                  {offer.isDemo ? <DemoBadge /> : null}
                </span>
                <span className="flex items-center gap-2 text-sm text-muted-foreground">
                  {offer.current ? <span>v{offer.current.version}</span> : null}
                  <Badge variant={STATUS_BADGE[offer.status]}>{STATUS_LABELS[offer.status]}</Badge>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <div className="grid gap-4 md:grid-cols-3">
        {related.map((item) => {
          const Icon = item.icon;
          return (
            <Link key={item.href} href={item.href} className={LINK_CLASS}>
              <span
                aria-hidden="true"
                className="grid size-10 shrink-0 place-items-center rounded-full bg-surface"
              >
                <Icon className="size-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-medium">{item.title}</span>
                <span className="block text-sm text-muted-foreground">{item.detail}</span>
              </span>
              <ArrowUpRight aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
            </Link>
          );
        })}
      </div>
    </div>
  );
}

export default function StrategyPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        trail={[{ href: '/configuracoes', label: 'Configuração' }]}
        title="Estratégia"
        description="Ofertas, rubricas, modelo de score, ICP, voz da agência e cases. Tudo é versionado: editar cria uma nova versão, e a anterior continua valendo para as avaliações que a usaram."
      />
      <Suspense
        fallback={
          <Well role="status" className="py-10 text-center text-sm text-muted-foreground">
            Carregando a estratégia…
          </Well>
        }
      >
        <StrategyOverview />
      </Suspense>
    </div>
  );
}
