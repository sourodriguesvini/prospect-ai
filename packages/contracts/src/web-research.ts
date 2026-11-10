import { z } from 'zod';

/**
 * Pesquisa na internet (D-AI-4, ADR-0012): busca por um provedor (Tavily) e leitura de páginas
 * públicas por um leitor próprio (Playwright). Estes contratos fixam a FORMA do que entra e sai
 * das portas `WebSearch` e `PageFetcher` (`@prospector/application`). Resultado de busca e página
 * lida são dados externos não confiáveis: viram fonte do ledger (`search_result`, `web_page`) e
 * nunca instrução para o modelo.
 */

const IsoDateTime = z.iso.datetime({ offset: true, error: 'Data e hora inválidas (ISO 8601).' });

// -----------------------------------------------------------------------------
// Provedores
// -----------------------------------------------------------------------------

export const WebSearchProvider = z.enum(['tavily']);
export type WebSearchProvider = z.infer<typeof WebSearchProvider>;

export const WEB_SEARCH_PROVIDER_LABELS: Record<WebSearchProvider, string> = {
  tavily: 'Tavily',
};

/** Como a página foi lida: navegador sem rede própria (Playwright) ou só HTTP (texto puro). */
export const PageRenderer = z.enum(['browser', 'http']);
export type PageRenderer = z.infer<typeof PageRenderer>;

// -----------------------------------------------------------------------------
// Consulta
// -----------------------------------------------------------------------------

/**
 * Trechos que parecem dado pessoal (regra 7, LGPD): e-mail, CPF e telefone brasileiro com DDD.
 * Na consulta, são recusados (a Tavily pode guardar e usar as consultas, ADR-0012); no texto que
 * volta da internet (trechos e páginas), são mascarados antes de qualquer gravação. CNPJ
 * (14 dígitos), CEP e anos passam. Nomes de pessoas não são detectáveis: a descrição da
 * ferramenta e a tela pedem para não buscar pessoas.
 */
// Tamanhos limitados e início ancorado: sem isso, texto longo sem `@` leva tempo quadrático
// (revisão de segurança 2026-11-10, A1).
const EMAIL_PATTERN = /(?<![\w.+-])[\w.+-]{1,64}@[\w-]{1,63}(?:\.[\w-]{1,63}){0,8}\.[a-z]{2,24}/gi;
const CPF_PATTERN = /(?<![\d.])\d{3}\.?\d{3}\.?\d{3}-?\d{2}(?![\d.-])/g;
/** CPF formatado com parte escondida, como os agregadores publicam (`***.456.789-**`). */
const MASKED_CPF_PATTERN = /(?<![\w*.])[\d*]{3}\.[\d*]{3}\.[\d*]{3}-[\d*]{2}(?![\w*])/g;
/**
 * DDD (com ou sem parênteses e +55), 8 ou 9 dígitos com separador opcional, inclusive o celular
 * escrito com o 9 separado (`(16) 9 9876-5432`).
 */
const PHONE_PATTERN =
  /(?<![\w])(?:\+?55[\s.-]?)?\(?\d{2}\)?[\s.-]?(?:9[\s.-]?)?\d{4}[\s.-]?\d{4}(?![\d-])/g;

export type PersonalDataKind = 'email' | 'document_or_phone';

export function findPersonalData(text: string): PersonalDataKind | null {
  if (new RegExp(EMAIL_PATTERN.source, 'i').test(text)) return 'email';
  if (
    new RegExp(CPF_PATTERN.source).test(text) ||
    new RegExp(MASKED_CPF_PATTERN.source).test(text) ||
    new RegExp(PHONE_PATTERN.source).test(text)
  ) {
    return 'document_or_phone';
  }
  return null;
}

/** Texto externo com e-mails, CPFs e telefones trocados por marcadores (minimização). */
export function redactPersonalData(text: string): string {
  return text
    .replace(EMAIL_PATTERN, '[e-mail omitido]')
    .replace(MASKED_CPF_PATTERN, '[documento omitido]')
    .replace(CPF_PATTERN, '[documento omitido]')
    .replace(PHONE_PATTERN, '[telefone omitido]');
}

const PERSONAL_DATA_MESSAGES: Record<PersonalDataKind, string> = {
  email: 'Tire o e-mail da consulta: dados pessoais não são enviados ao buscador.',
  document_or_phone:
    'Tire o número da consulta (parece CPF ou telefone): dados pessoais não são enviados ao buscador. CNPJ pode.',
};

// -----------------------------------------------------------------------------
// Sites que o Prospector não lê nem guarda
// -----------------------------------------------------------------------------

/**
 * Sites cujos termos proíbem coleta automatizada (regra 6; doc 05 §3), mais os scripts do Google
 * Maps/Places (avaliações não podem ser copiadas). O leitor recusa a página e os sub-recursos; um
 * resultado de busca que aponta para eles aparece na hora, mas não é gravado no dossiê. Lista
 * revisada com a skill `integracao-externa`; os itens marcados no ADR-0012 ainda estão a conferir.
 */
export const RESTRICTED_WEB_HOSTS: readonly string[] = [
  'linkedin.com',
  'lnkd.in',
  'instagram.com',
  'instagr.am',
  'cdninstagram.com',
  'facebook.com',
  'fb.com',
  'fb.me',
  'fbcdn.net',
  'facebook.net',
  'threads.net',
  'threads.com',
  'tiktok.com',
  'x.com',
  'twitter.com',
  't.co',
  'youtube.com',
  'youtu.be',
  'whatsapp.com',
  'wa.me',
  'google.com',
  'google.com.br',
  'goo.gl',
  'maps.googleapis.com',
  'places.googleapis.com',
  'maps.gstatic.com',
  'reclameaqui.com.br',
];

/**
 * Agregadores de CNPJ que publicam sócios, CPF parcial e endereço de MEI: furam a minimização do
 * cadastro (doc 05 §2). Saem da busca por padrão (`exclude_domains`) e o leitor não os abre.
 */
export const MINIMIZATION_BLOCKED_HOSTS: readonly string[] = [
  'cnpj.biz',
  'casadosdados.com.br',
  'econodata.com.br',
  'consultasocio.com',
  'cnpja.com',
  'cnpj.info',
  'empresascnpj.com',
];

function hostMatches(host: string, domains: readonly string[]): boolean {
  const clean = host.toLowerCase().replace(/\.$/, '');
  return domains.some((domain) => clean === domain || clean.endsWith(`.${domain}`));
}

/** Por que o Prospector não lê nem guarda conteúdo desse host (null = pode). */
export function webHostRestriction(host: string): 'terms' | 'minimization' | null {
  if (hostMatches(host, RESTRICTED_WEB_HOSTS)) return 'terms';
  if (hostMatches(host, MINIMIZATION_BLOCKED_HOSTS)) return 'minimization';
  return null;
}

export const WebSearchQuery = z
  .string()
  .trim()
  .min(3, { error: 'Consulta curta demais (mínimo de 3 caracteres).' })
  .max(300, { error: 'Consulta longa demais (máximo de 300 caracteres).' })
  .superRefine((query, ctx) => {
    const kind = findPersonalData(query);
    if (kind) ctx.addIssue({ code: 'custom', message: PERSONAL_DATA_MESSAGES[kind] });
  });

/** Domínio sem esquema nem caminho (`exemplo.com.br`), em minúsculas. */
export const WebDomain = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/, {
    error: 'Domínio inválido (use só o domínio, como exemplo.com.br).',
  });

export const WEB_SEARCH_MAX_RESULTS = 10;

export const WebSearchTopic = z.enum(['general', 'news']);
export type WebSearchTopic = z.infer<typeof WebSearchTopic>;

/**
 * Pedido de busca. Sem profundidade nem resposta pronta do provedor: toda busca é a "básica"
 * (1 crédito na Tavily, ADR-0012) e quem interpreta os resultados é o modelo local.
 */
export const WebSearchRequest = z.object({
  query: WebSearchQuery,
  maxResults: z.number().int().min(1).max(WEB_SEARCH_MAX_RESULTS).default(5),
  topic: WebSearchTopic.default('general'),
  /** Dá preferência a resultados do país (não filtra). `null` = sem preferência. */
  region: z.enum(['br']).nullable().default('br'),
  timeRange: z.enum(['day', 'week', 'month', 'year']).nullable().default(null),
  includeDomains: z.array(WebDomain).max(10).default([]),
  excludeDomains: z.array(WebDomain).max(20).default([]),
});
export type WebSearchRequest = z.infer<typeof WebSearchRequest>;
export type WebSearchRequestDraft = z.input<typeof WebSearchRequest>;

// -----------------------------------------------------------------------------
// Resultado
// -----------------------------------------------------------------------------

export const WEB_SNIPPET_MAX_CHARS = 1200;
/**
 * O que fica gravado no dossiê (fontes só de inclusão): trecho do buscador e começo do texto da
 * página bem curtos, porque os termos da Tavily não dizem por quanto tempo o trecho pode ser
 * guardado e páginas trazem nomes de pessoas (ADR-0012). O texto inteiro só vive no cache.
 */
export const WEB_LEDGER_SNIPPET_MAX_CHARS = 300;
export const WEB_LEDGER_PAGE_TEXT_MAX_CHARS = 500;

export const WebSearchResult = z.object({
  /** Posição no resultado do provedor, a partir de 1. */
  rank: z.number().int().min(1).max(50),
  url: z.httpUrl({ error: 'URL inválida (use http ou https).' }).max(2048),
  title: z.string().trim().min(1).max(300),
  /** Trecho que o provedor devolveu, como veio (cortado no limite). */
  snippet: z.string().max(WEB_SNIPPET_MAX_CHARS),
  /** Data de publicação quando o provedor a informa (AAAA-MM-DD). */
  publishedAt: z.iso.date().nullable().default(null),
  /** Relevância do provedor, de 0 a 1, quando informada. Não é confiança no conteúdo. */
  score: z.number().min(0).max(1).nullable().default(null),
});
export type WebSearchResult = z.infer<typeof WebSearchResult>;

export const WebSearchFailure = z.enum([
  /** Desligada por configuração (`PROSPECTOR_WEB_SEARCH=off`). */
  'disabled',
  /** Falta a chave do provedor. */
  'not_configured',
  /** O orçamento local de créditos do mês acabou: nenhuma chamada é feita. */
  'budget_exhausted',
  /** O provedor recusou por cota do plano (créditos gratuitos esgotados). */
  'quota_exceeded',
  'rate_limited',
  /** Fila local cheia (concorrência limitada). */
  'busy',
  /** Chave recusada pelo provedor. */
  'unauthorized',
  'unavailable',
  'invalid_response',
  /** Empresa individual (MEI, empresário individual): o nome é de uma pessoa (LGPD). */
  'personal_data',
]);
export type WebSearchFailure = z.infer<typeof WebSearchFailure>;

export const WEB_SEARCH_MESSAGES: Record<WebSearchFailure, string> = {
  disabled: 'A pesquisa na internet está desligada nesta instalação (PROSPECTOR_WEB_SEARCH=off).',
  not_configured:
    'A pesquisa na internet ainda não foi configurada: falta a chave da Tavily (TAVILY_API_KEY). O passo a passo está no ADR-0012.',
  budget_exhausted:
    'O orçamento de pesquisas deste mês acabou (WEB_SEARCH_MONTHLY_CREDITS). Nenhuma busca nova será feita até o mês que vem; o que já foi guardado continua disponível.',
  quota_exceeded:
    'A Tavily recusou a busca: os créditos do plano gratuito acabaram. As buscas voltam quando os créditos renovarem, no dia 1º.',
  rate_limited: 'O buscador pediu uma pausa. Tente de novo em alguns minutos.',
  busy: 'Já há pesquisas em andamento. Espere terminarem e tente de novo.',
  unauthorized: 'A Tavily recusou a chave configurada. Confira a TAVILY_API_KEY.',
  unavailable:
    'Não consegui pesquisar agora (buscador fora do ar, lento demais ou sem internet). Nenhum resultado foi inventado: tente de novo mais tarde.',
  invalid_response:
    'O buscador respondeu num formato inesperado. Nenhum resultado foi usado; tente de novo mais tarde.',
  personal_data:
    'Empresa individual (MEI ou empresário individual): o nome dela é o nome de uma pessoa. Para não enviar nem guardar dado pessoal, a pesquisa na internet não é feita para ela.',
};

export const WebSearchOutcome = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    provider: WebSearchProvider,
    /** Consulta como foi enviada (já validada). */
    query: z.string(),
    results: z.array(WebSearchResult).max(WEB_SEARCH_MAX_RESULTS),
    /** Quando o provedor respondeu (resultado em cache mantém a data original). */
    fetchedAt: IsoDateTime,
    fromCache: z.boolean(),
    /** Créditos gastos nesta chamada (0 quando veio do cache). */
    creditsCharged: z.number().int().min(0),
  }),
  z.object({
    ok: z.literal(false),
    failure: WebSearchFailure,
    message: z.string(),
    provider: WebSearchProvider.nullable(),
    /** Segundos indicados pelo provedor antes de tentar de novo, quando houver. */
    retryAfterSeconds: z.number().int().min(0).nullable().default(null),
  }),
]);
export type WebSearchOutcome = z.infer<typeof WebSearchOutcome>;

// -----------------------------------------------------------------------------
// Leitura de página
// -----------------------------------------------------------------------------

export const PageReadRequest = z.object({
  url: z.httpUrl({ error: 'Endereço inválido (use http ou https).' }).max(2048),
});
export type PageReadRequest = z.infer<typeof PageReadRequest>;

/** Limite do texto guardado de uma página (cabe em `sources.excerpt_text`, até 100 mil). */
export const WEB_PAGE_TEXT_MAX_CHARS = 100_000;

/** Página pública lida e reduzida a texto. Sem HTML, imagens nem scripts. */
export const WebPage = z.object({
  schemaVersion: z.literal(1),
  requestedUrl: z.httpUrl().max(2048),
  /** Endereço final, depois de redirecionamentos (todos conferidos). */
  url: z.httpUrl().max(2048),
  httpStatus: z.number().int().min(100).max(599),
  contentType: z.string().max(120),
  title: z.string().max(300).nullable(),
  description: z.string().max(500).nullable(),
  lang: z.string().max(35).nullable(),
  /** Texto visível normalizado (espaços colapsados), cortado no limite. */
  text: z.string().max(WEB_PAGE_TEXT_MAX_CHARS),
  truncated: z.boolean(),
  /** SHA-256 em hexadecimal de `text`. */
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  fetchedAt: IsoDateTime,
  renderer: PageRenderer,
  /**
   * O site pediu para não guardar cópia (`noarchive`, `none`, `tdm-reservation`). A página pode
   * ser mostrada na hora, mas o dossiê guarda só endereço e título.
   */
  noArchive: z.boolean().default(false),
});
export type WebPage = z.infer<typeof WebPage>;

export const PageReadFailure = z.enum([
  /** Leitor desligado por configuração (`PROSPECTOR_PAGE_READER=off`). */
  'disabled',
  /** Endereço interno, da rede local, deste computador, porta fora do padrão ou esquema proibido. */
  'blocked_address',
  /** O robots.txt do site não permite (ou não pôde ser lido com segurança). */
  'robots_disallowed',
  /** 401, 403, 451, login ou pedido explícito do site para não ser usado com IA. */
  'access_denied',
  /**
   * Site cujos termos proíbem leitura automatizada (LinkedIn, Instagram, Facebook, Google Maps) ou
   * agregador que expõe dados pessoais de sócios.
   */
  'restricted_site',
  'not_found',
  'too_large',
  'too_many_redirects',
  /** Não é HTML nem texto. */
  'unsupported_content',
  'rate_limited',
  'busy',
  'unavailable',
  /** Empresa individual: a página não é gravada no dossiê dela (LGPD). */
  'personal_data',
]);
export type PageReadFailure = z.infer<typeof PageReadFailure>;

export const PAGE_READ_MESSAGES: Record<PageReadFailure, string> = {
  disabled: 'A leitura de páginas está desligada nesta instalação (PROSPECTOR_PAGE_READER=off).',
  blocked_address:
    'Esse endereço não pode ser lido: só páginas públicas da internet (http ou https, portas padrão). Endereços deste computador, da rede local ou internos de nuvem são bloqueados.',
  robots_disallowed:
    'O site pede, no robots.txt, que robôs não leiam essa página. O Prospector respeita o pedido.',
  access_denied:
    'O site recusou o acesso (login, pagamento ou pedido para não ser usado com IA). O Prospector não contorna restrições de acesso.',
  restricted_site:
    'Esse site não é lido automaticamente: os termos dele proíbem coleta (ex.: LinkedIn, Instagram, Facebook, Google Maps) ou ele publica dados pessoais de sócios, que o Prospector não guarda. Abra o endereço no navegador se precisar.',
  not_found: 'A página não existe mais (erro 404 ou 410).',
  too_large: 'A página é grande demais para ser lida com segurança.',
  too_many_redirects: 'A página redireciona demais e não foi lida.',
  unsupported_content: 'O endereço não aponta para uma página de texto (HTML ou texto puro).',
  rate_limited: 'O site pediu uma pausa. Tente de novo mais tarde.',
  busy: 'Já há páginas sendo lidas. Espere terminarem e tente de novo.',
  unavailable:
    'Não consegui ler a página agora (site fora do ar, lento demais ou sem internet). Nada foi inventado: tente de novo mais tarde.',
  personal_data:
    'Empresa individual (MEI ou empresário individual): o nome dela é o nome de uma pessoa. Para não guardar dado pessoal, páginas da internet não são gravadas no dossiê dela.',
};

export const PageReadOutcome = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), page: WebPage, fromCache: z.boolean() }),
  z.object({
    ok: z.literal(false),
    failure: PageReadFailure,
    message: z.string(),
    /** Status HTTP quando a falha veio do site. */
    httpStatus: z.number().int().min(100).max(599).nullable().default(null),
  }),
]);
export type PageReadOutcome = z.infer<typeof PageReadOutcome>;

// -----------------------------------------------------------------------------
// Consumo e configuração
// -----------------------------------------------------------------------------

/** Créditos do plano gratuito da Tavily por mês (tavily.com/pricing, lido em 2026-11-10). */
export const TAVILY_FREE_MONTHLY_CREDITS = 1000;

/** Consumo do mês corrente, para a tela e para o Copiloto dizerem quanto resta. */
export const WebResearchUsage = z.object({
  /** Mês civil no fuso da agência (AAAA-MM). */
  period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  provider: WebSearchProvider,
  creditsUsed: z.number().int().min(0),
  creditsBudget: z.number().int().min(0),
  creditsRemaining: z.number().int().min(0),
});
export type WebResearchUsage = z.infer<typeof WebResearchUsage>;

const OnOff = z.enum(['on', 'off']);

/**
 * Variáveis de ambiente da pesquisa na internet, lidas só no servidor (`apps/web/src/server/
 * env.ts`). A chave nunca entra aqui: só a presença dela (`TAVILY_API_KEY_PRESENT`), para que a
 * mensagem de erro cite nomes de variáveis e nunca valores.
 */
export const WebResearchEnv = z.object({
  /** `off` desliga a busca; vazia = ligada quando há chave. */
  PROSPECTOR_WEB_SEARCH: OnOff.optional(),
  /** `off` desliga a leitura de páginas; vazia = ligada (não usa chave). */
  PROSPECTOR_PAGE_READER: OnOff.optional(),
  /**
   * Créditos por mês que o app pode gastar. Nunca acima da cota gratuita: o app não gasta além
   * dela nem se a conta tiver cobrança por uso ligada.
   */
  WEB_SEARCH_MONTHLY_CREDITS: z.coerce
    .number()
    .int()
    .min(0)
    .max(TAVILY_FREE_MONTHLY_CREDITS)
    .default(900),
  WEB_SEARCH_MAX_CONCURRENCY: z.coerce.number().int().min(1).max(4).default(2),
  /** Horas que um resultado de busca idêntico é reaproveitado sem gastar crédito. */
  WEB_SEARCH_CACHE_HOURS: z.coerce.number().int().min(0).max(720).default(24),
  PAGE_READER_MAX_CONCURRENCY: z.coerce.number().int().min(1).max(3).default(1),
});
export type WebResearchEnv = z.infer<typeof WebResearchEnv>;

/** Formato esperado de cada variável, para a mensagem de configuração inválida (sem o valor). */
export const WEB_RESEARCH_ENV_FORMATS: Record<keyof WebResearchEnv, string> = {
  PROSPECTOR_WEB_SEARCH: '"on", "off" ou vazia',
  PROSPECTOR_PAGE_READER: '"on", "off" ou vazia',
  WEB_SEARCH_MONTHLY_CREDITS: `número inteiro de 0 a ${TAVILY_FREE_MONTHLY_CREDITS}`,
  WEB_SEARCH_MAX_CONCURRENCY: 'número inteiro de 1 a 4',
  WEB_SEARCH_CACHE_HOURS: 'número inteiro de 0 a 720',
  PAGE_READER_MAX_CONCURRENCY: 'número inteiro de 1 a 3',
};
