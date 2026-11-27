import type { UF } from '@prospector/contracts';
import { fold } from '../commercial/text';

/**
 * Estados do Brasil para a pesquisa extensa (Parte 6.4: expansão geográfica). A ordem é por
 * população (Censo 2022, arredondada): sem região pedida, a pesquisa começa pelos estados com mais
 * profissionais. As cidades extras entram na segunda volta, depois das capitais.
 */
export interface UfInfo {
  readonly uf: UF;
  readonly name: string;
  readonly capital: string;
  readonly region: 'Norte' | 'Nordeste' | 'Centro-Oeste' | 'Sudeste' | 'Sul';
  readonly cities: readonly string[];
}

export const UF_INFO: readonly UfInfo[] = Object.freeze([
  {
    uf: 'SP',
    name: 'São Paulo',
    capital: 'São Paulo',
    region: 'Sudeste',
    cities: ['Campinas', 'Ribeirão Preto', 'Santos', 'Sorocaba', 'São José dos Campos'],
  },
  {
    uf: 'MG',
    name: 'Minas Gerais',
    capital: 'Belo Horizonte',
    region: 'Sudeste',
    cities: ['Uberlândia', 'Juiz de Fora', 'Contagem', 'Montes Claros'],
  },
  {
    uf: 'RJ',
    name: 'Rio de Janeiro',
    capital: 'Rio de Janeiro',
    region: 'Sudeste',
    cities: ['Niterói', 'Petrópolis', 'Nova Iguaçu'],
  },
  {
    uf: 'BA',
    name: 'Bahia',
    capital: 'Salvador',
    region: 'Nordeste',
    cities: ['Feira de Santana', 'Vitória da Conquista'],
  },
  { uf: 'PR', name: 'Paraná', capital: 'Curitiba', region: 'Sul', cities: ['Londrina', 'Maringá'] },
  {
    uf: 'RS',
    name: 'Rio Grande do Sul',
    capital: 'Porto Alegre',
    region: 'Sul',
    cities: ['Caxias do Sul', 'Pelotas'],
  },
  { uf: 'PE', name: 'Pernambuco', capital: 'Recife', region: 'Nordeste', cities: ['Caruaru'] },
  {
    uf: 'CE',
    name: 'Ceará',
    capital: 'Fortaleza',
    region: 'Nordeste',
    cities: ['Juazeiro do Norte'],
  },
  { uf: 'PA', name: 'Pará', capital: 'Belém', region: 'Norte', cities: ['Ananindeua'] },
  {
    uf: 'SC',
    name: 'Santa Catarina',
    capital: 'Florianópolis',
    region: 'Sul',
    cities: ['Joinville', 'Blumenau'],
  },
  { uf: 'GO', name: 'Goiás', capital: 'Goiânia', region: 'Centro-Oeste', cities: ['Anápolis'] },
  { uf: 'MA', name: 'Maranhão', capital: 'São Luís', region: 'Nordeste', cities: ['Imperatriz'] },
  { uf: 'AM', name: 'Amazonas', capital: 'Manaus', region: 'Norte', cities: [] },
  {
    uf: 'ES',
    name: 'Espírito Santo',
    capital: 'Vitória',
    region: 'Sudeste',
    cities: ['Vila Velha'],
  },
  {
    uf: 'PB',
    name: 'Paraíba',
    capital: 'João Pessoa',
    region: 'Nordeste',
    cities: ['Campina Grande'],
  },
  { uf: 'MT', name: 'Mato Grosso', capital: 'Cuiabá', region: 'Centro-Oeste', cities: [] },
  { uf: 'RN', name: 'Rio Grande do Norte', capital: 'Natal', region: 'Nordeste', cities: [] },
  { uf: 'PI', name: 'Piauí', capital: 'Teresina', region: 'Nordeste', cities: [] },
  { uf: 'AL', name: 'Alagoas', capital: 'Maceió', region: 'Nordeste', cities: [] },
  { uf: 'DF', name: 'Distrito Federal', capital: 'Brasília', region: 'Centro-Oeste', cities: [] },
  {
    uf: 'MS',
    name: 'Mato Grosso do Sul',
    capital: 'Campo Grande',
    region: 'Centro-Oeste',
    cities: [],
  },
  { uf: 'SE', name: 'Sergipe', capital: 'Aracaju', region: 'Nordeste', cities: [] },
  { uf: 'RO', name: 'Rondônia', capital: 'Porto Velho', region: 'Norte', cities: [] },
  { uf: 'TO', name: 'Tocantins', capital: 'Palmas', region: 'Norte', cities: [] },
  { uf: 'AC', name: 'Acre', capital: 'Rio Branco', region: 'Norte', cities: [] },
  { uf: 'AP', name: 'Amapá', capital: 'Macapá', region: 'Norte', cities: [] },
  { uf: 'RR', name: 'Roraima', capital: 'Boa Vista', region: 'Norte', cities: [] },
] satisfies UfInfo[]);

const BY_UF = new Map(UF_INFO.map((info) => [info.uf, info]));

export function ufInfo(uf: UF): UfInfo | undefined {
  return BY_UF.get(uf);
}

export function regionOf(uf: UF | null | undefined): UfInfo['region'] | null {
  return uf ? (BY_UF.get(uf)?.region ?? null) : null;
}

/** Todas as cidades conhecidas (capitais e extras), com a UF, para achar o local num trecho. */
export const KNOWN_CITIES: ReadonlyArray<{ readonly city: string; readonly uf: UF }> =
  Object.freeze(
    UF_INFO.flatMap((info) => [
      { city: info.capital, uf: info.uf },
      ...info.cities.map((city) => ({ city, uf: info.uf })),
    ]),
  );

const VALID_UFS = new Set<string>(UF_INFO.map((info) => info.uf));

export function isUf(value: string): value is UF {
  return VALID_UFS.has(value);
}

/** Palavra inteira no texto dobrado (sem acento e minúsculo). */
export function hasFoldedWord(foldedText: string, foldedWord: string): boolean {
  const escaped = foldedWord.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`).test(foldedText);
}

/**
 * UFs citadas num pedido, na ordem em que aparecem: pelo nome do estado ("Minas Gerais") ou pela
 * sigla em maiúsculas ("MG", "SP"). "São Paulo" e "Rio de Janeiro" contam como estado.
 */
export function ufsInText(text: string): UF[] {
  const folded = fold(text);
  const found: Array<{ uf: UF; at: number }> = [];
  const taken: Array<[number, number]> = [];
  const free = (from: number, to: number) => taken.every(([a, b]) => to <= a || from >= b);
  // Nome mais longo primeiro: "Mato Grosso do Sul" antes de "Mato Grosso".
  for (const info of [...UF_INFO].sort((a, b) => b.name.length - a.name.length)) {
    // "para" é preposição: o Pará só conta com o acento.
    if (info.uf === 'PA') {
      const match = /(?<![A-Za-zÀ-ú])Par[áÁ](?![A-Za-zÀ-ú])/i.exec(text);
      if (match && /á/i.test(match[0])) found.push({ uf: 'PA', at: match.index });
      continue;
    }
    const pattern = new RegExp(`(^|[^a-z0-9])(${fold(info.name)})(?=[^a-z0-9]|$)`, 'g');
    for (const match of folded.matchAll(pattern)) {
      const from = (match.index ?? 0) + (match[1]?.length ?? 0);
      const to = from + (match[2]?.length ?? 0);
      if (!free(from, to)) continue;
      taken.push([from, to]);
      found.push({ uf: info.uf, at: from });
      break;
    }
  }
  for (const match of text.matchAll(/(?<![A-Za-zÀ-ú])([A-Z]{2})(?![A-Za-zÀ-ú])/g)) {
    const sigla = match[1] ?? '';
    // "TO" é a sigla de terapia ocupacional nos pedidos: Tocantins só pelo nome.
    if (isUf(sigla) && sigla !== 'TO') found.push({ uf: sigla, at: match.index ?? 0 });
  }
  const seen = new Set<UF>();
  return found
    .sort((a, b) => a.at - b.at)
    .map((entry) => entry.uf)
    .filter((uf) => (seen.has(uf) ? false : (seen.add(uf), true)));
}
