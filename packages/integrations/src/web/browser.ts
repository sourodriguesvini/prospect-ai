import type { Browser, Route } from 'playwright-core';
import { z } from 'zod';
import { USER_AGENT } from '../http';

/**
 * Renderização de páginas com Playwright (Chromium headless) para sites que montam o conteúdo
 * com JavaScript (ADR-0012). O navegador NÃO acessa a rede por conta própria:
 * - `--host-resolver-rules=MAP * ~NOTFOUND`: nenhum nome resolve dentro do Chromium;
 * - toda requisição passa por `context.route`: o documento principal vem do HTML já baixado pelo
 *   cliente seguro, e scripts, CSS e XHR são buscados por `fetchResource` (mesma proteção SSRF);
 * - só GET; imagens, fontes, mídia, WebSocket, outras navegações, popups e downloads são
 *   bloqueados; service workers desligados.
 * Sandbox do Chromium ligado, prazo total por página (página em laço infinito fecha o navegador)
 * e texto cortado dentro da página (revisão de segurança 2026-11-10, A2 e A3).
 * O navegador abre sob demanda e fecha sozinho depois de um tempo ocioso (recursos do usuário).
 */

export interface MainDocument {
  url: string;
  status: number;
  contentType: string;
  body: Uint8Array;
}

export interface FetchedResource {
  status: number;
  contentType: string | null;
  body: Uint8Array;
}

export interface RenderedPage {
  title: string | null;
  description: string | null;
  lang: string | null;
  robots: string[];
  text: string;
}

export interface BrowserRenderer {
  /** Prazo total `timeoutMs`; estourou, lança e libera tudo. */
  render(main: MainDocument, options: { timeoutMs: number }): Promise<RenderedPage>;
  close(): Promise<void>;
}

export interface PlaywrightRendererOptions {
  /** Busca de sub-recursos pelo cliente seguro; null = recusado ou falhou. */
  fetchResource: (url: string) => Promise<FetchedResource | null>;
  maxSubrequests?: number;
  maxSubresourceBytes?: number;
  /** Teto de cada sub-recurso (o mesmo do `subresourceFetcher`); reservado antes do pedido. */
  maxBytesPerSubresource?: number;
  idleCloseMs?: number;
  /** Caminho do Chromium; vazio = o instalado pelo Playwright (`pnpm exec playwright install`). */
  executablePath?: string;
  log?: (message: string) => void;
}

const ALLOWED_SUBRESOURCES = new Set(['script', 'stylesheet', 'xhr', 'fetch']);

/** Texto que sai da página: já cortado lá dentro (uma página pode gerar centenas de MB). */
const PAGE_TEXT_LIMIT = 200_000;

const Extracted = z.object({
  title: z.string().max(2000).nullable(),
  description: z.string().max(2000).nullable(),
  lang: z.string().max(100).nullable(),
  robots: z.string().max(2000),
  text: z.string().max(PAGE_TEXT_LIMIT),
});

/** Executado na página (sem tipos de DOM no pacote, por isso como texto). */
const EXTRACT_SCRIPT = `(() => {
  const cut = (value, max) => (typeof value === 'string' ? value.slice(0, max) : null);
  const meta = (name) => {
    const el = document.querySelector('meta[name="' + name + '" i], meta[property="' + name + '" i]');
    return el ? el.getAttribute('content') : null;
  };
  const robots = Array.from(document.querySelectorAll('meta[name="robots" i], meta[name="prospector" i]'))
    .slice(0, 20)
    .map((el) => (el.getAttribute('content') || '').slice(0, 200))
    .concat((meta('tdm-reservation') || '').trim() === '1' ? ['tdm-reservation'] : [])
    .join(',');
  return {
    title: cut(document.title, 2000) || null,
    description: cut(meta('description') || meta('og:description'), 2000),
    lang: cut(document.documentElement.getAttribute('lang'), 100),
    robots: robots.slice(0, 2000),
    text: document.body ? String(document.body.innerText).slice(0, ${PAGE_TEXT_LIMIT}) : '',
  };
})()`;

const LAUNCH_ARGS = [
  '--host-resolver-rules=MAP * ~NOTFOUND',
  '--disable-background-networking',
  '--disable-component-update',
  '--disable-domain-reliability',
  '--disable-sync',
  '--no-first-run',
  '--no-pings',
  '--disable-features=NetworkPrediction,DnsOverHttps,InterestFeedContentSuggestions',
  '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
];

class RenderTimeout extends Error {
  override name = 'RenderTimeout';
}

/** Espera a promessa até `ms`; depois desiste (false). Nunca lança. */
async function within(promise: Promise<unknown>, ms: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const done = await Promise.race([
    promise.then(
      () => true,
      () => true,
    ),
    new Promise<false>((resolve) => {
      timer = setTimeout(() => resolve(false), ms);
    }),
  ]);
  clearTimeout(timer);
  return done;
}

export function createPlaywrightRenderer(options: PlaywrightRendererOptions): BrowserRenderer {
  const log = options.log ?? ((message: string) => console.warn(message));
  const maxSubrequests = options.maxSubrequests ?? 40;
  const maxSubresourceBytes = options.maxSubresourceBytes ?? 8 * 1024 * 1024;
  const maxBytesPerSubresource = options.maxBytesPerSubresource ?? 1536 * 1024;
  const idleCloseMs = options.idleCloseMs ?? 60_000;
  let browser: Promise<Browser> | null = null;
  let active = 0;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;

  function launch(): Promise<Browser> {
    if (!browser) {
      browser = import('playwright-core').then(({ chromium }) =>
        chromium.launch({
          headless: true,
          // Sem isto o Playwright acrescenta --no-sandbox, e o JavaScript de qualquer site da
          // busca rodaria sem a barreira do sandbox do Chromium.
          chromiumSandbox: true,
          args: LAUNCH_ARGS,
          ...(options.executablePath ? { executablePath: options.executablePath } : {}),
        }),
      );
      browser.catch(() => {
        browser = null;
      });
    }
    return browser;
  }

  async function close() {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = null;
    const current = browser;
    browser = null;
    if (!current) return;
    const instance = await current.catch(() => null);
    if (instance && !(await within(instance.close(), 5000))) {
      log('[leitor] navegador não fechou a tempo');
    }
  }

  function scheduleIdleClose() {
    if (active > 0) return;
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      if (active === 0) void close();
    }, idleCloseMs);
    idleTimer.unref?.();
  }

  return {
    close,
    async render(main, { timeoutMs }) {
      active += 1;
      if (idleTimer) clearTimeout(idleTimer);
      const started = Date.now();
      const remaining = () => Math.max(1, timeoutMs - (Date.now() - started));
      let cancelled = false;
      let context: Awaited<ReturnType<Browser['newContext']>> | null = null;
      let deadlineTimer: ReturnType<typeof setTimeout> | undefined;

      const work = async (): Promise<RenderedPage> => {
        const instance = await launch();
        const created = await instance.newContext({
          userAgent: USER_AGENT,
          locale: 'pt-BR',
          javaScriptEnabled: true,
          serviceWorkers: 'block',
          acceptDownloads: false,
          viewport: { width: 1280, height: 900 },
        });
        if (cancelled) {
          // O prazo venceu enquanto o contexto abria: o `finally` já passou, fecha aqui.
          await within(created.close(), 2000);
          throw new RenderTimeout();
        }
        context = created;
        let servedMain = false;
        let subrequests = 0;
        let subBytes = 0;
        const abort = (route: Route) => route.abort('blockedbyclient').catch(() => undefined);

        await created.route('**/*', async (route) => {
          const request = route.request();
          const url = request.url();
          if (cancelled) return abort(route);
          if (request.isNavigationRequest()) {
            if (!servedMain && url === main.url) {
              servedMain = true;
              await route
                .fulfill({
                  status: main.status,
                  contentType: main.contentType,
                  body: Buffer.from(main.body),
                })
                .catch(() => undefined);
              return;
            }
            return abort(route);
          }
          if (request.method() !== 'GET') return abort(route);
          if (!ALLOWED_SUBRESOURCES.has(request.resourceType())) return abort(route);
          // A cota é reservada antes do pedido: pedidos simultâneos não passam do limite.
          if (
            subrequests >= maxSubrequests ||
            subBytes + maxBytesPerSubresource > maxSubresourceBytes
          ) {
            return abort(route);
          }
          subrequests += 1;
          subBytes += maxBytesPerSubresource;
          const resource = await options.fetchResource(url).catch(() => null);
          const used = Math.min(resource?.body.length ?? 0, maxBytesPerSubresource);
          subBytes -= maxBytesPerSubresource - used;
          if (!resource || cancelled) return abort(route);
          await route
            .fulfill({
              status: resource.status,
              ...(resource.contentType ? { contentType: resource.contentType } : {}),
              body: Buffer.from(resource.body),
            })
            .catch(() => undefined);
        });
        if ('routeWebSocket' in created) {
          await created.routeWebSocket(/.*/, (socket) => socket.close());
        }

        const page = await created.newPage();
        page.on('dialog', (dialog) => void dialog.dismiss().catch(() => undefined));
        page.on('popup', (popup) => void popup.close().catch(() => undefined));
        await page.goto(main.url, { waitUntil: 'domcontentloaded', timeout: remaining() });
        await page
          .waitForLoadState('networkidle', { timeout: Math.min(2500, remaining()) })
          .catch(() => undefined);
        const extracted = Extracted.parse(await page.evaluate(EXTRACT_SCRIPT));
        return {
          title: extracted.title,
          description: extracted.description,
          lang: extracted.lang,
          robots: extracted.robots
            .toLowerCase()
            .split(',')
            .map((value) => value.trim())
            .filter(Boolean),
          text: extracted.text,
        };
      };

      try {
        return await Promise.race([
          work(),
          new Promise<never>((_resolve, reject) => {
            deadlineTimer = setTimeout(() => {
              cancelled = true;
              reject(new RenderTimeout());
            }, timeoutMs);
          }),
        ]);
      } catch (error) {
        cancelled = true;
        log(`[leitor] navegador falhou: ${error instanceof Error ? error.name : 'erro'}`);
        throw error;
      } finally {
        clearTimeout(deadlineTimer);
        active -= 1;
        // Página em laço infinito pode não fechar: depois de 2 s, fecha o navegador inteiro.
        const opened = context as { close(): Promise<void> } | null;
        if (opened && !(await within(opened.close(), 2000))) {
          log('[leitor] página não fechou; fechando o navegador');
          await close();
        }
        scheduleIdleClose();
      }
    },
  };
}
