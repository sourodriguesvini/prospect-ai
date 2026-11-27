/**
 * Candidatos a concorrente a partir dos resultados de pesquisa (§8 da especificação). O filtro
 * aqui é determinístico: tira o próprio site, redes sociais, diretórios, marketplaces, portais e
 * repetições do mesmo domínio. Quem é concorrente direto, referência ou não é concorrente é a
 * triagem da IA, sempre sobre estes candidatos e citando o resultado (`C1`…).
 */

import { looksLikeSlogan } from './consistency';

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
export function siteRegistrableDomain(hostOrUrl: string): string | null {
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
  const own = options.companyDomain ? siteRegistrableDomain(options.companyDomain) : null;
  const excluded = new Set(
    (options.exclude ?? []).map((domain) => siteRegistrableDomain(domain)).filter(Boolean),
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
    const domain = siteRegistrableDomain(url.hostname);
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

function foldText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const PLACE_PREPOSITIONS = new Set(['em', 'de', 'do', 'da', 'no', 'na', 'para']);

/** Pedaços de título que não dizem o ramo ("Home | Empresa", "Site oficial"). */
const TITLE_FILLER =
  /^(home|inicio|pagina inicial|bem vindo|bem vinda|bem vindos|site oficial|oficial|loja oficial|loja virtual|loja online|blog|contato|sobre|sobre nos|quem somos)$/;
/**
 * Título que não é da página inicial de verdade: campanha ("Ofertas imperdíveis de Black
 * Friday"), página de erro, manutenção ou desafio anti-robô ("Just a moment..."), ou nome de rede
 * social (o link aberto era o perfil). Com ele, a consulta sairia sem concorrente.
 */
const TITLE_NOISE =
  /\b(ofertas?|imperdive\w*|black friday|promoc\w*|liquidac\w*|descontos?|cupo(m|ns)|just a moment|attention required|access denied|forbidden|not found|erro|error|40[0-9]|50[0-9]|manutenc\w*|em construc\w*|pagina nao encontrada|indisponive\w*|whatsapp|instagram|facebook|linkedin|tiktok|youtube|twitter|pinterest|captcha|verificacao|cloudflare)\b/;

/**
 * O ramo como o título da página inicial o apresenta ("Pet Shop Online | Hiperzoo – Rações…" →
 * "Pet Shop Online"): o primeiro pedaço do título que não é o nome da empresa, o domínio nem
 * palavra de navegação, sem a cidade no fim. null quando nenhum pedaço serve.
 */
export function segmentFromTitle(
  title: string | null,
  company: { name: string; domain: string | null; city: string | null },
): string | null {
  if (!title || TITLE_NOISE.test(foldText(title))) return null;
  const name = foldText(company.name).replace(/\s+/g, '');
  const label = company.domain
    ? (siteRegistrableDomain(company.domain)?.split('.')[0] ?? '').replace(/[^a-z0-9]/g, '')
    : '';
  const city = company.city ? foldText(company.city) : '';
  for (const part of title.split(/\s+[|–—•·:]\s+|\s+-\s+|\s*[|–—•·]\s*/)) {
    let text = part.replace(/\s+/g, ' ').trim();
    if (city) {
      // "Odontologia em Curitiba" → "Odontologia" (a cidade entra na consulta à parte).
      const words = text.split(' ');
      const size = city.split(' ').length;
      const tail = words.slice(-size).map(foldText).join(' ');
      const preposition = foldText(words[words.length - size - 1] ?? '');
      if (words.length > size + 1 && tail === city && PLACE_PREPOSITIONS.has(preposition)) {
        text = words.slice(0, -(size + 1)).join(' ');
      }
    }
    const folded = foldText(text);
    const compact = folded.replace(/\s+/g, '');
    if (folded.length < 3 || folded.length > 60 || TITLE_FILLER.test(folded)) continue;
    if (name && (compact.includes(name) || name.includes(compact))) continue;
    if (label && (compact.includes(label) || label.includes(compact))) continue;
    if (city && folded === city) continue;
    // Slogan não é ramo ("Seu pet merece o melhor!"): a consulta sairia sem concorrente nenhum.
    if (looksLikeSlogan(text)) continue;
    return text;
  }
  return null;
}

/**
 * Consultas de concorrentes, da melhor para a pior, sem repetir (até `max`): o ramo que o próprio
 * site declara (`segment`, lido pela IA com trecho conferido), a atividade do CNAE, o ramo do
 * título da página inicial (heurística: só quando não há CNAE ou como segunda tentativa) e, por
 * último, a oferta principal. Produto sozinho ("rações em Curitiba PR") é consulta de compra: volta
 * loja virtual e marketplace, que o filtro tira, e a rede de pet shops da investigação real de
 * 2026-11-24 ficou sem nenhum candidato (KI-152). A segunda consulta só roda quando a primeira não
 * deixa candidato (custa mais um crédito).
 */
export function competitorSearchQueries(input: {
  segment?: string | null;
  titleSegment?: string | null;
  activity: string | null;
  offering: string | null;
  city: string | null;
  uf: string | null;
  max?: number;
}): string[] {
  const where = [input.city, input.uf].filter(Boolean).join(' ');
  const seen = new Set<string>();
  const queries: string[] = [];
  for (const term of [input.segment, input.activity, input.titleSegment, input.offering]) {
    const what = clean(term ?? '');
    if (what.length < 3) continue;
    const key = foldText(what);
    if (seen.has(key)) continue;
    seen.add(key);
    queries.push(where ? `${what} em ${where}` : what);
    if (queries.length >= (input.max ?? 2)) break;
  }
  return queries;
}
