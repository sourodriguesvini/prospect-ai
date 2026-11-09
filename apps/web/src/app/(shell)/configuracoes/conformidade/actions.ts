'use server';

import { checked, formValues, text } from '@/lib/form-data';
import type { FormState } from '@/lib/form-state';
import { contactPolicyInput, liaInput } from '@/lib/strategy-forms';
import { strategyRoutes } from '@/lib/strategy-routes';
import { NOTHING_CHANGED, runStrategyAction } from '@/server/strategy';
import { complianceHref } from './notices';

/** Server Actions da Conformidade (F2): LIA versionada e política de contato (opt-out). */

export async function saveLiaAction(_prev: FormState, formData: FormData) {
  const values = formValues(formData);
  return runStrategyAction(values, async (strategy, ctx) => {
    const { changed } = await strategy.saveLia(ctx, liaInput(values));
    return changed ? complianceHref(strategyRoutes.compliance, 'lia-salva') : NOTHING_CHANGED;
  });
}

export async function approveLiaAction(id: string, _prev: FormState, formData: FormData) {
  const values = formValues(formData);
  return runStrategyAction(values, async (strategy, ctx) => {
    await strategy.approveLia(ctx, id, {
      reviewDueOn: text(values, 'reviewDueOn'),
      confirmed: checked(values, 'confirmed'),
    });
    return complianceHref(strategyRoutes.compliance, 'lia-aprovada');
  });
}

export async function revokeLiaAction(id: string, _prev: FormState, formData: FormData) {
  const values = formValues(formData);
  if (!checked(values, 'confirmed')) {
    return {
      status: 'error',
      message: 'Revise os campos destacados.',
      fieldErrors: {
        confirmed: ['Confirme que entende que as abordagens ficam bloqueadas.'],
      },
      values,
    } satisfies FormState;
  }
  return runStrategyAction(values, async (strategy, ctx) => {
    await strategy.revokeLia(ctx, id);
    return complianceHref(strategyRoutes.compliance, 'lia-revogada');
  });
}

export async function saveContactPolicyAction(_prev: FormState, formData: FormData) {
  const values = formValues(formData);
  return runStrategyAction(values, async (strategy, ctx) => {
    const { changed } = await strategy.saveContactPolicy(ctx, contactPolicyInput(values));
    return changed ? complianceHref(strategyRoutes.compliance, 'opt-out-salvo') : NOTHING_CHANGED;
  });
}
