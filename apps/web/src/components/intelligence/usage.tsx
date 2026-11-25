import type { IntelligenceOverview } from '@prospector/contracts';
import { StatTile } from '@prospector/ui';
import { Coins, Cpu, Search } from 'lucide-react';
import Link from 'next/link';
import { discoveryRoutes } from '@/lib/discovery-routes';
import { formatCount, formatDuration } from '@/lib/insights';
import type { StorageMode } from '@/server/env';
import { UsdValue } from './usd-value';

/**
 * Consumo do mês civil (ADR-0017): dinheiro, IA local e créditos da busca na internet. Leitura
 * que falhou vira traço e uma frase dizendo isso; nunca zero inventado.
 */

const UNREAD = 'Não foi possível ler agora.';

function moneyTile(money: IntelligenceOverview['money']) {
  if (!money) return { value: '—', note: UNREAD };
  return {
    value: <UsdValue micros={money.usdMicros} capped={money.capped} />,
    note:
      money.usdMicros === 0
        ? 'A IA local e o plano gratuito da busca não cobram.'
        : 'Soma das chamadas pagas registradas.',
  };
}

/** Mesmos textos do indicador do topo (`lib/system-status.ts`), para não haver duas versões. */
function searchTile(search: IntelligenceOverview['search'], storage: StorageMode) {
  // No modo memória a busca fica desligada por falta do banco, que conta os créditos.
  if (search.state === 'disabled' && storage === 'memory') {
    return {
      value: 'Sem banco',
      note: 'A pesquisa na internet precisa do banco configurado para contar os créditos.',
    };
  }
  if (search.state === 'disabled') {
    return { value: 'Desligada', note: 'Pesquisa na internet desligada.' };
  }
  if (search.state === 'not_configured') {
    return {
      value: 'Sem chave',
      note: 'Defina TAVILY_API_KEY em apps/web/.env.local para ligar a pesquisa.',
    };
  }
  if (!search.usage) return { value: '—', note: UNREAD };
  const { creditsUsed, creditsBudget, freeQuota } = search.usage;
  return {
    value: `${formatCount(creditsUsed)} de ${formatCount(creditsBudget)}`,
    note: `Créditos da Tavily usados no mês, de um limite de ${formatCount(creditsBudget)} definido no app (a cota gratuita é ${formatCount(freeQuota)}).`,
  };
}

export function MonthUsage({
  overview,
  storage,
}: {
  overview: IntelligenceOverview;
  storage: StorageMode;
}) {
  const { ai } = overview;
  const money = moneyTile(overview.money);
  const search = searchTile(overview.search, storage);
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatTile
          label={'Gasto no\u00a0mês'}
          value={<span data-usage="money">{money.value}</span>}
          note={money.note}
          icon={<Coins className="size-4" />}
        />
        <StatTile
          label="Gerações da IA local"
          value={
            <span data-usage="ai">
              {ai ? `${formatCount(ai.generations)}${ai.capped ? '+' : ''}` : '—'}
            </span>
          }
          note={
            ai
              ? `${formatCount(ai.outputTokens)} tokens gerados · ${formatDuration(ai.totalMs)} de processamento`
              : UNREAD
          }
          icon={<Cpu className="size-4" />}
        />
        <StatTile
          label="Busca na internet"
          value={<span data-usage="search">{search.value}</span>}
          note={search.note}
          icon={<Search className="size-4" />}
        />
      </div>

      {ai && ai.byModel.length > 0 ? (
        // Três colunas curtas: cabe no celular sem rolar para o lado (o nome do modelo quebra).
        <table className="w-full text-sm">
          <caption className="sr-only">Gerações da IA local por modelo neste mês</caption>
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted-foreground">
              <th scope="col" className="py-2 pr-4 font-medium">
                Modelo
              </th>
              <th scope="col" className="py-2 pr-4 text-right font-medium">
                Gerações
              </th>
              <th scope="col" className="py-2 text-right font-medium">
                Tokens gerados
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {ai.byModel.map((row) => (
              <tr key={row.model} data-model={row.model}>
                <th scope="row" className="py-2 pr-4 text-left font-normal break-all">
                  {row.model}
                </th>
                <td className="py-2 pr-4 text-right tabular-nums">
                  {formatCount(row.generations)}
                </td>
                <td className="py-2 text-right tabular-nums">{formatCount(row.outputTokens)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}

      <ul className="space-y-1 text-xs text-muted-foreground">
        {ai ? (
          <li>
            {ai.failed === 1 ? '1 geração falhou' : `${formatCount(ai.failed)} gerações falharam`} e{' '}
            {formatCount(ai.cancelled)} {ai.cancelled === 1 ? 'foi cancelada' : 'foram canceladas'}.
            Ferramentas usadas pelo Copiloto: {formatCount(ai.toolCalls)}{' '}
            {ai.toolCalls === 1 ? 'chamada' : 'chamadas'}, {formatCount(ai.toolErrors)} com erro.
          </li>
        ) : null}
        <li>
          As análises da IA feitas pela{' '}
          <Link href={discoveryRoutes.home} className="underline underline-offset-4">
            Descoberta
          </Link>{' '}
          ainda não são registradas aqui: o total real de gerações é maior.
        </li>
        {ai?.capped ? <li>Número com “+” chegou ao limite de leitura e pode ser maior.</li> : null}
      </ul>
    </div>
  );
}
