'use server';

import { formValues, text } from '@/lib/form-data';
import type { FormState } from '@/lib/form-state';
import { COMPANY_NOTICES, companyRoutes } from '@/lib/company-routes';
import { runCompanyAction } from '@/server/companies';
import { runInvestigationAction } from '@/server/investigations';

/**
 * Server Actions de Empresas (M2). Só convertem o formulário e chamam o CompanyService;
 * validação, consulta de CNPJ, evidências e auditoria ficam no serviço. App só em 127.0.0.1.
 */

/** Consulta o CNPJ na base aberta da Receita e cadastra a empresa com os fatos do registro. */
export async function importCompanyAction(_prev: FormState, formData: FormData) {
  const values = formValues(formData);
  return runCompanyAction(
    values,
    async (companies, ctx) => {
      const result = await companies.importFromCnpj(ctx, {
        cnpj: text(values, 'importCnpj'),
        displayName: text(values, 'importName'),
      });
      if (result.status === 'failed') return { error: result.message };
      return companyRoutes.company(
        result.company.id,
        result.status === 'created' ? COMPANY_NOTICES.created : COMPANY_NOTICES.duplicate,
      );
    },
    // A tela tem o cadastro manual ao lado, com campos de mesmo nome.
    { cnpj: 'importCnpj', displayName: 'importName' },
  );
}

/** Cadastro manual: os dados ficam como informados por você, sem verificação. */
export async function createCompanyAction(_prev: FormState, formData: FormData) {
  const values = formValues(formData);
  return runCompanyAction(values, async (companies, ctx) => {
    const result = await companies.create(ctx, {
      schemaVersion: 1,
      displayName: text(values, 'displayName'),
      cnpj: text(values, 'cnpj'),
      primaryDomain: text(values, 'primaryDomain'),
      city: text(values, 'city'),
      uf: text(values, 'uf').trim().toUpperCase(),
    });
    return companyRoutes.company(
      result.company.id,
      result.status === 'created' ? COMPANY_NOTICES.created : COMPANY_NOTICES.duplicate,
    );
  });
}

export async function changeLifecycleAction(
  companyId: string,
  _prev: FormState,
  formData: FormData,
) {
  const values = formValues(formData);
  return runCompanyAction(values, async (companies, ctx) => {
    await companies.changeLifecycle(ctx, { companyId, lifecycle: text(values, 'lifecycle') });
  });
}

/**
 * Nova consulta do CNPJ: se algo mudou, os fatos novos substituem os anteriores (que ficam no
 * histórico); se nada mudou, nada é gravado.
 */
export async function refreshRegistryAction(
  companyId: string,
  _prev: FormState,
  formData: FormData,
) {
  return runCompanyAction(formValues(formData), async (companies, ctx) => {
    const result = await companies.refreshFromCnpj(ctx, companyId);
    if (result.status === 'failed') return { error: result.message };
    if (result.status === 'unchanged') {
      return companyRoutes.company(companyId, COMPANY_NOTICES.unchanged);
    }
    return companyRoutes.company(companyId, COMPANY_NOTICES.refreshed, result.changed);
  });
}

// -----------------------------------------------------------------------------
// Investigação (ADR-0015): só enfileiram e conferem; a execução roda no servidor, uma por vez.
// -----------------------------------------------------------------------------

/** Põe a investigação na fila. `force`: coleta tudo de novo, sem reaproveitar dados válidos. */
export async function startInvestigationAction(
  companyId: string,
  force: boolean,
  _prev: FormState,
  formData: FormData,
) {
  return runInvestigationAction(formValues(formData), async (investigations, ctx) => {
    await investigations.start(ctx, { companyId, trigger: 'user', force });
    return companyRoutes.company(companyId, COMPANY_NOTICES.investigationStarted);
  });
}

export async function cancelInvestigationAction(
  companyId: string,
  investigationId: string,
  _prev: FormState,
  formData: FormData,
) {
  return runInvestigationAction(formValues(formData), async (investigations, ctx) => {
    const cancelled = await investigations.cancel(ctx, investigationId);
    if (!cancelled) return { error: 'A investigação já tinha terminado; nada foi cancelado.' };
    return companyRoutes.company(companyId, COMPANY_NOTICES.investigationCancelled);
  });
}

/** Retoma sem repetir as etapas concluídas. */
export async function resumeInvestigationAction(
  companyId: string,
  investigationId: string,
  _prev: FormState,
  formData: FormData,
) {
  return runInvestigationAction(formValues(formData), async (investigations, ctx) => {
    await investigations.resume(ctx, investigationId);
    return companyRoutes.company(companyId, COMPANY_NOTICES.investigationResumed);
  });
}

/** Confirma o site oficial (candidato da investigação ou digitado), com auditoria. */
export async function confirmSiteAction(companyId: string, _prev: FormState, formData: FormData) {
  const values = formValues(formData);
  return runInvestigationAction(values, async (investigations, ctx) => {
    await investigations.confirmSite(ctx, { companyId, domain: text(values, 'domain') });
    return companyRoutes.company(companyId, COMPANY_NOTICES.siteConfirmed);
  });
}
