import { cookies } from 'next/headers';
import { AppShell } from '@/components/shell/app-shell';
import { ThemeSwitcher } from '@/components/theme-switcher';
import { parseSidebar, SIDEBAR_COOKIE } from '@/lib/sidebar';

/**
 * Moldura do app (design system, docs/07 §5): menu lateral único à esquerda, fixo e recolhível,
 * com marca, busca (Ctrl+K), navegação em grupos, estado deste computador e tema. O cookie diz
 * se o menu vem recolhido, para a página já chegar no estado certo.
 */
export default async function ShellLayout({ children }: LayoutProps<'/'>) {
  const collapsed = parseSidebar((await cookies()).get(SIDEBAR_COOKIE)?.value) === 'collapsed';
  return (
    <AppShell initialCollapsed={collapsed} theme={<ThemeSwitcher />}>
      {children}
    </AppShell>
  );
}
