import { z } from 'zod';

/**
 * Captura de marca (ADR-0015): imagem da página em computador e celular e medições técnicas
 * feitas pelo navegador (estilos calculados, estrutura, acessibilidade observável). As medições
 * são determinísticas e viram fatos; a IA só interpreta o que elas e as imagens mostram.
 */

const IsoDateTime = z.iso.datetime({ offset: true, error: 'Data e hora inválidas (ISO 8601).' });

export const CaptureViewport = z.enum(['desktop', 'mobile']);
export type CaptureViewport = z.infer<typeof CaptureViewport>;

export const CAPTURE_VIEWPORTS: Record<CaptureViewport, { width: number; height: number }> = {
  desktop: { width: 1280, height: 800 },
  mobile: { width: 390, height: 844 },
};

/**
 * Altura máxima da imagem (px CSS): duas telas e pouco. Imagem maior pesa no disco e, principalmente,
 * no contexto do modelo de visão (cada imagem vira milhares de tokens).
 */
export const CAPTURE_MAX_HEIGHT: Record<CaptureViewport, number> = {
  desktop: 1600,
  mobile: 1700,
};

export const CAPTURE_VIEWPORT_LABELS: Record<CaptureViewport, string> = {
  desktop: 'computador',
  mobile: 'celular',
};

/** Cor em hexadecimal maiúsculo (#RRGGBB). */
const Hex = z.string().regex(/^#[0-9A-F]{6}$/);
const ShortText = z.string().max(120);

export const BrandMetrics = z.object({
  viewport: CaptureViewport,
  /** Largura e altura do conteúdo (px CSS). */
  pageWidth: z.number().int().min(0).max(100_000),
  pageHeight: z.number().int().min(0).max(1_000_000),
  title: z.string().max(300).nullable(),
  hasViewportMeta: z.boolean(),
  /** Conteúdo mais largo que a janela (rolagem lateral). */
  horizontalOverflow: z.boolean(),
  /** Famílias de fonte que cobrem mais texto visível, da maior para a menor. */
  fonts: z.array(ShortText).max(5),
  textColors: z.array(Hex).max(5),
  backgroundColors: z.array(Hex).max(5),
  /** Cores de botões, links e destaques. */
  accentColors: z.array(Hex).max(5),
  h1Count: z.number().int().min(0).max(1000),
  h1Text: z.string().max(160).nullable(),
  imageCount: z.number().int().min(0).max(10_000),
  imagesWithoutAlt: z.number().int().min(0).max(10_000),
  /** Textos de botões e links com cara de chamada para ação, como aparecem. */
  ctaTexts: z.array(ShortText).max(6),
  navLinkCount: z.number().int().min(0).max(1000),
  /** Botões e links fora de parágrafos com lado menor que 32 px (alvo pequeno no celular). */
  smallTapTargets: z.number().int().min(0).max(10_000),
  /** Amostras de texto com contraste abaixo de 4,5:1 (WCAG AA), de `contrastSamples`. */
  lowContrastTexts: z.number().int().min(0).max(10_000),
  contrastSamples: z.number().int().min(0).max(10_000),
  /** Percentual de textos com corpo menor que 12 px. */
  smallTextPercent: z.number().int().min(0).max(100),
  hasFavicon: z.boolean(),
  hasOgImage: z.boolean(),
  /** Imagem ou SVG com cara de logotipo no topo da página. */
  logo: z
    .object({
      found: z.boolean(),
      width: z.number().int().min(0).max(10_000),
      height: z.number().int().min(0).max(10_000),
      format: z.enum(['svg', 'raster', 'text', 'none']),
    })
    .default({ found: false, width: 0, height: 0, format: 'none' }),
  forms: z.number().int().min(0).max(1000),
  /** Tempo até o DOMContentLoaded nesta captura (ms). Uma medida, não um teste de desempenho. */
  domContentLoadedMs: z.number().int().min(0).max(600_000).nullable(),
  /** Bytes transferidos pelos recursos permitidos (documento, CSS, scripts, imagens, fontes). */
  transferredBytes: z.number().int().min(0).max(1_000_000_000),
});
export type BrandMetrics = z.infer<typeof BrandMetrics>;

/** Imagem da captura, já comprimida (JPEG) e com altura limitada. */
export interface CaptureImage {
  bytes: Uint8Array;
  mime: 'image/jpeg';
  width: number;
  height: number;
  sha256: string;
}

export interface BrandCapture {
  viewport: CaptureViewport;
  /** Endereço final da página capturada. */
  url: string;
  capturedAt: string;
  image: CaptureImage;
  metrics: BrandMetrics;
  /**
   * O site pediu para não guardar cópia (`noarchive`, `none` ou reserva TDM, no cabeçalho ou na
   * página): a imagem só vai à IA local nesta investigação e não fica guardada.
   */
  noArchive?: boolean;
}

export const BrandCaptureFailure = z.enum([
  'disabled',
  'blocked_address',
  'robots_disallowed',
  'access_denied',
  'restricted_site',
  'not_found',
  'unsupported_content',
  'unavailable',
  'browser_missing',
]);
export type BrandCaptureFailure = z.infer<typeof BrandCaptureFailure>;

export const StoredCapture = z.object({
  storagePath: z.string().min(1).max(500),
  bytes: z.number().int().min(0),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  capturedAt: IsoDateTime,
});
export type StoredCapture = z.infer<typeof StoredCapture>;
