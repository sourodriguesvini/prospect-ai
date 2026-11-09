'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { safeNextPath } from '@/lib/next-path';
import { THEME_COOKIE, parseTheme } from '@/lib/theme';
import { signOutCurrentSession } from '@/server/auth';

export async function setTheme(formData: FormData): Promise<void> {
  const theme = parseTheme(formData.get('theme'));
  const store = await cookies();
  if (theme === 'system') {
    store.delete(THEME_COOKIE);
    return;
  }
  store.set(THEME_COOKIE, theme, {
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
    sameSite: 'lax',
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
  });
}

/** Encerra a sessão. Com `next`, volta ao login já apontando para lá (ex.: aceitar convite com outra conta). */
export async function signOut(formData: FormData): Promise<void> {
  await signOutCurrentSession();
  const next = formData.get('next');
  redirect(next ? `/entrar?next=${encodeURIComponent(safeNextPath(next))}` : '/entrar');
}
