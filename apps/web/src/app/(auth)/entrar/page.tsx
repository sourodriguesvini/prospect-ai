import { Alert } from '@prospector/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { SignInForm } from '@/components/forms/sign-in-form';
import { safeNextPath } from '@/lib/next-path';

export const metadata: Metadata = { title: 'Entrar' };

export default async function SignInPage(props: PageProps<'/entrar'>) {
  const { next, erro } = await props.searchParams;
  const nextPath = safeNextPath(Array.isArray(next) ? next[0] : next);
  const signUpHref =
    nextPath === '/app' ? '/cadastro' : `/cadastro?next=${encodeURIComponent(nextPath)}`;

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <h1 className="text-4xl">Entrar</h1>
        <p className="text-sm text-muted-foreground">Acesse a sua organização.</p>
      </div>
      {erro === 'link' ? (
        <Alert tone="danger">
          O link de confirmação é inválido ou expirou. Entre com e-mail e senha ou crie a conta
          novamente.
        </Alert>
      ) : null}
      {nextPath.startsWith('/convite/') ? (
        <Alert tone="info">
          Você está abrindo um convite. Entre com o mesmo e-mail que recebeu o convite para
          aceitá-lo.
        </Alert>
      ) : null}
      <SignInForm next={nextPath} />
      <p className="text-sm text-muted-foreground">
        Ainda não tem conta?{' '}
        <Link href={signUpHref} className="text-foreground underline underline-offset-4">
          Criar conta
        </Link>
      </p>
    </div>
  );
}
