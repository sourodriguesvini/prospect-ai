import 'server-only';
import {
  AUTH_UNAVAILABLE,
  authErrorMessage,
  isConcealedSignUpError,
  type ConfirmLink,
} from '@/lib/auth-messages';
import { getSupabase } from './supabase';

/**
 * Fachada de autenticação (Supabase Auth). Junto de session.ts e container.ts, é o único
 * lugar da web que fala com o Supabase; páginas e actions usam estas funções (ADR-0001).
 */

export type AuthResult = { ok: true } | { ok: false; message: string };

export async function signInWithPassword(credentials: {
  email: string;
  password: string;
}): Promise<AuthResult> {
  try {
    const supabase = await getSupabase();
    const { error } = await supabase.auth.signInWithPassword(credentials);
    return error ? { ok: false, message: authErrorMessage(error) } : { ok: true };
  } catch {
    return { ok: false, message: AUTH_UNAVAILABLE };
  }
}

export type SignUpResult = { ok: true; hasSession: boolean } | { ok: false; message: string };

export async function signUpWithPassword(input: {
  email: string;
  password: string;
  fullName: string;
  confirmUrl: string;
}): Promise<SignUpResult> {
  try {
    const supabase = await getSupabase();
    const { data, error } = await supabase.auth.signUp({
      email: input.email,
      password: input.password,
      options: { data: { full_name: input.fullName }, emailRedirectTo: input.confirmUrl },
    });
    if (error) {
      // E-mail já cadastrado não é revelado: a resposta é a mesma de um cadastro novo.
      if (isConcealedSignUpError(error.code)) return { ok: true, hasSession: false };
      return { ok: false, message: authErrorMessage(error) };
    }
    // Sem confirmação de e-mail (ambiente que a desativou), a sessão já existe.
    return { ok: true, hasSession: data.session !== null };
  } catch {
    return { ok: false, message: AUTH_UNAVAILABLE };
  }
}

/** Troca o link de confirmação por uma sessão. Chamado só por POST (ver auth/confirm). */
export async function confirmEmail(link: ConfirmLink): Promise<boolean> {
  try {
    const supabase = await getSupabase();
    const { error } =
      'code' in link
        ? await supabase.auth.exchangeCodeForSession(link.code)
        : await supabase.auth.verifyOtp({ type: link.type, token_hash: link.tokenHash });
    return !error;
  } catch {
    return false;
  }
}

export async function signOutCurrentSession(): Promise<void> {
  const supabase = await getSupabase();
  await supabase.auth.signOut();
}
