import {
  DISCOVERY_MAX_QUERIES,
  DISCOVERY_SNIPPET_MAX,
  SERVICE_HINT_LABELS,
  WebSearchQuery,
  type CompanyLifecycle,
  type CompanySize,
  type DiscoveryFailure,
  type DiscoveryIntent,
  type DiscoveryPlan,
  type DiscoveryProgress,
  type DiscoveryQuery,
  type DiscoveryQueryResult,
  type DiscoveryRun,
  type DiscoveryRunQuery,
  type ExtractorOutput,
  type IcpProfile,
  type InterpreterOutput,
  type Offer,
  type ProspectSignal,
  type ProspectSourceRelation,
  type ResultKind,
  type ScoringModelVersion,
  type SignalType,
  type UF,
  type WebSearchFailure,
  withoutCpf,
} from '@prospector/contracts';
import {
  assessProspect,
  distinctiveTokens,
  expansionEventIn,
  findCnpjsInText,
  findSameCompany,
  companyNameCore,
  homepageOf,
  hostCategory,
  hostOf,
  looksLikeInstruction,
  nameFoundIn,
  nameMatchesHost,
  normalizeCity,
  normalizeCompanyName,
  normalizeForQuote,
  prospectDedupeKey,
  quoteFoundIn,
  signalConfidence,
  signalFingerprintText,
  signalRecency,
  supportedEventDate,
  signalVerification,
  siteKey,
  stripAccents,
  type DedupeCandidate,
  type HostCategory,
  type MatchReason,
} from '@prospector/domain';
import { calendarDate, systemClock, type Clock } from '../clock';
import type { RequestContext } from '../context';
import { isAppError } from '../errors';
import type { CompanyRepository } from '../ports/company-repository';
import {
  DiscoveryAiError,
  type DiscoveryAi,
  type DiscoveryRepository,
  type NewProspectSignal,
  type NewProspectSource,
  type ProspectPatch,
  type ProspectRecord,
} from '../ports/discovery';
import type { JobHandler } from './job-worker';
import { pendingAudit } from './pending-audit';
import type { StrategyService } from './strategy-service';
import type { WebResearchService } from './web-research-service';

/**
 * Motor da Descoberta (F4, ADR-0013). Roda no trabalhador da fila (ADR-0011), uma pesquisa por
 * vez, em três níveis:
 * 1. descoberta — a IA local entende o pedido e planeja as buscas; o buscador traz resultados;
 *    a IA local identifica empresas e sinais em cada lote (o servidor confere tudo);
 * 2. verificação — lê a página inicial do site oficial (nome confere? CNPJ? cidade?);
 * 3. pré-qualificação — deduplica com o que já foi achado, grava fontes e sinais e faz a triagem
 *    `discovery-triage/v1` (domínio), com motivos e o que falta saber.
 *
 * Retomada: cada busca feita fica gravada com os resultados (`discovery_run_queries`); ao retomar
 * depois de reinício, só as buscas que faltam vão ao buscador. Extração e gravação são
 * idempotentes (chave da empresa, URL da fonte e impressão digital do sinal).
 * Conteúdo da internet é dado, nunca instrução: o modelo só recebe trechos numerados e responde
 * em JSON validado; nome, trecho e site oficial são conferidos no servidor.
 */

export interface DiscoveryEngineDeps {
  repo: DiscoveryRepository;
  ai: DiscoveryAi;
  web: Pick<WebResearchService, 'search' | 'readPage'>;
  strategy: Pick<StrategyService, 'overview'>;
  companies: Pick<CompanyRepository, 'findByStrongIdentifier'>;
  clock?: Clock;
  newId?: () => string;
  log?: (message: string) => void;
}

export type EngineOutcome =
  | { kind: 'finished'; status: 'completed' | 'failed' | 'cancelled' }
  | { kind: 'retry'; errorCode: string; retryAfterSeconds: number };

export interface ExecuteOptions {
  signal: AbortSignal;
  /** Última tentativa da tarefa: falha passageira vira falha da pesquisa, sem nova espera. */
  lastAttempt: boolean;
  /** Número da tentativa (1…), para a espera crescer. */
  attempt: number;
}

export interface DiscoveryEngine {
  execute(runId: string, options: ExecuteOptions): Promise<EngineOutcome>;
  /** A tarefa caiu sem tentativas sobrando (ou foi cancelada antes de rodar). */
  abandon(runId: string, cancelled: boolean): Promise<void>;
}

/**
 * A Descoberta como tarefa da fila (ADR-0011): `discovery_run` com `{ runId }` no payload. A
 * última tentativa transforma falha passageira em falha da pesquisa (sem nova espera).
 */
export function discoveryJobHandler(engine: DiscoveryEngine): JobHandler {
  return {
    async run(job, signal) {
      const outcome = await engine.execute(String(job.payload.runId), {
        signal,
        lastAttempt: job.attempts >= job.maxAttempts,
        attempt: job.attempts,
      });
      if (outcome.kind === 'retry') {
        return {
          status: 'retry',
          errorCode: outcome.errorCode,
          retryAfterSeconds: outcome.retryAfterSeconds,
        };
      }
      return outcome.status === 'completed'
        ? { status: 'succeeded' }
        : { status: outcome.status, errorCode: null };
    },
    abandon: (job) => engine.abandon(String(job.payload.runId), job.status === 'cancelled'),
  };
}

/** Quantos resultados cada busca pede ao buscador, por profundidade. */
const RESULTS_PER_SEARCH = { quick: 6, standard: 8, deep: 10 } as const;
/** Quantidade padrão quando o pedido não diz quantas empresas. */
const DEFAULT_QUANTITY = { quick: 10, standard: 15, deep: 25 } as const;
/** Resultados por chamada do extrator (cabe no contexto de 8k do modelo local). */
const EXTRACT_BATCH = 8;
const RETENTION_MONTHS = 12;
const MIN_QUOTE_CHARS = 12;

/** Palavras que puxam cada tipo de sinal nas buscas montadas pelo servidor. */
const SIGNAL_QUERY_TERMS: Record<SignalType, string> = {
  expansion: 'inaugura nova unidade expansão',
  hiring: 'vaga marketing',
  launch: 'lança lançamento',
  strategic_change: 'nova fase reposicionamento',
  investment: 'investimento ampliação',
  brand_communication: 'nova marca novo site',
};

const RETRYABLE_AI: ReadonlySet<string> = new Set(['busy', 'insufficient_vram', 'timeout']);

class Cancelled extends Error {
  constructor() {
    super('cancelled');
  }
}

class StopRun extends Error {
  constructor(readonly failure: DiscoveryFailure) {
    super(failure);
  }
}

interface StrategyContext {
  icp: IcpProfile | null;
  offer: Offer | null;
  scoring: ScoringModelVersion | null;
}

interface CandidateSource {
  url: string;
  host: string;
  title: string | null;
  snippet: string;
  kind: 'search_result' | 'web_page';
  relation: ProspectSourceRelation;
  provider: string;
  publishedAt: string | null;
}

interface CandidateSignal {
  url: string;
  type: SignalType;
  summary: string;
  quote: string;
  eventDate: string | null;
  publishedAt: string | null;
  verification: ProspectSignal['verification'];
  confidence: number;
  relevance: ProspectSignal['relevance'];
  relatedService: ProspectSignal['relatedService'];
  rationale: string;
  recency: ProspectSignal['recency'];
}

interface Candidate {
  name: string;
  siteKey: string | null;
  websiteUrl: string | null;
  city: string | null;
  uf: UF | null;
  segment: string | null;
  description: string | null;
  cnpj: string | null;
  siteVerified: boolean;
  sources: Map<string, CandidateSource>;
  signals: CandidateSignal[];
}

interface SearchResultRow extends DiscoveryQueryResult {
  host: string;
  hostKind: HostCategory | null;
}

// -----------------------------------------------------------------------------
// Auxiliares de texto
// -----------------------------------------------------------------------------

function comparable(text: string): string {
  return stripAccents(text)
    .toLowerCase()
    .replace(/[“”"'‘’`´]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * O trecho que o modelo citou está mesmo no texto da fonte? Mesma regra do Evidence Ledger
 * (acento, aspas, travessão, caixa e espaços não contam; o resto precisa ser igual).
 */
export function signalQuoteFound(quote: string, text: string): boolean {
  return normalizeForQuote(quote).length >= MIN_QUOTE_CHARS && quoteFoundIn(quote, text);
}

/**
 * Janela do texto com o trecho citado dentro (a fonte guarda só 300 caracteres e o trecho precisa
 * caber nela para ser evidência depois, no módulo Empresas).
 */
export function excerptAround(text: string, quote: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= max) return flat;
  let normalized = '';
  const origin: number[] = [];
  for (let index = 0; index < flat.length; index += 1) {
    const piece = normalizeForQuote(flat[index] ?? '') || (flat[index] === ' ' ? ' ' : '');
    for (const char of piece) {
      normalized += char;
      origin.push(index);
    }
  }
  const wanted = normalizeForQuote(quote);
  const at = normalized.indexOf(wanted);
  if (at < 0 || wanted.length === 0) return flat.slice(0, max);
  const start = origin[at] ?? 0;
  const end = (origin[at + wanted.length - 1] ?? start) + 1;
  const room = Math.max(0, max - (end - start));
  const from = Math.max(0, Math.min(start - Math.floor(room / 2), flat.length - max));
  return flat.slice(from, from + max);
}

function cityIn(city: string, text: string): boolean {
  const needle = normalizeCity(city);
  return needle.length >= 3 && ` ${comparable(text)} `.includes(` ${needle} `);
}

function ufIn(uf: string, text: string): boolean {
  return new RegExp(`(^|[^A-Za-z])${uf}([^A-Za-z]|$)`).test(text);
}

const STATE_NAMES: Record<UF, string> = {
  AC: 'Acre',
  AL: 'Alagoas',
  AP: 'Amapá',
  AM: 'Amazonas',
  BA: 'Bahia',
  CE: 'Ceará',
  DF: 'Distrito Federal',
  ES: 'Espírito Santo',
  GO: 'Goiás',
  MA: 'Maranhão',
  MT: 'Mato Grosso',
  MS: 'Mato Grosso do Sul',
  MG: 'Minas Gerais',
  PA: 'Pará',
  PB: 'Paraíba',
  PR: 'Paraná',
  PE: 'Pernambuco',
  PI: 'Piauí',
  RJ: 'Rio de Janeiro',
  RN: 'Rio Grande do Norte',
  RS: 'Rio Grande do Sul',
  RO: 'Rondônia',
  RR: 'Roraima',
  SC: 'Santa Catarina',
  SP: 'São Paulo',
  SE: 'Sergipe',
  TO: 'Tocantins',
};

/** O texto cita o estado pelo nome ("interior de São Paulo", "em Minas Gerais")? */
function stateNameIn(uf: UF, text: string): boolean {
  return cityIn(STATE_NAMES[uf], text);
}

/** Adjetivos de estado usados para regiões: "interior paulista", "Serra Gaúcha". */
const STATE_ADJECTIVES: Partial<Record<UF, string>> = {
  SP: 'paulista',
  RJ: 'fluminense',
  MG: 'mineir[ao]',
  RS: 'gauch[ao]',
  SC: 'catarinense',
  PR: 'paranaense',
  BA: 'baian[ao]',
  GO: 'goian[ao]',
  ES: 'capixaba',
  CE: 'cearense',
  PE: 'pernambucan[ao]',
  RN: 'potiguar',
  PB: 'paraiban[ao]',
  AL: 'alagoan[ao]',
  SE: 'sergipan[ao]',
  PI: 'piauiense',
  MA: 'maranhense',
  PA: 'paraense',
  AM: 'amazonense',
  TO: 'tocantinense',
  MT: 'mato grossense',
  MS: 'sul mato grossense',
};

const DIRECTIONS = 'norte|sul|leste|oeste|nordeste|noroeste|sudeste|sudoeste|centro oeste';

/**
 * Formas que querem dizer o estado e não a cidade de mesmo nome, da mais longa para a mais curta
 * ("Mato Grosso do Sul" antes de "Mato Grosso"): "interior de São Paulo", "litoral norte de São
 * Paulo", "estado de Goiás", "interior paulista", "Serra Gaúcha", "sul de Minas", "norte do
 * Paraná". "Zona norte de São Paulo" e "região sul do Rio de Janeiro" ficam na cidade: SP e RJ não
 * entram na forma com direção.
 */
const STATE_FORMS: ReadonlyArray<{ uf: UF; pattern: RegExp; size: number }> = (
  Object.keys(STATE_NAMES) as UF[]
)
  .flatMap((uf) => {
    const name = normalizeCity(STATE_NAMES[uf]);
    const names = uf === 'MG' ? `${name}|minas` : name;
    const adjective = STATE_ADJECTIVES[uf];
    const forms = [
      {
        uf,
        size: name.length,
        pattern: new RegExp(
          ` (interior|litoral|estado)( (${DIRECTIONS}))?( do estado)? (de|do|da) (${names}|${uf.toLowerCase()}) `,
        ),
      },
    ];
    if (adjective) {
      forms.push({
        uf,
        size: adjective.length,
        pattern: new RegExp(
          ` (interior|litoral|serra|vale|sertao|agreste|triangulo|planalto|${DIRECTIONS})( (${DIRECTIONS}))? ${adjective} `,
        ),
      });
    }
    if (uf !== 'SP' && uf !== 'RJ') {
      forms.push({
        uf,
        size: name.length,
        pattern: new RegExp(` (regiao )?(${DIRECTIONS}) (de|do|da) (${names}) `),
      });
    }
    return forms;
  })
  .sort((a, b) => b.size - a.size);

/**
 * "Interior de São Paulo", "litoral norte de São Paulo", "estado de Goiás", "interior paulista":
 * o lugar é o estado, não a cidade de mesmo nome. Na avaliação de 2026-11-25 o modelo pôs "São
 * Paulo" em `cities` nas 3 vezes, e o servidor (que aceita cidade escrita no pedido) pesquisaria
 * só a capital. null quando o pedido não tem essa forma.
 */
export function stateArea(request: string): UF | null {
  const text = ` ${comparable(request)} `;
  return STATE_FORMS.find((form) => form.pattern.test(text))?.uf ?? null;
}

/** UF cujo nome é exatamente este ("São Paulo" → SP); null para os demais. */
function stateNamed(place: string): UF | null {
  const name = normalizeCity(place);
  return (
    (Object.keys(STATE_NAMES) as UF[]).find((uf) => normalizeCity(STATE_NAMES[uf]) === name) ?? null
  );
}

/** Até onde vai a região pedida além das cidades citadas. */
export type RegionExtent = 'metropolitan' | 'surroundings';

/**
 * "Grande X" só com preposição antes ou no começo: em "Imobiliárias em Praia Grande, São Paulo",
 * "Campina Grande, João Pessoa" e "Campo Grande, Rio de Janeiro", "Grande" é parte da cidade
 * (segunda revisão do KI-148).
 */
function greaterPattern(names: string): RegExp {
  return new RegExp(`(^| (na|no|da|do|a|o|em|de|pela|pelo|para|toda|e|ou)) grande (${names}) `);
}

/**
 * "Grande X": as cidades e a UF que a expressão quer dizer. Sem isso, "Grande BH" virava
 * "Brasil", porque o servidor só aceita cidade escrita no pedido (KI-148).
 */
const GREATER_AREAS: ReadonlyArray<{ pattern: RegExp; cities: readonly string[]; uf: UF }> = [
  { pattern: greaterPattern('sao paulo|sp'), cities: ['São Paulo'], uf: 'SP' },
  { pattern: greaterPattern('bh|belo horizonte'), cities: ['Belo Horizonte'], uf: 'MG' },
  // "Grande Rio", mas não "grande Rio Verde" nem "Rio do Sul".
  {
    pattern: greaterPattern(
      String.raw`rio(?! (verde|branco|claro|bonito|negro|largo|pardo|preto|novo|azul|grande|do|da|das|dos)\b)`,
    ),
    cities: ['Rio de Janeiro'],
    uf: 'RJ',
  },
  { pattern: greaterPattern('porto alegre|poa'), cities: ['Porto Alegre'], uf: 'RS' },
  { pattern: greaterPattern('curitiba'), cities: ['Curitiba'], uf: 'PR' },
  { pattern: greaterPattern('recife'), cities: ['Recife'], uf: 'PE' },
  { pattern: greaterPattern('salvador'), cities: ['Salvador'], uf: 'BA' },
  { pattern: greaterPattern('fortaleza'), cities: ['Fortaleza'], uf: 'CE' },
  { pattern: greaterPattern('vitoria'), cities: ['Vitória'], uf: 'ES' },
  { pattern: greaterPattern('florianopolis|floripa'), cities: ['Florianópolis'], uf: 'SC' },
  { pattern: greaterPattern('goiania'), cities: ['Goiânia'], uf: 'GO' },
  { pattern: greaterPattern('natal'), cities: ['Natal'], uf: 'RN' },
  { pattern: greaterPattern('sao luis'), cities: ['São Luís'], uf: 'MA' },
  { pattern: greaterPattern('joao pessoa'), cities: ['João Pessoa'], uf: 'PB' },
  { pattern: greaterPattern('belem'), cities: ['Belém'], uf: 'PA' },
  { pattern: greaterPattern('manaus'), cities: ['Manaus'], uf: 'AM' },
  { pattern: greaterPattern('cuiaba'), cities: ['Cuiabá'], uf: 'MT' },
  { pattern: greaterPattern('maceio'), cities: ['Maceió'], uf: 'AL' },
  { pattern: greaterPattern('aracaju'), cities: ['Aracaju'], uf: 'SE' },
  { pattern: greaterPattern('teresina'), cities: ['Teresina'], uf: 'PI' },
  { pattern: greaterPattern('campinas'), cities: ['Campinas'], uf: 'SP' },
  { pattern: greaterPattern('londrina'), cities: ['Londrina'], uf: 'PR' },
  {
    pattern:
      / (abc paulista|regiao do abc) |(^| (na|no|da|do|em|de|pelo|para|todo|e|ou)) grande abc /,
    cities: ['Santo André', 'São Bernardo do Campo', 'São Caetano do Sul'],
    uf: 'SP',
  },
];

/** "Grande BH" → Belo Horizonte (MG); null quando o pedido não usa essa forma. */
export function greaterArea(request: string): { cities: readonly string[]; uf: UF } | null {
  const text = ` ${comparable(request)} `;
  const area = GREATER_AREAS.find((item) => item.pattern.test(text));
  return area ? { cities: area.cities, uf: area.uf } : null;
}

/**
 * O pedido inclui a região em volta das cidades pedidas? Na pesquisa real de 2026-11-24
 * (KI-148), "região metropolitana" sumia e nenhuma busca saía da capital. Só as formas que
 * falam de fora da cidade contam: "região metropolitana", "Grande X", "e região", "região de
 * <cidade pedida>", "e na região", "e entorno", "arredores", "cidades próximas", "e região norte do
 * Paraná". "Região central de Campinas", "região da Savassi" (bairro) e "referência na região"
 * ficam dentro da cidade.
 */
export function regionExtent(request: string, cities: readonly string[]): RegionExtent | null {
  const text = ` ${comparable(request)} `;
  if (/ regiao metropolitana | rm[a-z]{1,3} /.test(text) || greaterArea(request)) {
    return 'metropolitan';
  }
  if (
    new RegExp(
      ` e (n[ao] |sua |seu |o )?(regiao|entorno|arredores)(?! (central|centro|${DIRECTIONS})\\b)`,
    ).test(text)
  ) {
    return 'surroundings';
  }
  // "Londrina e região norte do Paraná": a parte do estado em volta da cidade.
  if (
    new RegExp(` e (n[ao] )?regiao (${DIRECTIONS}) (de|do|da) `).test(text) &&
    stateArea(request)
  ) {
    return 'surroundings';
  }
  if (/ (arredores|cidades vizinhas|cidades proximas|municipios vizinhos) /.test(text)) {
    return 'surroundings';
  }
  const around = cities.some((city) => {
    const name = normalizeCity(city);
    return new RegExp(` (regiao (de|do|da)|entorno (de|do|da)) ${name} `).test(text);
  });
  return around ? 'surroundings' : null;
}

/** Siglas de UF em minúsculas, como ficam no texto comparável ("Curitiba/PR" → "curitiba pr"). */
const UF_WORDS = new Set(Object.keys(STATE_NAMES).map((uf) => uf.toLowerCase()));

/**
 * Prefixos de bairro ("Jardim Higienópolis", "Vila Madalena", "Gleba Palhano"). Município com
 * esse começo ("Vila Velha", "Jardim Alegre") passa quando o texto o escreve como município.
 */
const DISTRICT_PREFIX =
  /^(jardim|jd|vila|vl|gleba|parque|pq|conjunto|residencial|setor|loteamento|nucleo|chacaras?|bosque|recanto|condominio|bairro)( |$)|^centro$/;

function districtLike(place: string): boolean {
  return DISTRICT_PREFIX.test(normalizeCity(place));
}

/** Palavras que encerram um nome de lugar escrito sem maiúsculas ("batel em curitiba com vista"). */
const PLACE_STOP_WORDS = new Set([
  'a',
  'o',
  'as',
  'os',
  'ao',
  'aos',
  'e',
  'ou',
  'em',
  'no',
  'na',
  'nos',
  'nas',
  'com',
  'que',
  'para',
  'por',
  'pelo',
  'pela',
  'perto',
  'proximo',
  'proxima',
  'onde',
  'ate',
  'sem',
  'mas',
  'como',
  'quando',
  'se',
  'ja',
  'tambem',
  'mais',
  'entre',
  'sobre',
  'regiao',
  'cidade',
  'capital',
  'estado',
]);

/**
 * O nome de lugar no começo de `words`, até a primeira palavra que não é de nome ("Curitiba com
 * vista" → "Curitiba"). Escrito todo em minúsculas, volta com as iniciais maiúsculas ("são paulo"
 * → "São Paulo"). null quando não sobra nome.
 */
function leadingPlace(words: string): string | null {
  const kept: string[] = [];
  for (const word of words.trim().split(/\s+/)) {
    const key = normalizeCity(word);
    if (!key || PLACE_STOP_WORDS.has(key) || UF_WORDS.has(key)) break;
    kept.push(word);
  }
  while (kept.length > 0 && /^d[aeo]s?$/i.test(kept.at(-1) ?? '')) kept.pop();
  if (kept.length === 0) return null;
  const name = kept.join(' ');
  if (name !== name.toLowerCase()) return name;
  return kept
    .map((word, index) =>
      index > 0 && /^(d[aeo]s?|e)$/.test(word)
        ? word
        : word.charAt(0).toUpperCase() + word.slice(1),
    )
    .join(' ');
}

/** "bairro X" ou "bairro de X" (singular): X é bairro. "Bairros de X" fala da cidade X. */
function districtWordBefore(needle: string, hay: string): boolean {
  return new RegExp(` bairro (d[aeo] )?${needle} `).test(hay);
}

/**
 * A "cidade" do modelo é um bairro, segundo o PEDIDO? "no bairro Savassi", "no Batel, em
 * Curitiba" e "na região da Savassi, em Belo Horizonte" (com a outra cidade também no pedido).
 * "Nos bairros de Curitiba" não conta: ali Curitiba é a cidade. Nem "no Guarujá, em São Paulo":
 * depois de um município, o nome do estado é o estado (segunda revisão do KI-148).
 */
export function districtInRequest(
  place: string,
  request: string,
  otherCities: readonly string[],
): boolean {
  const needle = normalizeCity(place);
  if (needle.length < 3) return false;
  const hay = ` ${comparable(request)} `;
  if (districtWordBefore(needle, hay)) return true;
  return otherCities.some((city) => {
    const other = normalizeCity(city);
    if (other === needle || (stateNamed(city) && !districtLike(place))) return false;
    return new RegExp(` (no|na|nos|nas|regiao d[aeo]s?) ${needle} em ${other} `).test(hay);
  });
}

/**
 * A cidade que o extrator leu num resultado é um bairro da cidade pedida? Só com sinal forte: a
 * palavra "bairro" antes, ou o nome seguido da cidade pedida no fim do endereço — com a UF
 * ("Batel, Curitiba/PR"), o estado ou nada depois ("Café Alfa - Batel - Curitiba"). Numa lista
 * ("Atendemos Cambé, Londrina e região") o município vizinho continua município, justo nas
 * pesquisas de região metropolitana.
 */
export function districtInResult(
  place: string,
  text: string,
  regionCities: readonly string[],
): boolean {
  const needle = normalizeCity(place);
  if (needle.length < 3) return false;
  const hay = ` ${comparable(text)} `;
  if (districtWordBefore(needle, hay)) return true;
  const plain = stripAccents(text).toLowerCase();
  return regionCities.some((city) => {
    const other = normalizeCity(city);
    if (other === needle) return false;
    const match = new RegExp(` ${needle} (em )?${other} ([a-z]{2}) `).exec(hay);
    if (match !== null && UF_WORDS.has(match[2] ?? '')) return true;
    return new RegExp(
      String.raw`(^|[^\p{L}])${escapeRegExp(stripAccents(place).toLowerCase())}\s*(?:[,–—-]|\bem\b)\s*${escapeRegExp(stripAccents(city).toLowerCase())}\s*(?:$|[|.;)]|[,/–—(-]\s*(?:${STATE_WORDS})(?![\p{L}]))`,
      'u',
    ).test(plain);
  });
}

/** Siglas e nomes de estado, sem acento e em minúsculas, para o fim de um endereço. */
const STATE_WORDS = [
  ...Object.keys(STATE_NAMES).map((uf) => uf.toLowerCase()),
  ...Object.values(STATE_NAMES).map((name) => escapeRegExp(stripAccents(name).toLowerCase())),
].join('|');

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Cidade do bairro no pedido: em "Cafeterias no Batel, em Curitiba", o bairro Batel é de
 * Curitiba. O modelo às vezes devolve só "Batel" em `cities` (2 de 3 vezes na avaliação de
 * 2026-11-25); aí a cidade escrita depois dele toma o lugar. Vale também escrito em minúsculas
 * ("no batel, em curitiba"). Depois de um município, o nome do estado é o estado: em "Pousadas
 * no Guarujá, em São Paulo" a cidade continua Guarujá (segunda revisão do KI-148). null quando o
 * pedido não tem essa forma.
 */
export function districtHost(place: string, request: string): string | null {
  const needle = normalizeCity(place);
  for (const match of request.matchAll(
    /(?<![\p{L}])(?:no|na|nos|nas|regi[aã]o d[aeo]s?) (?:bairro (?:d[aeo] )?)?(?!regi[aã]o )([\p{L}'’ -]+?),? em ([\p{L}'’ -]+)/giu,
  )) {
    if (!match[1] || !match[2] || normalizeCity(match[1]) !== needle) continue;
    const host = leadingPlace(match[2]);
    if (!host || (stateNamed(host) && !districtLike(place))) return null;
    return host;
  }
  return null;
}

/**
 * Bairro pedido ("no bairro Savassi, em Belo Horizonte", "no Batel, em Curitiba"), para o plano
 * e o resumo citarem. `cities` são as cidades da pesquisa: com elas, "no Batel, em Curitiba" é
 * achado mesmo quando o modelo (certo) não pôs o Batel em `cities`. null sem bairro.
 */
export function requestedDistrict(
  request: string,
  modelCities: readonly string[],
  cities: readonly string[] = [],
): string | null {
  const written = /(?<![\p{L}])bairro (?:d[aeo] )?([\p{L}'’ -]+)/iu.exec(request);
  const named = written?.[1] ? leadingPlace(written[1]) : null;
  if (named) return named;
  for (const match of request.matchAll(
    /(?<![\p{L}])(?:no|na|nos|nas|regi[aã]o d[aeo]s?) (?!regi[aã]o )([\p{L}'’ -]+)/giu,
  )) {
    const place = match[1] ? leadingPlace(match[1]) : null;
    if (place && districtInRequest(place, request, cities)) return place;
  }
  const fromModel = modelCities.find(
    (city) =>
      cityIn(city, request) &&
      districtInRequest(
        city,
        request,
        modelCities.filter((other) => other !== city),
      ),
  );
  return fromModel ?? null;
}

/**
 * Palavras de busca em inglês que não se usam assim no Brasil ("pet clinic"): o modelo às vezes
 * propõe e a busca volta com resultados de fora (KI-148). Palavra que está no próprio pedido
 * fica ("concept store", se a pessoa escreveu). Fonte única: os corretores da avaliação usam esta.
 */
const ENGLISH_ONLY = new Set([
  'clinic',
  'clinics',
  'veterinary',
  'grooming',
  'near',
  'best',
  'company',
  'companies',
  'restaurant',
  'restaurants',
  'gym',
  'gyms',
  'bakery',
  'bakeries',
  'dentist',
  'dentists',
  'lawyer',
  'lawyers',
]);

/** Palavras em inglês do texto que o pedido não usa ([] = tudo em português). */
export function foreignSearchWords(text: string, request = ''): string[] {
  const asked = new Set(comparable(request).split(' '));
  return comparable(text)
    .split(' ')
    .filter((word) => ENGLISH_ONLY.has(word) && !asked.has(word));
}

/**
 * Especialidades que estreitam um setor genérico: "clínicas" virava "clínica médica" nos termos e
 * nas buscas (KI-115; avaliação de 2026-11-25, 3 de 3 vezes no v4). Só contam quando o pedido não
 * usa a palavra.
 */
const NARROWING =
  /^(odonto\w*|dent(al|ais|ista|istas|aria|arias|ario|arios)|medic[ao]s?|estetic[ao]s?|veterinari[ao]s?|popular|populares)$/;

/**
 * Palavras do texto que estreitam o setor e que o pedido não usa ([] = nenhuma). Gênero e número
 * não contam: "clínica veterinária" cabe em "clínicas veterinárias".
 */
export function narrowingWords(text: string, request = ''): string[] {
  const stem = (word: string) => word.replace(/(as|os|es|a|o|s)$/, '');
  const asked = new Set(comparable(request).split(' ').map(stem));
  return comparable(text)
    .split(' ')
    .filter((word) => NARROWING.test(word) && !asked.has(stem(word)));
}

/**
 * Palavras que fazem uma busca procurar um sinal. Pelo texto, e não pelo rótulo do modelo:
 * "hospital abre novas vagas marketing" vinha rotulada como expansão e "restaurante Savassi
 * identidade visual" como busca de empresas (segunda revisão do KI-148). Investimento e mudança
 * estratégica ficam de fora: as palavras deles se misturam às de expansão.
 */
const SIGNAL_WORDS: Partial<Record<SignalType, RegExp>> = {
  expansion:
    /(?<= )(inaugur\w*|nova unidade|novas unidades|nova loja|novas lojas|nova filial|novas filiais|abre nova|abrem novas|abre novas|expansao)(?= )/g,
  hiring: /(?<= )(vagas?|contrat\w*|recrut\w*|trabalhe conosco|empregos?|processo seletivo)(?= )/g,
  launch: /(?<= )(lanca|lancam|lancou|lancaram|lancando|lancar|lancamentos?)(?= )/g,
  brand_communication:
    /(?<= )(identidade visual|nova identidade|rebranding|redesign|nova marca|novo logo|nova logo|novo site|site novo|sites?)(?= )/g,
};

/**
 * Palavras de sinal que o pedido não pede, no texto de uma busca ([] = nenhuma). Palavra que está
 * no próprio pedido fica, no singular ou no plural ("agências de recrutamento", "clientes para
 * desenvolvimento de sites").
 */
export function unrequestedSignalWords(
  text: string,
  request: string,
  signals: readonly SignalType[],
): string[] {
  const singular = (words: string) =>
    words
      .split(' ')
      .map((word) => (word.length > 3 ? word.replace(/s$/, '') : word))
      .join(' ');
  const hay = ` ${comparable(text)} `;
  const asked = ` ${singular(comparable(request))} `;
  return (Object.keys(SIGNAL_WORDS) as SignalType[])
    .filter((signal) => !signals.includes(signal))
    .flatMap((signal) => [...hay.matchAll(SIGNAL_WORDS[signal] ?? /$^/g)].map((match) => match[0]))
    .filter((word) => !asked.includes(` ${singular(word)} `));
}

/**
 * Palavras do PEDIDO que pedem cada sinal. O modelo às vezes acrescenta sinal a pedido que não pede
 * nenhum: "Distribuidoras de alimentos no interior de Mato Grosso do Sul" ganhou expansão e
 * lançamento (2 de 3 vezes no v4, avaliação de 2026-11-25), e duas das buscas iam para isso.
 */
const SIGNAL_ASKED: Record<SignalType, RegExp> = {
  expansion:
    /\b(expan\w*|abr(e|em|indo|iu|iram|ir)|abertura|inaugur\w*|cresc\w*|amplia\w*|filia(l|is)|franquia\w*|nov[ao]s? (lojas?|unidades?|sedes?|pontos?|enderecos?)|(lojas?|unidades?) nov[ao]s?)\b/,
  hiring: /\b(contrat\w*|vagas?|recrut\w*|empregos?|selecao|seletivo)\b/,
  launch: /\b(lanc(a|am|ou|aram|ando|ar|amento|amentos)|novos? produtos?|novidades?)\b/,
  strategic_change:
    /\b(mudanc\w*|mud(a|am|ou|aram|ando)|reposicion\w*|fusao|fusoes|aquisic\w*|reestrutur\w*|nova fase|nova gestao|sucessao|transforma\w*)\b/,
  investment: /\b(invest\w*|aporte\w*|capta\w*|rodada|financiamento)\b/,
  brand_communication:
    /\b(marcas?|sites?|identidade|rebranding|branding|logo\w*|comunicacao|redesign|reposicion\w*)\b/,
};

/** "Sinais", "oportunidades", "momento": o pedido aceita qualquer sinal que o modelo propuser. */
const ANY_SIGNAL = /\b(sinal|sinais|gatilhos?|oportunidades?|momento)\b/;

/**
 * Os sinais do modelo que o pedido pede, pelas palavras dele. Os escolhidos na tela (opções) não
 * passam por aqui: valem sempre.
 */
export function signalsAsked(request: string, signals: readonly SignalType[]): SignalType[] {
  const text = comparable(request);
  if (ANY_SIGNAL.test(text)) return [...signals];
  return signals.filter((signal) => SIGNAL_ASKED[signal].test(text));
}

/**
 * Busca na região em volta que o pedido não pede: "bar região de Belo Horizonte" e "barzinho Belo
 * Horizonte região metropolitana" apareciam no plano de "Bares na região de Lourdes, em Belo
 * Horizonte" (avaliação de 2026-11-25). Região metropolitana só quando o pedido fala nela (ou em
 * "Grande X"); "região de <cidade>", "<cidade> e região" e "entorno" só quando o pedido inclui a
 * região em volta.
 */
export function aroundNotAsked(text: string, request: string, cities: readonly string[]): boolean {
  const hay = ` ${comparable(text)} `;
  const metroAsked =
    / regiao metropolitana | rm[a-z]{1,3} /.test(` ${comparable(request)} `) ||
    greaterArea(request) !== null;
  if (!metroAsked && / regiao metropolitana | rm[a-z]{1,3} /.test(hay)) return true;
  if (cities.length === 0 || regionExtent(request, cities) !== null) return false;
  return cities.some((city) => {
    const name = normalizeCity(city);
    return new RegExp(
      ` (regiao|entorno|arredores) (de|do|da) ${name} | ${name} e regiao | (entorno|arredores) `,
    ).test(hay);
  });
}

function clean(text: string | null | undefined, max: number): string | null {
  if (!text) return null;
  const value = text.replace(/\s+/g, ' ').trim();
  return value ? value.slice(0, max) : null;
}

function unique<T>(items: readonly T[]): T[] {
  return [...new Set(items)];
}

function dateOnly(value: string | null): string | null {
  return value && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : null;
}

/**
 * CNPJ da própria empresa na página: o primeiro válido que não aparece como de quem fez o site
 * (agência, hospedagem). Mesma leitura do vínculo pelo site da investigação (KI-152).
 */
export function cnpjInText(text: string): string | null {
  return findCnpjsInText(text).find((mention) => !mention.thirdParty)?.cnpj ?? null;
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function addMonths(date: Date, months: number): Date {
  const result = new Date(date.getTime());
  result.setUTCMonth(result.getUTCMonth() + months);
  return result;
}

function relationFor(
  category: HostCategory | null,
  kind: ResultKind | undefined,
): ProspectSourceRelation {
  switch (category) {
    case 'news':
      return 'news';
    case 'job_board':
      return 'job_post';
    case 'directory':
    case 'marketplace':
      return 'directory';
    case 'social':
    case 'government':
    case 'reference':
      return 'mention';
    default:
      if (kind === 'news') return 'news';
      if (kind === 'job_post') return 'job_post';
      if (kind === 'directory') return 'directory';
      return 'mention';
  }
}

// -----------------------------------------------------------------------------
// Interpretação e plano
// -----------------------------------------------------------------------------

const EXTENT_LABELS: Record<RegionExtent, string> = {
  metropolitan: 'e região metropolitana',
  surroundings: 'e região',
};

export function regionLabel(
  intent: Pick<DiscoveryIntent, 'region'>,
  extent: RegionExtent | null = null,
  district: string | null = null,
): string {
  const { cities, ufs } = intent.region;
  if (cities.length > 0) {
    const around = extent ? ` ${EXTENT_LABELS[extent]}` : '';
    const where = district ? `${district}, ${cities.join(', ')}` : cities.join(', ');
    return `${where}${around}${ufs.length === 1 ? ` (${ufs[0]})` : ''}`;
  }
  if (ufs.length > 0) return ufs.join(', ');
  return 'Brasil';
}

export function buildIntent(
  run: Pick<DiscoveryRun, 'request' | 'options' | 'limits'>,
  output: InterpreterOutput,
): DiscoveryIntent {
  const options = run.options;
  const depth = options.depth ?? 'standard';
  const defaults: string[] = [];
  // O modelo só propõe: cidade que não está no pedido é descartada (ele às vezes inventa a região),
  // e a UF dele só fica se estiver no pedido ou acompanhar uma cidade que está.
  // Bairro citado como bairro ("no bairro Savassi", "no Batel, em Curitiba") não é cidade, e
  // "Grande BH" quer dizer Belo Horizonte e a região metropolitana (KI-148).
  const greater = options.city ? null : greaterArea(run.request);
  // "Grande BH" e "BH", vindos do modelo, já estão na área: não viram cidade à parte.
  const inGreater = (city: string) =>
    greater !== null &&
    (normalizeCity(city).startsWith('grande ') ||
      ` ${comparable(run.request)} `.includes(` grande ${normalizeCity(city)} `));
  // "Pousadas no Guarujá, em São Paulo": depois de um município, o nome do estado é o estado.
  const hay = ` ${comparable(run.request)} `;
  const named = output.cities.filter((city) => cityIn(city, run.request) && !inGreater(city));
  const stateAfterCity =
    (Object.keys(STATE_NAMES) as UF[]).find((uf) => {
      const name = normalizeCity(STATE_NAMES[uf]);
      return named.some(
        (city) =>
          normalizeCity(city) !== name &&
          !districtLike(city) &&
          hay.includes(` ${normalizeCity(city)} em ${name} `),
      );
    }) ?? null;
  const state = options.city ? null : (stateArea(run.request) ?? stateAfterCity);
  const stateName = state ? normalizeCity(STATE_NAMES[state]) : null;
  const written = named.filter((city) => normalizeCity(city) !== stateName);
  // "no Batel, em Curitiba" com só "Batel" do modelo: vale Curitiba, escrita no pedido.
  const kept = written.flatMap((city) => {
    const others = written.filter((other) => other !== city);
    const host = districtHost(city, run.request);
    const hostCity = host && cityIn(host, run.request) ? [host] : [];
    if (districtInRequest(city, run.request, others)) return hostCity;
    return hostCity.length > 0 ? hostCity : [city];
  });
  const cities = options.city
    ? [options.city]
    : [...(greater?.cities ?? []), ...kept]
        .filter(
          (city, index, all) =>
            all.findIndex((other) => normalizeCity(other) === normalizeCity(city)) === index,
        )
        .slice(0, 10);
  const district = options.city ? null : requestedDistrict(run.request, output.cities, cities);
  const modelUfs = output.ufs.filter(
    (uf) => ufIn(uf, run.request) || stateNameIn(uf, run.request) || cities.length > 0,
  );
  const ufs = unique([
    ...(options.uf ? [options.uf] : []),
    ...(greater ? [greater.uf] : []),
    ...(state ? [state] : []),
    ...modelUfs,
  ]).slice(0, 5);
  // "Curitiba e região metropolitana": a região vai além das cidades citadas (KI-148).
  const extent = cities.length > 0 && !options.city ? regionExtent(run.request, cities) : null;
  let scope = output.regionScope;
  if (extent) scope = 'region';
  // Com cidades e sem região em volta no pedido, a pesquisa é na cidade ("região da Savassi",
  // "região central de Campinas"): o "region" do modelo não amplia nada.
  else if (
    options.city ||
    (cities.length > 0 && (scope === 'unspecified' || scope === 'country' || scope === 'region'))
  ) {
    scope = 'city';
  } else if (cities.length === 0 && ufs.length > 0 && scope !== 'region') scope = 'state';
  if (cities.length === 0 && ufs.length === 0) {
    scope = 'country';
    defaults.push('Região: o pedido não cita cidade nem estado; a busca vale para o Brasil.');
  }
  const asked = options.quantity ?? output.quantity;
  const quantity = Math.max(1, Math.min(asked ?? DEFAULT_QUANTITY[depth], run.limits.maxProspects));
  if (asked === null) defaults.push(`Quantidade: até ${quantity} empresas (padrão).`);
  else if (asked > run.limits.maxProspects) {
    defaults.push(`Quantidade: até ${quantity} empresas (limite desta profundidade).`);
  }
  if (!options.depth) defaults.push('Profundidade: padrão.');
  // Sinal que o pedido não pede (pelas palavras dele) não entra: o modelo às vezes acrescenta.
  const modelSignals = signalsAsked(run.request, output.signals);
  const signals = unique([...options.signals, ...modelSignals]).slice(0, 6);
  // "Clínicas" não vira "clínicas médicas": a especialidade que o pedido não diz sai (KI-115),
  // quando o que sobra é o que o pedido diz ("pet shops e clínicas" não sobra de "pet shops").
  const narrowed = output.segment
    ?.split(' ')
    .filter((word) => narrowingWords(word, run.request).length === 0)
    .join(' ')
    .trim();
  const segment =
    narrowed && narrowed !== output.segment && stemsCover(run.request, narrowed)
      ? narrowed
      : output.segment;
  // Termos em inglês que não se usam no Brasil trazem resultados de fora (KI-148), e termo com
  // especialidade que o pedido não diz estreita a busca (KI-115).
  const terms = output.segmentTerms.filter(
    (term) =>
      foreignSearchWords(term, run.request).length === 0 &&
      narrowingWords(term, run.request).length === 0,
  );
  const intent: DiscoveryIntent = {
    summary: '',
    segment,
    segmentTerms: terms.length > 0 ? terms : segment ? [segment] : [],
    region: { scope, cities, ufs, label: null },
    sizeHint: output.sizeHint,
    services: output.services,
    signals,
    quantity,
    depth,
    constraints: output.constraints,
    defaultsApplied: defaults.slice(0, 8),
  };
  intent.region.label = regionLabel(intent, extent, district).slice(0, 120);
  // Resumo do modelo que perdeu a região em volta das cidades ou o bairro pedido, ou que fala em
  // região metropolitana sem o pedido falar ("Padarias em Piracicaba e região", 3 de 3 vezes na
  // avaliação de 2026-11-25), dá lugar ao do servidor.
  const lost =
    (extent !== null && !/regi[aã]o/i.test(output.summary ?? '')) ||
    (extent !== 'metropolitan' && /metropolitan/i.test(output.summary ?? '')) ||
    (district !== null && !comparable(output.summary ?? '').includes(comparable(district))) ||
    narrowingWords(output.summary ?? '', run.request).length > 0 ||
    modelSignals.length < output.signals.length;
  const summary = lost ? null : output.summary;
  intent.summary = (
    summary ??
    `Empresas${segment ? ` de ${segment}` : ''} em ${intent.region.label}${
      signals.length > 0 ? ', com sinais comerciais' : ''
    }.`
  ).slice(0, 300);
  return intent;
}

/** Chave para não repetir busca: sem acento, caixa, pontuação nem plural simples. */
function queryKey(text: string): string {
  return comparable(text)
    .split(' ')
    .filter((word) => !['de', 'da', 'do', 'das', 'dos', 'em', 'e'].includes(word))
    .map((word) => (word.length > 3 ? word.replace(/s$/, '') : word))
    .join(' ');
}

/** Raízes das palavras de uma busca ("veterinário" e "veterinária" dão a mesma). */
function stems(text: string): Set<string> {
  return new Set(
    queryKey(text)
      .split(' ')
      .filter(Boolean)
      .map((word) => word.slice(0, 6)),
  );
}

/** A busca já cobre o termo (todas as raízes do termo estão nela)? */
function stemsCover(query: string, term: string): boolean {
  const inQuery = stems(query);
  return [...stems(term)].every((stem) => inQuery.has(stem));
}

/** Termos sem repetir o mesmo negócio ("clínica veterinária" já cobre "veterinário"). */
function distinctByStem(terms: readonly string[]): string[] {
  const kept: string[] = [];
  const glued = (text: string) => queryKey(text).replace(/ /g, '');
  for (const term of terms) {
    if (!term.trim()) continue;
    const same = (other: string) =>
      stemsCover(other, term) || stemsCover(term, other) || glued(other) === glued(term);
    if (kept.some(same)) continue;
    kept.push(term);
  }
  return kept;
}

function queryText(text: string): string | null {
  const value = text
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300);
  return WebSearchQuery.safeParse(value).success ? value : null;
}

/** Plano de buscas: o do modelo, conferido e completado pelo servidor, dentro do limite. */
export function buildPlan(
  request: string,
  output: InterpreterOutput,
  intent: DiscoveryIntent,
  maxSearches: number,
): DiscoveryPlan {
  const queries: DiscoveryQuery[] = [];
  const seen = new Set<string>();
  const add = (
    text: string,
    purpose: DiscoveryQuery['purpose'],
    signal: SignalType | null,
    recent: boolean,
  ) => {
    const value = queryText(text);
    if (!value) return;
    const key = queryKey(value);
    if (seen.has(key)) return;
    seen.add(key);
    queries.push({
      text: value,
      purpose,
      signal,
      topic: purpose === 'signals' && signal !== 'hiring' ? 'news' : 'general',
      timeRange: recent || purpose === 'signals' ? 'year' : null,
    });
  };
  for (const query of output.queries) {
    // "pet clinic Curitiba" volta com resultados de fora (KI-148); "clínica médica" estreita
    // "clínicas" (KI-115); "identidade visual" ou "vagas" numa busca procuram sinal que o pedido
    // não pede, qualquer que seja o rótulo (segunda revisão do KI-148).
    if (foreignSearchWords(query.text, request).length > 0) continue;
    if (narrowingWords(query.text, request).length > 0) continue;
    if (unrequestedSignalWords(query.text, request, intent.signals).length > 0) continue;
    if (aroundNotAsked(query.text, request, intent.region.cities)) continue;
    // Busca de sinal que o pedido não pede gasta crédito com o que a pessoa não quer: "Clínicas em
    // Ribeirão Preto" ganhava "clínicas abre vagas marketing" (revisão do KI-148).
    if (query.purpose === 'signals' && (!query.signal || !intent.signals.includes(query.signal))) {
      continue;
    }
    add(
      query.text,
      query.purpose,
      query.purpose === 'signals' ? (query.signal ?? null) : null,
      query.recent,
    );
  }
  const subject = intent.segment ?? intent.segmentTerms[0] ?? request.slice(0, 120);
  const city = intent.region.cities[0] ?? null;
  // Bairro pedido ("no bairro Savassi, em Belo Horizonte") entra nas buscas: sem ele, o plano
  // procurava a cidade inteira (revisão do KI-148).
  const mentions = (text: string, place: string) => comparable(text).includes(comparable(place));
  const named = city ? requestedDistrict(request, output.cities, intent.region.cities) : null;
  // O mesmo bairro que a interpretação pôs no rótulo (pesquisa com cidade fixa não tem bairro).
  const district = named && mentions(intent.region.label ?? '', named) ? named : null;
  const where = city ? (district ? `${district} ${city}` : city) : (intent.region.ufs[0] ?? '');
  if (
    !queries.some(
      // Com bairro, a busca de empresas precisa do bairro e da cidade: "cafeterias Batel" sozinha
      // acha o Batel de outros lugares.
      (query) =>
        query.purpose === 'companies' &&
        (!district || (mentions(query.text, district) && mentions(query.text, city ?? ''))),
    )
  ) {
    add(`${subject} ${where}`.trim(), 'companies', null, false);
  }
  // Pedido com sinais: uma busca de sinal por tipo de negócio do pedido ("pet shops e clínicas
  // veterinárias" → uma para cada) e uma na região em volta da cidade, quando o pedido inclui.
  // Na pesquisa real de 2026-11-24 (KI-148) só 1 de 4 buscas procurava o sinal pedido.
  const extent =
    city && intent.region.scope === 'region' ? regionExtent(request, intent.region.cities) : null;
  const around =
    city && extent
      ? `${extent === 'metropolitan' ? 'região metropolitana' : 'região'} de ${city}`
      : null;
  // Só os negócios que o próprio pedido cita: "saúde", sinônimo que o modelo acrescentou a
  // "clínicas", não ganha busca de sinal só sua.
  const asked = `${intent.segment ?? ''} ${request}`;
  const signalSubjects = distinctByStem([
    ...intent.segmentTerms.filter((term) => stemsCover(asked, term)),
    subject,
  ]).slice(0, 3);
  const firstSubject = signalSubjects[0] ?? subject;
  for (const signal of intent.signals) {
    if (!queries.some((query) => query.signal === signal)) {
      add(`${firstSubject} ${SIGNAL_QUERY_TERMS[signal]} ${where}`.trim(), 'signals', signal, true);
    }
  }
  if (around) {
    for (const signal of intent.signals) {
      add(`${firstSubject} ${SIGNAL_QUERY_TERMS[signal]} ${around}`, 'signals', signal, true);
    }
  }
  for (const term of signalSubjects) {
    for (const signal of intent.signals) {
      const covered = queries.some(
        (query) =>
          query.signal === signal &&
          !(around && query.text.endsWith(around)) &&
          stemsCover(query.text, term),
      );
      if (!covered) {
        add(`${term} ${SIGNAL_QUERY_TERMS[signal]} ${where}`.trim(), 'signals', signal, true);
      }
    }
  }
  if (queries.length === 0) add(request, 'companies', null, false);
  // Poucas buscas de empresas para a quantidade pedida: completa com variações (outras cidades da
  // região, outros termos do setor). Achado da pesquisa real de 2026-11-11 (KI-117): a IA propôs
  // uma busca só para 15 empresas, e sobraram 2 das 3 buscas da profundidade rápida.
  const wanted = Math.ceil(intent.quantity / Math.max(1, RESULTS_PER_SEARCH[intent.depth] - 1));
  const subjectWords = new Set(queryKey(subject).split(' '));
  const variations = [
    ...(around ? [`${subject} ${around}`] : []),
    ...intent.region.cities.slice(1).map((other) => `${subject} ${other}`),
    ...(intent.region.cities.length === 0
      ? intent.region.ufs.slice(1).map((uf) => `${subject} ${uf}`)
      : []),
    // Termo que só repete palavras do setor ("clínica de saúde" para "clínicas de saúde",
    // "saúde") não traz empresas novas.
    ...intent.segmentTerms
      .filter((term) =>
        queryKey(term)
          .split(' ')
          .some((word) => !subjectWords.has(word)),
      )
      .map((term) => `${term} ${where}`.trim()),
  ];
  for (const variation of variations) {
    if (queries.filter((query) => query.purpose === 'companies').length >= wanted) break;
    add(variation, 'companies', null, false);
  }
  // Empresas primeiro (a do bairro pedido na frente, de preferência com a cidade), depois um sinal
  // de cada tipo, até o limite.
  const companies = queries.filter((query) => query.purpose === 'companies');
  const withDistrict = district ? companies.filter((query) => mentions(query.text, district)) : [];
  const front = [
    ...withDistrict.filter((query) => mentions(query.text, city ?? '')),
    ...withDistrict.filter((query) => !mentions(query.text, city ?? '')),
  ];
  const rest = companies.filter((query) => !front.includes(query));
  const ordered = [
    ...[...front, ...rest].slice(0, 1),
    ...queries.filter((query) => query.purpose === 'signals'),
    ...[...front, ...rest].slice(1),
  ];
  return { queries: ordered.slice(0, Math.min(maxSearches, DISCOVERY_MAX_QUERIES)) };
}

// -----------------------------------------------------------------------------
// Motor
// -----------------------------------------------------------------------------

export function createDiscoveryEngine(deps: DiscoveryEngineDeps): DiscoveryEngine {
  const { repo, ai, web } = deps;
  const clock = deps.clock ?? systemClock;
  const log = deps.log ?? ((message: string) => console.warn(message));
  const nowIso = () => clock.now().toISOString();

  async function loadStrategy(ctx: RequestContext, run: DiscoveryRun): Promise<StrategyContext> {
    try {
      const { snapshot } = await deps.strategy.overview(ctx);
      const icp =
        (run.options.icpId
          ? snapshot.icps.find((item) => item.id === run.options.icpId)
          : snapshot.icps.find((item) => item.status === 'active' && item.current !== null)) ??
        null;
      const offer =
        (icp
          ? snapshot.offers.find((item) => item.id === icp.offerId)
          : snapshot.offers.find((item) => item.status === 'active')) ?? null;
      const scoring = offer
        ? (snapshot.scoringModels.find((item) => item.offerId === offer.id) ?? null)
        : null;
      return { icp, offer, scoring };
    } catch (error) {
      // Estratégia é opcional para pesquisar: sem ela, a triagem usa só o pedido.
      log(`[descoberta] estratégia indisponível para a triagem: ${String(error)}`);
      return { icp: null, offer: null, scoring: null };
    }
  }

  async function finish(
    run: DiscoveryRun,
    status: 'completed' | 'failed' | 'cancelled',
    patch: {
      progress?: DiscoveryProgress;
      partial?: boolean;
      failureCode?: DiscoveryFailure | null;
    },
  ): Promise<EngineOutcome> {
    await repo.updateRun(run.id, {
      status,
      stage: status === 'completed' ? 'done' : run.stage,
      finishedAt: nowIso(),
      ...(patch.progress ? { progress: patch.progress } : {}),
      partial: patch.partial ?? false,
      failureCode: patch.failureCode ?? null,
    });
    return { kind: 'finished', status };
  }

  async function execute(runId: string, options: ExecuteOptions): Promise<EngineOutcome> {
    const loaded = await repo.getRun(runId);
    if (!loaded) return { kind: 'finished', status: 'failed' };
    if (
      loaded.status === 'completed' ||
      loaded.status === 'failed' ||
      loaded.status === 'cancelled'
    ) {
      return { kind: 'finished', status: loaded.status };
    }
    if (loaded.status === 'draft') return { kind: 'finished', status: 'cancelled' };
    let run: DiscoveryRun = loaded;
    const progress: DiscoveryProgress = { ...run.progress };
    if (run.cancelRequestedAt) return finish(run, 'cancelled', { progress, partial: false });

    const ctx: RequestContext = {
      actor: { type: 'system', component: 'discovery-worker' },
      traceId: run.traceId,
    };
    const now = clock.now();
    const today = calendarDate(now);
    const retentionUntil = addMonths(now, RETENTION_MONTHS).toISOString();
    let stopFailure: DiscoveryFailure | null = null;

    const checkCancel = async () => {
      if (options.signal.aborted) throw new Cancelled();
      const fresh = await repo.getRun(run.id);
      if (!fresh || fresh.cancelRequestedAt) throw new Cancelled();
    };
    const setStage = async (stage: DiscoveryRun['stage']) => {
      run = { ...run, stage };
      await repo.updateRun(run.id, { stage, progress });
    };

    await repo.updateRun(run.id, {
      status: 'running',
      startedAt: run.startedAt ?? nowIso(),
      stage: run.stage ?? 'interpreting',
    });
    run = { ...run, status: 'running', stage: run.stage ?? 'interpreting' };

    try {
      const strategy = await loadStrategy(ctx, run);

      // 1. Entender o pedido e planejar (só na primeira vez; ao retomar, reaproveita).
      let intent = run.intent;
      let plan = run.plan;
      if (!intent || !plan) {
        const icpContent = strategy.icp?.current?.content ?? null;
        const output = await ai.interpret(
          {
            request: run.request,
            options: run.options,
            today,
            context: {
              offer: strategy.offer?.current?.content.name ?? null,
              icpRegions: icpContent
                ? [
                    ...icpContent.filters.municipalities.map((item) => `${item.name}/${item.uf}`),
                    ...icpContent.filters.ufs,
                  ].slice(0, 10)
                : [],
              services: Object.values(SERVICE_HINT_LABELS),
            },
          },
          options.signal,
        );
        intent = buildIntent(run, output);
        plan = buildPlan(run.request, output, intent, run.limits.maxSearches);
        progress.searchesPlanned = plan.queries.length;
        await repo.updateRun(run.id, {
          intent,
          plan,
          progress,
          stage: 'searching',
          promptIds: [ai.promptIds.interpreter, ai.promptIds.extractor],
          icpId: strategy.icp?.id ?? null,
          icpVersionId: strategy.icp?.current?.id ?? null,
          offerId: strategy.offer?.id ?? null,
          scoringModelVersionId: strategy.scoring?.id ?? null,
        });
        run = { ...run, intent, plan, stage: 'searching' };
      }
      await checkCancel();

      // 2. Buscar (cada busca feita fica gravada: retomada não gasta crédito de novo).
      const stored = new Map((await repo.listQueries(run.id)).map((row) => [row.position, row]));
      const perSearch = RESULTS_PER_SEARCH[intent.depth];
      let transientFailures = 0;
      for (const [position, query] of plan.queries.entries()) {
        if (stored.get(position)?.status === 'done') continue;
        await checkCancel();
        const outcome = await web.search(ctx, {
          query: query.text,
          maxResults: perSearch,
          topic: query.topic,
          timeRange: query.timeRange,
          region: 'br',
        });
        const fetchedAt = nowIso();
        if (outcome.ok) {
          const row: DiscoveryRunQuery = {
            runId: run.id,
            position,
            query,
            status: 'done',
            results: outcome.results.slice(0, 10).map((result) => ({
              rank: result.rank,
              url: result.url,
              title: result.title.slice(0, 300),
              snippet: result.snippet.slice(0, 600),
              publishedAt: dateOnly(result.publishedAt),
            })),
            creditsCharged: outcome.creditsCharged,
            fetchedAt,
            failure: null,
          };
          await repo.saveQuery({ ...row, retentionUntil });
          stored.set(position, row);
          progress.creditsUsed += outcome.creditsCharged;
        } else {
          const failure = outcome.failure;
          await repo.saveQuery({
            runId: run.id,
            position,
            query,
            status: 'failed',
            results: [],
            creditsCharged: 0,
            fetchedAt,
            failure,
            retentionUntil,
          });
          const stop = stopFor(failure);
          if (stop) {
            stopFailure = stop;
            break;
          }
          transientFailures += 1;
        }
        progress.searchesDone = [...stored.values()].filter((row) => row.status === 'done').length;
        await repo.updateRun(run.id, { progress });
      }
      const doneQueries = [...stored.values()].filter((row) => row.status === 'done');
      progress.searchesDone = doneQueries.length;
      if (doneQueries.length === 0) {
        if (stopFailure) throw new StopRun(stopFailure);
        if (transientFailures > 0 && !options.lastAttempt) {
          return requeue(run, progress, 'search_unavailable', options);
        }
        throw new StopRun('search_unavailable');
      }
      if (transientFailures > 0) stopFailure ??= 'search_unavailable';

      // 3. Identificar empresas e sinais nos resultados (IA local, conferida no servidor).
      const results = collectResults(doneQueries);
      const candidates: Candidate[] = [];
      for (let start = 0; start < results.length; start += EXTRACT_BATCH) {
        await checkCancel();
        const batch = results.slice(start, start + EXTRACT_BATCH);
        const output = await ai.extract(
          {
            intent,
            today,
            results: batch.map((result, index) => ({
              n: index + 1,
              url: result.url,
              host: result.host,
              hostKind: result.hostKind,
              title: result.title,
              snippet: result.snippet,
              publishedAt: result.publishedAt,
            })),
          },
          options.signal,
        );
        absorb(candidates, batch, output, intent.region, clock.now());
      }

      // 4. Conferir sites oficiais (nível 2), começando pelas mais promissoras.
      await setStage('verifying');
      rank(candidates, intent);
      let pages = 0;
      for (const candidate of candidates) {
        if (pages >= run.limits.maxPages) break;
        if (!candidate.websiteUrl) continue;
        await checkCancel();
        pages += 1;
        progress.pagesRead += 1;
        await verifySite(ctx, candidate, intent);
      }
      await repo.updateRun(run.id, { progress });

      // 5. Deduplicar, gravar e fazer a triagem, uma empresa por vez (progresso parcial salvo).
      await setStage('qualifying');
      rank(candidates, intent);
      const selected = candidates.slice(0, intent.quantity);
      for (const [index, candidate] of selected.entries()) {
        await checkCancel();
        const saved = await persist(
          ctx,
          run,
          candidate,
          index + 1,
          strategy,
          intent,
          retentionUntil,
        );
        progress.prospects += saved.counted ? 1 : 0;
        progress.newProspects += saved.isNew ? 1 : 0;
        progress.signals += saved.signals;
        await repo.updateRun(run.id, { progress });
      }
      const partial = stopFailure !== null;
      return await finish(run, 'completed', { progress, partial, failureCode: stopFailure });
    } catch (error) {
      if (
        error instanceof Cancelled ||
        (options.signal.aborted && error instanceof DiscoveryAiError)
      ) {
        const fresh = await repo.getRun(run.id);
        if (fresh && !fresh.cancelRequestedAt && options.signal.aborted) {
          // O trabalhador perdeu o lease (não foi cancelamento): quem pegou a tarefa continua.
          return { kind: 'retry', errorCode: 'lease_lost', retryAfterSeconds: 5 };
        }
        return finish(run, 'cancelled', {
          progress,
          partial: progress.searchesDone > 0 || progress.prospects > 0,
        });
      }
      if (error instanceof StopRun) {
        return finish(run, 'failed', {
          progress,
          partial: progress.prospects > 0,
          failureCode: error.failure,
        });
      }
      if (error instanceof DiscoveryAiError) {
        if (RETRYABLE_AI.has(error.code) && !options.lastAttempt) {
          return requeue(run, progress, `ai_${error.code}`, options);
        }
        const failure: DiscoveryFailure =
          error.code === 'runtime_unavailable' ||
          error.code === 'model_not_installed' ||
          error.code === 'invalid_config'
            ? 'ai_unavailable'
            : 'ai_failed';
        return finish(run, 'failed', {
          progress,
          partial: progress.prospects > 0,
          failureCode: failure,
        });
      }
      if (isAppError(error) && error.code === 'unavailable') {
        try {
          if (!options.lastAttempt)
            return await requeue(run, progress, 'database_unavailable', options);
          return await finish(run, 'failed', {
            progress,
            partial: progress.prospects > 0,
            failureCode: 'database_unavailable',
          });
        } catch {
          // Banco fora: a tarefa volta para a fila pelo lease vencido.
          return { kind: 'retry', errorCode: 'database_unavailable', retryAfterSeconds: 60 };
        }
      }
      log(
        `[descoberta] falha inesperada na pesquisa ${run.id} (trace ${run.traceId}): ${String(error)}`,
      );
      return finish(run, 'failed', {
        progress,
        partial: progress.prospects > 0,
        failureCode: 'unexpected',
      });
    }
  }

  async function requeue(
    run: DiscoveryRun,
    progress: DiscoveryProgress,
    errorCode: string,
    options: ExecuteOptions,
  ): Promise<EngineOutcome> {
    await repo.updateRun(run.id, { status: 'queued', progress });
    return {
      kind: 'retry',
      errorCode: errorCode.slice(0, 60),
      retryAfterSeconds: Math.min(600, 30 * 2 ** Math.max(0, options.attempt - 1)),
    };
  }

  function stopFor(failure: WebSearchFailure): DiscoveryFailure | null {
    switch (failure) {
      case 'not_configured':
        return 'search_not_configured';
      case 'disabled':
        return 'search_disabled';
      case 'budget_exhausted':
        return 'budget_exhausted';
      case 'quota_exceeded':
        return 'quota_exceeded';
      case 'unauthorized':
        return 'search_unavailable';
      default:
        return null;
    }
  }

  function collectResults(queries: readonly DiscoveryRunQuery[]): SearchResultRow[] {
    const seen = new Set<string>();
    const rows: SearchResultRow[] = [];
    for (const query of [...queries].sort((a, b) => a.position - b.position)) {
      for (const result of query.results) {
        const host = hostOf(result.url);
        if (!host || seen.has(result.url)) continue;
        seen.add(result.url);
        if (!extractableResult(result)) continue;
        rows.push({ ...result, host, hostKind: hostCategory(host) });
      }
    }
    return rows;
  }

  async function verifySite(
    ctx: RequestContext,
    candidate: Candidate,
    intent: DiscoveryIntent,
  ): Promise<void> {
    if (!candidate.websiteUrl) return;
    const outcome = await web.readPage(ctx, { url: candidate.websiteUrl });
    if (!outcome.ok) return;
    const page = outcome.page;
    const text = `${page.title ?? ''} ${page.description ?? ''} ${page.text}`;
    if (!nameFoundIn(candidate.name, text)) return;
    candidate.siteVerified = true;
    const host = hostOf(page.url) ?? hostOf(candidate.websiteUrl) ?? '';
    candidate.sources.set(page.url, {
      url: page.url,
      host,
      title: clean(page.title, 300),
      snippet: page.noArchive
        ? ''
        : (clean(page.description ?? page.text, DISCOVERY_SNIPPET_MAX) ?? ''),
      kind: 'web_page',
      relation: 'official_site',
      provider: 'prospector',
      publishedAt: null,
    });
    candidate.cnpj ??= cnpjInText(page.text);
    if (!candidate.city) {
      const city = intent.region.cities.find((item) => cityIn(item, text));
      if (city) {
        candidate.city = city;
        candidate.uf ??= intent.region.ufs.length === 1 ? (intent.region.ufs[0] ?? null) : null;
      }
    }
  }

  async function companyLink(candidate: Candidate): Promise<{
    id: string;
    lifecycle: CompanyLifecycle;
    sizeBand: CompanySize | null;
  } | null> {
    const keys: Array<{ kind: 'domain' | 'cnpj'; value: string }> = [];
    if (candidate.siteKey && !candidate.siteKey.includes('/'))
      keys.push({ kind: 'domain', value: candidate.siteKey });
    if (candidate.cnpj) keys.push({ kind: 'cnpj', value: candidate.cnpj });
    if (keys.length === 0) return null;
    const company = await deps.companies.findByStrongIdentifier(keys);
    return company
      ? { id: company.id, lifecycle: company.lifecycle, sizeBand: company.sizeBand }
      : null;
  }

  async function persist(
    ctx: RequestContext,
    run: DiscoveryRun,
    candidate: Candidate,
    position: number,
    strategy: StrategyContext,
    intent: DiscoveryIntent,
    retentionUntil: string,
  ): Promise<{ isNew: boolean; counted: boolean; signals: number }> {
    const now = nowIso();
    const dedupe: DedupeCandidate = {
      name: candidate.name,
      siteKey: candidate.siteKey,
      city: candidate.city,
      uf: candidate.uf,
      cnpj: candidate.cnpj,
    };
    const dedupeKey = prospectDedupeKey(dedupe);
    // Chave de busca pelo nome: o núcleo (sem cidade no fim nem segmento no começo ou, da lista
    // curta, no fim), para achar o mesmo nome escrito de outro jeito. As gravadas antes também
    // valem: a do KI-147 (`legacy`) e a mais antiga (nome normalizado inteiro).
    const nameKey =
      companyNameCore(candidate.name, [candidate.city, candidate.uf]).slice(0, 160) ||
      dedupeKey.slice(0, 160);
    const fullNameKey = normalizeCompanyName(candidate.name).slice(0, 160);
    const legacyNameKey = companyNameCore(candidate.name, [candidate.city, candidate.uf], {
      legacy: true,
    }).slice(0, 160);
    const domain = candidate.siteKey;
    const known = await repo.findProspects({
      dedupeKeys: [dedupeKey],
      domains: domain ? [domain] : [],
      cnpjRoots: candidate.cnpj ? [candidate.cnpj.slice(0, 8)] : [],
      nameKeys: unique([nameKey, legacyNameKey, fullNameKey].filter(Boolean)),
    });
    const match = findSameCompany(
      dedupe,
      known.map((item) => ({
        id: item.id,
        name: item.displayName,
        siteKey: item.domain,
        city: item.city,
        uf: item.uf,
        cnpj: item.cnpj,
      })),
    );
    const link = await companyLink(candidate);

    let prospect: ProspectRecord;
    let isNew = false;
    let matchedBy: MatchReason | null = null;
    const existing = match ? known.find((item) => item.id === match.target.id) : undefined;
    if (existing && match) {
      matchedBy = match.reason;
      prospect = existing;
      const sitePatch: ProspectPatch =
        !existing.domain && domain && dedupeKey.startsWith('domain:')
          ? { domain, websiteUrl: candidate.websiteUrl, dedupeKey }
          : {};
      const patch: ProspectPatch = {
        lastSeenAt: now,
        lastRunId: run.id,
        ...(!existing.city && candidate.city ? { city: candidate.city } : {}),
        ...(!existing.uf && candidate.uf ? { uf: candidate.uf } : {}),
        ...(!existing.segment && candidate.segment ? { segment: candidate.segment } : {}),
        ...(!existing.description && candidate.description
          ? { description: candidate.description }
          : {}),
        ...(!existing.cnpj && candidate.cnpj ? { cnpj: candidate.cnpj } : {}),
        ...(candidate.siteVerified ? { siteVerified: true, lastVerifiedAt: now } : {}),
      };
      let applied: ProspectPatch = { ...patch, ...sitePatch };
      try {
        await repo.updateProspect(existing.id, applied);
      } catch (error) {
        // Outra empresa já tem a chave do site: mantém a chave antiga.
        if (!(isAppError(error) && error.code === 'conflict') || !sitePatch.dedupeKey) throw error;
        applied = patch;
        await repo.updateProspect(existing.id, applied);
      }
      prospect = { ...existing, ...applied };
      if (link && !existing.companyId) {
        await repo.setProspectStatus(
          existing.id,
          {
            status: existing.status,
            dismissedReason: existing.dismissedReason,
            companyId: link.id,
          },
          pendingAudit(ctx, {
            action: 'discovery.prospect.company_linked',
            entityType: 'discovery_prospect',
            entityId: existing.id,
            diff: { companyId: link.id },
          }),
        );
        prospect = { ...prospect, companyId: link.id };
      }
    } else {
      isNew = true;
      try {
        prospect = await repo.insertProspect({
          id: deps.newId?.() ?? crypto.randomUUID(),
          dedupeKey,
          nameKey,
          displayName: candidate.name.slice(0, 160),
          domain,
          websiteUrl: candidate.websiteUrl,
          segment: candidate.segment,
          city: candidate.city,
          uf: candidate.uf,
          description: candidate.description,
          cnpj: candidate.cnpj,
          companyId: link?.id ?? null,
          status: 'new',
          dismissedReason: null,
          priority: 'insufficient',
          priorityScore: null,
          confidence: 'low',
          assessment: null,
          siteVerified: candidate.siteVerified,
          firstSeenAt: now,
          lastSeenAt: now,
          lastVerifiedAt: candidate.siteVerified ? now : null,
          firstRunId: run.id,
          lastRunId: run.id,
          isDemo: run.isDemo,
        });
      } catch (error) {
        if (!(isAppError(error) && error.code === 'conflict')) throw error;
        // Corrida com outra gravação da mesma chave: usa a que ficou.
        const [again] = await repo.findProspects({
          dedupeKeys: [dedupeKey],
          domains: [],
          cnpjRoots: [],
          nameKeys: [],
        });
        if (!again) throw error;
        prospect = again;
        isNew = false;
      }
    }

    await repo.linkRunProspect({
      runId: run.id,
      prospectId: prospect.id,
      isNew,
      matchedBy,
      position,
    });

    const sources = await repo.upsertSources(
      [...candidate.sources.values()].map((source): NewProspectSource => ({
        prospectId: prospect.id,
        runId: run.id,
        url: source.url,
        host: source.host,
        title: source.title,
        snippet: source.snippet,
        kind: source.kind,
        relation: source.relation,
        provider: source.provider,
        publishedAt: source.publishedAt,
        capturedAt: now,
        retentionUntil,
      })),
    );
    const sourceByUrl = new Map(sources.map((source) => [source.url, source]));
    const signalRows: NewProspectSignal[] = [];
    for (const signal of candidate.signals) {
      const source = sourceByUrl.get(signal.url);
      if (!source) continue;
      signalRows.push({
        prospectId: prospect.id,
        runId: run.id,
        sourceId: source.id,
        type: signal.type,
        summary: signal.summary,
        quote: signal.quote,
        eventDate: signal.eventDate,
        publishedAt: signal.publishedAt,
        discoveredAt: now,
        verification: signal.verification,
        confidence: signal.confidence,
        relevance: signal.relevance,
        relatedService: signal.relatedService,
        rationale: signal.rationale,
        recency: signal.recency,
        fingerprint: await sha256Hex(
          signalFingerprintText({ prospectId: prospect.id, type: signal.type, url: signal.url }),
        ),
        retentionUntil,
      });
    }
    const inserted = signalRows.length > 0 ? await repo.insertSignals(signalRows) : [];

    // Triagem com tudo o que se sabe da empresa (todas as pesquisas).
    const [allSources, allSignals] = await Promise.all([
      repo.sourcesFor([prospect.id]),
      repo.signalsFor([prospect.id]),
    ]);
    const official = allSources.find((source) => source.relation === 'official_site');
    const icpContent = strategy.icp?.current?.content ?? null;
    const triage = assessProspect({
      name: prospect.displayName,
      domain: prospect.domain,
      hasOfficialSite: prospect.websiteUrl !== null,
      siteVerified: prospect.siteVerified || candidate.siteVerified,
      officialSiteSourceId: official?.id ?? null,
      segment: prospect.segment,
      description: prospect.description,
      city: prospect.city,
      uf: prospect.uf,
      cnpj: prospect.cnpj,
      sources: allSources.map((source) => ({ id: source.id, relation: source.relation })),
      signals: allSignals.map((signal) => ({
        type: signal.type,
        verification: signal.verification,
        relevance: signal.relevance,
        recency: signalRecency(signal.eventDate, signal.publishedAt, clock.now()),
        sourceId: signal.sourceId,
        summary: signal.summary,
      })),
      wanted: {
        segment: intent.segment,
        segmentTerms: intent.segmentTerms,
        cities: intent.region.cities,
        ufs: intent.region.ufs,
        signals: intent.signals,
      },
      icp:
        strategy.icp?.current && icpContent
          ? {
              versionId: strategy.icp.current.id,
              ufs: icpContent.filters.ufs,
              municipalities: icpContent.filters.municipalities,
              sizes: icpContent.filters.sizes,
              exclusions: {
                domains: icpContent.exclusions.domains,
                cnpjRoots: icpContent.exclusions.cnpjRoots,
                municipalities: icpContent.exclusions.municipalities,
              },
            }
          : null,
      scoring: strategy.scoring
        ? { versionId: strategy.scoring.id, weights: strategy.scoring.content.weights }
        : null,
      companyLifecycle: link?.lifecycle ?? null,
      sizeBand: link?.sizeBand ?? null,
      now: clock.now(),
    });
    await repo.updateProspect(prospect.id, {
      priority: triage.priority,
      priorityScore: triage.priorityScore,
      confidence: triage.confidence,
      assessment: triage.assessment,
    });
    return { isNew, counted: true, signals: inserted.length };
  }

  async function abandon(runId: string, cancelled: boolean): Promise<void> {
    const run = await repo.getRun(runId);
    if (!run || run.status === 'completed' || run.status === 'failed' || run.status === 'cancelled')
      return;
    await repo.updateRun(runId, {
      status: cancelled ? 'cancelled' : 'failed',
      failureCode: cancelled ? null : 'interrupted',
      partial: run.progress.prospects > 0,
      finishedAt: nowIso(),
    });
  }

  return { execute, abandon };
}

// -----------------------------------------------------------------------------
// Absorver a resposta do extrator (servidor confere nome, trecho e site oficial)
// -----------------------------------------------------------------------------

function rankScore(candidate: Candidate, intent: DiscoveryIntent): number {
  let score = 0;
  if (candidate.siteKey) score += 3;
  if (candidate.siteVerified) score += 2;
  score += Math.min(3, candidate.signals.length);
  score += candidate.signals.filter((signal) => signal.verification === 'confirmed').length;
  if (
    candidate.city &&
    intent.region.cities.some((city) => normalizeCity(city) === normalizeCity(candidate.city ?? ''))
  ) {
    score += 1;
  }
  return score;
}

function rank(candidates: Candidate[], intent: DiscoveryIntent): void {
  candidates.sort((a, b) => rankScore(b, intent) - rankScore(a, intent));
}

function findCandidate(candidates: readonly Candidate[], probe: DedupeCandidate): Candidate | null {
  const match = findSameCompany(
    probe,
    candidates.map((candidate, index) => ({
      id: String(index),
      name: candidate.name,
      siteKey: candidate.siteKey,
      city: candidate.city,
      uf: candidate.uf,
      cnpj: candidate.cnpj,
    })),
  );
  return match ? (candidates[Number(match.target.id)] ?? null) : null;
}

/**
 * Cidade da região pedida citada no próprio texto do resultado (e a UF, se a região tem uma só).
 * Sem ela, a mesma empresa achada por uma notícia (sem cidade) e pelo site (com cidade) ficaria
 * duplicada: nome igual só junta com localização compatível (`findSameCompany`).
 */
function regionPlaceOf(
  text: string,
  region: DiscoveryIntent['region'],
): { city: string | null; uf: UF | null } {
  const city = region.cities.find((item) => cityIn(item, text)) ?? null;
  return { city, uf: city && region.ufs.length === 1 ? (region.ufs[0] ?? null) : null };
}

const UF_AFTER_PLACE = new RegExp(
  String.raw`^\s*(?:[/,–-]\s*|\(\s*)(${Object.keys(STATE_NAMES).join('|')})\b`,
);

/**
 * O texto escreve o lugar como município: "em Cambé", "cidade de Cambé", "Cambé/PR", "Cambé - PR"
 * ou "Cambé (PR)". "Clínica Bem Cuidar – Jardim Higienópolis" não diz a cidade: o bairro virava a
 * cidade da empresa (revisão do KI-148).
 */
function writtenAsMunicipality(place: string, text: string): boolean {
  const needle = normalizeCity(place);
  if (new RegExp(` (em|cidade de|municipio de) ${needle} `).test(` ${comparable(text)} `)) {
    return true;
  }
  const plain = stripAccents(text);
  const lower = plain.toLowerCase();
  const target = stripAccents(place).toLowerCase();
  for (let at = lower.indexOf(target); at >= 0; at = lower.indexOf(target, at + 1)) {
    if (UF_AFTER_PLACE.test(plain.slice(at + target.length))) return true;
  }
  return false;
}

/**
 * O resultado chega ao extrator? Texto que tenta dar ordens ao modelo não é fonte. A avaliação da
 * Descoberta usa esta mesma conferência.
 */
export function extractableResult(result: { title: string; snippet: string }): boolean {
  return !looksLikeInstruction(`${result.title} ${result.snippet}`);
}

/**
 * Cidade e UF de uma empresa lida pelo extrator, conferidas no texto do resultado. A cidade do
 * modelo só fica se estiver no texto e não houver sinal de bairro: a palavra "bairro", o nome
 * seguido da cidade pedida no fim do endereço ("Batel, Curitiba/PR", KI-148) ou um começo de
 * bairro ("Jardim Higienópolis") sem o texto escrevê-lo como município. O município vizinho
 * ("Pet Shop – Cambé |", "Atendemos Cambé, Londrina e região") continua município (segunda
 * revisão do KI-148). Sem cidade do modelo, vale a cidade pedida que o texto citar, ou nenhuma.
 * A avaliação da Descoberta usa esta mesma conferência.
 */
export function companyPlace(
  company: { city: string | null; uf: UF | null },
  text: string,
  region: DiscoveryIntent['region'],
): { city: string | null; uf: UF | null } {
  const stated =
    company.city &&
    cityIn(company.city, text) &&
    !districtInResult(company.city, text, region.cities) &&
    !(districtLike(company.city) && !writtenAsMunicipality(company.city, text))
      ? company.city
      : null;
  const place = stated ? null : regionPlaceOf(text, region);
  const city = stated ?? place?.city ?? null;
  const uf = company.uf && (city || ufIn(company.uf, text)) ? company.uf : (place?.uf ?? null);
  return { city, uf };
}

/**
 * O servidor aceita o sinal que o extrator leu neste resultado? A citação precisa estar na fonte,
 * num campo só (citação que atravessa título e trecho não existe); expansão precisa de um
 * acontecimento no trecho, porque frase institucional ("mais uma unidade do maior pet shop do
 * Brasil") não é sinal (KI-148); e a data fica só com o que o texto diz. null = descartado. A
 * avaliação da Descoberta usa esta mesma conferência.
 */
export function acceptedSignal(
  signal: Pick<ExtractorOutput['signals'][number], 'type' | 'quote' | 'eventDate'>,
  result: { title: string; snippet: string },
  now?: Date,
): { eventDate: ExtractorOutput['signals'][number]['eventDate'] } | null {
  if (
    !signalQuoteFound(signal.quote, result.title) &&
    !signalQuoteFound(signal.quote, result.snippet)
  ) {
    return null;
  }
  if (signal.type === 'expansion' && !expansionEventIn(signal.quote, now?.getUTCFullYear())) {
    return null;
  }
  return { eventDate: supportedEventDate(signal.eventDate, `${result.title} ${result.snippet}`) };
}

/** Junta a resposta do extrator aos candidatos da pesquisa, descartando o que não se confirma. */
function absorb(
  candidates: Candidate[],
  batch: readonly SearchResultRow[],
  output: ExtractorOutput,
  region: DiscoveryIntent['region'],
  now: Date,
): void {
  const kinds = new Map(output.results.map((item) => [item.result, item.kind]));
  const byResultCompany = new Map<string, Candidate>();

  for (const company of output.companies) {
    const result = batch[company.result - 1];
    if (!result) continue;
    // Sites de dados de CNPJ mostram o nome do MEI com o CPF: o CPF fica de fora (regra 7).
    const name = withoutCpf(company.name).slice(0, 160);
    if (distinctiveTokens(name).length === 0) continue;
    const text = `${result.title} ${result.snippet}`;
    const key = siteKey(result.url);
    // Site oficial só quando o endereço confere com o nome: a palavra do modelo (ou de uma
    // página que se diz "site oficial") não basta para ligar CNPJ, domínio e dossiê.
    const official = key !== null && nameMatchesHost(name, result.host);
    // Nome que não aparece na fonte (e não é o site da empresa) é invenção do modelo: descarta.
    if (!official && !nameFoundIn(name, text)) continue;
    const { city, uf } = companyPlace(company, text, region);
    const probe: DedupeCandidate = {
      name,
      siteKey: official ? key : null,
      city,
      uf,
      cnpj: null,
    };
    let candidate = findCandidate(candidates, probe);
    if (!candidate) {
      candidate = {
        name,
        siteKey: probe.siteKey,
        websiteUrl: official ? homepageOf(result.url) : null,
        city,
        uf,
        segment: company.segment,
        description: company.description,
        cnpj: null,
        siteVerified: false,
        sources: new Map(),
        signals: [],
      };
      candidates.push(candidate);
    } else {
      if (official && !candidate.siteKey) {
        candidate.siteKey = key;
        candidate.websiteUrl = homepageOf(result.url);
      }
      candidate.city ??= city;
      candidate.uf ??= uf;
      candidate.segment ??= company.segment;
      candidate.description ??= company.description;
    }
    candidate.sources.set(result.url, {
      url: result.url,
      host: result.host,
      title: clean(result.title, 300),
      snippet: result.snippet.slice(0, DISCOVERY_SNIPPET_MAX),
      kind: 'search_result',
      relation: official
        ? 'official_site'
        : relationFor(result.hostKind, kinds.get(company.result)),
      provider: 'tavily',
      publishedAt: result.publishedAt,
    });
    byResultCompany.set(`${company.result}|${normalizeCompanyName(name)}`, candidate);
  }

  for (const signal of output.signals) {
    const result = batch[signal.result - 1];
    if (!result) continue;
    const text = `${result.title} ${result.snippet}`;
    const accepted = acceptedSignal(signal, result, now);
    if (!accepted) continue;
    const eventDate = accepted.eventDate;
    const companyName = signal.company.replace(/\s+/g, ' ').trim();
    let candidate =
      byResultCompany.get(`${signal.result}|${normalizeCompanyName(companyName)}`) ??
      candidates.find(
        (item) =>
          item.sources.has(result.url) &&
          (nameFoundIn(item.name, companyName) || nameFoundIn(companyName, item.name)),
      ) ??
      null;
    if (!candidate) {
      if (distinctiveTokens(companyName).length === 0 || !nameFoundIn(companyName, text)) continue;
      const place = regionPlaceOf(text, region);
      candidate = findCandidate(candidates, {
        name: companyName,
        siteKey: null,
        city: place.city,
        uf: place.uf,
        cnpj: null,
      });
      if (!candidate) {
        candidate = {
          name: companyName.slice(0, 160),
          siteKey: null,
          websiteUrl: null,
          city: place.city,
          uf: place.uf,
          segment: null,
          description: null,
          cnpj: null,
          siteVerified: false,
          sources: new Map(),
          signals: [],
        };
        candidates.push(candidate);
      }
    }
    const isOfficial = candidate.siteKey !== null && siteKey(result.url) === candidate.siteKey;
    const relation: ProspectSourceRelation = isOfficial
      ? 'official_site'
      : relationFor(result.hostKind, kinds.get(signal.result));
    const known = candidate.sources.get(result.url);
    const title = clean(result.title, 300);
    const inTitle = title !== null && quoteFoundIn(signal.quote, title);
    if (!known) {
      candidate.sources.set(result.url, {
        url: result.url,
        host: result.host,
        title,
        snippet: inTitle
          ? result.snippet.slice(0, DISCOVERY_SNIPPET_MAX)
          : excerptAround(result.snippet, signal.quote, DISCOVERY_SNIPPET_MAX),
        kind: 'search_result',
        relation,
        provider: 'tavily',
        publishedAt: result.publishedAt,
      });
    } else if (!inTitle && !quoteFoundIn(signal.quote, known.snippet)) {
      known.snippet = excerptAround(result.snippet, signal.quote, DISCOVERY_SNIPPET_MAX);
    }
    const recency = signalRecency(eventDate, result.publishedAt, now);
    const assessment = { relation, quoteVerified: true, explicit: signal.explicit, recency };
    if (candidate.signals.some((item) => item.url === result.url && item.type === signal.type))
      continue;
    candidate.signals.push({
      url: result.url,
      type: signal.type,
      summary: signal.summary.slice(0, 300),
      quote: signal.quote.slice(0, DISCOVERY_SNIPPET_MAX),
      eventDate,
      publishedAt: result.publishedAt,
      verification: signalVerification(assessment),
      confidence: signalConfidence(assessment),
      relevance: signal.relevance,
      relatedService: signal.service,
      rationale: (signal.rationale ?? '').slice(0, 400),
      recency,
    });
  }
}
