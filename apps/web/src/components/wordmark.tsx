import { Radar } from 'lucide-react';
import Link from 'next/link';

/** Marca em pílula: círculo laranja com o radar e o nome. */
export function Wordmark({ href = '/' }: { href?: string }) {
  return (
    <Link
      href={href}
      className="inline-flex h-12 items-center gap-2.5 rounded-full bg-surface py-1.5 pl-1.5 pr-5 text-base font-semibold tracking-tight text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      <span
        aria-hidden="true"
        className="grid size-9 place-items-center rounded-full bg-[image:var(--tile-accent)] text-white"
      >
        <Radar className="size-4" strokeWidth={2.25} />
      </span>
      Prospector
    </Link>
  );
}
