import Link from 'next/link';

export default function NotFound() {
  return (
    <main id="conteudo" className="mx-auto max-w-xl px-6 py-24">
      <p className="text-sm text-muted-foreground">404</p>
      <h1 className="mt-2 text-3xl">Não encontrado ou sem acesso</h1>
      <p className="mt-4 text-muted-foreground">
        A página não existe ou pertence a uma organização da qual você não faz parte.
      </p>
      <Link href="/app" className="mt-8 inline-block text-sm underline underline-offset-4">
        Voltar às suas organizações
      </Link>
    </main>
  );
}
