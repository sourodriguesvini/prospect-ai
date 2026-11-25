import {
  CAPTURE_VIEWPORT_LABELS,
  CAPTURE_VIEWPORTS,
  INVESTIGATION_KEYS,
  type BrandMetrics,
  type ClaimDomain,
} from '@prospector/contracts';

/**
 * Medições da captura em frases determinísticas. As mesmas frases formam o texto guardado na
 * fonte `screenshot` (o que o ledger confere) e os fatos gravados a partir delas: o trecho citado
 * de cada fato é exatamente a sua frase. A IA recebe as frases numeradas (`M1`…) e só pode
 * interpretá-las; os números nunca vêm do modelo.
 */

export interface MetricLine {
  /** Nome estável da medição (não é a chave do claim). */
  name: string;
  text: string;
}

const LOGO_FORMAT_LABELS: Record<BrandMetrics['logo']['format'], string> = {
  svg: 'vetorial (SVG)',
  raster: 'imagem (bitmap)',
  text: 'só texto',
  none: 'não encontrado',
};

function quoted(list: readonly string[]): string {
  return list.map((item) => `"${item.replace(/"/g, "'")}"`).join(', ');
}

function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

/**
 * Texto alternativo das imagens sem número negativo solto: "41 imagens…, 0 sem texto alternativo"
 * foi lido pela IA local como "0 imagens com texto alternativo" (teste real de 2026-11-25).
 */
function imagesAltLine(count: number, withoutAlt: number, where: string): string {
  if (count === 0) return `Nenhuma imagem visível no ${where}.`;
  const images = `${count} ${plural(count, 'imagem visível', 'imagens visíveis')} no ${where}`;
  if (withoutAlt === 0) {
    return count === 1
      ? `${images}; ela tem texto alternativo.`
      : `${images}; todas têm texto alternativo.`;
  }
  if (withoutAlt >= count) {
    return count === 1
      ? `${images}; ela não tem texto alternativo.`
      : `${images}; nenhuma tem texto alternativo.`;
  }
  const withAlt = count - withoutAlt;
  return `${images}; ${withAlt} com texto alternativo e ${withoutAlt} sem.`;
}

/**
 * `pageText: false` quando o site pede para não guardar cópia (`noarchive`): as medições ficam,
 * mas sem o texto do H1 e das chamadas para ação (só a contagem).
 */
export interface MetricTextOptions {
  pageText?: boolean;
}

const NOT_KEPT = '(texto não guardado a pedido do site)';

export function metricLines(metrics: BrandMetrics, options: MetricTextOptions = {}): MetricLine[] {
  const where = CAPTURE_VIEWPORT_LABELS[metrics.viewport];
  const pageText = options.pageText !== false;
  const lines: MetricLine[] = [];
  const add = (name: string, text: string) => lines.push({ name, text });

  add(
    'viewport_size',
    `Captura no ${where}, com janela de ${CAPTURE_VIEWPORTS[metrics.viewport].width} px de largura.`,
  );
  if (metrics.title) add('title', `Título da página: "${metrics.title.replace(/"/g, "'")}".`);
  if (metrics.viewport === 'mobile') {
    add(
      'viewport_meta',
      metrics.hasViewportMeta
        ? 'A página declara a meta tag viewport para celular.'
        : 'A página não declara a meta tag viewport para celular.',
    );
  }
  add(
    'overflow',
    metrics.horizontalOverflow
      ? `No ${where}, o conteúdo é mais largo que a tela (há rolagem lateral).`
      : `No ${where}, o conteúdo cabe na largura da tela (sem rolagem lateral).`,
  );
  if (metrics.fonts.length > 0) {
    add('fonts', `Fontes que cobrem mais texto no ${where}: ${metrics.fonts.join(', ')}.`);
  }
  const palette = [
    metrics.textColors.length > 0 ? `texto ${metrics.textColors.join(', ')}` : null,
    metrics.backgroundColors.length > 0 ? `fundo ${metrics.backgroundColors.join(', ')}` : null,
    metrics.accentColors.length > 0 ? `botões e links ${metrics.accentColors.join(', ')}` : null,
  ].filter((part): part is string => part !== null);
  if (palette.length > 0) {
    add('palette', `Cores mais usadas no ${where}: ${palette.join('; ')}.`);
  }
  if (metrics.h1Count === 0) add('h1', `Nenhum título principal (H1) na página no ${where}.`);
  else if (!pageText)
    add(
      'h1',
      `${metrics.h1Count === 1 ? 'Um título principal (H1)' : `${metrics.h1Count} títulos principais (H1)`} no ${where} ${NOT_KEPT}.`,
    );
  else if (metrics.h1Count === 1)
    add(
      'h1',
      `Um título principal (H1) no ${where}: "${(metrics.h1Text ?? '').replace(/"/g, "'")}".`,
    );
  else
    add(
      'h1',
      `${metrics.h1Count} títulos principais (H1) no ${where}; o primeiro: "${(metrics.h1Text ?? '').replace(/"/g, "'")}".`,
    );
  add('images_alt', imagesAltLine(metrics.imageCount, metrics.imagesWithoutAlt, where));
  add(
    'cta',
    metrics.ctaTexts.length === 0
      ? `Nenhuma chamada para ação reconhecida no ${where}.`
      : pageText
        ? `Chamadas para ação visíveis no ${where}: ${quoted(metrics.ctaTexts)}.`
        : `${metrics.ctaTexts.length} ${plural(metrics.ctaTexts.length, 'chamada para ação visível', 'chamadas para ação visíveis')} no ${where} ${NOT_KEPT}.`,
  );
  add('nav', `${metrics.navLinkCount} links de navegação no menu no ${where}.`);
  if (metrics.viewport === 'mobile') {
    add(
      'tap_targets',
      `${metrics.smallTapTargets} ${plural(metrics.smallTapTargets, 'elemento clicável menor', 'elementos clicáveis menores')} que 32 px no celular.`,
    );
  }
  if (metrics.contrastSamples > 0) {
    add(
      'contrast',
      `${metrics.lowContrastTexts} de ${metrics.contrastSamples} amostras de texto com contraste abaixo de 4,5:1 no ${where}.`,
    );
  }
  add(
    'small_text',
    `${metrics.smallTextPercent}% dos textos com corpo menor que 12 px no ${where}.`,
  );
  if (metrics.viewport === 'desktop') {
    add(
      'favicon',
      metrics.hasFavicon
        ? 'A página tem ícone de favoritos (favicon).'
        : 'A página não tem ícone de favoritos (favicon).',
    );
    add(
      'og_image',
      metrics.hasOgImage
        ? 'A página define imagem de compartilhamento (og:image).'
        : 'A página não define imagem de compartilhamento (og:image).',
    );
  }
  add(
    'logo',
    metrics.logo.found
      ? `Logotipo no topo da página no ${where}: ${LOGO_FORMAT_LABELS[metrics.logo.format]}, exibido em ${metrics.logo.width}×${metrics.logo.height} px na tela.`
      : `Nenhum logotipo reconhecido no topo da página no ${where}.`,
  );
  add(
    'forms',
    `${metrics.forms} ${plural(metrics.forms, 'formulário', 'formulários')} na página no ${where}.`,
  );
  if (metrics.domContentLoadedMs !== null) {
    add(
      'dom_ready',
      `Estrutura da página pronta em ${metrics.domContentLoadedMs} ms nesta captura (${where}).`,
    );
  }
  add(
    'transfer',
    `${Math.round(metrics.transferredBytes / 1024)} KB transferidos nesta captura (${where}).`,
  );
  return lines;
}

/** Texto guardado na fonte da captura: cabeçalho fixo e uma medição por linha. */
export function captureExcerpt(
  metrics: BrandMetrics,
  url: string,
  capturedAt: string,
  options: MetricTextOptions = {},
): string {
  return [
    `Captura automática de ${url} em ${capturedAt}.`,
    ...metricLines(metrics, options).map((line) => line.text),
  ].join('\n');
}

export interface MetricFact {
  key: string;
  domain: ClaimDomain;
  statement: string;
  value: Record<string, unknown>;
  /** Frase da medição, idêntica à do texto da fonte. */
  quote: string;
}

/**
 * Fatos que valem registro (os que a rubrica usa). Os demais números ficam só no texto da fonte,
 * disponíveis para a IA e para o usuário conferir, sem poluir o ledger.
 */
export function metricFacts(metrics: BrandMetrics, options: MetricTextOptions = {}): MetricFact[] {
  const pageText = options.pageText !== false;
  const byName = new Map(metricLines(metrics, options).map((line) => [line.name, line.text]));
  const facts: MetricFact[] = [];
  const add = (
    name: string,
    keyName: string,
    value: Record<string, unknown>,
    domain: ClaimDomain = 'visual',
    key = INVESTIGATION_KEYS.metric(keyName),
  ) => {
    const text = byName.get(name);
    if (text) facts.push({ key, domain, statement: text, value, quote: text });
  };

  if (metrics.viewport === 'mobile') {
    add('viewport_meta', 'mobile_viewport_meta', { present: metrics.hasViewportMeta });
    add('overflow', 'mobile_overflow', { overflow: metrics.horizontalOverflow });
    add('tap_targets', 'mobile_tap_targets', { count: metrics.smallTapTargets });
    add('small_text', 'mobile_small_text', { percent: metrics.smallTextPercent });
    return facts;
  }

  add('h1', 'h1', { count: metrics.h1Count, text: pageText ? metrics.h1Text : null });
  add('images_alt', 'images_alt', {
    images: metrics.imageCount,
    withoutAlt: metrics.imagesWithoutAlt,
  });
  add('contrast', 'contrast', {
    low: metrics.lowContrastTexts,
    samples: metrics.contrastSamples,
  });
  add(
    'cta',
    'cta',
    pageText ? { texts: metrics.ctaTexts } : { count: metrics.ctaTexts.length, texts: [] },
  );
  add('favicon', 'favicon', { present: metrics.hasFavicon });
  add('og_image', 'og_image', { present: metrics.hasOgImage });
  add('logo', 'logo', { ...metrics.logo });
  add('fonts', 'fonts', { fonts: metrics.fonts }, 'visual', INVESTIGATION_KEYS.typography);
  add(
    'palette',
    'palette',
    {
      text: metrics.textColors,
      background: metrics.backgroundColors,
      accent: metrics.accentColors,
    },
    'visual',
    INVESTIGATION_KEYS.palette,
  );
  return facts;
}

/** Cores principais (para o retrato e a detecção de mudança visual). */
export function dominantColors(metrics: BrandMetrics): string[] {
  return [
    ...new Set([...metrics.accentColors, ...metrics.backgroundColors, ...metrics.textColors]),
  ].slice(0, 12);
}
