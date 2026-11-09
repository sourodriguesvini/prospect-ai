import Link from 'next/link';

export default function NotFound() {
  return (
    <main id="conteudo" className="mx-auto max-w-xl px-6 py-24">
      <p className="text-sm text-muted-foreground">404</p>
      <h1 className="mt-2 text-3xl">Página não encontrada</h1>
      <p className="mt-4 text-muted-foreground">Este endereço não existe no Prospector.</p>
      <Link href="/" className="mt-8 inline-block text-sm underline underline-offset-4">
        Voltar ao início
      </Link>
    </main>
  );
}
