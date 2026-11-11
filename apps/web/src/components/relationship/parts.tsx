import type { ComplianceState } from '@prospector/application';
import {
  ATTENTION_LABELS,
  OPPORTUNITY_PRIORITY_LABELS,
  type AttentionItem,
  type OpportunitySummary,
} from '@prospector/contracts';
import { Alert, Badge, DemoBadge, Well } from '@prospector/ui';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { formatCents, formatDate, formatDateTime } from '@/lib/format';
import { stageLabel } from '@/lib/relationship-labels';
import { relationshipRoutes } from '@/lib/relationship-routes';
import { strategyRoutes } from '@/lib/strategy-routes';

/** Peças de exibição do Relacionamento (componentes de servidor, sem estado). */

export function OpportunityBadges({ opportunity }: { opportunity: OpportunitySummary }) {
  return (
    <>
      <Badge variant={opportunity.closedAt ? 'outline' : 'neutral'} data-stage={opportunity.stage}>
        {stageLabel(opportunity.stage)}
      </Badge>
      {opportunity.priority === 'high' ? <Badge variant="accent">Prioridade alta</Badge> : null}
      {opportunity.suppressed ? <Badge variant="danger">Não contatar</Badge> : null}
      {opportunity.isDemo || opportunity.companyIsDemo ? <DemoBadge /> : null}
    </>
  );
}

/** Linha de resumo: último contato, follow-ups e valor (só o que existe). */
export function OpportunityFacts({ opportunity }: { opportunity: OpportunitySummary }) {
  const facts: string[] = [];
  if (opportunity.offerName) facts.push(opportunity.offerName);
  facts.push(
    opportunity.lastInteractionAt
      ? `Último registro em ${formatDate(opportunity.lastInteractionAt)}`
      : 'Nenhum contato registrado',
  );
  if (opportunity.nextTaskDueAt)
    facts.push(`Follow-up em ${formatDate(opportunity.nextTaskDueAt)}`);
  if (opportunity.valueEstimateCents !== null)
    facts.push(formatCents(opportunity.valueEstimateCents));
  return <p className="text-xs text-muted-foreground">{facts.join(' · ')}</p>;
}

export function OpportunityCard({ opportunity }: { opportunity: OpportunitySummary }) {
  return (
    <li className="space-y-1.5 rounded-[var(--radius-tile)] bg-surface p-3 shadow-[var(--shadow-panel)]">
      <Link
        href={relationshipRoutes.opportunity(opportunity.id)}
        className="block break-words font-medium underline-offset-4 hover:underline"
      >
        {opportunity.companyName}
      </Link>
      <div className="flex flex-wrap gap-1.5">
        <Badge variant="outline">{OPPORTUNITY_PRIORITY_LABELS[opportunity.priority]}</Badge>
        {opportunity.suppressed ? <Badge variant="danger">Não contatar</Badge> : null}
        {opportunity.isDemo || opportunity.companyIsDemo ? <DemoBadge /> : null}
      </div>
      <OpportunityFacts opportunity={opportunity} />
    </li>
  );
}

export function AttentionList({ items }: { items: readonly AttentionItem[] }) {
  if (items.length === 0) {
    return (
      <Well className="text-sm text-muted-foreground">
        Nada pendente: nenhum follow-up vencido, resposta esperando retorno ou rascunho para
        revisar.
      </Well>
    );
  }
  return (
    <ol className="divide-y divide-border">
      {items.map((item) => (
        <li
          key={`${item.kind}-${item.opportunityId}-${item.at ?? ''}`}
          className="flex flex-wrap items-start justify-between gap-2 py-3"
          data-attention={item.kind}
        >
          <div className="min-w-0 space-y-0.5">
            <Link
              href={relationshipRoutes.opportunity(item.opportunityId)}
              className="break-words font-medium underline-offset-4 hover:underline"
            >
              {item.companyName}
            </Link>
            <p className="text-sm text-muted-foreground">{item.detail}</p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <Badge variant={item.rank <= 1 ? 'warning' : 'neutral'}>
              {ATTENTION_LABELS[item.kind]}
            </Badge>
            {item.isDemo ? <DemoBadge /> : null}
          </div>
        </li>
      ))}
    </ol>
  );
}

/** Estado da barreira de abordagem: aprovar mensagem só com tudo atendido (LIA, oferta, voz...). */
export function ComplianceNotice({ compliance }: { compliance: ComplianceState }) {
  if (compliance.ready) {
    return (
      <Alert tone="success" role="note" data-compliance="ready">
        Conformidade atendida: mensagens revisadas podem ser aprovadas para uso. O envio continua
        manual, fora do app.
      </Alert>
    );
  }
  return (
    <Alert tone="warning" role="note" data-compliance="blocked">
      <p className="font-medium">
        Aprovar mensagens está bloqueado. Rascunhos podem ser preparados e revisados, mas nenhum
        texto é liberado para uso até a conformidade estar atendida.
      </p>
      <ul className="mt-1 list-disc space-y-0.5 pl-5">
        {compliance.missing.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
      <p className="mt-2">
        <Link href={strategyRoutes.compliance} className="underline underline-offset-4">
          Abrir a conformidade
        </Link>
      </p>
    </Alert>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <Well className="text-sm text-muted-foreground">{children}</Well>;
}

export function ReadAt({ at }: { at: string }) {
  return <p className="text-xs text-muted-foreground">Lido em {formatDateTime(at)}.</p>;
}
