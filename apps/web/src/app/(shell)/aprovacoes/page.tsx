import {
  MESSAGE_CHANNEL_LABELS,
  MESSAGE_KIND_LABELS,
  type OpportunityStage,
} from '@prospector/contracts';
import { Alert, Badge, DemoBadge, Panel, PanelHeader } from '@prospector/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { connection } from 'next/server';
import { Suspense } from 'react';
import { FocusOnArrival } from '@/components/discovery/announcers';
import { MessageThread } from '@/components/relationship/message-thread';
import {
  ComplianceNotice,
  EmptyState,
  OpportunityBadges,
  ReadAt,
} from '@/components/relationship/parts';
import { Loading } from '@/components/strategy/loading';
import { PageHeader, StorageNotice, Unavailable } from '@/components/strategy/page-parts';
import { companyRoutes } from '@/lib/company-routes';
import { formatDateTime } from '@/lib/format';
import { isoToLocalDateTime } from '@/lib/relationship-dates';
import {
  approvalStateLabel,
  NOTICE_TEXT,
  noticeTone,
  problemLabels,
} from '@/lib/relationship-labels';
import {
  APPROVAL_NOTICES,
  FOCUS_MESSAGE_PARAM,
  FROM_APPROVALS,
  focusMessageId,
  relationshipRoutes,
} from '@/lib/relationship-routes';
import { loadRelationship } from '@/server/relationship';

export const metadata: Metadata = { title: 'Aprovações' };

type Props = PageProps<'/aprovacoes'>;

const TRAIL = [{ href: '/', label: 'Início' }];

const BEFORE_CONTACT: readonly OpportunityStage[] = ['identified', 'qualified', 'approach_ready'];

/**
 * Aprovações (ADR-0014): tudo o que pode sair do app passa por aqui. Cada rascunho aparece com o
 * texto exato que será aprovado; aprovar não envia nada (o envio é manual, fora do app).
 */
async function Approvals() {
  await connection();
  const result = await loadRelationship((relationship, ctx) => relationship.approvalQueue(ctx));
  if (result.kind === 'unavailable') return <Unavailable message={result.message} />;
  const queue = result.data;
  const now = isoToLocalDateTime(queue.readAt);
  return (
    <>
      <StorageNotice storage={result.storage} />
      <ComplianceNotice compliance={queue.compliance} />
      <Panel aria-labelledby="esperando">
        <PanelHeader
          titleId="esperando"
          title="Esperando sua decisão"
          description="Rascunhos ainda não aprovados, do mais recente para o mais antigo. Aprovar vale só para o texto e o canal mostrados, por 72 horas, e para um contato só."
        />
        {queue.pending.length === 0 ? (
          <EmptyState>
            Nada esperando aprovação. Rascunhos nascem no detalhe de uma oportunidade (
            <Link href={relationshipRoutes.hub} className="underline underline-offset-4">
              Relacionamento
            </Link>
            ) ou no dossiê de uma empresa (
            <Link href={companyRoutes.list} className="underline underline-offset-4">
              Empresas
            </Link>
            ).
          </EmptyState>
        ) : (
          <ul className="space-y-6">
            {queue.pending.map(({ view, opportunity, compliance }) => (
              <li key={view.message.threadId} className="space-y-2" data-pending={view.message.id}>
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    href={relationshipRoutes.opportunitySection(opportunity.id, 'mensagens')}
                    className="break-words font-medium underline-offset-4 hover:underline"
                  >
                    {opportunity.companyName}
                  </Link>
                  <OpportunityBadges opportunity={opportunity} />
                </div>
                <MessageThread
                  view={view}
                  previous={[]}
                  compliance={compliance}
                  opportunityId={opportunity.id}
                  from={FROM_APPROVALS}
                  title={opportunity.companyName}
                  open={opportunity.closedAt === null}
                  suppressed={opportunity.suppressed}
                  now={now}
                  offerMoveToContacted={BEFORE_CONTACT.includes(opportunity.stage)}
                />
              </li>
            ))}
          </ul>
        )}
      </Panel>
      <Panel aria-labelledby="recentes">
        <PanelHeader
          titleId="recentes"
          title="Decisões recentes"
          description="Aprovações e revogações. Uma aprovação deixa de valer se o texto mudar, se vencer, se for revogada ou se a empresa pedir para parar."
        />
        {queue.recent.length === 0 ? (
          <EmptyState>Nenhuma aprovação registrada ainda.</EmptyState>
        ) : (
          <ul className="divide-y divide-border">
            {queue.recent.map(({ approval, message, opportunity, problems }) => {
              const labels = problemLabels(problems);
              const state =
                approval.status === 'revoked' ? 'Revogada' : approvalStateLabel(problems);
              return (
                <li
                  key={approval.id}
                  className="space-y-1 py-3 text-sm"
                  data-approval={approval.status}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    {opportunity ? (
                      <Link
                        href={relationshipRoutes.opportunitySection(opportunity.id, 'mensagens')}
                        className="break-words font-medium underline-offset-4 hover:underline"
                      >
                        {opportunity.companyName}
                      </Link>
                    ) : (
                      <span className="font-medium">Oportunidade removida</span>
                    )}
                    <Badge
                      variant={
                        state === 'Revogada' || state === 'Usada'
                          ? 'outline'
                          : state
                            ? 'warning'
                            : 'success'
                      }
                    >
                      {state ?? 'Aprovada'}
                    </Badge>
                    {opportunity?.isDemo || opportunity?.companyIsDemo || message?.isDemo ? (
                      <DemoBadge />
                    ) : null}
                  </div>
                  <p className="text-muted-foreground">
                    {message ? `${MESSAGE_KIND_LABELS[message.kind]} v${message.version} · ` : ''}
                    {MESSAGE_CHANNEL_LABELS[approval.channel]} · aprovada em{' '}
                    {formatDateTime(approval.decidedAt)}
                    {approval.status === 'revoked'
                      ? ` · revogada em ${formatDateTime(approval.revokedAt ?? approval.decidedAt)}${approval.revokeReason ? ` (${approval.revokeReason})` : ''}`
                      : ` · vale até ${formatDateTime(approval.expiresAt)}`}
                  </p>
                  {approval.status !== 'revoked' && labels.length > 0 ? (
                    <p className="text-muted-foreground">Motivo: {labels.join('; ')}.</p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
        <ReadAt at={queue.readAt} />
      </Panel>
    </>
  );
}

/** Confirmação que sobrevive ao redirecionamento depois de aprovar ou descartar (só valores conhecidos). */
async function Notice({ searchParams }: { searchParams: Props['searchParams'] }) {
  const query = await searchParams;
  const notice = Object.values(APPROVAL_NOTICES).find((value) => value === query.aviso);
  if (!notice) return null;
  const focusId = focusMessageId(query[FOCUS_MESSAGE_PARAM]);
  return (
    <>
      <Alert tone={noticeTone(notice)} role="status" data-aviso={notice}>
        {NOTICE_TEXT[notice]}
      </Alert>
      {focusId ? <FocusOnArrival key={focusId} targetId={`mensagem-${focusId}`} /> : null}
    </>
  );
}

export default function ApprovalsPage({ searchParams }: Props) {
  return (
    <div className="space-y-6">
      <PageHeader
        trail={TRAIL}
        title="Aprovações"
        description="Nada sai sem a sua aprovação. O Prospector não envia mensagens: você aprova o texto exato, envia por conta própria e registra o contato feito."
      />
      <Suspense fallback={null}>
        <Notice searchParams={searchParams} />
      </Suspense>
      <Suspense fallback={<Loading label="Carregando as aprovações…" />}>
        <Approvals />
      </Suspense>
    </div>
  );
}
