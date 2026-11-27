import type { CnpjLookup, CnpjLookupResult } from '@prospector/application';
import { isValidCnpj, normalizeCnpj } from '@prospector/contracts';
import type { Fetch } from '../http';
import { minhaReceita, openCnpj, type CnpjProviderAdapter } from './providers';

export interface CnpjLookupOptions {
  fetch?: Fetch;
  /** Ordem de tentativa: o primeiro é o padrão, os demais são reserva. */
  providers?: readonly CnpjProviderAdapter[];
  timeoutMs?: number;
  /** Resultado guardado por CNPJ (a base é mensal): poupa o provedor. 0 desliga. */
  cacheTtlMs?: number;
  cacheMaxEntries?: number;
  now?: () => number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Consulta de CNPJ com reserva (research/05 §4): OpenCNPJ primeiro, Minha Receita se a primeira
 * estiver fora do ar, pedir pausa ou responder num formato inesperado. "Não existe" e pedido de
 * anonimização não passam para a reserva: as duas leem a mesma base da Receita. Registro de outro
 * CNPJ que não o pedido conta como resposta inválida. Sucessos, "não existe" e anonimização ficam
 * em cache; `fresh` ignora o cache (nova consulta pedida pelo usuário).
 */
export function createCnpjLookup(options: CnpjLookupOptions = {}): CnpjLookup {
  const fetchImpl = options.fetch ?? fetch;
  const providers = options.providers ?? [openCnpj, minhaReceita];
  const timeoutMs = options.timeoutMs ?? 8000;
  const ttl = options.cacheTtlMs ?? DAY_MS;
  const maxEntries = options.cacheMaxEntries ?? 500;
  const now = options.now ?? Date.now;
  const cache = new Map<string, { at: number; result: CnpjLookupResult }>();

  const final = (failure: string) => failure === 'not_found' || failure === 'anonymized';

  function remember(cnpj: string, result: CnpjLookupResult) {
    if (ttl <= 0) return;
    if (!result.ok && !final(result.failure)) return;
    cache.delete(cnpj);
    cache.set(cnpj, { at: now(), result });
    while (cache.size > maxEntries) {
      const oldest = cache.keys().next().value;
      if (oldest === undefined) break;
      cache.delete(oldest);
    }
  }

  return {
    async lookup(input, lookupOptions = {}) {
      const cnpj = normalizeCnpj(input);
      if (!isValidCnpj(cnpj)) return { ok: false, failure: 'not_found', provider: null };
      const cached = lookupOptions.fresh ? undefined : cache.get(cnpj);
      if (cached && now() - cached.at < ttl) return cached.result;

      let last: CnpjLookupResult = { ok: false, failure: 'unavailable', provider: null };
      for (const provider of providers) {
        const result = await provider.fetchRecord(cnpj, {
          fetch: fetchImpl,
          timeoutMs,
          ...(lookupOptions.signal ? { signal: lookupOptions.signal } : {}),
        });
        if (result.ok && normalizeCnpj(result.record.cnpj) === cnpj) {
          const found: CnpjLookupResult = {
            ok: true,
            record: result.record,
            fetchedAt: new Date(now()).toISOString(),
          };
          remember(cnpj, found);
          return found;
        }
        const failure = result.ok ? 'invalid_response' : result.failure;
        last = { ok: false, failure, provider: provider.id };
        if (final(failure)) break;
      }
      remember(cnpj, last);
      return last;
    },
  };
}
