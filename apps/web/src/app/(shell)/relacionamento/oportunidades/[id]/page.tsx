import type { OpportunityDetail } from '@prospector/application';
import {
  APPROACH_OBJECTIVE_LABELS,
  CONFIDENCE_BAND_LABELS,
  SUPPRESSION_REASON_LABELS,
  TASK_KIND_LABELS,
  type ConfidenceBand,
  type OpportunityStage,
  type Task,
} from '@prospector/contracts';
import { Alert, Badge, Button, DemoBadge, Panel, PanelHeader, Well } from '@prospector/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { connection } from 'next/server';
import { Suspense, type ReactNode } from 'react';
import { FocusOnArrival } from '@/components/discovery/announcers';
import {
  NewMessageForm,
  NoteForm,
  OpportunityDetailsForm,
  PrepareApproachForm,
  RecordInboundForm,
  RescheduleForm,
  StageForm,
  SuppressForm,
  TaskForm,
  WriteMessageForm,
} from '@/components/relationship/forms';
import { MessageThread } from '@/components/relationship/message-thread';
import { SuppressionLift } from '@/components/relationship/suppression';
import {
  ComplianceNotice,
  DiagnosisNote,
  OpportunityBadges,
  ReadAt,
} from '@/components/relationship/parts';
import { Timeline } from '@/components/relationship/timeline';
import { StatusButton } from '@/components/strategy/decision-forms';
import { Loading } from '@/components/strategy/loading';
import { PageHeader, StorageNotice, Unavailable } from '@/components/strategy/page-parts';
import { companyRoutes } from '@/lib/company-routes';
import { centsToBrl } from '@/lib/form-data';
import { formatCents, formatDate, formatDateTime } from '@/lib/format';
import { isoToLocalDate, isoToLocalDateTime, localDateInDays } from '@/lib/relationship-dates';
import {
  channelPhrase,
  NOTICE_TEXT,
  noticeTone,
  preparedOfferId,
  stageLabel,
} from '@/lib/relationship-labels';
import {
  FOCUS_MESSAGE_PARAM,
  focusMessageId,
  OPPORTUNITY_NOTICES,
  relationshipRoutes,
} from '@/lib/relationship-routes';
import {
  activeOfferOptions,
  citedClaims,
  loadRelationship,
  opportunityDetail,
  opportunityTitle,
  type CitedClaim,
  type Option,
} from '@/server/relationship';
import {
  cancelTaskAction,
  changeStageAction,
  completeTaskAction,
  createTaskAction,
  discardPlanAction,
  newMessageAction,
  prepareApproachAction,
  recordInboundAction,
  recordNoteAction,
  rescheduleTaskAction,
  suppressCompanyAction,
  updateOpportunityAction,
  writeMessageAction,
} from '../../actions';

type Props = PageProps<'/relacionamento/oportunidades/[id]'>;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  return { title: `${await opportunityTitle(id, 'Oportunidade')} · Relacionamento` };
}

const TRAIL = [
  { href: '/', label: 'Início' },
  { href: relationshipRoutes.hub, label: 'Relacionamento' },
  { href: relationshipRoutes.pipeline, label: 'Pipeline' },
];

/** Antes do primeiro contato: registrar o envio pode mover para "Contatada". */
const BEFORE_CONTACT: readonly OpportunityStage[] = ['identified', 'qualified', 'approach_ready'];
/** Antes da conversa: registrar a resposta pode mover para "Em conversa". */
const BEFORE_CONVERSATION: readonly OpportunityStage[] = [...BEFORE_CONTACT, 'contacted'];

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

const EPISTEMIC_LABELS: Record<CitedClaim['epistemicType'], string> = {
  fact: 'Fato',
  inference: 'Inferência',
  hypothesis: 'Hipótese',
};

const SUPPRESSION_SOURCE_LABELS = {
  reply_rule: 'reconhecido na resposta registrada',
  reply_ai: 'lido pela IA na resposta (confira)',
  user: 'marcado por você',
} as const;

function Section({
  id,
  title,
  description,
  children,
}: {
  id: string;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <Panel aria-labelledby={`titulo-${id}`} id={id} className="scroll-mt-6">
      <PanelHeader titleId={`titulo-${id}`} title={title} description={description} />
      <div className="space-y-4">{children}</div>
    </Panel>
  );
}

function Collapsible({ summary, children }: { summary: string; children: ReactNode }) {
  // Largura inteira: o formulário de dentro mede o espaço pela própria largura (`@container`).
  return (
    <details className="w-full rounded-[var(--radius-tile)] bg-muted p-3">
      <summary className="cursor-pointer text-sm font-medium">{summary}</summary>
      <div className="mt-3">{children}</div>
    </details>
  );
}

function CitedList({ ids, claims }: { ids: readonly string[]; claims: Map<string, CitedClaim> }) {
  const known = ids.flatMap((id) => {
    const claim = claims.get(id);
    return claim ? [{ id, claim }] : [];
  });
  if (known.length === 0) {
    return ids.length > 0 ? (
      <p className="text-xs text-muted-foreground">
        Cita {ids.length} {ids.length === 1 ? 'evidência' : 'evidências'} do dossiê que não está
        mais em vigor.
      </p>
    ) : null;
  }
  return (
    <ul className="mt-1 space-y-1">
      {known.map(({ id, claim }) => (
        <li key={id} className="text-xs text-muted-foreground">
          <Badge variant="outline" className="mr-1.5">
            {EPISTEMIC_LABELS[claim.epistemicType]} ·{' '}
            {CONFIDENCE_BAND_LABELS[claim.band as ConfidenceBand] ?? claim.band}
            {claim.stale ? ' · vencida' : ''}
          </Badge>
          {claim.statement}
          {claim.source ? (
            <span className="block">
              Fonte: <span className="break-all">{claim.source}</span>
              {claim.capturedAt ? `, coletada em ${formatDate(claim.capturedAt)}` : ''}.
            </span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function Strategy({
  detail,
  claims,
  offers,
}: {
  detail: OpportunityDetail;
  claims: Map<string, CitedClaim>;
  offers: readonly Option[];
}) {
  const { plan, basis, opportunity, company } = detail;
  const open = opportunity.closedAt === null;
  const suppressed = detail.activeSuppressions.length > 0;
  const offerForApproach = preparedOfferId(
    offers,
    opportunity.offerId,
    detail.insights.recommendedService?.offerId ?? null,
  );
  if (!plan) {
    return (
      <Section
        id="estrategia"
        title="Estratégia"
        description="Ainda não há estratégia de abordagem. A IA local monta uma a partir do dossiê, da oferta e da voz da agência."
      >
        <DiagnosisNote insights={detail.insights} offers={offers} />
        {basis.basis === 'insufficient' ? (
          <Alert tone="warning" role="note">
            Ainda não há base para abordar esta empresa: o dossiê não tem evidência em vigor nem
            diagnóstico. Investigue a empresa primeiro, ou escreva a mensagem à mão em Mensagens.
          </Alert>
        ) : null}
        {basis.gaps.length > 0 ? (
          <div className="text-sm">
            <p className="text-muted-foreground">O que ainda falta saber:</p>
            <ul className="list-disc space-y-0.5 pl-5">
              {basis.gaps.map((gap) => (
                <li key={gap}>{gap}</li>
              ))}
            </ul>
          </div>
        ) : null}
        {open && !suppressed && basis.basis !== 'insufficient' ? (
          offers.length > 0 ? (
            <PrepareApproachForm
              action={prepareApproachAction.bind(null, company.id)}
              offers={offers}
              defaultOfferId={offerForApproach}
            />
          ) : (
            <p className="text-sm text-muted-foreground">
              Nenhuma oferta ativa na Estratégia: cadastre ou ative uma oferta para preparar a
              abordagem.
            </p>
          )
        ) : null}
      </Section>
    );
  }
  const { content } = plan;
  return (
    <Section
      id="estrategia"
      title="Estratégia"
      description={`Versão ${plan.version}${detail.planCount > 1 ? ` de ${detail.planCount}` : ''} · ${plan.model ? `IA local (${plan.model})` : 'IA local'} · ${formatDateTime(plan.createdAt)}. Uma sugestão para você decidir; cada ponto mostra a evidência que o sustenta.`}
    >
      <div className="flex flex-wrap gap-1.5">
        <Badge variant="accent">{APPROACH_OBJECTIVE_LABELS[content.objective]}</Badge>
        <Badge variant="outline">{capitalize(channelPhrase(content.channel))}</Badge>
        {plan.basis === 'limited' ? (
          // "Limitada" cobre diagnóstico parcial e só cadastro: o motivo está em "O que falta saber"
          // (teste real de 2026-11-25: dizia "só dados de cadastro" com 34 fatos do site).
          <Badge variant="warning">Base limitada: veja o que falta saber</Badge>
        ) : null}
        {plan.isDemo ? <DemoBadge /> : null}
      </div>
      <dl className="space-y-3 text-sm">
        <div>
          <dt className="text-xs text-muted-foreground">Oportunidade</dt>
          <dd>{content.opportunity}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Com quem falar (função)</dt>
          <dd>{content.counterpartRole}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Por que este canal</dt>
          <dd>{content.channelReason}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Argumento</dt>
          <dd>{content.argument}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Próximo passo</dt>
          <dd>{content.nextStep}</dd>
        </div>
      </dl>
      {content.evidence.length > 0 ? (
        <div className="space-y-2">
          <h3 className="text-sm font-medium">Em que se apoia</h3>
          <ul className="space-y-2">
            {content.evidence.map((point) => (
              <li
                key={point.statement}
                className="rounded-[var(--radius-tile)] bg-muted p-3 text-sm"
              >
                {point.statement}
                <CitedList ids={point.claimIds} claims={claims} />
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <Alert tone="warning" role="note">
          A estratégia não cita nenhuma evidência do dossiê. Trate o argumento como hipótese.
        </Alert>
      )}
      {content.gaps.length > 0 || content.risks.length > 0 ? (
        <div className="grid gap-4 text-sm sm:grid-cols-2">
          {content.gaps.length > 0 ? (
            <div>
              <p className="text-muted-foreground">O que falta saber</p>
              <ul className="list-disc space-y-0.5 pl-5">
                {content.gaps.map((gap) => (
                  <li key={gap}>{gap}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {content.risks.length > 0 ? (
            <div>
              <p className="text-muted-foreground">Riscos</p>
              <ul className="list-disc space-y-0.5 pl-5">
                {content.risks.map((risk) => (
                  <li key={risk}>{risk}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
      {open ? (
        <div className="flex flex-wrap items-start gap-2">
          {!suppressed && offers.length > 0 ? (
            <Collapsible summary="Preparar de novo (nova estratégia e novo rascunho)">
              <PrepareApproachForm
                action={prepareApproachAction.bind(null, company.id)}
                offers={offers}
                defaultOfferId={offerForApproach}
              />
            </Collapsible>
          ) : null}
          <StatusButton
            action={discardPlanAction.bind(null, opportunity.id, plan.id)}
            label="Descartar estratégia"
            confirm="Descartar esta estratégia? As mensagens já escritas continuam."
          />
        </div>
      ) : null}
    </Section>
  );
}

function Messages({ detail }: { detail: OpportunityDetail }) {
  const { opportunity, threads, previousVersions, compliance, interactions } = detail;
  const open = opportunity.closedAt === null;
  const suppressed = detail.activeSuppressions.length > 0;
  const now = isoToLocalDateTime(detail.readAt);
  const replyTo: Option[] = interactions
    .filter((item) => item.direction === 'inbound')
    .map((item) => ({
      value: item.id,
      label: `Resposta de ${formatDateTime(item.occurredAt)}`,
    }));
  return (
    <Section
      id="mensagens"
      title="Mensagens"
      description="Rascunhos versionados. Cada versão precisa da sua aprovação; editar cria uma versão nova e a aprovação anterior deixa de valer. O Prospector não envia nada."
    >
      {threads.length === 0 ? (
        <Well className="text-sm text-muted-foreground">
          Nenhuma mensagem ainda. Prepare a abordagem com a IA ou escreva à mão abaixo.
        </Well>
      ) : (
        <div className="space-y-4">
          {threads.map((view) => (
            <MessageThread
              key={view.message.threadId}
              view={view}
              opportunityId={opportunity.id}
              from={opportunity.id}
              previous={previousVersions[view.message.threadId] ?? []}
              compliance={compliance}
              open={open}
              suppressed={suppressed}
              now={now}
              offerMoveToContacted={BEFORE_CONTACT.includes(opportunity.stage)}
            />
          ))}
        </div>
      )}
      {open && !suppressed ? (
        <div className="space-y-2">
          <Collapsible summary="Nova mensagem com a IA">
            <NewMessageForm
              action={newMessageAction.bind(null, opportunity.id)}
              contact={detail.contact}
              replyTo={replyTo}
            />
          </Collapsible>
          <Collapsible summary="Escrever à mão">
            <WriteMessageForm
              action={writeMessageAction.bind(null, opportunity.id)}
              contact={detail.contact}
            />
          </Collapsible>
        </div>
      ) : null}
    </Section>
  );
}

function Conversation({ detail }: { detail: OpportunityDetail }) {
  const { opportunity, interactions } = detail;
  const open = opportunity.closedAt === null;
  const suppressed = detail.activeSuppressions.length > 0;
  const now = isoToLocalDateTime(detail.readAt);
  return (
    <Section
      id="conversa"
      title="Conversa"
      description="Contatos feitos, respostas recebidas e notas, do mais recente para o mais antigo. A leitura da IA é uma sugestão: não muda a etapa nem escreve para a empresa. Só um pedido para parar põe a empresa na lista de supressão na hora (dá para retirar, se for engano)."
    >
      <Timeline
        interactions={interactions}
        opportunityId={opportunity.id}
        open={open}
        suppressed={suppressed}
        readAt={detail.readAt}
      />
      {open ? (
        <div className="space-y-2">
          <Collapsible summary="Registrar resposta recebida">
            <RecordInboundForm
              action={recordInboundAction.bind(null, opportunity.id)}
              now={now}
              offerMoveToConversation={BEFORE_CONVERSATION.includes(opportunity.stage)}
            />
          </Collapsible>
          <Collapsible summary="Registrar nota (ligação, reunião, conversa)">
            <NoteForm action={recordNoteAction.bind(null, opportunity.id)} now={now} />
          </Collapsible>
        </div>
      ) : null}
    </Section>
  );
}

function TaskRow({ task, readAt }: { task: Task; readAt: string }) {
  const opportunityId = task.opportunityId;
  const overdue = task.status === 'open' && task.dueAt < readAt;
  return (
    <li className="space-y-2 py-3" data-task={task.status}>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium">{task.title}</span>
        <Badge variant="outline">{TASK_KIND_LABELS[task.kind]}</Badge>
        {overdue ? <Badge variant="danger">Vencido</Badge> : null}
        {task.origin === 'suggested' ? <Badge variant="neutral">Sugerido pela IA</Badge> : null}
        {task.isDemo ? <DemoBadge /> : null}
      </div>
      <p className="text-xs text-muted-foreground">
        {task.status === 'open'
          ? `Para ${formatDate(task.dueAt)}`
          : task.status === 'done'
            ? `Concluído em ${formatDate(task.completedAt ?? task.updatedAt)}`
            : `Cancelado em ${formatDate(task.updatedAt)}${task.cancelReason === 'opt_out' ? ' (pedido para parar o contato)' : ''}`}
        {task.notes ? ` · ${task.notes}` : ''}
      </p>
      {task.status === 'open' ? (
        <div className="flex flex-wrap items-start gap-2">
          <StatusButton
            action={completeTaskAction.bind(null, opportunityId, task.id)}
            label="Concluir"
            variant="primary"
          />
          <StatusButton
            action={cancelTaskAction.bind(null, opportunityId, task.id)}
            label="Cancelar"
            confirm="Cancelar este follow-up?"
          />
          <details className="w-full">
            <summary className="cursor-pointer text-sm text-muted-foreground">Remarcar</summary>
            <div className="mt-2">
              <RescheduleForm
                action={rescheduleTaskAction.bind(null, task.id)}
                dueAt={isoToLocalDate(task.dueAt)}
              />
            </div>
          </details>
        </div>
      ) : null}
    </li>
  );
}

function FollowUps({ detail }: { detail: OpportunityDetail }) {
  const { opportunity, tasks, readAt } = detail;
  const open = opportunity.closedAt === null;
  const suppressed = detail.activeSuppressions.length > 0;
  const pending = tasks
    .filter((task) => task.status === 'open')
    .sort((a, b) => a.dueAt.localeCompare(b.dueAt));
  const finished = tasks.filter((task) => task.status !== 'open');
  return (
    <Section
      id="follow-ups"
      title="Follow-ups"
      description="Lembretes seus. Nada é enviado na data: o follow-up só aparece na lista de hoje."
    >
      {pending.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhum follow-up aberto.</p>
      ) : (
        <ul className="divide-y divide-border">
          {pending.map((task) => (
            <TaskRow key={task.id} task={task} readAt={readAt} />
          ))}
        </ul>
      )}
      {open && !suppressed ? (
        <Collapsible summary="Marcar follow-up">
          <TaskForm
            action={createTaskAction.bind(null, opportunity.id)}
            defaultDue={localDateInDays(new Date(readAt), 3)}
          />
        </Collapsible>
      ) : null}
      {finished.length > 0 ? (
        <details>
          <summary className="cursor-pointer text-sm text-muted-foreground">
            Concluídos e cancelados ({finished.length})
          </summary>
          <ul className="divide-y divide-border">
            {finished.map((task) => (
              <TaskRow key={task.id} task={task} readAt={readAt} />
            ))}
          </ul>
        </details>
      ) : null}
    </Section>
  );
}

function Stage({ detail }: { detail: OpportunityDetail }) {
  const { opportunity, stageChanges } = detail;
  const history = [...stageChanges].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return (
    <Section
      id="etapa"
      title="Etapa"
      description="Só muda quando você decide. Cada mudança fica no histórico e na auditoria."
    >
      <StageForm
        action={changeStageAction.bind(null, opportunity.id)}
        current={opportunity.stage}
      />
      {history.length > 0 ? (
        <ol className="space-y-1.5 text-sm">
          {history.map((change) => (
            <li key={change.id}>
              <span className="text-muted-foreground">{formatDateTime(change.createdAt)} · </span>
              {change.fromStage ? `${stageLabel(change.fromStage)} → ` : 'Aberta em '}
              {stageLabel(change.toStage)}
              {change.note ? <span className="text-muted-foreground"> ({change.note})</span> : null}
            </li>
          ))}
        </ol>
      ) : null}
    </Section>
  );
}

function Details({ detail, offers }: { detail: OpportunityDetail; offers: readonly Option[] }) {
  const { opportunity } = detail;
  const known = new Set(offers.map((offer) => offer.value));
  const offerOptions =
    opportunity.offerId && !known.has(opportunity.offerId)
      ? [
          ...offers,
          { value: opportunity.offerId, label: opportunity.offerName ?? 'Oferta arquivada' },
        ]
      : offers;
  return (
    <Section
      id="detalhes"
      title="Detalhes"
      description={
        opportunity.valueEstimateCents !== null
          ? `Valor informado: ${formatCents(opportunity.valueEstimateCents)} (${opportunity.valueBasis ?? 'sem base'}).`
          : 'Sem valor informado. Valor só com base real.'
      }
    >
      <OpportunityDetailsForm
        action={updateOpportunityAction.bind(null, opportunity.id)}
        offers={offerOptions}
        closed={opportunity.stage === 'lost'}
        initial={{
          offerId: opportunity.offerId ?? '',
          priority: opportunity.priority,
          valueEstimateCents: centsToBrl(opportunity.valueEstimateCents),
          valueBasis: opportunity.valueBasis ?? '',
          nextAction: opportunity.nextAction ?? '',
          nextActionDueAt: opportunity.nextActionDueAt
            ? isoToLocalDate(opportunity.nextActionDueAt)
            : '',
          lostReason: opportunity.lostReason ?? '',
        }}
      />
    </Section>
  );
}

function Suppression({ detail }: { detail: OpportunityDetail }) {
  const { company, opportunity, activeSuppressions } = detail;
  if (activeSuppressions.length > 0) return null;
  return (
    <Section
      id="nao-contatar"
      title="Não contatar"
      description="Se a empresa pediu para parar, ou se você decidiu não insistir."
    >
      <SuppressForm action={suppressCompanyAction.bind(null, opportunity.id, company.id)} />
    </Section>
  );
}

function SuppressionAlert({ detail }: { detail: OpportunityDetail }) {
  if (detail.activeSuppressions.length === 0) return null;
  return (
    <Alert tone="danger" role="note" data-suppressed>
      <p className="font-medium">Não contatar esta empresa.</p>
      <ul className="mt-1 list-disc space-y-0.5 pl-5">
        {detail.activeSuppressions.map((entry) => (
          <li key={entry.id}>
            {SUPPRESSION_REASON_LABELS[entry.reason]}, {SUPPRESSION_SOURCE_LABELS[entry.source]}, em{' '}
            {formatDateTime(entry.createdAt)}.
          </li>
        ))}
      </ul>
      <p className="mt-2 text-sm">
        Nenhuma mensagem nova pode ser aprovada ou registrada como enviada, e os follow-ups abertos
        foram cancelados.
      </p>
      <SuppressionLift
        entries={detail.activeSuppressions}
        companyId={detail.company.id}
        opportunityId={detail.opportunity.id}
        summary="Foi engano? Retirar da lista de supressão"
        hint="Ex.: a resposta não pedia para parar. Fica registrado na auditoria."
      />
    </Alert>
  );
}

async function Opportunity({ params, searchParams }: Pick<Props, 'params' | 'searchParams'>) {
  await connection();
  const { id } = await params;
  const result = await loadRelationship((relationship) => opportunityDetail(relationship, id));
  if (result.kind === 'unavailable') {
    return (
      <>
        <PageHeader trail={TRAIL} title="Oportunidade" />
        <Unavailable message={result.message} />
      </>
    );
  }
  const detail = result.data;
  const { opportunity, company } = detail;
  const [offers, claims] = await Promise.all([activeOfferOptions(), citedClaims(company.id)]);
  const query = await searchParams;
  const notice = Object.values(OPPORTUNITY_NOTICES).find((value) => value === query.aviso);
  const focusId = notice ? focusMessageId(query[FOCUS_MESSAGE_PARAM]) : null;
  const description = [
    opportunity.offerName,
    opportunity.closedAt ? `Encerrada em ${formatDate(opportunity.closedAt)}` : null,
    opportunity.nextAction
      ? `Próximo passo: ${opportunity.nextAction}${opportunity.nextActionDueAt ? ` (até ${formatDate(opportunity.nextActionDueAt)})` : ''}`
      : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <>
      <PageHeader
        trail={TRAIL}
        title={company.displayName}
        badges={<OpportunityBadges opportunity={opportunity} />}
        description={description || undefined}
        actions={
          <Button asChild size="sm" variant="secondary">
            <Link href={companyRoutes.company(company.id)}>Dossiê da empresa</Link>
          </Button>
        }
      />
      {notice ? (
        <Alert tone={noticeTone(notice)} role="status" data-aviso={notice}>
          {NOTICE_TEXT[notice]}
        </Alert>
      ) : null}
      {focusId ? <FocusOnArrival key={focusId} targetId={`mensagem-${focusId}`} /> : null}
      <StorageNotice storage={result.storage} />
      <SuppressionAlert detail={detail} />
      <ComplianceNotice compliance={detail.compliance} />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="min-w-0 space-y-6 lg:col-span-2">
          <Strategy detail={detail} claims={claims} offers={offers} />
          <Messages detail={detail} />
          <Conversation detail={detail} />
        </div>
        <div className="min-w-0 space-y-6">
          <Stage detail={detail} />
          <FollowUps detail={detail} />
          <Details detail={detail} offers={offers} />
          <Suppression detail={detail} />
        </div>
      </div>
      <ReadAt at={detail.readAt} />
    </>
  );
}

export default function OpportunityPage({ params, searchParams }: Props) {
  return (
    <div className="space-y-6">
      <Suspense fallback={<Loading label="Carregando a oportunidade…" />}>
        <Opportunity params={params} searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
