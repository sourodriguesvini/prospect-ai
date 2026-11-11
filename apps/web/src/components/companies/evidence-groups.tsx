import type { ClaimView } from '@prospector/application';
import { ClaimDomain, type Source, type SourceReliabilityTier } from '@prospector/contracts';
import { DemoBadge } from '@prospector/ui';
import { ExternalLink } from 'lucide-react';
import { ClaimBadges, ClaimCard, safeHref } from '@/components/companies/claim-card';
import { RELIABILITY_TIER_NOTES, SOURCE_PROVIDER_NAMES } from '@/lib/company-labels';
import { formatDate, formatDateTime } from '@/lib/format';

interface SourceGroup {
  key: string;
  source: Source | null;
  tier: SourceReliabilityTier | null;
  views: ClaimView[];
}

const DOMAIN_ORDER = new Map(ClaimDomain.options.map((domain, index) => [domain, index]));

/** Ordem dos fatos do registro da Receita (a mesma do texto guardado); outras chaves depois. */
const KEY_ORDER = new Map(
  [
    'registry.legal_name',
    'registry.trade_name',
    'registry.status',
    'registry.establishment_type',
    'registry.activity_start',
    'registry.cnae_main',
    'registry.cnae_secondary',
    'registry.legal_nature',
    'registry.size',
    'registry.tax_regime',
    'registry.location',
    'registry.share_capital',
  ].map((key, index) => [key, index]),
);

function compareViews(a: ClaimView, b: ClaimView): number {
  return (
    (DOMAIN_ORDER.get(a.claim.domain) ?? 99) - (DOMAIN_ORDER.get(b.claim.domain) ?? 99) ||
    (KEY_ORDER.get(a.claim.key) ?? 99) - (KEY_ORDER.get(b.claim.key) ?? 99)
  );
}

/** Agrupa os claims pela fonte da primeira evidência, na ordem dos domínios e do registro. */
function groupBySource(views: readonly ClaimView[]): SourceGroup[] {
  const groups = new Map<string, SourceGroup>();
  const ordered = [...views].sort(compareViews);
  for (const view of ordered) {
    const first = view.evidence[0];
    const key = first?.source?.id ?? 'sem-fonte';
    const group = groups.get(key) ?? {
      key,
      source: first?.source ?? null,
      tier: first?.evidence.reliabilityTier ?? null,
      views: [],
    };
    group.views.push(view);
    groups.set(key, group);
  }
  return [...groups.values()];
}

/** Mesmos selos em todo o grupo: aparecem uma vez, no topo. */
function uniformBadges(views: readonly ClaimView[]): boolean {
  const [first, ...rest] = views;
  if (!first) return false;
  return rest.every(
    (view) =>
      view.claim.epistemicType === first.claim.epistemicType &&
      view.claim.confidence === first.claim.confidence &&
      view.band === first.band &&
      view.status === first.status &&
      view.claim.isDemo === first.claim.isDemo,
  );
}

/** Mesmo prazo em todo o grupo (o capital social, por exemplo, vale por outro prazo). */
function uniformValidity(views: readonly ClaimView[]): boolean {
  const [first, ...rest] = views;
  return first !== undefined && rest.every((v) => v.claim.validUntil === first.claim.validUntil);
}

/** Data da base da Receita, lida da linha "extração de dd/mm/aaaa" do texto guardado. */
function registryBaseDate(source: Source): string | null {
  return source.excerptText?.match(/extração de (\d{2}\/\d{2}\/\d{4})/)?.[1] ?? null;
}

function groupTitle(source: Source | null): string {
  if (!source) return 'Sem fonte registrada';
  if (source.kind === 'api_record') return 'Dados do registro';
  return source.title ?? source.provider ?? 'Fonte sem título';
}

function SourceBox({ source }: { source: Source }) {
  const href = safeHref(source.url);
  const provider = source.provider
    ? (SOURCE_PROVIDER_NAMES[source.provider] ?? source.provider)
    : null;
  const base = registryBaseDate(source);
  return (
    <div className="space-y-2 rounded-[var(--radius-tile)] bg-muted px-4 py-3 text-sm">
      <p className="flex flex-wrap items-center gap-2 font-medium [overflow-wrap:anywhere]">
        {source.title ?? provider ?? 'Fonte sem título'}
        {source.isDemo ? <DemoBadge /> : null}
      </p>
      <ul className="space-y-0.5 text-muted-foreground">
        {provider ? (
          <li>
            Via {provider}
            {base ? `, base da Receita de ${base}` : ''}
          </li>
        ) : null}
        <li>Consultada em {formatDateTime(source.capturedAt)}</li>
        {source.retentionUntil ? <li>Guardada até {formatDate(source.retentionUntil)}</li> : null}
      </ul>
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noreferrer noopener"
          className="inline-flex items-center gap-1 underline underline-offset-4"
        >
          {provider ? `Ver os dados atuais em ${provider} (formato técnico)` : 'Abrir a fonte'}
          <ExternalLink aria-hidden="true" className="size-3.5 shrink-0" />
          <span className="sr-only"> (abre em nova aba)</span>
        </a>
      ) : null}
      {source.licenseNote ? (
        <p className="text-xs text-muted-foreground">{source.licenseNote}</p>
      ) : null}
      {source.excerptText ? (
        <details className="text-xs">
          <summary className="cursor-pointer underline underline-offset-4">
            Ver texto guardado
          </summary>
          <pre className="mt-2 whitespace-pre-wrap font-sans text-muted-foreground [overflow-wrap:anywhere]">
            {source.excerptText}
          </pre>
        </details>
      ) : null}
    </div>
  );
}

/** Claims do dossiê agrupados por fonte, com a fonte e os selos comuns uma vez por grupo. */
export function EvidenceGroups({ views }: { views: readonly ClaimView[] }) {
  return (
    <div className="space-y-8">
      {groupBySource(views).map((group) => {
        const headingId = `fonte-${group.key}`;
        const badges = uniformBadges(group.views);
        const validity = badges && uniformValidity(group.views);
        const first = group.views[0];
        return (
          <div key={group.key} role="group" aria-labelledby={headingId} className="space-y-3">
            <h3 id={headingId} className="text-sm font-medium">
              {groupTitle(group.source)}
            </h3>
            {group.source ? <SourceBox source={group.source} /> : null}
            {badges && first ? (
              <div className="space-y-1">
                <ClaimBadges view={first} withValidity={validity} />
                {group.tier ? (
                  <p className="text-xs text-muted-foreground">
                    {RELIABILITY_TIER_NOTES[group.tier]}
                  </p>
                ) : null}
              </div>
            ) : null}
            <ul className="divide-y">
              {group.views.map((view) => (
                <ClaimCard
                  key={view.claim.id}
                  view={view}
                  shared={{ sourceId: group.source?.id ?? null, badges, validity }}
                />
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
