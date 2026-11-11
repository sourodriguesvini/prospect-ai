'use client';

import { useCallback, useEffect, useRef, useState, type FocusEvent, type MouseEvent } from 'react';

/** Mesma largura em que o menu deixa de ser gaveta (`md` do Tailwind). */
export const DESKTOP_QUERY = '(min-width: 48rem)';

interface Tip {
  text: string;
  top: number;
  left: number;
  source: HTMLElement;
}

/**
 * Dica ao lado dos itens do menu recolhido (só ícones). O texto vem de `data-tip`; com
 * `data-tip-always` a dica aparece também com o menu expandido (indicadores do rodapé).
 * A dica repete o nome acessível, então fica fora da árvore de acessibilidade.
 *
 * WCAG 1.4.13: some com Esc, continua visível com o ponteiro sobre ela e não some sozinha.
 * Fica em `position: fixed` para não ser cortada pela rolagem do menu.
 */
export function useSidebarTooltip(collapsed: boolean) {
  const [tip, setTip] = useState<Tip | null>(null);
  const tipRef = useRef<HTMLDivElement>(null);

  const showFor = useCallback(
    (target: EventTarget | null) => {
      if (!(target instanceof Element)) return;
      const source = target.closest<HTMLElement>('[data-tip]');
      if (!source) return;
      const always = source.hasAttribute('data-tip-always');
      if (!always && !collapsed) return;
      if (!window.matchMedia(DESKTOP_QUERY).matches) return;
      const rect = source.getBoundingClientRect();
      setTip((current) =>
        current?.source === source
          ? current
          : {
              text: source.dataset.tip ?? '',
              top: rect.top + rect.height / 2,
              left: rect.right,
              source,
            },
      );
    },
    [collapsed],
  );

  const hide = useCallback(() => setTip(null), []);

  useEffect(() => {
    if (!tip) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setTip(null);
    };
    const onScroll = () => setTip(null);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [tip]);

  const handlers = {
    onMouseOver: (event: MouseEvent) => showFor(event.target),
    onMouseOut: (event: MouseEvent) => {
      const next = event.relatedTarget;
      if (next instanceof Node && tipRef.current?.contains(next)) return;
      if (next instanceof Element && next.closest('[data-tip]') === tip?.source) return;
      // Vai para outro item: o mouseover dele mostra a dica nova.
      if (!(next instanceof Element) || !next.closest('[data-tip]')) hide();
    },
    onFocus: (event: FocusEvent) => {
      // Dica pelo teclado: só quando o foco é visível (não ao clicar).
      if (event.target instanceof Element && event.target.matches(':focus-visible')) {
        showFor(event.target);
      }
    },
    onBlur: hide,
  };

  const element = tip ? (
    <div
      ref={tipRef}
      aria-hidden="true"
      onMouseLeave={(event) => {
        const next = event.relatedTarget;
        if (next instanceof Node && tip.source.contains(next)) return;
        hide();
      }}
      // pl transparente: o ponteiro passa do item para a dica sem atravessar um vão.
      className="fixed z-[60] -translate-y-1/2 pl-5"
      style={{ top: tip.top, left: tip.left }}
    >
      <div className="max-w-64 rounded-2xl bg-primary px-3 py-1.5 text-xs font-medium text-pretty text-primary-foreground shadow-[var(--shadow-float)] motion-safe:animate-float-in">
        {tip.text}
      </div>
    </div>
  ) : null;

  return { handlers, element, hide };
}
