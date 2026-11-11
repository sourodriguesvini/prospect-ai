'use server';

import { companyRoutes } from '@/lib/company-routes';
import { DISCOVERY_NOTICES, discoveryRoutes } from '@/lib/discovery-routes';
import { all, formValues, text, type FormValues } from '@/lib/form-data';
import type { FormState } from '@/lib/form-state';
import { runDiscoveryAction } from '@/server/discovery';

/**
 * Server Actions da Descoberta (F4). Só convertem o formulário e chamam o DiscoveryService;
 * validação, fila, créditos e auditoria ficam no serviço. A pesquisa roda em segundo plano
 * (trabalhador da fila); a ação só cria e leva para a tela dela. App só em 127.0.0.1.
 */

/** Número digitado; vazio = null; o que não for número segue como texto (o contrato recusa). */
function optionalNumber(values: FormValues, name: string): number | string | null {
  const raw = text(values, name).trim();
  if (raw === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : raw;
}

function optionalText(values: FormValues, name: string): string | null {
  const raw = text(values, name).trim();
  return raw === '' ? null : raw;
}

export async function createRunAction(_prev: FormState, formData: FormData) {
  const values = formValues(formData);
  return runDiscoveryAction(values, async (discovery, ctx) => {
    const run = await discovery.createRun(ctx, {
      request: text(values, 'request'),
      city: optionalText(values, 'city'),
      uf: optionalText(values, 'uf')?.toUpperCase() ?? null,
      quantity: optionalNumber(values, 'quantity'),
      depth: optionalText(values, 'depth'),
      signals: all(values, 'signals'),
    });
    return discoveryRoutes.run(run.id, DISCOVERY_NOTICES.created);
  });
}

/** Pesquisa preparada pelo Copiloto: só roda depois desta confirmação. */
export async function confirmRunAction(runId: string, _prev: FormState, formData: FormData) {
  return runDiscoveryAction(formValues(formData), async (discovery, ctx) => {
    await discovery.confirmRun(ctx, runId);
    return discoveryRoutes.run(runId, DISCOVERY_NOTICES.confirmed);
  });
}

export async function cancelRunAction(runId: string, _prev: FormState, formData: FormData) {
  return runDiscoveryAction(formValues(formData), async (discovery, ctx) => {
    await discovery.cancelRun(ctx, runId);
    return discoveryRoutes.run(runId, DISCOVERY_NOTICES.cancelled);
  });
}

/** Rascunho do Copiloto descartado antes de rodar (mensagem própria: nada foi buscado). */
export async function discardRunAction(runId: string, _prev: FormState, formData: FormData) {
  return runDiscoveryAction(formValues(formData), async (discovery, ctx) => {
    await discovery.cancelRun(ctx, runId);
    return discoveryRoutes.run(runId, DISCOVERY_NOTICES.discarded);
  });
}

export async function retryRunAction(runId: string, _prev: FormState, formData: FormData) {
  return runDiscoveryAction(formValues(formData), async (discovery, ctx) => {
    const run = await discovery.retryRun(ctx, runId);
    return discoveryRoutes.run(run.id, DISCOVERY_NOTICES.retried);
  });
}

/** Salvar, ignorar (com motivo) ou voltar a "nova". */
export async function decideProspectAction(
  prospectId: string,
  status: 'saved' | 'dismissed' | 'new',
  _prev: FormState,
  formData: FormData,
) {
  const values = formValues(formData);
  return runDiscoveryAction(values, async (discovery, ctx) => {
    await discovery.decide(ctx, {
      prospectId,
      status,
      reason: optionalText(values, 'reason'),
    });
  });
}

/**
 * Investigar: cria (ou liga) a empresa em Empresas com origem Descoberta e grava as fontes e os
 * sinais como evidências; a investigação continua no dossiê.
 */
export async function investigateProspectAction(
  prospectId: string,
  _prev: FormState,
  formData: FormData,
) {
  return runDiscoveryAction(formValues(formData), async (discovery, ctx) => {
    const result = await discovery.investigate(ctx, prospectId);
    return companyRoutes.company(result.companyId);
  });
}

export async function createMonitorAction(_prev: FormState, formData: FormData) {
  const values = formValues(formData);
  return runDiscoveryAction(values, async (discovery, ctx) => {
    await discovery.createMonitor(ctx, {
      name: text(values, 'name'),
      request: text(values, 'request'),
      frequency: text(values, 'frequency'),
      maxSearches: optionalNumber(values, 'maxSearches') ?? undefined,
      maxProspects: optionalNumber(values, 'maxProspects') ?? undefined,
    });
    return discoveryRoutes.monitorsWithNotice(DISCOVERY_NOTICES.monitorCreated);
  });
}

export async function setMonitorStatusAction(
  monitorId: string,
  status: 'active' | 'paused' | 'archived',
  _prev: FormState,
  formData: FormData,
) {
  return runDiscoveryAction(formValues(formData), async (discovery, ctx) => {
    await discovery.setMonitorStatus(ctx, monitorId, status);
  });
}

export async function runMonitorNowAction(monitorId: string, _prev: FormState, formData: FormData) {
  return runDiscoveryAction(formValues(formData), async (discovery, ctx) => {
    const run = await discovery.runMonitorNow(ctx, monitorId);
    return discoveryRoutes.run(run.id, DISCOVERY_NOTICES.monitorRun);
  });
}
