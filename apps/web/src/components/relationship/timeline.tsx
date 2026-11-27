import {
  INTERACTION_DIRECTION_LABELS,
  MESSAGE_CHANNEL_LABELS,
  REPLY_CLASSIFICATION_LABELS,
  REPLY_CONFIDENCE_LABELS,
  type Interaction,
  type ReplyAnalysis,
} from '@prospector/contracts';
import { Badge, DemoBadge, Well } from '@prospector/ui';
import { StatusButton } from '@/components/strategy/decision-forms';
import { formatDateTime } from '@/lib/format';
import { localDateInDays } from '@/lib/relationship-dates';
import {
  analyzeReplyAction,
  createTaskAction,
  draftSuggestedReplyAction,
} from '@/app/(shell)/relacionamento/actions';
import { TaskForm } from './forms';

/** Leitura sugerida pela IA: sempre com a confiança e a dúvida à mostra. Nada acontece sozinho. */
function Analysis({
  interaction,
  analysis,
  opportunityId,
  open,
  suppressed,
  readAt,
}: {
  interaction: Interaction;
  analysis: ReplyAnalysis;
  opportunityId: string;
  open: boolean;
  suppressed: boolean;
  readAt: string;
}) {
  return (
    <div
      className="space-y-2 rounded-[var(--radius-tile)] border border-dashed border-border p-3 text-sm"
      data-analysis={analysis.classification}
    >
      <p className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">
          Leitura da IA local
        </span>
        <Badge variant={analysis.classification === 'stop_request' ? 'danger' : 'accent'}>
          {REPLY_CLASSIFICATION_LABELS[analysis.classification]}
        </Badge>
        <Badge variant="outline">
          Confiança {REPLY_CONFIDENCE_LABELS[analysis.confidence].toLowerCase()}
        </Badge>
      </p>
      <p>{analysis.summary}</p>
      {analysis.uncertainty ? (
        <p className="text-muted-foreground">
          Dúvida: {analysis.uncertainty}
          {analysis.alternatives.length > 0
            ? ` Outras leituras: ${analysis.alternatives.map((item) => REPLY_CLASSIFICATION_LABELS[item].toLowerCase()).join(', ')}.`
            : ''}
        </p>
      ) : null}
      {analysis.objections.length > 0 ? (
        <p>
          <span className="text-muted-foreground">Objeções: </span>
          {analysis.objections.join('; ')}
        </p>
      ) : null}
      {analysis.mentionedDeadline ? (
        <p>
          <span className="text-muted-foreground">Prazo citado: </span>
          {analysis.mentionedDeadline}
        </p>
      ) : null}
      {analysis.qualifyingQuestions.length > 0 ? (
        <div>
          <p className="text-muted-foreground">Perguntas que ainda faltam:</p>
          <ul className="list-disc space-y-0.5 pl-5">
            {analysis.qualifyingQuestions.map((question) => (
              <li key={question}>{question}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <p>
        <span className="text-muted-foreground">Próximo passo sugerido: </span>
        {analysis.nextStep}
      </p>
      {analysis.suggestedReply ? (
        <Well className="space-y-1">
          <p className="text-xs text-muted-foreground">Resposta sugerida (rascunho)</p>
          {analysis.suggestedReply.subject ? (
            <p className="font-medium">{analysis.suggestedReply.subject}</p>
          ) : null}
          <p className="whitespace-pre-wrap break-words">{analysis.suggestedReply.body}</p>
        </Well>
      ) : null}
      <p className="text-xs text-muted-foreground">
        Interpretada em {formatDateTime(interaction.analyzedAt ?? interaction.createdAt)}
        {interaction.analysisModel ? ` · ${interaction.analysisModel}` : ''}. É uma sugestão:
        confira o texto da empresa antes de agir.
      </p>
      {open && !suppressed ? (
        <div className="space-y-3">
          {analysis.suggestedReply ? (
            <StatusButton
              action={draftSuggestedReplyAction.bind(null, interaction.id)}
              label="Usar como rascunho de resposta"
              pendingLabel="Criando rascunho…"
              showSuccess
            />
          ) : null}
          {analysis.followUpInDays ? (
            <details className="rounded-[var(--radius-tile)] bg-muted p-3">
              <summary className="cursor-pointer text-sm font-medium">
                Marcar follow-up em {analysis.followUpInDays}{' '}
                {analysis.followUpInDays === 1 ? 'dia' : 'dias'}
              </summary>
              <div className="mt-3">
                <TaskForm
                  action={createTaskAction.bind(null, opportunityId)}
                  defaultDue={localDateInDays(new Date(readAt), analysis.followUpInDays)}
                  defaultTitle={analysis.nextStep.slice(0, 200)}
                  suggested
                />
              </div>
            </details>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function Timeline({
  interactions,
  opportunityId,
  open,
  suppressed,
  readAt,
}: {
  interactions: readonly Interaction[];
  opportunityId: string;
  open: boolean;
  suppressed: boolean;
  readAt: string;
}) {
  if (interactions.length === 0) {
    return (
      <Well className="text-sm text-muted-foreground">
        Nenhum contato registrado. Depois de enviar uma mensagem aprovada, registre o contato feito;
        quando a empresa responder, registre a resposta aqui.
      </Well>
    );
  }
  return (
    <ol className="space-y-4">
      {interactions.map((interaction) => (
        <li key={interaction.id} className="space-y-2" data-interaction={interaction.direction}>
          <p className="flex flex-wrap items-center gap-2 text-sm">
            <Badge variant={interaction.direction === 'inbound' ? 'accent' : 'neutral'}>
              {INTERACTION_DIRECTION_LABELS[interaction.direction]}
            </Badge>
            <span className="text-muted-foreground">
              {MESSAGE_CHANNEL_LABELS[interaction.channel]} ·{' '}
              {formatDateTime(interaction.occurredAt)}
              {interaction.counterpartRole ? ` · ${interaction.counterpartRole}` : ''}
            </span>
            {interaction.isDemo ? <DemoBadge /> : null}
          </p>
          {interaction.summary ? <p className="text-sm">{interaction.summary}</p> : null}
          {interaction.body ? (
            <Well className="whitespace-pre-wrap break-words text-sm">{interaction.body}</Well>
          ) : null}
          {interaction.analysis ? (
            <Analysis
              interaction={interaction}
              analysis={interaction.analysis}
              opportunityId={opportunityId}
              open={open}
              suppressed={suppressed}
              readAt={readAt}
            />
          ) : null}
          {interaction.direction === 'inbound' && open ? (
            <StatusButton
              action={analyzeReplyAction.bind(null, interaction.id)}
              label={interaction.analysis ? 'Interpretar de novo' : 'Interpretar com a IA'}
              pendingLabel="Interpretando com a IA local…"
              variant={interaction.analysis ? 'secondary' : 'primary'}
              showSuccess
              announcePending
            />
          ) : null}
        </li>
      ))}
    </ol>
  );
}
