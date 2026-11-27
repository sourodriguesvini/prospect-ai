import type { PageLink } from '@prospector/contracts';

/**
 * Escolha das páginas do site que agregam ao diagnóstico (§6.1: navegação limitada). Além da
 * página inicial, no máximo uma página por categoria, escolhida pelo endereço e pelo texto do
 * link. Nada de seguir links sem critério: o resto do site não é lido.
 */

export type SitePageCategory = 'home' | 'about' | 'services' | 'products' | 'careers' | 'units';

export const SITE_PAGE_CATEGORY_LABELS: Record<SitePageCategory, string> = {
  home: 'Página inicial',
  about: 'Institucional',
  services: 'Serviços',
  products: 'Produtos',
  careers: 'Trabalhe conosco',
  units: 'Unidades',
};

/** Ordem de interesse: quem é, o que faz, o que vende; vagas e unidades são sinais. */
const CATEGORY_ORDER: readonly Exclude<SitePageCategory, 'home'>[] = [
  'about',
  'services',
  'products',
  'careers',
  'units',
];

const PATTERNS: Record<Exclude<SitePageCategory, 'home'>, RegExp> = {
  about:
    /\b(sobre|quem[\s-_]?somos|institucional|a[\s-_]?empresa|nossa[\s-_]?historia|historia|about|empresa|conheca)\b/,
  services:
    /\b(servicos?|solucoes|especialidades|tratamentos|procedimentos|atuacao|areas?[\s-_]de[\s-_]atuacao|o[\s-_]que[\s-_]fazemos|services?)\b/,
  products:
    /\b(produtos?|catalogo|linhas?|portfolio|products?|loja|colecao|colecoes|collections?)\b/,
  careers: /\b(trabalhe[\s-_]?conosco|carreiras?|vagas|careers?|jobs)\b/,
  units: /\b(unidades|nossas[\s-_]?lojas|onde[\s-_]estamos|enderecos|filiais|clinicas)\b/,
};

/** Endereços que nunca valem a leitura (login, carrinho, arquivos, política, blog paginado…). */
const SKIP =
  /(\.(pdf|jpe?g|png|gif|webp|svg|zip|docx?|xlsx?|mp4|mp3)(\?|$))|\b(login|entrar|cadastr|carrinho|cart|checkout|minha[\s-_]?conta|wp-admin|politica|privacidade|privacy|cookies?|termos|lgpd|tag|categoria|page\/\d+|feed)\b/;

function fold(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** Caminho com `%` malformado (link de página de terceiros) fica como veio, sem derrubar a etapa. */
function safeDecode(path: string): string {
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

function hostOf(url: URL): string {
  return url.hostname.toLowerCase().replace(/^www\./, '');
}

/** Mesmo site: mesmo host ou subdomínio do domínio da empresa (sem `www.`). */
export function isSameSite(candidate: string, siteDomain: string): boolean {
  try {
    const host = hostOf(new URL(candidate));
    const domain = siteDomain.toLowerCase().replace(/^www\./, '');
    return host === domain || host.endsWith(`.${domain}`);
  } catch {
    return false;
  }
}

function canonical(url: URL): string {
  const copy = new URL(url.toString());
  copy.hash = '';
  copy.search = '';
  return copy.toString().replace(/\/$/, '');
}

/**
 * Página institucional com o nome da marca: link "a dpot" ou "o boticário", caminho "/adpot" ou
 * "/a-dpot". O nome vem do domínio da empresa (primeiro rótulo), com pelo menos 3 letras.
 */
function brandAboutPattern(siteDomain: string): RegExp | null {
  const label = fold(siteDomain.replace(/^www\./, '').split('.')[0] ?? '').replace(
    /[^a-z0-9]/g,
    '',
  );
  if (label.length < 3) return null;
  return new RegExp(`^\\s*(?:sobre\\s+)?(?:a|o|as|os)\\s?${label}\\s*$`);
}

export interface SelectedPage {
  url: string;
  category: SitePageCategory;
}

/**
 * Páginas a ler: a inicial e até `max` outras, uma por categoria, na ordem de interesse. Entre
 * candidatas da mesma categoria vence o caminho mais curto (a página principal da seção).
 */
export function selectSitePages(
  homeUrl: string,
  links: readonly PageLink[],
  options: { siteDomain: string; max?: number },
): SelectedPage[] {
  const max = Math.max(0, Math.min(options.max ?? 3, CATEGORY_ORDER.length));
  let home: URL;
  try {
    home = new URL(homeUrl);
  } catch {
    return [];
  }
  const homeKey = canonical(home);
  const aboutBrand = brandAboutPattern(options.siteDomain);
  const best = new Map<SitePageCategory, { url: string; depth: number; length: number }>();
  for (const link of links.slice(0, 400)) {
    let url: URL;
    try {
      url = new URL(link.url);
    } catch {
      continue;
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') continue;
    if (!isSameSite(url.toString(), options.siteDomain)) continue;
    const key = canonical(url);
    if (key === homeKey) continue;
    const path = fold(safeDecode(url.pathname).replace(/[-_/]+/g, ' '));
    if (SKIP.test(fold(url.pathname)) || SKIP.test(path)) continue;
    const text = fold(link.text);
    const depth = url.pathname.split('/').filter(Boolean).length;
    if (depth > 3) continue;
    for (const category of CATEGORY_ORDER) {
      const pattern = PATTERNS[category];
      const brandAbout =
        category === 'about' &&
        aboutBrand !== null &&
        (aboutBrand.test(text) || aboutBrand.test(path));
      if (!brandAbout && !pattern.test(path) && !pattern.test(text)) continue;
      const current = best.get(category);
      if (
        !current ||
        depth < current.depth ||
        (depth === current.depth && key.length < current.length)
      ) {
        best.set(category, { url: key, depth, length: key.length });
      }
      break;
    }
  }
  const chosen: SelectedPage[] = [{ url: homeKey, category: 'home' }];
  const seen = new Set([homeKey]);
  for (const category of CATEGORY_ORDER) {
    if (chosen.length - 1 >= max) break;
    const candidate = best.get(category);
    if (!candidate || seen.has(candidate.url)) continue;
    seen.add(candidate.url);
    chosen.push({ url: candidate.url, category });
  }
  return chosen;
}
