import 'server-only';
import {
  ERROR_MESSAGES,
  isAppError,
  type EmailSettingsService,
  type RequestContext,
} from '@prospector/application';
import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import type { FormValues } from '@/lib/form-data';
import type { FormState } from '@/lib/form-state';
import { EMAIL_SETTINGS_HREF } from '@/lib/email-forms';
import { getServices } from './container';
import type { StorageMode } from './env';
import { userContext } from './context';

export type EmailLoad<T> =
  | { kind: 'ok'; data: T; storage: StorageMode; synthetic: boolean }
  | { kind: 'unavailable'; message: string };

/** Leitura para a tela de e-mail: banco ausente ou fora do ar vira aviso, não erro. */
export async function loadEmail<T>(
  read: (email: EmailSettingsService, ctx: RequestContext) => Promise<T>,
): Promise<EmailLoad<T>> {
  const { email, storage, emailSynthetic } = getServices();
  if (!email) return { kind: 'unavailable', message: ERROR_MESSAGES.database_not_configured };
  try {
    return {
      kind: 'ok',
      data: await read(email, userContext()),
      storage,
      synthetic: emailSynthetic,
    };
  } catch (error) {
    if (isAppError(error) && error.code === 'unavailable') {
      return { kind: 'unavailable', message: error.message };
    }
    throw error;
  }
}

/**
 * Executa uma Server Action do e-mail. `values` é o que volta ao formulário depois de um erro:
 * quem chama nunca inclui a senha (ela não é reexibida).
 */
export async function runEmailAction(
  values: FormValues,
  write: (
    email: EmailSettingsService,
    ctx: RequestContext,
    mode: { storage: StorageMode; synthetic: boolean },
  ) => Promise<string | void>,
): Promise<FormState> {
  const { email, storage, emailSynthetic } = getServices();
  if (!email) {
    return { status: 'error', message: ERROR_MESSAGES.database_not_configured, values };
  }
  let message: string | void;
  try {
    message = await write(email, userContext(), { storage, synthetic: emailSynthetic });
  } catch (error) {
    unstable_rethrow(error);
    if (isAppError(error) && error.code !== 'unexpected') {
      return {
        status: 'error',
        message: error.message,
        ...(error.fieldErrors ? { fieldErrors: error.fieldErrors } : {}),
        values,
        at: Date.now(),
      };
    }
    throw error;
  }
  revalidatePath(EMAIL_SETTINGS_HREF);
  return { status: 'saved', message: message || 'Salvo.', at: Date.now() };
}
