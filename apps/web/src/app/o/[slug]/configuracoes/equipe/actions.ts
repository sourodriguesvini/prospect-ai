'use server';

import { refresh } from 'next/cache';
import { pickValues, type ActionState } from '@/lib/action-state';
import { toErrorState } from '@/server/action-errors';
import { getServices } from '@/server/container';
import { serverEnv } from '@/server/env';
import { contextFor, requireUser } from '@/server/session';

export interface InvitationCreated {
  email: string;
  link: string;
  expiresAt: string;
}

/**
 * Cria o convite e devolve o link para o administrador compartilhar. O token aparece só
 * nesta resposta (o banco guarda apenas o hash). O envio por e-mail virá com o ESP de sistema.
 */
export async function inviteMember(
  _prev: ActionState<InvitationCreated>,
  formData: FormData,
): Promise<ActionState<InvitationCreated>> {
  const ctx = contextFor(await requireUser());
  const values = pickValues(formData, ['email', 'role']);
  try {
    const { tenancy } = await getServices();
    const created = await tenancy.inviteMember(ctx, { orgId: formData.get('orgId'), ...values });
    const link = new URL(`/convite/${created.token}`, serverEnv().NEXT_PUBLIC_SITE_URL).toString();
    refresh();
    return {
      status: 'success',
      message: 'Convite criado.',
      data: { email: values.email?.trim().toLowerCase() ?? '', link, expiresAt: created.expiresAt },
    };
  } catch (error) {
    return { ...toErrorState(error, ctx.traceId), values };
  }
}

export async function changeMemberRole(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const ctx = contextFor(await requireUser());
  const role = formData.get('role');
  if (typeof role !== 'string' || role === '') {
    return { status: 'error', message: 'Escolha o novo papel.' };
  }
  // Conceder "Proprietário" dá controle total: exige confirmação explícita, também no servidor.
  if (role === 'owner' && formData.get('confirmOwner') !== 'on') {
    return {
      status: 'error',
      message: 'Confirme que deseja conceder o papel de proprietário antes de continuar.',
    };
  }
  try {
    const { tenancy } = await getServices();
    await tenancy.changeMemberRole(ctx, {
      orgId: formData.get('orgId'),
      userId: formData.get('userId'),
      role,
    });
    refresh();
    return { status: 'success', message: 'Papel alterado.' };
  } catch (error) {
    return toErrorState(error, ctx.traceId);
  }
}

export async function removeMember(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = contextFor(await requireUser());
  try {
    const { tenancy } = await getServices();
    await tenancy.removeMember(ctx, {
      orgId: formData.get('orgId'),
      userId: formData.get('userId'),
    });
    refresh();
    return { status: 'success', message: 'Membro removido.' };
  } catch (error) {
    return toErrorState(error, ctx.traceId);
  }
}

export async function revokeInvitation(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const ctx = contextFor(await requireUser());
  try {
    const { tenancy } = await getServices();
    await tenancy.revokeInvitation(ctx, {
      orgId: formData.get('orgId'),
      invitationId: formData.get('invitationId'),
    });
    refresh();
    return { status: 'success', message: 'Convite revogado.' };
  } catch (error) {
    return toErrorState(error, ctx.traceId);
  }
}
