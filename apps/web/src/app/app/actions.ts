'use server';

import { redirect } from 'next/navigation';
import { pickValues, type ActionState } from '@/lib/action-state';
import { toErrorState } from '@/server/action-errors';
import { getServices } from '@/server/container';
import { contextFor, requireUser } from '@/server/session';

export async function createOrganization(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser('/app/nova-organizacao');
  const ctx = contextFor(user);
  const values = pickValues(formData, ['name', 'slug']);
  let slug: string;
  try {
    const { tenancy } = await getServices();
    ({ slug } = await tenancy.createOrganization(ctx, values));
  } catch (error) {
    return { ...toErrorState(error, ctx.traceId), values };
  }
  redirect(`/o/${slug}`);
}
