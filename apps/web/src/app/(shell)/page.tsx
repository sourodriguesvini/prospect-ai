import type { TodayOverview, TodaySection as TodaySectionKey } from '@prospector/application';
import { MESSAGE_CHANNEL_LABELS, PRIORITY_BAND_LABELS } from '@prospector/contracts';
import { Alert, Button, Panel, PanelHeader, Well } from '@prospector/ui';
import { Plus } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { connection } from 'next/server';
import { Suspense, type ReactNode } from 'react';
import { investigateProspectAction } from '@/app/(shell)/descoberta/actions';
import { ActionButton } from '@/components/discovery/discovery-forms';
import { RowLink, TodayRow, TodaySection } from '@/components/today/today-parts';
import { companyRoutes } from '@/lib/company-routes';
import { DATABASE_STATUS_VIEW } from '@/lib/database-status';
import { RECOMMENDATION_SHORT } from '@/lib/decision';
import { discoveryRoutes } from '@/lib/discovery-routes';
import { formatCents, formatDate, formatDateTime } from '@/lib/format';
import { greetingFor } from '@/lib/greeting';
import { relationshipRoutes } from '@/lib/relationship-routes';
import { getServices } from '@/server/container';
import { loadToday } from '@/server/today';

export const metadata: Metadata = { title: 'Hoje' };

/**
 * Hoje (proposta de 26/11, Frente 1): central de trabalho comercial. Mostra só o que pede ação,
 * na ordem pedida pelo usuário — empresas prontas para abordar, respostas, mensagens, follow-ups,
 * pesquisas concluídas, novas oportunidades e o que está em andamento. Seção vazia não aparece.
 * Estado do banco, proteções e auditoria ficam em Configurações; aqui só entra um aviso quando
 * algo está errado.
 */

const SECTION_NAMES: Record<TodaySectionKey, string> = {
  relationship: 'conversas',
  approvals: 'aprovações',
  companies: 'empresas analisadas',
  discovery: 'pesquisas',
  monitoring: 'empresas para rever',
};

function listText(items: readonly string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} e ${items.at(-1)}`;
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

async function Greeting() {
  await connection();
  return (
    <h1 className="text-4xl tracking-[-0.03em] sm:text-5xl">
      <span className="sr-only">Hoje: </span>
      {greetingFor(new Date())}
    </h1>
  );
}

/** Aviso do banco só quando algo está errado; o estado completo fica em Configurações › Sistema. */
async function SystemNotice() {
  await connection();
  const status = await getServices().system.databaseStatus();
  if (status === 'ok') return null;
  const view = DATABASE_STATUS_VIEW[status];
  const text =
    status === 'memory'
      ? 'Modo de teste: os dados ficam só na memória e somem quando o app reinicia.'
      : `O banco de dados não está pronto (${view.label.toLowerCase()}): as listas abaixo podem vir vazias.`;
  return (
    <Alert tone={view.tone === 'danger' ? 'danger' : 'warning'} role="status" data-system={status}>
      {text}{' '}
      <Link href="/configuracoes#sistema" className="underline underline-offset-4">
        Ver detalhes em Configurações
      </Link>
      .
    </Alert>
  );
}

/** `databaseDown`: banco não configurado ou com erro; a tela não pode dizer "nada pendente". */
function Sections({ today, databaseDown }: { today: TodayOverview; databaseDown: boolean }) {
  const sections: ReactNode[] = [];
  const {
    readyToApproach,
    replies,
    drafts,
    approved,
    followUps,
    finishedSearches,
    newOpportunities,
    toReview,
  } = today;

  if (readyToApproach.total > 0) {
    sections.push(
      <TodaySection
        key="prontas"
        id="prontas"
        title="Prontas para abordar"
        description="A análise recomenda abordar e ainda não há conversa."
        total={readyToApproach.total}
        shown={readyToApproach.items.length}
        more={{ href: companyRoutes.list, label: 'Ver empresas' }}
      >
        {readyToApproach.items.map((item) => (
          <TodayRow
            key={item.companyId}
            title={item.companyName}
            href={companyRoutes.company(item.companyId)}
            isDemo={item.isDemo}
            meta={[RECOMMENDATION_SHORT[item.recommendation], item.offerName]
              .filter(Boolean)
              .join(' · ')}
            action={
              <RowLink
                href={`${companyRoutes.company(item.companyId)}#relacionamento`}
                context={item.companyName}
              >
                Preparar mensagem
              </RowLink>
            }
          />
        ))}
      </TodaySection>,
    );
  }

  if (replies.total > 0) {
    sections.push(
      <TodaySection
        key="respostas"
        id="respostas"
        title="Respostas para retornar"
        total={replies.total}
        shown={replies.items.length}
        more={{ href: relationshipRoutes.conversations }}
      >
        {replies.items.map((item) => (
          <TodayRow
            key={item.opportunityId}
            title={item.companyName}
            href={relationshipRoutes.opportunity(item.opportunityId)}
            isDemo={item.isDemo}
            detail={item.detail}
            action={
              <RowLink
                href={relationshipRoutes.opportunitySection(item.opportunityId, 'conversa')}
                context={item.companyName}
              >
                Abrir conversa
              </RowLink>
            }
          />
        ))}
      </TodaySection>,
    );
  }

  if (drafts.total + approved.total > 0) {
    sections.push(
      <TodaySection
        key="mensagens"
        id="mensagens"
        title="Mensagens"
        description="O app não envia nada: você revisa e aprova aqui, envia por fora do app pelo canal aprovado e registra o envio."
        total={drafts.total + approved.total}
        shown={drafts.items.length + approved.items.length}
        more={{ href: '/aprovacoes', label: 'Ver aprovações', always: true }}
      >
        {drafts.items.map((item) => (
          <TodayRow
            key={`rascunho-${item.opportunityId}`}
            title={item.companyName}
            href={relationshipRoutes.opportunity(item.opportunityId)}
            isDemo={item.isDemo}
            meta="Para revisar"
            detail={item.detail}
            action={
              <RowLink
                href={relationshipRoutes.opportunitySection(item.opportunityId, 'mensagens')}
                context={item.companyName}
              >
                Revisar
              </RowLink>
            }
          />
        ))}
        {approved.items.map((item) => (
          <TodayRow
            key={`aprovada-${item.approvalId}`}
            title={item.companyName}
            href={relationshipRoutes.opportunity(item.opportunityId)}
            isDemo={item.isDemo}
            meta="Aprovada, falta enviar"
            detail={`A aprovação vale até ${formatDateTime(item.expiresAt)}. Envie por fora do app (${MESSAGE_CHANNEL_LABELS[item.channel]}) e registre o envio aqui.`}
            action={
              <RowLink
                href={relationshipRoutes.opportunitySection(item.opportunityId, 'mensagens')}
                context={item.companyName}
              >
                Ver mensagem aprovada
              </RowLink>
            }
          />
        ))}
      </TodaySection>,
    );
  }

  if (followUps.total > 0) {
    sections.push(
      <TodaySection
        key="follow-ups"
        id="follow-ups"
        title="Follow-ups"
        total={followUps.total}
        shown={followUps.items.length}
        more={{ href: relationshipRoutes.conversations }}
      >
        {followUps.items.map((item) => (
          <TodayRow
            key={`${item.kind}-${item.opportunityId}`}
            title={item.companyName}
            href={relationshipRoutes.opportunity(item.opportunityId)}
            isDemo={item.isDemo}
            detail={item.detail}
            action={
              <RowLink
                href={relationshipRoutes.opportunitySection(item.opportunityId, 'follow-ups')}
                context={item.companyName}
              >
                Ver follow-up
              </RowLink>
            }
          />
        ))}
      </TodaySection>,
    );
  }

  if (finishedSearches.total > 0) {
    sections.push(
      <TodaySection
        key="pesquisas"
        id="pesquisas"
        title="Pesquisas concluídas"
        description="Dos últimos 7 dias, com empresas que ainda não tinham aparecido."
        total={finishedSearches.total}
        shown={finishedSearches.items.length}
        more={{ href: discoveryRoutes.home, label: 'Ver pesquisas' }}
      >
        {finishedSearches.items.map((item) => (
          <TodayRow
            key={item.runId}
            title={item.request}
            href={discoveryRoutes.run(item.runId)}
            isDemo={item.isDemo}
            meta={`${plural(item.newProspects, 'empresa nova', 'empresas novas')} de ${item.prospects} · ${formatDate(item.at)}`}
            action={
              <RowLink href={discoveryRoutes.run(item.runId)} context={item.request}>
                Ver resultados
              </RowLink>
            }
          />
        ))}
      </TodaySection>,
    );
  }

  if (newOpportunities.total > 0) {
    sections.push(
      <TodaySection
        key="oportunidades"
        id="oportunidades"
        title="Novas oportunidades"
        description="Achadas nas pesquisas, com prioridade alta ou média, ainda não analisadas. Analisar usa até 3 buscas na internet e a IA deste computador, e leva alguns minutos."
        total={newOpportunities.total}
        shown={newOpportunities.items.length}
        more={{ href: discoveryRoutes.prospects }}
      >
        {newOpportunities.items.map((item) => (
          <TodayRow
            key={item.prospectId}
            title={item.name}
            href={discoveryRoutes.prospect(item.prospectId)}
            isDemo={item.isDemo}
            meta={[PRIORITY_BAND_LABELS[item.priority], item.segment, item.place]
              .filter(Boolean)
              .join(' · ')}
            detail={item.reason ? `Por quê: ${item.reason}` : null}
            action={
              <ActionButton
                action={investigateProspectAction.bind(null, item.prospectId)}
                pendingLabel="Começando a análise…"
              >
                Analisar empresa<span className="sr-only">: {item.name}</span>
              </ActionButton>
            }
          />
        ))}
      </TodaySection>,
    );
  }

  if (toReview.total > 0) {
    sections.push(
      <TodaySection
        key="rever"
        id="rever"
        title="Para olhar de novo"
        description="Empresas acompanhadas cuja análise passou do prazo de revisão."
        total={toReview.total}
        shown={toReview.items.length}
        more={{ href: '/monitoramento', label: 'Ver monitoramento', always: true }}
      >
        {toReview.items.map((item) => (
          <TodayRow
            key={item.companyId}
            title={item.companyName}
            href={companyRoutes.company(item.companyId)}
            isDemo={item.isDemo}
            meta={`Última análise em ${formatDate(item.lastInvestigatedAt)}`}
            action={
              <RowLink
                href={`${companyRoutes.company(item.companyId)}#investigacao`}
                context={item.companyName}
              >
                Atualizar a análise
              </RowLink>
            }
          />
        ))}
      </TodaySection>,
    );
  }

  if (sections.length === 0 && databaseDown) {
    return (
      <Well className="space-y-3 py-10 text-center" data-today-empty="sem-banco">
        <p className="text-lg">Sem banco de dados, não há o que conferir.</p>
        <p className="mx-auto max-w-prose text-sm text-muted-foreground">
          As pesquisas, empresas e conversas ficam no banco. Veja o que falta em Configurações ›
          Sistema.
        </p>
        <div className="flex flex-wrap justify-center gap-2 pt-2">
          <Button asChild>
            <Link href="/configuracoes#sistema">Ver Configurações › Sistema</Link>
          </Button>
        </div>
      </Well>
    );
  }
  if (sections.length === 0 && today.unavailable.length > 0) {
    // Nem tudo foi lido: dizer "nada pendente" seria afirmar o que não foi conferido.
    return (
      <Well className="space-y-3 py-10 text-center" data-today-empty="parcial">
        <p className="text-lg">Não deu para conferir tudo agora.</p>
        <p className="mx-auto max-w-prose text-sm text-muted-foreground">
          O que foi lido não pede atenção, mas uma parte ficou de fora (veja o aviso acima).
        </p>
        <div className="flex flex-wrap justify-center gap-2 pt-2">
          <Button asChild variant="secondary">
            {/* Página dinâmica: navegar para ela de novo refaz a leitura no servidor. */}
            <Link href="/">Tentar de novo</Link>
          </Button>
        </div>
      </Well>
    );
  }
  if (sections.length === 0) {
    return (
      <Well className="space-y-3 py-10 text-center" data-today-empty="">
        <p className="text-lg">Nada pedindo a sua atenção agora.</p>
        <p className="mx-auto max-w-prose text-sm text-muted-foreground">
          Quando uma análise recomendar abordar, alguém responder ou uma pesquisa achar empresas
          novas, aparece aqui.
        </p>
        <div className="flex flex-wrap justify-center gap-2 pt-2">
          <Button asChild>
            <Link href={discoveryRoutes.home}>
              <Plus aria-hidden="true" className="size-4" />
              Nova pesquisa
            </Link>
          </Button>
          <Button asChild variant="secondary">
            <Link href={companyRoutes.list}>Ver empresas</Link>
          </Button>
        </div>
      </Well>
    );
  }
  return <>{sections}</>;
}

function CommercialSummary({ today }: { today: TodayOverview }) {
  const { pipeline } = today;
  return (
    <Panel aria-labelledby="resumo">
      <PanelHeader titleId="resumo" title="Resumo comercial" className="mb-3" />
      <dl className="grid grid-cols-1 gap-3 text-sm">
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-muted-foreground">Conversas abertas</dt>
          <dd className="text-lg tabular-nums">
            {pipeline ? (
              <Link
                href={relationshipRoutes.pipeline}
                className="underline-offset-4 hover:underline"
              >
                {pipeline.openCount}
              </Link>
            ) : (
              '—'
            )}
          </dd>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-muted-foreground">Em negociação</dt>
          <dd className="text-right">
            <span className="text-lg tabular-nums">
              {pipeline && pipeline.valuedCount > 0
                ? formatCents(pipeline.valueWithBasisCents)
                : '—'}
            </span>
            {pipeline && pipeline.valuedCount > 0 ? (
              <span className="block text-xs text-muted-foreground">
                {plural(pipeline.valuedCount, 'conversa com valor', 'conversas com valor')}
              </span>
            ) : pipeline ? (
              <span className="block text-xs text-muted-foreground">
                Nenhuma conversa com valor informado
              </span>
            ) : null}
          </dd>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-muted-foreground">Prontas para abordar</dt>
          <dd className="text-lg tabular-nums">
            {today.unavailable.includes('companies') || today.unavailable.includes('relationship')
              ? '—'
              : today.readyToApproach.total}
          </dd>
        </div>
      </dl>
      <p className="mt-4 text-xs text-muted-foreground">
        Funil e gasto do mês em{' '}
        <Link href="/inteligencia" className="underline underline-offset-4">
          Resultados
        </Link>
        .
      </p>
    </Panel>
  );
}

function InProgress({ today }: { today: TodayOverview }) {
  const { runningAnalyses, runningSearches } = today;
  if (runningAnalyses.total + runningSearches.total === 0) return null;
  return (
    <Panel aria-labelledby="andamento" data-today="andamento">
      <PanelHeader
        titleId="andamento"
        title="Em andamento"
        description="Continua no computador. Recarregue a página para ver o que já terminou."
        className="mb-2"
      />
      <ul className="divide-y text-sm">
        {runningAnalyses.items.map((item) => (
          <li key={item.companyId} className="py-2.5">
            <Link
              href={companyRoutes.company(item.companyId)}
              className="font-medium underline-offset-4 hover:underline"
            >
              {item.companyName}
            </Link>
            <span className="block text-xs text-muted-foreground">
              {item.status === 'queued' ? 'Análise na fila' : 'Análise em andamento'}
            </span>
          </li>
        ))}
        {runningSearches.items.map((item) => (
          <li key={item.runId} className="py-2.5">
            <Link
              href={discoveryRoutes.run(item.runId)}
              className="font-medium break-words underline-offset-4 hover:underline"
            >
              {item.request}
            </Link>
            <span className="block text-xs text-muted-foreground">Pesquisa em andamento</span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

async function TodayContent() {
  await connection();
  const [today, database] = await Promise.all([loadToday(), getServices().system.databaseStatus()]);
  const missing = today.unavailable.map((section) => SECTION_NAMES[section]);
  const databaseDown = database !== 'ok' && database !== 'memory';
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
      <div className="min-w-0 space-y-4 lg:col-span-8">
        {missing.length > 0 ? (
          <Alert tone="warning" role="status" data-today-unavailable="">
            Não foi possível ler {listText(missing)} agora. O resto está abaixo; recarregue a página
            em um minuto.
          </Alert>
        ) : null}
        <Sections today={today} databaseDown={databaseDown} />
      </div>
      <aside className="min-w-0 space-y-4 lg:col-span-4" aria-label="Resumo e andamento">
        <CommercialSummary today={today} />
        <InProgress today={today} />
      </aside>
    </div>
  );
}

export default function Today() {
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-2">
          <Suspense fallback={<h1 className="text-4xl tracking-[-0.03em] sm:text-5xl">Hoje</h1>}>
            <Greeting />
          </Suspense>
          <p className="text-sm text-muted-foreground">
            O que precisa da sua atenção, na ordem em que vale a pena olhar.
          </p>
        </div>
        <Button asChild>
          <Link href={discoveryRoutes.home}>
            <Plus aria-hidden="true" className="size-4" />
            Nova pesquisa
          </Link>
        </Button>
      </div>
      <Suspense fallback={null}>
        <SystemNotice />
      </Suspense>
      <Suspense
        fallback={
          <Well role="status" className="py-10 text-center text-sm text-muted-foreground">
            Juntando o que precisa da sua atenção…
          </Well>
        }
      >
        <TodayContent />
      </Suspense>
    </div>
  );
}
