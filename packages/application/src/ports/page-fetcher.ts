import type { PageReadFailure, WebPage } from '@prospector/contracts';

/** Falhas que o leitor produz; `disabled` e `busy` são da aplicação. */
export type PageFetchFailure = Exclude<PageReadFailure, 'disabled' | 'busy'>;

export type PageFetchResult =
  { ok: true; page: WebPage } | { ok: false; failure: PageFetchFailure; httpStatus: number | null };

/**
 * Leitura de uma página pública da internet, reduzida a texto (D-AI-4, ADR-0012). A
 * implementação (`@prospector/integrations`) é responsável por: só http(s) em portas padrão;
 * resolver o DNS e recusar endereços internos (loopback, rede privada, link-local, metadados de
 * nuvem, equivalentes IPv6) em cada salto de redirecionamento; respeitar o robots.txt; limitar
 * tamanho e tempo; User-Agent genérico; não contornar login, pagamento nem CAPTCHA. Nunca lança
 * por falha do site: devolve `ok: false` com o motivo.
 */
export interface PageFetcher {
  fetchPage(url: string, options?: { signal?: AbortSignal }): Promise<PageFetchResult>;
}
