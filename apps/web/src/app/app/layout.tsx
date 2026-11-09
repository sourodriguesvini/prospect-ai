import { UserMenu } from '@/components/user-menu';
import { Wordmark } from '@/components/wordmark';
import { requireUser } from '@/server/session';

export default async function AccountLayout({ children }: LayoutProps<'/app'>) {
  const user = await requireUser('/app');
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b px-6 py-4 sm:px-10">
        <Wordmark />
        <UserMenu email={user.email} />
      </header>
      <main id="conteudo" className="mx-auto w-full max-w-3xl flex-1 px-6 py-12 sm:px-10">
        {children}
      </main>
    </div>
  );
}
