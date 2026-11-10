/**
 * Extração de texto de HTML sem navegador (reserva do leitor quando o Chromium não abre, e
 * leitura de metadados antes de renderizar). Não executa nada: só expressões regulares sobre o
 * texto. Scripts, estilos, SVG e modelos são descartados com o conteúdo.
 *
 * Todo o processamento é linear no tamanho do HTML: nenhuma expressão regular tem repetição que
 * possa voltar atrás sem limite (página montada para travar o servidor, revisão de segurança
 * 2026-11-10, A1). Comentários e elementos de texto bruto saem com `indexOf`, sem regex.
 */

export interface ExtractedHtml {
  title: string | null;
  description: string | null;
  lang: string | null;
  /** Diretivas de `<meta name="robots">` e `<meta name="prospector">`, em minúsculas. */
  robots: string[];
  text: string;
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  laquo: '«',
  raquo: '»',
  copy: '©',
  reg: '®',
  ordm: 'º',
  ordf: 'ª',
  middot: '·',
  bull: '•',
  deg: '°',
  euro: '€',
  trade: '™',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
};

// Letras acentuadas do português (sites antigos ainda usam `&atilde;`, `&ccedil;`…).
const DIACRITICS: Record<string, string> = {
  acute: '́',
  grave: '̀',
  circ: '̂',
  tilde: '̃',
  uml: '̈',
};
for (const letter of 'aeiouAEIOU') {
  for (const [name, mark] of Object.entries(DIACRITICS)) {
    NAMED_ENTITIES[`${letter}${name}`] = `${letter}${mark}`.normalize('NFC');
  }
}
Object.assign(NAMED_ENTITIES, { ccedil: 'ç', Ccedil: 'Ç', ntilde: 'ñ', Ntilde: 'Ñ' });

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]{1,8}|#\d{1,8}|[a-z]{1,32});/gi, (whole, entity: string) => {
    if (entity[0] === '#') {
      const code =
        entity[1] === 'x' || entity[1] === 'X'
          ? parseInt(entity.slice(2), 16)
          : parseInt(entity.slice(1), 10);
      return Number.isInteger(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : whole;
    }
    return NAMED_ENTITIES[entity] ?? NAMED_ENTITIES[entity.toLowerCase()] ?? whole;
  });
}

/** Colapsa espaços em cada linha e remove linhas vazias repetidas. */
export function normalizeText(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t\f\v\u2000-\u200b\u202f\u205f\u3000\ufeff]+/g, ' ').trim())
    .filter((line, index, lines) => line !== '' || (index > 0 && lines[index - 1] !== ''))
    .join('\n')
    .trim();
}

function attribute(tag: string, name: string): string | null {
  const match = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag);
  if (!match) return null;
  return decodeEntities(match[1] ?? match[2] ?? match[3] ?? '').trim() || null;
}

function metaContent(html: string, names: readonly string[]): string[] {
  const values: string[] = [];
  for (const tag of html.match(/<meta\b[^<>]*>/gi) ?? []) {
    if (tag.length > 8192) continue;
    const name = attribute(tag, 'name')?.toLowerCase();
    if (name && names.includes(name)) {
      const content = attribute(tag, 'content');
      if (content) values.push(content);
    }
  }
  return values;
}

/** Nome do `<meta>` com diretivas só para o Prospector (além do `robots` geral). */
const ROBOTS_META_NAME = 'prospector';
/** Marcador interno para a reserva de mineração de texto (TDMRep), tratada como `noarchive`. */
export const TDM_RESERVATION = 'tdm-reservation';

const BLOCK_TAGS =
  /<\/?(?:p|div|br|li|ul|ol|h[1-6]|tr|td|th|table|section|article|header|footer|nav|aside|main|blockquote|pre|figure|figcaption|dd|dt|dl|address|hr)\b[^<>]*>/gi;

/** Elementos cujo conteúdo não é texto da página. */
const RAW_ELEMENTS = /<(script|style|noscript|template|svg|iframe|object|canvas|head|title)\b/gi;

/** Tira `<!-- … -->`. Comentário sem fechamento fica como está. */
function stripComments(html: string): string {
  let out = '';
  let index = 0;
  for (;;) {
    const start = html.indexOf('<!--', index);
    if (start === -1) break;
    const end = html.indexOf('-->', start + 4);
    if (end === -1) break;
    out += `${html.slice(index, start)} `;
    index = end + 3;
  }
  return out + html.slice(index);
}

/**
 * Tira scripts, estilos e afins com o conteúdo. Cada fechamento é procurado uma vez a partir da
 * abertura; se um nome não tem fechamento, as próximas aberturas dele nem são procuradas.
 */
function stripRawElements(html: string): string {
  const open = new RegExp(RAW_ELEMENTS.source, 'gi');
  const unclosed = new Set<string>();
  let out = '';
  let index = 0;
  for (let match = open.exec(html); match !== null; match = open.exec(html)) {
    const name = (match[1] ?? '').toLowerCase();
    if (unclosed.has(name)) continue;
    const close = new RegExp(`</${name}\\s*>`, 'gi');
    close.lastIndex = open.lastIndex;
    if (!close.exec(html)) {
      unclosed.add(name);
      continue;
    }
    out += `${html.slice(index, match.index)} `;
    index = close.lastIndex;
    open.lastIndex = index;
  }
  return out + html.slice(index);
}

function firstTitle(html: string): string {
  const open = /<title\b[^<>]*>/i.exec(html);
  if (!open) return '';
  const start = open.index + open[0].length;
  const close = /<\/title\s*>/gi;
  close.lastIndex = start;
  const end = close.exec(html);
  return end ? html.slice(start, Math.min(end.index, start + 4096)) : '';
}

export function extractFromHtml(html: string): ExtractedHtml {
  const title = normalizeText(decodeEntities(firstTitle(html))).replace(/\n/g, ' ');
  const description = metaContent(html, ['description', 'og:description'])[0] ?? null;
  const htmlTag = /<html\b[^<>]*>/i.exec(html)?.[0]?.slice(0, 8192) ?? '';
  const lang = attribute(htmlTag, 'lang');
  const robots = metaContent(html, ['robots', ROBOTS_META_NAME])
    .flatMap((value) => value.toLowerCase().split(','))
    .map((value) => value.trim())
    .filter(Boolean);
  // TDMRep (W3C): `<meta name="tdm-reservation" content="1">` reserva os direitos de mineração.
  if (metaContent(html, ['tdm-reservation']).some((value) => value.trim() === '1')) {
    robots.push(TDM_RESERVATION);
  }

  const body = stripRawElements(stripComments(html))
    .replace(BLOCK_TAGS, '\n')
    .replace(/<[^<>]*>/g, ' ');
  return {
    title: title || null,
    description: description ? normalizeText(description).replace(/\n/g, ' ').slice(0, 500) : null,
    lang: lang ? lang.slice(0, 35) : null,
    robots,
    text: normalizeText(decodeEntities(body)),
  };
}

/**
 * Pedido explícito do site para não ser usado por IA ou guardado (`noai`, `noimageai` é só para
 * imagens e não conta). Vale para `<meta name="robots">`, `<meta name="prospector">` e o
 * cabeçalho `X-Robots-Tag`.
 */
export function forbidsAiUse(directives: readonly string[]): boolean {
  return directives.includes('noai');
}

/**
 * Pedido para não guardar cópia: `noarchive`, `none` (= noindex + nofollow, inclui não arquivar)
 * ou reserva de mineração de texto (TDMRep). A página pode ser mostrada na hora; o dossiê guarda
 * só endereço e título.
 */
export function forbidsArchiving(directives: readonly string[]): boolean {
  return directives.some(
    (value) => value === 'noarchive' || value === 'none' || value === TDM_RESERVATION,
  );
}

/** Diretivas do cabeçalho `X-Robots-Tag` que valem para todos ou para o Prospector. */
export function headerDirectives(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(/,(?=\s*[a-z-]+\s*:)|\n/i)
    .flatMap((part) => {
      const scoped = /^\s*([a-z0-9_-]+)\s*:\s*(.*)$/i.exec(part);
      if (
        scoped &&
        !/^(noai|noindex|none|noarchive|nofollow|noimageai|nosnippet)$/i.test(scoped[1] ?? '')
      ) {
        return (scoped[1] ?? '').toLowerCase() === ROBOTS_META_NAME
          ? (scoped[2] ?? '').split(',')
          : [];
      }
      return part.split(',');
    })
    .map((directive) => directive.trim().toLowerCase())
    .filter(Boolean);
}
