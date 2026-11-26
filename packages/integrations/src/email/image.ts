import type { EmailImageFetcher } from '@prospector/application';
import { isRestrictedHost } from '../web/page-reader';
import { safeFetch, type Transport } from '../web/safe-http';
import { systemResolver, type Resolver } from '../web/ssrf';

/**
 * Conferência das imagens da assinatura (ADR-0016): baixa UMA vez o endereço que o próprio usuário
 * cadastrou como faixa ou ícone, para ver se é mesmo uma imagem. Não é rastreamento de site (não
 * lê páginas nem segue links), por isso não consulta o robots.txt; usa o mesmo cliente seguro do
 * leitor de páginas (URL e DNS conferidos a cada salto, endereço fixado, teto de bytes, tempo-limite)
 * e recusa os sites restritos (ADR-0012). Nada do usuário vai no pedido além da própria URL.
 */

/** Acima do maior teto (faixa, 1 MB): basta para dizer "pesada demais" sem baixar tudo. */
export const EMAIL_IMAGE_DOWNLOAD_BYTES = 2 * 1024 * 1024;
const TIMEOUT_MS = 8000;
const ACCEPT = 'image/png,image/jpeg,image/gif;q=0.9,image/*;q=0.5,*/*;q=0.1';

export interface EmailImageFetcherOptions {
  resolver?: Resolver;
  /** Transporte injetável (testes); padrão = `node:https` com o endereço conferido. */
  transport?: Transport;
  timeoutMs?: number;
}

type FetchedEmailImage = Awaited<ReturnType<EmailImageFetcher['fetch']>>;

export function createEmailImageFetcher(options: EmailImageFetcherOptions = {}): EmailImageFetcher {
  const blocked: FetchedEmailImage = { kind: 'failed', reason: 'blocked' };
  return {
    async fetch(raw) {
      let url: URL;
      try {
        url = new URL(raw);
      } catch {
        return blocked;
      }
      if (url.protocol !== 'https:' || isRestrictedHost(url)) return blocked;
      // `new URL` tira a porta padrão (443); qualquer outra o cliente seguro recusaria.
      if (url.port !== '') return { kind: 'failed', reason: 'bad_port' };
      const fetched = await safeFetch(url, {
        resolver: options.resolver ?? systemResolver,
        ...(options.transport ? { transport: options.transport } : {}),
        maxBytes: EMAIL_IMAGE_DOWNLOAD_BYTES,
        timeoutMs: options.timeoutMs ?? TIMEOUT_MS,
        maxRedirects: 3,
        accept: ACCEPT,
        // Só https em todos os saltos: em http, quem está no meio da rede trocaria o arquivo.
        beforeRedirect: async (next) => {
          if (next.protocol !== 'https:') return 'blocked_address';
          return isRestrictedHost(next) ? 'restricted_site' : null;
        },
      });
      if (!fetched.ok) {
        if (fetched.failure === 'too_large') return { kind: 'failed', reason: 'too_large' };
        return fetched.failure === 'unavailable' || fetched.failure === 'too_many_redirects'
          ? { kind: 'failed', reason: 'unavailable' }
          : blocked;
      }
      const { response } = fetched;
      return {
        kind: 'ok',
        status: response.status,
        contentType: response.headers['content-type'] ?? null,
        bytes: response.body,
        truncated: response.truncated,
      };
    },
  };
}
