/**
 * Sites que aparecem em buscas mas não são o site de uma empresa prospectada: redes sociais,
 * guias e diretórios, portais de notícia, sites de vagas, governo, marketplaces e referências.
 * Um resultado num desses hosts pode trazer menção ou sinal de uma empresa, mas nunca vira o
 * "site oficial" dela nem a chave de deduplicação (dois concorrentes no mesmo guia não são a mesma
 * empresa). Lista determinística; o extrator (modelo) só complementa para hosts desconhecidos.
 */

export type HostCategory =
  'social' | 'directory' | 'news' | 'job_board' | 'government' | 'marketplace' | 'reference';

const CATEGORY_HOSTS: Record<HostCategory, readonly string[]> = {
  social: [
    'linkedin.com',
    'lnkd.in',
    'instagram.com',
    'facebook.com',
    'fb.com',
    'fb.me',
    'tiktok.com',
    'x.com',
    'twitter.com',
    'youtube.com',
    'youtu.be',
    'threads.net',
    'threads.com',
    'pinterest.com',
    'pinterest.com.br',
    'wa.me',
    'whatsapp.com',
    'kwai.com',
    'linktr.ee',
    'medium.com',
  ],
  directory: [
    'google.com',
    'google.com.br',
    'goo.gl',
    'g.page',
    'doctoralia.com.br',
    'boaconsulta.com',
    'telelistas.net',
    'guiamais.com.br',
    'apontador.com.br',
    'solutudo.com.br',
    'cylex.com.br',
    'econodata.com.br',
    'cnpj.biz',
    'cnpja.com',
    'cnpj.info',
    'casadosdados.com.br',
    'empresascnpj.com',
    'consultasocio.com',
    'informecadastral.com.br',
    'listamais.com.br',
    'guiafacil.com',
    'yelp.com',
    'tripadvisor.com',
    'tripadvisor.com.br',
    'foursquare.com',
    'reclameaqui.com.br',
    'escavador.com',
    'jusbrasil.com.br',
    'opencnpj.org',
    'minhareceita.org',
    'brasilapi.com.br',
    'speedio.com.br',
    'portaldasempresas.com',
    'encontrasp.com.br',
    'acheaqui.com.br',
    'paginasamarelas.com.br',
    'waze.com',
    'zapimoveis.com.br',
    'vivareal.com.br',
  ],
  news: [
    'globo.com',
    'uol.com.br',
    'estadao.com.br',
    'exame.com',
    'infomoney.com.br',
    'cnnbrasil.com.br',
    'r7.com',
    'terra.com.br',
    'metropoles.com',
    'gazetadopovo.com.br',
    'band.uol.com.br',
    'istoe.com.br',
    'istoedinheiro.com.br',
    'veja.abril.com.br',
    'abril.com.br',
    'correiobraziliense.com.br',
    'em.com.br',
    'oglobo.globo.com',
    'valor.globo.com',
    'poder360.com.br',
    'jornaldocomercio.com',
    'acidadeon.com',
    'revide.com.br',
    'investnews.com.br',
    'startse.com',
    'mercadoeconsumo.com.br',
    'meioemensagem.com.br',
    'propmark.com.br',
    'b9.com.br',
    'mundodomarketing.com.br',
    'baguete.com.br',
    'neofeed.com.br',
    'braziljournal.com',
    'forbes.com.br',
    'agenciabrasil.ebc.com.br',
    'ebc.com.br',
  ],
  job_board: [
    'gupy.io',
    'vagas.com.br',
    'indeed.com',
    'glassdoor.com.br',
    'glassdoor.com',
    'catho.com.br',
    'infojobs.com.br',
    'empregos.com.br',
    'trabalhabrasil.com.br',
    'bne.com.br',
    '99jobs.com',
    'solides.jobs',
    'jooble.org',
    'kenoby.com',
    'recrutei.com.br',
    'pandape.com.br',
    'quickin.io',
    'inhire.app',
    'abler.com.br',
    'trampos.co',
    'programathor.com.br',
    'jobs.lever.co',
    'lever.co',
    'greenhouse.io',
    'workable.com',
  ],
  government: ['gov.br', 'jus.br', 'leg.br', 'mp.br', 'def.br'],
  marketplace: [
    'mercadolivre.com.br',
    'mercadolibre.com',
    'olx.com.br',
    'ifood.com.br',
    'amazon.com.br',
    'shopee.com.br',
    'magazineluiza.com.br',
    'americanas.com.br',
    'booking.com',
    'airbnb.com.br',
    'airbnb.com',
    'aliexpress.com',
  ],
  reference: ['wikipedia.org', 'wikimedia.org', 'wikidata.org', 'archive.org'],
};

/** Hospedagens em que cada site é um subdomínio (ou caminho) de um host compartilhado. */
const SHARED_HOSTING = [
  'wixsite.com',
  'wordpress.com',
  'blogspot.com',
  'negocio.site',
  'business.site',
  'webnode.page',
  'webnode.com.br',
  'godaddysites.com',
  'site123.me',
  'squarespace.com',
  'netlify.app',
  'vercel.app',
  'github.io',
];

/**
 * Segundo nível do registro.br (lista oficial, resumida aos usados por empresas): em
 * `clinica.com.br` o domínio registrável tem 3 partes.
 */
const BR_SECOND_LEVEL = new Set([
  'adm',
  'adv',
  'agr',
  'app',
  'arq',
  'art',
  'bio',
  'blog',
  'com',
  'coop',
  'dev',
  'eco',
  'edu',
  'emp',
  'eng',
  'esp',
  'etc',
  'eti',
  'far',
  'fot',
  'gov',
  'imb',
  'ind',
  'inf',
  'jor',
  'leg',
  'log',
  'med',
  'mp',
  'net',
  'nom',
  'not',
  'ntr',
  'odo',
  'org',
  'ppg',
  'pro',
  'psc',
  'psi',
  'rec',
  'seg',
  'srv',
  'tec',
  'tmp',
  'tur',
  'tv',
  'vet',
]);

function matches(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

/** Host em minúsculas, sem `www.` e sem ponto final; null para endereço inválido. */
export function hostOf(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    const host = parsed.hostname.toLowerCase().replace(/\.$/, '');
    return host.startsWith('www.') ? host.slice(4) : host;
  } catch {
    return null;
  }
}

/** Domínio registrável (`agenda.clinica.com.br` → `clinica.com.br`). */
export function registrableDomain(host: string): string {
  const labels = host
    .toLowerCase()
    .replace(/^www\./, '')
    .split('.')
    .filter(Boolean);
  if (labels.length <= 2) return labels.join('.');
  const tld = labels[labels.length - 1];
  const second = labels[labels.length - 2] ?? '';
  if (tld === 'br' && BR_SECOND_LEVEL.has(second)) return labels.slice(-3).join('.');
  return labels.slice(-2).join('.');
}

/** Categoria do host, quando ele não é site de empresa prospectada; null = pode ser. */
export function hostCategory(host: string): HostCategory | null {
  const clean = host.toLowerCase().replace(/^www\./, '');
  for (const [category, domains] of Object.entries(CATEGORY_HOSTS) as Array<
    [HostCategory, readonly string[]]
  >) {
    if (domains.some((domain) => matches(clean, domain.toLowerCase()))) return category;
  }
  return null;
}

/**
 * Chave do site para deduplicar: o domínio registrável; em hospedagem compartilhada, o
 * subdomínio inteiro (e, no Wix, o primeiro trecho do caminho). null = não serve como site oficial.
 */
export function siteKey(url: string): string | null {
  const host = hostOf(url);
  if (!host || hostCategory(host) !== null) return null;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':')) return null;
  const shared = SHARED_HOSTING.find((domain) => matches(host, domain));
  if (shared) {
    if (host === shared) return null;
    if (shared === 'wixsite.com') {
      const first = new URL(url).pathname.split('/').filter(Boolean)[0];
      return first ? `${host}/${first.toLowerCase()}` : host;
    }
    return host;
  }
  return registrableDomain(host);
}

/** Página inicial do site (para a verificação de nível 2). */
export function homepageOf(url: string): string | null {
  try {
    const parsed = new URL(url);
    const host = hostOf(url);
    if (!host) return null;
    if (SHARED_HOSTING.some((domain) => matches(host, domain))) {
      const first = parsed.pathname.split('/').filter(Boolean)[0];
      return host.endsWith('wixsite.com') && first
        ? `${parsed.protocol}//${parsed.hostname}/${first}`
        : `${parsed.protocol}//${parsed.hostname}/`;
    }
    return `${parsed.protocol}//${parsed.hostname}/`;
  } catch {
    return null;
  }
}
