import type { ReadinessCode, ReadinessGate, ReadinessItem } from '@prospector/contracts';
import { Alert, Badge, StatusDot, Well } from '@prospector/ui';
import { CircleCheck, CircleDashed, CircleAlert } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { formatDateTime } from '@/lib/format';
import { strategyRoutes } from '@/lib/strategy-routes';
import type { StorageMode } from '@/server/env';

/** Trilha de navegação + título da página. */
export function PageHeader({
  trail,
  title,
  badges,
  description,
  actions,
}: {
  trail: readonly { href: string; label: string }[];
  title: ReactNode;
  badges?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="space-y-2">
        <nav aria-label="Trilha" className="text-sm text-muted-foreground">
          <ol className="flex flex-wrap items-center gap-1.5">
            {trail.map((item, index) => (
              <li key={item.href} className="flex items-center gap-1.5">
                {index > 0 ? <span aria-hidden="true">/</span> : null}
                <Link href={item.href} className="underline underline-offset-4">
                  {item.label}
                </Link>
              </li>
            ))}
          </ol>
        </nav>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-balance text-4xl tracking-[-0.03em]">{title}</h1>
          {badges}
        </div>
        {description ? (
          <p className="max-w-3xl text-pretty text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

/** Aviso permanente do modo memória: nada do que for salvo sobrevive a um reinício. */
export function StorageNotice({ storage }: { storage: StorageMode }) {
  if (storage !== 'memory') return null;
  return (
    <Alert tone="warning" role="note">
      <strong>Modo memória.</strong> Os dados ficam só na memória do servidor e somem quando o app
      reinicia. Use para testar as telas; para trabalho real, configure o banco
      (docs/runbooks/ambiente-local.md).
    </Alert>
  );
}

/** Banco não configurado, fora do ar ou sem migrações: a tela explica em vez de quebrar. */
export function Unavailable({ message }: { message: string }) {
  return (
    <Alert tone="warning" role="status">
      {message}
    </Alert>
  );
}

const ITEM_ICON = {
  ok: CircleCheck,
  blocking: CircleAlert,
  optional: CircleDashed,
};

/** Onde resolver cada item (com a oferta avaliada, quando o item depende dela). */
function fixHref(code: ReadinessCode, offerId: string | null): string | null {
  switch (code) {
    case 'offer_complete':
      return offerId ? strategyRoutes.editOffer(offerId) : strategyRoutes.newOffer;
    case 'rubric':
      return offerId ? strategyRoutes.rubric(offerId) : null;
    case 'scoring_model':
      return offerId ? strategyRoutes.scoring(offerId) : null;
    case 'offer_active':
    case 'icp_active':
      return offerId ? strategyRoutes.offer(offerId) : null;
    case 'voice_guide':
      return strategyRoutes.voice;
    case 'contact_policy':
      return strategyRoutes.contactPolicy;
    case 'lia_approved':
      return strategyRoutes.compliance;
    case 'public_case':
      return strategyRoutes.cases;
    case 'persistent_storage':
      return null;
  }
}

function ReadinessRow({
  item,
  code,
  href,
}: {
  item: Pick<ReadinessItem, 'label' | 'ok' | 'blocking' | 'detail'>;
  code: string;
  href: string | null;
}) {
  const kind = item.ok ? 'ok' : item.blocking ? 'blocking' : 'optional';
  const Icon = ITEM_ICON[kind];
  return (
    <li
      className="flex gap-3 py-3"
      data-readiness={code}
      data-ok={item.ok}
      data-blocking={item.blocking}
    >
      <Icon
        aria-hidden="true"
        className={
          kind === 'ok'
            ? 'mt-0.5 size-4 shrink-0 text-success'
            : kind === 'blocking'
              ? 'mt-0.5 size-4 shrink-0 text-warning'
              : 'mt-0.5 size-4 shrink-0 text-muted-foreground'
        }
      />
      <div className="min-w-0 space-y-0.5">
        <p className="text-sm font-medium">
          {item.label}
          {item.ok || item.blocking ? (
            <span className="sr-only">{item.ok ? ': atendido' : ': falta (bloqueia)'}</span>
          ) : (
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              <span className="sr-only">: </span>recomendado
            </span>
          )}
        </p>
        <p className="text-pretty text-sm text-muted-foreground">{item.detail}</p>
        {!item.ok && href ? (
          <Link href={href} className="text-sm font-medium underline underline-offset-4">
            Resolver<span className="sr-only">: {item.label}</span>
          </Link>
        ) : null}
      </div>
    </li>
  );
}

const missingText = (count: number) => (count === 1 ? 'falta 1' : `faltam ${count}`);

/** Checklist de prontidão de uma barreira (descobrir ou abordar). */
export function ReadinessChecklist({
  gate,
  title,
  titleId,
  readyText,
  blockedText,
  headingLevel = 'h3',
  offerName,
  summarize,
}: {
  gate: ReadinessGate;
  title: string;
  titleId: string;
  readyText: string;
  blockedText: string;
  /** Nível do título conforme a página (sem pular níveis). */
  headingLevel?: 'h2' | 'h3';
  /** Nome da oferta avaliada, quando há uma. */
  offerName?: string | null;
  /** Resume itens já listados em outro checklist numa linha só (ex.: os de descoberta). */
  summarize?: { codes: readonly ReadinessCode[]; label: string };
}) {
  const Heading = headingLevel;
  const missing = gate.items.filter((i) => !i.ok && i.blocking).length;
  const summarized = summarize ? gate.items.filter((i) => summarize.codes.includes(i.code)) : [];
  const summarizedMissing = summarized.filter((i) => !i.ok && i.blocking).length;
  const rest = summarize ? gate.items.filter((i) => !summarize.codes.includes(i.code)) : gate.items;
  return (
    <section aria-labelledby={titleId} className="space-y-3" data-gate-ready={gate.ready}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Heading id={titleId} className="text-base font-semibold">
          {title}
        </Heading>
        <Badge variant={gate.ready ? 'success' : 'warning'}>
          <StatusDot tone={gate.ready ? 'success' : 'warning'}>
            {gate.ready ? 'Liberado' : `Bloqueado · ${missingText(missing)}`}
          </StatusDot>
        </Badge>
      </div>
      <p className="text-sm text-muted-foreground">{gate.ready ? readyText : blockedText}</p>
      {offerName ? (
        <p className="text-sm text-muted-foreground">
          Avaliado com a oferta <span className="font-medium text-foreground">{offerName}</span>.
        </p>
      ) : null}
      <ul className="divide-y">
        {summarize && summarized.length > 0 ? (
          <ReadinessRow
            code="summary"
            href={null}
            item={{
              label: summarize.label,
              ok: summarizedMissing === 0,
              blocking: true,
              detail:
                summarizedMissing === 0
                  ? 'Atendido.'
                  : `${summarizedMissing === 1 ? 'Falta 1 item' : `Faltam ${summarizedMissing} itens`}; veja a lista ao lado.`,
            }}
          />
        ) : null}
        {rest.map((item) => (
          <ReadinessRow
            key={item.code}
            code={item.code}
            item={item}
            href={fixHref(item.code, gate.offerId)}
          />
        ))}
      </ul>
    </section>
  );
}

/** Histórico de versões (mais recente primeiro). Versões nunca mudam depois de salvas. */
export function VersionHistory({
  versions,
  describe,
}: {
  versions: readonly { id: string; version: number; createdAt: string }[];
  describe?: (version: number) => ReactNode;
}) {
  if (versions.length === 0) {
    return (
      <Well className="py-6 text-center text-sm text-muted-foreground">
        Nenhuma versão salva ainda.
      </Well>
    );
  }
  return (
    <ol className="divide-y">
      {versions.map((v, index) => (
        <li key={v.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
          <span className="flex items-center gap-2">
            <span className="font-medium">v{v.version}</span>
            {index === 0 ? <Badge variant="neutral">atual</Badge> : null}
            {describe ? <span className="text-muted-foreground">{describe(v.version)}</span> : null}
          </span>
          <time dateTime={v.createdAt} className="text-muted-foreground">
            {formatDateTime(v.createdAt)}
          </time>
        </li>
      ))}
    </ol>
  );
}

/** Lista curta em texto (itens da oferta, filtros do ICP). */
export function TermList({
  items,
  empty = 'Não informado.',
}: {
  items: readonly string[];
  empty?: string;
}) {
  if (items.length === 0) return <p className="text-sm text-muted-foreground">{empty}</p>;
  return (
    <ul className="list-disc space-y-0.5 pl-5 text-sm">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}
