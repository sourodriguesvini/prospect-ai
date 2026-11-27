import { createHash } from 'node:crypto';
import type { BrandCaptureResult, BrandCapturer, PageFetchFailure } from '@prospector/application';
import {
  BrandMetrics,
  CAPTURE_MAX_HEIGHT,
  CAPTURE_VIEWPORTS,
  type BrandCaptureFailure,
  type CaptureExtra,
  type CaptureExtrasRequest,
  type CaptureImage,
  type CaptureViewport,
} from '@prospector/contracts';
import type { BrowserCapturer } from './browser';
import {
  extractFromHtml,
  forbidsAiUse,
  forbidsArchiving,
  headerDirectives,
  looksLikeBotChallenge,
} from './html';
import { decode, isRestrictedHost, mimeOf, statusFailure } from './page-reader';
import { createRobotsChecker, type RobotsChecker } from './robots';
import { safeFetch, type SafeFetchFailure, type Transport } from './safe-http';
import { checkUrl, resolvePublicTarget, systemResolver, type Resolver } from './ssrf';

/**
 * Captura de marca (porta `BrandCapturer`, ADR-0015): a página inicial numa janela de computador
 * ou de celular, com imagem JPEG das primeiras telas e medições feitas pelo navegador. Mesmas
 * proteções do leitor de páginas: URL e DNS conferidos (SSRF), sites com termos restritivos,
 * robots.txt, `noai`, cada redirecionamento conferido de novo, sub-recursos só pelo cliente
 * seguro, sandbox do Chromium e prazo total. Nunca lança por falha do site.
 */

export interface BrandCapturerOptions {
  /** Navegador com captura (o mesmo do leitor de páginas); null = captura desligada. */
  browser: BrowserCapturer | null;
  resolver?: Resolver;
  transport?: Transport;
  /** Prazo total de uma captura (documento, navegador, medições e imagem). */
  timeoutMs?: number;
  /** Prazo a mais quando a captura também tira rodapé e menu aberto (padrão 15 s). */
  extrasTimeoutMs?: number;
  /** Altura máxima da imagem por janela (px CSS): as primeiras telas, não a página inteira. */
  maxHeight?: Partial<Record<CaptureViewport, number>>;
  /** Qualidade JPEG (0–100). */
  quality?: number;
  now?: () => Date;
  log?: (message: string) => void;
}

/** Altura máxima padrão (contrato): duas telas e pouco. */
export const DEFAULT_CAPTURE_MAX_HEIGHT: Record<CaptureViewport, number> = CAPTURE_MAX_HEIGHT;

const HTML_TYPES = new Set(['text/html', 'application/xhtml+xml']);

/**
 * Medições na própria página (sem tipos de DOM no pacote, por isso como texto). Determinísticas:
 * estilos calculados, estrutura e contraste de uma amostra de textos. O resultado volta cru e é
 * validado pelo contrato `BrandMetrics` (com a janela e os bytes, que vêm do servidor).
 */
export const METRICS_SCRIPT = String.raw`(() => {
  const doc = document.documentElement;
  const body = document.body || doc;
  // Janela de layout: no celular, conteúdo largo demais faz o navegador afastar o zoom e
  // innerWidth crescer junto; clientWidth continua a largura do aparelho.
  const vw = doc.clientWidth || window.innerWidth || 0;
  const clean = (value, max) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
  const parse = (value) => {
    const match = /^rgba?\(([^)]+)\)$/.exec(String(value || '').trim());
    if (!match) return null;
    const parts = match[1].split(/[\s,\/]+/).filter(Boolean).map(parseFloat);
    if (parts.length < 3 || parts.some((part) => Number.isNaN(part))) return null;
    return [parts[0], parts[1], parts[2], parts.length > 3 ? parts[3] : 1];
  };
  const hex = (color) =>
    '#' +
    color
      .slice(0, 3)
      .map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase();
  const channel = (v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  const luminance = (c) => 0.2126 * channel(c[0]) + 0.7152 * channel(c[1]) + 0.0722 * channel(c[2]);
  const contrast = (a, b) => {
    const x = luminance(a);
    const y = luminance(b);
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  };
  const shown = (el) => {
    const rect = el.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return false;
    const style = getComputedStyle(el);
    return style.visibility !== 'hidden' && style.display !== 'none' && Number(style.opacity) > 0.05;
  };
  // Fundo sólido mais próximo. Imagem ou gradiente antes dele: fundo desconhecido (null) e a
  // amostra não entra na conta (texto branco sobre foto não é "contraste baixo"; caso real em
  // 2026-11-11).
  const backdrop = (el) => {
    for (let node = el; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      const color = parse(style.backgroundColor);
      if (color && color[3] >= 0.5) return color;
      if (style.backgroundImage && style.backgroundImage !== 'none') return null;
    }
    return [255, 255, 255, 1];
  };
  const bump = (map, key, n) => map.set(key, (map.get(key) || 0) + n);
  const top = (map, k) =>
    Array.from(map.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, k)
      .map((entry) => entry[0]);
  const colorful = (h) => {
    const v = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
    return Math.max(...v) - Math.min(...v) >= 24;
  };

  const fonts = new Map();
  const texts = new Map();
  const backs = new Map();
  const accents = new Map();
  let samples = 0;
  let low = 0;
  let smallText = 0;
  let textCount = 0;
  const seen = new Set();
  const skip = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE']);
  const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
  let visited = 0;
  for (let node = walker.nextNode(); node && visited < 5000; node = walker.nextNode()) {
    visited += 1;
    const text = (node.textContent || '').trim();
    if (text.length < 2) continue;
    const el = node.parentElement;
    if (!el || seen.has(el) || skip.has(el.tagName)) continue;
    seen.add(el);
    if (!shown(el)) continue;
    const style = getComputedStyle(el);
    const size = parseFloat(style.fontSize) || 16;
    const family = clean((style.fontFamily || '').split(',')[0].replace(/["']/g, ''), 60);
    if (family) bump(fonts, family, text.length * size);
    textCount += 1;
    if (size < 12) smallText += 1;
    const color = parse(style.color);
    if (!color) continue;
    bump(texts, hex(color), text.length);
    const back = samples < 400 ? backdrop(el) : null;
    if (back) {
      samples += 1;
      const large = size >= 24 || (size >= 18.66 && Number(style.fontWeight) >= 700);
      if (contrast(color, back) < (large ? 3 : 4.5)) low += 1;
    }
  }

  const pageWidth = Math.max(doc.scrollWidth || 0, body.scrollWidth || 0);
  const pageHeight = Math.max(doc.scrollHeight || 0, body.scrollHeight || 0);
  const base = parse(getComputedStyle(body).backgroundColor) || parse(getComputedStyle(doc).backgroundColor);
  bump(backs, base && base[3] >= 0.5 ? hex(base) : '#FFFFFF', vw * Math.max(pageHeight, 1));
  for (const el of Array.from(body.querySelectorAll('*')).slice(0, 3000)) {
    const color = parse(getComputedStyle(el).backgroundColor);
    if (!color || color[3] < 0.5) continue;
    const rect = el.getBoundingClientRect();
    const area = Math.max(0, Math.min(rect.width, vw)) * Math.max(0, rect.height);
    if (area > 2000) bump(backs, hex(color), area);
  }

  const CTA = /(or[cç]amento|contato|fale|agend|compr|saiba mais|whats|solicit|pe[cç]a |cadastr|assin|reserv|ligue|conhe[cç]a|come[cç]|quero|baixe|inscrev|matr[ií]cul|cota[cç]|simul)/i;
  const ctas = [];
  let navLinks = 0;
  let smallTaps = 0;
  const clickables = Array.from(
    document.querySelectorAll('a[href], button, [role="button"], input[type="submit"], input[type="button"]'),
  ).slice(0, 1500);
  for (const el of clickables) {
    if (!shown(el)) continue;
    const style = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    const inNav = !!el.closest('nav, header, [role="navigation"]');
    if (inNav && el.tagName === 'A') navLinks += 1;
    if (!el.closest('p, li p') && (rect.width < 32 || rect.height < 32)) smallTaps += 1;
    const background = parse(style.backgroundColor);
    const filled = !!background && background[3] >= 0.5;
    if (filled) bump(accents, hex(background), 3);
    else if (el.tagName === 'A' && !inNav) {
      const color = parse(style.color);
      if (color) bump(accents, hex(color), 1);
    }
    const label = clean(el.innerText || el.value || el.getAttribute('aria-label'), 60);
    if (label && ctas.length < 6 && !ctas.includes(label) && (CTA.test(label) || (filled && label.length <= 30))) {
      ctas.push(label);
    }
  }
  const accentList = top(accents, 10);
  const colorfulAccents = accentList.filter(colorful);

  const banner = document.querySelector('header, [role="banner"]') || body;
  const homeHref = /^(\/|https?:\/\/[^\/]+\/?)(index\.html?)?$/i;
  const marks = Array.from(banner.querySelectorAll('img, svg')).filter((el) => {
    const rect = el.getBoundingClientRect();
    return rect.top < 250 && rect.width >= 16 && rect.height >= 8 && shown(el);
  });
  const named = marks.find((el) => {
    const link = el.closest('a');
    return /logo|marca|brand/i.test(
      [el.getAttribute('alt'), el.getAttribute('class'), el.id, el.getAttribute('src'), link ? link.getAttribute('class') : '']
        .join(' '),
    );
  });
  const linked = marks.find((el) => {
    const link = el.closest('a');
    return !!link && homeHref.test(link.getAttribute('href') || '');
  });
  const mark = named || linked || null;
  let logo = { found: false, width: 0, height: 0, format: 'none' };
  if (mark) {
    const rect = mark.getBoundingClientRect();
    const svg = mark.tagName.toLowerCase() === 'svg' || /\.svg(\?|$)/i.test(mark.getAttribute('src') || '');
    logo = { found: true, width: Math.round(rect.width), height: Math.round(rect.height), format: svg ? 'svg' : 'raster' };
  } else {
    const word = Array.from(banner.querySelectorAll('a[href]')).find(
      (link) => homeHref.test(link.getAttribute('href') || '') && clean(link.innerText, 80).length > 1 && link.getBoundingClientRect().top < 250,
    );
    if (word) {
      const rect = word.getBoundingClientRect();
      logo = { found: true, width: Math.round(rect.width), height: Math.round(rect.height), format: 'text' };
    }
  }

  const images = Array.from(document.images).filter(shown);
  const h1s = Array.from(document.querySelectorAll('h1')).filter(shown);
  const navigation = performance.getEntriesByType('navigation')[0];
  return {
    pageWidth: Math.round(pageWidth),
    pageHeight: Math.round(pageHeight),
    title: clean(document.title, 300) || null,
    hasViewportMeta: !!document.querySelector('meta[name="viewport" i]'),
    horizontalOverflow: pageWidth > vw + 2,
    fonts: top(fonts, 5),
    textColors: top(texts, 5),
    backgroundColors: top(backs, 5),
    accentColors: (colorfulAccents.length ? colorfulAccents : accentList).slice(0, 5),
    h1Count: h1s.length,
    h1Text: h1s.length ? clean(h1s[0].innerText, 160) || null : null,
    imageCount: images.length,
    imagesWithoutAlt: images.filter((img) => !img.hasAttribute('alt')).length,
    ctaTexts: ctas,
    navLinkCount: navLinks,
    smallTapTargets: smallTaps,
    lowContrastTexts: low,
    contrastSamples: samples,
    smallTextPercent: textCount ? Math.round((100 * smallText) / textCount) : 0,
    hasFavicon: !!document.querySelector('link[rel~="icon" i]'),
    hasOgImage: !!document.querySelector('meta[property="og:image" i]'),
    logo,
    forms: document.forms.length,
    domContentLoadedMs:
      navigation && navigation.domContentLoadedEventEnd > 0 ? Math.round(navigation.domContentLoadedEventEnd) : null,
  };
})()`;

/** Motivos do leitor que a captura não distingue viram "fora do ar". */
function captureFailure(failure: SafeFetchFailure | PageFetchFailure): BrandCaptureFailure {
  switch (failure) {
    case 'too_large':
    case 'too_many_redirects':
    case 'rate_limited':
      return 'unavailable';
    default:
      return failure;
  }
}

/** O Playwright avisa assim quando o Chromium não foi instalado. */
function browserMissing(error: unknown): boolean {
  return (
    error instanceof Error && /Executable doesn't exist|browserType\.launch/i.test(error.message)
  );
}

export function createBrandCapturer(options: BrandCapturerOptions): BrandCapturer {
  const resolver = options.resolver ?? systemResolver;
  const timeoutMs = options.timeoutMs ?? 30_000;
  const extrasTimeoutMs = options.extrasTimeoutMs ?? 15_000;
  const quality = Math.min(90, Math.max(40, options.quality ?? 70));
  const now = options.now ?? (() => new Date());
  const log = options.log ?? ((message: string) => console.warn(message));
  const transportOptions = options.transport ? { transport: options.transport } : {};
  const robots: RobotsChecker = createRobotsChecker({
    fetchOptions: { resolver, ...transportOptions, timeoutMs: Math.min(5000, timeoutMs) },
    now: () => now().getTime(),
  });

  async function gate(url: URL, signal: AbortSignal): Promise<SafeFetchFailure | null> {
    if (isRestrictedHost(url)) return 'restricted_site';
    const target = await resolvePublicTarget(url, resolver);
    if (!target.ok) return target.reason;
    return (await robots.allowed(url, signal)) ? null : 'robots_disallowed';
  }

  async function run(
    raw: string,
    viewport: CaptureViewport,
    signal: AbortSignal,
    started: number,
    limitMs: number,
    extras: CaptureExtrasRequest | undefined,
  ): Promise<BrandCaptureResult> {
    const failed = (failure: BrandCaptureFailure): BrandCaptureResult => ({ ok: false, failure });
    const browser = options.browser;
    if (!browser) return failed('disabled');
    const checked = checkUrl(raw);
    if (!checked.ok) return failed('blocked_address');
    const requested = checked.url;
    requested.hash = '';
    const refusal = await gate(requested, signal);
    if (refusal) return failed(captureFailure(refusal));

    const fetched = await safeFetch(requested, {
      resolver,
      ...transportOptions,
      maxBytes: 3 * 1024 * 1024,
      timeoutMs,
      signal,
      maxRedirects: 5,
      beforeRedirect: (next) => gate(next, signal),
    });
    signal.throwIfAborted();
    if (!fetched.ok) return failed(captureFailure(fetched.failure));
    const { response, url } = fetched;
    const byStatus = statusFailure(response.status);
    if (byStatus) return failed(captureFailure(byStatus));
    const fromHeader = headerDirectives(response.headers['x-robots-tag']);
    if (forbidsAiUse(fromHeader)) return failed('access_denied');
    const { mime, charset } = mimeOf(response.headers['content-type']);
    if (!HTML_TYPES.has(mime)) return failed('unsupported_content');
    const html = decode(response.body, charset, true);
    const statics = extractFromHtml(html);
    const { robots } = statics;
    if (forbidsAiUse(robots)) return failed('access_denied');
    // Tela anti-robô no lugar do site: não é a marca da empresa (diretriz 2026-11-26, 13.4).
    if (looksLikeBotChallenge({ title: statics.title, text: statics.text.slice(0, 4000) })) {
      return failed('access_denied');
    }
    // Mesmo critério da leitura de páginas (ADR-0012 §2): sem cópia guardada.
    const noArchive =
      forbidsArchiving(fromHeader) ||
      forbidsArchiving(robots) ||
      response.headers['tdm-reservation']?.trim() === '1';

    const left = limitMs - (Date.now() - started) - 250;
    if (left < 3000) return failed('unavailable');
    const size = CAPTURE_VIEWPORTS[viewport];
    // Menu aberto só no celular: no computador a navegação já está no cabeçalho.
    const wanted =
      extras && (extras.footer || (extras.menu && viewport === 'mobile'))
        ? { footer: extras.footer === true, menu: extras.menu === true && viewport === 'mobile' }
        : null;
    let shot;
    try {
      shot = await browser.capture(
        {
          url: url.toString(),
          status: response.status,
          contentType: `${mime}; charset=utf-8`,
          body: new TextEncoder().encode(html),
        },
        {
          timeoutMs: left,
          viewport: size,
          mobile: viewport === 'mobile',
          maxHeight: options.maxHeight?.[viewport] ?? DEFAULT_CAPTURE_MAX_HEIGHT[viewport],
          quality,
          metricsScript: METRICS_SCRIPT,
          ...(wanted ? { extras: wanted } : {}),
        },
      );
    } catch (error) {
      if (signal.aborted) throw error;
      return failed(browserMissing(error) ? 'browser_missing' : 'unavailable');
    }
    const metrics = BrandMetrics.safeParse({
      ...(shot.metrics && typeof shot.metrics === 'object' ? shot.metrics : {}),
      viewport,
      transferredBytes: shot.transferredBytes,
    });
    if (!metrics.success) {
      log('[captura] medições fora do contrato');
      return failed('unavailable');
    }
    // O desafio também pode aparecer só depois do script da página rodar.
    if (looksLikeBotChallenge({ title: metrics.data.title })) return failed('access_denied');
    const image = (bytes: Uint8Array, width: number, height: number): CaptureImage => ({
      bytes,
      mime: 'image/jpeg',
      width,
      height,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    });
    const capturedExtras: CaptureExtra[] = (shot.extras ?? [])
      .filter((extra) => extra.image.length > 0)
      .map((extra) => ({
        region: extra.region,
        image: image(extra.image, extra.width, extra.height),
      }));
    return {
      ok: true,
      capture: {
        viewport,
        url: url.toString(),
        capturedAt: now().toISOString(),
        image: image(shot.image, shot.width, shot.height),
        metrics: metrics.data,
        noArchive,
        ...(wanted ? { extras: capturedExtras, missing: shot.missing ?? [] } : {}),
      },
    };
  }

  return {
    async capture(raw, viewport, captureOptions) {
      const started = Date.now();
      const extras = captureOptions?.extras;
      // Rodapé e menu ganham um prazo a mais: a imagem principal não perde tempo por causa deles.
      const limitMs =
        extras && (extras.footer || extras.menu) ? timeoutMs + extrasTimeoutMs : timeoutMs;
      const deadline = AbortSignal.timeout(limitMs);
      const signal = captureOptions?.signal
        ? AbortSignal.any([captureOptions.signal, deadline])
        : deadline;
      // DNS e navegador não aceitam `signal`: a corrida garante o prazo para quem chamou.
      let onAbort: (() => void) | undefined;
      try {
        return await Promise.race([
          run(raw, viewport, signal, started, limitMs, extras),
          new Promise<never>((_resolve, reject) => {
            onAbort = () => reject(signal.reason);
            if (signal.aborted) onAbort();
            else signal.addEventListener('abort', onAbort, { once: true });
          }),
        ]);
      } catch (error) {
        if (captureOptions?.signal?.aborted) throw error;
        if (deadline.aborted) return { ok: false, failure: 'unavailable' };
        log(`[captura] falhou: ${error instanceof Error ? error.name : 'erro'}`);
        return { ok: false, failure: 'unavailable' };
      } finally {
        if (onAbort) signal.removeEventListener('abort', onAbort);
      }
    },
  };
}
