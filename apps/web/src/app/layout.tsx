import type { Metadata } from 'next';
import { Geist, Newsreader } from 'next/font/google';
import { cookies } from 'next/headers';
import { THEME_COOKIE, parseTheme } from '@/lib/theme';
import './globals.css';

// Famílias provisórias (docs/07 §5): a decisão final de tipografia e licenças é da equipe de criação.
const display = Newsreader({ subsets: ['latin'], variable: '--font-display', display: 'swap' });
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
      className={`${display.variable} ${text.variable}`}
    >
      <body className="min-h-dvh">
        <a
          href="#conteudo"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:bg-background focus:px-3 focus:py-2 focus:outline-2 focus:outline-ring"
        >
          Pular para o conteúdo
        </a>
        {children}
      </body>
    </html>
  );
}
