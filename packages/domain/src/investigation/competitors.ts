/**
 * Candidatos a concorrente a partir dos resultados de pesquisa (§8 da especificação). O filtro
 * aqui é determinístico: tira o próprio site, redes sociais, diretórios, marketplaces, portais e
 * repetições do mesmo domínio. Quem é concorrente direto, referência ou não é concorrente é a
 * triagem da IA, sempre sobre estes candidatos e citando o resultado (`C1`…).
 */

/** Segundos níveis comuns em domínios de país (`empresa.com.br`). */
const SECOND_LEVEL = new Set([
  'com',
  'net',
  'org',
  'gov',
  'edu',
  'art',
  'adv',
  'med',
  'eng',
  'ind',
  'inf',
  'odo',
  'psi',
  'vet',
  'arq',
  'blog',
  'eco',
  'emp',
  'srv',
  'tur',
  'co',
  'ac',
]);

/** Domínio registrável (heurística simples para `.com.br` e afins; sem lista pública de sufixos). */
export function registrableDomain(hostOrUrl: string): string | null {
  let host = hostOrUrl.trim().toLowerCase();
  try {
    if (host.includes('://')) host = new URL(host).hostname;
  } catch {
    return null;
  }
  host = host.replace(/\.$/, '').replace(/^www\./, '');
  const labels = host.split('.').filter(Boolean);
  if (labels.length < 2) return null;
  const last = labels[labels.length - 1] ?? '';
  const second = labels[labels.length - 2] ?? '';
  if (last.length === 2 && SECOND_LEVEL.has(second) && labels.length >= 3) {
    return labels.slice(-3).join('.');
  }
  return labels.slice(-2).join('.');
}

/** Domínios que nunca são concorrentes (redes, buscadores, diretórios, marketplaces, portais). */
const NOT_COMPETITORS = new Set([
  'google.com',
  'google.com.br',
  'facebook.com',
  'instagram.com',
  'linkedin.com',
  'youtube.com',
  'tiktok.com',
  'twitter.com',
  'x.com',
  'threads.net',
  'pinterest.com',
  'kwai.com',
  'whatsapp.com',
  'wa.me',
  'linktr.ee',
  'wikipedia.org',
  'reclameaqui.com.br',
  'mercadolivre.com.br',
  'olx.com.br',
  'shopee.com.br',
  'amazon.com.br',
  'magazineluiza.com.br',
  'americanas.com.br',
  'ifood.com.br',
  'doctoralia.com.br',
  'boaconsulta.com',
  'guiamais.com.br',
  'apontador.com.br',
  'telelistas.net',
  'solutudo.com.br',
  'cnpj.biz',
  'econodata.com.br',
  'casadosdados.com.br',
  'cnpj.info',
  'cnpja.com',
  'consultas.plus',
  'jusbrasil.com.br',
  'gov.br',
  'tripadvisor.com.br',
  'tripadvisor.com',
  'booking.com',
  'yelp.com',
  'glassdoor.com.br',
  'indeed.com',
  'catho.com.br',
  'infojobs.com.br',
  'vagas.com.br',
  'waze.com',
  'uol.com.br',
  'globo.com',
  'g1.globo.com',
  'estadao.com.br',
  'folha.uol.com.br',
  'medium.com',
  'blogspot.com',
  'wordpress.com',
  'wixsite.com',
  'canva.site',
]);

export interface SearchHit {
  url: string;
  title: string;
  snippet: string;
}

export interface CompetitorCandidate extends SearchHit {
  ref: string;
  domain: string;
}

export function isNotCompetitorDomain(domain: string): boolean {
  if (NOT_COMPETITORS.has(domain)) return true;
  return /\.gov\.br$|\.jus\.br$|\.leg\.br$|\.mil\.br$/.test(domain);
}

/**
 * Um candidato por domínio registrável, fora da própria empresa e das exclusões, na ordem dos
 * resultados, até `max`. Referências `C1`… estáveis dentro da investigação.
 */
export function filterCompetitorCandidates(
  hits: readonly SearchHit[],
  options: { companyDomain: string | null; exclude?: readonly string[]; max?: number },
): CompetitorCandidate[] {
  const max = options.max ?? 8;
  const own = options.companyDomain ? registrableDomain(options.companyDomain) : null;
  const excluded = new Set(
    (options.exclude ?? []).map((domain) => registrableDomain(domain)).filter(Boolean),
  );
  const seen = new Set<string>();
  const result: CompetitorCandidate[] = [];
  for (const hit of hits) {
    if (result.length >= max) break;
    let url: URL;
    try {
      url = new URL(hit.url);
    } catch {
      continue;
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') continue;
    const domain = registrableDomain(url.hostname);
    if (!domain || domain === own || excluded.has(domain) || seen.has(domain)) continue;
    if (isNotCompetitorDomain(domain)) continue;
    seen.add(domain);
    result.push({ ...hit, ref: `C${result.length + 1}`, domain });
  }
  return result;
}

function clean(text: string): string {
  return text.replace(/["“”]/g, '').replace(/\s+/g, ' ').trim().slice(0, 80);
}

/**
 * Consulta de concorrentes: o que a empresa faz (oferta principal ou descrição do CNAE) e onde
 * atende. Sem nome de pessoas, sem dados da empresa além do necessário para achar pares.
 */
export function competitorSearchQuery(input: {
  offering: string | null;
  activity: string | null;
  city: string | null;
  uf: string | null;
}): string | null {
  const what = clean(input.offering ?? input.activity ?? '');
  if (what.length < 3) return null;
  const where = [input.city, input.uf].filter(Boolean).join(' ');
  return where ? `${what} em ${where}` : what;
}
