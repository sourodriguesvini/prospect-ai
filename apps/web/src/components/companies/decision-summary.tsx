import type { ClaimView } from '@prospector/application';
import {
  INVESTIGATION_STATUS_LABELS,
  INVESTIGATION_STEP_LABELS,
  SUPPRESSION_REASON_LABELS,
  type Company,
  type Investigation,
  type SuppressionReason,
} from '@prospector/contracts';
import { executiveSummary } from '@prospector/domain';
import { Button, Panel, StatusDot, type StatusTone } from '@prospector/ui';
import { ArrowRight } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import {
  resumeInvestigationAction,
  startInvestigationAction,
} from '@/app/(shell)/empresas/actions';
import { ExecutiveSummaryList } from '@/components/companies/report-panels';
import { eventEvidenceOf } from '@/components/companies/timeline-section';
import { StatusButton } from '@/components/strategy/decision-forms';
import {
  ANALYSIS_COST_TEXT,
  RECOMMENDATION_VIEW,
  SECURITY_HELP,
  SECURITY_LABELS,
  decisionNext,
  recommendedOffer,
  securityLevel,
  thesisCaveat,
  undiagnosedState,
  type ContactSituation,
  type DecisionTone,
} from '@/lib/decision';
import { formatDate } from '@/lib/format';
import { relationshipRoutes } from '@/lib/relationship-routes';

/**
 * Topo da página da empresa: a resposta para "Vale abordar?" antes de qualquer evidência
 * (proposta de 26/11, Frente 1) e o resumo executivo com as cinco perguntas (diretriz 2026-11-26,
 * Parte 7). Só compõe o que a investigação já gravou: a recomendação, a leitura central (claim do
 * ledger), os acontecimentos, a tese e a oferta recomendada. Nada novo é afirmado aqui.
 */

const TONE: Record<DecisionTone, StatusTone> = {
  positive: 'success',
  neutral: 'neutral',
  caution: 'warning',
};

function Dimension({ label, value, help }: { label: string; value: ReactNode; help?: string }) {
  return (
    <div className="min-w-0 space-y-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium">{value}</dd>
      {help ? <dd className="text-xs text-muted-foreground">{help}</dd> : null}
    </div>
  );
}

function AnchorButton({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Button asChild>
      <a href={href}>
        {children}
        <ArrowRight aria-hidden="true" className="size-4" />
      </a>
    </Button>
  );
}

/** Etapa em andamento, em uma frase ("Lendo o site (2 de 6)"). */
function progressText(investigation: Investigation): string {
  const steps = investigation.steps;
  const done = steps.filter((step) => step.state !== 'pending' && step.state !== 'running').length;
  const running = steps.find((step) => step.state === 'running');
  if (investigation.status === 'queued')
    return 'Na fila: começa quando a análise anterior terminar.';
  const label = running ? INVESTIGATION_STEP_LABELS[running.key] : 'Preparando';
  return `${label} (${Math.min(done + 1, steps.length)} de ${steps.length}).`;
}

function suppressionText(suppressions: ContactSituation['suppressions']): string {
  return suppressions
    .map(
      (entry) =>
        `${SUPPRESSION_REASON_LABELS[entry.reason as SuppressionReason] ?? 'Pedido de não contato'} (pedido em ${formatDate(entry.createdAt)})`,
    )
    .join('; ');
}

/** Sem diagnóstico: diz o que aconteceu de fato (nunca analisada, parou, cancelada, sem conclusão). */
function Undiagnosed({
  company,
  latest,
  available,
}: {
  company: Company;
  latest: Investigation | null;
  available: boolean;
}) {
  const archived = company.lifecycle === 'archived';
  const state = undiagnosedState(latest);
  const when = latest ? formatDate(latest.createdAt) : null;
  const title =
    state === 'never'
      ? 'Ainda não analisamos esta empresa'
      : state === 'unfinished'
        ? `A análise de ${when} não terminou (${INVESTIGATION_STATUS_LABELS[latest!.status].toLowerCase()})`
        : state === 'cancelled'
          ? `A análise de ${when} foi cancelada`
          : `A análise de ${when} terminou sem conclusão`;
  let action: ReactNode;
  if (archived) {
    action = (
      <p className="text-sm text-muted-foreground">
        Empresa arquivada: mude a etapa para analisar.
      </p>
    );
  } else if (!available) {
    action = (
      <p className="text-sm text-muted-foreground">
        Análise indisponível agora (veja{' '}
        <Link href="/configuracoes#sistema" className="underline underline-offset-4">
          Configurações › Sistema
        </Link>
        ).
      </p>
    );
  } else if (state === 'unfinished' && latest) {
    action = (
      <StatusButton
        action={resumeInvestigationAction.bind(null, company.id, latest.id)}
        label="Continuar a análise"
        variant="primary"
        pendingLabel="Continuando…"
      />
    );
  } else if (state === 'no_conclusion') {
    action = <AnchorButton href="#investigacao">Ver a análise</AnchorButton>;
  } else {
    action = (
      <StatusButton
        action={startInvestigationAction.bind(null, company.id, false)}
        label="Analisar empresa"
        variant="primary"
        pendingLabel="Começando…"
      />
    );
  }
  return (
    <div className="space-y-3">
      <p className="text-lg font-medium">{title}</p>
      <p className="text-sm text-muted-foreground">
        {state === 'never'
          ? 'A análise lê o site, olha a marca no computador e no celular, procura movimentos recentes e concorrentes e compara com os serviços da agência. '
          : state === 'unfinished'
            ? 'Continuar aproveita as etapas que já terminaram. '
            : ''}
        {ANALYSIS_COST_TEXT}
      </p>
      {action}
    </div>
  );
}

export function DecisionSummary({
  company,
  diagnosed,
  latest,
  active,
  views,
  available,
  contact,
}: {
  company: Company;
  /** Última investigação que montou diagnóstico. */
  diagnosed: Investigation | null;
  latest: Investigation | null;
  active: boolean;
  views: readonly ClaimView[];
  /** false = investigação desligada ou ilegível agora (o painel de análise explica). */
  available: boolean;
  /** Pedidos de não contato e conversa aberta; null = não deu para ler o Relacionamento agora. */
  contact: ContactSituation | null;
}) {
  const diagnosis = diagnosed?.diagnosis ?? null;
  // Fica sempre na página: quando a análise termina e a página se atualiza, o leitor de tela
  // ouve o resultado (o texto de progresso some junto com o andamento).
  const live =
    active && latest
      ? progressText(latest)
      : diagnosis
        ? `Análise concluída: ${RECOMMENDATION_VIEW[diagnosis.recommendation].headline}.`
        : '';

  let body: ReactNode;
  if (!diagnosis) {
    body =
      active && latest ? (
        <div className="space-y-3">
          <p className="text-lg font-medium">Análise em andamento</p>
          <p className="text-sm text-muted-foreground">
            {progressText(latest)} Pode sair desta página: a análise continua no computador e o
            resultado aparece aqui.
          </p>
        </div>
      ) : (
        <Undiagnosed company={company} latest={latest} available={available} />
      );
  } else {
    const view = RECOMMENDATION_VIEW[diagnosis.recommendation];
    const next = decisionNext({
      recommendation: diagnosis.recommendation,
      lifecycle: company.lifecycle,
      contact,
    });
    const offer = recommendedOffer(diagnosis);
    const summary = diagnosis.summaryClaimId
      ? views.find((item) => item.claim.id === diagnosis.summaryClaimId)
      : undefined;
    const security = securityLevel(diagnosis.confidence);
    const gaps = diagnosis.gaps.slice(0, 2).map((gap) => gap.text);
    const suppressed = next.kind === 'suppressed' && contact ? contact.suppressions : null;
    const thesis = diagnosis.thesis ?? null;
    const caveat = suppressed ? null : thesisCaveat(diagnosis.recommendation, thesis);
    const answers = executiveSummary({
      claims: views.map((item) => ({
        key: item.claim.key,
        statement: item.claim.statement,
        epistemicType: item.claim.epistemicType,
        status: item.claim.status,
      })),
      events: eventEvidenceOf(views),
      thesis: diagnosis.thesis ?? null,
      fallbackOffer: offer?.offerName ?? null,
      contactBlocked: suppressed !== null,
    });

    let action: ReactNode = null;
    let note: string | null = null;
    switch (next.kind) {
      case 'suppressed':
        note =
          'A análise fica aqui para consulta. Se o pedido foi registrado por engano, ele pode ser retirado no painel Conversas, com registro no histórico.';
        break;
      case 'open_conversation':
        action = (
          <Button asChild>
            <Link href={relationshipRoutes.opportunity(next.opportunityId)}>
              Abrir a conversa
              <ArrowRight aria-hidden="true" className="size-4" />
            </Link>
          </Button>
        );
        break;
      case 'archived':
        note = 'Empresa arquivada: mude a etapa para abordar ou analisar de novo.';
        break;
      case 'disqualified':
        note = 'Você marcou esta empresa como descartada (veja a etapa abaixo).';
        break;
      case 'prepare_message':
        action = <AnchorButton href="#relacionamento">Preparar mensagem</AnchorButton>;
        break;
      case 'complete_analysis':
        action = company.primaryDomain ? (
          <AnchorButton href="#investigacao">Atualizar a análise</AnchorButton>
        ) : (
          <AnchorButton href="#site-oficial">Confirmar o site</AnchorButton>
        );
        break;
      case 'watch':
        note = 'Ela volta para a sua lista em Hoje quando for hora de rever.';
        break;
      case 'none':
        note =
          diagnosis.recommendation === 'discard'
            ? 'Se concordar, mude a etapa para Descartada.'
            : contact === null
              ? 'Não foi possível conferir agora se a empresa pediu para não ser contatada; veja o painel Conversas.'
              : null;
        break;
    }

    body = (
      <div className="space-y-4">
        {active ? (
          <p className="text-sm text-muted-foreground">
            Atualizando a análise: {latest ? progressText(latest) : ''} Até terminar, vale a
            anterior.
          </p>
        ) : null}
        <div className="space-y-2">
          <p className="text-2xl tracking-[-0.02em]">
            {suppressed ? (
              <StatusDot tone="danger">Não contatar</StatusDot>
            ) : (
              <StatusDot tone={TONE[view.tone]}>{view.headline}</StatusDot>
            )}
          </p>
          {suppressed ? (
            <p className="text-sm" data-suppressed-summary="">
              {suppressionText(suppressed)}. A leitura da análise era: {view.headline.toLowerCase()}
              .
            </p>
          ) : null}
          {summary ? (
            <p className="max-w-prose text-pretty">
              {summary.claim.statement}{' '}
              <a
                href="#diagnostico"
                className="text-sm text-muted-foreground underline underline-offset-4"
              >
                De onde vem
              </a>
            </p>
          ) : null}
          {caveat ? (
            <p className="max-w-prose text-sm" data-thesis-caveat="">
              {caveat}{' '}
              <a
                href="#tese-comercial"
                className="text-muted-foreground underline underline-offset-4"
              >
                Ver a tese
              </a>
            </p>
          ) : null}
          {next.kind === 'complete_analysis' && gaps.length > 0 ? (
            <p className="text-sm text-muted-foreground">Falta: {gaps.join(' ')}</p>
          ) : null}
          {note ? <p className="text-sm text-muted-foreground">{note}</p> : null}
        </div>
        {/* A ação logo depois da resposta: no celular ela não fica atrás do resumo inteiro. */}
        <div className="flex flex-wrap items-center gap-3">
          {action}
          <p className="text-xs text-muted-foreground">
            Análise de {formatDate(diagnosed!.finishedAt ?? diagnosed!.createdAt)}.
          </p>
        </div>
        <ExecutiveSummaryList answers={answers} />
        {/* Serviço e contato já estão no resumo (onde contribuir, melhor abordagem): aqui só o
            que ele não diz. Análise antiga, sem tese, ainda mostra o serviço comparado. */}
        <dl className="grid gap-4 sm:grid-cols-3">
          {thesis ? null : (
            <Dimension
              label="Serviço que faz sentido"
              value={
                diagnosis.offers.length === 0 ? (
                  <>
                    Nenhum serviço cadastrado (
                    <Link href="/configuracoes/estrategia" className="underline underline-offset-4">
                      Estratégia
                    </Link>
                    )
                  </>
                ) : offer ? (
                  offer.offerName
                ) : (
                  'Nenhum dos serviços ativos'
                )
              }
            />
          )}
          <Dimension
            label="Segurança da análise"
            value={SECURITY_LABELS[security]}
            help={SECURITY_HELP[security]}
          />
        </dl>
      </div>
    );
  }

  return (
    <Panel aria-labelledby="vale-abordar" data-decision="">
      <h2 id="vale-abordar" className="mb-3 text-sm text-muted-foreground">
        Vale abordar?
      </h2>
      <p className="sr-only" aria-live="polite">
        {live}
      </p>
      {body}
    </Panel>
  );
}
