import type { Metadata } from 'next';
import { Geist } from 'next/font/google';
import { cookies } from 'next/headers';
import { THEME_COOKIE, parseTheme } from '@/lib/theme';
import './globals.css';

// Uma grotesca para tudo (design system, docs/07 §5). Geist: licença OFL.
const text = Geist({ subsets: ['latin'], variable: '--font-text', display: 'swap' });

export const metadata: Metadata = {
  title: { default: 'Prospector', template: '%s · Prospector' },
  description: 'Inteligência comercial com evidências e aprovação humana.',
  robots: { index: false, follow: false },
};

export default async function RootLayout({ children }: LayoutProps<'/'>) {
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);
  return (
    <html
      lang="pt-BR"
      data-theme={theme === 'system' ? undefined : theme}
      className={text.variable}
    >
      <body className="min-h-dvh">
        <a
          href="#conteudo"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-surface focus:px-3 focus:py-2 focus:outline-2 focus:outline-ring"
        >
          Pular para o conteúdo
        </a>
        {children}
      </body>
    </html>
  );
}
