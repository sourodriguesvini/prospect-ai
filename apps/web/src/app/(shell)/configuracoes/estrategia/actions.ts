'use server';

import { formValues } from '@/lib/form-data';
import type { FormState } from '@/lib/form-state';
import { icpInput, offerInput, proofAssetInput, voiceInput } from '@/lib/strategy-forms';
import { CASE_ARCHIVED_NOTICE, strategyRoutes } from '@/lib/strategy-routes';
import { NOTHING_CHANGED, runStrategyAction } from '@/server/strategy';

/**
 * Server Actions da Estratégia (F2). Só convertem o formulário e chamam o StrategyService;
 * validação, regras e auditoria ficam no serviço. O app roda só em 127.0.0.1 (ADR-0007).
 */

/** Editores com estado no cliente (rubrica, score) enviam o conteúdo como JSON em `payload`. */
function payload(formData: FormData): unknown {
  const raw = formData.get('payload');
  if (typeof raw !== 'string') return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function createOfferAction(_prev: FormState, formData: FormData) {
  const values = formValues(formData);
  return runStrategyAction(values, async (strategy, ctx) => {
    const offer = await strategy.createOffer(ctx, offerInput(values));
    return strategyRoutes.offer(offer.id);
  });
}

export async function updateOfferAction(offerId: string, _prev: FormState, formData: FormData) {
  const values = formValues(formData);
  return runStrategyAction(values, async (strategy, ctx) => {
    const { changed } = await strategy.updateOffer(ctx, offerId, offerInput(values));
    return changed ? strategyRoutes.offer(offerId) : NOTHING_CHANGED;
  });
}

export async function changeOfferStatusAction(
  offerId: string,
  status: string,
  _prev: FormState,
  formData: FormData,
) {
  return runStrategyAction(formValues(formData), async (strategy, ctx) => {
    await strategy.changeOfferStatus(ctx, offerId, status);
  });
}

export async function saveRubricAction(offerId: string, _prev: FormState, formData: FormData) {
  return runStrategyAction(formValues(formData), async (strategy, ctx) => {
    const { changed } = await strategy.saveRubric(ctx, offerId, payload(formData));
    return changed ? strategyRoutes.offer(offerId) : NOTHING_CHANGED;
  });
}

export async function saveScoringModelAction(
  offerId: string,
  _prev: FormState,
  formData: FormData,
) {
  return runStrategyAction(formValues(formData), async (strategy, ctx) => {
    const { changed } = await strategy.saveScoringModel(ctx, offerId, payload(formData));
    return changed ? strategyRoutes.offer(offerId) : NOTHING_CHANGED;
  });
}

export async function createIcpAction(offerId: string, _prev: FormState, formData: FormData) {
  const values = formValues(formData);
  return runStrategyAction(values, async (strategy, ctx) => {
    const icp = await strategy.createIcp(ctx, offerId, icpInput(values));
    return strategyRoutes.icp(icp.id);
  });
}

export async function updateIcpAction(icpId: string, _prev: FormState, formData: FormData) {
  const values = formValues(formData);
  return runStrategyAction(values, async (strategy, ctx) => {
    const { changed } = await strategy.updateIcp(ctx, icpId, icpInput(values));
    return changed ? undefined : NOTHING_CHANGED;
  });
}

export async function changeIcpStatusAction(
  icpId: string,
  status: string,
  _prev: FormState,
  formData: FormData,
) {
  return runStrategyAction(formValues(formData), async (strategy, ctx) => {
    await strategy.changeIcpStatus(ctx, icpId, status);
  });
}

export async function saveVoiceGuideAction(_prev: FormState, formData: FormData) {
  const values = formValues(formData);
  return runStrategyAction(values, async (strategy, ctx) => {
    const { changed } = await strategy.saveVoiceGuide(ctx, voiceInput(values));
    return changed ? undefined : NOTHING_CHANGED;
  });
}

export async function createProofAssetAction(_prev: FormState, formData: FormData) {
  const values = formValues(formData);
  return runStrategyAction(values, async (strategy, ctx) => {
    await strategy.createProofAsset(ctx, proofAssetInput(values));
    return strategyRoutes.cases;
  });
}

export async function updateProofAssetAction(id: string, _prev: FormState, formData: FormData) {
  const values = formValues(formData);
  return runStrategyAction(values, async (strategy, ctx) => {
    await strategy.updateProofAsset(ctx, id, proofAssetInput(values));
    return strategyRoutes.cases;
  });
}

export async function archiveProofAssetAction(id: string, _prev: FormState, formData: FormData) {
  return runStrategyAction(formValues(formData), async (strategy, ctx) => {
    await strategy.archiveProofAsset(ctx, id);
    return `${strategyRoutes.cases}?aviso=${CASE_ARCHIVED_NOTICE}`;
  });
}
