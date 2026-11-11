import type { Browser, Page, Route } from 'playwright-core';
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
 *
 * Captura de marca (ADR-0015): mesma sessão, mas imagens e fontes também passam (pelo mesmo
 * cliente seguro, com cota maior), na janela de computador ou de celular, e a página devolve
 * medições e uma imagem JPEG com altura limitada.
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
  /** `href` resolvido pelo navegador e texto do link. */
  links: Array<{ href: string; text: string }>;
}

export interface BrowserRenderer {
  /** Prazo total `timeoutMs`; estourou, lança e libera tudo. */
  render(main: MainDocument, options: { timeoutMs: number }): Promise<RenderedPage>;
  close(): Promise<void>;
}

export interface CaptureOptions {
  timeoutMs: number;
  viewport: { width: number; height: number };
  /** Janela de celular: toque e `isMobile` (o CSS responsivo decide pela largura). */
  mobile: boolean;
  /** Altura máxima da imagem (px CSS): as primeiras telas, não a página inteira. */
  maxHeight: number;
  /** JPEG 0–100. */
  quality: number;
  /** Script das medições (expressão que devolve um objeto JSON), executado antes da imagem. */
  metricsScript: string;
}

export interface PageCapture {
  /** Saída crua do script das medições: quem chama valida pelo contrato. */
  metrics: unknown;
  image: Uint8Array;
  width: number;
  height: number;
  /** Bytes do documento e dos sub-recursos entregues à página. */
  transferredBytes: number;
}

export interface BrowserCapturer {
  /** Prazo total `timeoutMs`; estourou, lança e libera tudo. */
  capture(main: MainDocument, options: CaptureOptions): Promise<PageCapture>;
}

export interface PlaywrightRendererOptions {
  /** Busca de sub-recursos pelo cliente seguro; null = recusado ou falhou. */
  fetchResource: (url: string) => Promise<FetchedResource | null>;
  maxSubrequests?: number;
  maxSubresourceBytes?: number;
  /** Teto de cada sub-recurso (o mesmo do `subresourceFetcher`); reservado antes do pedido. */
  maxBytesPerSubresource?: number;
  idleCloseMs?: number;
  /** Cota da captura de marca (imagens e fontes entram): pedidos e bytes por página. */
  captureMaxSubrequests?: number;
  captureMaxSubresourceBytes?: number;
  /** Caminho do Chromium; vazio = o instalado pelo Playwright (`pnpm exec playwright install`). */
  executablePath?: string;
  log?: (message: string) => void;
}

const ALLOWED_SUBRESOURCES = new Set(['script', 'stylesheet', 'xhr', 'fetch']);
/** Na captura, a aparência importa: imagens e fontes também (nunca mídia, WebSocket ou outros). */
const CAPTURE_SUBRESOURCES = new Set([...ALLOWED_SUBRESOURCES, 'image', 'font']);

/** Texto que sai da página: já cortado lá dentro (uma página pode gerar centenas de MB). */
const PAGE_TEXT_LIMIT = 200_000;

const Extracted = z.object({
  title: z.string().max(2000).nullable(),
  description: z.string().max(2000).nullable(),
  lang: z.string().max(100).nullable(),
  robots: z.string().max(2000),
  text: z.string().max(PAGE_TEXT_LIMIT),
  links: z
    .array(z.object({ href: z.string().max(2048), text: z.string().max(200) }))
    .max(300)
    .catch([]),
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
    links: Array.from(document.querySelectorAll('a[href]'))
      .slice(0, 300)
      .map((a) => ({
        href: String(a.href || '').slice(0, 2048),
        text: String(a.innerText || a.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 200),
      }))
      .filter((link) => link.href),
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

interface SessionConfig {
  timeoutMs: number;
  viewport: { width: number; height: number };
  mobile: boolean;
  allowed: ReadonlySet<string>;
  maxSubrequests: number;
  maxSubresourceBytes: number;
}

const PAGE_HEIGHT_SCRIPT =
  'Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0)';
const FONTS_READY_SCRIPT = 'document.fonts ? document.fonts.ready.then(() => true) : true';

export function createPlaywrightRenderer(
  options: PlaywrightRendererOptions,
): BrowserRenderer & BrowserCapturer {
  const log = options.log ?? ((message: string) => console.warn(message));
  const maxSubrequests = options.maxSubrequests ?? 40;
  const maxSubresourceBytes = options.maxSubresourceBytes ?? 8 * 1024 * 1024;
  const maxBytesPerSubresource = options.maxBytesPerSubresource ?? 1536 * 1024;
  const idleCloseMs = options.idleCloseMs ?? 60_000;
  const captureMaxSubrequests = options.captureMaxSubrequests ?? 80;
  const captureMaxSubresourceBytes = options.captureMaxSubresourceBytes ?? 16 * 1024 * 1024;
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

  /**
   * Uma página isolada (contexto próprio) com o documento principal já baixado e cada
   * sub-recurso permitido buscado pelo cliente seguro. Prazo total; estourou, lança e libera tudo.
   */
  async function session<T>(
    main: MainDocument,
    config: SessionConfig,
    use: (page: Page, remaining: () => number, delivered: () => number) => Promise<T>,
  ): Promise<T> {
    const { timeoutMs } = config;
    active += 1;
    if (idleTimer) clearTimeout(idleTimer);
    const started = Date.now();
    const remaining = () => Math.max(1, timeoutMs - (Date.now() - started));
    let cancelled = false;
    let context: Awaited<ReturnType<Browser['newContext']>> | null = null;
    let deadlineTimer: ReturnType<typeof setTimeout> | undefined;

    const work = async (): Promise<T> => {
      const instance = await launch();
      const created = await instance.newContext({
        userAgent: USER_AGENT,
        locale: 'pt-BR',
        javaScriptEnabled: true,
        serviceWorkers: 'block',
        acceptDownloads: false,
        viewport: config.viewport,
        ...(config.mobile ? { isMobile: true, hasTouch: true, deviceScaleFactor: 1 } : {}),
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
      let delivered = main.body.length;
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
        if (!config.allowed.has(request.resourceType())) return abort(route);
        // A cota é reservada antes do pedido: pedidos simultâneos não passam do limite.
        if (
          subrequests >= config.maxSubrequests ||
          subBytes + maxBytesPerSubresource > config.maxSubresourceBytes
        ) {
          return abort(route);
        }
        subrequests += 1;
        subBytes += maxBytesPerSubresource;
        const resource = await options.fetchResource(url).catch(() => null);
        const used = Math.min(resource?.body.length ?? 0, maxBytesPerSubresource);
        subBytes -= maxBytesPerSubresource - used;
        if (!resource || cancelled) return abort(route);
        delivered += resource.body.length;
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
      return use(page, remaining, () => delivered);
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
  }

  return {
    close,

    render(main, { timeoutMs }) {
      return session(
        main,
        {
          timeoutMs,
          viewport: { width: 1280, height: 900 },
          mobile: false,
          allowed: ALLOWED_SUBRESOURCES,
          maxSubrequests,
          maxSubresourceBytes,
        },
        async (page, remaining) => {
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
            links: extracted.links,
          };
        },
      );
    },

    capture(main, capture) {
      return session(
        main,
        {
          timeoutMs: capture.timeoutMs,
          viewport: capture.viewport,
          mobile: capture.mobile,
          allowed: CAPTURE_SUBRESOURCES,
          maxSubrequests: captureMaxSubrequests,
          maxSubresourceBytes: captureMaxSubresourceBytes,
        },
        async (page, remaining, delivered) => {
          await page
            .waitForLoadState('networkidle', { timeout: Math.min(4000, remaining()) })
            .catch(() => undefined);
          // Imagens com carregamento tardio só aparecem rolando até a altura da captura.
          const maxHeight = Math.max(1, Math.round(capture.maxHeight));
          await page.evaluate(`window.scrollTo(0, ${maxHeight})`).catch(() => undefined);
          await page.waitForTimeout(Math.min(600, remaining()));
          await page.evaluate('window.scrollTo(0, 0)').catch(() => undefined);
          await page
            .waitForLoadState('networkidle', { timeout: Math.min(2000, remaining()) })
            .catch(() => undefined);
          await within(page.evaluate(FONTS_READY_SCRIPT), Math.min(1500, remaining()));
          const metrics: unknown = await page.evaluate(capture.metricsScript);
          const measured = Number(await page.evaluate(PAGE_HEIGHT_SCRIPT).catch(() => 0));
          const pageHeight =
            Number.isFinite(measured) && measured > 0
              ? Math.round(measured)
              : capture.viewport.height;
          const width = capture.viewport.width;
          const height = Math.min(pageHeight, maxHeight);
          const image = await page.screenshot({
            type: 'jpeg',
            quality: capture.quality,
            fullPage: true,
            clip: { x: 0, y: 0, width, height },
            animations: 'disabled',
            caret: 'hide',
            timeout: remaining(),
          });
          return {
            metrics,
            image: new Uint8Array(image),
            width,
            height,
            transferredBytes: delivered(),
          };
        },
      );
    },
  };
}
