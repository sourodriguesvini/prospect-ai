import type { ReactNode } from 'react';
import { normalizeListMarkers } from '@/lib/rich-text';

/**
 * Mostra a resposta do modelo como texto, com uma única formatação: `**negrito**` vira <strong>.
 * Nada é interpretado como HTML (o React escapa tudo); listas com asterisco viram listas com hífen
 * e o resto fica como o modelo escreveu, com as quebras de linha preservadas pelo
 * `whitespace-pre-wrap` de quem usa.
 */
export function RichText({ text: raw }: { text: string }) {
  const text = normalizeListMarkers(raw);
  const parts: ReactNode[] = [];
  const bold = /\*\*([^*\n]+?)\*\*/g;
  let last = 0;
  for (const match of text.matchAll(bold)) {
    const start = match.index;
    if (start > last) parts.push(text.slice(last, start));
    parts.push(
      <strong key={start} className="font-semibold">
        {match[1]}
      </strong>,
    );
    last = start + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}
