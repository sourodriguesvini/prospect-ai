import { Radar } from 'lucide-react';
import Link from 'next/link';

/**
 * Marca em pílula: círculo laranja com o radar e o nome. O círculo tem o tamanho e o recuo dos
 * ícones do trilho (NavIcon dentro de p-1), então fica na mesma coluna que eles.
 */
export function Wordmark({ href = '/' }: { href?: string }) {
  return (
    <Link
      href={href}
      className="inline-flex h-10 items-center gap-2.5 rounded-full bg-surface p-1 pr-5 sm:h-12 text-base font-semibold tracking-tight text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      <span
        aria-hidden="true"
        className="grid size-8 place-items-center rounded-full sm:size-10 bg-[image:var(--tile-accent)] text-white"
      >
        <Radar className="size-4" strokeWidth={2.25} />
      </span>
      Prospector
    </Link>
  );
}
