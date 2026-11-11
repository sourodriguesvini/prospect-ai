import type { WebResearchUsageEntry, WebResearchUsageStore } from '../ports/web-search';

/**
 * Consumo de créditos em memória (testes e modo `PROSPECTOR_STORAGE=memory`). Some ao reiniciar:
 * nesse modo o limite mensal vale só enquanto o servidor está de pé, e a cota gratuita da Tavily
 * (que para sozinha ao acabar) é a segunda barreira.
 */
export function createMemoryWebResearchUsage(): WebResearchUsageStore & {
  entries(): WebResearchUsageEntry[];
} {
  const entries: WebResearchUsageEntry[] = [];
  return {
    async creditsUsed(provider, period) {
      return entries
        .filter((entry) => entry.provider === provider && entry.period === period)
        .reduce((total, entry) => total + entry.units, 0);
    },
    async record(entry) {
      entries.push({ ...entry });
    },
    entries: () => entries.map((entry) => ({ ...entry })),
  };
}
