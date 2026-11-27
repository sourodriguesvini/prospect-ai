import { Resolver } from 'node:dns/promises';
import type { DnsTxtLookup } from '@prospector/application';

/** O que o adaptador usa de um resolvedor do Node (para os testes trocarem a rede). */
export interface TxtResolver {
  resolveTxt(name: string): Promise<string[][]>;
}

export interface DnsTxtLookupOptions {
  resolver?: TxtResolver;
}

/** Respostas que significam "não há registro" (e não "o DNS falhou"). */
const MISSING_CODES = new Set(['ENOTFOUND', 'ENODATA']);

/** Nome consultável: só letras, números, hífen, ponto e sublinhado (`_dmarc`, `_domainkey`). */
const DNS_NAME = /^(?=.{1,253}$)([a-z0-9_](?:[a-z0-9_-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;

/**
 * Consulta TXT no DNS público (SPF, DMARC e DKIM) com tempo curto. Os pedaços de um registro
 * (cadeias de até 255 caracteres) são juntados, como manda a RFC 7208 §3.3.
 */
export function createDnsTxtLookup(options: DnsTxtLookupOptions = {}): DnsTxtLookup {
  const resolver = options.resolver ?? new Resolver({ timeout: 4_000, tries: 2 });
  return {
    async txt(name) {
      if (!DNS_NAME.test(name)) return { status: 'error', records: [] };
      try {
        const answers = await resolver.resolveTxt(name);
        const records = answers.map((chunks) => chunks.join('')).slice(0, 20);
        return records.length > 0
          ? { status: 'found', records }
          : { status: 'missing', records: [] };
      } catch (error) {
        const code = (error as { code?: unknown } | null)?.code;
        return typeof code === 'string' && MISSING_CODES.has(code)
          ? { status: 'missing', records: [] }
          : { status: 'error', records: [] };
      }
    },
  };
}
