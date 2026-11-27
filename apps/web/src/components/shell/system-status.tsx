'use client';

import { cn, type StatusTone } from '@prospector/ui';
import {
  CircleCheck,
  CircleDashed,
  CircleMinus,
  CircleX,
  Laptop,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { SystemStatusView } from '@/lib/system-status';

/**
 * De quanto em quanto tempo o menu confere de novo (a leitura da IA local abre o nvidia-smi; a
 * rota guarda a última leitura por alguns segundos para várias abas não repetirem o trabalho).
 */
const REFRESH_MS = 2 * 60_000;
/** Ao voltar para a janela, confere de novo se a última leitura tem mais que isso. */
const STALE_MS = 30_000;

/**
 * Cada tom tem forma própria, não só cor (WCAG 1.4.1): recolhido, o menu mostra só o ícone.
 */
const TONE_ICON: Record<StatusTone, { icon: LucideIcon; color: string }> = {
  success: { icon: CircleCheck, color: 'text-success' },
  warning: { icon: TriangleAlert, color: 'text-warning' },
  danger: { icon: CircleX, color: 'text-danger' },
  neutral: { icon: CircleMinus, color: 'text-muted-foreground' },
  accent: { icon: CircleCheck, color: 'text-accent' },
};

const clock = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' });

const PLACEHOLDER = [
  { id: 'ia-local', label: 'IA local' },
  { id: 'pesquisa', label: 'Pesquisa na internet' },
  { id: 'banco', label: 'Banco' },
] as const;

/**
 * Rodapé do menu lateral: "Estado deste computador", com a IA local, a pesquisa na internet e o
 * banco. Lido da rota /api/estado ao abrir, a cada 2 minutos com a janela visível e ao voltar
 * para a janela. Cada indicador leva à tela que explica ou resolve; recolhido, fica só o ícone
 * (forma e cor por estado) com dica, e o texto continua no nome acessível.
 */
export function SystemStatus() {
  const [view, setView] = useState<SystemStatusView | null>(null);
  const [failed, setFailed] = useState(false);
  const lastRead = useRef(0);

  const refresh = useCallback(async () => {
    lastRead.current = Date.now();
    try {
      const response = await fetch('/api/estado', { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setView(SystemStatusView.parse(await response.json()));
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    // Primeira leitura logo depois de montar; as seguintes, no intervalo e ao voltar à janela.
    const first = window.setTimeout(refresh, 0);
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, REFRESH_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible' && Date.now() - lastRead.current > STALE_MS) {
        void refresh();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refresh]);

  return (
    <div className="space-y-0.5">
      <p
        id="estado-titulo"
        className="flex h-6 items-center gap-2 overflow-hidden px-3 text-xs font-medium whitespace-nowrap text-muted-foreground"
      >
        <Laptop aria-hidden="true" className="size-3.5 shrink-0" />
        <span className="transition-opacity duration-200 md:group-data-[collapsed=true]/sidebar:opacity-0">
          Estado deste computador
        </span>
      </p>
      <ul
        aria-labelledby="estado-titulo"
        aria-busy={view === null && !failed}
        className="space-y-0.5"
      >
        {view
          ? view.indicators.map((item) => {
              const { icon: Icon, color } = TONE_ICON[item.tone];
              const checked = clock.format(new Date(view.checkedAt));
              return (
                <li key={item.id}>
                  {/* Nome = o texto visível ("Banco Não configurado"); o detalhe vai como descrição. */}
                  <Link
                    href={item.href}
                    aria-describedby={`estado-${item.id}-detalhe`}
                    data-tip={`${item.label}: ${item.value}. ${item.detail} Conferido às ${checked}.`}
                    data-tip-always=""
                    data-indicator={item.id}
                    data-tone={item.tone}
                    className="group/status flex h-7 items-center overflow-hidden rounded-full pr-3 text-xs whitespace-nowrap text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring pointer-coarse:h-10"
                  >
                    <span className="grid w-9 shrink-0 place-items-center">
                      <Icon
                        aria-hidden="true"
                        className={cn('size-3.5', color)}
                        strokeWidth={2.25}
                      />
                    </span>
                    <span className="flex min-w-0 flex-1 items-center justify-between gap-2 transition-opacity duration-200 md:group-data-[collapsed=true]/sidebar:opacity-0">
                      <span className="truncate">{item.label}</span>
                      <span className="truncate font-medium text-foreground tabular">
                        {item.value}
                      </span>
                    </span>
                  </Link>
                  <span id={`estado-${item.id}-detalhe`} hidden>
                    {item.detail} Conferido às {checked}.
                  </span>
                </li>
              );
            })
          : PLACEHOLDER.map((item) => (
              <li
                key={item.id}
                // Recolhido, a dica diz o que o ícone não diz (conferindo ou falhou).
                data-tip={`${item.label}: ${failed ? 'não foi possível conferir agora.' : 'conferindo…'}`}
                data-tip-always=""
                className="flex h-7 items-center overflow-hidden pr-3 text-xs whitespace-nowrap text-muted-foreground pointer-coarse:h-10"
              >
                <span className="grid w-9 shrink-0 place-items-center">
                  <CircleDashed
                    aria-hidden="true"
                    className={cn('size-3.5', !failed && 'motion-safe:animate-pulse')}
                  />
                </span>
                <span className="flex min-w-0 flex-1 justify-between gap-2 transition-opacity duration-200 md:group-data-[collapsed=true]/sidebar:opacity-0">
                  <span className="truncate">{item.label}</span>
                  <span>{failed ? 'Não conferido' : 'Conferindo…'}</span>
                </span>
              </li>
            ))}
      </ul>
    </div>
  );
}
