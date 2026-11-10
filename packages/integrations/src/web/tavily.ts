import type {
  WebSearch,
  WebSearchProviderFailure,
  WebSearchProviderResult,
} from '@prospector/application';
import {
  WEB_SNIPPET_MAX_CHARS,
  WebSearchResult,
  redactPersonalData,
  type WebSearchRequest,
} from '@prospector/contracts';
import { z } from 'zod';
import { USER_AGENT, type Fetch } from '../http';

/**
 * Tavily Search API (D-AI-4, ADR-0012). Conferido em docs.tavily.com em 2026-11-10:
 * `POST https://api.tavily.com/search`, `Authorization: Bearer <chave>`; busca "basic" = 1 crédito;
 * 401 chave inválida, 429 limite por minuto (com `Retry-After`), 432 cota do plano, 433 limite do
 * pago por uso, 434 capacidade do nível gratuito. Host fixo (sem SSRF); a chave vem só do
 * servidor e nunca vai para log, erro ou telemetria. A consulta já chega validada (sem dado
 * pessoal) e o que volta é tratado como dado não confiável: validado, cortado e com dados
 * pessoais mascarados.
 */

export const TAVILY_SEARCH_URL = 'https://api.tavily.com/search';
/** Custo de uma busca `basic` (docs.tavily.com/documentation/api-credits, 2026-11-10). */
export const TAVILY_BASIC_SEARCH_CREDITS = 1;

export interface TavilySearchOptions {
  /** Chave do servidor (`TAVILY_API_KEY`). Nunca `NEXT_PUBLIC_*`. */
  apiKey: string;
  fetch?: Fetch;
  timeoutMs?: number;
}

const TavilyResult = z.object({
  url: z.string(),
  title: z.string().nullish(),
  content: z.string().nullish(),
  score: z.number().nullish(),
  published_date: z.string().nullish(),
});

const TavilyResponse = z.object({
  results: z.array(z.unknown()),
  usage: z.object({ credits: z.number().nullish() }).nullish(),
});

/** Erros de rede em que o pedido nem chegou à Tavily (nada foi cobrado). */
const NOT_SENT_CODES = new Set([
  'ENOTFOUND',
  'EAI_AGAIN',
  'ECONNREFUSED',
  'ENETUNREACH',
  'EHOSTUNREACH',
]);

function errorCode(error: unknown): string | null {
  const cause =
    error instanceof Error ? (error.cause as { code?: unknown } | undefined) : undefined;
  return typeof cause?.code === 'string' ? cause.code : null;
}

function retryAfter(value: string | null): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(Math.round(seconds), 3600);
  const date = Date.parse(value);
  if (Number.isNaN(date)) return null;
  return Math.min(Math.max(0, Math.round((date - Date.now()) / 1000)), 3600);
}

function oneLine(text: string, max: number): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
}

function isoDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const direct = /^(\d{4}-\d{2}-\d{2})/.exec(value)?.[1];
  const parsed = direct ? Date.parse(`${direct}T00:00:00Z`) : Date.parse(value);
  if (Number.isNaN(parsed)) return null;
  return new Date(parsed).toISOString().slice(0, 10);
}

function hostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function failure(
  kind: WebSearchProviderFailure,
  creditsCharged = 0,
  retryAfterSeconds: number | null = null,
): WebSearchProviderResult {
  return { ok: false, failure: kind, creditsCharged, retryAfterSeconds };
}

/** Corpo do pedido: sempre `basic`, sem resposta pronta, sem conteúdo bruto nem imagens. */
export function tavilyRequestBody(request: WebSearchRequest): Record<string, unknown> {
  return {
    query: request.query,
    search_depth: 'basic',
    max_results: request.maxResults,
    topic: request.topic,
    ...(request.region === 'br' && request.topic === 'general' ? { country: 'brazil' } : {}),
    ...(request.timeRange ? { time_range: request.timeRange } : {}),
    ...(request.includeDomains.length ? { include_domains: request.includeDomains } : {}),
    ...(request.excludeDomains.length ? { exclude_domains: request.excludeDomains } : {}),
    include_answer: false,
    include_raw_content: false,
    include_images: false,
    auto_parameters: false,
    include_usage: true,
  };
}

/** Converte a resposta 200 da Tavily; resultados fora do contrato são descartados um a um. */
export function parseTavilyResponse(
  body: unknown,
  maxResults: number,
): { results: WebSearchResult[]; credits: number | null } | null {
  const parsed = TavilyResponse.safeParse(body);
  if (!parsed.success) return null;
  const results: WebSearchResult[] = [];
  parsed.data.results.forEach((raw, index) => {
    const item = TavilyResult.safeParse(raw);
    if (!item.success) return;
    const { url, title, content, score, published_date } = item.data;
    const result = WebSearchResult.safeParse({
      rank: index + 1,
      url,
      // Corta antes de mascarar: a máscara roda só sobre o que pode ser usado.
      title: oneLine(redactPersonalData((title?.trim() || hostname(url)).slice(0, 600)), 300),
      snippet: oneLine(
        redactPersonalData((content ?? '').slice(0, WEB_SNIPPET_MAX_CHARS * 2)),
        WEB_SNIPPET_MAX_CHARS,
      ),
      publishedAt: isoDate(published_date),
      score:
        typeof score === 'number' && Number.isFinite(score)
          ? Math.min(1, Math.max(0, score))
          : null,
    });
    if (result.success) results.push(result.data);
  });
  const credits = parsed.data.usage?.credits;
  return {
    results: results.slice(0, maxResults),
    credits:
      typeof credits === 'number' && Number.isFinite(credits) && credits >= 0 ? credits : null,
  };
}

export function createTavilySearch(options: TavilySearchOptions): WebSearch {
  const fetchImpl = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? 10_000;
  const apiKey = options.apiKey.trim();

  return {
    provider: 'tavily',
    creditsPerSearch: TAVILY_BASIC_SEARCH_CREDITS,
    async search(request, searchOptions = {}) {
      const timeout = AbortSignal.timeout(timeoutMs);
      const signal = searchOptions.signal
        ? AbortSignal.any([searchOptions.signal, timeout])
        : timeout;
      let response: Response;
      try {
        response = await fetchImpl(TAVILY_SEARCH_URL, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${apiKey}`,
            'content-type': 'application/json',
            accept: 'application/json',
            'user-agent': USER_AGENT,
          },
          body: JSON.stringify(tavilyRequestBody(request)),
          redirect: 'error',
          signal,
        });
      } catch (error) {
        if (searchOptions.signal?.aborted) throw error;
        // Pedido que pode ter chegado (tempo esgotado, conexão caiu) conta como cobrado.
        const code = errorCode(error);
        return failure(
          'unavailable',
          code && NOT_SENT_CODES.has(code) ? 0 : TAVILY_BASIC_SEARCH_CREDITS,
        );
      }

      switch (response.status) {
        case 200:
          break;
        case 401:
        case 403:
          return failure('unauthorized');
        case 429:
        case 434:
          return failure('rate_limited', 0, retryAfter(response.headers.get('retry-after')));
        case 432:
        case 433:
          return failure('quota_exceeded');
        case 400:
        case 422:
          return failure('invalid_response');
        default:
          return failure('unavailable');
      }

      let body: unknown;
      try {
        body = await response.json();
      } catch {
        return failure('invalid_response', TAVILY_BASIC_SEARCH_CREDITS);
      }
      const parsed = parseTavilyResponse(body, request.maxResults);
      if (!parsed) return failure('invalid_response', TAVILY_BASIC_SEARCH_CREDITS);
      return {
        ok: true,
        results: parsed.results,
        creditsCharged: parsed.credits ?? TAVILY_BASIC_SEARCH_CREDITS,
      };
    },
  };
}
