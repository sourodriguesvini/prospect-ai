import {
  RESEARCH_AUDIENCE_LABELS,
  RESEARCH_SEGMENT_LABELS,
  webHostRestriction,
  type ResearchAudienceRole,
  type ResearchCriteria,
  type ResearchDiscardReason,
  type ResearchLocationBasis,
  type ResearchSegment,
  type ResearchSourceKind,
  type UF,
} from '@prospector/contracts';
import { fold } from '../commercial/text';
import { hostCategory, hostOf as siteHostOf, siteKey } from '../discovery/hosts';
import { KNOWN_CITIES, hasFoldedWord, isUf } from './regions';

/**
 * Extração por regra do que um resultado de busca traz (Parte 6.5), só com o que está escrito no
 * título e no trecho do buscador: nada de abrir a página de diretório (KI-219), deduzir e-mail ou
 * completar dado. O nome da pessoa tem de estar no trecho guardado (o banco confere).
 */

/** Diretórios profissionais: a fonte é o trecho da busca, nunca a página (KI-219). */
export const PROFESSIONAL_DIRECTORY_HOSTS: readonly string[] = [
  'doctoralia.com.br',
  'boaconsulta.com',
  'drconsulta.com',
  'zenklub.com.br',
  'psicologosberrini.com.br',
  'encontreumterapeuta.com.br',
  'guiamedico.com.br',
];

/**
 * Agregadores de dados de pessoas e de empresas (processos, sócios, CNPJ) e redes: nem a pessoa nem
 * a organização entram por eles (revisão de conformidade de 26/11, D9). Os diretórios de
 * profissionais acima continuam valendo.
 */
export const PEOPLE_AGGREGATOR_HOSTS: readonly string[] = [
  'escavador.com',
  'jusbrasil.com.br',
  'consultasocio.com',
  'cnpj.biz',
  'cnpja.com',
  'cnpj.info',
  'casadosdados.com.br',
  'empresascnpj.com',
  'econodata.com.br',
  'informecadastral.com.br',
  'speedio.com.br',
  'opencnpj.org',
  'minhareceita.org',
  'brasilapi.com.br',
  'portaldasempresas.com',
  'reclameaqui.com.br',
];

/** Caixas de e-mail gratuitas: canal pessoal, não serve para contato frio (KI-221). */
const FREE_MAIL =
  /@(gmail|googlemail|hotmail|outlook|live|msn|yahoo|ymail|bol|uol|icloud|me|mac|aol|terra|ig|globo|r7|oi|zipmail|proton|protonmail)\.(com|com\.br|me|ch)$/;

const ORG_MARKER =
  /(^|[^a-z])(clinica|consultorio|centro|espaco|instituto|nucleo|associacao|reabilitacao|reabilita|conselho)([^a-z]|$)/;
/** Marcadores de atendimento individual: "Consultório Ana Silva" é a pessoa, não uma organização. */
const INDIVIDUAL_PRACTICE = /^(consultorio|espaco|atelie|studio|estudio)\s+/;
const INFLUENCER_ORG = /(^|[^a-z])(associacao|conselho|crefito|universidade|faculdade)([^a-z]|$)/;
const LISTING =
  /(^|[^a-z])(melhores|encontre|lista de|top \d|os \d|as \d|\d{1,4} (terapeutas|profissionais|clinicas)|agende|marque)([^a-z]|$)/;
/** Cargo de gestão, palavra inteira (nem "diretório", nem "psicossocial", nem "associação"). */
const MANAGER =
  /(^|[^a-z])(coordenador(a)?|gestor(a)?|diretor(a)?|soci[oa]|proprietari[oa]|fundador(a)?|responsavel tecnic[oa])([^a-z]|$)/;
const TEACHER = /(^|[^a-z])(professor(a)?|docente|pesquisador(a)?)([^a-z]|$)/;
/** E-mail e telefone no texto (para tirar do trecho guardado e conferir canal pessoal). */
const EMAIL = /[a-z0-9._%+-]{1,64}@[a-z0-9-]{1,63}(?:\.[a-z0-9-]{1,63}){0,4}\.[a-z]{2,}/gi;
const PHONE = /(?:\+?55\s?)?\(?\b\d{2}\)?\s?9?\d{4}[-\s.]?\d{4}\b/g;
/** Tamanho máximo lido do título e do trecho (a borda da busca já corta; o domínio não depende dela). */
const MAX_TITLE = 300;
const MAX_SNIPPET = 1200;

/** Palavras que nunca fazem parte de um nome de pessoa num título. */
const NOT_NAME = new Set(
  [
    'terapia',
    'terapeuta',
    'terapeutas',
    'ocupacional',
    'ocupacionais',
    'clinica',
    'clinicas',
    'centro',
    'consultorio',
    'espaco',
    'instituto',
    'nucleo',
    'atendimento',
    'agende',
    'agendar',
    'consulta',
    'consultas',
    'perfil',
    'avaliacoes',
    'opinioes',
    'home',
    'inicio',
    'contato',
    'sobre',
    'servicos',
    'blog',
    'melhores',
    'encontre',
    'profissionais',
    'profissional',
    'especialista',
    'especialistas',
    'fonoaudiologo',
    'fonoaudiologa',
    'fonoaudiologia',
    'psicologo',
    'psicologa',
    'psicologia',
    'fisioterapeuta',
    'fisioterapia',
    'psicopedagogo',
    'psicopedagoga',
    'nutricionista',
    'infantil',
    'adulto',
    'autismo',
    'tea',
    'integracao',
    'sensorial',
    'reabilitacao',
    'saude',
    'brasil',
    'doctoralia',
  ].map((word) => word),
);
const CONNECTORS = new Set(['da', 'de', 'do', 'das', 'dos', 'e']);

export interface ResearchHit {
  readonly url: string;
  readonly title: string;
  readonly snippet: string;
  /** Consulta que trouxe o resultado (região usada quando o trecho não diz o local). */
  readonly query: { readonly index: number; readonly uf: UF | null; readonly city: string | null };
}

export interface ExtractedCandidate {
  readonly kind: 'person' | 'organization';
  readonly name: string;
  readonly profession: string | null;
  readonly roleTitle: string | null;
  readonly organization: string | null;
  readonly city: string | null;
  readonly uf: UF | null;
  readonly locationBasis: ResearchLocationBasis;
  /** Organização: o site próprio (nunca diretório nem rede social). */
  readonly website: string | null;
  /** E-mail literal no trecho; para pessoa, só caixa profissional (não gratuita). */
  readonly email: string | null;
  /** Telefone literal no trecho; só de organização (o de pessoa costuma ser o celular). */
  readonly phone: string | null;
  readonly sourceUrl: string;
  readonly sourceHost: string;
  readonly sourceKind: ResearchSourceKind;
  /** Até 300 caracteres do título e do trecho, com o nome dentro. */
  readonly sourceQuote: string;
  readonly segment: ResearchSegment;
  readonly audienceRole: ResearchAudienceRole;
  readonly fitReason: string;
  /** Texto da identidade (o servidor guarda só o HMAC): nome + UF + profissão ou organização. */
  readonly identity: string;
  /**
   * Variações mais largas da identidade (sem a UF da busca, sem a organização): uma supressão
   * gravada por qualquer uma delas vale (revisão de conformidade de 26/11, D3).
   */
  readonly identityVariants: readonly string[];
  /** Algum canal pessoal foi visto no trecho e descartado (KI-221). */
  readonly personalChannelDropped: boolean;
  /** Termo do texto que definiu o papel ("coordenadora"), para a tela dizer que é regra. */
  readonly roleBasis: string | null;
}

/** Descartes decididos aqui (os outros motivos vêm do serviço: repetido, suprimido...). */
export type DiscardReason = Extract<
  ResearchDiscardReason,
  'restricted_host' | 'listing' | 'no_profession' | 'no_name' | 'out_of_region'
>;

export interface Extraction {
  readonly candidates: ExtractedCandidate[];
  readonly discarded: DiscardReason | null;
}

function hostOf(url: string): string {
  return siteHostOf(url) ?? '';
}

function hostIn(host: string, list: readonly string[]): boolean {
  return list.some((domain) => host === domain || host.endsWith(`.${domain}`));
}

function clean(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** Segmentos do título ("Nome - Terapeuta Ocupacional - Cidade | Site"). */
function segmentsOf(title: string): string[] {
  return title
    .split(/\s+[-–—|•:]\s+|\s*\|\s*/)
    .map((part) => clean(part))
    .filter(Boolean);
}

const NAME_WORD = /^[A-ZÀ-Ý][a-zà-ÿ'’-]+$|^[A-ZÀ-Ý]{2,}$/;

/** Nome de pessoa num segmento do título; null se não parece um nome. */
export function personNameIn(segment: string): string | null {
  const stripped = segment
    .replace(/^(dra?\.?|t\.?o\.?|to|ft\.?|fga?\.?|psic\.?)\s+/i, '')
    .replace(/[,;.]+$/, '')
    .trim();
  if (stripped.length < 5 || stripped.length > 80 || /\d/.test(stripped)) return null;
  const words = stripped.split(/\s+/);
  if (words.length < 2 || words.length > 6) return null;
  const first = words[0] ?? '';
  const last = words[words.length - 1] ?? '';
  if (!NAME_WORD.test(first) || !NAME_WORD.test(last)) return null;
  for (const word of words) {
    const folded = fold(word);
    if (NOT_NAME.has(folded)) return null;
    if (CONNECTORS.has(folded)) continue;
    if (!NAME_WORD.test(word)) return null;
  }
  // Um nome todo em maiúsculas vira "Nome Sobrenome" (o trecho guardado mantém o original).
  return stripped;
}

function orgNameIn(segment: string): string | null {
  const folded = fold(segment);
  if (!ORG_MARKER.test(folded) || LISTING.test(folded)) return null;
  const name = clean(segment).replace(/[,;.]+$/, '');
  if (name.length < 4 || name.length > 160 || name.split(/\s+/).length < 2) return null;
  return name;
}

/**
 * Cidade e UF escritas no texto ("Campinas - SP", "Belo Horizonte/MG", capital conhecida). "TO"
 * é terapia ocupacional (Tocantins só pelo nome da cidade), e um nome de pessoa nunca vira cidade
 * ("Dra. Ana Silva - SP": UF SP, cidade não informada).
 */
export function locationIn(
  text: string,
  notCity: readonly string[] = [],
): { city: string | null; uf: UF } | null {
  const pattern =
    /([A-ZÀ-Ý][a-zà-ÿ'’.-]+(?:\s(?:d[aeo]s?\s)?[A-ZÀ-Ý][a-zà-ÿ'’.-]+){0,3})\s*(?:-|–|\/|,)\s*([A-Z]{2})(?![A-Za-z])/g;
  const excluded = notCity.map((name) => fold(name)).filter(Boolean);
  for (const match of text.matchAll(pattern)) {
    const uf = match[2] ?? '';
    if (!isUf(uf) || uf === 'TO') continue;
    const city = clean(match[1] ?? '');
    const folded = fold(city);
    const isName =
      /^dra?\.?(\s|$)/.test(folded) ||
      excluded.some((name) => folded.includes(name) || name.includes(folded));
    return { city: isName ? null : city || null, uf };
  }
  const folded = fold(text);
  for (const { city, uf } of KNOWN_CITIES) {
    if (hasFoldedWord(folded, fold(city))) return { city, uf };
  }
  return null;
}

/** Onde há e-mail ou telefone no texto (início e fim). */
function contactSpans(text: string): Array<[number, number]> {
  return [...text.matchAll(EMAIL), ...text.matchAll(PHONE)].map((match) => [
    match.index ?? 0,
    (match.index ?? 0) + match[0].length,
  ]);
}

/**
 * Até 300 caracteres em volta do nome, sem nenhum e-mail ou telefone dentro: o trecho guardado
 * prova de onde veio o nome, não carrega canal de contato (revisão de conformidade, D1).
 */
export function quoteAround(full: string, name: string): string | null {
  const at = full.toLowerCase().indexOf(name.toLowerCase());
  if (at < 0) return null;
  const end = at + name.length;
  let lower = 0;
  let upper = full.length;
  for (const [from, to] of contactSpans(full)) {
    if (to <= at) lower = Math.max(lower, to);
    else if (from >= end) upper = Math.min(upper, from);
    else return null; // o nome está colado no contato: melhor não guardar
  }
  const start = Math.max(lower, Math.min(at - 80, upper - 300));
  const quote = full
    .slice(start, Math.min(upper, start + 300))
    .replace(/^[\s,;:.—–-]+|[\s,;:(—–-]+$/g, '')
    .trim();
  return quote.toLowerCase().includes(name.toLowerCase()) ? quote : null;
}

function emailIn(text: string): { email: string; personal: boolean } | null {
  const match = new RegExp(EMAIL.source, 'i').exec(text);
  if (!match) return null;
  const email = match[0].toLowerCase().replace(/\.$/, '');
  if (email.length < 6 || email.length > 254) return null;
  return { email, personal: FREE_MAIL.test(email) };
}

/**
 * Telefone literal no trecho, escrito como "31 3333-4444" (DDD e número, sem parênteses). Celular
 * (9 dígitos depois do DDD) é canal pessoal (KI-221): sai marcado.
 */
function phoneIn(text: string): { phone: string; mobile: boolean } | null {
  const match = new RegExp(PHONE.source).exec(text);
  if (!match) return null;
  const digits = match[0].replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '');
  if (digits.length < 10 || digits.length > 11) return null;
  const number = digits.slice(2);
  return {
    phone: `${digits.slice(0, 2)} ${number.slice(0, -4)}-${number.slice(-4)}`,
    mobile: number.length === 9,
  };
}

/** "Consultório Dra. Ana Silva", "Espaço Ana Silva": o nome da pessoa dentro do nome do lugar. */
function personInPracticeName(orgName: string): string | null {
  const folded = fold(orgName);
  const marker = INDIVIDUAL_PRACTICE.exec(folded);
  const rest = marker ? orgName.slice(marker[0].length) : orgName;
  const titled = /(^|\s)dra?\.?\s+[A-ZÀ-Ý]/i.exec(rest);
  if (!marker && !titled) return null;
  return personNameIn(
    titled ? rest.slice(titled.index).trim() : rest.replace(/^(d[aeo]s?)\s+/i, ''),
  );
}

/**
 * Identidade da pessoa (texto, o servidor guarda o HMAC) e variações mais largas: sem a UF (que
 * pode vir da busca) e sem a organização (que pode faltar no título). A principal não muda: é a
 * chave das linhas já gravadas.
 */
export function personIdentities(person: {
  name: string;
  uf: UF | null;
  organization: string | null;
  profession: string | null;
}): { identity: string; variants: string[] } {
  const name = fold(person.name);
  const profession = fold(person.profession ?? '');
  const identity = `${name}|${person.uf ?? ''}|${fold(person.organization ?? person.profession ?? '')}`;
  const variants = [`${name}||${profession}`, `${name}|${person.uf ?? ''}|${profession}`].filter(
    (variant, index, all) => variant !== identity && all.indexOf(variant) === index,
  );
  return { identity, variants };
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Por que entrou na lista, pela regra do perfil (nunca pelo modelo). */
export function fitReasonFor(
  profileName: string,
  profession: string,
  segment: ResearchSegment,
  role: ResearchAudienceRole,
  basis: string | null = null,
): string {
  const who = RESEARCH_SEGMENT_LABELS[segment];
  const roleLabel = RESEARCH_AUDIENCE_LABELS[role].toLowerCase();
  const rule = basis ? ` Por regra: "${basis}" no texto da fonte.` : '';
  const why: Record<ResearchSegment, string> = {
    independent_professional: `atende como ${profession} e costuma escolher as próprias ferramentas; orçamento a confirmar`,
    clinic: `organização de ${profession}: quem usa é a equipe, quem compra é o gestor`,
    manager: `cargo de gestão: costuma decidir a compra para a equipe`,
    employed_professional: `${profession} numa organização: usa no dia a dia e pode indicar, mas não compra`,
    organization: `organização ligada a ${profession}: pode indicar ou divulgar`,
    unknown: `${profession}; papel a conferir`,
  };
  return `${who} (${roleLabel} para ${profileName}): ${why[segment]}.${rule}`.slice(0, 300);
}

function mentionsProfession(foldedText: string, criteria: ResearchCriteria): boolean {
  return [criteria.profession, ...criteria.terms].some((term) =>
    foldedText.includes(fold(term).replace(/^clinica de /, '')),
  );
}

/**
 * O que um resultado de busca traz, por regra. Uma pessoa e/ou uma organização por resultado; a
 * maioria dos resultados não traz nenhuma (listas, diretórios sem nome, outros assuntos).
 */
export function extractCandidates(
  hit: ResearchHit,
  criteria: ResearchCriteria,
  profileName: string,
): Extraction {
  const host = hostOf(hit.url);
  if (
    !host ||
    webHostRestriction(host) !== null ||
    hostCategory(host) === 'social' ||
    hostIn(host, PEOPLE_AGGREGATOR_HOSTS)
  ) {
    return { candidates: [], discarded: 'restricted_host' };
  }
  const title = clean(hit.title.slice(0, MAX_TITLE));
  const snippet = clean(hit.snippet.slice(0, MAX_SNIPPET));
  const full = clean(`${title} — ${snippet}`);
  const folded = fold(full);
  if (!mentionsProfession(folded, criteria)) return { candidates: [], discarded: 'no_profession' };
  if (LISTING.test(fold(title))) return { candidates: [], discarded: 'listing' };

  const directory = hostIn(host, PROFESSIONAL_DIRECTORY_HOSTS);
  const sourceKind: ResearchSourceKind = directory ? 'professional_directory' : 'search_result';
  const segments = segmentsOf(title);
  let personName = criteria.entityKinds.includes('person')
    ? (segments.map(personNameIn).find((name): name is string => Boolean(name)) ?? null)
    : null;
  let orgName = segments.map(orgNameIn).find((name): name is string => Boolean(name)) ?? null;
  // Consultório ou espaço com nome de pessoa é a pessoa: os dados dela vão para `people` (LIA,
  // HMAC, supressão), nunca para um item de "organização" (revisão de conformidade, B1).
  const practice = orgName ? personInPracticeName(orgName) : null;
  if (practice) {
    personName = criteria.entityKinds.includes('person') ? (personName ?? practice) : null;
    orgName = null;
  }

  const written = locationIn(full, [personName ?? '', orgName ?? ''].filter(Boolean));
  const location = written
    ? written.city
      ? { city: written.city, uf: written.uf, basis: 'quote' as const }
      : {
          city: hit.query.uf === written.uf ? hit.query.city : null,
          uf: written.uf,
          basis: 'quote' as const,
        }
    : hit.query.uf
      ? { city: hit.query.city, uf: hit.query.uf, basis: 'query' as const }
      : { city: null, uf: null, basis: 'none' as const };
  if (criteria.ufs.length > 0 && location.uf && !criteria.ufs.includes(location.uf)) {
    return { candidates: [], discarded: 'out_of_region' };
  }

  const email = emailIn(snippet);
  const phone = phoneIn(snippet);
  const profession = criteria.profession;
  const candidates: ExtractedCandidate[] = [];

  if (personName) {
    const quote = quoteAround(full, personName);
    if (quote) {
      // Cargo só perto do nome (o trecho guardado) ou nos segmentos do título que não são o lugar.
      const near = fold(`${segments.filter((part) => part !== orgName).join(' ')} ${quote}`);
      const manager = MANAGER.exec(near);
      const teacher = TEACHER.exec(near);
      const segment: ResearchSegment = manager
        ? 'manager'
        : teacher || orgName
          ? 'employed_professional'
          : 'independent_professional';
      const audienceRole: ResearchAudienceRole = manager
        ? 'buyer'
        : teacher
          ? 'influencer'
          : 'user';
      const roleBasis = manager?.[2] ?? teacher?.[2] ?? null;
      const roleTitle = manager ? capitalize(originalWord(full, manager[2] ?? '')) : null;
      const workEmail = email && !email.personal ? email.email : null;
      const { identity, variants } = personIdentities({
        name: personName,
        uf: location.uf,
        organization: orgName,
        profession,
      });
      candidates.push({
        kind: 'person',
        name: personName,
        profession,
        roleTitle,
        organization: orgName,
        city: location.city,
        uf: location.uf,
        locationBasis: location.basis,
        website: null,
        email: workEmail,
        phone: null,
        sourceUrl: hit.url,
        sourceHost: host,
        sourceKind,
        sourceQuote: quote,
        segment,
        audienceRole,
        fitReason: fitReasonFor(profileName, profession, segment, audienceRole, roleBasis),
        identity,
        identityVariants: variants,
        personalChannelDropped: Boolean((email && email.personal) || phone),
        roleBasis,
      });
    }
  }

  if (orgName && criteria.entityKinds.includes('organization')) {
    const quote = quoteAround(full, orgName);
    if (quote) {
      const influencer = INFLUENCER_ORG.test(fold(orgName));
      const segment: ResearchSegment = influencer ? 'organization' : 'clinic';
      const audienceRole: ResearchAudienceRole = influencer ? 'influencer' : 'buyer';
      // Canal da organização só quando é dela: com uma pessoa no mesmo resultado, o contato
      // costuma ser da pessoa; caixa gratuita e celular são canal pessoal (B1, KI-221).
      const withPerson = personName !== null;
      const orgEmail = !withPerson && email && !email.personal ? email.email : null;
      const orgPhone = !withPerson && phone && !phone.mobile ? phone.phone : null;
      candidates.push({
        kind: 'organization',
        name: orgName,
        profession,
        roleTitle: null,
        organization: null,
        city: location.city,
        uf: location.uf,
        locationBasis: location.basis,
        // Só o site próprio: portal, guia, rede ou hospedagem compartilhada sem chave não contam.
        website: !directory && siteKey(hit.url) !== null ? `https://${host}` : null,
        email: orgEmail,
        phone: orgPhone,
        sourceUrl: hit.url,
        sourceHost: host,
        sourceKind,
        sourceQuote: quote,
        segment,
        audienceRole,
        fitReason: fitReasonFor(profileName, profession, segment, audienceRole),
        identity: `org|${fold(orgName)}|${location.uf ?? ''}`,
        identityVariants: [],
        personalChannelDropped: Boolean(
          (email && email.email !== orgEmail) || (phone && phone.phone !== orgPhone),
        ),
        roleBasis: null,
      });
    }
  }
  if (candidates.length === 0) return { candidates, discarded: 'no_name' };
  return { candidates, discarded: null };
}

/** A palavra como está escrita no texto (com acento), achada pela forma sem acento. */
function originalWord(text: string, foldedWord: string): string {
  if (!foldedWord) return '';
  const words = text.match(/[A-Za-zÀ-ÿ]+/g) ?? [];
  return words.find((word) => fold(word) === foldedWord) ?? foldedWord;
}
