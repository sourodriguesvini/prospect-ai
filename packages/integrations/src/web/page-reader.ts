import { createHash } from 'node:crypto';
import type { PageFetcher, PageFetchFailure, PageFetchResult } from '@prospector/application';
import {
  WEB_PAGE_TEXT_MAX_CHARS,
  WebPage,
  redactPersonalData,
  webHostRestriction,
} from '@prospector/contracts';
import {
  createPlaywrightRenderer,
  type BrowserRenderer,
  type FetchedResource,
  type RenderedPage,
} from './browser';
import {
  extractFromHtml,
  forbidsAiUse,
  forbidsArchiving,
  headerDirectives,
  normalizeText,
} from './html';
import { createRobotsChecker, type RobotsChecker } from './robots';
import { safeFetch, type SafeFetchFailure, type Transport } from './safe-http';
import { checkUrl, resolvePublicTarget, systemResolver, type Resolver } from './ssrf';

/**
 * Leitor de páginas públicas (porta `PageFetcher`, ADR-0012). Ordem: URL e host conferidos
 * (SSRF) → site com termos que proíbem leitura automatizada → robots.txt → GET seguro (cada
 * redirecionamento conferido de novo, inclusive robots.txt do destino) → status e
 * `X-Robots-Tag` → tipo de conteúdo → renderização (Playwright) ou extração estática → `noai`
 * do `<meta>` → texto normalizado, dados pessoais mascarados, cortado no limite e com hash.
 */

/**
 * Host que o leitor não abre: termos que proíbem coleta automatizada (redes sociais, Google Maps)
 * ou agregadores que publicam dados pessoais de sócios. A lista fica em `@prospector/contracts`
 * (`RESTRICTED_WEB_HOSTS`, `MINIMIZATION_BLOCKED_HOSTS`), a mesma que o serviço usa para não
 * gravar esses resultados de busca. Vale para a página, cada redirecionamento e cada sub-recurso.
 */
export function isRestrictedHost(url: URL): boolean {
  return webHostRestriction(url.hostname) !== null;
}

/**
 * Busca de sub-recursos do navegador (scripts, CSS, XHR) pelo cliente seguro: mesma proteção
 * SSRF, e widgets de rede social ou scripts do Google Maps nem são pedidos. null = recusado.
 */
export function subresourceFetcher(options: {
  resolver: Resolver;
  transport?: Transport;
  timeoutMs: number;
}): (url: string) => Promise<FetchedResource | null> {
  return async (url) => {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return null;
    }
    if (isRestrictedHost(parsed)) return null;
    const fetched = await safeFetch(parsed, {
      resolver: options.resolver,
      ...(options.transport ? { transport: options.transport } : {}),
      maxBytes: 1536 * 1024,
      timeoutMs: Math.min(6000, options.timeoutMs),
      maxRedirects: 3,
      accept: '*/*',
      beforeRedirect: async (next) => (isRestrictedHost(next) ? 'restricted_site' : null),
    });
    if (!fetched.ok || fetched.response.truncated) return null;
    return {
      status: fetched.response.status,
      contentType: fetched.response.headers['content-type'] ?? null,
      body: fetched.response.body,
    };
  };
}

export interface PageReaderOptions {
  resolver?: Resolver;
  transport?: Transport;
  /** `browser` (padrão) renderiza com Playwright; `http` só extrai o HTML recebido. */
  renderer?: 'browser' | 'http';
  /** Renderizador injetável (testes); padrão = Playwright com o mesmo cliente seguro. */
  browser?: BrowserRenderer;
  /** Tempo total da leitura (cabe no limite de 15 s das ferramentas do Copiloto). */
  timeoutMs?: number;
  maxBytes?: number;
  maxTextChars?: number;
  now?: () => Date;
  log?: (message: string) => void;
}

const HTML_TYPES = new Set(['text/html', 'application/xhtml+xml']);

function mimeOf(contentType: string | undefined): { mime: string; charset: string | null } {
  const [mime = '', ...params] = (contentType ?? '').split(';');
  const charset = params
    .map((param) => /^\s*charset\s*=\s*"?([^";]+)"?/i.exec(param)?.[1] ?? null)
    .find((value) => value !== null);
  return { mime: mime.trim().toLowerCase(), charset: charset ?? null };
}

function decode(body: Uint8Array, charset: string | null, sniffHtml: boolean): string {
  let label = charset;
  if (!label && sniffHtml) {
    const head = new TextDecoder('latin1').decode(body.subarray(0, 2048));
    label = /<meta[^<>]{0,512}charset\s*=\s*["']?([\w-]{1,40})/i.exec(head)?.[1] ?? null;
  }
  try {
    return new TextDecoder(label ?? 'utf-8').decode(body);
  } catch {
    return new TextDecoder('utf-8').decode(body);
  }
}

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function statusFailure(status: number): PageFetchFailure | null {
  if ([401, 402, 403, 407, 451].includes(status)) return 'access_denied';
  if (status === 404 || status === 410) return 'not_found';
  if (status === 429) return 'rate_limited';
  if (status < 200 || status >= 300) return 'unavailable';
  return null;
}

export function createPageReader(options: PageReaderOptions = {}): PageFetcher & {
  close(): Promise<void>;
} {
  const resolver = options.resolver ?? systemResolver;
  const timeoutMs = options.timeoutMs ?? 12_000;
  const maxBytes = options.maxBytes ?? 3 * 1024 * 1024;
  const maxTextChars = Math.min(options.maxTextChars ?? 20_000, WEB_PAGE_TEXT_MAX_CHARS);
  const now = options.now ?? (() => new Date());
  const log = options.log ?? ((message: string) => console.warn(message));
  const transportOptions = options.transport ? { transport: options.transport } : {};

  const robots: RobotsChecker = createRobotsChecker({
    fetchOptions: { resolver, ...transportOptions, timeoutMs: Math.min(5000, timeoutMs) },
    now: () => now().getTime(),
  });

  const browser: BrowserRenderer | null =
    options.renderer === 'http'
      ? null
      : (options.browser ??
        createPlaywrightRenderer({
          log,
          fetchResource: subresourceFetcher({ resolver, ...transportOptions, timeoutMs }),
        }));

  /** Antes de cada pedido (inclusive redirecionamentos): termos do site, DNS e robots.txt. */
  async function gate(url: URL, signal: AbortSignal): Promise<SafeFetchFailure | null> {
    if (isRestrictedHost(url)) return 'restricted_site';
    // DNS conferido aqui para o motivo ser honesto (endereço interno, não "robots proibiu").
    const target = await resolvePublicTarget(url, resolver);
    if (!target.ok) return target.reason;
    return (await robots.allowed(url, signal)) ? null : 'robots_disallowed';
  }

  function failed(failure: PageFetchFailure, httpStatus: number | null = null): PageFetchResult {
    return { ok: false, failure, httpStatus };
  }

  return {
    close: async () => {
      await browser?.close();
    },

    /**
     * Prazo TOTAL (`timeoutMs`): robots.txt de cada salto, GET e navegador dividem o mesmo
     * relógio. Estourou, devolve "fora do ar" e cancela o que ainda estiver em andamento.
     */
    async fetchPage(raw, fetchOptions) {
      const deadline = AbortSignal.timeout(timeoutMs);
      const signal = fetchOptions?.signal
        ? AbortSignal.any([fetchOptions.signal, deadline])
        : deadline;
      // DNS e navegador não aceitam `signal`: a corrida garante o prazo para quem chamou.
      let onAbort: (() => void) | undefined;
      try {
        return await Promise.race([
          read(raw, signal),
          new Promise<never>((_resolve, reject) => {
            onAbort = () => reject(signal.reason);
            if (signal.aborted) onAbort();
            else signal.addEventListener('abort', onAbort, { once: true });
          }),
        ]);
      } catch (error) {
        if (fetchOptions?.signal?.aborted) throw error;
        if (deadline.aborted) return failed('unavailable');
        throw error;
      } finally {
        if (onAbort) signal.removeEventListener('abort', onAbort);
      }
    },
  };

  async function read(raw: string, signal: AbortSignal): Promise<PageFetchResult> {
    const started = Date.now();
    const checked = checkUrl(raw);
    if (!checked.ok) return failed('blocked_address');
    const requested = checked.url;
    requested.hash = '';
    const refusal = await gate(requested, signal);
    if (refusal) return failed(refusal);

    const fetched = await safeFetch(requested, {
      resolver,
      ...transportOptions,
      maxBytes,
      timeoutMs,
      signal,
      maxRedirects: 5,
      beforeRedirect: (next) => gate(next, signal),
    });
    signal.throwIfAborted();
    if (!fetched.ok) return failed(fetched.failure);
    const { response, url } = fetched;
    const byStatus = statusFailure(response.status);
    if (byStatus) return failed(byStatus, response.status);
    const fromHeader = headerDirectives(response.headers['x-robots-tag']);
    if (forbidsAiUse(fromHeader)) return failed('access_denied', response.status);
    let noArchive =
      forbidsArchiving(fromHeader) || response.headers['tdm-reservation']?.trim() === '1';

    const { mime, charset } = mimeOf(response.headers['content-type']);
    let content: RenderedPage;
    let renderer: 'browser' | 'http' = 'http';
    if (HTML_TYPES.has(mime)) {
      const html = decode(response.body, charset, true);
      const statics = extractFromHtml(html);
      if (forbidsAiUse(statics.robots)) return failed('access_denied', response.status);
      noArchive ||= forbidsArchiving(statics.robots);
      content = statics;
      // Sem tempo para o navegador (menos de 1,5 s), fica a extração estática.
      const left = timeoutMs - (Date.now() - started) - 250;
      if (browser && left >= 1500) {
        try {
          const rendered = await browser.render(
            {
              url: url.toString(),
              status: response.status,
              contentType: `${mime}; charset=utf-8`,
              body: new TextEncoder().encode(html),
            },
            { timeoutMs: left },
          );
          if (forbidsAiUse(rendered.robots)) return failed('access_denied', response.status);
          noArchive ||= forbidsArchiving(rendered.robots);
          if (rendered.text.trim() || !statics.text) {
            content = {
              ...rendered,
              title: rendered.title ?? statics.title,
              description: rendered.description ?? statics.description,
              lang: rendered.lang ?? statics.lang,
            };
            renderer = 'browser';
          }
        } catch {
          // Sem navegador (não instalado, travou, tempo esgotado): fica a extração estática.
        }
      }
    } else if (mime === 'text/plain') {
      content = {
        title: null,
        description: null,
        lang: null,
        robots: [],
        text: decode(response.body, charset, false),
      };
    } else {
      return failed('unsupported_content', response.status);
    }

    // Corta antes de mascarar: a máscara só roda sobre o que pode ser guardado (A1).
    const normalized = normalizeText(content.text.slice(0, maxTextChars * 4));
    const text = redactPersonalData(normalized.slice(0, maxTextChars + 512)).slice(0, maxTextChars);
    const clip = (value: string | null, max: number) => {
      const clean = value
        ? redactPersonalData(normalizeText(value.slice(0, max * 2))).replace(/\n/g, ' ')
        : '';
      return clean ? clean.slice(0, max) : null;
    };
    const page = WebPage.safeParse({
      schemaVersion: 1,
      requestedUrl: requested.toString(),
      url: url.toString(),
      httpStatus: response.status,
      contentType: mime || 'text/html',
      title: clip(content.title, 300),
      description: clip(content.description, 500),
      lang: content.lang ? content.lang.trim().slice(0, 35) || null : null,
      text,
      truncated:
        response.truncated ||
        normalized.length > maxTextChars ||
        content.text.length > maxTextChars * 4,
      contentHash: sha256(text),
      fetchedAt: now().toISOString(),
      renderer,
      noArchive,
    });
    if (!page.success) {
      log('[leitor] página fora do contrato depois da extração');
      return failed('unavailable', response.status);
    }
    return { ok: true, page: page.data };
  }
}
