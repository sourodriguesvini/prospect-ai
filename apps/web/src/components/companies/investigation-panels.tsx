import type { ClaimView } from '@prospector/application';
import {
  ACTIVE_INVESTIGATION_STATUSES,
  INVESTIGATION_ISSUE_MESSAGES,
  INVESTIGATION_KEYS,
  INVESTIGATION_STATUS_LABELS,
  INVESTIGATION_STEP_LABELS,
  type CaptureKind,
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
import { ThesisSection } from '@/components/companies/thesis-section';
import { TimelineSection } from '@/components/companies/timeline-section';
import { StatusButton } from '@/components/strategy/decision-forms';
import { companyRoutes } from '@/lib/company-routes';
import { RECOMMENDATION_SHORT } from '@/lib/decision';
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

function counted(count: number, one: string, many: string): string | null {
  if (count <= 0) return null;
  return count === 1 ? `1 ${one}` : `${count} ${many}`;
}

/**
 * O que a verificação fez com o texto da IA, separado: descartado não é o mesmo que ajustado nem
 * que acrescentado pelo sistema (regra 8 do CLAUDE.md). null quando nada aconteceu.
 */
function verificationSummary(verification: {
  discarded: number;
  altered?: number;
  added?: number;
}): string | null {
  const parts = [
    counted(verification.discarded, 'conclusão da IA descartada', 'conclusões da IA descartadas'),
    counted(verification.altered ?? 0, 'texto da IA ajustado', 'textos da IA ajustados'),
    counted(
      verification.added ?? 0,
      'item acrescentado pelo sistema',
      'itens acrescentados pelo sistema',
    ),
  ].filter((part): part is string => part !== null);
  return parts.length > 0 ? `Verificação: ${parts.join(', ')}` : null;
}

function usageText(investigation: Investigation): string {
  const { usage } = investigation;
  const parts = [
    `${usage.searches} ${usage.searches === 1 ? 'busca' : 'buscas'} na internet (${usage.searchCredits} ${usage.searchCredits === 1 ? 'crédito' : 'créditos'})`,
    `${usage.pagesRead} ${usage.pagesRead === 1 ? 'página lida' : 'páginas lidas'}`,
    `${usage.captures} ${usage.captures === 1 ? 'captura' : 'capturas'}`,
    `${usage.modelCalls} ${usage.modelCalls === 1 ? 'leitura' : 'leituras'} da IA (${Math.round(usage.modelMs / 1000)} s)`,
  ];
  return `${parts.join(' · ')}.`;
}

function StepList({ investigation }: { investigation: Investigation }) {
  return (
    <ol className="space-y-2 text-sm" aria-label="Etapas da análise">
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
        label={again ? 'Atualizar a análise' : 'Analisar empresa'}
        variant="primary"
        pendingLabel="Começando…"
      />
      {again ? (
        <StatusButton
          action={startInvestigationAction.bind(null, company.id, true)}
          label="Refazer do zero"
          confirm="Refazer do zero repete todas as buscas na internet (gasta créditos) e todas as análises da IA, mesmo o que ainda vale. Continuar?"
          pendingLabel="Começando…"
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
          title="Análise"
          description="A análise não está disponível agora. Veja o estado do sistema em Configurações › Sistema."
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
        Empresa arquivada não é analisada. Mude a etapa para analisar.
      </p>
    );
  } else if (active && latest) {
    actions = (
      <div className="space-y-3">
        <InvestigationAutoRefresh />
        <p className="text-sm text-muted-foreground">
          Esta página se atualiza sozinha enquanto a análise anda. Pode sair dela: a análise
          continua no computador.
        </p>
        <StatusButton
          action={cancelInvestigationAction.bind(null, company.id, latest.id)}
          label="Cancelar análise"
          confirm="Cancelar agora? O que já foi coletado fica guardado; a etapa atual para no meio."
          pendingLabel="Cancelando…"
          dismissLabel="Continuar analisando"
        />
      </div>
    );
  } else if (resumable && latest) {
    actions = (
      <div className="flex flex-wrap gap-2">
        <StatusButton
          action={resumeInvestigationAction.bind(null, company.id, latest.id)}
          label="Continuar a análise"
          variant="primary"
          pendingLabel="Continuando…"
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
        title="Análise"
        description={
          latest
            ? `Última: ${formatDateTime(latest.createdAt)}${latest.finishedAt ? `, terminou em ${formatDateTime(latest.finishedAt)}` : ''}.`
            : 'Lê o site, olha a marca no computador e no celular, procura movimentos recentes e concorrentes e compara com os serviços da agência. Usa até 3 buscas na internet (gastam créditos do buscador), consulta o CNPJ na Receita quando há CNPJ e usa a IA deste computador; leva alguns minutos.'
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
            {active ? (
              <StepList investigation={latest} />
            ) : (
              <details className="text-sm">
                <summary className="cursor-pointer underline underline-offset-4">
                  Etapas e uso
                </summary>
                <div className="mt-3 space-y-3">
                  <StepList investigation={latest} />
                  <p className="text-xs text-muted-foreground">Uso: {usageText(latest)}</p>
                </div>
              </details>
            )}
          </>
        ) : null}
        {actions}
        {!company.primaryDomain && !archived ? (
          <div id="site-oficial" className="scroll-mt-6">
            <Section title="Site oficial">
              <p className="text-sm text-muted-foreground">
                Sem site confirmado, a análise não lê páginas nem olha a marca.
                {candidates.length > 0
                  ? ' Confira os candidatos que a pesquisa encontrou antes de confirmar.'
                  : ''}
              </p>
              <SiteConfirmForm
                action={confirmSiteAction.bind(null, company.id)}
                candidates={candidates}
              />
            </Section>
          </div>
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
          {RECOMMENDATION_SHORT[offer.recommendation]}
        </Badge>
        <span className="text-sm text-muted-foreground">Prioridade {offer.priority} de 100</span>
      </p>
      <dl className="grid gap-2 sm:grid-cols-3">
        <Score label="Combina com o cliente ideal" value={fit.value} note={fit.note} />
        <Score
          label="Sinais de necessidade"
          value={offer.opportunity.score}
          note={`${offer.opportunity.claimIds.length} ${offer.opportunity.claimIds.length === 1 ? 'registro ligado' : 'registros ligados'}.`}
        />
        <Score
          label="Quanto já sabemos"
          value={offer.confidence.score}
          note={`${offer.confidence.coveredDimensions} de 5 dimensões cobertas.`}
        />
      </dl>
      {offer.fit.checks.length > 0 ? (
        <details className="text-sm">
          <summary className="cursor-pointer underline underline-offset-4">
            Critérios do cliente ideal
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
        <Section title="Motivos para não oferecer">
          <ul className="list-disc space-y-1 pl-5 text-sm">
            {offer.gates.map((gate) => (
              <li key={gate}>{gate}</li>
            ))}
          </ul>
        </Section>
      ) : null}
      {reading ? (
        <Section title="Leitura da IA para este serviço">
          <ClaimList views={[reading]} support={views} />
        </Section>
      ) : (
        <p className="text-sm text-muted-foreground">
          Sem leitura da IA aceita para este serviço: a necessidade conta só com a marca e os
          movimentos recentes.
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
            Outras informações usadas
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
        title="Oportunidade"
        description={`Quais serviços fazem sentido e por quê, pela análise de ${formatDate(investigation.finishedAt ?? investigation.createdAt)}. As notas vão de 0 a 100 com critério explícito; não são chance de fechar negócio.`}
      />
      <div className="space-y-6">
        {investigation.isDemo ? <DemoBadge /> : null}
        {newer ? (
          <Well className="py-3 text-sm">
            {ACTIVE_INVESTIGATION_STATUSES.includes(newer.status)
              ? `Há uma análise mais nova em andamento (${formatDateTime(newer.createdAt)}). Esta é a anterior e é trocada quando ela terminar.`
              : `A análise de ${formatDateTime(newer.createdAt)} terminou sem conclusão (${INVESTIGATION_STATUS_LABELS[newer.status].toLowerCase()}). Esta é a última análise completa.`}
          </Well>
        ) : null}
        {summary.length > 0 ? (
          <details className="text-sm">
            <summary className="cursor-pointer underline underline-offset-4">
              De onde vem a leitura do topo
            </summary>
            <ClaimList views={summary} support={views} />
          </details>
        ) : summaryReplaced ? (
          <Well className="py-4 text-sm text-muted-foreground">
            A leitura central desta análise foi substituída por uma coleta mais nova. Ela volta a
            aparecer quando a nova análise terminar.
          </Well>
        ) : null}
        <TimelineSection views={views} />
        {diagnosis.thesis ? (
          <ThesisSection thesis={diagnosis.thesis} views={views} />
        ) : (
          <Well className="py-4 text-sm text-muted-foreground">
            Esta análise não tem tese comercial (as feitas antes de 26/11/2026 não têm). Atualize a
            análise para ver o ângulo de abordagem, o que não oferecer e o que confirmar antes do
            contato.
          </Well>
        )}
        {diagnosis.offers.length > 0 ? (
          <Section title="Serviços">
            <ul className="divide-y">
              {diagnosis.offers.map((offer) => (
                <OfferCard key={offer.offerId} offer={offer} views={views} />
              ))}
            </ul>
          </Section>
        ) : (
          <Well className="py-4 text-sm text-muted-foreground">
            Nenhum serviço ativo para comparar: cadastre ou ative um em{' '}
            <Link href="/configuracoes/estrategia" className="underline underline-offset-4">
              Estratégia
            </Link>{' '}
            e atualize a análise.
          </Well>
        )}
        {hypotheses.length > 0 ? (
          <Section title="A confirmar">
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
        <details className="text-sm">
          <summary className="cursor-pointer underline underline-offset-4">
            Detalhes técnicos da análise
          </summary>
          <div className="mt-2 space-y-2 text-muted-foreground">
            <p>Confiança geral: {diagnosis.confidence} de 100.</p>
            {verificationSummary(diagnosis.verification) ? (
              <>
                <p>{verificationSummary(diagnosis.verification)}.</p>
                <ul className="list-disc space-y-1 pl-5">
                  {diagnosis.verification.reasons.map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
              </>
            ) : null}
            {models.length > 0 ? (
              <p className="text-xs">
                Leituras da IA deste computador:{' '}
                {models.map((use) => `${use.promptVersion} (${use.model})`).join(', ')}.
              </p>
            ) : null}
          </div>
        </details>
      </div>
    </Panel>
  );
}

/** Legenda e texto alternativo de cada imagem da captura (Parte 13.3 da diretriz de 2026-11-26). */
const CAPTURE_FIGURES: Record<CaptureKind, { caption: string; alt: string }> = {
  site_desktop: {
    caption: 'Página inicial · computador',
    alt: 'Página inicial no computador, como capturada pelo Prospector.',
  },
  site_mobile: {
    caption: 'Página inicial · celular',
    alt: 'Página inicial no celular, como capturada pelo Prospector.',
  },
  site_desktop_footer: {
    caption: 'Rodapé · computador',
    alt: 'Rodapé da página inicial no computador, como capturado pelo Prospector.',
  },
  site_mobile_footer: {
    caption: 'Rodapé · celular',
    alt: 'Rodapé da página inicial no celular, como capturado pelo Prospector.',
  },
  site_mobile_menu: {
    caption: 'Menu aberto · celular',
    alt: 'Menu de navegação aberto no celular, como capturado pelo Prospector.',
  },
  inner_desktop: {
    caption: 'Página interna · computador',
    alt: 'Página interna do site no computador, como capturada pelo Prospector.',
  },
  inner_mobile: {
    caption: 'Página interna · celular',
    alt: 'Página interna do site no celular, como capturada pelo Prospector.',
  },
};

const EXTRA_CAPTURE_KINDS: readonly CaptureKind[] = [
  'site_desktop_footer',
  'site_mobile_footer',
  'site_mobile_menu',
  'inner_desktop',
  'inner_mobile',
];

function captureView(views: readonly ClaimView[], kind: CaptureKind) {
  return views.find((view) => view.claim.key === INVESTIGATION_KEYS.capture(kind)) ?? null;
}

/** Por que não há imagem: pedido do site, pasta indisponível ou gravação que falhou. */
function notStoredText(value: { noArchive?: unknown; storage?: unknown }): string {
  if (value.noArchive === true || value.storage === 'no_archive') {
    return 'Imagem não guardada: o site pede para não guardar cópia. Ela foi usada só durante a análise.';
  }
  if (value.storage === 'failed') {
    return 'Imagem não guardada: a gravação falhou nesta análise. Atualize a análise para tentar de novo.';
  }
  return 'Imagem não guardada: a pasta de dados do Prospector não estava disponível nesta análise. Veja Configurações › Sistema e atualize a análise.';
}

function CaptureFigure({
  company,
  view,
  kind,
}: {
  company: Company;
  view: ClaimView | null;
  kind: CaptureKind;
}) {
  if (!view) return null;
  const value = view.claim.value as {
    storagePath?: unknown;
    width?: unknown;
    height?: unknown;
    noArchive?: unknown;
    storage?: unknown;
  };
  const src =
    typeof value.storagePath === 'string'
      ? companyRoutes.capture(company.id, value.storagePath)
      : null;
  const width = typeof value.width === 'number' ? value.width : undefined;
  const height = typeof value.height === 'number' ? value.height : undefined;
  const figure = CAPTURE_FIGURES[kind];
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
            alt={figure.alt}
            className="h-auto max-h-[28rem] w-full rounded-[var(--radius-tile)] border border-border object-cover object-top"
          />
          <span className="sr-only"> (abre a imagem inteira em nova aba)</span>
        </a>
      ) : (
        <Well className="py-6 text-center text-sm text-muted-foreground">
          {notStoredText(value)}
        </Well>
      )}
      <figcaption className="text-xs text-muted-foreground">
        {figure.caption} · {formatDateTime(view.claim.createdAt)}
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
  const extras = EXTRA_CAPTURE_KINDS.flatMap((kind) => {
    const view = captureView(views, kind);
    return view ? [{ kind, view }] : [];
  });
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
        title="Marca e posicionamento"
        description="Como a marca aparece no site, no computador e no celular. O que foi medido é fato; a leitura da marca é interpretação, com o fato que a sustenta."
      />
      <div className="space-y-6">
        {desktop || mobile ? (
          <div className="grid gap-4 sm:grid-cols-[2fr_1fr]">
            <CaptureFigure company={company} view={desktop} kind="site_desktop" />
            <CaptureFigure company={company} view={mobile} kind="site_mobile" />
          </div>
        ) : null}
        {extras.length > 0 ? (
          <details className="text-sm">
            <summary className="cursor-pointer underline underline-offset-4">
              Rodapé, menu e página interna ({extras.length}{' '}
              {extras.length === 1 ? 'imagem' : 'imagens'})
            </summary>
            <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {extras.map(({ kind, view }) => (
                <CaptureFigure key={kind} company={company} view={view} kind={kind} />
              ))}
            </div>
          </details>
        ) : null}
        <Palette view={palette} />
        {typography.length > 0 ? (
          <Section title="Tipografia">
            <ClaimList views={typography} support={views} />
          </Section>
        ) : null}
        {audit.length > 0 || positioning.length > 0 ? (
          <Section title="Leitura da marca">
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
        title="Mercado e concorrência"
        description="O que o site diz sobre a empresa, movimentos recentes e concorrentes. O que veio da internet é hipótese até ser conferido."
      />
      <div className="space-y-6">
        {business.length > 0 ? (
          <Section title="Negócio e posicionamento">
            <ClaimList views={business} support={views} />
          </Section>
        ) : null}
        {signals.length > 0 ? (
          <Section title="Movimentos recentes">
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
        title="Análises anteriores"
        description={
          latest?.previousId
            ? 'O que mudou da análise anterior para a última. Página fora do ar numa coleta não conta como mudança definitiva.'
            : 'Análises desta empresa.'
        }
      />
      <div className="space-y-5">
        {running ? (
          <p className="text-sm text-muted-foreground">
            A comparação da análise em andamento aparece quando ela terminar.
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
              Nenhuma mudança encontrada desde a análise anterior.
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
                  {RECOMMENDATION_SHORT[item.diagnosis.recommendation]}
                </span>
              ) : null}
            </li>
          ))}
        </ol>
      </div>
    </Panel>
  );
}
