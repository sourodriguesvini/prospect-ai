import type { DemandDetails, QuotedValue } from '@prospector/contracts';
import { foldWithMap, originalSlice, sentenceAround, type FoldedText } from './text';

/**
 * Demanda declarada (diretriz 2026-11-26, Parte 8, Caso 5): a empresa publicou que procura um
 * fornecedor ou profissional. Tudo por regra, com o trecho literal de cada campo: o que procura,
 * o prazo e por onde responder. O que a fonte não diz fica null; o canal só entra quando é da
 * empresa (área citada ou e-mail genérico do domínio dela), nunca o nome ou o e-mail de uma pessoa.
 * O trecho (`quote`) é a frase inteira e pode citar um e-mail pessoal ao lado; ele fica só na
 * evidência e nunca vira canal nem entra nos textos da tese.
 */

const PROVIDER =
  '(?:agencia|agencias|estudio|estudios|fornecedor(?:es)?|consultoria|escritorio|freelancer|freela|prestador(?:es)? de servicos?|empresa especializada|profissional (?:autonomo|freelancer|pj))';

/** "procura uma agência para…", "estamos contratando estúdio de…", "cotação de fornecedor…". */
const SEEKS = new RegExp(
  `\\b(?:procura(?:mos|ndo)?|busca(?:mos|ndo)?|seleciona(?:mos|ndo)?|contrata(?:mos|ndo|r)?|cotacao de|cotando)\\s+(?:uma?\\s+|nov[oa]s?\\s+)?(${PROVIDER}\\b[^.;!?\\n]{0,180})`,
);
/**
 * "concorrência para agências de…", "seleção de fornecedores…", "edital para contratação de
 * estúdio…": o tipo de fornecedor é obrigatório. Sem ele, "concorrência de bancos digitais",
 * "seleção de produtos", "chamada de vídeo" e "edital de concurso" viravam demanda (revisão de
 * 27/11).
 */
const CALL = new RegExp(
  `\\b(?:concorrencia para|(?:selecao|chamada|chamamento|edital) (?:para|de))\\s+(?:(?:a )?contratacao de\\s+)?(?:uma?\\s+)?(${PROVIDER}\\b[^.;!?\\n]{0,180})`,
);
/** "solicitação de propostas para…", "RFP de…": aqui o pedido já diz que é de fornecedor. */
const PROPOSALS = new RegExp(
  `\\b(?:solicitacao de propostas?|pedido de propostas?|rfp)\\s+(?:para|de)\\s+([^.;!?\\n]{3,180})`,
);

/** Detecção sobre texto dobrado (sem acento, minúsculo), usada pela lista de acontecimentos. */
export const EXPLICIT_DEMAND_PATTERN = new RegExp(
  `${SEEKS.source}|${CALL.source}|${PROPOSALS.source}`,
);

/** Onde a necessidade acaba: prazo, chamada para enviar, ou contato. */
const NEED_END =
  /\s(?:ate (?:o dia |dia )?\d|com prazo|prazo|interessad|envie|enviar|encaminhe|mande|contato\b|fal(?:e|ar) com|responsavel)/;

const MONTHS = [
  'janeiro',
  'fevereiro',
  'marco',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
];

const DEADLINE_NUMERIC =
  /\b(?:ate|prazo(?: final)?(?: para [a-z ]{3,30}?)?(?: e)?:?)\s+(?:o dia\s+|dia\s+)?(\d{1,2})\/(\d{1,2})(?:\/(\d{4}|\d{2}))?\b/;
const DEADLINE_WRITTEN = new RegExp(
  `\\b(?:ate|prazo(?: final)?(?: para [a-z ]{3,30}?)?(?: e)?:?)\\s+(?:o dia\\s+|dia\\s+)?(\\d{1,2}) de (${MONTHS.join('|')})(?: de (\\d{4}))?\\b`,
);

/** Áreas que recebem propostas de fornecedor (lista fechada; recrutamento fica de fora). */
const AREA_NAMES =
  '(?:compras|suprimentos|marketing|comunicacao|comercial|vendas|projetos|parcerias|licitacoes|licitacao|branding|marca|design|produto|produtos|tecnologia|ti|inovacao|operacoes|administrativo|financeiro|engenharia|expansao)';
const AREA = new RegExp(
  `\\b(?:enviar|envie|envia|encaminhe|encaminhar|mande|mandar)\\s+(?:a |as |sua |suas |o |os |seu |seus )?(?:proposta|propostas|portfolio|portfolios|orcamento|orcamentos|apresentacao|apresentacoes)\\s+(?:para|ao|a)\\s+(?:o |a )?((?:setor|area|departamento|time|equipe|diretoria|gerencia) de ${AREA_NAMES}(?: e ${AREA_NAMES})?)\\b`,
);

/**
 * E-mail de área (compras@, marketing@…) do domínio da empresa: o de uma pessoa nunca é guardado,
 * e o de outro domínio ("fale com a redação pelo contato@jornal…") não vira canal. Endereços de
 * recrutamento (rh@, vagas@…) ficam de fora: são de candidatos, não de fornecedores.
 */
const GENERIC_LOCAL =
  /^(?:contato|contatos|compras|suprimentos|marketing|mkt|comercial|vendas|propostas?|licitac(?:ao|oes)|projetos|parcerias|fornecedores|atendimento|faleconosco|fale-conosco|comunicacao|imprensa|financeiro|administrativo|adm|diretoria|sac|info|hello|ola|oi|orcamentos?)$/;
/** Com limites de tamanho e sem recomeçar no meio de um endereço: tempo linear (revisão de 27/11). */
const EMAIL = /(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,253}\.[A-Za-z]{2,24}/g;

/** O domínio do e-mail é o da empresa ou um subdomínio dele. */
function companyEmailDomain(email: string, companyDomains: readonly string[]): boolean {
  const domain = (email.split('@')[1] ?? '').toLowerCase().replace(/\.$/, '');
  return companyDomains.some((entry) => {
    const own = entry
      .toLowerCase()
      .replace(/^www\./, '')
      .replace(/\.$/, '');
    return own.length > 0 && (domain === own || domain.endsWith(`.${own}`));
  });
}

function quoted(text: string, base: FoldedText, start: number, end: number): QuotedValue | null {
  const value = originalSlice(text, base, start, end)
    .trim()
    .replace(/[\s,:;–-]+$/, '')
    .slice(0, 200);
  const quote = sentenceAround(text, base.map[start] ?? 0);
  return value && quote ? { text: value, quote } : null;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/** Dia e mês sem ano: o ano da publicação, ou o seguinte se a data já tinha passado nela. */
function deadlineDate(
  day: number,
  month: number,
  year: number | null,
  referenceDate: string | null,
): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  let full = year;
  if (full !== null && full < 100) full += 2000;
  if (full === null) {
    const ref = referenceDate ? /^(\d{4})-(\d{2})(?:-(\d{2}))?/.exec(referenceDate) : null;
    if (!ref) return null;
    full = Number(ref[1]);
    const refMonth = Number(ref[2]);
    const refDay = Number(ref[3] ?? '1');
    // Mais de dois meses antes da publicação: é do ano seguinte ("até 15/01" publicado em novembro).
    if (month * 31 + day < refMonth * 31 + refDay - 62) full += 1;
  }
  const date = new Date(Date.UTC(full, month - 1, day));
  if (date.getUTCMonth() !== month - 1) return null;
  return `${full}-${pad(month)}-${pad(day)}`;
}

function extractDeadline(
  text: string,
  base: FoldedText,
  referenceDate: string | null,
): { deadline: QuotedValue | null; deadlineOn: string | null } {
  const numeric = DEADLINE_NUMERIC.exec(base.folded);
  const written = DEADLINE_WRITTEN.exec(base.folded);
  const match =
    numeric && written
      ? numeric.index <= written.index
        ? numeric
        : written
      : (numeric ?? written);
  if (!match) return { deadline: null, deadlineOn: null };
  const start = match.index;
  const deadline = quoted(text, base, start, start + match[0].length);
  const day = Number(match[1]);
  const month = match === written ? MONTHS.indexOf(match[2] ?? '') + 1 : Number(match[2]);
  const year = match[3] ? Number(match[3]) : null;
  return { deadline, deadlineOn: deadline ? deadlineDate(day, month, year, referenceDate) : null };
}

function extractResponsible(
  text: string,
  base: FoldedText,
  companyDomains: readonly string[],
): QuotedValue | null {
  for (const match of text.matchAll(EMAIL)) {
    const email = match[0].replace(/\.$/, '');
    const local = email.split('@')[0]?.toLowerCase() ?? '';
    if (!GENERIC_LOCAL.test(local)) continue;
    if (!companyEmailDomain(email, companyDomains)) continue;
    const at = match.index ?? 0;
    const quote = sentenceAround(text, at);
    if (quote) return { text: email.slice(0, 200), quote };
  }
  const area = AREA.exec(base.folded);
  if (area?.[1]) {
    const start = area.index + area[0].length - area[1].length;
    return quoted(text, base, start, start + area[1].length);
  }
  return null;
}

/**
 * Lê a demanda de uma publicação (título + texto). `referenceDate`: data da publicação (ou de
 * hoje), para completar o ano de um prazo escrito só com dia e mês. `companyDomains`: domínios da
 * empresa; só um e-mail genérico deles vira canal (sem domínio conhecido, nenhum e-mail vira).
 * Sem necessidade legível, null.
 */
export function extractDemand(
  text: string,
  referenceDate: string | null,
  companyDomains: readonly string[] = [],
): DemandDetails | null {
  const base = foldWithMap(text);
  const match = SEEKS.exec(base.folded) ?? CALL.exec(base.folded) ?? PROPOSALS.exec(base.folded);
  if (!match?.[1]) return null;
  const groupStart = match.index + match[0].length - match[1].length;
  const end = NEED_END.exec(match[1]);
  const needEnd = groupStart + (end ? end.index : match[1].length);
  const need = quoted(text, base, groupStart, needEnd);
  if (!need || need.text.length < 3) return null;
  return {
    need,
    ...extractDeadline(text, base, referenceDate),
    responsible: extractResponsible(text, base, companyDomains),
  };
}
