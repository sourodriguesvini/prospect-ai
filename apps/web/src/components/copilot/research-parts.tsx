import {
  RESEARCH_AUDIENCE_LABELS,
  RESEARCH_SEGMENT_LABELS,
  RESEARCH_STATUS_LABELS,
  type CopilotResearch,
  type ResearchItemView,
  type ResearchStatus,
  type UF,
} from '@prospector/contracts';
import { regionsWithout, researchBreakdown } from '@prospector/domain';
import { Badge, DemoBadge, StatusDot, type BadgeProps } from '@prospector/ui';
import { ExternalLink } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { safeHref } from '@/components/companies/claim-card';
import { ActionButton } from '@/components/discovery/discovery-forms';
import type { FormAction } from '@/components/forms/use-action-form';
import { formatDate, formatDateTime } from '@/lib/format';
import { hostOf, itemPlace, researchRoutes, researchTitle } from '@/lib/research-labels';

const STATUS_VARIANT: Record<ResearchStatus, NonNullable<BadgeProps['variant']>> = {
  queued: 'accent',
  running: 'accent',
  paused: 'warning',
  done: 'success',
  failed: 'danger',
  cancelled: 'outline',
};

export function ResearchStatusBadge({ status }: { status: ResearchStatus }) {
  return <Badge variant={STATUS_VARIANT[status]}>{RESEARCH_STATUS_LABELS[status]}</Badge>;
}

export function isResearchOpen(research: Pick<CopilotResearch, 'status'>): boolean {
  return (
    research.status === 'queued' || research.status === 'running' || research.status === 'paused'
  );
}

/** Créditos de busca usados e o teto da pesquisa ("3 de até 40 créditos de busca"). */
export function creditsLine(research: Pick<CopilotResearch, 'creditCap' | 'progress'>): string {
  return `${research.progress.creditsUsed} de até ${research.creditCap} ${
    research.creditCap === 1 ? 'crédito' : 'créditos'
  } de busca`;
}

/** Cartão de uma pesquisa (coluna do Copiloto e lista de pesquisas). */
export function ResearchCard({
  research,
  showDate = false,
}: {
  research: CopilotResearch;
  showDate?: boolean;
}) {
  return (
    <div className="space-y-1.5 rounded-2xl border border-border px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <Link
          href={researchRoutes.detail(research.id)}
          title={`Abrir a pesquisa: ${researchTitle(research)}`}
          className="min-w-0 font-medium underline-offset-4 [overflow-wrap:anywhere] hover:underline"
        >
          {researchTitle(research)}
        </Link>
        {research.isDemo ? <DemoBadge /> : null}
        <ResearchStatusBadge status={research.status} />
      </div>
      <p className="text-sm text-muted-foreground">
        Para {research.profileName} · {research.foundCount} de {research.requestedCount} achados ·{' '}
        {creditsLine(research)}
      </p>
      {showDate ? (
        <p className="text-xs text-muted-foreground">
          Criada em {formatDateTime(research.createdAt)}
        </p>
      ) : null}
    </div>
  );
}

/**
 * O motivo vem como "Segmento (papel para o perfil): por quê". A tabela já mostra segmento e papel;
 * aqui fica só o porquê (com o termo que a regra achou no texto da fonte).
 */
function reasonOnly(fitReason: string): string {
  const at = fitReason.indexOf('): ');
  if (at < 0) return fitReason;
  const reason = fitReason.slice(at + 3);
  return reason.charAt(0).toUpperCase() + reason.slice(1);
}

const BASIS_NOTE: Record<ResearchItemView['locationBasis'], string | null> = {
  quote: null,
  query: 'pela região da busca; conferir',
  none: null,
};

/** Link para fora do app: ícone e aviso para leitor de tela de que abre em outra aba. */
function OutLink({ href, children }: { href: string; children: ReactNode }) {
  // O banco já valida o endereço (z.httpUrl); aqui é reforço: só http(s) vira link.
  const safe = safeHref(href);
  if (!safe) return <span className="[overflow-wrap:anywhere]">{children}</span>;
  return (
    <a
      href={safe}
      target="_blank"
      rel="noreferrer noopener"
      className="inline-flex items-start gap-1 underline underline-offset-4 [overflow-wrap:anywhere]"
    >
      <span className="min-w-0">{children}</span>
      <ExternalLink aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
      <span className="sr-only"> (abre em outra aba)</span>
    </a>
  );
}

/** Ações por linha que a página entrega (opt-out). */
export interface ResearchRowActions {
  optOut: (itemId: string) => FormAction;
}

function Approachability({ item }: { item: ResearchItemView }) {
  if (item.optedOut) {
    return <StatusDot tone="danger">Pediu para não ser contatada</StatusDot>;
  }
  if (item.kind === 'organization') {
    return item.approachable ? (
      <StatusDot tone="success">Organização, com sua aprovação</StatusDot>
    ) : (
      <StatusDot tone="danger">A organização pediu para não ser contatada</StatusDot>
    );
  }
  if (item.approachable && item.liaVersion !== null) {
    return (
      <StatusDot tone="success">Coberta pela LIA v{item.liaVersion}, com sua aprovação</StatusDot>
    );
  }
  return <StatusDot tone="warning">Só para revisão</StatusDot>;
}

function Retention({ item }: { item: ResearchItemView }) {
  return (
    <span className="block text-xs text-muted-foreground">
      Guardar até {formatDate(item.retentionUntil)}
    </span>
  );
}

/** Opt-out definitivo: pede confirmação antes (os meios de contato somem e não voltam). */
function OptOut({ item, actions }: { item: ResearchItemView; actions?: ResearchRowActions }) {
  if (!actions || item.kind !== 'person' || item.optedOut) return null;
  return (
    <details className="mt-2 text-xs">
      <summary className="cursor-pointer text-muted-foreground underline underline-offset-4">
        Registrar opt-out
      </summary>
      <div className="mt-2 space-y-2">
        <p>
          A pessoa pediu para não ser contatada? O registro é definitivo: o contato some, o trecho
          fica só com o nome e ela não entra em pesquisas novas.
        </p>
        <ActionButton action={actions.optOut(item.id)} pendingLabel="Registrando…">
          Confirmar opt-out de {item.name}
        </ActionButton>
      </div>
    </details>
  );
}

function Contact({ item }: { item: ResearchItemView }) {
  const lines: ReactNode[] = [];
  if (item.publicEmail) lines.push(<span key="email">{item.publicEmail}</span>);
  if (item.publicPhone) lines.push(<span key="phone">{item.publicPhone}</span>);
  for (const [key, url] of [
    ['site', item.website],
    ['perfil', item.profileUrl],
  ] as const) {
    if (!url) continue;
    lines.push(
      <OutLink key={key} href={url}>
        {key === 'site' ? 'Site' : 'Perfil'}: {hostOf(url)}
      </OutLink>,
    );
  }
  if (lines.length === 0) return <span className="text-muted-foreground">Nenhum na fonte</span>;
  return <span className="flex flex-col gap-0.5 [overflow-wrap:anywhere]">{lines}</span>;
}

function Who({ item }: { item: ResearchItemView }) {
  return (
    <>
      <span className="block font-medium [overflow-wrap:break-word]">{item.name}</span>
      <span className="block text-xs text-muted-foreground [overflow-wrap:break-word]">
        {[
          item.kind === 'organization' ? 'Organização' : null,
          item.roleTitle ?? item.profession,
          item.organization,
        ]
          .filter(Boolean)
          .join(' · ')}
      </span>
    </>
  );
}

function Role({ item }: { item: ResearchItemView }) {
  return (
    <>
      <span className="block">{RESEARCH_AUDIENCE_LABELS[item.audienceRole]}</span>
      <span className="block text-xs text-muted-foreground">
        {RESEARCH_SEGMENT_LABELS[item.segment]}: {reasonOnly(item.fitReason)}
      </span>
    </>
  );
}

function Place({ item }: { item: ResearchItemView }) {
  const place = itemPlace(item);
  const basis = BASIS_NOTE[item.locationBasis];
  return (
    <>
      {place ?? <span className="text-muted-foreground">Não informado</span>}
      {place && basis ? <span className="block text-xs text-muted-foreground">{basis}</span> : null}
    </>
  );
}

function Source({ item }: { item: ResearchItemView }) {
  return (
    <>
      <OutLink href={item.sourceUrl}>{hostOf(item.sourceUrl)}</OutLink>
      <blockquote className="mt-1 border-l-2 border-border pl-2 text-xs text-muted-foreground [overflow-wrap:anywhere]">
        “{item.sourceQuote}”
      </blockquote>
      <span className="mt-1 block text-xs text-muted-foreground">
        Visto na fonte em {formatDateTime(item.verifiedAt)}
      </span>
    </>
  );
}

function Approach({ item, actions }: { item: ResearchItemView; actions?: ResearchRowActions }) {
  return (
    <>
      <Approachability item={item} />
      <Retention item={item} />
      <OptOut item={item} actions={actions} />
    </>
  );
}

const ROLE_HEADER = 'Papel provável (por regra, a conferir)';

/**
 * Resultados da pesquisa para revisão humana: cada linha com a fonte, o trecho em que aparece e
 * se pode ser abordada. Tabela a partir da largura média; cartões no celular. Nada aqui contata
 * ninguém.
 */
export function ResearchItemsTable({
  items,
  actions,
}: {
  items: readonly ResearchItemView[];
  actions?: ResearchRowActions;
}) {
  return (
    <>
      <ul className="space-y-3 md:hidden" aria-label="Resultados da pesquisa">
        {items.map((item) => (
          <li
            key={item.id}
            className="space-y-3 rounded-[var(--radius-tile)] border border-border p-4 text-sm"
          >
            <div>
              <Who item={item} />
            </div>
            {/* Cada par dt/dd num div filho direto do dl (axe: definition-list e dlitem); Local e
                Contato lado a lado só a partir de 400 px. */}
            <dl className="grid grid-cols-1 gap-3 min-[400px]:grid-cols-2">
              <div className="min-[400px]:col-span-2">
                <dt className="text-xs font-medium text-muted-foreground">{ROLE_HEADER}</dt>
                <dd>
                  <Role item={item} />
                </dd>
              </div>
              <div className="min-w-0">
                <dt className="text-xs font-medium text-muted-foreground">Local</dt>
                <dd>
                  <Place item={item} />
                </dd>
              </div>
              <div className="min-w-0">
                <dt className="text-xs font-medium text-muted-foreground">Contato público</dt>
                <dd>
                  <Contact item={item} />
                </dd>
              </div>
              <div className="min-[400px]:col-span-2">
                <dt className="text-xs font-medium text-muted-foreground">Fonte</dt>
                <dd>
                  <Source item={item} />
                </dd>
              </div>
              <div className="min-[400px]:col-span-2">
                <dt className="text-xs font-medium text-muted-foreground">Abordagem</dt>
                <dd>
                  <Approach item={item} actions={actions} />
                </dd>
              </div>
            </dl>
          </li>
        ))}
      </ul>
      <div
        className="hidden overflow-x-auto md:block"
        tabIndex={0}
        role="region"
        aria-label="Tabela de resultados (role para os lados se precisar)"
      >
        <table className="w-full min-w-[52rem] table-fixed text-left text-sm">
          <caption className="sr-only">
            Resultados da pesquisa, com a fonte e o trecho de cada um
          </caption>
          <colgroup>
            <col className="w-[15%]" />
            <col className="w-[21%]" />
            <col className="w-[11%]" />
            <col className="w-[13%]" />
            <col className="w-[24%]" />
            <col className="w-[16%]" />
          </colgroup>
          <thead className="text-xs text-muted-foreground">
            <tr className="[&>th]:bg-muted [&>th]:px-2 [&>th]:py-3 [&>th]:font-medium [&>th:first-child]:rounded-l-full [&>th:first-child]:pl-4 [&>th:last-child]:rounded-r-full [&>th:last-child]:pr-4">
              <th scope="col">Nome</th>
              <th scope="col">{ROLE_HEADER}</th>
              <th scope="col">Local</th>
              <th scope="col">Contato público</th>
              <th scope="col">Fonte</th>
              <th scope="col">Abordagem</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr
                key={item.id}
                className="border-b align-top last:border-b-0 [&>td]:px-2 [&>td]:py-3.5 [&>td:first-child]:pl-4 [&>td:last-child]:pr-4"
              >
                <th scope="row" className="px-2 py-3.5 pl-4 text-left font-normal">
                  <Who item={item} />
                </th>
                <td>
                  <Role item={item} />
                </td>
                <td>
                  <Place item={item} />
                </td>
                <td>
                  <Contact item={item} />
                </td>
                <td>
                  <Source item={item} />
                </td>
                <td>
                  <Approach item={item} actions={actions} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function joinPt(parts: readonly string[]): string {
  if (parts.length <= 1) return parts.join('');
  return `${parts.slice(0, -1).join(', ')} e ${parts[parts.length - 1]}`;
}

/**
 * Como os achados se distribuem (Parte 8, Caso 2): por região e estado, por segmento e por papel
 * para o perfil. Só conta o que está gravado; quem pediu opt-out fica fora.
 */
export function ResearchBreakdownSection({
  items,
  scopeUfs = [],
}: {
  items: readonly ResearchItemView[];
  /** Estados do pedido; vazio = Brasil inteiro. */
  scopeUfs?: readonly UF[];
}) {
  const breakdown = researchBreakdown(items);
  if (breakdown.total === 0) return null;
  const missing = regionsWithout(breakdown, scopeUfs);
  const optedOut = items.filter((item) => item.optedOut).length;
  return (
    <section aria-labelledby="distribuicao" className="space-y-3">
      <h3 id="distribuicao" className="text-sm font-medium">
        Como os achados se distribuem
      </h3>
      <div className="grid gap-4 text-sm md:grid-cols-3">
        <div className="min-w-0 space-y-1">
          <h4 className="text-xs text-muted-foreground">Por região</h4>
          <ul className="space-y-1">
            {/* "Rótulo: N" (o número antes do rótulo no singular dava "3 Comprador"). */}
            {breakdown.regions.map((region) => (
              <li key={region.label} className="[overflow-wrap:anywhere]">
                {region.region ? region.label : 'Estado não identificado'}:{' '}
                <span className="font-medium tabular-nums">{region.count}</span>
                {region.ufs.length > 0 ? (
                  <span className="text-muted-foreground">
                    {' '}
                    ({region.ufs.map((item) => `${item.uf} ${item.count}`).join(', ')})
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
          {missing.length > 0 ? (
            <p className="text-xs text-muted-foreground">
              Nenhum achado {missing.length === 1 ? 'na região' : 'nas regiões'} {joinPt(missing)}.
            </p>
          ) : null}
          {breakdown.locationFromQueryOnly > 0 ? (
            <p className="text-xs text-muted-foreground">
              {breakdown.locationFromQueryOnly === 1
                ? '1 achado tem o estado só pela região da busca (o trecho não diz): conferir.'
                : `${breakdown.locationFromQueryOnly} achados têm o estado só pela região da busca (o trecho não diz): conferir.`}
            </p>
          ) : null}
        </div>
        <div className="min-w-0 space-y-1">
          <h4 className="text-xs text-muted-foreground">Por segmento</h4>
          <ul className="space-y-1">
            {breakdown.segments.map((item) => (
              <li key={item.segment}>
                {item.segment === 'unknown' ? 'Segmento não identificado' : item.label}:{' '}
                <span className="font-medium tabular-nums">{item.count}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="min-w-0 space-y-1">
          <h4 className="text-xs text-muted-foreground">Papel provável para o perfil</h4>
          <ul className="space-y-1">
            {breakdown.roles.map((item) => (
              <li key={item.role}>
                {item.role === 'unknown' ? 'Papel não identificado' : item.label}:{' '}
                <span className="font-medium tabular-nums">{item.count}</span>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">
            Estimado pelo texto da fonte, a conferir em cada linha.
          </p>
        </div>
      </div>
      {optedOut > 0 ? (
        <p className="text-xs text-muted-foreground">
          Quem pediu opt-out fica fora destas contagens (
          {optedOut === 1 ? '1 achado' : `${optedOut} achados`}).
        </p>
      ) : null}
    </section>
  );
}
