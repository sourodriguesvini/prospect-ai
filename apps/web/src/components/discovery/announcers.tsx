'use client';

import { CircleCheck } from 'lucide-react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';

/**
 * Anúncios e foco depois das ações da Descoberta (WCAG 4.1.3 e 2.4.3). As listas trocam de
 * conteúdo depois de Salvar, Ignorar ou Arquivar (o item pode sumir); a mensagem fica numa região
 * de status que não some, e o foco vai para onde a pessoa continua, em vez de cair no início da
 * página.
 */

/** Marca do item de uma lista (cartão de empresa, monitoramento) e do título que recebe o foco. */
export const CARD_ATTR = 'data-card';
export const CARD_TITLE_ATTR = 'data-card-title';

/**
 * Para onde vai o foco depois da ação: um elemento (o próprio botão, que continua no lugar) ou o
 * título da lista, quando o item sumiu e não há próximo.
 */
export type FocusTarget = { id: string } | 'list' | null;

type Announce = (message: string, focus: FocusTarget) => void;

const AnnouncerContext = createContext<Announce | null>(null);

/** Função de anúncio da lista em volta; null fora de uma `ActionAnnouncer`. */
export function useAnnouncer(): Announce | null {
  return useContext(AnnouncerContext);
}

/**
 * Título do próximo item da lista, calculado ANTES da ação (o item atual pode sumir com a
 * resposta). Sem próximo: o título da lista.
 */
export function nextItemFocus(from: Element | null): FocusTarget {
  const card = from?.closest(`[${CARD_ATTR}]`);
  for (let node = card?.nextElementSibling; node; node = node.nextElementSibling) {
    const title = node.querySelector(`[${CARD_TITLE_ATTR}]`);
    if (title?.id) return { id: title.id };
  }
  return 'list';
}

/** Foca o elemento (títulos não são focáveis: ganham tabindex=-1, fora da ordem do Tab). */
export function focusById(id: string): boolean {
  const element = document.getElementById(id);
  if (!element) return false;
  if (!element.hasAttribute('tabindex') && element.tabIndex < 0) {
    element.setAttribute('tabindex', '-1');
  }
  element.focus();
  return true;
}

interface Entry {
  message: string;
  focus: FocusTarget;
  seq: number;
}

/**
 * Região de status de uma lista, fora dos itens: "Studio Boreal salva.", "Clínica X ignorada.".
 * A mesma mensagem duas vezes ainda é lida (cada anúncio troca o nó de texto).
 */
export function ActionAnnouncer({
  listTitleId,
  children,
}: {
  /** Título da lista (sempre na tela): recebe o foco quando o item some e não há próximo. */
  listTitleId: string;
  children: ReactNode;
}) {
  const [entry, setEntry] = useState<Entry | null>(null);
  const seq = useRef(0);
  const announce = useCallback<Announce>((message, focus) => {
    seq.current += 1;
    setEntry({ message, focus, seq: seq.current });
  }, []);

  useEffect(() => {
    if (!entry || entry.focus === null) return;
    // O destino existe antes e depois da troca da lista (o próximo item e o título continuam).
    const moved = entry.focus !== 'list' && focusById(entry.focus.id);
    if (!moved) focusById(listTitleId);
  }, [entry, listTitleId]);

  return (
    <AnnouncerContext.Provider value={announce}>
      <p
        role="status"
        className={entry ? 'mb-3 flex items-start gap-2 text-sm text-muted-foreground' : 'sr-only'}
      >
        {entry ? (
          <span key={entry.seq} className="inline-flex items-start gap-2">
            <CircleCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-success" />
            {entry.message}
          </span>
        ) : null}
      </p>
      {children}
    </AnnouncerContext.Provider>
  );
}

/**
 * Região viva única da pesquisa: anuncia só a mudança de etapa e o fim ("Pesquisa concluída:
 * 12 empresas, 3 sinais."), nunca os contadores a cada atualização. Fica fora do bloco de estado,
 * que troca de elemento a cada etapa. Na chegada depois de uma ação (aviso na URL), lê o aviso.
 */
export function RunLiveStatus({ message, arrival }: { message: string; arrival: string | null }) {
  const [state, setState] = useState({ message, text: '' });
  if (state.message !== message) setState({ message, text: message });
  const [arrivalText] = useState(arrival);

  useEffect(() => {
    if (!arrivalText) return;
    // A região precisa existir na árvore de acessibilidade antes de receber o texto.
    const timer = setTimeout(
      () =>
        setState((current) => (current.text === '' ? { ...current, text: arrivalText } : current)),
      400,
    );
    return () => clearTimeout(timer);
  }, [arrivalText]);

  return (
    <p role="status" className="sr-only">
      {state.text}
    </p>
  );
}

/**
 * Depois de uma ação que leva a outra tela (Rodar agora, Pesquisar, Tentar de novo), o botão
 * clicado some e o foco cairia no início da página: vai para o título da tela nova.
 */
export function FocusOnArrival({ targetId }: { targetId: string }) {
  useEffect(() => {
    const active = document.activeElement;
    if (!active || active === document.body) focusById(targetId);
  }, [targetId]);
  return null;
}
