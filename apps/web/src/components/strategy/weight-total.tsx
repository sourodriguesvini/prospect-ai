import { StatusDot } from '@prospector/ui';

/** Inteiro de 0 a 100 digitado; qualquer outra coisa → null (o servidor mostra o erro). */
export function parseWeight(value: string): number | null {
  const trimmed = value.trim();
  return /^\d{1,3}$/.test(trimmed) ? Number(trimmed) : null;
}

/** Soma dos pesos ao vivo; anunciada com educação a leitores de tela. */
export function WeightTotal({ total }: { total: number }) {
  const ok = total === 100;
  return (
    <p aria-live="polite" aria-atomic="true" className="text-sm" data-weight-total={total}>
      <StatusDot tone={ok ? 'success' : 'warning'}>
        Soma dos pesos: <strong>{total}</strong> de 100
        {ok ? '' : ` (${total < 100 ? 'faltam' : 'sobram'} ${Math.abs(100 - total)})`}
      </StatusDot>
    </p>
  );
}
