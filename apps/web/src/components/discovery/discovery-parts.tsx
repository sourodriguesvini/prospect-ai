import type { ProspectView } from '@prospector/application';
import {
  type AnalysisConfidence,
  type DiscoveryRun,
  type DiscoveryTrigger,
  DISCOVERY_RUN_STATUS_LABELS,
  PRIORITY_BAND_LABELS,
  PROSPECT_STATUS_LABELS,
  SIGNAL_RECENCY_LABELS,
  SIGNAL_TYPE_LABELS,
  SIGNAL_VERIFICATION_LABELS,
  type DiscoveryRunStatus,
  type PriorityBand,
  type Prospect,
  type ProspectSignal,
  type ProspectSource,
} from '@prospector/contracts';
import { Badge, Button, DemoBadge, cn, type BadgeProps } from '@prospector/ui';
import { ExternalLink } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import type { FormAction } from '@/components/forms/use-action-form';
import { companyRoutes } from '@/lib/company-routes';
import { discoveryRoutes } from '@/lib/discovery-routes';
import { formatDate, formatDateTime } from '@/lib/format';
import { ActionButton, DismissForm } from './discovery-forms';

/**
 * Peças das telas da Descoberta (F4). Toda conclusão aparece com a fonte (link e trecho) e com o
 * que é fato conferido e o que é hipótese; prioridade é triagem por regras, não probabilidade.
 */

type Variant = NonNullable<BadgeProps['variant']>;

const RUN_STATUS_VARIANT: Record<DiscoveryRunStatus, Variant> = {
  draft: 'warning',
  queued: 'neutral',
  running: 'accent',
  completed: 'success',
  failed: 'danger',
  cancelled: 'outline',
};

export function RunStatusBadge({ status }: { status: DiscoveryRunStatus }) {
  return <Badge variant={RUN_STATUS_VARIANT[status]}>{DISCOVERY_RUN_STATUS_LABELS[status]}</Badge>;
}

const PRIORITY_VARIANT: Record<PriorityBand, Variant> = {
  high: 'accent',
  medium: 'neutral',
  low: 'outline',
  insufficient: 'warning',
};

export function PriorityBadge({ priority }: { priority: PriorityBand }) {
  return <Badge variant={PRIORITY_VARIANT[priority]}>{PRIORITY_BAND_LABELS[priority]}</Badge>;
}

/** Endereço curto para mostrar (host), com o link completo para abrir em outra aba. */
export function SourceLink({ url, label }: { url: string; label?: string | null }) {
  let host = url;
  try {
    host = new URL(url).host;
  } catch {
    // endereço inválido não chega aqui (contrato), mas a tela não quebra por isso
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer nofollow"
      className="inline-flex max-w-full items-center gap-1 break-all underline underline-offset-4"
    >
      {label ?? host}
      <ExternalLink aria-hidden="true" className="size-3.5 shrink-0" />
      <span className="sr-only">(abre em outra aba)</span>
    </a>
  );
}

function signalDate(signal: ProspectSignal): string | null {
  if (signal.eventDate) {
    const [year, month, day] = signal.eventDate.split('-');
    if (day) return `em ${day}/${month}/${year}`;
    if (month) return `em ${month}/${year}`;
    return `em ${year}`;
  }
  return signal.publishedAt ? `publicado em ${formatDate(signal.publishedAt)}` : null;
}

/** Fonte citada (sinal ou motivo): o host curto, com o link completo. */
type CitedSource = Pick<ProspectSource, 'url' | 'host'>;

/** Sinal com o trecho literal da fonte, a data do acontecimento e por que importa. */
export function SignalItem({
  signal,
  source,
  compact = false,
  lead,
  extra,
  className,
}: {
  signal: ProspectSignal;
  /** Fonte do trecho ("Fonte: host ↗"); sem ela, o trecho aparece sem link. */
  source?: CitedSource | null;
  compact?: boolean;
  /** Linha antes do sinal (ex.: a empresa, no radar). */
  lead?: ReactNode;
  /** Linha a mais no fim do item (ex.: relevância e confiança no detalhe). */
  extra?: ReactNode;
  className?: string;
}) {
  const date = signalDate(signal);
  return (
    <li className={cn('space-y-1.5', className)}>
      {lead}
      <p className="flex flex-wrap items-center gap-2 text-sm">
        <Badge variant="neutral">{SIGNAL_TYPE_LABELS[signal.type]}</Badge>
        <Badge variant={signal.verification === 'confirmed' ? 'success' : 'warning'}>
          {SIGNAL_VERIFICATION_LABELS[signal.verification]}
        </Badge>
        {signal.recency !== 'unknown' ? (
          <span className="text-muted-foreground">{SIGNAL_RECENCY_LABELS[signal.recency]}</span>
        ) : null}
        {date ? <span className="text-muted-foreground">· {date}</span> : null}
      </p>
      <p className="text-sm">{signal.summary}</p>
      <blockquote className="border-l-2 border-border pl-3 text-sm text-muted-foreground">
        “{signal.quote}”
        {source ? (
          <span className="mt-1 block text-xs">
            Fonte: <SourceLink url={source.url} label={source.host} />
          </span>
        ) : null}
      </blockquote>
      {!compact && signal.rationale ? (
        <p className="text-xs text-muted-foreground">Por que importa: {signal.rationale}</p>
      ) : null}
      {extra}
    </li>
  );
}

function place(prospect: Pick<Prospect, 'city' | 'uf'>): string | null {
  return [prospect.city, prospect.uf].filter(Boolean).join('/') || null;
}

/** Linha de dados básicos: setor, cidade e site (conferido ou não). */
export function ProspectFacts({ prospect }: { prospect: Prospect }) {
  const parts: ReactNode[] = [];
  if (prospect.segment) parts.push(prospect.segment);
  const where = place(prospect);
  if (where) parts.push(where);
  if (prospect.websiteUrl) {
    parts.push(
      <span key="site" className="inline-flex items-center gap-1">
        <SourceLink url={prospect.websiteUrl} label={prospect.domain} />
        <span>{prospect.siteVerified ? '(site conferido)' : '(site não conferido)'}</span>
      </span>,
    );
  } else {
    parts.push('Site oficial não encontrado');
  }
  return (
    <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm text-muted-foreground">
      {parts.map((part, index) => (
        <span key={index} className="inline-flex items-center gap-1.5">
          {index > 0 ? <span aria-hidden="true">·</span> : null}
          {part}
        </span>
      ))}
    </p>
  );
}

const CONFIDENCE_LEVEL: Record<AnalysisConfidence, string> = {
  high: 'alta',
  medium: 'média',
  low: 'baixa',
};

/** Confiança da triagem (quanto as fontes cobrem), não do negócio: "Confiança da triagem: alta". */
export function analysisConfidenceText(confidence: AnalysisConfidence): string {
  return `Confiança da triagem: ${CONFIDENCE_LEVEL[confidence]}`;
}

/**
 * Fontes de um motivo da triagem ("Fonte: host ↗"), até `max`, avisando quando há mais. Motivo
 * sem fonte vem de um critério do Prospector (ex.: falta de site conferido).
 */
export function ReasonSources({
  sourceIds,
  sources,
  max = 2,
  moreHint,
}: {
  sourceIds: readonly string[];
  sources: Readonly<Record<string, CitedSource & { id: string }>>;
  max?: number;
  /** Onde ver as outras (ex.: "veja Fontes, abaixo"). */
  moreHint: string;
}) {
  if (sourceIds.length === 0) {
    return <span className="text-muted-foreground"> (critério do Prospector)</span>;
  }
  const found = sourceIds
    .map((id) => sources[id])
    .filter((source): source is CitedSource & { id: string } => source !== undefined);
  if (found.length === 0) return null;
  const shown = found.slice(0, max);
  const rest = found.length - shown.length;
  return (
    <span className="text-muted-foreground">
      {' '}
      · {shown.length > 1 ? 'Fontes' : 'Fonte'}:{' '}
      {shown.map((source, index) => (
        <span key={source.id}>
          {index > 0 ? ', ' : ''}
          <SourceLink url={source.url} label={source.host} />
        </span>
      ))}
      {rest > 0 ? ` e mais ${rest} (${moreHint})` : ''}
    </span>
  );
}

/** id do título de um cartão (recebe o foco quando o cartão anterior some da lista). */
export function prospectTitleId(prospectId: string): string {
  return `empresa-${prospectId}`;
}

/**
 * Cartão de uma empresa encontrada: prioridade da triagem, motivos com a fonte, sinais com trecho
 * e fonte (`view.sources`, as fontes citadas pelos sinais e pelos motivos) e ações.
 */
export function ProspectCard({
  view,
  actions,
  headingLevel = 'h3',
}: {
  view: ProspectView;
  actions?: ReactNode;
  headingLevel?: 'h2' | 'h3';
}) {
  const { prospect, signals, sources, isNew } = view;
  const Heading = headingLevel;
  const reasons = prospect.assessment?.reasons ?? [];
  const missing = prospect.assessment?.missing ?? [];
  return (
    <li className="space-y-3 py-5" data-card="">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <Heading
            id={prospectTitleId(prospect.id)}
            tabIndex={-1}
            data-card-title=""
            className="flex flex-wrap items-center gap-2 text-base font-medium"
          >
            <Link
              href={discoveryRoutes.prospect(prospect.id)}
              className="break-words underline-offset-4 hover:underline"
            >
              {prospect.displayName}
            </Link>
            {prospect.isDemo ? <DemoBadge /> : null}
            {isNew ? <Badge variant="accent">Nova nesta pesquisa</Badge> : null}
            {prospect.status !== 'new' ? (
              <Badge variant="outline">{PROSPECT_STATUS_LABELS[prospect.status]}</Badge>
            ) : null}
          </Heading>
          <ProspectFacts prospect={prospect} />
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <PriorityBadge priority={prospect.priority} />
          <span className="text-muted-foreground">
            {analysisConfidenceText(prospect.confidence)}
          </span>
        </div>
      </div>
      {reasons.length > 0 ? (
        <ul className="list-disc space-y-1 pl-5 text-sm">
          {reasons.slice(0, 3).map((reason, index) => (
            <li key={index}>
              {reason.text}
              <ReasonSources
                sourceIds={reason.sourceIds}
                sources={sources}
                moreHint="veja no detalhe da empresa"
              />
            </li>
          ))}
        </ul>
      ) : null}
      {signals.length > 0 ? (
        <ul className="space-y-4">
          {signals.slice(0, 2).map((signal) => (
            <SignalItem
              key={signal.id}
              signal={signal}
              source={sources[signal.sourceId] ?? null}
              compact
            />
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">
          Nenhum sinal comercial encontrado nas fontes.
        </p>
      )}
      {missing.length > 0 ? (
        <p className="text-xs text-muted-foreground">
          Falta saber: {missing.slice(0, 2).join(' ')}
        </p>
      ) : null}
      {actions ? <div className="flex flex-wrap items-start gap-2">{actions}</div> : null}
    </li>
  );
}

/**
 * Ações de um cartão (pesquisa e lista). Os botões se repetem a cada cartão: o nome da empresa vai
 * junto para leitor de tela. Salvar não some: vira "Salva" no mesmo lugar (o foco fica nele).
 */
export function ProspectCardActions({
  prospect,
  investigate,
  save,
  dismiss,
  restore,
}: {
  prospect: Prospect;
  investigate: FormAction;
  save: FormAction;
  dismiss: FormAction;
  /** Voltar para a lista (só aparece em empresa ignorada). */
  restore?: FormAction;
}) {
  const name = prospect.displayName;
  const context = <span className="sr-only">: {name}</span>;
  if (prospect.status === 'dismissed') {
    if (!restore) return null;
    return (
      <ActionButton
        action={restore}
        pendingLabel="Restaurando…"
        success={{ message: `${name} voltou para a lista.`, focus: 'next' }}
      >
        Voltar para a lista{context}
      </ActionButton>
    );
  }
  if (prospect.status === 'investigating' && prospect.companyId) {
    return (
      <Button asChild size="sm" variant="secondary">
        <Link href={companyRoutes.company(prospect.companyId)}>Ver análise{context}</Link>
      </Button>
    );
  }
  return (
    <>
      <ActionButton action={investigate} variant="primary" pendingLabel="Começando a análise…">
        Analisar empresa{context}
      </ActionButton>
      <ActionButton
        action={save}
        pendingLabel="Salvando…"
        done={prospect.status === 'saved' ? <>Salva{context}</> : undefined}
        success={{ message: `${name} salva.`, focus: 'self' }}
      >
        Salvar para depois{context}
      </ActionButton>
      <DismissForm action={dismiss} prospectId={prospect.id} name={name} />
    </>
  );
}

const TRIGGER_LABELS: Record<DiscoveryTrigger, string> = {
  user: 'Pedida por você',
  copilot: 'Preparada pelo Copiloto',
  schedule: 'Monitoramento',
  catch_up: 'Monitoramento (recuperação)',
};

/** Resumo numérico de uma pesquisa (empresas, novidades, sinais e créditos gastos). */
export function runCounts(run: DiscoveryRun): string {
  const p = run.progress;
  const companies = `${p.prospects} ${p.prospects === 1 ? 'empresa' : 'empresas'}`;
  const fresh =
    p.newProspects > 0 ? ` (${p.newProspects} ${p.newProspects === 1 ? 'nova' : 'novas'})` : '';
  const signals = `${p.signals} ${p.signals === 1 ? 'sinal' : 'sinais'}`;
  const credits = `${p.creditsUsed} ${p.creditsUsed === 1 ? 'crédito' : 'créditos'}`;
  return `${companies}${fresh} · ${signals} · ${credits}`;
}

/** "12 empresas, 3 sinais": resumo curto para o anúncio do fim da pesquisa. */
export function runSummary(run: DiscoveryRun): string {
  const p = run.progress;
  return `${p.prospects} ${p.prospects === 1 ? 'empresa' : 'empresas'}, ${p.signals} ${
    p.signals === 1 ? 'sinal' : 'sinais'
  }`;
}

/** Linha de uma pesquisa nas listas (início e monitoramentos). */
export function RunRow({ run }: { run: DiscoveryRun }) {
  return (
    <li className="flex flex-wrap items-start justify-between gap-3 py-3">
      <span className="min-w-0 space-y-0.5">
        <span className="flex flex-wrap items-center gap-2">
          <Link
            href={discoveryRoutes.run(run.id)}
            className="break-words font-medium underline-offset-4 hover:underline"
          >
            {run.request}
          </Link>
          {run.isDemo ? <DemoBadge /> : null}
        </span>
        <span className="block text-sm text-muted-foreground">
          {TRIGGER_LABELS[run.trigger]} · {formatDateTime(run.createdAt)}
          {run.status === 'completed' || run.status === 'running' ? ` · ${runCounts(run)}` : ''}
        </span>
      </span>
      <span className="flex items-center gap-2">
        {run.partial && run.status === 'completed' ? (
          <Badge variant="warning">Parcial</Badge>
        ) : null}
        <RunStatusBadge status={run.status} />
      </span>
    </li>
  );
}

export function triggerLabel(trigger: DiscoveryTrigger): string {
  return TRIGGER_LABELS[trigger];
}
