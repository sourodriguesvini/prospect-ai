import { formatUsdAmount } from '@/lib/insights';

/**
 * Valor em dólares para cartões de número grande: "US$" em letra menor, para caber no cartão
 * estreito da Início. "+" = a soma chegou ao teto de leitura e o valor real pode ser maior.
 */
export function UsdValue({ micros, capped = false }: { micros: number; capped?: boolean }) {
  return (
    <>
      <span className="text-lg tracking-normal">US$</span> {formatUsdAmount(micros)}
      {capped ? '+' : ''}
    </>
  );
}
