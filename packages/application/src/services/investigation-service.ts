import { z } from 'zod';
import {
  CAPTURE_FILE_PATTERN,
  EMPTY_INVESTIGATION_SNAPSHOT,
  INVESTIGATION_PIPELINE_VERSION,
  INVESTIGATION_STEPS,
  StartInvestigationInput,
  Uuid,
  WebDomain,
  type Company,
  type CompanyInvestigationSummary,
  type Investigation,
  type InvestigationIssueCode,
  type InvestigationStatus,
  type InvestigationStep,
  type InvestigationStepKey,
  type StartInvestigationDraft,
} from '@prospector/contracts';
import { emptyVerificationLog } from '@prospector/domain';
import type { RequestContext } from '../context';
import { AppError, parseInput } from '../errors';
import {
  readingFromClaim,
  reuseDiagnosis,
  stepBusiness,
  stepCompetitive,
  stepDiagnosis,
  stepVisual,
} from './investigation/analyze';
import {
  stepCapture,
  stepCompetitors,
  stepContext,
  stepPages,
  stepSignals,
  stepSite,
} from './investigation/collect';
import { withCnpjFromSite } from './investigation/cnpj-from-site';
import { stepQualification } from './investigation/qualify';
import {
  claimsWithPrefix,
  type InvestigationDeps,
  type Run,
  type StepOutcome,
  type StepTable,
} from './investigation/run';
import { pendingAudit } from './pending-audit';

export type { InvestigationDeps } from './investigation/run';

/**
 * Investigação de empresas (ADR-0015): uma execução por vez neste processo (a GPU e a cota de
 * pesquisa são do usuário), etapas idempotentes gravadas no ledger, progresso visível, pedido de
 * cancelamento e retomada depois de reinício. Enquanto a fila compartilhada `ai_jobs` (ADR-0011)
 * não chega a este ramo, a fila é em processo; o registro guarda dono e batimento para que um
 * processo encerrado no meio deixe a investigação como `interrupted`, nunca presa em "rodando".
 */

const STEPS: StepTable = {
  context: stepContext,
  site: stepSite,
  pages: withCnpjFromSite(stepPages),
  capture: stepCapture,
  business_analysis: stepBusiness,
  visual_analysis: stepVisual,
  signals: stepSignals,
  competitors: stepCompetitors,
  competitive_analysis: stepCompetitive,
  diagnosis: stepDiagnosis,
  qualification: stepQualification,
};

/** Pulos que não indicam lacuna da coleta (resultado legítimo). */
const BENIGN_ISSUES: ReadonlyArray<InvestigationIssueCode | null | undefined> = [
  null,
  undefined,
  'no_competitors',
  'no_offers',
];
const FINISHED_STATES: ReadonlyArray<InvestigationStep['state']> = [
  'done',
  'reused',
  'skipped',
  'failed',
];
const MAX_QUEUE = 20;

export interface InvestigationServiceOptions {
  /** Identifica este processo como dono das execuções (`web-<pid>-<aleatório>`). */
  runnerId: string;
  /** Intervalo do batimento e da conferência de cancelamento vindo de outro processo. */
  heartbeatMs?: number;
  /** Sem batimento há mais que isso, a execução é considerada interrompida. */
  staleAfterMs?: number;
}

export interface InvestigationService {
  /** Enfileira uma investigação. AppError('conflict','investigation_running') se já houver uma ativa. */
  start(ctx: RequestContext, raw: StartInvestigationDraft): Promise<Investigation>;
  /** Pede o cancelamento; false se ela já terminou. */
  cancel(ctx: RequestContext, id: string): Promise<boolean>;
  /** Retoma uma investigação interrompida ou com falha, sem repetir as etapas concluídas. */
  resume(ctx: RequestContext, id: string): Promise<Investigation>;
  get(ctx: RequestContext, id: string): Promise<Investigation | null>;
  history(ctx: RequestContext, companyId: string, limit?: number): Promise<Investigation[]>;
  summaries(
    ctx: RequestContext,
    companyIds: readonly string[],
  ): Promise<CompanyInvestigationSummary[]>;
  /**
   * Confirma o site oficial (candidato da investigação ou informado pelo usuário): grava o
   * domínio na empresa, com auditoria. AppError('conflict','company_duplicate') se outro cadastro
   * já usa o domínio.
   */
  confirmSite(ctx: RequestContext, input: { companyId: string; domain: string }): Promise<Company>;
  /**
   * Imagem de uma captura da empresa (`<investigação>-<janela>.jpg`), só se um claim de captura
   * da empresa apontar para ela. null = não existe, não é da empresa ou pasta não configurada.
   */
  captureImage(
    ctx: RequestContext,
    companyId: string,
    file: string,
  ): Promise<{ bytes: Uint8Array; mime: 'image/jpeg' } | null>;
  /** Na subida do servidor: execuções sem batimento recente passam a `interrupted`. */
  recoverInterrupted(): Promise<number>;
  /** Resolve quando a fila deste processo esvazia (testes e encerramento). */
  idle(): Promise<void>;
}

const ConfirmSiteInput = z.object({
  companyId: Uuid,
  domain: z
    .string()
    .trim()
    .toLowerCase()
    .transform((value) =>
      value
        .replace(/^https?:\/\//, '')
        .replace(/[/?#].*$/, '')
        .replace(/^www\./, ''),
    )
    .pipe(WebDomain),
});

function pendingSteps(): InvestigationStep[] {
  return INVESTIGATION_STEPS.map((key) => ({
    key,
    state: 'pending',
    startedAt: null,
    finishedAt: null,
    issue: null,
    counts: {},
  }));
}

function emptyUsage(): Investigation['usage'] {
  return {
    searches: 0,
    searchCredits: 0,
    pagesRead: 0,
    captures: 0,
    captureBytes: 0,
    modelCalls: 0,
    modelMs: 0,
  };
}

function finalStatus(steps: readonly InvestigationStep[]): InvestigationStatus {
  const byKey = new Map(steps.map((step) => [step.key, step]));
  const context = byKey.get('context');
  const qualification = byKey.get('qualification');
  if (context?.state === 'failed' || qualification?.state !== 'done') return 'failed';
  const gap = steps.some(
    (step) =>
      step.state === 'failed' || (step.state === 'skipped' && !BENIGN_ISSUES.includes(step.issue)),
  );
  return gap ? 'partial' : 'succeeded';
}

export function createInvestigationService(
  deps: InvestigationDeps,
  options: InvestigationServiceOptions,
): InvestigationService {
  const heartbeatMs = options.heartbeatMs ?? 15_000;
  const staleAfterMs = options.staleAfterMs ?? 120_000;
  const queue: Array<{ id: string; force: boolean; traceId: string }> = [];
  let current: { id: string; controller: AbortController } | null = null;
  let draining: Promise<void> = Promise.resolve();
  let pumping = false;

  const now = () => deps.clock.now().toISOString();

  function recoverStale(): Promise<number> {
    const at = deps.clock.now();
    return deps.investigations.interruptStale(
      new Date(at.getTime() - staleAfterMs).toISOString(),
      at.toISOString(),
    );
  }

  async function requireCompany(id: string): Promise<Company> {
    const company = await deps.companies.get(id);
    if (!company) throw new AppError('not_found', 'not_found');
    return company;
  }

  function enqueue(item: { id: string; force: boolean; traceId: string }): void {
    queue.push(item);
    if (!pumping) {
      pumping = true;
      draining = pump().finally(() => {
        pumping = false;
      });
    }
  }

  /**
   * Batimento do processo: a investigação em execução e as que esperam na fila deste processo.
   * Sem ele, outra instância do app (ou a próxima partida) as daria como interrompidas. Também é
   * por aqui que um pedido de cancelamento feito em outra instância chega à execução.
   */
  async function beat(): Promise<void> {
    const ids = [...(current ? [current.id] : []), ...queue.map((item) => item.id)];
    if (ids.length === 0) return;
    const cancelled = await deps.investigations.touch(ids, options.runnerId, now());
    if (current && cancelled.includes(current.id)) current.controller.abort();
  }

  async function pump(): Promise<void> {
    const timer = setInterval(() => {
      void beat().catch(() => undefined);
    }, heartbeatMs);
    (timer as { unref?: () => void }).unref?.();
    try {
      for (let item = queue.shift(); item; item = queue.shift()) {
        const controller = new AbortController();
        current = { id: item.id, controller };
        try {
          await execute(item.id, item.force, item.traceId, controller);
        } catch (error) {
          deps.log(
            `[investigação] falha inesperada ao executar: ${error instanceof Error ? error.name : 'erro'}`,
          );
          await failUnexpectedly(item.id, item.traceId).catch(() => undefined);
        } finally {
          current = null;
        }
      }
    } finally {
      clearInterval(timer);
    }
  }

  /** Falha fora das etapas (banco fora do ar no meio, defeito): conclusão auditada como falha. */
  async function failUnexpectedly(id: string, traceId: string): Promise<void> {
    const ctx: RequestContext = {
      actor: { type: 'system', component: 'investigation-runner' },
      traceId,
    };
    await deps.investigations.updateAudited(
      id,
      { status: 'failed', issue: 'unexpected', finishedAt: now(), runner: null, heartbeatAt: null },
      pendingAudit(ctx, {
        action: 'company.investigation.finished',
        entityType: 'company_investigation',
        entityId: id,
        diff: { status: 'failed', issue: 'unexpected' },
      }),
    );
  }

  /** Recarrega o que as etapas já concluídas desta execução deixaram no ledger (retomada). */
  function rehydrate(run: Run): void {
    if (run.stepStates.diagnosis === 'reused') {
      reuseDiagnosis(run);
      return;
    }
    for (const claim of run.inForce.values()) {
      if (claim.producedByRunId !== run.id) continue;
      if (claim.key === 'positioning.diagnosis_summary') run.summaryClaimId = claim.id;
      else if (claim.key.startsWith('positioning.hypothesis.')) run.hypothesisIds.push(claim.id);
      else if (claim.key.startsWith('positioning.opportunity.')) {
        const offerId = claim.value?.offerId;
        const reading = readingFromClaim(run, claim);
        if (typeof offerId === 'string' && reading) {
          run.opportunityIds.set(offerId, claim.id);
          run.offerReadings.set(offerId, reading);
        }
      }
    }
    if (
      claimsWithPrefix(run, 'competitive.competitor.').length > 0 &&
      run.snapshot.competitors.length === 0
    ) {
      run.snapshot.competitors = run.previous?.snapshot?.competitors ?? [];
    }
  }

  async function execute(
    id: string,
    force: boolean,
    traceId: string,
    controller: AbortController,
  ): Promise<void> {
    const investigation = await deps.investigations.get(id);
    if (!investigation || !['queued', 'running'].includes(investigation.status)) return;
    const ctx: RequestContext = {
      actor: { type: 'agent', agent: 'investigator', runId: id },
      traceId,
    };
    const finish = async (
      status: InvestigationStatus,
      steps: InvestigationStep[],
      run: Run | null,
      issue: InvestigationIssueCode | null,
    ) => {
      await deps.investigations.updateAudited(
        id,
        {
          status,
          steps,
          issue,
          finishedAt: now(),
          runner: null,
          heartbeatAt: null,
          ...(run
            ? {
                usage: run.usage,
                models: run.models,
                snapshot: run.snapshot,
                diagnosis: run.diagnosis,
                changes: run.changes,
              }
            : {}),
        },
        pendingAudit(ctx, {
          action: 'company.investigation.finished',
          entityType: 'company_investigation',
          entityId: id,
          diff: {
            status,
            recommendation: run?.diagnosis?.recommendation ?? null,
            searches: run?.usage.searches ?? 0,
            modelCalls: run?.usage.modelCalls ?? 0,
          },
        }),
      );
    };

    const steps = investigation.steps.length > 0 ? [...investigation.steps] : pendingSteps();
    if (investigation.cancelRequestedAt) {
      await finish('cancelled', steps, null, 'cancelled');
      return;
    }
    const company = await deps.companies.get(investigation.companyId);
    if (!company) {
      await finish('failed', steps, null, 'unexpected');
      return;
    }
    // Arquivada depois de entrar na fila (ou antes de retomar): nada é coletado.
    if (company.lifecycle === 'archived') {
      await finish('cancelled', steps, null, 'company_archived');
      return;
    }
    const previous = investigation.previousId
      ? await deps.investigations.get(investigation.previousId)
      : null;

    const run: Run = {
      deps,
      id,
      ctx,
      company,
      ownedOrigins: company.primaryDomain ? [company.primaryDomain] : [],
      investigation,
      previous,
      force,
      signal: controller.signal,
      usage: { ...emptyUsage(), ...investigation.usage },
      models: [...investigation.models],
      verification: investigation.diagnosis
        ? { ...investigation.diagnosis.verification }
        : emptyVerificationLog(),
      snapshot: structuredClone(investigation.snapshot ?? EMPTY_INVESTIGATION_SNAPSHOT),
      siteUrl: null,
      pages: [],
      images: {},
      inForce: new Map(),
      produced: { facts: [], inferences: [], hypotheses: [] },
      opportunityIds: new Map(),
      summaryClaimId: null,
      citedFactIds: new Set(),
      offerReadings: new Map(),
      competitorTexts: new Map(),
      stepStates: {},
      pageClaims: new Map(),
      strategy: null,
      hypothesisIds: [],
      diagnosis: null,
      changes: [],
    };
    const resumed = steps.some(
      (step) => step.key !== 'context' && FINISHED_STATES.includes(step.state),
    );
    for (const step of steps) {
      if (step.key !== 'context' && FINISHED_STATES.includes(step.state)) {
        run.stepStates[step.key] = step.state as StepOutcome['state'];
      }
    }

    await deps.investigations.update(id, {
      status: 'running',
      startedAt: investigation.startedAt ?? now(),
      runner: options.runnerId,
      heartbeatAt: now(),
    });
    const setStep = (key: InvestigationStepKey, patch: Partial<InvestigationStep>) => {
      const index = steps.findIndex((step) => step.key === key);
      const base = steps[index] ?? {
        key,
        state: 'pending' as const,
        startedAt: null,
        finishedAt: null,
        issue: null,
        counts: {},
      };
      const next = { ...base, ...patch };
      if (index >= 0) steps[index] = next;
      else steps.push(next);
    };

    try {
      for (const key of INVESTIGATION_STEPS) {
        if (key !== 'context' && run.stepStates[key] !== undefined) continue;
        controller.signal.throwIfAborted();
        setStep(key, { state: 'running', startedAt: now(), finishedAt: null, issue: null });
        await deps.investigations.update(id, { steps: [...steps] });
        let outcome: StepOutcome;
        try {
          outcome = await STEPS[key](run);
        } catch (error) {
          if (controller.signal.aborted) throw error;
          deps.log(
            `[investigação] etapa ${key} falhou: ${error instanceof AppError ? error.reason : error instanceof Error ? error.name : 'erro'}`,
          );
          outcome = { state: 'failed', issue: 'unexpected' };
        }
        run.stepStates[key] = outcome.state;
        setStep(key, {
          state: outcome.state,
          finishedAt: now(),
          issue: outcome.issue ?? null,
          counts: outcome.counts ?? {},
        });
        if (key === 'context' && resumed) rehydrate(run);
        await deps.investigations.update(id, {
          steps: [...steps],
          usage: run.usage,
          models: run.models,
          snapshot: run.snapshot,
        });
        if (key === 'context' && outcome.state === 'failed') break;
      }
    } catch (error) {
      if (controller.signal.aborted) {
        for (const step of steps) {
          if (step.state === 'running') {
            setStep(step.key, { state: 'skipped', finishedAt: now(), issue: 'cancelled' });
          }
        }
        await finish('cancelled', steps, run, 'cancelled');
        return;
      }
      throw error;
    }
    const status = finalStatus(steps);
    const firstIssue =
      steps.find((step) => step.state === 'failed')?.issue ??
      steps.find((step) => step.state === 'skipped' && !BENIGN_ISSUES.includes(step.issue))
        ?.issue ??
      null;
    await finish(status, steps, run, status === 'succeeded' ? null : firstIssue);
  }

  return {
    async start(ctx, raw) {
      const input = parseInput(StartInvestigationInput, raw);
      const company = await requireCompany(input.companyId);
      if (company.lifecycle === 'archived') throw new AppError('conflict', 'company_archived');
      if (queue.length >= MAX_QUEUE) throw new AppError('unavailable', 'investigation_queue_full');
      // Uma investigação parada (processo encerrado no meio) não pode bloquear a empresa.
      await recoverStale();
      const history = await deps.investigations.listForCompany(company.id, 10);
      const previous =
        history.find((item) => item.status === 'succeeded' || item.status === 'partial') ?? null;
      const id = deps.newId();
      const created = await deps.investigations.create(
        {
          id,
          companyId: company.id,
          trigger: input.trigger,
          pipelineVersion: INVESTIGATION_PIPELINE_VERSION,
          steps: pendingSteps(),
          previousId: previous?.id ?? null,
          isDemo: company.isDemo,
        },
        pendingAudit(ctx, {
          action: 'company.investigation.started',
          entityType: 'company_investigation',
          entityId: id,
          diff: { companyId: company.id, trigger: input.trigger, force: input.force },
        }),
      );
      enqueue({ id, force: input.force, traceId: ctx.traceId });
      return created;
    },

    async cancel(ctx, rawId) {
      const id = parseInput(Uuid, rawId);
      const requested = await deps.investigations.requestCancel(
        id,
        now(),
        pendingAudit(ctx, {
          action: 'company.investigation.cancel_requested',
          entityType: 'company_investigation',
          entityId: id,
        }),
      );
      if (requested && current?.id === id) current.controller.abort();
      return requested;
    },

    async resume(ctx, rawId) {
      const id = parseInput(Uuid, rawId);
      const investigation = await deps.investigations.get(id);
      if (!investigation) throw new AppError('not_found', 'not_found');
      if (investigation.status !== 'interrupted' && investigation.status !== 'failed') {
        throw new AppError('conflict', 'investigation_not_resumable');
      }
      const company = await requireCompany(investigation.companyId);
      if (company.lifecycle === 'archived') throw new AppError('conflict', 'company_archived');
      if (queue.length >= MAX_QUEUE) throw new AppError('unavailable', 'investigation_queue_full');
      // Etapas que falharam rodam de novo; as concluídas ficam.
      const steps = investigation.steps.map((step) =>
        step.state === 'failed' || step.state === 'running'
          ? { ...step, state: 'pending' as const, startedAt: null, finishedAt: null, issue: null }
          : step,
      );
      const updated = await deps.investigations.updateAudited(
        id,
        { status: 'queued', steps, issue: null, finishedAt: null, runner: null, heartbeatAt: null },
        pendingAudit(ctx, {
          action: 'company.investigation.resumed',
          entityType: 'company_investigation',
          entityId: id,
        }),
      );
      if (!updated) throw new AppError('not_found', 'not_found');
      enqueue({ id, force: false, traceId: ctx.traceId });
      return updated;
    },

    async get(_ctx, rawId) {
      const id = Uuid.safeParse(rawId);
      return id.success ? deps.investigations.get(id.data) : null;
    },

    async captureImage(_ctx, rawCompanyId, file) {
      const companyId = Uuid.safeParse(rawCompanyId);
      if (!companyId.success || !CAPTURE_FILE_PATTERN.test(file) || !deps.captureStore) {
        return null;
      }
      const storagePath = `${companyId.data}/${file}`;
      // Claims substituídos também valem: a imagem de uma análise anterior continua sendo a
      // evidência dela até o fim da retenção (diretriz de 2026-11-26, Parte 13.2).
      const claims = await deps.evidence.claimsFor('company', companyId.data, {
        includeSuperseded: true,
      });
      const known = claims.some(
        (claim) =>
          claim.key.startsWith('visual.capture.') && claim.value?.storagePath === storagePath,
      );
      return known ? deps.captureStore.get(storagePath) : null;
    },

    async history(_ctx, rawCompanyId, limit = 10) {
      const companyId = parseInput(Uuid, rawCompanyId);
      return deps.investigations.listForCompany(companyId, Math.min(Math.max(limit, 1), 50));
    },

    async summaries(_ctx, companyIds) {
      const ids = companyIds.filter((id) => Uuid.safeParse(id).success);
      return ids.length > 0 ? deps.investigations.summaries(ids) : [];
    },

    async confirmSite(ctx, raw) {
      const input = parseInput(ConfirmSiteInput, raw);
      const company = await requireCompany(input.companyId);
      if (company.lifecycle === 'archived') throw new AppError('conflict', 'company_archived');
      if (company.primaryDomain === input.domain) return company;
      const updated = await deps.investigations.confirmSite(
        company.id,
        input.domain,
        pendingAudit(ctx, {
          action: 'company.site_confirmed',
          entityType: 'company',
          entityId: company.id,
          diff: { before: company.primaryDomain, after: input.domain },
        }),
      );
      if (!updated) throw new AppError('not_found', 'not_found');
      return updated;
    },

    recoverInterrupted: recoverStale,

    async idle() {
      await draining;
      while (pumping) await draining;
    },
  };
}
