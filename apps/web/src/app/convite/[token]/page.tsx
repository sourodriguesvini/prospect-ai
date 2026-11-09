import type { Metadata } from 'next';
import Link from 'next/link';
import { signOut } from '@/app/actions';
import { AcceptInvitationForm } from '@/components/forms/accept-invitation-form';
import { ThemeSwitcher } from '@/components/theme-switcher';
import { Wordmark } from '@/components/wordmark';
import { requireUser } from '@/server/session';

export const metadata: Metadata = { title: 'Convite', referrer: 'no-referrer' };

export default async function InvitationPage({ params }: PageProps<'/convite/[token]'>) {
  const { token } = await params;
  const path = `/convite/${token}`;
  const user = await requireUser(path);

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex items-center justify-between px-6 py-5 sm:px-10">
        <Wordmark />
        <ThemeSwitcher />
      </header>
      <main id="conteudo" className="flex flex-1 justify-center px-6 pb-16 pt-10 sm:pt-20">
        <div className="w-full max-w-md space-y-8">
          <div className="space-y-2">
            <h1 className="text-4xl">Convite para uma organização</h1>
            <p className="text-sm text-muted-foreground">
              Você está conectado como{' '}
              <strong className="text-foreground">{user.email ?? 'conta sem e-mail'}</strong>. O
              convite só pode ser aceito pela conta do e-mail convidado, com o e-mail confirmado.
            </p>
          </div>
          <AcceptInvitationForm token={token} />
          <p className="text-sm text-muted-foreground">
            <Link href="/app" className="text-foreground underline underline-offset-4">
              Ver minhas organizações
            </Link>
          </p>
          <form action={signOut} className="text-sm text-muted-foreground">
            <input type="hidden" name="next" value={path} />
            Não é você?{' '}
            <button type="submit" className="text-foreground underline underline-offset-4">
              Sair e entrar com outra conta
            </button>
          </form>
        </div>
      </main>
    </div>
  );
}
