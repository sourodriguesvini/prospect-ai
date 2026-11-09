import Link from 'next/link';

export function Wordmark({ href = '/app' }: { href?: string }) {
  return (
    <Link
      href={href}
      className="font-serif text-xl tracking-tight text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      Prospector
    </Link>
  );
}
