import type { ClaimView } from '@prospector/application';
import {
  ACTIVE_INVESTIGATION_STATUSES,
  INVESTIGATION_ISSUE_MESSAGES,
  INVESTIGATION_KEYS,
  INVESTIGATION_STATUS_LABELS,
  INVESTIGATION_STEP_LABELS,
  NEXT_STEP_LABELS,
  RECOMMENDATION_LABELS,
  type Company,
  type FitCheck,
  type Investigation,
  type InvestigationStatus,
  type InvestigationStepState,
  type OfferAssessment,
  type Recommendation,
} from '@prospector/contracts';
import {
  Badge,
  DemoBadge,
  Panel,
  PanelHeader,
  StatusDot,
  Well,
  type StatusTone,
} from '@prospector/ui';
import Link from 'next/link';
import type { ReactNode } from 'react';
import {
  cancelInvestigationAction,
  confirmSiteAction,
  resumeInvestigationAction,
  startInvestigationAction,
} from '@/app/(shell)/empresas/actions';
import { ClaimCard } from '@/components/companies/claim-card';
import {
  InvestigationAutoRefresh,
  SiteConfirmForm,
} from '@/components/companies/investigation-controls';
import { StatusButton } from '@/components/strategy/decision-forms';
import { companyRoutes } from '@/lib/company-routes';
import { formatDate, formatDateTime } from '@/lib/format';
import type { InvestigationPanelData } from '@/server/investigations';

/**
 * Painéis da investigação no dossiê (ADR-0015). Tudo o que se afirma vem do ledger (ClaimView,
 * com tipo, confiança e fonte); o diagnóstico só compõe: Fit, Opportunity e Confidence aparecem
 * separados e nunca como probabilidade de fechar negócio.
 */

const STATUS_VARIANT: Record<
  InvestigationStatus,
  'neutral' | 'success' | 'warning' | 'danger' | 'outline' | 'accent'
> = {
  queued: 'outline',
  running: 'accent',
  succeeded: 'success',
  partial: 'warning',
  failed: 'danger',
  cancelled: 'outline',
  interrupted: 'warning',
};

const STEP_STATE: Record<InvestigationStepState, { label: string; tone: StatusTone }> = {
  pending: { label: 'a fazer', tone: 'neutral' },
  running: { label: 'em andamento', tone: 'accent' },
  done: { label: 'feita', tone: 'success' },
  reused: { label: 'reaproveitada da anterior', tone: 'success' },
  skipped: { label: 'pulada', tone: 'warning' },
  failed: { label: 'sem resultado', tone: 'danger' },
};

const RECOMMENDATION_VARIANT: Record<
  Recommendation,
  'success' | 'accent' | 'neutral' | 'warning' | 'outline'
> = {
  pursue: 'success',
  prepare_access: 'accent',
  investigate_more: 'neutral',
  monitor: 'neutral',
  discard: 'outline',
  insufficient_evidence: 'warning',
};

const FIT_CRITERIA: Record<FitCheck['criterion'], string> = {
  cnae: 'Atividade (CNAE)',
  uf: 'Estado',
  municipality: 'Município',
  size: 'Porte',
  age: 'Tempo de atividade',
  exclusion: 'Exclusões',
  registry_status: 'Situação na Receita',
};

/** Claims em vigor cuja chave começa com o prefixo, na ordem do dossiê. */
export function claimsWithPrefix(views: readonly ClaimView[], prefix: string): ClaimView[] {
  return views.filter((view) => view.claim.key.startsWith(prefix));
}

function claimsById(views: readonly ClaimView[], ids: readonly string[]): ClaimView[] {
  const byId = new Map(views.map((view) => [view.claim.id, view]));
  return ids.flatMap((id) => {
    const view = byId.get(id);
    return view ? [view] : [];
  });
}

/** `support`: todos os claims em vigor do dossiê, para cada conclusão mostrar o seu apoio. */
function ClaimList({
  views,
  support,
}: {
  views: readonly ClaimView[];
  support: readonly ClaimView[];
}) {
  const byId = new Map(support.map((view) => [view.claim.id, view]));
  return (
    <ul className="divide-y">
      {views.map((view) => (
        <ClaimCard key={view.claim.id} view={view} support={byId} />
      ))}
    </ul>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-medium">{title}</h3>
      {children}
    </section>
  );
}

function usageText(investigation: Investigation): string {
  const { usage } = investigation;
  const parts = [
    `${usage.searches} ${usage.searches === 1 ? 'busca' : 'buscas'} na internet (${usage.searchCredits} ${usage.searchCredits === 1 ? 'crédito' : 'créditos'} da Tavily)`,
    `${usage.pagesRead} ${usage.pagesRead === 1 ? 'página lida' : 'páginas lidas'}`,
    `${usage.captures} ${usage.captures === 1 ? 'captura' : 'capturas'}`,
    `${usage.modelCalls} ${usage.modelCalls === 1 ? 'análise' : 'análises'} da IA local (${Math.round(usage.modelMs / 1000)} s de GPU)`,
  ];
  return `${parts.join(' · ')}.`;
}

function StepList({ investigation }: { investigation: Investigation }) {
  return (
    <ol className="space-y-2 text-sm" aria-label="Etapas da investigação">
      {investigation.steps.map((step) => {
        const state = STEP_STATE[step.state];
        return (
          <li key={step.key} className="space-y-0.5">
            <StatusDot tone={state.tone}>
              <span>
                {INVESTIGATION_STEP_LABELS[step.key]}
                <span className="text-muted-foreground">: {state.label}</span>
              </span>
            </StatusDot>
            {step.issue ? (
              <p className="pl-3.5 text-xs text-muted-foreground">
                {INVESTIGATION_ISSUE_MESSAGES[step.issue]}
              </p>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

function StartButtons({ company, again }: { company: Company; again: boolean }) {
  return (
    <div className="flex flex-wrap gap-2">
      <StatusButton
        action={startInvestigationAction.bind(null, company.id, false)}
        label={again ? 'Investigar de novo' : 'Investigar empresa'}
        variant="primary"
        pendingLabel="Pondo na fila…"
      />
      {again ? (
        <StatusButton
          action={startInvestigationAction.bind(null, company.id, true)}
          label="Coletar tudo de novo"
          confirm="Coletar tudo de novo refaz todas as buscas (gasta créditos da Tavily) e todas as análises da IA local, mesmo o que ainda vale. Continuar?"
          pendingLabel="Pondo na fila…"
        />
      ) : null}
    </div>
  );
}

/** Painel lateral: estado, etapas, custo e ações (investigar, cancelar, retomar, confirmar site). */
export function InvestigationPanel({
  company,
  data,
  siteCandidates,
}: {
  company: Company;
  data: InvestigationPanelData | null;
  siteCandidates: readonly ClaimView[];
}) {
  const archived = company.lifecycle === 'archived';
  if (!data) {
    return (
      <Panel aria-labelledby="investigacao">
        <PanelHeader
          titleId="investigacao"
          title="Investigação"
          description="A investigação não está disponível agora (banco não configurado ou fora do ar)."
        />
      </Panel>
    );
  }
  const { latest, active } = data;
  const resumable =
    latest !== null && (latest.status === 'interrupted' || latest.status === 'failed');
  const candidates = [
    ...new Set(
      siteCandidates.flatMap((view) => {
        const domain = (view.claim.value as { domain?: unknown } | null)?.domain;
        return typeof domain === 'string' ? [domain] : [];
      }),
    ),
  ].slice(0, 6);

  let actions: ReactNode;
  if (archived) {
    actions = (
      <p className="text-sm text-muted-foreground">
        Empresa arquivada não é investigada. Mude a etapa para investigar.
      </p>
    );
  } else if (active && latest) {
    actions = (
      <div className="space-y-3">
        <InvestigationAutoRefresh />
        <p className="text-sm text-muted-foreground">
          Esta página se atualiza sozinha enquanto a investigação anda. Pode sair dela: a
          investigação continua no computador.
        </p>
        <StatusButton
          action={cancelInvestigationAction.bind(null, company.id, latest.id)}
          label="Cancelar investigação"
          confirm="Cancelar agora? O que já foi coletado fica guardado; a etapa atual para no meio."
          pendingLabel="Cancelando…"
          dismissLabel="Continuar investigando"
        />
      </div>
    );
  } else if (resumable && latest) {
    actions = (
      <div className="flex flex-wrap gap-2">
        <StatusButton
          action={resumeInvestigationAction.bind(null, company.id, latest.id)}
          label="Retomar de onde parou"
          variant="primary"
          pendingLabel="Retomando…"
        />
        <StartButtons company={company} again />
      </div>
    );
  } else {
    actions = <StartButtons company={company} again={latest !== null} />;
  }

  return (
    <Panel aria-labelledby="investigacao">
      <PanelHeader
        titleId="investigacao"
        title="Investigação"
        description={
          latest
            ? `Última: ${formatDateTime(latest.createdAt)}${latest.finishedAt ? `, terminou em ${formatDateTime(latest.finishedAt)}` : ''}.`
            : 'Lê o site, captura a marca no computador e no celular, procura sinais recentes e concorrentes e monta o diagnóstico com as ofertas. Usa poucas buscas na internet e a IA local; leva alguns minutos.'
        }
      />
      <div className="space-y-5">
        {latest ? (
          <>
            <p className="flex flex-wrap items-center gap-2" role="status">
              <Badge variant={STATUS_VARIANT[latest.status]}>
                {INVESTIGATION_STATUS_LABELS[latest.status]}
              </Badge>
              {latest.isDemo ? <DemoBadge /> : null}
              {latest.issue ? (
                <span className="text-sm text-muted-foreground">
                  {INVESTIGATION_ISSUE_MESSAGES[latest.issue]}
                </span>
              ) : null}
            </p>
            <StepList investigation={latest} />
            <p className="text-xs text-muted-foreground">Custo: {usageText(latest)}</p>
          </>
        ) : null}
        {actions}
        {!company.primaryDomain && !archived ? (
          <Section title="Site oficial">
            <p className="text-sm text-muted-foreground">
              Sem site confirmado, a investigação não lê páginas nem captura a marca.
              {candidates.length > 0
                ? ' Confira os candidatos que a pesquisa encontrou antes de confirmar.'
                : ''}
            </p>
            <SiteConfirmForm
              action={confirmSiteAction.bind(null, company.id)}
              candidates={candidates}
            />
          </Section>
        ) : null}
      </div>
    </Panel>
  );
}

function Score({
  label,
  value,
  note,
}: {
  label: string;
  value: number | string | null;
  note: string;
}) {
  return (
    <div className="min-w-0 rounded-[var(--radius-tile)] bg-muted px-3 py-2">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-lg font-medium tabular-nums">
        {value === null ? '—' : typeof value === 'number' ? `${value} de 100` : value}
      </dd>
      <dd className="text-xs text-muted-foreground">{note}</dd>
    </div>
  );
}

/**
 * Fit com menos da metade dos critérios conhecidos não vira número grande: "Pouco dado" e a
 * contagem (KI-132; a regra de cálculo é decisão de metodologia em aberto).
 */
function fitDisplay(offer: OfferAssessment): { value: number | string | null; note: string } {
  const checks = offer.fit.checks;
  const known = checks.filter((check) => check.met !== null);
  if (offer.fit.score === null) {
    return { value: null, note: 'Sem critérios do ICP para comparar.' };
  }
  const unknown = checks
    .filter((check) => check.met === null)
    .map((check) => FIT_CRITERIA[check.criterion].toLowerCase());
  const met = known.filter((check) => check.met).length;
  if (known.length * 2 < checks.length) {
    return {
      value: 'Pouco dado',
      note: `Atende ${met} de ${known.length} ${known.length === 1 ? 'critério conhecido' : 'critérios conhecidos'}; sem dado: ${unknown.join(', ')}.`,
    };
  }
  return {
    value: offer.fit.score,
    note: `${known.length} de ${checks.length} critérios com dado conhecido.`,
  };
}

/** Sugestões da IA guardadas no claim da leitura da oferta: texto da IA, não fato. */
function readingSuggestions(view: ClaimView | null) {
  const value = view?.claim.value ?? {};
  const strings = (list: unknown) =>
    (Array.isArray(list) ? list : []).filter((item): item is string => typeof item === 'string');
  return {
    openingAngle: typeof value.openingAngle === 'string' ? value.openingAngle : null,
    objections: strings(value.objections).slice(0, 4),
    toVerify: strings(value.toVerify).slice(0, 5),
  };
}

function OfferCard({ offer, views }: { offer: OfferAssessment; views: readonly ClaimView[] }) {
  const reading = offer.readingClaimId
    ? (claimsById(views, [offer.readingClaimId])[0] ?? null)
    : null;
  const opportunity = claimsById(
    views,
    offer.opportunity.claimIds.filter((id) => id !== offer.readingClaimId),
  );
  const fit = fitDisplay(offer);
  const suggestions = readingSuggestions(reading);
  const hasSuggestions =
    suggestions.openingAngle !== null ||
    suggestions.objections.length > 0 ||
    suggestions.toVerify.length > 0;
  return (
    <li className="space-y-3 py-4">
      <p className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{offer.offerName}</span>
        <Badge variant={RECOMMENDATION_VARIANT[offer.recommendation]}>
          {RECOMMENDATION_LABELS[offer.recommendation]}
        </Badge>
        <span className="text-sm text-muted-foreground">Prioridade {offer.priority} de 100</span>
      </p>
      <dl className="grid gap-2 sm:grid-cols-3">
        <Score label="Adequação ao ICP (Fit)" value={fit.value} note={fit.note} />
        <Score
          label="Necessidade observada"
          value={offer.opportunity.score}
          note={`${offer.opportunity.claimIds.length} ${offer.opportunity.claimIds.length === 1 ? 'registro ligado' : 'registros ligados'}.`}
        />
        <Score
          label="Força das evidências"
          value={offer.confidence.score}
          note={`${offer.confidence.coveredDimensions} de 5 dimensões cobertas.`}
        />
      </dl>
      {offer.fit.checks.length > 0 ? (
        <details className="text-sm">
          <summary className="cursor-pointer underline underline-offset-4">
            Critérios da adequação
          </summary>
          <ul className="mt-2 space-y-1">
            {offer.fit.checks.map((check) => (
              <li key={check.criterion}>
                <span className="font-medium">{FIT_CRITERIA[check.criterion]}:</span>{' '}
                {check.met === null ? 'dado desconhecido' : check.met ? 'atende' : 'não atende'}
                {' · '}
                <span className="text-muted-foreground">{check.text}</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      {offer.gates.length > 0 ? (
        <Section title="Desqualificadores acionados">
          <ul className="list-disc space-y-1 pl-5 text-sm">
            {offer.gates.map((gate) => (
              <li key={gate}>{gate}</li>
            ))}
          </ul>
        </Section>
      ) : null}
      {reading ? (
        <Section title="Leitura da IA para esta oferta">
          <ClaimList views={[reading]} support={views} />
        </Section>
      ) : (
        <p className="text-sm text-muted-foreground">
          Sem leitura da IA aceita para esta oferta: a necessidade conta só com a auditoria e os
          sinais.
        </p>
      )}
      {hasSuggestions ? (
        <Section title="Sugestões da IA (não são fatos sobre a empresa)">
          {suggestions.openingAngle ? (
            <p className="text-sm">
              <span className="font-medium">Ângulo de abordagem: </span>
              {suggestions.openingAngle}
            </p>
          ) : null}
          {suggestions.objections.length > 0 ? (
            <div className="space-y-1 text-sm">
              <p className="font-medium">Objeções prováveis</p>
              <ul className="list-disc space-y-1 pl-5">
                {suggestions.objections.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {suggestions.toVerify.length > 0 ? (
            <div className="space-y-1 text-sm">
              <p className="font-medium">Conferir antes de abordar</p>
              <ul className="list-disc space-y-1 pl-5">
                {suggestions.toVerify.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </Section>
      ) : null}
      {opportunity.length > 0 ? (
        <details className="text-sm">
          <summary className="cursor-pointer underline underline-offset-4">
            Outros registros usados na necessidade
          </summary>
          <ClaimList views={opportunity} support={views} />
        </details>
      ) : null}
    </li>
  );
}

/** Diagnóstico da última investigação concluída: só aparece quando existe. */
export function DiagnosisPanel({
  investigation,
  latest = null,
  views,
}: {
  investigation: Investigation | null;
  /** Investigação mais recente (pode ser mais nova que a do diagnóstico, em andamento ou sem diagnóstico). */
  latest?: Investigation | null;
  views: readonly ClaimView[];
}) {
  const diagnosis = investigation?.diagnosis;
  if (!investigation || !diagnosis) return null;
  const summary = diagnosis.summaryClaimId ? claimsById(views, [diagnosis.summaryClaimId]) : [];
  // A leitura central existia, mas uma coleta mais nova a substituiu (nova investigação).
  const summaryReplaced = diagnosis.summaryClaimId !== null && summary.length === 0;
  const newer = latest && latest.id !== investigation.id ? latest : null;
  const hypotheses = claimsById(views, diagnosis.hypothesisClaimIds);
  const models = investigation.models;
  return (
    <Panel aria-labelledby="diagnostico">
      <PanelHeader
        titleId="diagnostico"
        title="Diagnóstico"
        description={`Da investigação de ${formatDate(investigation.finishedAt ?? investigation.createdAt)}. Pontuações de 0 a 100 com critério explícito: não são probabilidade de fechar negócio.`}
      />
      <div className="space-y-6">
        {investigation.isDemo ? <DemoBadge /> : null}
        {newer ? (
          <Well className="py-3 text-sm">
            {ACTIVE_INVESTIGATION_STATUSES.includes(newer.status)
              ? `Há uma investigação mais nova em andamento (${formatDateTime(newer.createdAt)}). Este diagnóstico é o anterior e é trocado quando ela terminar.`
              : `A investigação de ${formatDateTime(newer.createdAt)} terminou sem diagnóstico (${INVESTIGATION_STATUS_LABELS[newer.status].toLowerCase()}). Este é o último diagnóstico montado.`}
          </Well>
        ) : null}
        <dl className="grid gap-2 sm:grid-cols-3">
          <div className="min-w-0 space-y-1">
            <dt className="text-xs text-muted-foreground">Recomendação</dt>
            <dd>
              <Badge variant={RECOMMENDATION_VARIANT[diagnosis.recommendation]}>
                {RECOMMENDATION_LABELS[diagnosis.recommendation]}
              </Badge>
            </dd>
          </div>
          <div className="min-w-0 space-y-1">
            <dt className="text-xs text-muted-foreground">Próximo passo</dt>
            <dd className="text-sm">{NEXT_STEP_LABELS[diagnosis.nextStep]}</dd>
          </div>
          <div className="min-w-0 space-y-1">
            <dt className="text-xs text-muted-foreground">Confiança geral</dt>
            <dd className="text-sm tabular-nums">{diagnosis.confidence} de 100</dd>
          </div>
        </dl>
        {summary.length > 0 ? (
          <Section title="Leitura central da investigação">
            <ClaimList views={summary} support={views} />
          </Section>
        ) : summaryReplaced ? (
          <Well className="py-4 text-sm text-muted-foreground">
            A leitura central desta investigação foi substituída por uma coleta mais nova. Ela volta
            a aparecer quando a nova investigação montar o diagnóstico.
          </Well>
        ) : (
          <Well className="py-4 text-sm text-muted-foreground">
            Sem base suficiente para uma leitura central da empresa nesta investigação.
          </Well>
        )}
        {diagnosis.offers.length > 0 ? (
          <Section title="Ofertas">
            <ul className="divide-y">
              {diagnosis.offers.map((offer) => (
                <OfferCard key={offer.offerId} offer={offer} views={views} />
              ))}
            </ul>
          </Section>
        ) : (
          <Well className="py-4 text-sm text-muted-foreground">
            Nenhuma oferta ativa para comparar: cadastre ou ative uma em{' '}
            <Link href="/configuracoes/estrategia" className="underline underline-offset-4">
              Estratégia
            </Link>{' '}
            (preço, rubrica e modelo de score preenchidos) e investigue de novo.
          </Well>
        )}
        {hypotheses.length > 0 ? (
          <Section title="Hipóteses a verificar">
            <ClaimList views={hypotheses} support={views} />
          </Section>
        ) : null}
        {diagnosis.gaps.length > 0 ? (
          <Section title="O que ainda não sabemos">
            <ul className="list-disc space-y-1 pl-5 text-sm">
              {diagnosis.gaps.map((gap) => (
                <li key={gap.code}>{gap.text}</li>
              ))}
            </ul>
          </Section>
        ) : null}
        {diagnosis.verification.discarded > 0 ? (
          <details className="text-sm">
            <summary className="cursor-pointer underline underline-offset-4">
              {diagnosis.verification.discarded === 1
                ? '1 conclusão da IA foi descartada na verificação'
                : `${diagnosis.verification.discarded} conclusões da IA foram descartadas na verificação`}
            </summary>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
              {diagnosis.verification.reasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          </details>
        ) : null}
        {models.length > 0 ? (
          <p className="text-xs text-muted-foreground">
            Análises feitas pela IA local:{' '}
            {models.map((use) => `${use.promptVersion} (${use.model})`).join(', ')}.
          </p>
        ) : null}
      </div>
    </Panel>
  );
}

function captureView(views: readonly ClaimView[], kind: 'site_desktop' | 'site_mobile') {
  return views.find((view) => view.claim.key === INVESTIGATION_KEYS.capture(kind)) ?? null;
}

function CaptureFigure({
  company,
  view,
  label,
}: {
  company: Company;
  view: ClaimView | null;
  label: string;
}) {
  if (!view) return null;
  const value = view.claim.value as {
    storagePath?: unknown;
    width?: unknown;
    height?: unknown;
    noArchive?: unknown;
  };
  const src =
    typeof value.storagePath === 'string'
      ? companyRoutes.capture(company.id, value.storagePath)
      : null;
  const width = typeof value.width === 'number' ? value.width : undefined;
  const height = typeof value.height === 'number' ? value.height : undefined;
  return (
    <figure className="min-w-0 space-y-2">
      {src ? (
        <a href={src} target="_blank" rel="noreferrer" className="block">
          {/* eslint-disable-next-line @next/next/no-img-element -- imagem local servida pela rota das capturas */}
          <img
            src={src}
            width={width}
            height={height}
            loading="lazy"
            alt={`Página inicial no ${label}, como capturada pelo Prospector.`}
            className="h-auto max-h-[28rem] w-full rounded-[var(--radius-tile)] border border-border object-cover object-top"
          />
          <span className="sr-only"> (abre a imagem inteira em nova aba)</span>
        </a>
      ) : (
        <Well className="py-6 text-center text-sm text-muted-foreground">
          {value.noArchive === true
            ? 'Imagem não guardada: o site pede para não guardar cópia. Ela foi usada só durante a investigação.'
            : 'Imagem não guardada (pasta das capturas não configurada).'}
        </Well>
      )}
      <figcaption className="text-xs text-muted-foreground">
        {label[0]?.toUpperCase()}
        {label.slice(1)} · {formatDateTime(view.claim.createdAt)}
      </figcaption>
    </figure>
  );
}

const HEX = /^#[0-9A-Fa-f]{6}$/;

function Palette({ view }: { view: ClaimView | null }) {
  if (!view) return null;
  const value = (view.claim.value ?? {}) as Record<string, unknown>;
  const groups: Array<[string, string[]]> = [
    ['Destaque', value.accent],
    ['Fundo', value.background],
    ['Texto', value.text],
  ].map(([label, list]) => [
    label as string,
    Array.isArray(list)
      ? list.filter((item): item is string => typeof item === 'string' && HEX.test(item))
      : [],
  ]);
  if (groups.every(([, colors]) => colors.length === 0)) return null;
  return (
    <Section title="Cores medidas no site">
      <dl className="space-y-2">
        {groups.map(([label, colors]) =>
          colors.length > 0 ? (
            <div key={label} className="flex flex-wrap items-center gap-2">
              <dt className="w-20 text-xs text-muted-foreground">{label}</dt>
              {colors.map((color) => (
                <dd key={color} className="inline-flex items-center gap-1.5 text-xs tabular-nums">
                  <span
                    aria-hidden="true"
                    className="size-5 rounded-full border border-border"
                    style={{ backgroundColor: color }}
                  />
                  {color}
                </dd>
              ))}
            </div>
          ) : null,
        )}
      </dl>
    </Section>
  );
}

/** Marca e site: capturas, cores e fontes medidas, auditoria visual (inferências) e medições. */
export function BrandPanel({ company, views }: { company: Company; views: readonly ClaimView[] }) {
  const desktop = captureView(views, 'site_desktop');
  const mobile = captureView(views, 'site_mobile');
  const audit = claimsWithPrefix(views, 'visual.audit.');
  const positioning = views.filter(
    (view) => view.claim.key === INVESTIGATION_KEYS.visualPositioning,
  );
  const typography = views.filter((view) => view.claim.key === INVESTIGATION_KEYS.typography);
  const palette = views.find((view) => view.claim.key === INVESTIGATION_KEYS.palette) ?? null;
  const metrics = claimsWithPrefix(views, 'visual.metric.');
  if (!desktop && !mobile && audit.length === 0 && metrics.length === 0) return null;
  return (
    <Panel aria-labelledby="marca">
      <PanelHeader
        titleId="marca"
        title="Marca e site"
        description="Capturas da página inicial, o que foi medido nela e a leitura da IA local sobre a marca. Medição é fato; a auditoria é inferência, com o fato que a sustenta."
      />
      <div className="space-y-6">
        {desktop || mobile ? (
          <div className="grid gap-4 sm:grid-cols-[2fr_1fr]">
            <CaptureFigure company={company} view={desktop} label="computador" />
            <CaptureFigure company={company} view={mobile} label="celular" />
          </div>
        ) : null}
        <Palette view={palette} />
        {typography.length > 0 ? (
          <Section title="Tipografia">
            <ClaimList views={typography} support={views} />
          </Section>
        ) : null}
        {audit.length > 0 || positioning.length > 0 ? (
          <Section title="Auditoria da marca">
            <ClaimList views={[...positioning, ...audit]} support={views} />
          </Section>
        ) : null}
        {metrics.length > 0 ? (
          <details className="text-sm">
            <summary className="cursor-pointer underline underline-offset-4">
              Medições técnicas ({metrics.length})
            </summary>
            <ClaimList views={metrics} support={views} />
          </details>
        ) : null}
      </div>
    </Panel>
  );
}

/** Negócio, posicionamento, sinais e concorrentes, cada conclusão com o tipo e a fonte. */
export function MarketPanel({ views }: { views: readonly ClaimView[] }) {
  const business = views.filter(
    (view) =>
      view.claim.key.startsWith('positioning.') &&
      view.claim.key !== INVESTIGATION_KEYS.summary &&
      !view.claim.key.startsWith('positioning.hypothesis.') &&
      !view.claim.key.startsWith('positioning.opportunity.'),
  );
  const signals = claimsWithPrefix(views, 'signal.');
  const competitors = claimsWithPrefix(views, 'competitive.competitor.');
  const findings = claimsWithPrefix(views, 'competitive.finding.');
  if (business.length + signals.length + competitors.length + findings.length === 0) return null;
  return (
    <Panel aria-labelledby="mercado">
      <PanelHeader
        titleId="mercado"
        title="Negócio e concorrência"
        description="O que o site diz sobre a empresa, sinais recentes encontrados na internet e como ela se compara com concorrentes. Sinal da internet é hipótese até ser conferido."
      />
      <div className="space-y-6">
        {business.length > 0 ? (
          <Section title="Negócio e posicionamento">
            <ClaimList views={business} support={views} />
          </Section>
        ) : null}
        {signals.length > 0 ? (
          <Section title="Sinais">
            <ClaimList views={signals} support={views} />
          </Section>
        ) : null}
        {competitors.length > 0 ? (
          <Section title="Concorrentes">
            <ClaimList views={competitors} support={views} />
          </Section>
        ) : null}
        {findings.length > 0 ? (
          <Section title="Achados de posicionamento">
            <ClaimList views={findings} support={views} />
          </Section>
        ) : null}
      </div>
    </Panel>
  );
}

/** Histórico das investigações e o que mudou entre a última e a anterior. */
export function InvestigationHistoryPanel({ data }: { data: InvestigationPanelData | null }) {
  if (!data || data.history.length === 0) return null;
  // Compara a última que terminou com resultado; a que está rodando ainda não tem comparação.
  const running = data.history.find((item) => ACTIVE_INVESTIGATION_STATUSES.includes(item.status));
  const latest = data.history.find(
    (item) => item.status === 'succeeded' || item.status === 'partial',
  );
  const changes = latest?.changes ?? [];
  return (
    <Panel aria-labelledby="historico-investigacoes">
      <PanelHeader
        titleId="historico-investigacoes"
        title="Histórico"
        description={
          latest?.previousId
            ? 'Comparação da última investigação com a anterior. Página fora do ar numa coleta não conta como mudança definitiva.'
            : 'Investigações desta empresa.'
        }
      />
      <div className="space-y-5">
        {running ? (
          <p className="text-sm text-muted-foreground">
            A comparação da investigação em andamento aparece quando ela terminar.
          </p>
        ) : null}
        {latest?.previousId ? (
          changes.length > 0 ? (
            <Section title="O que mudou">
              <ul className="list-disc space-y-1 pl-5 text-sm">
                {changes.map((change, index) => (
                  <li key={`${change.kind}-${index}`}>{change.text}</li>
                ))}
              </ul>
            </Section>
          ) : (
            <p className="text-sm text-muted-foreground">
              Nenhuma mudança encontrada desde a investigação anterior.
            </p>
          )
        ) : null}
        <ol className="space-y-2 text-sm">
          {data.history.map((item) => (
            <li key={item.id} className="flex flex-wrap items-center gap-2">
              <span className="tabular-nums">{formatDateTime(item.createdAt)}</span>
              <Badge variant={STATUS_VARIANT[item.status]}>
                {INVESTIGATION_STATUS_LABELS[item.status]}
              </Badge>
              {item.isDemo ? <DemoBadge /> : null}
              {item.diagnosis ? (
                <span className="text-muted-foreground">
                  {RECOMMENDATION_LABELS[item.diagnosis.recommendation]}
                </span>
              ) : null}
            </li>
          ))}
        </ol>
      </div>
    </Panel>
  );
}
