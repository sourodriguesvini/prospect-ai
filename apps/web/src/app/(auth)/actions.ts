'use server';

import { parseInput } from '@prospector/application';
import { SignInInput, SignUpInput } from '@prospector/contracts';
import { redirect } from 'next/navigation';
import { pickValues, type ActionState } from '@/lib/action-state';
import { CONFIRM_LINK_INVALID, parseConfirmLink } from '@/lib/auth-messages';
import { resolveConfirmNext, safeNextPath } from '@/lib/next-path';
import { toErrorState } from '@/server/action-errors';
import { confirmEmail, signInWithPassword, signUpWithPassword } from '@/server/auth';
import { serverEnv } from '@/server/env';

function text(value: FormDataEntryValue | null): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export async function signIn(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const values = pickValues(formData, ['email']);
  let input: SignInInput;
  try {
    input = parseInput(SignInInput, {
      email: formData.get('email'),
      password: formData.get('password'),
    });
  } catch (error) {
    return { ...toErrorState(error, crypto.randomUUID()), values };
  }

  const result = await signInWithPassword(input);
  if (!result.ok) return { status: 'error', message: result.message, values };
  redirect(safeNextPath(formData.get('next')));
}

export async function signUp(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const values = pickValues(formData, ['fullName', 'email']);
  let input: SignUpInput;
  try {
    input = parseInput(SignUpInput, {
      fullName: formData.get('fullName'),
      email: formData.get('email'),
      password: formData.get('password'),
    });
  } catch (error) {
    return { ...toErrorState(error, crypto.randomUUID()), values };
  }

  const next = safeNextPath(formData.get('next'));
  const confirmUrl = new URL('/auth/confirm', serverEnv().NEXT_PUBLIC_SITE_URL);
  confirmUrl.searchParams.set('next', next);

  const result = await signUpWithPassword({ ...input, confirmUrl: confirmUrl.toString() });
  if (!result.ok) return { status: 'error', message: result.message, values };
  if (result.hasSession) redirect(next);
  return {
    status: 'success',
    message: `Enviamos um link de confirmação para ${input.email}. Abra-o para ativar a conta.`,
  };
}

/**
 * Confirma o e-mail a partir do link recebido. Roda só por POST (Server Action, com checagem
 * de origem do Next): abrir o link por GET não cria sessão, o que impede login forçado por
 * link de terceiros e evita que antivírus de e-mail consumam o token de uso único.
 */
export async function confirmEmailLink(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const link = parseConfirmLink({
    token_hash: text(formData.get('token_hash')),
    type: text(formData.get('type')),
    code: text(formData.get('code')),
  });
  if (!link || !(await confirmEmail(link))) {
    return { status: 'error', message: CONFIRM_LINK_INVALID };
  }
  redirect(
    resolveConfirmNext(text(formData.get('next')) ?? null, serverEnv().NEXT_PUBLIC_SITE_URL),
  );
}
