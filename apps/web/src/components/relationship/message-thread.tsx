import type { ComplianceState, MessageView } from '@prospector/application';
import {
  MESSAGE_CHANNEL_LABELS,
  MESSAGE_KIND_LABELS,
  MESSAGE_STATUS_LABELS,
  type OutboundMessage,
} from '@prospector/contracts';
import { Alert, Badge, DemoBadge, Well } from '@prospector/ui';
import { StatusButton } from '@/components/strategy/decision-forms';
import { formatDateTime } from '@/lib/format';
import {
  approvalStateLabel,
  canPrepareReapproval,
  channelPhrase,
  problemLabels,
} from '@/lib/relationship-labels';
import {
  approveMessageAction,
  discardMessageAction,
  editMessageAction,
  prepareReapprovalAction,
  recordOutboundAction,
  regenerateMessageAction,
  revokeApprovalAction,
} from '@/app/(shell)/relacionamento/actions';
import {
  ApproveForm,
  EditMessageForm,
  ReasonForm,
  RecordOutboundForm,
  RegenerateForm,
} from './forms';

/**
 * Uma linha de mensagens (versão mais recente) com o que dá para fazer com ela agora. O texto
 * aparece exatamente como será aprovado: o hash do que está na tela vai junto da aprovação.
 * Quem usa chaveia pela linha (`threadId`), não pela versão: uma versão nova não desmonta o bloco.
 */
export function MessageThread({
  view,
  previous,
  compliance,
  open,
  suppressed,
  now,
  offerMoveToContacted,
  opportunityId,
  from,
  title,
}: {
  view: MessageView;
  previous: readonly OutboundMessage[];
  compliance: ComplianceState;
  open: boolean;
  suppressed: boolean;
  /** Agora, no formato do campo datetime-local (padrão do "quando você enviou"). */
  now: string;
  offerMoveToContacted: boolean;
  opportunityId: string;
  /** De onde as ações voltam com o aviso: o id da oportunidade ou `FROM_APPROVALS`. */
  from: string;
  /** Prefixo do título (na fila de Aprovações, o nome da empresa). */
  title?: string;
}) {
  const { message, status, approval, problems, issues } = view;
  const channel = MESSAGE_CHANNEL_LABELS[message.channel];
  const blockers: string[] = [];
  if (!open) blockers.push('A oportunidade está encerrada.');
  if (suppressed) blockers.push('A empresa pediu para não ser contatada.');
  if (!compliance.ready)
    blockers.push('A conformidade para abordar não está atendida (veja acima).');
  for (const issue of issues) blockers.push(issue.message);
  const usable = status === 'approved' && problems.length === 0;
  const editable = open && (status === 'draft' || status === 'approved');
  const stateLabel = status === 'approved' ? approvalStateLabel(problems) : null;
  const reapprove = open && !suppressed && status === 'approved' && canPrepareReapproval(problems);

  return (
    <article
      className="space-y-3 rounded-[var(--radius-tile)] border border-border p-4"
      aria-labelledby={`mensagem-${message.id}`}
      data-message-status={status}
    >
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 space-y-0.5">
          <h3 id={`mensagem-${message.id}`} className="break-words font-medium">
            {title ? `${title}: ` : ''}
            {MESSAGE_KIND_LABELS[message.kind]} · {channel}
          </h3>
          <p className="text-xs text-muted-foreground">
            Versão {message.version} de {view.versionCount} ·{' '}
            {message.origin === 'user' ? 'escrita por você' : 'rascunho da IA local'} ·{' '}
            {formatDateTime(message.createdAt)}
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Badge
            variant={
              usable
                ? 'success'
                : stateLabel === 'Usada'
                  ? 'neutral'
                  : status === 'approved'
                    ? 'warning'
                    : 'neutral'
            }
          >
            {stateLabel ?? MESSAGE_STATUS_LABELS[status]}
          </Badge>
          {message.isDemo ? <DemoBadge /> : null}
        </div>
      </header>

      <Well className="space-y-2 text-sm">
        {message.subject ? (
          <p>
            <span className="text-muted-foreground">Assunto: </span>
            <span className="font-medium">{message.subject}</span>
          </p>
        ) : null}
        <p className="whitespace-pre-wrap break-words">{message.body}</p>
      </Well>

      {status === 'draft' && issues.length > 0 ? (
        <Alert tone="warning" role="note">
          <p className="font-medium">Antes de aprovar, corrija:</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {issues.map((issue) => (
              <li key={`${issue.field}-${issue.message}`}>{issue.message}</li>
            ))}
          </ul>
        </Alert>
      ) : null}

      {approval ? (
        <p className="text-xs text-muted-foreground">
          {approval.status === 'revoked'
            ? `Aprovação revogada em ${formatDateTime(approval.revokedAt ?? approval.decidedAt)}${approval.revokeReason ? ` (${approval.revokeReason})` : ''}.`
            : `Aprovada em ${formatDateTime(approval.decidedAt)}, vale até ${formatDateTime(approval.expiresAt)}, só ${channelPhrase(approval.channel)}.`}
        </p>
      ) : null}
      {status === 'approved' && problems.length > 0 ? (
        <Alert tone="warning" role="note" data-approval-problems>
          <p className="font-medium">Esta aprovação não pode ser usada agora:</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {problemLabels(problems).map((label) => (
              <li key={label}>{label}</li>
            ))}
          </ul>
        </Alert>
      ) : null}

      {status === 'draft' && open ? (
        blockers.length === 0 ? (
          <ApproveForm
            action={approveMessageAction.bind(null, from, message.id, message.payloadHash)}
            channelPhrase={channelPhrase(message.channel)}
          />
        ) : (
          <div className="text-sm text-muted-foreground" data-approve-blocked>
            <p className="font-medium text-foreground">Aprovar ainda não é possível:</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5">
              {blockers.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        )
      ) : null}

      {usable && open ? (
        <details className="group rounded-[var(--radius-tile)] bg-muted p-3">
          <summary className="cursor-pointer text-sm font-medium">
            Já enviei: registrar o contato feito
          </summary>
          <div className="mt-3">
            <RecordOutboundForm
              action={recordOutboundAction.bind(null, opportunityId, message.id)}
              now={now}
              offerMoveToContacted={offerMoveToContacted}
            />
          </div>
        </details>
      ) : null}

      {editable ? (
        <div className="flex flex-wrap gap-2">
          <details className="w-full rounded-[var(--radius-tile)] bg-muted p-3">
            <summary className="cursor-pointer text-sm font-medium">Editar o texto</summary>
            <div className="mt-3">
              <EditMessageForm
                action={editMessageAction.bind(null, message.id)}
                hasSubject={message.channel === 'email'}
                subject={message.subject ?? ''}
                body={message.body}
              />
            </div>
          </details>
          <details className="w-full rounded-[var(--radius-tile)] bg-muted p-3">
            <summary className="cursor-pointer text-sm font-medium">Reescrever com a IA</summary>
            <div className="mt-3">
              <RegenerateForm
                action={regenerateMessageAction.bind(null, message.id)}
                tone={message.tone ?? 'consultative'}
              />
            </div>
          </details>
        </div>
      ) : null}

      <div className="flex flex-wrap items-start gap-2">
        {reapprove ? (
          <StatusButton
            action={prepareReapprovalAction.bind(null, opportunityId, message.id)}
            label="Preparar para aprovar de novo"
            variant="primary"
            pendingLabel="Criando a versão…"
          />
        ) : null}
        {approval && approval.status === 'approved' && status === 'approved' ? (
          <details className="w-full rounded-[var(--radius-tile)] bg-muted p-3">
            <summary className="cursor-pointer text-sm font-medium">Revogar a aprovação</summary>
            <div className="mt-3">
              <ReasonForm
                action={revokeApprovalAction.bind(null, opportunityId, approval.id)}
                label="Motivo"
                submitLabel="Revogar aprovação"
                minLength={3}
                destructive
              />
            </div>
          </details>
        ) : null}
        {/* Só rascunho é descartado: aprovação é decisão final (o banco recusa mudar depois). */}
        {status === 'draft' ? (
          <StatusButton
            action={discardMessageAction.bind(null, from, message.id)}
            label="Descartar mensagem"
            confirm="Descartar esta mensagem? As versões ficam no histórico, mas ela sai da lista de revisão."
          />
        ) : null}
      </div>

      {previous.length > 0 ? (
        <details>
          <summary className="cursor-pointer text-sm text-muted-foreground">
            Versões anteriores ({previous.length})
          </summary>
          <ol className="mt-2 space-y-2">
            {previous.map((version) => (
              <li key={version.id} className="rounded-[var(--radius-tile)] bg-muted p-3 text-sm">
                <p className="text-xs text-muted-foreground">
                  v{version.version} · {formatDateTime(version.createdAt)}
                  {version.approvalId ? ' · tinha aprovação (não vale mais)' : ''}
                </p>
                {version.subject ? <p className="font-medium">{version.subject}</p> : null}
                <p className="whitespace-pre-wrap break-words">{version.body}</p>
              </li>
            ))}
          </ol>
        </details>
      ) : null}
    </article>
  );
}
