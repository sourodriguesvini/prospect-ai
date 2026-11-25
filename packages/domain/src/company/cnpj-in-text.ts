import {
  COMPANY_CNPJ_KEY,
  isValidCnpj,
  normalizeCnpj,
  type CompanyCnpjOrigin,
} from '@prospector/contracts';
import {
  nameFoundIn,
  nameMatchesHost,
  normalizeCompanyName,
  sameCompanyNameAt,
  stripAccents,
} from '../discovery/names';

/**
 * CNPJ publicado no site da empresa (KI-152, item 5): achar no texto das páginas, separar o que é
 * de outra empresa (quem fez o site, a hospedagem, o meio de pagamento, o marketplace) e conferir
 * se o nome no cadastro da Receita é o da empresa investigada. Puro: o texto e o cadastro chegam
 * por parâmetro.
 */

export interface CnpjMention {
  /** 14 posições normalizadas (aceita o CNPJ com letras). */
  cnpj: string;
  /** O trecho exato da página ("CNPJ: 12.345.678/0001-95"), para citar como evidência. */
  quote: string;
  /**
   * Todas as vezes em que apareceu estavam junto de "desenvolvido por", "hospedagem",
   * "pagamento", "marketplace"…: é de outra empresa, não da dona do site.
   */
  thirdParty: boolean;
}

/** Com pontuação completa, em qualquer lugar do texto (o formato só existe para CNPJ). */
const MASKED =
  /(?<![0-9A-Za-z])[0-9A-Z]{2} ?\. ?[0-9A-Z]{3} ?\. ?[0-9A-Z]{3} ?\/ ?[0-9A-Z]{4} ?[-–] ?\d{2}(?![0-9A-Za-z])/g;

/**
 * Sem a pontuação completa, só logo depois do rótulo ("CNPJ 12345678000195", "C.N.P.J./MF nº
 * 12.345.678/000195"): catorze posições soltas podem ser telefone, código de barras ou pedido.
 */
const LABELED =
  /\bC\.?N\.?P\.?J\.?(?:\s*\/\s*MF)?(?:[\s:.#º°ª–-]|n[º°o]\.?){0,8}([0-9A-Z]{14}|\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2})(?![0-9A-Za-z])/gi;

/**
 * Indícios de que o CNPJ logo depois é de outra empresa. Só o começo da mesma linha conta: o
 * rodapé costuma listar as formas de pagamento numa linha e o CNPJ da loja na seguinte.
 */
const THIRD_PARTY =
  /(desenvolvid|desenvolvimento|criad[oa] por|criacao de sites?|site (?:feito )?por|feito por|produzido por|agencia|hospedagem|hospedado|powered by|plataforma|intermedia|pagamento|pagseguro|mercado ?pago|marketplace|vendido (?:e entregue )?por|entregue por|parceir)/;

const CONTEXT_CHARS = 60;

function lineBefore(text: string, index: number): string {
  const start = Math.max(0, index - CONTEXT_CHARS);
  const before = text.slice(start, index);
  const lastBreak = before.lastIndexOf('\n');
  return stripAccents(lastBreak >= 0 ? before.slice(lastBreak + 1) : before).toLowerCase();
}

/** O rótulo "CNPJ" logo antes de um número com pontuação, para o trecho citado ficar completo. */
function withLabel(text: string, index: number): number {
  const before = text.slice(Math.max(0, index - 16), index);
  const label = /C\.?N\.?P\.?J\.?(?:\s*\/\s*MF)?(?:[\s:.#º°ª–-]|n[º°o]\.?){0,8}$/i.exec(before);
  return label ? index - label[0].length : index;
}

/**
 * CNPJs válidos (dígitos verificadores conferidos) no texto, na ordem em que aparecem, sem
 * repetir. O mesmo CNPJ visto duas vezes só é de terceiro se as duas vezes forem.
 */
export function findCnpjsInText(text: string): CnpjMention[] {
  const found = new Map<string, CnpjMention & { at: number }>();
  /** `quoteStart`: começo do trecho citado (o rótulo, quando há). */
  const consider = (raw: string, quoteStart: number, end: number) => {
    const cnpj = normalizeCnpj(raw.replace(/–/g, '-'));
    if (!isValidCnpj(cnpj)) return;
    const quote = text.slice(quoteStart, end).trim();
    const thirdParty = THIRD_PARTY.test(lineBefore(text, quoteStart));
    const previous = found.get(cnpj);
    if (!previous) {
      found.set(cnpj, { cnpj, quote, thirdParty, at: quoteStart });
    } else if (previous.thirdParty && !thirdParty) {
      found.set(cnpj, { cnpj, quote, thirdParty: false, at: previous.at });
    }
  };
  for (const match of text.matchAll(MASKED)) {
    consider(match[0], withLabel(text, match.index), match.index + match[0].length);
  }
  for (const match of text.matchAll(LABELED)) {
    consider(match[1] ?? '', match.index, match.index + match[0].length);
  }
  return [...found.values()]
    .sort((a, b) => a.at - b.at)
    .map(({ cnpj, quote, thirdParty }) => ({ cnpj, quote, thirdParty }));
}

// -----------------------------------------------------------------------------
// Conferência do nome
// -----------------------------------------------------------------------------

export interface CnpjNameCheckCompany {
  displayName: string;
  city: string | null;
  uf: string | null;
  primaryDomain: string | null;
}

export interface CnpjNameCheckRecord {
  legalName: string;
  tradeName: string | null;
}

function compact(name: string): string {
  return normalizeCompanyName(name).replace(/ /g, '');
}

/** Primeira parte do domínio ("hiperzoo" de hiperzoo.com.br). */
function hostLabel(domain: string): string {
  return (
    domain
      .toLowerCase()
      .replace(/^www\./, '')
      .split('.')[0] ?? ''
  ).replace(/-/g, '');
}

/**
 * O cadastro da Receita é desta empresa? Vale o nome fantasia ou a razão social: mesmo nome (com
 * a cidade ou palavras do ramo a mais), o nome da empresa dentro do da Receita ("HiperZoo" em
 * "HIPERZOO COMÉRCIO DE RAÇÕES LTDA"), o mesmo nome escrito junto ("Hiper Zoo" × "HIPERZOO") ou o
 * nome da Receita no endereço do site. Na dúvida, não: quem fez o site, a hospedagem ou outra
 * empresa do grupo ficam de fora.
 */
export function registryNameMatches(
  company: CnpjNameCheckCompany,
  record: CnpjNameCheckRecord,
): boolean {
  const places = [company.city, company.uf];
  const names = [record.tradeName, record.legalName].filter(
    (name): name is string => typeof name === 'string' && name.trim() !== '',
  );
  const display = company.displayName;
  const displayCompact = compact(display);
  const displayWords = normalizeCompanyName(display).split(' ').filter(Boolean).length;
  const label = company.primaryDomain ? hostLabel(company.primaryDomain) : '';
  for (const name of names) {
    if (sameCompanyNameAt(display, name, places)) return true;
    if (nameFoundIn(display, name)) return true;
    if (displayWords >= 2 && displayCompact.length >= 6 && compact(name).includes(displayCompact)) {
      return true;
    }
    if (
      label.length >= 5 &&
      company.primaryDomain &&
      nameMatchesHost(name, company.primaryDomain)
    ) {
      return true;
    }
  }
  // Nome fantasia dentro do nome da empresa ("HIPERZOO" × "HiperZoo Pet Center").
  return record.tradeName !== null && nameFoundIn(record.tradeName, display);
}

// -----------------------------------------------------------------------------
// CNPJ vinculado por evidência
// -----------------------------------------------------------------------------

export interface LinkedCnpj {
  cnpj: string;
  origin: CompanyCnpjOrigin;
  /** Página do site onde o CNPJ apareceu (origem `company_site`). */
  url: string | null;
  claimId: string;
}

/**
 * CNPJ da empresa guardado como fato (`firmographic.cnpj`), quando a coluna do cadastro está
 * vazia: lido no site ou informado por você. Os claims chegam em vigor (sem substituídos nem
 * rejeitados), o mais recente primeiro.
 */
export function linkedCnpjFromClaims(
  claims: ReadonlyArray<{
    id: string;
    key: string;
    status?: string;
    value: Record<string, unknown> | null;
  }>,
): LinkedCnpj | null {
  for (const claim of claims) {
    if (claim.key !== COMPANY_CNPJ_KEY) continue;
    if (claim.status === 'superseded' || claim.status === 'rejected') continue;
    const raw = claim.value?.cnpj;
    if (typeof raw !== 'string' || !isValidCnpj(raw)) continue;
    const origin = claim.value?.origin === 'company_site' ? 'company_site' : 'user';
    const url = typeof claim.value?.url === 'string' ? claim.value.url : null;
    return { cnpj: normalizeCnpj(raw), origin, url, claimId: claim.id };
  }
  return null;
}
