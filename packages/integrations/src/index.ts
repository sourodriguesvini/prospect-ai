/**
 * Adaptadores de serviços externos (ADR-0001): implementam portas de `@prospector/application`.
 * Só a raiz de composição da web importa este pacote. Toda integração nova segue a skill
 * `integracao-externa` e o checklist de termos do doc 05.
 */
export { createCnpjLookup, type CnpjLookupOptions } from './cnpj/lookup';
export {
  minhaReceita,
  openCnpj,
  type CnpjProviderAdapter,
  type ProviderResult,
} from './cnpj/providers';
export { USER_AGENT, getJson, type Fetch, type HttpOutcome } from './http';
// Pesquisa na internet (ADR-0012): busca Tavily e leitor de páginas com proteção SSRF e robots.txt.
export {
  TAVILY_BASIC_SEARCH_CREDITS,
  TAVILY_SEARCH_URL,
  createTavilySearch,
  parseTavilyResponse,
  tavilyRequestBody,
  type TavilySearchOptions,
} from './web/tavily';
export {
  createPageReader,
  isRestrictedHost,
  subresourceFetcher,
  type PageReaderOptions,
} from './web/page-reader';
export {
  createPlaywrightRenderer,
  type BrowserCapturer,
  type BrowserRenderer,
  type CaptureOptions,
  type PageCapture,
  type MainDocument,
  type PlaywrightRendererOptions,
  type RenderedPage,
} from './web/browser';
export { checkUrl, isPublicAddress, systemResolver, type Resolver } from './web/ssrf';
export {
  safeFetch,
  type Transport,
  type TransportRequest,
  type TransportResponse,
} from './web/safe-http';
export { ROBOTS_PRODUCT_TOKEN, createRobotsChecker, isAllowed, parseRobots } from './web/robots';
// Captura de marca (ADR-0015): imagem e medições da página inicial, e a pasta das imagens.
export {
  DEFAULT_CAPTURE_MAX_HEIGHT,
  METRICS_SCRIPT,
  createBrandCapturer,
  type BrandCapturerOptions,
} from './web/brand-capturer';
export { createFileCaptureStore, isCaptureStoragePath } from './capture-store';
// E-mail (ADR-0016): envio pela caixa do usuário (SMTP), login IMAP e consulta TXT do DNS.
export { createSmtpTransport, type SmtpTransportOptions } from './email/smtp';
export { createImapReader, type ImapReaderOptions } from './email/imap';
export { createDnsTxtLookup, type DnsTxtLookupOptions } from './email/dns';
