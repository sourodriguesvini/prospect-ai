import {
  INVESTIGATION_CHANGE_KIND_LABELS,
  type CompanyChangeItem,
  type DiscoveryNoveltyItem,
  type MonitoringFeedFilter,
  type MonitoringFeedItem,
} from '@prospector/contracts';
import { Badge, DemoBadge, Well } from '@prospector/ui';
import Link from 'next/link';
import { companyRoutes } from '@/lib/company-routes';
import { discoveryRoutes } from '@/lib/discovery-routes';
import { formatDateTime } from '@/lib/format';

/**
 * Feed único do Monitoramento (ADR-0017). Os textos das mudanças vêm do sistema (comparação entre
 * duas investigações), nunca da IA; "fora do ar nesta coleta" aparece à parte, porque não é
 * mudança da empresa.
 */

function CompanyChange({ item }: { item: CompanyChangeItem }) {
  return (
    <article className="space-y-2" aria-labelledby={`novidade-${item.investigationId}`}>
      <header className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <h3 id={`novidade-${item.investigationId}`} className="text-base font-medium">
          <Link
            href={companyRoutes.company(item.companyId)}
            className="break-words underline-offset-4 hover:underline"
          >
            {item.companyName}
          </Link>
        </h3>
        {item.isDemo ? <DemoBadge /> : null}
        <Badge variant="outline">Empresa</Badge>
      </header>
      <p className="text-xs text-muted-foreground">
        Comparação da investigação concluída em{' '}
        <time dateTime={item.occurredAt}>{formatDateTime(item.occurredAt)}</time> com a anterior.
      </p>
      {item.changes.length > 0 ? (
        <ul className="space-y-1.5">
          {item.changes.map((change, index) => (
            <li key={`${change.kind}-${index}`} className="flex flex-wrap gap-x-2 gap-y-1 text-sm">
              <Badge variant="neutral" className="shrink-0">
                {INVESTIGATION_CHANGE_KIND_LABELS[change.kind]}
              </Badge>
              <span className="min-w-0 break-words">{change.text}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm">Nenhuma mudança de conteúdo.</p>
      )}
      {item.unavailable.length > 0 ? (
        <ul className="space-y-1 text-sm text-muted-foreground">
          {item.unavailable.map((change, index) => (
            <li key={`indisponivel-${index}`} className="break-words">
              <span className="font-medium">
                {INVESTIGATION_CHANGE_KIND_LABELS.temporarily_unavailable}:
              </span>{' '}
              {change.text}
            </li>
          ))}
        </ul>
      ) : null}
      <p className="text-sm">
        <Link
          href={`${companyRoutes.company(item.companyId)}#historico-investigacoes`}
          className="underline underline-offset-4"
        >
          Ver comparação na página da empresa<span className="sr-only">: {item.companyName}</span>
        </Link>
      </p>
    </article>
  );
}

function DiscoveryNovelty({ item }: { item: DiscoveryNoveltyItem }) {
  const companies =
    item.newCompanies === 1 ? '1 empresa nova' : `${item.newCompanies} empresas novas`;
  return (
    <article className="space-y-2" aria-labelledby={`novidade-${item.runId}`}>
      <header className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <h3 id={`novidade-${item.runId}`} className="break-words text-base font-medium">
          {item.monitorName}
        </h3>
        {item.isDemo ? <DemoBadge /> : null}
        <Badge variant="outline">Busca recorrente</Badge>
      </header>
      <p className="text-xs text-muted-foreground">
        Rodou em <time dateTime={item.occurredAt}>{formatDateTime(item.occurredAt)}</time>.
      </p>
      <p className="text-sm">
        Achou <span className="font-medium">{companies}</span>, que nenhuma pesquisa tinha visto
        antes.{' '}
        <Link href={discoveryRoutes.run(item.runId)} className="underline underline-offset-4">
          Ver resultado
          <span className="sr-only">
            {' '}
            de {item.monitorName} em {formatDateTime(item.occurredAt)}
          </span>
        </Link>
      </p>
    </article>
  );
}

const EMPTY_TEXT: Record<MonitoringFeedFilter, string> = {
  all: 'Nenhuma novidade ainda.',
  companies: 'Nenhuma mudança nas empresas ainda.',
  discovery: 'Nenhuma empresa nova das buscas recorrentes ainda.',
};

export function MonitoringFeed({
  items,
  filter,
  discoveryOn,
}: {
  items: readonly MonitoringFeedItem[];
  filter: MonitoringFeedFilter;
  /** Descoberta desligada: o vazio não manda criar busca recorrente. */
  discoveryOn: boolean;
}) {
  if (items.length === 0) {
    return (
      <Well className="space-y-2 text-sm text-muted-foreground" data-feed-empty={filter}>
        <p className="font-medium text-foreground">{EMPTY_TEXT[filter]}</p>
        {filter !== 'discovery' ? (
          <p>
            Uma mudança aparece quando uma empresa é investigada pela segunda vez e algo difere da
            investigação anterior. Investigue em{' '}
            <Link href={companyRoutes.list} className="underline underline-offset-4">
              Empresas
            </Link>
            .
          </p>
        ) : null}
        {filter !== 'companies' && discoveryOn ? (
          <p>
            Empresas novas aparecem quando uma busca recorrente roda e acha alguém que nenhuma
            pesquisa tinha visto. Crie ou rode uma em{' '}
            <Link href={discoveryRoutes.monitors} className="underline underline-offset-4">
              Descobrir › Monitoramentos
            </Link>
            .
          </p>
        ) : null}
      </Well>
    );
  }
  return (
    <ul className="divide-y divide-border">
      {items.map((item) => (
        <li
          key={item.kind === 'company_change' ? item.investigationId : item.runId}
          className="py-4 first:pt-0 last:pb-0"
          data-feed-item={item.kind}
        >
          {item.kind === 'company_change' ? (
            <CompanyChange item={item} />
          ) : (
            <DiscoveryNovelty item={item} />
          )}
        </li>
      ))}
    </ul>
  );
}
