import 'server-only';
import type { RequestContext } from '@prospector/application';
import { redirect } from 'next/navigation';
import { cache } from 'react';
import { getSupabase } from './supabase';

export interface SessionUser {
  id: string;
  email: string | null;
}

/** Usuário da sessão, com o JWT verificado (getClaims), ou null. */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const supabase = await getSupabase();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data) return null;
  const { sub, email } = data.claims;
  if (typeof sub !== 'string' || sub.length === 0) return null;
  return { id: sub, email: typeof email === 'string' ? email : null };
});

export async function requireUser(nextPath?: string): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect(nextPath ? `/entrar?next=${encodeURIComponent(nextPath)}` : '/entrar');
  return user;
}

export function contextFor(user: SessionUser): RequestContext {
  return { actor: { type: 'user', userId: user.id }, traceId: crypto.randomUUID() };
}
