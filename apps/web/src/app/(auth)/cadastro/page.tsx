import { Alert } from '@prospector/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { SignUpForm } from '@/components/forms/sign-up-form';
import { safeNextPath } from '@/lib/next-path';

export const metadata: Metadata = { title: 'Criar conta' };

export default async function SignUpPage(props: PageProps<'/cadastro'>) {
  const { next } = await props.searchParams;
  const nextPath = safeNextPath(Array.isArray(next) ? next[0] : next);
  const signInHref =
    nextPath === '/app' ? '/entrar' : `/entrar?next=${encodeURIComponent(nextPath)}`;

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <h1 className="text-4xl">Criar conta</h1>
        <p className="text-sm text-muted-foreground">
          Depois de confirmar o e-mail, você cria a sua organização ou aceita um convite.
        </p>
      </div>
      {nextPath.startsWith('/convite/') ? (
        <Alert tone="info">
          Você está abrindo um convite. Crie a conta com o mesmo e-mail que recebeu o convite para
          aceitá-lo.
        </Alert>
      ) : null}
      <SignUpForm next={nextPath} />
      <p className="text-sm text-muted-foreground">
        Já tem conta?{' '}
        <Link href={signInHref} className="text-foreground underline underline-offset-4">
          Entrar
        </Link>
      </p>
    </div>
  );
}
