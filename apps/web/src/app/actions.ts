'use server';

import { cookies } from 'next/headers';
import { THEME_COOKIE, parseTheme } from '@/lib/theme';

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
  });
}
