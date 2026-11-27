'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

/**
 * Recarrega os dados da tela (sem recarregar a página) enquanto a pesquisa roda em segundo
 * plano. Para quando a aba fica oculta e quando a pesquisa termina (o componente sai da tela).
 */
export function AutoRefresh({ intervalMs = 4000 }: { intervalMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') router.refresh();
    }, intervalMs);
    return () => clearInterval(timer);
  }, [router, intervalMs]);
  return null;
}
