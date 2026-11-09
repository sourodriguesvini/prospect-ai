import { ThemeSwitcher } from '@/components/theme-switcher';
import { Wordmark } from '@/components/wordmark';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex items-center justify-between px-6 py-5 sm:px-10">
        <Wordmark href="/entrar" />
        <ThemeSwitcher />
      </header>
      <main
        id="conteudo"
        className="flex flex-1 items-start justify-center px-6 pb-16 pt-10 sm:pt-20"
      >
        <div className="w-full max-w-sm">{children}</div>
      </main>
    </div>
  );
}
