'use server';

import { isAppError } from '@prospector/application';
import { redirect } from 'next/navigation';
import type { ActionState } from '@/lib/action-state';
import { toErrorState } from '@/server/action-errors';
import { getServices } from '@/server/container';
import { contextFor, requireUser } from '@/server/session';

export async function acceptInvitation(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const ctx = contextFor(await requireUser());
  let slug: string;
  try {
    const { tenancy } = await getServices();
    ({ slug } = await tenancy.acceptInvitation(ctx, { token: formData.get('token') }));
  } catch (error) {
    if (isAppError(error) && error.reason === 'already_member') {
      return {
        status: 'error',
        message: 'Você já faz parte desta organização. Abra-a pela lista de organizações.',
      };
    }
    return toErrorState(error, ctx.traceId);
  }
  redirect(`/o/${slug}`);
}
