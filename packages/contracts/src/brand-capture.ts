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

/**
 * Parte da página numa imagem (diretriz de 2026-11-26, Parte 13.3): `top` são as primeiras telas
 * (cabeçalho, navegação, destaque e as primeiras seções); `footer`, o rodapé, quando ele fica fora
 * das primeiras telas; `menu`, o menu de navegação aberto no celular.
 */
export const CaptureRegion = z.enum(['top', 'footer', 'menu']);
export type CaptureRegion = z.infer<typeof CaptureRegion>;

export const CAPTURE_REGION_LABELS: Record<CaptureRegion, string> = {
  top: 'primeiras telas',
  footer: 'rodapé',
  menu: 'menu de navegação aberto',
};

/** Página capturada: a inicial ou uma página interna relevante (produtos, serviços ou institucional). */
export const CapturePage = z.enum(['home', 'inner']);
export type CapturePage = z.infer<typeof CapturePage>;

/** Cada imagem guardada ocupa uma vaga: página × janela × parte. */
export interface CaptureSlot {
  page: CapturePage;
  viewport: CaptureViewport;
  region: CaptureRegion;
}

/**
 * Vagas aceitas. A página interna leva só as primeiras telas; o menu aberto é só do celular (no
 * computador a navegação já aparece no cabeçalho).
 */
export const CaptureKind = z.enum([
  'site_desktop',
  'site_mobile',
  'site_desktop_footer',
  'site_mobile_footer',
  'site_mobile_menu',
  'inner_desktop',
  'inner_mobile',
]);
export type CaptureKind = z.infer<typeof CaptureKind>;

const SLOT_BY_KIND: Record<CaptureKind, CaptureSlot> = {
  site_desktop: { page: 'home', viewport: 'desktop', region: 'top' },
  site_mobile: { page: 'home', viewport: 'mobile', region: 'top' },
  site_desktop_footer: { page: 'home', viewport: 'desktop', region: 'footer' },
  site_mobile_footer: { page: 'home', viewport: 'mobile', region: 'footer' },
  site_mobile_menu: { page: 'home', viewport: 'mobile', region: 'menu' },
  inner_desktop: { page: 'inner', viewport: 'desktop', region: 'top' },
  inner_mobile: { page: 'inner', viewport: 'mobile', region: 'top' },
};

export function captureSlotOf(kind: CaptureKind): CaptureSlot {
  return SLOT_BY_KIND[kind];
}

/** Vaga → tipo; null quando a combinação não é aceita (ex.: menu no computador). */
export function captureKindOf(slot: CaptureSlot): CaptureKind | null {
  for (const kind of CaptureKind.options) {
    const known = SLOT_BY_KIND[kind];
    if (
      known.page === slot.page &&
      known.viewport === slot.viewport &&
      known.region === slot.region
    ) {
      return kind;
    }
  }
  return null;
}

/**
 * Final do nome do arquivo de cada vaga: `<investigação>-<janela>[-<parte>].jpg`. As primeiras telas
 * da página inicial mantêm o nome de antes (`-desktop.jpg`, `-mobile.jpg`): imagens antigas
 * continuam válidas.
 */
export function captureFileSuffix(kind: CaptureKind): string {
  const slot = SLOT_BY_KIND[kind];
  const part = slot.page === 'inner' ? '-inner' : slot.region === 'top' ? '' : `-${slot.region}`;
  return `${slot.viewport}${part}`;
}

/** Nome de arquivo de captura (sem a pasta da empresa). */
export const CAPTURE_FILE_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-(desktop|mobile)(-(footer|menu|inner))?\.jpg$/;

/**
 * Como terminou a imagem de uma vaga (diretriz, Parte 13.4): guardada agora, reaproveitada de uma
 * análise anterior (mesma imagem, mesmo hash), não guardada a pedido do site, não guardada por
 * falha de gravação ou porque a pasta de dados não estava disponível.
 */
export const CaptureStorageOutcome = z.enum([
  'stored',
  'reused',
  'no_archive',
  'failed',
  'not_configured',
]);
export type CaptureStorageOutcome = z.infer<typeof CaptureStorageOutcome>;

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
  /** Rodapé e menu aberto, quando pedidos e encontrados, na mesma sessão do navegador. */
  extras?: CaptureExtra[];
  /** Partes pedidas que não viraram imagem, com o motivo (sem rodapé, menu não encontrado…). */
  missing?: CaptureMissingPart[];
}

export interface CaptureExtra {
  region: Exclude<CaptureRegion, 'top'>;
  image: CaptureImage;
}

export interface CaptureMissingPart {
  region: Exclude<CaptureRegion, 'top'>;
  /**
   * `inside_top`: o rodapé já aparece nas primeiras telas (página curta); `not_found`: a página não
   * tem rodapé ou menu reconhecível; `failed`: o navegador não conseguiu fazer a imagem.
   */
  reason: 'inside_top' | 'not_found' | 'failed';
}

/** Partes extras que a captura deve tentar, além das primeiras telas. */
export interface CaptureExtrasRequest {
  footer?: boolean;
  menu?: boolean;
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
