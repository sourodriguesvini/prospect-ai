import {
  RECOMMENDATION_LABELS,
  WATCH_CADENCE_LABELS,
  type MonitoringOverview,
  type WatchItem,
  type WatchState,
} from '@prospector/contracts';
import { Badge, DemoBadge, StatusDot, Well, type StatusTone } from '@prospector/ui';
import Link from 'next/link';
import { startInvestigationAction } from '@/app/(shell)/empresas/actions';
import { companyRoutes } from '@/lib/company-routes';
import { formatDate } from '@/lib/format';
import { watchDueText } from '@/lib/insights';
import { ReinvestigateButton } from './reinvestigate-button';

/**
 * Lista de acompanhamento (ADR-0017): implícita, pela recomendação do último diagnóstico. Nada é
 * investigado sozinho; a vencida ganha o botão "Investigar de novo".
 */

const STATE_TONE: Record<WatchState, StatusTone> = {
  due: 'warning',
  running: 'accent',
  upcoming: 'success',
};

const STATE_BADGE: Record<WatchState, 'warning' | 'accent' | 'success'> = {
  due: 'warning',
  running: 'accent',
  upcoming: 'success',
};

function WatchRow({ item }: { item: WatchItem }) {
  return (
    <li
      className="flex flex-wrap items-start justify-between gap-3 py-3 first:pt-0 last:pb-0"
      data-watch-state={item.state}
    >
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={companyRoutes.company(item.companyId)}
            className="break-words font-medium underline-offset-4 hover:underline"
          >
            {item.companyName}
          </Link>
          {item.isDemo ? <DemoBadge /> : null}
        </div>
        <p className="text-xs text-muted-foreground">
          {RECOMMENDATION_LABELS[item.recommendation]} ·{' '}
          {WATCH_CADENCE_LABELS[item.cadence].toLowerCase()} · última investigação em{' '}
          <time dateTime={item.lastInvestigatedAt}>{formatDate(item.lastInvestigatedAt)}</time>
        </p>
        <Badge variant={STATE_BADGE[item.state]}>
          <StatusDot tone={STATE_TONE[item.state]}>{watchDueText(item)}</StatusDot>
        </Badge>
      </div>
      {item.state === 'due' ? (
        <ReinvestigateButton
          action={startInvestigationAction.bind(null, item.companyId, false)}
          companyName={item.companyName}
        />
      ) : null}
    </li>
  );
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

export function Watchlist({ overview }: { overview: MonitoringOverview }) {
  const { watchlist, excludedDiscarded, notInvestigated, truncated } = overview;
  const due = watchlist.filter((item) => item.state === 'due').length;
  const running = watchlist.filter((item) => item.state === 'running').length;
  const upcoming = watchlist.length - due - running;
  return (
    <div className="space-y-4">
      {watchlist.length === 0 ? (
        <Well className="space-y-2 text-sm text-muted-foreground" data-watch-empty="">
          <p className="font-medium text-foreground">Nenhuma empresa para acompanhar ainda.</p>
          <p>
            Uma empresa entra aqui depois da primeira investigação com diagnóstico. Investigue em{' '}
            <Link href={companyRoutes.list} className="underline underline-offset-4">
              Empresas
            </Link>
            .
          </p>
        </Well>
      ) : (
        <>
          <p className="text-sm" data-watch-summary="">
            {plural(due, 'vencida', 'vencidas')} · {running} em andamento · {upcoming} em dia
          </p>
          <ul className="divide-y divide-border">
            {watchlist.map((item) => (
              <WatchRow key={item.companyId} item={item} />
            ))}
          </ul>
        </>
      )}
      {excludedDiscarded > 0 || notInvestigated > 0 || truncated ? (
        <ul className="space-y-1 text-xs text-muted-foreground">
          {excludedDiscarded > 0 ? (
            <li>
              {plural(excludedDiscarded, 'empresa fica', 'empresas ficam')} de fora por estar
              {excludedDiscarded === 1 ? '' : 'em'} com a recomendação “
              {RECOMMENDATION_LABELS.discard}”.
            </li>
          ) : null}
          {notInvestigated > 0 ? (
            <li>
              {plural(
                notInvestigated,
                'empresa ainda não tem diagnóstico',
                'empresas ainda não têm diagnóstico',
              )}{' '}
              (veja em{' '}
              <Link href={companyRoutes.list} className="underline underline-offset-4">
                Empresas
              </Link>
              ).
            </li>
          ) : null}
          {truncated ? (
            <li>A lista considera as 200 empresas mais recentes; as mais antigas ficam de fora.</li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}
