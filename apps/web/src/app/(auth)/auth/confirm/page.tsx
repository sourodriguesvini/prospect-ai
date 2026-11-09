import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { ConfirmEmailForm } from '@/components/forms/confirm-email-form';
import { parseConfirmLink } from '@/lib/auth-messages';

export const metadata: Metadata = { title: 'Confirmar e-mail', referrer: 'no-referrer' };

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Destino do link do e-mail de confirmação. Só mostra o botão: a sessão é criada no POST
 * (confirmEmailLink), nunca ao abrir o link.
 */
export default async function ConfirmEmailPage(props: PageProps<'/auth/confirm'>) {
  const params = await props.searchParams;
  const tokenHash = first(params.token_hash);
  const type = first(params.type);
  const code = first(params.code);
  if (!parseConfirmLink({ token_hash: tokenHash, type, code })) redirect('/entrar?erro=link');

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <h1 className="text-4xl">Confirmar e-mail</h1>
        <p className="text-sm text-muted-foreground">
          Falta um passo: confirme para ativar a conta e entrar.
        </p>
      </div>
      <ConfirmEmailForm
        tokenHash={tokenHash}
        type={type}
        code={code}
        next={first(params.next) ?? '/app'}
      />
    </div>
  );
}
